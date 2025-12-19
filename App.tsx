
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionStatus, Message, TalkMode, GeminiVoice } from './types.ts';
import { encode, decode, decodeAudioData, createAudioBlob } from './services/audioService.ts';
import StatusIndicator from './components/StatusIndicator.tsx';
import Visualizer from './components/Visualizer.tsx';
import ChatHistory from './components/ChatHistory.tsx';

const STORAGE_KEY = 'gemini_live_chat_history';
const VOICES: GeminiVoice[] = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [currentOutput, setCurrentOutput] = useState('');
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [talkMode, setTalkMode] = useState<TalkMode>(TalkMode.CONTINUOUS);
  const [isPTTPressed, setIsPTTPressed] = useState(false);
  const [textInput, setTextInput] = useState('');
  
  // Settings
  const [volume, setVolume] = useState(1.0);
  const [selectedVoice, setSelectedVoice] = useState<GeminiVoice>('Zephyr');
  const [showSettings, setShowSettings] = useState(false);

  // Refs for audio processing
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const activeSessionRef = useRef<any>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  
  const talkModeRef = useRef(talkMode);
  const isPTTPressedRef = useRef(isPTTPressed);

  useEffect(() => {
    talkModeRef.current = talkMode;
    isPTTPressedRef.current = isPTTPressed;
  }, [talkMode, isPTTPressed]);

  useEffect(() => {
    if (gainNodeRef.current && audioContextOutRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(volume, audioContextOutRef.current.currentTime, 0.05);
    }
  }, [volume]);

  // Persistence
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { 
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setMessages(parsed);
      } catch (e) { 
        console.error("Failed to parse history", e); 
      }
    }
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [messages]);

  const clearHistory = () => {
    if (window.confirm("Clear conversation history?")) {
      setMessages([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const stopConversation = useCallback(() => {
    if (activeSessionRef.current) {
      activeSessionRef.current.close();
      activeSessionRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    sourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsModelSpeaking(false);
    setStatus(ConnectionStatus.DISCONNECTED);
  }, []);

  const startConversation = async () => {
    try {
      setStatus(ConnectionStatus.CONNECTING);
      
      // Initialize AudioContexts on user gesture
      if (!audioContextInRef.current) {
        audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (!audioContextOutRef.current) {
        audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      await audioContextInRef.current.resume();
      await audioContextOutRef.current.resume();

      // Ensure gain node is set up
      if (!gainNodeRef.current) {
        gainNodeRef.current = audioContextOutRef.current.createGain();
        gainNodeRef.current.connect(audioContextOutRef.current.destination);
      }
      gainNodeRef.current.gain.value = volume;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            const source = audioContextInRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              if (talkModeRef.current === TalkMode.CONTINUOUS || isPTTPressedRef.current) {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const pcmBlob = createAudioBlob(inputData);
                sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
              }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextInRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Transcription
            if (message.serverContent?.outputTranscription) {
              setCurrentOutput(prev => prev + message.serverContent!.outputTranscription!.text);
            } else if (message.serverContent?.inputTranscription) {
              setCurrentInput(prev => prev + message.serverContent!.inputTranscription!.text);
            }

            if (message.serverContent?.turnComplete) {
              const uText = currentInput;
              const mText = currentOutput;
              if (uText || mText) {
                setMessages(prev => [
                  ...prev,
                  ...(uText ? [{ id: Date.now() + '-u', sender: 'user' as const, text: uText, timestamp: new Date().toISOString() }] : []),
                  ...(mText ? [{ id: Date.now() + '-m', sender: 'model' as const, text: mText, timestamp: new Date().toISOString() }] : [])
                ].slice(-50));
              }
              setCurrentInput('');
              setCurrentOutput('');
            }

            // Audio Extraction: Iterate parts to find inlineData
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  const base64Audio = part.inlineData.data;
                  setIsModelSpeaking(true);
                  const ctx = audioContextOutRef.current!;
                  
                  // Gapless playback logic
                  nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                  
                  const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
                  const source = ctx.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(gainNodeRef.current!);
                  
                  source.addEventListener('ended', () => {
                    sourcesRef.current.delete(source);
                    if (sourcesRef.current.size === 0) setIsModelSpeaking(false);
                  });

                  source.start(nextStartTimeRef.current);
                  nextStartTimeRef.current += audioBuffer.duration;
                  sourcesRef.current.add(source);
                }
              }
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsModelSpeaking(false);
            }
          },
          onerror: (e) => { 
            console.error("Session Error:", e); 
            setStatus(ConnectionStatus.ERROR); 
            stopConversation(); 
          },
          onclose: (e) => { 
            console.log("Session Closed:", e);
            setStatus(ConnectionStatus.DISCONNECTED); 
            stopConversation(); 
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'You are a helpful and witty AI companion. You always respond with spoken audio. If the user types, reply with audio. Be concise.'
        },
      });

      const session = await sessionPromise;
      activeSessionRef.current = session;
    } catch (err) {
      console.error("Start Conversation Error:", err);
      setStatus(ConnectionStatus.ERROR);
    }
  };

  const handleSendText = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!textInput.trim() || !activeSessionRef.current) return;
    
    const textToSend = textInput.trim();
    setMessages(prev => [...prev, {
      id: Date.now() + '-tu',
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toISOString()
    }]);
    
    activeSessionRef.current.sendRealtimeInput({ text: textToSend });
    setTextInput('');
  };

  const handlePTTDown = () => setIsPTTPressed(true);
  const handlePTTUp = () => setIsPTTPressed(false);

  return (
    <div className="min-h-screen flex flex-col items-center bg-slate-50 py-4 px-4 sm:px-6">
      <div className="w-full max-w-2xl flex flex-col h-[94vh] gap-3">
        {/* Header */}
        <header className="flex items-center justify-between bg-white p-3 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-1.5 rounded-xl">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-sm text-slate-800">Gemini Live</h1>
              <StatusIndicator status={status} />
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-blue-500'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button onClick={clearHistory} className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors" title="Clear History">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </header>

        {/* Main Interface */}
        <div className="flex-1 flex flex-col bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden relative">
          
          {/* Settings Overlay */}
          {showSettings && (
            <div className="absolute inset-0 z-50 bg-white p-6 flex flex-col gap-6 animate-in slide-in-from-top duration-200">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold text-slate-800">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 text-slate-400 hover:text-slate-600">
                   <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                   </svg>
                </button>
              </div>
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Voice Volume</label>
                    <span className="text-xs font-bold text-blue-600">{Math.round(volume * 100)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.01" 
                    value={volume} 
                    onChange={(e) => setVolume(parseFloat(e.target.value))} 
                    className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600" 
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Select Voice (Restart Session to Apply)</label>
                  <div className="grid grid-cols-3 gap-2">
                    {VOICES.map(v => (
                      <button 
                        key={v} 
                        onClick={() => setSelectedVoice(v)} 
                        className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all ${selectedVoice === v ? 'bg-blue-600 text-white shadow-md shadow-blue-100' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-auto text-[11px] text-slate-400 text-center italic">Session settings are updated upon start.</p>
            </div>
          )}

          <div className="p-2 flex justify-center bg-slate-50 border-b gap-2">
            <div className="inline-flex p-1 bg-slate-200/50 rounded-xl gap-1">
              <button onClick={() => setTalkMode(TalkMode.CONTINUOUS)} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${talkMode === TalkMode.CONTINUOUS ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Continuous</button>
              <button onClick={() => setTalkMode(TalkMode.PTT)} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${talkMode === TalkMode.PTT ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Push to Talk</button>
            </div>
          </div>

          <div className="p-3 border-b flex items-center justify-around bg-slate-50/20">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">User</span>
              <Visualizer isActive={status === ConnectionStatus.CONNECTED && (talkMode === TalkMode.CONTINUOUS ? !isModelSpeaking : isPTTPressed)} color="bg-blue-500" />
            </div>
            <div className="w-px h-6 bg-slate-200" />
            <div className="flex flex-col items-center gap-1">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Gemini</span>
              <Visualizer isActive={isModelSpeaking} color="bg-purple-500" />
            </div>
          </div>

          <ChatHistory messages={messages.map(m => ({...m, timestamp: new Date(m.timestamp)}))} currentInput={currentInput} currentOutput={currentOutput} />

          {/* Interaction Area */}
          <div className="p-4 flex flex-col bg-white border-t gap-4">
            {status === ConnectionStatus.DISCONNECTED || status === ConnectionStatus.ERROR ? (
              <button 
                onClick={startConversation} 
                className="bg-blue-600 hover:bg-blue-700 text-white w-full py-4 rounded-2xl font-bold shadow-lg shadow-blue-100 transition-all active:scale-[0.98]"
              >
                {status === ConnectionStatus.ERROR ? 'Retry Connection' : 'Start Gemini Live'}
              </button>
            ) : (
              <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2">
                {/* Text input for non-vocal users */}
                <form onSubmit={handleSendText} className="flex gap-2">
                  <input 
                    type="text" 
                    value={textInput} 
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Type to chat..."
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all"
                  />
                  <button 
                    type="submit" 
                    className="p-2.5 bg-blue-600 text-white rounded-xl shadow-md disabled:opacity-30 disabled:shadow-none transition-all active:scale-90" 
                    disabled={!textInput.trim()}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </form>

                <div className="flex items-center justify-between w-full px-2">
                  <div className="flex-1 flex justify-center">
                    {talkMode === TalkMode.PTT ? (
                      <button 
                        onMouseDown={handlePTTDown} 
                        onMouseUp={handlePTTUp} 
                        onMouseLeave={handlePTTUp} 
                        onTouchStart={handlePTTDown} 
                        onTouchEnd={handlePTTUp} 
                        className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${isPTTPressed ? 'bg-blue-600 scale-110 shadow-xl shadow-blue-200 ring-4 ring-blue-50' : 'bg-white text-slate-400 border-2 border-slate-100 shadow-sm hover:border-blue-200'}`}
                      >
                        <svg className={`w-7 h-7 ${isPTTPressed ? 'text-white' : 'text-slate-400'}`} fill="currentColor" viewBox="0 0 20 20">
                          <path d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4z" />
                          <path d="M4 9a1 1 0 00-1 1v1a7 7 0 007 7h1v1a1 1 0 102 0v-1h1a7 7 0 007-7V10a1 1 0 10-2 0v1a5 5 0 01-10 0V10a1 1 0 00-1-1z" />
                        </svg>
                      </button>
                    ) : (
                      <div className="text-[10px] text-blue-500 font-black uppercase tracking-widest animate-pulse bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100">
                        Live Listening
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={stopConversation} 
                    className="text-[10px] font-bold text-slate-300 hover:text-red-500 uppercase tracking-widest transition-colors py-2 px-3 rounded-lg hover:bg-red-50"
                  >
                    End Session
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

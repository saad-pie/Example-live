
import React, { useEffect, useRef } from 'react';
import { Message } from '../types';

interface ChatHistoryProps {
  messages: Message[];
  currentInput: string;
  currentOutput: string;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({ messages, currentInput, currentOutput }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentInput, currentOutput]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 rounded-xl border border-slate-200/60">
      {messages.length === 0 && !currentInput && !currentOutput && (
        <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2">
          <svg className="w-12 h-12 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <p className="text-sm font-medium">Start talking to see the transcription here...</p>
        </div>
      )}

      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
        >
          <div
            className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
              msg.sender === 'user'
                ? 'bg-blue-600 text-white rounded-tr-none'
                : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'
            }`}
          >
            {msg.text}
          </div>
          <span className="text-[10px] text-slate-400 mt-1 px-1">
            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      ))}

      {currentInput && (
        <div className="flex flex-col items-end">
          <div className="max-w-[85%] px-4 py-2.5 rounded-2xl text-sm bg-blue-500/80 text-white rounded-tr-none animate-pulse">
            {currentInput}
          </div>
        </div>
      )}

      {currentOutput && (
        <div className="flex flex-col items-start">
          <div className="max-w-[85%] px-4 py-2.5 rounded-2xl text-sm bg-slate-200 text-slate-700 rounded-tl-none">
            {currentOutput}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};

export default ChatHistory;

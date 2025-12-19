
export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}

export enum TalkMode {
  CONTINUOUS = 'continuous',
  PTT = 'ptt'
}

export type GeminiVoice = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface Message {
  id: string;
  sender: 'user' | 'model';
  text: string;
  timestamp: string;
}

export interface TranscriptionState {
  currentInput: string;
  currentOutput: string;
  history: Message[];
}

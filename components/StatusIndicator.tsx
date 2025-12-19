
import React from 'react';
import { ConnectionStatus } from '../types';

interface StatusIndicatorProps {
  status: ConnectionStatus;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status }) => {
  const config = {
    [ConnectionStatus.DISCONNECTED]: { color: 'bg-slate-400', label: 'Disconnected' },
    [ConnectionStatus.CONNECTING]: { color: 'bg-yellow-400 animate-pulse', label: 'Connecting...' },
    [ConnectionStatus.CONNECTED]: { color: 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]', label: 'Live' },
    [ConnectionStatus.ERROR]: { color: 'bg-red-500', label: 'Connection Error' },
  };

  const { color, label } = config[status];

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 shadow-sm">
      <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="text-xs font-semibold text-slate-600 tracking-wide uppercase">{label}</span>
    </div>
  );
};

export default StatusIndicator;

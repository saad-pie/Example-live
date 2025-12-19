
import React, { useEffect, useState } from 'react';

interface VisualizerProps {
  isActive: boolean;
  color?: string;
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, color = 'bg-blue-500' }) => {
  const [bars, setBars] = useState<number[]>(new Array(12).fill(10));

  useEffect(() => {
    let interval: number;
    if (isActive) {
      interval = window.setInterval(() => {
        setBars(new Array(12).fill(0).map(() => Math.floor(Math.random() * 40) + 10));
      }, 100);
    } else {
      setBars(new Array(12).fill(10));
    }
    return () => clearInterval(interval);
  }, [isActive]);

  return (
    <div className="flex items-center justify-center gap-1 h-12 w-32">
      {bars.map((height, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-full transition-all duration-150 ${color}`}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
};

export default Visualizer;

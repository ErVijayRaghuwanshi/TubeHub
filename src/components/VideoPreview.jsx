import React from 'react';
import { Film, Clock } from 'lucide-react';

export default function VideoPreview({ currentVideo }) {
  if (!currentVideo) return null;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5 p-4 bg-white/[0.03] border border-white/10 rounded-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="relative w-full sm:w-40 h-24 flex-shrink-0 rounded-xl overflow-hidden shadow-lg border border-white/5 bg-slate-900">
        <img 
          src={currentVideo.thumbnail} 
          alt={currentVideo.title}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src = "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=300&q=80"; // fallback
          }}
        />
        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-slate-950/80 border border-white/10 rounded text-[10px] font-semibold text-slate-300 flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {currentVideo.duration}
        </div>
      </div>

      <div className="flex-1 text-center sm:text-left min-w-0 w-full">
        <div className="flex items-center justify-center sm:justify-start gap-2 text-xs font-semibold text-rose-400 mb-1">
          <Film className="w-3.5 h-3.5" />
          <span>Active Video</span>
        </div>
        <h3 className="font-bold text-white text-base leading-snug truncate" title={currentVideo.title}>
          {currentVideo.title}
        </h3>
        <p className="text-slate-500 text-xs mt-1 font-mono">
          ID: {currentVideo.id}
        </p>
      </div>
    </div>
  );
}

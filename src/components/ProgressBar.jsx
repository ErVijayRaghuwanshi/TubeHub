import React from 'react';
import { Loader2 } from 'lucide-react';

export default function ProgressBar({ progress, status, ext }) {
  const isVideo = ext === 'mp4';
  const formatName = isVideo ? 'MP4 video' : 'MP3 audio';

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="flex justify-between items-center text-sm">
        <span className="text-slate-300 flex items-center gap-2.5 font-medium">
          <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
          {status === 'validating' ? 'Analyzing link metadata...' : `Transcoding video to ${formatName}...`}
        </span>
        <span className="font-bold text-rose-400 font-mono text-base">{progress}%</span>
      </div>

      <div className="relative h-3.5 w-full bg-slate-950 border border-slate-800 rounded-full overflow-hidden p-0.5">
        {/* Growing track indicator */}
        <div 
          className="h-full bg-gradient-to-r from-red-600 via-rose-500 to-amber-500 rounded-full transition-all duration-300 ease-out relative shadow-[0_0_8px_rgba(239,68,68,0.3)]"
          style={{ width: `${progress}%` }}
        >
          {/* Pulsing light */}
          <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full" />
        </div>
      </div>
    </div>
  );
}

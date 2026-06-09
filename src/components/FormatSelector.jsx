import React, { useState } from 'react';
import { Music, Video, ArrowRight } from 'lucide-react';

export default function FormatSelector({ audioFormats, videoFormats, onSelect }) {
  const [activeTab, setActiveTab] = useState('audio'); // 'audio' or 'video'

  const getAudioBadge = (quality) => {
    if (quality === 320) return 'Ultra Quality';
    if (quality === 256) return 'High Quality';
    if (quality === 192) return 'Medium Quality';
    return 'Standard Quality';
  };

  const getVideoBadge = (quality) => {
    if (quality === 1080) return 'Full HD 1080p';
    if (quality === 720) return 'HD 720p';
    if (quality === 480) return 'SD 480p';
    return 'Mobile 360p';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="text-center sm:text-left">
        <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
          Choose Format & Quality
        </h4>
        <p className="text-xs text-slate-500 mt-1">
          Select your desired file layout and transcoding quality level.
        </p>
      </div>

      {/* Tab Selectors */}
      <div className="flex bg-slate-950/80 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => setActiveTab('audio')}
          className={`flex-1 py-3 rounded-lg flex items-center justify-center gap-2 text-xs sm:text-sm font-bold transition-all duration-300 cursor-pointer ${
            activeTab === 'audio'
              ? 'bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg shadow-red-500/10'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Music className="w-4 h-4" />
          Audio (MP3)
        </button>
        <button
          onClick={() => setActiveTab('video')}
          className={`flex-1 py-3 rounded-lg flex items-center justify-center gap-2 text-xs sm:text-sm font-bold transition-all duration-300 cursor-pointer ${
            activeTab === 'video'
              ? 'bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg shadow-red-500/10'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Video className="w-4 h-4" />
          Video (MP4)
        </button>
      </div>

      {/* Formats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {activeTab === 'audio'
          ? audioFormats.map((format) => (
              <button
                key={format.token}
                onClick={() => onSelect(format)}
                className="p-4 bg-white/[0.01] hover:bg-white/[0.04] border border-white/5 hover:border-red-500/30 rounded-2xl text-left transition-all duration-300 group cursor-pointer flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-extrabold text-white group-hover:text-rose-400 transition-colors">
                    {format.quality} kbps
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Format: {format.ext.toUpperCase()} • {getAudioBadge(format.quality)}
                  </p>
                </div>
                <div className="p-2 bg-white/5 border border-white/5 group-hover:bg-red-500/10 group-hover:border-red-500/20 group-hover:text-red-400 rounded-lg text-slate-400 transition-all duration-300">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>
            ))
          : videoFormats.map((format) => (
              <button
                key={format.token}
                onClick={() => onSelect(format)}
                className="p-4 bg-white/[0.01] hover:bg-white/[0.04] border border-white/5 hover:border-red-500/30 rounded-2xl text-left transition-all duration-300 group cursor-pointer flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-extrabold text-white group-hover:text-rose-400 transition-colors">
                    {format.quality}p
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Format: {format.ext.toUpperCase()} • {getVideoBadge(format.quality)}
                  </p>
                </div>
                <div className="p-2 bg-white/5 border border-white/5 group-hover:bg-red-500/10 group-hover:border-red-500/20 group-hover:text-red-400 rounded-lg text-slate-400 transition-all duration-300">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>
            ))}
      </div>
    </div>
  );
}

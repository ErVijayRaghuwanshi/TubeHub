import React, { useState } from 'react';
import { Trash2, Music, Video, Download, Play, Database, Loader2, Search, Library, Sparkles, RefreshCw } from 'lucide-react';

export default function ConversionHistory({ 
  history, 
  clearHistory, 
  onPlay, 
  onDeleteFromBrowser, 
  onSaveToBrowser,
  onDownloadLocal,
  onGoToConverter,
  savingIds = [],
  onDeleteHistoryItem,
  onReconvert,
  playbackProgress = {}
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all', 'audio', 'video', 'saved'

  // Filter history items based on search and selected filter type
  const filteredHistory = history.filter(item => {
    const matchesSearch = (item.title || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    if (filterType === 'audio') return matchesSearch && item.ext === 'mp3';
    if (filterType === 'video') return matchesSearch && item.ext === 'mp4';
    if (filterType === 'saved') return matchesSearch && item.savedInBrowser;
    return matchesSearch;
  });

  const totalSaved = history.filter(item => item.savedInBrowser).length;

  // Render empty state if there are no items in history
  if (history.length === 0) {
    return (
      <div className="max-w-4xl mx-auto w-full text-center py-16 px-4 bg-slate-900/10 border border-white/5 rounded-3xl space-y-6 backdrop-blur-xl animate-in fade-in duration-500">
        <div className="w-16 h-16 bg-white/5 border border-white/5 rounded-2xl flex items-center justify-center mx-auto text-slate-500">
          <Library className="w-8 h-8" />
        </div>
        <div className="space-y-1.5 max-w-sm mx-auto">
          <h3 className="text-lg font-bold text-white">Your Library is Empty</h3>
          <p className="text-slate-500 text-xs sm:text-sm">
            Convert links from YouTube to populate your personal media dashboard.
          </p>
        </div>
        <button
          onClick={onGoToConverter}
          className="px-6 py-3 bg-white hover:bg-slate-100 text-slate-950 font-bold rounded-xl text-sm transition-all cursor-pointer shadow-lg active:scale-95"
        >
          Open Converter
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto w-full animate-in fade-in duration-500 space-y-6">
      
      {/* Title & Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1">
        <div>
          <h3 className="text-lg font-extrabold flex items-center gap-2 text-white">
            <Library className="w-5 h-5 text-rose-500" />
            Media Dashboard
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {history.length} items parsed • <span className="text-green-400 font-semibold">{totalSaved} stored locally</span>
          </p>
        </div>
        
        <button 
          onClick={clearHistory}
          className="text-xs font-semibold text-slate-500 hover:text-red-400 flex items-center gap-1.5 transition-colors duration-300 px-3 py-2 bg-slate-900/50 hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 rounded-xl cursor-pointer self-start sm:self-auto"
        >
          <Trash2 className="w-3.5 h-3.5" /> Clear Dashboard
        </button>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-slate-900/20 border border-white/5 rounded-2xl p-4 space-y-4 backdrop-blur-xl">
        <div className="relative flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 focus-within:border-red-500/30 transition duration-300">
          <Search className="w-4 h-4 text-slate-500 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search saved tracks or videos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent border-0 text-white placeholder-slate-600 text-xs sm:text-sm py-2.5 pl-2.5 pr-2 focus:outline-none focus:ring-0"
          />
        </div>

        {/* Tab Filters */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'all', label: 'All Files' },
            { id: 'audio', label: 'Audio (MP3)' },
            { id: 'video', label: 'Video (MP4)' },
            { id: 'saved', label: 'Offline Saved' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 cursor-pointer ${
                filterType === tab.id
                  ? 'bg-white/10 text-white border border-white/10'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* YouTube Dashboard Card Grid */}
      {filteredHistory.length === 0 ? (
        <div className="text-center py-12 bg-slate-900/10 border border-white/5 rounded-2xl">
          <p className="text-slate-500 text-sm font-medium">No media matches your search query.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredHistory.map((item) => {
            const ext = item.ext || 'mp3';
            const quality = item.quality || '320';
            const isVideo = ext === 'mp4';
            const itemKey = `${item.id}-${quality}-${ext}`;
            const isSaving = savingIds.includes(itemKey);
            const thumbnailUrl = `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`;
            
            const progress = playbackProgress?.[itemKey];
            const progressPercent = progress ? progress.percentage : 0;

            return (
              <div 
                key={itemKey} 
                className="bg-slate-900/20 hover:bg-slate-900/40 border border-white/5 hover:border-red-500/15 rounded-3xl overflow-hidden flex flex-col justify-between transition-all duration-300 group shadow-lg hover:shadow-xl hover:scale-[1.02] relative"
              >
                
                {/* 16:9 Thumbnail Area with overlays */}
                <div 
                  onClick={() => onPlay(item)}
                  className="relative aspect-video w-full overflow-hidden bg-slate-950 cursor-pointer shadow-inner"
                >
                  <img 
                    src={thumbnailUrl} 
                    alt={item.title} 
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.className = "hidden";
                    }}
                  />
                  {/* Play Button Hover overlay */}
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="w-14 h-14 rounded-full bg-red-600 flex items-center justify-center text-white shadow-lg shadow-red-600/40 transform scale-90 group-hover:scale-100 transition duration-300">
                      <Play className="w-6 h-6 fill-current ml-0.5" />
                    </div>
                  </div>
                  
                  {/* Duration Badge */}
                  <div className="absolute bottom-3 right-3 px-2 py-0.5 bg-slate-950/80 border border-white/10 rounded-md text-[10px] font-bold text-slate-200 tracking-wider">
                    {item.duration}
                  </div>
                  
                  {/* Format/Quality Badge (Top Right) */}
                  <div className={`absolute top-3 right-3 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider shadow-md border ${
                    isVideo 
                      ? 'bg-amber-500/90 text-slate-950 border-amber-400/20' 
                      : 'bg-rose-500/90 text-white border-rose-400/20'
                  }`}>
                    {ext.toUpperCase()} • {quality}{ext === 'mp3' ? 'k' : 'p'}
                  </div>
                  
                  {/* Offline Badge overlay (Top Left) */}
                  {item.savedInBrowser && (
                    <div className="absolute top-3 left-3 px-2 py-0.5 bg-green-500/90 text-slate-950 rounded-md text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow-md">
                      <Sparkles className="w-2.5 h-2.5" /> Offline
                    </div>
                  )}

                  {/* Playback progress bar (like YouTube) */}
                  {progressPercent > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20 z-10">
                      <div 
                        className="bg-rose-500 h-full transition-all duration-300" 
                        style={{ width: `${progressPercent}%` }} 
                      />
                    </div>
                  )}
                </div>

                {/* Card Body Info */}
                <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                  <div className="flex gap-3.5 items-start">
                    {/* Format Avatar representing "Channel Logo" */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 shadow-inner border ${
                      isVideo 
                        ? 'bg-gradient-to-tr from-amber-600 to-orange-500 border-amber-500/20 text-white' 
                        : 'bg-gradient-to-tr from-rose-600 to-pink-500 border-rose-500/20 text-white'
                    }`}>
                      {isVideo ? (
                        <Video className="w-4.5 h-4.5" />
                      ) : (
                        <Music className="w-4.5 h-4.5" />
                      )}
                    </div>
                    
                    {/* Title & Channel details */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <h4 
                        onClick={() => onPlay(item)}
                        className="text-sm font-bold text-white leading-snug line-clamp-2 cursor-pointer hover:text-rose-400 transition-colors"
                        title={item.title}
                      >
                        {item.title}
                      </h4>
                      <div className="space-y-0.5">
                        <p className="text-xs text-slate-400 font-semibold">
                          TubeHub Media
                        </p>
                        <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1 font-medium">
                          <span>{item.downloadedAt}</span>
                          <span>•</span>
                          <span className={item.savedInBrowser ? "text-green-400" : "text-slate-500"}>
                            {item.savedInBrowser ? 'Saved Offline' : 'Cloud Link'}
                          </span>
                          {progressPercent > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-rose-400 font-semibold">
                                {progressPercent >= 100 ? 'Completed' : `${Math.round(progressPercent)}% played`}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Card Action Footer */}
                  <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-auto">
                    {/* Play button */}
                    <button
                      onClick={() => onPlay(item)}
                      className="px-4 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white border border-transparent rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold transition-all duration-300 shadow-md shadow-red-600/10 hover:shadow-red-600/25 active:scale-95 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      Play
                    </button>

                    {/* Download, Database & Delete actions */}
                    <div className="flex items-center gap-1.5">
                      {/* Re-convert button */}
                      <button
                        onClick={() => onReconvert(item)}
                        className="p-2.5 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-300 active:scale-95"
                        title="Convert to other format / quality"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>

                      {/* Download File System */}
                      {item.savedInBrowser ? (
                        <button
                          onClick={() => onDownloadLocal(item)}
                          className="p-2.5 text-green-400 hover:text-white bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-300 active:scale-95"
                          title="Download locally to PC"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <a 
                          href={item.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2.5 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-300 active:scale-95"
                          title="Download from CDN"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}

                      {/* Browser Storage Action */}
                      {isSaving ? (
                        <button
                          disabled
                          className="p-2.5 text-rose-400 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center"
                        >
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        </button>
                      ) : item.savedInBrowser ? (
                        <button
                          onClick={() => onDeleteFromBrowser(item)}
                          className="p-2.5 text-green-400 hover:text-red-400 hover:bg-red-500/10 border border-green-500/20 hover:border-red-500/25 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-300 active:scale-95"
                          title="Delete from browser storage"
                        >
                          <Database className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => onSaveToBrowser(item)}
                          className="p-2.5 text-slate-400 hover:text-white hover:bg-white/5 border border-white/5 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-300 active:scale-95"
                          title="Save to browser storage (offline)"
                        >
                          <Database className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Delete from library history entirely */}
                      <button
                        onClick={() => onDeleteHistoryItem(item)}
                        className="p-2.5 text-slate-500 hover:text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-300 active:scale-95"
                        title="Remove from Library history"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

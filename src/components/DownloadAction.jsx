import React from 'react';
import { CheckCircle, Download, Database, RotateCcw, Loader2 } from 'lucide-react';

export default function DownloadAction({ 
  downloadUrl, 
  handleDownload, 
  handleReset, 
  ext, 
  isSavingToBrowser, 
  isSavedToBrowser, 
  handleSaveToBrowser,
  saveError
}) {
  const isVideo = ext === 'mp4';
  const formatLabel = isVideo ? 'MP4 Video' : 'MP3 Audio';

  return (
    <div className="flex flex-col items-center justify-center py-6 px-4 space-y-8 text-center animate-in zoom-in-95 duration-300">
      
      {/* Icon Status Header */}
      <div className="relative">
        <div className="absolute -inset-2.5 bg-green-500/20 rounded-full blur-md animate-pulse" />
        <div className="relative w-16 h-16 bg-green-500/10 border border-green-500/30 rounded-full flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-green-400" />
        </div>
      </div>

      {/* Dynamic Success Texts */}
      <div className="space-y-1.5">
        <h3 className="text-xl font-extrabold text-white">Conversion Complete!</h3>
        <p className="text-slate-400 text-sm">
          Your high-quality <span className="text-white font-bold">{formatLabel}</span> is ready.
        </p>
      </div>

      {/* Browser Media Player */}
      <div className="w-full max-w-md bg-slate-950 p-4 border border-slate-800 rounded-2xl space-y-2.5 shadow-inner">
        <p className="text-[10px] font-bold text-slate-500 text-left uppercase tracking-wider">
          Browser Playback Preview
        </p>
        <div className="flex justify-center w-full">
          {isVideo ? (
            <video 
              src={downloadUrl} 
              controls 
              className="w-full rounded-xl border border-white/5 shadow-xl max-h-56 bg-black object-contain"
            />
          ) : (
            <audio 
              src={downloadUrl} 
              controls 
              className="w-full focus:outline-none"
            />
          )}
        </div>
      </div>
      
      {/* Actions Selector */}
      <div className="w-full max-w-sm flex flex-col gap-3">
        {/* Option 1: File System Download */}
        <a 
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleDownload}
          className="w-full py-4 bg-white hover:bg-slate-100 text-slate-950 font-extrabold rounded-xl transition-all duration-300 flex items-center justify-center gap-2.5 text-sm sm:text-base shadow-lg hover:shadow-white/5 active:scale-[0.98] cursor-pointer"
        >
          <Download className="w-4.5 h-4.5 text-slate-950" />
          Download to File System
        </a>

        {/* Option 2: Browser Local Storage Save */}
        <button
          onClick={handleSaveToBrowser}
          disabled={isSavingToBrowser || isSavedToBrowser}
          className={`w-full py-4 border font-extrabold rounded-xl transition-all duration-300 flex items-center justify-center gap-2.5 text-sm sm:text-base cursor-pointer ${
            isSavedToBrowser
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-slate-900 border-white/5 hover:bg-slate-800 hover:border-white/10 text-white disabled:opacity-50'
          }`}
        >
          {isSavingToBrowser ? (
            <>
              <Loader2 className="w-4.5 h-4.5 animate-spin text-rose-500" />
              Saving to Browser Storage...
            </>
          ) : isSavedToBrowser ? (
            <>
              <Database className="w-4.5 h-4.5 text-green-400" />
              Saved in Browser Storage!
            </>
          ) : (
            <>
              <Database className="w-4.5 h-4.5 text-slate-400" />
              Save to Browser Storage
            </>
          )}
        </button>

        {saveError && (
          <p className="text-red-400 text-xs mt-1 font-medium">{saveError}</p>
        )}
      </div>

      {/* Convert Another Video / Reset */}
      <button
        onClick={handleReset}
        className="text-xs font-semibold text-slate-500 hover:text-white flex items-center gap-1.5 transition-colors duration-200 px-4 py-2 hover:bg-white/5 rounded-lg border border-transparent hover:border-white/5 cursor-pointer mt-4"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Convert Another Video
      </button>
    </div>
  );
}

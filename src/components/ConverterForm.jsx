import React from 'react';
import { ArrowRight, Loader2, AlertCircle } from 'lucide-react';

export default function ConverterForm({ url, setUrl, status, handleConvert, errorMsg }) {
  const isLoading = status === 'validating' || status === 'converting';

  const handleSubmit = (e) => {
    e.preventDefault();
    handleConvert();
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto space-y-4">
      <div className="relative group">
        {/* Ambient glow backdrop */}
        <div className="absolute -inset-0.5 bg-gradient-to-r from-red-600 to-rose-600 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500 group-focus-within:opacity-60" />
        
        <div className="relative flex items-center bg-slate-950/80 border border-slate-800 rounded-2xl p-1.5 focus-within:border-red-500/50 transition-all duration-300">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isLoading}
            placeholder="Paste YouTube link (e.g., https://www.youtube.com/watch?v=...)"
            className="flex-1 bg-transparent border-0 text-white placeholder-slate-500 text-sm sm:text-base py-3.5 pl-4 pr-4 focus:outline-none focus:ring-0 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-semibold rounded-xl px-5 sm:px-6 py-3.5 transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-red-500/10 cursor-pointer"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span className="hidden sm:inline">Convert</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {status === 'error' && errorMsg && (
        <div className="flex items-start gap-3 text-red-400 bg-red-950/10 px-4.5 py-4 rounded-xl border border-red-500/25 animate-in fade-in slide-in-from-top-2 duration-300 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-300">Conversion Error</p>
            <p className="text-red-400/80 text-xs mt-0.5">{errorMsg}</p>
          </div>
        </div>
      )}
    </form>
  );
}

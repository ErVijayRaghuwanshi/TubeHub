import React from 'react';
import { Youtube, Library, Cpu } from 'lucide-react';

export default function Header({ activeTab, setActiveTab, libraryCount }) {
  return (
    <header className="border-b border-white/5 bg-slate-950/40 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3 group cursor-pointer" onClick={() => setActiveTab('converter')}>
          <div className="bg-gradient-to-tr from-red-600 to-rose-500 p-2.5 rounded-xl shadow-lg shadow-red-500/10 group-hover:scale-105 transition-transform duration-300">
            <Youtube className="w-5.5 h-5.5 text-white" />
          </div>
          <span className="text-xl font-extrabold tracking-tight text-white">
            Tube<span className="bg-gradient-to-r from-red-500 to-rose-400 bg-clip-text text-transparent font-black">Hub</span>
          </span>
        </div>
        
        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 bg-slate-900/60 p-1 border border-white/5 rounded-xl">
          <button
            onClick={() => setActiveTab('converter')}
            className={`px-4.5 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-2 transition-all duration-300 cursor-pointer ${
              activeTab === 'converter'
                ? 'bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg shadow-red-500/10'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Cpu className="w-4 h-4" />
            Converter
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={`px-4.5 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-2 transition-all duration-300 cursor-pointer relative ${
              activeTab === 'library'
                ? 'bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg shadow-red-500/10'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Library className="w-4 h-4" />
            My Library
            {libraryCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[9px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center border-2 border-slate-950 shadow-md">
                {libraryCount}
              </span>
            )}
          </button>
        </nav>
      </div>
    </header>
  );
}

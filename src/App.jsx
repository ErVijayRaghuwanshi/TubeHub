import React, { useState, useRef, useEffect } from 'react';
import { useYoutubeConverter } from './hooks/useYoutubeConverter';
import Header from './components/Header';
import ConverterForm from './components/ConverterForm';
import VideoPreview from './components/VideoPreview';
import ProgressBar from './components/ProgressBar';
import DownloadAction from './components/DownloadAction';
import ConversionHistory from './components/ConversionHistory';
import Footer from './components/Footer';
import TurnstileWidget from './components/TurnstileWidget';
import FormatSelector from './components/FormatSelector';
import { getMedia } from './services/db';
import { X, Volume2, Film, PictureInPicture } from 'lucide-react';

export default function App() {
  const {
    url,
    setUrl,
    status,
    progress,
    errorMsg,
    history,
    currentVideo,
    downloadUrl,
    turnstileToken,
    setTurnstileToken,
    audioFormats,
    videoFormats,
    selectedFormat,
    isSavingToBrowser,
    isSavedToBrowser,
    saveError,
    savingIds,
    handleConvert,
    handleStartConversion,
    handleDownload,
    handleSaveToBrowser,
    handleDeleteFromBrowser,
    handleSaveHistoryItemToBrowser,
    handleDownloadFromBrowser,
    handleReset,
    clearHistory,
    deleteHistoryItem
  } = useYoutubeConverter();

  // Active Playback Overlay State
  const [activePlayItem, setActivePlayItem] = useState(null); // { title, ext, src }
  const [activeTab, setActiveTab] = useState('converter'); // 'converter' or 'library'
  const [isPiPActive, setIsPiPActive] = useState(false);

  const showStatusPanel = status === 'validating' || status === 'parsed' || status === 'converting' || status === 'ready';

  // Resolves local IndexedDB blob URL or fallback streaming link to trigger browser playback
  const handlePlay = async (item) => {
    try {
      if (item.savedInBrowser) {
        const storageId = `${item.id}-${item.quality}-${item.ext}`;
        const blob = await getMedia(storageId);
        if (blob) {
          const localUrl = URL.createObjectURL(blob);
          setActivePlayItem({
            id: item.id,
            title: item.title,
            ext: item.ext,
            src: localUrl
          });
          return;
        }
      }
      
      // Fallback to remote streaming link
      setActivePlayItem({
        id: item.id,
        title: item.title,
        ext: item.ext,
        src: item.downloadUrl
      });
    } catch (err) {
      console.error('Browser playback initialization failed:', err);
      alert('Could not start playback. The link may have expired or is blocked.');
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'converter' && activePlayItem && activePlayItem.ext === 'mp4' && videoRef.current) {
      // Switch tab within the app: trigger PiP automatically using the click gesture
      videoRef.current.requestPictureInPicture().catch(err => {
        console.warn('Auto enter Picture-in-Picture on tab switch failed:', err);
      });
    } else if (tab === 'library' && document.pictureInPictureElement) {
      // Switch tab back to library: exit PiP automatically to restore modal
      document.exitPictureInPicture().catch(() => {});
    }
  };

  const handleReconvert = async (item) => {
    const ytUrl = `https://www.youtube.com/watch?v=${item.id}`;
    setUrl(ytUrl);
    handleTabChange('converter');
    handleConvert(ytUrl);
  };

  const videoRef = useRef(null);

  // Monitor video state to register Chrome Media Session handlers for auto-PiP & media keys
  useEffect(() => {
    if (!videoRef.current || !activePlayItem || activePlayItem.ext !== 'mp4') return;
    const videoElement = videoRef.current;

    if ('mediaSession' in navigator) {
      try {
        // Set metadata for OS media controller & Chrome Media Hub
        navigator.mediaSession.metadata = new MediaMetadata({
          title: activePlayItem.title,
          artist: 'TubeHub Media',
          artwork: [
            { 
              src: activePlayItem.id 
                ? `https://img.youtube.com/vi/${activePlayItem.id}/mqdefault.jpg` 
                : 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg', 
              sizes: '320x180', 
              type: 'image/jpeg' 
            }
          ]
        });

        // Register the Chrome-specific automatic Picture-in-Picture action handler
        navigator.mediaSession.setActionHandler('enterpictureinpicture', async () => {
          try {
            if (document.pictureInPictureElement !== videoElement) {
              await videoElement.requestPictureInPicture();
            }
          } catch (err) {
            console.error('MediaSession automatic Picture-in-Picture entry failed:', err);
          }
        });

        // Register hardware keys & floating window play/pause controls
        navigator.mediaSession.setActionHandler('play', () => {
          videoElement.play().catch(() => {});
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          videoElement.pause();
        });
      } catch (err) {
        console.warn('Failed to bind Media Session action handlers:', err);
      }
    }

    // Monitor document visibility to automatically close PiP when tab becomes visible
    const handleVisibilityChange = async () => {
      try {
        if (document.visibilityState === 'visible') {
          if (document.pictureInPictureElement === videoElement) {
            await document.exitPictureInPicture();
          }
        }
      } catch (err) {
        console.warn('Auto exit Picture-in-Picture failed:', err);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.setActionHandler('enterpictureinpicture', null);
          navigator.mediaSession.setActionHandler('play', null);
          navigator.mediaSession.setActionHandler('pause', null);
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.playbackState = 'none';
        } catch (e) {}
      }
    };
  }, [activePlayItem]);

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error('Manual Picture-in-Picture request failed:', err);
      alert('Picture-in-Picture mode could not be initialized in this browser session.');
    }
  };

  const handleLeavePiP = () => {
    setIsPiPActive(false);
    if (activeTab === 'converter') {
      closePlayer();
    }
  };

  const closePlayer = async () => {
    // Clean up active PiP window if playing
    if (document.pictureInPictureElement && document.pictureInPictureElement === videoRef.current) {
      try {
        await document.exitPictureInPicture();
      } catch (e) {}
    }
    
    setIsPiPActive(false);
    
    // Revoke object URL if local to prevent memory leaks
    if (activePlayItem && activePlayItem.src.startsWith('blob:')) {
      URL.revokeObjectURL(activePlayItem.src);
    }
    setActivePlayItem(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-rose-500/30 relative overflow-hidden flex flex-col justify-between">
      {/* Dynamic ambient glow backdrops */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[500px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-rose-950/15 via-slate-950 to-transparent pointer-events-none z-0" />
      <div className="absolute top-[20%] left-[10%] w-[350px] h-[350px] bg-red-900/5 rounded-full blur-[130px] pointer-events-none z-0" />
      <div className="absolute top-[40%] right-[15%] w-[300px] h-[300px] bg-rose-900/5 rounded-full blur-[110px] pointer-events-none z-0" />

      <div className="relative z-10 flex flex-col min-h-screen pb-24">
        <Header activeTab={activeTab} setActiveTab={handleTabChange} libraryCount={history.length} />

        <main className={`flex-1 w-full mx-auto px-4 sm:px-6 py-12 flex flex-col gap-12 justify-center transition-all duration-300 ${activeTab === 'library' ? 'max-w-6xl sm:max-w-7xl' : 'max-w-4xl'}`}>
          {activeTab === 'converter' ? (
            /* Main Converter Card */
            <div className="bg-slate-900/20 border border-white/5 rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden backdrop-blur-xl animate-in fade-in duration-300">
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/[0.01] to-transparent pointer-events-none" />
              
              <div className="relative z-10 space-y-10">
                {/* Header Titles */}
                <div className="text-center max-w-xl mx-auto space-y-3">
                  <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
                    YouTube Converter
                  </h1>
                  <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                    Extract high-quality audio and video files from YouTube in seconds. Completely free and secure.
                  </p>
                </div>

                {/* Input & Form Control */}
                <div className="space-y-6">
                  <ConverterForm 
                    url={url} 
                    setUrl={setUrl} 
                    status={status} 
                    handleConvert={handleConvert} 
                    errorMsg={errorMsg} 
                  />

                  {/* Cloudflare Turnstile Human Verification Widget */}
                  {(status === 'idle' || status === 'error') && (
                    <TurnstileWidget
                      onVerify={(token) => setTurnstileToken(token)}
                      onExpire={() => setTurnstileToken('')}
                      onError={(err) => {
                        console.error('Turnstile verification failed:', err);
                        setTurnstileToken('');
                      }}
                    />
                  )}

                  {/* Status Indicator Panel */}
                  {showStatusPanel && (
                    <div className="bg-slate-950/40 border border-white/5 rounded-2xl p-5 sm:p-6 space-y-6 backdrop-blur-md animate-in fade-in duration-300">
                      {/* Render active video information once retrieved */}
                      {currentVideo && <VideoPreview currentVideo={currentVideo} />}

                      {/* Step 1: Validating the link */}
                      {status === 'validating' && (
                        <ProgressBar progress={0} status={status} ext={selectedFormat?.ext} />
                      )}

                      {/* Step 2: Selecting format and quality */}
                      {status === 'parsed' && (
                        <FormatSelector
                          audioFormats={audioFormats}
                          videoFormats={videoFormats}
                          onSelect={handleStartConversion}
                        />
                      )}

                      {/* Step 3: Performing conversion */}
                      {status === 'converting' && (
                        <ProgressBar progress={progress} status={status} ext={selectedFormat?.ext} />
                      )}

                      {/* Step 4: Ready to download */}
                      {status === 'ready' && (
                        <DownloadAction 
                          downloadUrl={downloadUrl} 
                          handleDownload={handleDownload}
                          handleReset={handleReset}
                          ext={selectedFormat?.ext}
                          isSavingToBrowser={isSavingToBrowser}
                          isSavedToBrowser={isSavedToBrowser}
                          handleSaveToBrowser={handleSaveToBrowser}
                          saveError={saveError}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Downloads Dashboard */
            <div className="animate-in fade-in duration-300">
              <ConversionHistory 
                history={history} 
                clearHistory={clearHistory}
                onPlay={handlePlay}
                onDeleteFromBrowser={handleDeleteFromBrowser}
                onSaveToBrowser={handleSaveHistoryItemToBrowser}
                onDownloadLocal={handleDownloadFromBrowser}
                onGoToConverter={() => handleTabChange('converter')}
                savingIds={savingIds}
                onDeleteHistoryItem={deleteHistoryItem}
                onReconvert={handleReconvert}
              />
            </div>
          )}

          {/* Footer details */}
          <Footer />
        </main>
      </div>

      {/* --- IN-BROWSER AUDIO PLAYER (Bottom Docked) --- */}
      {activePlayItem && activePlayItem.ext === 'mp3' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-xl bg-slate-900/90 border border-white/10 p-4 rounded-2xl backdrop-blur-xl shadow-2xl flex items-center justify-between gap-4 animate-in slide-in-from-bottom-8 duration-300">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 flex-shrink-0 animate-pulse">
              <Volume2 className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate" title={activePlayItem.title}>
                {activePlayItem.title}
              </p>
              <p className="text-[10px] text-slate-500 font-semibold uppercase mt-0.5">
                Now Streaming (Audio)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <audio src={activePlayItem.src} controls autoPlay className="h-9 w-40 sm:w-56 focus:outline-none" />
            <button 
              onClick={closePlayer}
              className="p-1.5 hover:bg-white/5 border border-transparent hover:border-white/5 rounded-lg text-slate-400 hover:text-white transition-all duration-200 cursor-pointer"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      )}

      {/* --- IN-BROWSER VIDEO PLAYER (Centered Modal) --- */}
      {activePlayItem && activePlayItem.ext === 'mp4' && (
        <div className={`fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 transition-all duration-300 animate-in fade-in ${isPiPActive ? 'pointer-events-none opacity-0 invisible w-0 h-0 overflow-hidden' : 'duration-300'}`}>
          <div className="w-full max-w-5xl bg-slate-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center gap-2.5 min-w-0">
                <Film className="w-4.5 h-4.5 text-amber-400" />
                <span className="text-sm font-bold text-white truncate" title={activePlayItem.title}>
                  {activePlayItem.title}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={togglePiP}
                  className="p-2 hover:bg-white/5 border border-transparent hover:border-white/5 rounded-xl text-slate-400 hover:text-white transition-all duration-200 cursor-pointer"
                  title="Picture in Picture"
                >
                  <PictureInPicture className="w-4.5 h-4.5" />
                </button>
                <button 
                  onClick={closePlayer}
                  className="p-2 hover:bg-white/5 border border-transparent hover:border-white/5 rounded-xl text-slate-400 hover:text-white transition-all duration-200 cursor-pointer"
                  title="Close Player"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>
            </div>

            {/* Video container */}
            <div className="relative aspect-video bg-black flex items-center justify-center">
              <video 
                ref={videoRef}
                src={activePlayItem.src} 
                controls 
                autoPlay 
                autoPictureInPicture={true}
                onPlay={() => {
                  if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'playing';
                  }
                }}
                onPause={() => {
                  if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'paused';
                  }
                }}
                onEnterPictureInPicture={() => setIsPiPActive(true)}
                onLeavePictureInPicture={handleLeavePiP}
                onEnded={() => {
                  if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'none';
                  }
                  closePlayer();
                }}
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

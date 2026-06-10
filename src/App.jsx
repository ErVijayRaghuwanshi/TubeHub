import React, { useState, useRef, useEffect } from 'react';
import { useYoutubeConverter } from './hooks/useYoutubeConverter';
import Header from './components/Header';
import ConverterForm from './components/ConverterForm';
import VideoPreview from './components/VideoPreview';
import ProgressBar from './components/ProgressBar';
import DownloadAction from './components/DownloadAction';
import ConversionHistory from './components/ConversionHistory';
import Footer from './components/Footer';
import FormatSelector from './components/FormatSelector';
import { getMedia } from './services/db';
import { X, Volume2, Film, PictureInPicture, Play, Pause, Volume1, VolumeX, Music, SkipBack, SkipForward, Maximize, Minimize } from 'lucide-react';

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
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const stored = localStorage.getItem('tubehub_active_tab');
      return (stored === 'converter' || stored === 'library') ? stored : 'converter';
    } catch {
      return 'converter';
    }
  });
  const [isPiPActive, setIsPiPActive] = useState(false);

  // Custom Audio Player States
  const audioElRef = useRef(null);
  const [audioIsPlaying, setAudioIsPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioVolume, setAudioVolume] = useState(0.8);
  const [audioIsMuted, setAudioIsMuted] = useState(false);

  // Playback progress resume states
  const [playbackProgress, setPlaybackProgress] = useState(() => {
    try {
      const stored = localStorage.getItem('tubehub_playback_progress');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const lastProgressSaveRef = useRef({});
  const videoHasSeekedRef = useRef(false);

  // Custom Video Player States
  const videoContainerRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const [videoIsPlaying, setVideoIsPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoVolume, setVideoVolume] = useState(0.8);
  const [videoIsMuted, setVideoIsMuted] = useState(false);
  const [showVideoControls, setShowVideoControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDraggingVideoTimeline, setIsDraggingVideoTimeline] = useState(false);

  // Reset seek guard on active item changes
  useEffect(() => {
    videoHasSeekedRef.current = false;
  }, [activePlayItem]);

  const savePlaybackProgress = (item, currentTime, duration) => {
    if (!item || !duration || isNaN(duration)) return;
    
    const key = `${item.id}-${item.quality || '320'}-${item.ext}`;
    const now = Date.now();
    const lastSave = lastProgressSaveRef.current[key] || 0;
    
    // Save every 2 seconds, or if currentTime is 0, or at the end
    if (now - lastSave >= 2000 || currentTime === 0 || Math.abs(currentTime - duration) < 1) {
      lastProgressSaveRef.current[key] = now;
      
      try {
        const percentage = (currentTime / duration) * 100;
        const isCompleted = currentTime >= duration - 5 || percentage > 97;
        
        const updatedProgress = {
          currentTime: isCompleted ? 0 : currentTime,
          duration,
          percentage: isCompleted ? 100 : percentage,
          updatedAt: now
        };
        
        setPlaybackProgress(prev => {
          const newMap = {
            ...prev,
            [key]: updatedProgress
          };
          localStorage.setItem('tubehub_playback_progress', JSON.stringify(newMap));
          return newMap;
        });
      } catch (e) {
        console.error('Failed to save playback progress', e);
      }
    }
  };

  const clearPlaybackProgress = (item) => {
    if (!item) return;
    const key = `${item.id}-${item.quality || '320'}-${item.ext}`;
    try {
      setPlaybackProgress(prev => {
        const itemProgress = prev[key];
        const newMap = {
          ...prev,
          [key]: {
            currentTime: 0,
            duration: itemProgress ? itemProgress.duration : 0,
            percentage: 100,
            updatedAt: Date.now()
          }
        };
        localStorage.setItem('tubehub_playback_progress', JSON.stringify(newMap));
        return newMap;
      });
    } catch (e) {
      console.error('Failed to clear playback progress', e);
    }
  };

  const resumePlaybackPosition = (element, isAudio = false) => {
    if (!element || !activePlayItem || videoHasSeekedRef.current) return;
    
    const key = `${activePlayItem.id}-${activePlayItem.quality || '320'}-${activePlayItem.ext}`;
    const savedProgress = localStorage.getItem('tubehub_playback_progress');
    if (savedProgress) {
      try {
        const progressMap = JSON.parse(savedProgress);
        const itemProgress = progressMap[key];
        if (itemProgress && itemProgress.currentTime) {
          const duration = element.duration;
          if (duration && !isNaN(duration)) {
            const isNearEnd = itemProgress.currentTime >= duration - 5 || (itemProgress.percentage && itemProgress.percentage > 97);
            if (!isNearEnd) {
              element.currentTime = itemProgress.currentTime;
              if (isAudio) {
                setAudioCurrentTime(itemProgress.currentTime);
              }
            }
            videoHasSeekedRef.current = true;
          }
        }
      } catch (e) {
        console.error('Failed to restore playback progress', e);
      }
    }
  };

  const handleAudioPlayPause = () => {
    if (!audioElRef.current) return;
    if (audioIsPlaying) {
      audioElRef.current.pause();
    } else {
      audioElRef.current.play().catch(() => {});
    }
  };

  const handleAudioTimeUpdate = () => {
    if (!audioElRef.current) return;
    const currentTime = audioElRef.current.currentTime;
    setAudioCurrentTime(currentTime);
    if (activePlayItem) {
      savePlaybackProgress(activePlayItem, currentTime, audioElRef.current.duration);
    }
  };

  const handleAudioLoadedMetadata = () => {
    if (!audioElRef.current) return;
    setAudioDuration(audioElRef.current.duration);
    resumePlaybackPosition(audioElRef.current, true);
  };

  const handleAudioEnded = () => {
    setAudioIsPlaying(false);
    setAudioCurrentTime(0);
    if (activePlayItem) {
      clearPlaybackProgress(activePlayItem);
    }
  };

  const handleVideoTimeUpdate = () => {
    if (!videoRef.current || !activePlayItem || isDraggingVideoTimeline) return;
    const currentTime = videoRef.current.currentTime;
    setVideoCurrentTime(currentTime);
    savePlaybackProgress(activePlayItem, currentTime, videoRef.current.duration);
  };

  const handleVideoLoadedMetadata = () => {
    if (!videoRef.current) return;
    setVideoDuration(videoRef.current.duration);
    resumePlaybackPosition(videoRef.current, false);
  };

  const handleVideoCanPlay = () => {
    if (!videoRef.current) return;
    resumePlaybackPosition(videoRef.current, false);
  };

  const handleVideoEnded = () => {
    if (activePlayItem) {
      clearPlaybackProgress(activePlayItem);
    }
    if (hasNextVideo) {
      handleNextVideo();
    } else {
      if ('mediaSession' in navigator) {
        // eslint-disable-next-line
        navigator.mediaSession.playbackState = 'none';
      }
      closePlayer();
    }
  };

  const handleVideoPlayPause = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  };

  const seekVideo = (seekTime) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seekTime;
  };

  const handleVideoVolumeChange = (e) => {
    if (!videoRef.current) return;
    const newVolume = parseFloat(e.target.value);
    videoRef.current.volume = newVolume;
    setVideoVolume(newVolume);
    if (newVolume > 0) {
      setVideoIsMuted(false);
      videoRef.current.muted = false;
    }
  };

  const handleVideoToggleMute = () => {
    if (!videoRef.current) return;
    const newMuted = !videoIsMuted;
    videoRef.current.muted = newMuted;
    setVideoIsMuted(newMuted);
  };

  const toggleFullscreen = async () => {
    if (!videoContainerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await videoContainerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error('Fullscreen request failed:', err);
    }
  };

  const resetControlsTimeout = () => {
    setShowVideoControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowVideoControls(false);
      }
    }, 2500);
  };

  // Keyboard Shortcuts for Video Player
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (activePlayItem && activePlayItem.ext === 'mp4' && !isPiPActive) {
        if (e.code === 'Space') {
          e.preventDefault();
          handleVideoPlayPause();
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
          }
        } else if (e.code === 'ArrowRight') {
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 5);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activePlayItem, isPiPActive]);

  // Sync Fullscreen State Change (Escape key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Controls Auto-Hide Cleanup
  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Playlist Navigation
  const videoPlaylist = history.filter(item => item.ext === 'mp4');
  const currentVideoIndex = videoPlaylist.findIndex(item => item.id === activePlayItem?.id);
  const hasPrevVideo = currentVideoIndex > 0;
  const hasNextVideo = currentVideoIndex < videoPlaylist.length - 1;

  const handlePrevVideo = () => {
    if (currentVideoIndex > 0) {
      handlePlay(videoPlaylist[currentVideoIndex - 1]);
    }
  };

  const handleNextVideo = () => {
    if (currentVideoIndex < videoPlaylist.length - 1) {
      handlePlay(videoPlaylist[currentVideoIndex + 1]);
    }
  };

  const handleAudioSeek = (e) => {
    if (!audioElRef.current) return;
    const seekTime = parseFloat(e.target.value);
    audioElRef.current.currentTime = seekTime;
    setAudioCurrentTime(seekTime);
  };

  const handleAudioVolumeChange = (e) => {
    if (!audioElRef.current) return;
    const newVolume = parseFloat(e.target.value);
    audioElRef.current.volume = newVolume;
    setAudioVolume(newVolume);
    if (newVolume > 0) {
      setAudioIsMuted(false);
      audioElRef.current.muted = false;
    }
  };

  const handleAudioToggleMute = () => {
    if (!audioElRef.current) return;
    const newMuted = !audioIsMuted;
    audioElRef.current.muted = newMuted;
    setAudioIsMuted(newMuted);
  };

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds)) return '0:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const showStatusPanel = status === 'validating' || status === 'parsed' || status === 'converting' || status === 'ready';

  // Resolves local IndexedDB blob URL or fallback streaming link to trigger browser playback
  const handlePlay = async (item) => {
    // Reset custom audio states first to avoid duration flashes
    setAudioIsPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);

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
            quality: item.quality,
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
        quality: item.quality,
        src: item.downloadUrl
      });
    } catch (err) {
      console.error('Browser playback initialization failed:', err);
      alert('Could not start playback. The link may have expired or is blocked.');
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    try {
      localStorage.setItem('tubehub_active_tab', tab);
    } catch (e) {
      console.error('Failed to save active tab to localStorage', e);
    }
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
    
    // Pause custom audio if active
    if (audioElRef.current) {
      audioElRef.current.pause();
    }
    setAudioIsPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    
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
                playbackProgress={playbackProgress}
              />
            </div>
          )}

          {/* Footer details */}
          <Footer />
        </main>
      </div>

      {/* --- IN-BROWSER AUDIO PLAYER (Bottom Docked) --- */}
      {activePlayItem && activePlayItem.ext === 'mp3' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-2xl bg-slate-900/95 border border-white/10 p-4 rounded-3xl backdrop-blur-xl shadow-2xl flex flex-col sm:flex-row items-center gap-4 animate-in slide-in-from-bottom-8 duration-300">
          {/* Audio element (hidden controls) */}
          <audio 
            ref={audioElRef}
            src={activePlayItem.src}
            autoPlay
            onPlay={() => setAudioIsPlaying(true)}
            onPause={() => setAudioIsPlaying(false)}
            onTimeUpdate={handleAudioTimeUpdate}
            onLoadedMetadata={handleAudioLoadedMetadata}
            onEnded={handleAudioEnded}
          />

          {/* Left Block: Thumbnail/Icon & Title */}
          <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto sm:max-w-[30%] flex-1 sm:flex-none">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-600 to-pink-500 border border-rose-500/20 flex items-center justify-center text-white flex-shrink-0 ${audioIsPlaying ? 'animate-spin' : ''}`} style={{ animationDuration: '10s' }}>
              <Music className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate" title={activePlayItem.title}>
                {activePlayItem.title}
              </p>
              <p className="text-[10px] text-rose-400 font-semibold uppercase mt-0.5 tracking-wider">
                {audioIsPlaying ? 'Now Playing' : 'Paused'}
              </p>
            </div>
          </div>

          {/* Center Block: Controls & Progress */}
          <div className="flex flex-1 items-center gap-3 w-full min-w-0">
            {/* Play/Pause Button */}
            <button 
              onClick={handleAudioPlayPause}
              className="w-8 h-8 rounded-full bg-white text-slate-950 flex items-center justify-center hover:scale-105 active:scale-95 transition cursor-pointer flex-shrink-0"
            >
              {audioIsPlaying ? (
                <Pause className="w-4.5 h-4.5 fill-current" />
              ) : (
                <Play className="w-4.5 h-4.5 fill-current ml-0.5" />
              )}
            </button>

            {/* Time label: current */}
            <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">
              {formatTime(audioCurrentTime)}
            </span>

            {/* Progress Slider (Timeline) */}
            <input 
              type="range"
              min={0}
              max={audioDuration || 100}
              value={audioCurrentTime}
              onChange={handleAudioSeek}
              className="flex-1 min-w-0 w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500 focus:outline-none"
              style={{
                background: `linear-gradient(to right, #f43f5e 0%, #f43f5e ${audioDuration ? (audioCurrentTime / audioDuration) * 100 : 0}%, #1e293b ${audioDuration ? (audioCurrentTime / audioDuration) * 100 : 0}%, #1e293b 100%)`
              }}
            />

            {/* Time label: duration */}
            <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">
              {formatTime(audioDuration)}
            </span>
          </div>

          {/* Right Block: Volume & Close */}
          <div className="flex items-center gap-3 flex-shrink-0 justify-end w-full sm:w-auto">
            {/* Volume controls */}
            <div className="flex items-center gap-0.5 sm:gap-0 group/volume cursor-pointer">
              {/* Volume Slider Container: always visible on mobile, expandable on desktop */}
              <div className="w-16 opacity-100 sm:w-0 sm:opacity-0 sm:group-hover/volume:w-20 sm:group-hover/volume:opacity-100 transition-all duration-300 ease-in-out flex items-center overflow-hidden sm:pr-2">
                <input 
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={audioIsMuted ? 0 : audioVolume}
                  onChange={handleAudioVolumeChange}
                  className="w-16 sm:w-20 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500 focus:outline-none"
                  style={{
                    background: `linear-gradient(to right, #f43f5e 0%, #f43f5e ${(audioIsMuted ? 0 : audioVolume) * 100}%, #1e293b ${(audioIsMuted ? 0 : audioVolume) * 100}%, #1e293b 100%)`
                  }}
                />
              </div>

              <button 
                onClick={handleAudioToggleMute}
                className="text-slate-400 hover:text-white transition cursor-pointer p-1.5 hover:bg-white/5 rounded-lg flex-shrink-0"
              >
                {audioIsMuted || audioVolume === 0 ? (
                  <VolumeX className="w-4.5 h-4.5" />
                ) : audioVolume < 0.5 ? (
                  <Volume1 className="w-4.5 h-4.5" />
                ) : (
                  <Volume2 className="w-4.5 h-4.5" />
                )}
              </button>
            </div>

            {/* Separator */}
            <div className="w-[1px] h-4 bg-slate-800 hidden sm:block" />

            {/* Close button */}
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
            <div 
              ref={videoContainerRef}
              onMouseMove={resetControlsTimeout}
              onMouseLeave={() => videoIsPlaying && setShowVideoControls(false)}
              className="relative aspect-video bg-black flex items-center justify-center group select-none overflow-hidden"
            >
              <video 
                ref={videoRef}
                src={activePlayItem.src} 
                autoPlay 
                autoPictureInPicture={true}
                onClick={handleVideoPlayPause}
                onDoubleClick={toggleFullscreen}
                onPlay={() => {
                  setVideoIsPlaying(true);
                  if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'playing';
                  }
                  resetControlsTimeout();
                }}
                onPause={() => {
                  setVideoIsPlaying(false);
                  if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'paused';
                  }
                  setShowVideoControls(true);
                }}
                onLoadedMetadata={handleVideoLoadedMetadata}
                onTimeUpdate={handleVideoTimeUpdate}
                onCanPlay={handleVideoCanPlay}
                onEnterPictureInPicture={() => setIsPiPActive(true)}
                onLeavePictureInPicture={handleLeavePiP}
                onEnded={handleVideoEnded}
                className="w-full h-full object-contain cursor-pointer"
              />

              {/* Large center Play/Pause animation button */}
              <div 
                onClick={handleVideoPlayPause}
                className={`absolute inset-0 flex items-center justify-center bg-black/25 transition-opacity duration-300 cursor-pointer ${
                  showVideoControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
              >
                <div className="w-16 h-16 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white backdrop-blur-md shadow-lg transform active:scale-95 transition-all duration-300">
                  {videoIsPlaying ? (
                    <Pause className="w-7 h-7 fill-current" />
                  ) : (
                    <Play className="w-7 h-7 fill-current ml-1" />
                  )}
                </div>
              </div>

              {/* Bottom control bar overlay */}
              <div 
                className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 sm:p-6 flex flex-col gap-3 transition-opacity duration-300 z-20 ${
                  showVideoControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
              >
                {/* Progress bar timeline */}
                <div className="flex items-center gap-3 w-full">
                  <span className="text-[10px] font-mono text-slate-300 select-none">
                    {formatTime(videoCurrentTime)}
                  </span>
                  
                  <input 
                    type="range"
                    min={0}
                    max={videoDuration || 100}
                    value={videoCurrentTime}
                    onInput={(e) => {
                      setVideoCurrentTime(parseFloat(e.target.value));
                    }}
                    onChange={(e) => {
                      const seekTime = parseFloat(e.target.value);
                      seekVideo(seekTime);
                      savePlaybackProgress(activePlayItem, seekTime, videoDuration);
                      setIsDraggingVideoTimeline(false);
                    }}
                    onMouseDown={() => setIsDraggingVideoTimeline(true)}
                    onTouchStart={() => setIsDraggingVideoTimeline(true)}
                    className="flex-1 h-1.5 bg-white/20 hover:h-2 rounded-lg appearance-none cursor-pointer accent-rose-500 focus:outline-none transition-all duration-150"
                    style={{
                      background: `linear-gradient(to right, #f43f5e 0%, #f43f5e ${videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0}%, rgba(255,255,255,0.2) ${videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0}%, rgba(255,255,255,0.2) 100%)`
                    }}
                  />
                  
                  <span className="text-[10px] font-mono text-slate-300 select-none">
                    {formatTime(videoDuration)}
                  </span>
                </div>

                {/* Control buttons line */}
                <div className="flex items-center justify-between w-full">
                  {/* Left Controls: Prev, Play/Pause, Next, Volume */}
                  <div className="flex items-center gap-3">
                    {/* Previous Button */}
                    <button 
                      onClick={handlePrevVideo}
                      disabled={!hasPrevVideo}
                      className="p-1.5 text-slate-300 hover:text-white disabled:opacity-40 disabled:hover:text-slate-300 transition cursor-pointer"
                      title="Previous video"
                    >
                      <SkipBack className="w-5 h-5 fill-current" />
                    </button>

                    {/* Play/Pause Button */}
                    <button 
                      onClick={handleVideoPlayPause}
                      className="p-1.5 text-white hover:scale-110 active:scale-95 transition cursor-pointer"
                      title={videoIsPlaying ? "Pause" : "Play"}
                    >
                      {videoIsPlaying ? (
                        <Pause className="w-5 h-5 fill-current" />
                      ) : (
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      )}
                    </button>

                    {/* Next Button */}
                    <button 
                      onClick={handleNextVideo}
                      disabled={!hasNextVideo}
                      className="p-1.5 text-slate-300 hover:text-white disabled:opacity-40 disabled:hover:text-slate-300 transition cursor-pointer"
                      title="Next video"
                    >
                      <SkipForward className="w-5 h-5 fill-current" />
                    </button>

                    {/* Separator */}
                    <div className="w-[1px] h-4 bg-white/10 mx-1" />

                    {/* Volume Controls */}
                    <div className="flex items-center gap-1.5 group/volume">
                      <button 
                        onClick={handleVideoToggleMute}
                        className="text-slate-300 hover:text-white transition cursor-pointer"
                        title={videoIsMuted ? "Unmute" : "Mute"}
                      >
                        {videoIsMuted || videoVolume === 0 ? (
                          <VolumeX className="w-5 h-5" />
                        ) : videoVolume < 0.5 ? (
                          <Volume1 className="w-5 h-5" />
                        ) : (
                          <Volume2 className="w-5 h-5" />
                        )}
                      </button>
                      <input 
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={videoIsMuted ? 0 : videoVolume}
                        onChange={handleVideoVolumeChange}
                        className="w-16 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-rose-500 focus:outline-none transition-all duration-150"
                        style={{
                          background: `linear-gradient(to right, #f43f5e 0%, #f43f5e ${(videoIsMuted ? 0 : videoVolume) * 100}%, rgba(255,255,255,0.2) ${(videoIsMuted ? 0 : videoVolume) * 100}%, rgba(255,255,255,0.2) 100%)`
                        }}
                      />
                    </div>
                  </div>

                  {/* Right Controls: PiP, Fullscreen */}
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={togglePiP}
                      className="p-1.5 text-slate-300 hover:text-white transition cursor-pointer"
                      title="Picture-in-Picture"
                    >
                      <PictureInPicture className="w-5 h-5" />
                    </button>

                    <button 
                      onClick={toggleFullscreen}
                      className="p-1.5 text-slate-300 hover:text-white transition cursor-pointer"
                      title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                    >
                      {isFullscreen ? (
                        <Minimize className="w-5 h-5" />
                      ) : (
                        <Maximize className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useYoutubeConverter } from './hooks/useYoutubeConverter';
import { fetchTrending, searchVideos, fetchVideoDetails } from './services/youtube';
import { getMedia } from './services/db';
import { 
  X, Volume2, Film, PictureInPicture, Play, Pause, Volume1, VolumeX, 
  SkipBack, SkipForward, Maximize, Minimize, Search, Settings, Clock, 
  Download, ChevronDown, ChevronUp, Menu, Library
} from 'lucide-react';

// Sub-component to render offline thumbnails loaded from IndexedDB
function OfflineThumbnail({ storageId, fallbackId, className }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let url = null;
    async function loadThumb() {
      try {
        const blob = await getMedia(`${storageId}-thumbnail`);
        if (blob) {
          url = URL.createObjectURL(blob);
          setSrc(url);
        }
      } catch (err) {
        console.warn('Failed to load local thumbnail:', err);
      }
    }
    loadThumb();

    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [storageId]);

  const fallbackUrl = `https://img.youtube.com/vi/${fallbackId}/mqdefault.jpg`;
  return (
    <img 
      src={src || fallbackUrl} 
      alt="Video Thumbnail" 
      className={className} 
      loading="lazy"
    />
  );
}

export default function App() {
  const {
    history,
    progress,
    status,
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
    downloadUrl,
    clearHistory,
    deleteHistoryItem
  } = useYoutubeConverter();

  // Custom Router State: Home, Watch, Library, Settings, History
  const [route, setRoute] = useState(() => {
    const path = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);
    const v = searchParams.get('v');
    if (path === '/watch' && v) {
      return { name: 'watch', videoId: v };
    }
    if (path === '/library') return { name: 'library' };
    if (path === '/history') return { name: 'history' };
    if (path === '/settings') return { name: 'settings' };
    return { name: 'home', query: searchParams.get('q') || '' };
  });

  const [searchQuery, setSearchQuery] = useState(route.query || '');

  const navigate = (pageName, params = {}) => {
    let path = '/';
    let search = '';
    if (pageName === 'watch' && params.v) {
      path = '/watch';
      search = `?v=${params.v}`;
    } else if (pageName === 'library') {
      path = '/library';
    } else if (pageName === 'history') {
      path = '/history';
    } else if (pageName === 'settings') {
      path = '/settings';
    } else if (pageName === 'home') {
      path = '/';
      if (params.q) search = `?q=${encodeURIComponent(params.q)}`;
      setSearchQuery(params.q || '');
    }
    
    window.history.pushState({}, '', `${path}${search}`);
    setRoute({ name: pageName, ...params });
  };

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      const searchParams = new URLSearchParams(window.location.search);
      const v = searchParams.get('v');
      if (path === '/watch' && v) {
        setRoute({ name: 'watch', videoId: v });
      } else if (path === '/library') {
        setRoute({ name: 'library' });
      } else if (path === '/history') {
        setRoute({ name: 'history' });
      } else if (path === '/settings') {
        setRoute({ name: 'settings' });
      } else {
        const q = searchParams.get('q') || '';
        setSearchQuery(q);
        setRoute({ name: 'home', query: q });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // UI layout and search states
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [feedVideos, setFeedVideos] = useState([]);
  const [feedPageToken, setFeedPageToken] = useState('');
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [activeCategory, setActiveCategory] = useState('');

  // Watch page state
  const [watchDetails, setWatchDetails] = useState(null);
  const [watchLoading, setWatchLoading] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);

  // Playback States
  const [activePlayItem, setActivePlayItem] = useState(null); // { title, ext, src, id }

  // Custom Video Player States
  const videoRef = useRef(null);
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

  // Custom Local API Key settings
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem('yt-api-key') || '');

  // YouTube popular categories list
  const categories = [
    { id: '', name: 'All' },
    { id: '10', name: 'Music' },
    { id: '20', name: 'Gaming' },
    { id: '17', name: 'Sports' },
    { id: '24', name: 'Entertainment' },
    { id: '28', name: 'Science & Tech' },
    { id: '25', name: 'News' }
  ];

  // Helper to format duration string (e.g. PT4M13S to 4:13)
  const formatISO8601Duration = (isoDuration) => {
    if (!isoDuration) return '';
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return '';
    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Helper to format view numbers (e.g. 1000000 to 1M views)
  const formatViewCount = (count) => {
    const num = parseInt(count);
    if (isNaN(num)) return '0 views';
    if (num >= 1e9) return `${(num / 1e9).toFixed(1).replace(/\.0$/, '')}B views`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(1).replace(/\.0$/, '')}M views`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(0)}K views`;
    return `${num} views`;
  };

  // Helper to format upload times relatively
  const getRelativeTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHrs = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHrs / 24);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffYears > 0) return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
    if (diffMonths > 0) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHrs > 0) return `${diffHrs} hour${diffHrs > 1 ? 's' : ''} ago`;
    if (diffMin > 0) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
    return 'Just now';
  };

  // Fetch Home Feed (Trending or Search)
  const loadFeed = useCallback(async (replace = true, pageToken = '') => {
    setFeedLoading(true);
    setFeedError('');
    try {
      let data;
      if (route.name === 'home' && route.query) {
        data = await searchVideos(route.query, pageToken);
      } else {
        data = await fetchTrending(pageToken, activeCategory);
      }

      const items = data.items || [];
      if (replace) {
        setFeedVideos(items);
      } else {
        setFeedVideos(prev => [...prev, ...items]);
      }
      setFeedPageToken(data.nextPageToken || '');
    } catch (err) {
      console.error(err);
      setFeedError(err.message || 'Error loading feed items.');
    } finally {
      setFeedLoading(false);
    }
  }, [route.name, route.query, activeCategory]);

  useEffect(() => {
    if (route.name === 'home') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadFeed(true);
    }
  }, [route.name, loadFeed]);

  // Handle watch details and streaming source resolve
  const loadWatchDetails = useCallback(async (videoId) => {
    setWatchLoading(true);
    setWatchDetails(null);
    
    // Auto initiate conversion fetching to resolve MP3/MP4 conversion download option formats
    handleConvert(videoId);

    try {
      // 1. Fetch metadata
      const details = await fetchVideoDetails(videoId).catch(() => null);

      if (details) {
        setWatchDetails(details);
      }

      // 2. Determine if video exists offline in browser IndexedDB
      let offlineBlob = null;
      let offlineItem = null;

      // Check offline formats
      for (const item of history) {
        if (item.id === videoId && item.savedInBrowser) {
          const storageId = `${item.id}-${item.quality}-${item.ext}`;
          const blob = await getMedia(storageId).catch(() => null);
          if (blob) {
            offlineBlob = blob;
            offlineItem = item;
            break;
          }
        }
      }

      // 3. Resolve stream URL
      if (offlineBlob && offlineItem) {
        console.log('Resolving watch player to local IndexedDB blob URL.');
        const localUrl = URL.createObjectURL(offlineBlob);
        setActivePlayItem({
          title: offlineItem.title,
          ext: offlineItem.ext,
          src: localUrl,
          id: videoId,
          isOffline: true
        });
      } else {
        console.log('Resolving watch player to privacy-first backend stream proxy.');
        setActivePlayItem({
          title: details?.snippet?.title || 'Streaming Video',
          ext: 'mp4',
          src: `/api/v5/stream/${videoId}`,
          id: videoId,
          isOffline: false
        });
      }

    } catch (err) {
      console.error('Watch loading failed:', err);
    } finally {
      setWatchLoading(false);
    }
  }, [history, handleConvert]);

  useEffect(() => {
    if (route.name === 'watch') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadWatchDetails(route.videoId);
    } else {
      // Clean up active playback item on navigating away
      if (activePlayItem && activePlayItem.src.startsWith('blob:')) {
        URL.revokeObjectURL(activePlayItem.src);
      }
      setActivePlayItem(null);
      setVideoIsPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name, route.videoId]);


  // Autoplay next video implementation
  const playNextVideo = () => {
    if (feedVideos.length === 0) return;
    const currentIndex = feedVideos.findIndex(v => v.id === route.videoId);
    const nextIndex = currentIndex !== -1 ? currentIndex + 1 : 0;
    
    if (nextIndex < feedVideos.length) {
      const nextVideo = feedVideos[nextIndex];
      navigate('watch', { v: nextVideo.id });
    }
  };

  // API Key local save
  const handleSaveApiKey = (e) => {
    e.preventDefault();
    localStorage.setItem('yt-api-key', apiKeyInput);
    alert('API Key updated successfully! Reloading feed...');
    navigate('home');
  };

  const handleClearApiKey = () => {
    localStorage.removeItem('yt-api-key');
    setApiKeyInput('');
    alert('API Key cleared. Falling back to backend server key.');
    navigate('home');
  };

  // ----------------------------------------------------
  // Custom Media Player Control Functions
  // ----------------------------------------------------

  const resetControlsTimeout = () => {
    setShowVideoControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (videoIsPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowVideoControls(false);
      }, 2500);
    }
  };

  const handleVideoPlayPause = () => {
    if (!videoRef.current) return;
    if (videoIsPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => {});
    }
    resetControlsTimeout();
  };

  const handleVideoTimeUpdate = () => {
    if (!videoRef.current || isDraggingVideoTimeline) return;
    setVideoCurrentTime(videoRef.current.currentTime);
  };

  const handleVideoLoadedMetadata = () => {
    if (!videoRef.current) return;
    setVideoDuration(videoRef.current.duration);
    resetControlsTimeout();
  };

  const seekVideo = (time) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = time;
    setVideoCurrentTime(time);
    resetControlsTimeout();
  };

  const handleVolumeChange = (vol) => {
    if (!videoRef.current) return;
    videoRef.current.volume = vol;
    setVideoVolume(vol);
    setVideoIsMuted(vol === 0);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const muted = !videoIsMuted;
    videoRef.current.muted = muted;
    setVideoIsMuted(muted);
    if (!muted && videoVolume === 0) {
      handleVolumeChange(0.5);
    }
  };

  const toggleFullscreen = () => {
    if (!videoContainerRef.current) return;
    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(err => console.error(err));
    } else {
      document.exitFullscreen()
        .then(() => setIsFullscreen(false));
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('Picture in Picture failed:', err);
    }
  };

  const handleVideoEnded = () => {
    setVideoIsPlaying(false);
    if (autoplayEnabled) {
      console.log('Video ended. Autoplaying next video...');
      playNextVideo();
    }
  };

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds)) return '0:00';
    const mins = Math.floor(timeInSeconds / 60);
    const secs = Math.floor(timeInSeconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-slate-100 flex flex-col font-sans antialiased selection:bg-rose-600/35 selection:text-white">
      {/* --- HEADER --- */}
      <header className="sticky top-0 z-40 bg-[#0f0f0f]/90 backdrop-blur-md border-b border-white/5 px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-white/5 rounded-full text-slate-300 hover:text-white cursor-pointer active:scale-95 transition-all"
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <div 
            onClick={() => navigate('home')} 
            className="flex items-center gap-1.5 cursor-pointer font-bold text-white tracking-tight active:opacity-90 select-none"
          >
            <Film className="w-6 h-6 text-rose-500 fill-current" />
            <span>TubeHub</span>
            <span className="text-[10px] bg-rose-500/10 text-rose-400 font-semibold px-1.5 py-0.5 rounded-full ml-1 border border-rose-500/10">v5</span>
          </div>
        </div>

        {/* Search Form */}
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            if (searchQuery.trim()) navigate('home', { q: searchQuery.trim() });
          }}
          className="flex items-center w-full max-w-xl bg-[#121212] border border-white/10 rounded-full overflow-hidden shadow-inner focus-within:border-rose-500/50 transition-all"
        >
          <input 
            type="text"
            placeholder="Search privacy-first TubeHub..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent px-4 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button 
            type="submit"
            className="px-5 bg-white/5 hover:bg-white/10 border-l border-white/10 text-slate-400 hover:text-white py-1.5 transition-colors cursor-pointer"
          >
            <Search className="w-4 h-4" />
          </button>
        </form>

        <div className="flex items-center gap-1.5">
          <button 
            onClick={() => navigate('settings')}
            className="p-2 hover:bg-white/5 rounded-full text-slate-300 hover:text-white cursor-pointer transition"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* --- BODY --- */}
      <div className="flex flex-1 relative">
        {/* --- SIDEBAR --- */}
        <aside className={`sticky top-14 h-[calc(100vh-3.5rem)] bg-[#0f0f0f] border-r border-white/5 transition-all duration-300 flex flex-col z-30 shrink-0 ${
          sidebarOpen ? 'w-56 p-2' : 'w-16 p-1 items-center'
        }`}>
          <div className="flex flex-col gap-1.5 w-full">
            <button 
              onClick={() => navigate('home')}
              className={`flex items-center rounded-xl transition cursor-pointer select-none ${
                sidebarOpen ? 'px-4 py-2.5 gap-4 w-full' : 'p-3 justify-center'
              } ${route.name === 'home' ? 'bg-white/10 text-white font-semibold' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <Film className="w-5 h-5" />
              {sidebarOpen && <span className="text-sm">Home</span>}
            </button>

            <button 
              onClick={() => navigate('library')}
              className={`flex items-center rounded-xl transition cursor-pointer select-none ${
                sidebarOpen ? 'px-4 py-2.5 gap-4 w-full' : 'p-3 justify-center'
              } ${route.name === 'library' ? 'bg-white/10 text-white font-semibold' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <Library className="w-5 h-5" />
              {sidebarOpen && <span className="text-sm">Offline Library</span>}
            </button>

            <button 
              onClick={() => navigate('history')}
              className={`flex items-center rounded-xl transition cursor-pointer select-none ${
                sidebarOpen ? 'px-4 py-2.5 gap-4 w-full' : 'p-3 justify-center'
              } ${route.name === 'history' ? 'bg-white/10 text-white font-semibold' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <Clock className="w-5 h-5" />
              {sidebarOpen && <span className="text-sm">History</span>}
            </button>

            <button 
              onClick={() => navigate('settings')}
              className={`flex items-center rounded-xl transition cursor-pointer select-none ${
                sidebarOpen ? 'px-4 py-2.5 gap-4 w-full' : 'p-3 justify-center'
              } ${route.name === 'settings' ? 'bg-white/10 text-white font-semibold' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <Settings className="w-5 h-5" />
              {sidebarOpen && <span className="text-sm">Settings</span>}
            </button>
          </div>
        </aside>

        {/* --- MAIN CONTENT WINDOW --- */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 overflow-y-auto max-h-[calc(100vh-3.5rem)]">
          {/* ====================================================
              ROUTE: HOME / SEARCH
              ==================================================== */}
          {route.name === 'home' && (
            <div className="flex flex-col gap-6">
              {/* Category Pills (Only on trending page) */}
              {!route.query && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin select-none">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition cursor-pointer ${
                        activeCategory === cat.id 
                          ? 'bg-white text-[#0f0f0f]' 
                          : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Error state */}
              {feedError && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl flex items-center gap-3">
                  <X className="w-5 h-5 shrink-0" />
                  <span className="text-sm">{feedError}</span>
                </div>
              )}

              {/* Videos Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
                {feedVideos.map((video) => (
                  <div 
                    key={video.id} 
                    onClick={() => navigate('watch', { v: video.id })}
                    className="flex flex-col gap-2.5 group cursor-pointer"
                  >
                    {/* Thumbnail box */}
                    <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-white/5 shadow-md">
                      <img 
                        src={video.snippet?.thumbnails?.medium?.url || 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg'} 
                        alt={video.snippet?.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                      {/* Duration Overlay */}
                      {video.contentDetails?.duration && (
                        <div className="absolute bottom-2 right-2 bg-black/85 text-[10px] font-bold text-white px-1.5 py-0.5 rounded font-mono select-none">
                          {formatISO8601Duration(video.contentDetails.duration)}
                        </div>
                      )}
                    </div>

                    {/* Metadata details */}
                    <div className="flex gap-3 px-1">
                      {/* Mock User Avatar */}
                      <div className="w-9 h-9 rounded-full bg-rose-500/15 border border-rose-500/10 text-rose-400 flex items-center justify-center font-bold text-sm shrink-0">
                        {video.snippet?.channelTitle?.charAt(0) || 'Y'}
                      </div>
                      
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold text-white leading-tight line-clamp-2 group-hover:text-rose-400 transition-colors" title={video.snippet?.title}>
                          {video.snippet?.title}
                        </span>
                        
                        <span className="text-xs text-slate-400 mt-1 hover:text-white transition-colors truncate">
                          {video.snippet?.channelTitle}
                        </span>
                        
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5 select-none">
                          <span>{formatViewCount(video.statistics?.viewCount)}</span>
                          <span>•</span>
                          <span>{getRelativeTime(video.snippet?.publishedAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Load More Trigger */}
              {feedVideos.length > 0 && !feedLoading && (
                <div className="flex justify-center mt-6">
                  <button
                    onClick={() => loadFeed(false, feedPageToken)}
                    className="px-6 py-2.5 border border-white/10 hover:bg-white/5 rounded-full text-sm font-semibold transition cursor-pointer active:scale-95"
                  >
                    Show More Videos
                  </button>
                </div>
              )}

              {/* Loader Grid */}
              {feedLoading && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 animate-pulse mt-4">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="flex flex-col gap-3">
                      <div className="aspect-video bg-white/5 rounded-xl" />
                      <div className="flex gap-3">
                        <div className="w-9 h-9 rounded-full bg-white/5 shrink-0" />
                        <div className="flex-1 flex flex-col gap-2">
                          <div className="h-4 bg-white/5 rounded w-11/12" />
                          <div className="h-3 bg-white/5 rounded w-3/4" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ====================================================
              ROUTE: WATCH PAGE (`/watch?v=videoId`)
              ==================================================== */}
          {route.name === 'watch' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: Player & Comments */}
              <div className="lg:col-span-2 flex flex-col gap-4">
                {/* Embed custom video player */}
                {activePlayItem && (
                  <div 
                    ref={videoContainerRef}
                    onMouseMove={resetControlsTimeout}
                    onMouseLeave={() => videoIsPlaying && setShowVideoControls(false)}
                    className="relative aspect-video bg-black rounded-2xl overflow-hidden group select-none shadow-2xl border border-white/5 z-10"
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
                        resetControlsTimeout();
                      }}
                      onPause={() => {
                        setVideoIsPlaying(false);
                        setShowVideoControls(true);
                      }}
                      onLoadedMetadata={handleVideoLoadedMetadata}
                      onTimeUpdate={handleVideoTimeUpdate}
                      onEnded={handleVideoEnded}
                      className="w-full h-full object-contain cursor-pointer"
                    />

                    {/* Play/Pause Overlay animation button */}
                    <div 
                      onClick={handleVideoPlayPause}
                      className={`absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity duration-300 cursor-pointer ${
                        showVideoControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                      }`}
                    >
                      <div className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white backdrop-blur-md shadow-lg transform active:scale-95 transition-all duration-300">
                        {videoIsPlaying ? (
                          <Pause className="w-6 h-6 fill-current" />
                        ) : (
                          <Play className="w-6 h-6 fill-current ml-1" />
                        )}
                      </div>
                    </div>

                    {/* Bottom controls bar */}
                    <div 
                      className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-4 flex flex-col gap-2 transition-opacity duration-300 z-20 ${
                        showVideoControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                      }`}
                    >
                      {/* Progress scrubbing timeline */}
                      <div className="flex items-center gap-2.5 w-full">
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
                            setIsDraggingVideoTimeline(false);
                          }}
                          onMouseDown={() => setIsDraggingVideoTimeline(true)}
                          className="flex-1 h-1 bg-white/20 hover:h-1.5 rounded-lg appearance-none cursor-pointer accent-rose-500 focus:outline-none transition-all"
                          style={{
                            background: `linear-gradient(to right, #f43f5e 0%, #f43f5e ${videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0}%, rgba(255,255,255,0.2) ${videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0}%, rgba(255,255,255,0.2) 100%)`
                          }}
                        />
                        
                        <span className="text-[10px] font-mono text-slate-300 select-none">
                          {formatTime(videoDuration)}
                        </span>
                      </div>

                      {/* Controls line */}
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={handleVideoPlayPause}
                            className="text-white p-1 hover:scale-105 cursor-pointer"
                          >
                            {videoIsPlaying ? (
                              <Pause className="w-5 h-5 fill-current" />
                            ) : (
                              <Play className="w-5 h-5 fill-current" />
                            )}
                          </button>

                          {/* Skip buttons */}
                          <button 
                            onClick={() => seekVideo(Math.max(videoCurrentTime - 10, 0))}
                            className="text-slate-300 hover:text-white p-1 cursor-pointer"
                            title="Rewind 10s"
                          >
                            <SkipBack className="w-4.5 h-4.5" />
                          </button>
                          <button 
                            onClick={() => seekVideo(Math.min(videoCurrentTime + 10, videoDuration))}
                            className="text-slate-300 hover:text-white p-1 cursor-pointer"
                            title="Fast Forward 10s"
                          >
                            <SkipForward className="w-4.5 h-4.5" />
                          </button>

                          {/* Volume controls */}
                          <div className="flex items-center gap-2 group-volume">
                            <button 
                              onClick={toggleMute}
                              className="text-slate-300 hover:text-white p-1 cursor-pointer"
                            >
                              {videoIsMuted ? (
                                <VolumeX className="w-5 h-5" />
                              ) : videoVolume > 0.5 ? (
                                <Volume2 className="w-5 h-5" />
                              ) : (
                                <Volume1 className="w-5 h-5" />
                              )}
                            </button>
                            <input 
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={videoIsMuted ? 0 : videoVolume}
                              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                              className="w-16 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-rose-500"
                            />
                          </div>
                        </div>

                        {/* Right side controls: PiP, Fullscreen */}
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={togglePiP}
                            className="text-slate-300 hover:text-white p-1 cursor-pointer"
                            title="Picture-in-Picture"
                          >
                            <PictureInPicture className="w-4.5 h-4.5" />
                          </button>
                          <button 
                            onClick={toggleFullscreen}
                            className="text-slate-300 hover:text-white p-1 cursor-pointer"
                            title="Fullscreen"
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
                )}

                {/* Video Info details block */}
                {watchLoading && (
                  <div className="flex flex-col gap-3 animate-pulse p-2">
                    <div className="h-6 bg-white/5 rounded w-3/4" />
                    <div className="h-4 bg-white/5 rounded w-1/4" />
                  </div>
                )}

                {watchDetails && (
                  <div className="flex flex-col gap-3">
                    <h1 className="text-lg font-bold text-white leading-tight">
                      {watchDetails.snippet?.title}
                    </h1>

                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
                      {/* Channel profile */}
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-rose-500/15 text-rose-400 font-bold border border-rose-500/10 flex items-center justify-center select-none">
                          {watchDetails.snippet?.channelTitle?.charAt(0)}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-bold text-white truncate">
                            {watchDetails.snippet?.channelTitle}
                          </span>
                          <span className="text-[10px] text-slate-500 select-none">
                            Privacy-First Stream Proxy
                          </span>
                        </div>
                      </div>

                      {/* Video actions */}
                      <div className="flex items-center gap-2">
                        {/* Autoplay toggler */}
                        <button
                          onClick={() => setAutoplayEnabled(!autoplayEnabled)}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition cursor-pointer ${
                            autoplayEnabled 
                              ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' 
                              : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                          }`}
                        >
                          <span>Autoplay</span>
                          <span className="text-[10px] px-1 bg-white/10 rounded">{autoplayEnabled ? 'ON' : 'OFF'}</span>
                        </button>

                        {/* Format selector for offline conversion */}
                        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
                          <span className="text-[10px] text-slate-400 pl-1 font-semibold">Format:</span>
                          <select 
                            value={selectedFormat?.token || ''}
                            onChange={(e) => {
                              const token = e.target.value;
                              const matches = [...videoFormats, ...audioFormats];
                              const found = matches.find(f => f.token === token);
                              if (found) handleStartConversion(found);
                            }}
                            className="bg-transparent text-xs font-semibold text-slate-200 py-1 focus:outline-none cursor-pointer"
                          >
                            <option value="" disabled>Select conversion quality...</option>
                            <optgroup label="Video (MP4)">
                              {videoFormats.map((f) => (
                                <option key={f.token} value={f.token}>{f.quality}p (.mp4)</option>
                              ))}
                            </optgroup>
                            <optgroup label="Audio (MP3)">
                              {audioFormats.map((f) => (
                                <option key={f.token} value={f.token}>{f.quality}kbps (.mp3)</option>
                              ))}
                            </optgroup>
                          </select>
                        </div>

                        {/* Download offline action */}
                        {selectedFormat && (
                          <button
                            onClick={handleSaveToBrowser}
                            disabled={isSavingToBrowser || isSavedToBrowser}
                            className={`p-2 rounded-full transition cursor-pointer border ${
                              isSavedToBrowser 
                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                                : 'bg-white/5 border-white/10 text-slate-300 hover:text-white active:scale-95'
                            }`}
                            title={isSavedToBrowser ? "Saved to browser offline library" : "Save offline to browser storage"}
                          >
                            {isSavingToBrowser ? (
                              <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Library className="w-4.5 h-4.5" />
                            )}
                          </button>
                        )}
                        
                        {selectedFormat && downloadUrl && (
                          <button
                            onClick={handleDownload}
                            className="p-2 bg-rose-600 hover:bg-rose-700 text-white rounded-full transition cursor-pointer active:scale-95 border border-rose-500/20"
                            title="Download file to computer"
                          >
                            <Download className="w-4.5 h-4.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress feedback */}
                    {status === 'converting' && (
                      <div className="p-3 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between gap-4">
                        <div className="flex-1 flex flex-col gap-1">
                          <span className="text-xs text-slate-400 font-semibold">Background conversion running...</span>
                          <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                            <div className="bg-rose-500 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                        <span className="text-xs font-bold font-mono text-rose-400">{progress}%</span>
                      </div>
                    )}

                    {saveError && (
                      <div className="p-3 bg-rose-500/15 border border-rose-500/20 rounded-xl text-xs text-rose-400">
                        {saveError}
                      </div>
                    )}

                    {/* Collapsible description box */}
                    <div className="bg-white/5 rounded-2xl p-4 flex flex-col border border-white/5">
                      <div className="flex items-center gap-3 text-xs font-semibold text-slate-300 select-none">
                        <span>{formatViewCount(watchDetails.statistics?.viewCount)}</span>
                        <span>•</span>
                        <span>{getRelativeTime(watchDetails.snippet?.publishedAt)}</span>
                      </div>
                      
                      <div className={`text-sm text-slate-200 mt-2 whitespace-pre-line leading-relaxed ${
                        descExpanded ? '' : 'line-clamp-3'
                      }`}>
                        {watchDetails.snippet?.description}
                      </div>

                      <button
                        onClick={() => setDescExpanded(!descExpanded)}
                        className="text-xs font-bold text-slate-300 hover:text-white mt-2 flex items-center gap-1 self-start cursor-pointer hover:underline"
                      >
                        {descExpanded ? (
                          <><span>Show Less</span><ChevronUp className="w-3.5 h-3.5" /></>
                        ) : (
                          <><span>Show More</span><ChevronDown className="w-3.5 h-3.5" /></>
                        )}
                      </button>
                    </div>
                  </div>
                )}


              </div>

              {/* Right Column: Recommended Sidebar list */}
              <div className="flex flex-col gap-4">
                <h3 className="text-sm font-bold text-white select-none">
                  Recommended Videos
                </h3>
                <div className="flex flex-col gap-3">
                  {feedVideos.filter(v => v.id !== route.videoId).slice(0, 10).map((video) => (
                    <div 
                      key={video.id} 
                      onClick={() => navigate('watch', { v: video.id })}
                      className="flex gap-2.5 group cursor-pointer"
                    >
                      <div className="relative w-40 aspect-video rounded-lg overflow-hidden bg-slate-900 border border-white/5 shrink-0">
                        <img 
                          src={video.snippet?.thumbnails?.medium?.url || 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg'} 
                          alt={video.snippet?.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                          loading="lazy"
                        />
                        {video.contentDetails?.duration && (
                          <div className="absolute bottom-1 right-1 bg-black/85 text-[9px] font-bold text-white px-1 py-0.2 rounded font-mono">
                            {formatISO8601Duration(video.contentDetails.duration)}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-white leading-tight line-clamp-2 group-hover:text-rose-400 transition" title={video.snippet?.title}>
                          {video.snippet?.title}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-1 truncate">
                          {video.snippet?.channelTitle}
                        </span>
                        <div className="flex items-center gap-1 text-[9px] text-slate-500 mt-0.5 select-none">
                          <span>{formatViewCount(video.statistics?.viewCount)}</span>
                          <span>•</span>
                          <span>{getRelativeTime(video.snippet?.publishedAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* ====================================================
              ROUTE: OFFLINE LIBRARY
              ==================================================== */}
          {route.name === 'library' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-2 select-none">
                <h1 className="text-lg font-bold text-white flex items-center gap-2">
                  <Library className="w-5 h-5 text-rose-500" />
                  <span>Offline Browser Library</span>
                </h1>
                <span className="text-xs text-slate-400">
                  {history.filter(item => item.savedInBrowser).length} items offlined
                </span>
              </div>

              {history.filter(item => item.savedInBrowser).length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-slate-500 gap-3 border border-dashed border-white/10 rounded-2xl mt-4">
                  <Library className="w-12 h-12 stroke-[1]" />
                  <p className="text-sm">No videos or audio saved offline yet.</p>
                  <button 
                    onClick={() => navigate('home')}
                    className="mt-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-full text-xs font-bold transition cursor-pointer"
                  >
                    Browse Feed to Save Videos
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 mt-2">
                  {history.filter(item => item.savedInBrowser).map((item) => {
                    const storageId = `${item.id}-${item.quality}-${item.ext}`;
                    return (
                      <div 
                        key={storageId}
                        className="flex flex-col gap-2.5 group relative"
                      >
                        {/* Play click wrapper */}
                        <div 
                          onClick={() => navigate('watch', { v: item.id })}
                          className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-white/5 shadow-md cursor-pointer"
                        >
                          <OfflineThumbnail 
                            storageId={storageId} 
                            fallbackId={item.id} 
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          {/* Duration Badge */}
                          <div className="absolute bottom-2 right-2 bg-black/85 text-[10px] font-bold text-white px-1.5 py-0.5 rounded font-mono">
                            {formatTime(item.duration)}
                          </div>
                          
                          {/* Offline Badge */}
                          <div className="absolute top-2 left-2 bg-emerald-500 text-black text-[9px] font-extrabold px-1.5 py-0.5 rounded shadow">
                            OFFLINE
                          </div>

                          {/* Media Type Badge */}
                          <div className="absolute top-2 right-2 bg-rose-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow uppercase">
                            {item.ext}
                          </div>
                        </div>

                        {/* Title metadata */}
                        <div className="flex flex-col min-w-0 px-1">
                          <span 
                            onClick={() => navigate('watch', { v: item.id })}
                            className="text-sm font-semibold text-white leading-tight line-clamp-2 hover:text-rose-400 transition cursor-pointer"
                          >
                            {item.title}
                          </span>
                          
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-[10px] text-slate-500 font-medium">
                              Quality: {item.quality}{item.ext === 'mp3' ? 'kbps' : 'p'}
                            </span>
                            
                            <button
                              onClick={() => handleDeleteFromBrowser(item)}
                              className="text-[10px] font-bold text-rose-400 hover:text-rose-300 hover:underline cursor-pointer transition select-none"
                            >
                              Remove Offline
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ====================================================
              ROUTE: WATCH HISTORY
              ==================================================== */}
          {route.name === 'history' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-2 select-none">
                <h1 className="text-lg font-bold text-white flex items-center gap-2">
                  <Clock className="w-5 h-5 text-rose-500" />
                  <span>Conversion & Watch History</span>
                </h1>
                
                {history.length > 0 && (
                  <button
                    onClick={clearHistory}
                    className="text-xs font-bold text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                  >
                    Clear History
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-slate-500 gap-3 border border-dashed border-white/10 rounded-2xl mt-4">
                  <Clock className="w-12 h-12 stroke-[1]" />
                  <p className="text-sm">Your history is currently empty.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3.5 mt-2 max-w-4xl">
                  {history.map((item) => {
                    const storageId = `${item.id}-${item.quality}-${item.ext}`;
                    const isSaving = savingIds.includes(storageId);
                    return (
                      <div 
                        key={storageId}
                        className="bg-white/5 border border-white/5 hover:border-white/10 rounded-2xl p-4 flex gap-4 items-center justify-between"
                      >
                        {/* Title and metadata */}
                        <div className="flex items-center gap-4 min-w-0">
                          {/* Mini Thumbnail */}
                          <div 
                            onClick={() => navigate('watch', { v: item.id })}
                            className="relative w-28 aspect-video rounded-lg overflow-hidden shrink-0 cursor-pointer bg-slate-900 border border-white/5"
                          >
                            <OfflineThumbnail storageId={storageId} fallbackId={item.id} className="w-full h-full object-cover" />
                            <div className="absolute bottom-1 right-1 bg-black/85 text-[8px] font-bold text-white px-1.5 py-0.2 rounded font-mono">
                              {formatTime(item.duration)}
                            </div>
                          </div>

                          <div className="flex flex-col min-w-0">
                            <h3 
                              onClick={() => navigate('watch', { v: item.id })}
                              className="text-sm font-semibold text-white leading-tight truncate hover:text-rose-400 cursor-pointer"
                              title={item.title}
                            >
                              {item.title}
                            </h3>
                            <span className="text-[10px] text-slate-500 mt-1 select-none">
                              {item.quality}{item.ext === 'mp3' ? 'kbps' : 'p'} • {item.ext.toUpperCase()} • {item.downloadedAt}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          {item.savedInBrowser ? (
                            <div className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-extrabold select-none">
                              OFFLINE
                            </div>
                          ) : (
                            <button
                              onClick={() => handleSaveHistoryItemToBrowser(item)}
                              disabled={isSaving}
                              className="px-3 py-1 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-full text-xs font-semibold cursor-pointer border border-white/5 transition"
                            >
                              {isSaving ? 'Saving...' : 'Save Offline'}
                            </button>
                          )}

                          <button
                            onClick={() => deleteHistoryItem(item)}
                            className="p-2 text-slate-400 hover:text-rose-400 rounded-full hover:bg-white/5 cursor-pointer transition"
                            title="Delete from history"
                          >
                            <X className="w-4.5 h-4.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ====================================================
              ROUTE: SETTINGS
              ==================================================== */}
          {route.name === 'settings' && (
            <div className="max-w-2xl flex flex-col gap-6">
              <h1 className="text-lg font-bold text-white border-b border-white/5 pb-2 flex items-center gap-2 select-none">
                <Settings className="w-5 h-5 text-rose-500" />
                <span>TubeHub Settings</span>
              </h1>

              {/* API Key Form */}
              <form onSubmit={handleSaveApiKey} className="bg-white/5 p-6 rounded-2xl border border-white/5 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-bold text-white">YouTube Data API v3 Key</h3>
                  <p className="text-xs text-slate-400 leading-normal">
                    This application can use your own custom YouTube Data API key to fetch searches and trending categories. 
                    If left blank, the app will fall back to using the developer's server-side key configured in the backend environment.
                  </p>
                </div>

                <div className="flex gap-2 mt-2">
                  <input
                    type="password"
                    placeholder="Enter YouTube API Key..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500/50"
                  />
                  <button
                    type="submit"
                    className="px-5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-bold transition cursor-pointer active:scale-95 border border-rose-500/20"
                  >
                    Save Key
                  </button>
                </div>

                {localStorage.getItem('yt-api-key') && (
                  <button
                    type="button"
                    onClick={handleClearApiKey}
                    className="text-xs font-bold text-rose-400 hover:text-rose-300 self-start hover:underline cursor-pointer select-none"
                  >
                    Clear custom key & use Server Fallback
                  </button>
                )}
              </form>

              {/* Developer note */}
              <div className="bg-white/5 p-6 rounded-2xl border border-white/5 flex flex-col gap-2">
                <h3 className="text-sm font-bold text-white">Privacy & Cache Policy</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  TubeHub operates with a strict <strong>privacy-first</strong> protocol:
                </p>
                <ul className="text-xs text-slate-400 list-disc list-inside flex flex-col gap-1.5 mt-1 leading-relaxed">
                  <li>No client IP exposure to Google CDNs (all video streams are proxied anonymously through our Node.js server).</li>
                  <li>No personalized feed tracking or persistent tracking cookies are stored.</li>
                  <li>Video playback is cached locally in the background, minimizing bandwidth consumption on repeated watches or downloads.</li>
                  <li>Stale media cache files in the container are automatically deleted based on the background cleanup threshold (configured in `.env`).</li>
                </ul>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

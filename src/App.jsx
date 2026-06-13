import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useYoutubeConverter } from './hooks/useYoutubeConverter';
import { fetchTrending, searchVideos, fetchVideoDetails } from './services/youtube';
import { getMedia, getMediaSizeEstimate, clearAllStorage } from './services/db';
import { 
  X, Volume2, Film, PictureInPicture, Play, Pause, Volume1, VolumeX, 
  SkipBack, SkipForward, Maximize, Minimize, Search, Settings, Clock, 
  Download, ChevronDown, ChevronUp, Menu, Library, Database
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

  const fallbackUrl = `/api/v5/thumbnail/${fallbackId}`;
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
    setAudioFormats,
    videoFormats,
    setVideoFormats,
    selectedFormat,
    pendingAction,
    isSavingToBrowser,
    isSavedToBrowser,
    saveError,
    savingIds,
    handleConvert,
    selectFormat,
    handleDownload,
    handleSaveToBrowser,
    handleDeleteFromBrowser,
    handleSaveHistoryItemToBrowser,
    currentVideo,
    setCurrentVideo,
    clearHistory,
    deleteHistoryItem
  } = useYoutubeConverter();

  const [selectedRegion, setSelectedRegion] = useState(() => localStorage.getItem('yt-region-code') || '');

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
    const routeParams = { ...params };
    if (pageName === 'watch' && params.v) {
      routeParams.videoId = params.v;
    } else if (pageName === 'home') {
      routeParams.query = params.q || '';
    }
    setRoute({ name: pageName, ...routeParams });
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

  // Search suggestion autocomplete states
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [focusedSuggestionIndex, setFocusedSuggestionIndex] = useState(-1);

  // Watch page state
  const [watchDetails, setWatchDetails] = useState(null);
  const [watchLoading, setWatchLoading] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);

  // Playback States
  const [activePlayItem, setActivePlayItem] = useState(null); // { title, ext, src, id }
  const [posterUrl, setPosterUrl] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    async function loadPoster() {
      if (!activePlayItem) {
        setPosterUrl(null);
        return;
      }
      
      if (activePlayItem.isOffline) {
        try {
          const storageId = `${activePlayItem.id}-${activePlayItem.quality}-${activePlayItem.ext}`;
          const blob = await getMedia(`${storageId}-thumbnail`).catch(() => null);
          if (blob) {
            objectUrl = URL.createObjectURL(blob);
            setPosterUrl(objectUrl);
            return;
          }
        } catch (err) {
          console.warn('Failed to load offline poster:', err);
        }
      }
      
      // Fallback to online thumbnail
      setPosterUrl(`/api/v5/thumbnail/${activePlayItem.id}`);
    }
    
    loadPoster();
    
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [activePlayItem]);

  // Custom Video Player States
  const videoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const lastSaveTimeRef = useRef(0);
  const startedAsUncachedRef = useRef(false);
  const isFormatSwitchRef = useRef(false);
  const wasPlayingBeforeSwitchRef = useRef(true);
  const [videoIsPlaying, setVideoIsPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [serverCacheProgress, setServerCacheProgress] = useState(0);
  const [videoVolume, setVideoVolume] = useState(0.8);
  const [videoIsMuted, setVideoIsMuted] = useState(false);
  const [showVideoControls, setShowVideoControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDraggingVideoTimeline, setIsDraggingVideoTimeline] = useState(false);

  const saveResumePosition = useCallback((videoId, time) => {
    try {
      const stored = localStorage.getItem('tubehub_resume_positions');
      const positions = stored ? JSON.parse(stored) : {};
      positions[videoId] = time;
      const keys = Object.keys(positions);
      if (keys.length > 150) {
        delete positions[keys[0]];
      }
      localStorage.setItem('tubehub_resume_positions', JSON.stringify(positions));
    } catch (err) {
      console.warn('Failed to save resume position:', err);
    }
  }, []);

  const clearResumePosition = useCallback((videoId) => {
    try {
      const stored = localStorage.getItem('tubehub_resume_positions');
      if (stored) {
        const positions = JSON.parse(stored);
        delete positions[videoId];
        localStorage.setItem('tubehub_resume_positions', JSON.stringify(positions));
      }
    } catch (err) {
      console.warn('Failed to clear resume position:', err);
    }
  }, []);

  // Storage Stats State & Functions
  const [backendCacheSize, setBackendCacheSize] = useState({ totalBytes: 0, fileCount: 0 });
  const [browserStorageSize, setBrowserStorageSize] = useState({ totalBytes: 0, count: 0 });
  const [isPurgingBackend, setIsPurgingBackend] = useState(false);
  const [isClearingBrowser, setIsClearingBrowser] = useState(false);
  const [enableBackendCache, setEnableBackendCache] = useState(() => localStorage.getItem('tubehub_enable_backend_cache') === 'true');

  const loadStorageStats = useCallback(async () => {
    try {
      const backendRes = await fetch('/api/v5/cache/size');
      if (backendRes.ok) {
        const backendData = await backendRes.json();
        setBackendCacheSize(backendData);
      }
      const browserData = await getMediaSizeEstimate();
      setBrowserStorageSize(browserData);
    } catch (err) {
      console.warn('Failed to load storage statistics:', err);
    }
  }, []);

  useEffect(() => {
    if (route.name === 'settings') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadStorageStats();
    }
  }, [route.name, loadStorageStats]);

  const handlePurgeBackendCache = async () => {
    if (!window.confirm("Are you sure you want to delete all cached files from the server? This will not interrupt active downloads.")) return;
    setIsPurgingBackend(true);
    try {
      const response = await fetch('/api/v5/cache', { method: 'DELETE' });
      if (response.ok) {
        loadStorageStats();
      } else {
        alert("Failed to purge server cache.");
      }
    } catch (err) {
      console.error(err);
      alert("Error purging server cache.");
    } finally {
      setIsPurgingBackend(false);
    }
  };

  const handleClearBrowserStorage = async () => {
    if (!window.confirm("Are you sure you want to delete all media stored offline in this browser? This action is permanent and cannot be undone.")) return;
    setIsClearingBrowser(true);
    try {
      await clearAllStorage();
      loadStorageStats();
    } catch (err) {
      console.error(err);
      alert("Error clearing browser storage.");
    } finally {
      setIsClearingBrowser(false);
    }
  };

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
        data = await fetchTrending(pageToken, activeCategory, selectedRegion);
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
  }, [route.name, route.query, activeCategory, selectedRegion]);

  useEffect(() => {
    if (route.name === 'home') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadFeed(true);
    }
  }, [route.name, loadFeed]);

  // Fetch search autocomplete suggestions debounced
  useEffect(() => {
    if (!searchQuery.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v5/youtube/suggest?q=${encodeURIComponent(searchQuery.trim())}`);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && Array.isArray(data[1])) {
            setSuggestions(data[1]);
          } else if (Array.isArray(data)) {
            setSuggestions(data);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch suggestions:', err);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Handle click outside of the search bar to hide suggestions
  const searchContainerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle watch details and streaming source resolve
  const loadWatchDetails = useCallback(async (videoId) => {
    setWatchLoading(true);
    setWatchDetails(null);
    
    // Auto initiate conversion fetching to resolve MP3/MP4 conversion download option formats
    handleConvert(videoId);

    try {
      const histItem = history.find(item => item.id === videoId);
      // 1. Fetch metadata
      const details = await fetchVideoDetails(videoId).catch(() => null);

      if (details) {
        setWatchDetails(details);
      } else {
        // Fallback to history details or synthesize from cache parameters
        setWatchDetails({
          id: videoId,
          snippet: {
            title: histItem?.title || `Cached Video (${videoId})`,
            channelTitle: 'Local TubeHub Cache',
            description: 'This video is loaded from your local network/server cache.',
            publishedAt: new Date().toISOString(),
            thumbnails: {
              medium: { url: `/api/v5/thumbnail/${videoId}` },
              high: { url: `/api/v5/thumbnail/${videoId}` }
            }
          },
          statistics: {
            viewCount: '1'
          },
          contentDetails: {
            duration: histItem?.duration || '0'
          }
        });
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
          isOffline: true,
          quality: offlineItem.quality
        });
      } else {
        console.log('Resolving watch player to privacy-first backend stream proxy.');
        const lastExt = localStorage.getItem('tubehub_last_ext') || 'mp4';
        const lastQuality = localStorage.getItem('tubehub_last_quality') || '720';
        const cacheEnabled = localStorage.getItem('tubehub_enable_backend_cache') === 'true';
        setActivePlayItem({
          title: details?.snippet?.title || histItem?.title || 'Streaming Video',
          ext: lastExt,
          quality: lastQuality,
          src: `/api/v5/stream/${videoId}?ext=${lastExt}&quality=${lastQuality}&cache=${cacheEnabled}`,
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

  // Poll backend cache status for active video stream (acts as active play heartbeat)
  useEffect(() => {
    const cacheEnabled = localStorage.getItem('tubehub_enable_backend_cache') === 'true';
    if (route.name !== 'watch' || !activePlayItem || activePlayItem.isOffline || !cacheEnabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setServerCacheProgress(0);
      startedAsUncachedRef.current = false;
      return;
    }

    let isMounted = true;
    let pollInterval = null;
    let hasCheckedInitial = false;

    async function checkStatus() {
      try {
        const response = await fetch(`/api/v5/cache/status/${activePlayItem.id}?ext=${activePlayItem.ext}&quality=${activePlayItem.quality}`);
        if (response.ok && isMounted) {
          const data = await response.json();
          setServerCacheProgress(data.progress || 0);

          if (!hasCheckedInitial) {
            hasCheckedInitial = true;
            if (!data.isCached && data.progress < 100) {
              startedAsUncachedRef.current = true;
            }
          }

          if (data.isCached || data.progress === 100) {
            setCurrentVideo(prev => prev ? { ...prev, isCached: true } : null);
            setAudioFormats(prev => prev.map(f => String(f.quality) === String(activePlayItem.quality) && f.ext === activePlayItem.ext ? { ...f, isCached: true } : f));
            setVideoFormats(prev => prev.map(f => String(f.quality) === String(activePlayItem.quality) && f.ext === activePlayItem.ext ? { ...f, isCached: true } : f));

            // Force player reload only if it transitioned from uncached to cached during this session
            if (startedAsUncachedRef.current && videoRef.current) {
              startedAsUncachedRef.current = false; // Reset to prevent double reload
              const currentTime = videoRef.current.currentTime;
              const isPlaying = !videoRef.current.paused;
              console.log('Backend cache completed. Reloading stream source to switch to high-quality file.');
              
              // Save position and play state for the format switch handler
              saveResumePosition(activePlayItem.id, currentTime);
              wasPlayingBeforeSwitchRef.current = isPlaying;
              isFormatSwitchRef.current = true;

              // Append a cache-buster query parameter to force browser to request the cached file
              setActivePlayItem(prev => {
                if (!prev) return null;
                const cleanSrc = prev.src.replace(/[&?]_t=\d+/, '');
                return {
                  ...prev,
                  src: `${cleanSrc}${cleanSrc.includes('?') ? '&' : '?'}_t=${Date.now()}`
                };
              });
            }

            if (pollInterval) clearInterval(pollInterval);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch cache progress:', err);
      }
    }

    // Initial check
    checkStatus();

    // Poll every 2.5 seconds
    pollInterval = setInterval(checkStatus, 2500);

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [route.name, activePlayItem, setCurrentVideo, setAudioFormats, setVideoFormats, saveResumePosition]);

  // Dynamically update stream URL when user changes format/quality selection on watch page
  useEffect(() => {
    if (
      route.name === 'watch' &&
      selectedFormat &&
      activePlayItem &&
      !activePlayItem.isOffline &&
      activePlayItem.id === route.videoId
    ) {
      const cacheEnabled = localStorage.getItem('tubehub_enable_backend_cache') === 'true';
      const newSrc = `/api/v5/stream/${route.videoId}?ext=${selectedFormat.ext}&quality=${selectedFormat.quality}&cache=${cacheEnabled}`;
      if (activePlayItem.src !== newSrc) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActivePlayItem(prev => {
          if (!prev) return null;
          return {
            ...prev,
            ext: selectedFormat.ext,
            quality: selectedFormat.quality,
            src: newSrc
          };
        });
      }
    }
  }, [selectedFormat, route.name, route.videoId, activePlayItem]);

  // Dynamic SEO tag management for the Watch page and defaults fallback
  useEffect(() => {
    if (route.name === 'watch' && watchDetails) {
      const videoTitle = watchDetails.snippet?.title || 'Streaming Video';
      const titleText = `${videoTitle} - Watch & Convert on TubeHub`;
      const descText = watchDetails.snippet?.description
        ? `${watchDetails.snippet.description.substring(0, 150)}... Watch and convert to MP3/MP4 on TubeHub.`
        : `Watch and convert this video to MP3 or MP4 on TubeHub. High quality downloads and offline browser saving.`;
      const thumbnailUrl = `/api/v5/thumbnail/${route.videoId}`;

      // Update document title
      document.title = titleText;

      // Helper to update or create meta tags
      const updateMetaTag = (attribute, value, content) => {
        let el = document.querySelector(`meta[${attribute}="${value}"]`);
        if (!el) {
          el = document.createElement('meta');
          el.setAttribute(attribute, value);
          document.head.appendChild(el);
        }
        el.setAttribute('content', content);
      };

      updateMetaTag('name', 'description', descText);
      updateMetaTag('property', 'og:title', titleText);
      updateMetaTag('property', 'og:description', descText);
      updateMetaTag('property', 'og:image', thumbnailUrl);
      updateMetaTag('name', 'twitter:title', titleText);
      updateMetaTag('name', 'twitter:description', descText);
    } else {
      // Reset to defaults
      document.title = 'TubeHub | Premium YouTube to MP3 & MP4 Converter & Media Dashboard';
      
      const updateMetaTag = (attribute, value, content) => {
        const el = document.querySelector(`meta[${attribute}="${value}"]`);
        if (el) el.setAttribute('content', content);
      };

      updateMetaTag('name', 'description', 'TubeHub is a fast and secure YouTube to MP3 and MP4 converter. Convert YouTube links to high-quality audio up to 320kbps or video up to 1080p, store media offline in your browser, and play instantly.');
      updateMetaTag('property', 'og:title', 'TubeHub | Premium YouTube to MP3 & MP4 Converter');
      updateMetaTag('property', 'og:description', 'Convert YouTube links to high-quality audio & video. Save media offline directly in your browser database and play instantly without server buffering.');
      updateMetaTag('property', 'og:image', '/favicon.svg');
      updateMetaTag('name', 'twitter:title', 'TubeHub | YouTube to MP3 & MP4 Converter');
      updateMetaTag('name', 'twitter:description', 'Extract MP3 and MP4 files from YouTube videos. Store them offline in your browser media dashboard.');
    }
  }, [route.name, route.videoId, watchDetails]);


  useEffect(() => {
    if (route.videoId) {
      lastSaveTimeRef.current = 0;
    }
  }, [route.videoId]);

  const handleSearchInputKeyDown = (e) => {
    if (!suggestions.length || !showSuggestions) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedSuggestionIndex(prev => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
      setFocusedSuggestionIndex(-1);
    } else if (e.key === 'Enter' && focusedSuggestionIndex !== -1) {
      e.preventDefault();
      const selected = suggestions[focusedSuggestionIndex];
      setSearchQuery(selected);
      setShowSuggestions(false);
      setFocusedSuggestionIndex(-1);
      navigate('home', { q: selected });
    }
  };

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
    const curTime = videoRef.current.currentTime;
    setVideoCurrentTime(curTime);

    // Only save resume position if video is loaded and state is ready (readyState >= 1)
    if (route.videoId && videoRef.current.readyState >= 1) {
      if (Math.abs(curTime - lastSaveTimeRef.current) > 2) {
        saveResumePosition(route.videoId, curTime);
        lastSaveTimeRef.current = curTime;
      }
    }
  };

  const handleVideoLoadedMetadata = () => {
    if (!videoRef.current) return;
    let duration = videoRef.current.duration;
    
    // Fallback to metadata duration if browser duration is infinite, NaN, or 0
    if (isNaN(duration) || !isFinite(duration) || duration === 0) {
      if (currentVideo && currentVideo.duration) {
        duration = currentVideo.duration;
      }
    }
    
    setVideoDuration(duration);
    resetControlsTimeout();

    // Load saved resume position
    if (route.videoId) {
      try {
        const stored = localStorage.getItem('tubehub_resume_positions');
        const positions = stored ? JSON.parse(stored) : {};
        const savedTime = positions[route.videoId];
        if (savedTime && savedTime > 1 && savedTime < duration - 5) {
          videoRef.current.currentTime = savedTime;
          setVideoCurrentTime(savedTime);
          lastSaveTimeRef.current = savedTime;
          console.log(`Resumed video ${route.videoId} at ${savedTime} seconds`);
        } else {
          lastSaveTimeRef.current = 0;
        }

        // Restore play/pause state if this reload is from a format switch
        if (isFormatSwitchRef.current) {
          isFormatSwitchRef.current = false;
          if (wasPlayingBeforeSwitchRef.current) {
            videoRef.current.play().catch(() => {});
          } else {
            videoRef.current.pause();
          }
        }
      } catch (err) {
        console.warn('Failed to load resume position:', err);
      }
    }
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
    if (route.videoId) {
      clearResumePosition(route.videoId);
    }
    if (autoplayEnabled) {
      console.log('Video ended. Autoplaying next video...');
      playNextVideo();
    }
  };

  // YouTube-like keyboard shortcuts implementation
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger shortcuts if typing in input fields
      const activeEl = document.activeElement;
      if (
        activeEl && 
        (activeEl.tagName === 'INPUT' || 
         activeEl.tagName === 'TEXTAREA' || 
         activeEl.isContentEditable)
      ) {
        return;
      }

      if (route.name !== 'watch' || !videoRef.current) return;

      const key = e.key.toLowerCase();
      const duration = videoRef.current.duration || 0;

      switch (key) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (videoRef.current.paused) {
            videoRef.current.play().catch(() => {});
          } else {
            videoRef.current.pause();
          }
          resetControlsTimeout();
          break;
        case 'j':
          e.preventDefault();
          seekVideo(Math.max(videoRef.current.currentTime - 10, 0));
          break;
        case 'l':
          e.preventDefault();
          seekVideo(Math.min(videoRef.current.currentTime + 10, duration));
          break;
        case 'arrowleft':
          e.preventDefault();
          seekVideo(Math.max(videoRef.current.currentTime - 5, 0));
          break;
        case 'arrowright':
          e.preventDefault();
          seekVideo(Math.min(videoRef.current.currentTime + 5, duration));
          break;
        case 'arrowup':
          e.preventDefault();
          handleVolumeChange(Math.min(videoRef.current.volume + 0.05, 1));
          break;
        case 'arrowdown':
          e.preventDefault();
          handleVolumeChange(Math.max(videoRef.current.volume - 0.05, 0));
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        default:
          // Check for number keys 0-9
          if (e.key >= '0' && e.key <= '9' && duration > 0) {
            e.preventDefault();
            const percent = parseInt(e.key) / 10;
            seekVideo(duration * percent);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name]);

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds) || !isFinite(timeInSeconds)) return '0:00';
    const mins = Math.floor(timeInSeconds / 60);
    const secs = Math.floor(timeInSeconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatStorageSize = (bytes) => {
    if (!bytes || bytes === 0) return '0.0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) {
      return `${mb.toFixed(1)} MB`;
    }
    return `${(mb / 1024).toFixed(2)} GB`;
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

        {/* Search Form Container */}
        <div ref={searchContainerRef} className="relative flex-1 max-w-xl">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              setShowSuggestions(false);
              setFocusedSuggestionIndex(-1);
              if (searchQuery.trim()) navigate('home', { q: searchQuery.trim() });
            }}
            className="flex items-center w-full bg-[#121212] border border-white/10 rounded-full overflow-hidden shadow-inner focus-within:border-rose-500/50 transition-all"
          >
            <input 
              type="text"
              placeholder="Search privacy-first TubeHub..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSuggestions(true);
                setFocusedSuggestionIndex(-1);
              }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={handleSearchInputKeyDown}
              className="flex-1 bg-transparent px-4 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
            <button 
              type="submit"
              className="px-5 bg-white/5 hover:bg-white/10 border-l border-white/10 text-slate-400 hover:text-white py-1.5 transition-colors cursor-pointer"
            >
              <Search className="w-4 h-4" />
            </button>
          </form>

          {/* Autocomplete Suggestions Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-[#0f0f0f]/95 backdrop-blur-md border border-white/10 rounded-2xl shadow-xl overflow-hidden z-50 py-2 select-none">
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  onClick={() => {
                    setSearchQuery(suggestion);
                    setShowSuggestions(false);
                    setFocusedSuggestionIndex(-1);
                    navigate('home', { q: suggestion });
                  }}
                  className={`px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/5 flex items-center gap-2.5 cursor-pointer transition-colors ${
                    focusedSuggestionIndex === index ? 'bg-white/5 text-white font-semibold' : ''
                  }`}
                >
                  <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{suggestion}</span>
                </div>
              ))}
            </div>
          )}
        </div>

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
                        src={`/api/v5/thumbnail/${video.id}`} 
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
                      poster={posterUrl || undefined}
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

                    {/* Media Source Overlay HUD Badge */}
                    <div 
                      className={`absolute top-4 right-4 z-20 px-2.5 py-1 rounded-md text-[9px] font-bold tracking-wider border shadow-md backdrop-blur-md transition-opacity duration-300 pointer-events-none select-none ${
                        showVideoControls ? 'opacity-100' : 'opacity-0'
                      } ${
                        activePlayItem?.isOffline
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : currentVideo?.isCached
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                            : 'bg-slate-500/10 text-slate-400 border-white/10'
                      }`}
                    >
                      {activePlayItem?.isOffline
                        ? 'BROWSER STORAGE'
                        : currentVideo?.isCached
                          ? 'BACKEND CACHE'
                          : 'YOUTUBE SERVER (PROXIED)'}
                    </div>

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
                            background: (() => {
                              const played = videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0;
                              const cache = (activePlayItem && activePlayItem.isOffline) ? 100 : serverCacheProgress;
                              const endCache = Math.max(played, cache);
                              return `linear-gradient(to right, #f43f5e 0%, #f43f5e ${played}%, rgba(244, 63, 94, 0.35) ${played}%, rgba(244, 63, 94, 0.35) ${endCache}%, rgba(255, 255, 255, 0.2) ${endCache}%, rgba(255, 255, 255, 0.2) 100%)`;
                            })()
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
                          id="watch-btn-autoplay"
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
                            id="watch-select-format"
                            value={selectedFormat?.token || ''}
                            onChange={(e) => {
                              const token = e.target.value;
                              const matches = [...videoFormats, ...audioFormats];
                              const found = matches.find(f => f.token === token);
                              if (found) {
                                // Save exact current playback position before changing format source
                                if (videoRef.current && watchDetails) {
                                  saveResumePosition(watchDetails.id, videoRef.current.currentTime);
                                  wasPlayingBeforeSwitchRef.current = !videoRef.current.paused;
                                  isFormatSwitchRef.current = true;
                                }
                                selectFormat(found);
                                localStorage.setItem('tubehub_last_ext', found.ext);
                                localStorage.setItem('tubehub_last_quality', found.quality);
                              }
                            }}
                            className="bg-transparent text-xs font-semibold text-slate-200 py-1 focus:outline-none cursor-pointer"
                          >
                            <option value="" disabled>Select Format...</option>
                            <optgroup label="Video (MP4)">
                              {videoFormats.map((f) => {
                                const isSaved = history.some(item => item.id === watchDetails.id && item.ext === f.ext && item.quality === f.quality && item.savedInBrowser);
                                const isCachedOnServer = f.isCached;
                                return (
                                  <option key={f.token} value={f.token}>
                                    {f.quality}p (.mp4){isSaved ? ' (Saved Offline)' : (isCachedOnServer ? ' (Cached)' : '')}
                                  </option>
                                );
                              })}
                            </optgroup>
                            <optgroup label="Audio (MP3)">
                              {audioFormats.map((f) => {
                                const isSaved = history.some(item => item.id === watchDetails.id && item.ext === f.ext && item.quality === f.quality && item.savedInBrowser);
                                const isCachedOnServer = f.isCached;
                                return (
                                  <option key={f.token} value={f.token}>
                                    {f.quality}kbps (.mp3){isSaved ? ' (Saved Offline)' : (isCachedOnServer ? ' (Cached)' : '')}
                                  </option>
                                );
                              })}
                            </optgroup>
                          </select>
                        </div>
 
                        {/* Save to Browser Offline Button */}
                        <button
                          id="watch-btn-save-offline"
                          onClick={() => handleSaveToBrowser()}
                          disabled={!selectedFormat || isSavingToBrowser || (status === 'converting' && pendingAction === 'save') || isSavedToBrowser}
                          className={`p-2 rounded-full transition border relative flex items-center justify-center ${
                            isSavedToBrowser 
                              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 cursor-default' 
                              : !selectedFormat
                                ? 'opacity-40 border-white/5 text-slate-500 cursor-not-allowed'
                                : (isSavingToBrowser || (status === 'converting' && pendingAction === 'save'))
                                  ? 'bg-white/5 border-white/5 text-slate-400 cursor-wait'
                                  : 'bg-white/5 border-white/10 text-slate-300 hover:text-white active:scale-95 cursor-pointer'
                          }`}
                          title={
                            isSavedToBrowser 
                              ? "Saved to browser offline library" 
                              : !selectedFormat 
                                ? "Select a format first to enable offline saving" 
                                : (isSavingToBrowser || (status === 'converting' && pendingAction === 'save'))
                                  ? `Converting & saving in background (${progress}%)...` 
                                  : "Save offline to browser storage (will convert first if needed)"
                          }
                        >
                          {(isSavingToBrowser || (status === 'converting' && pendingAction === 'save')) ? (
                            <div className="relative w-4.5 h-4.5 flex items-center justify-center">
                              <svg className={`absolute inset-0 w-full h-full transform -rotate-90 ${isSavingToBrowser ? 'animate-spin' : ''}`} viewBox="0 0 36 36">
                                <circle
                                  cx="18"
                                  cy="18"
                                  r="16"
                                  fill="none"
                                  className="stroke-white/10"
                                  strokeWidth="3.5"
                                />
                                <circle
                                  cx="18"
                                  cy="18"
                                  r="16"
                                  fill="none"
                                  className="stroke-rose-500 transition-all duration-300"
                                  strokeWidth="3.5"
                                  strokeDasharray="100.5"
                                  strokeDashoffset={isSavingToBrowser ? 30 : (100.5 - (progress || 0))}
                                  strokeLinecap="round"
                                />
                              </svg>
                              {(status === 'converting' && pendingAction === 'save') && (
                                <span className="text-[7.5px] font-bold font-mono text-rose-400 absolute select-none">
                                  {progress}
                                </span>
                              )}
                            </div>
                          ) : (
                            <Library className="w-4.5 h-4.5" />
                          )}
                        </button>
                        
                        {/* Download to File System Button */}
                        <button
                          id="watch-btn-download"
                          onClick={() => handleDownload()}
                          disabled={!selectedFormat || (status === 'converting' && pendingAction === 'download')}
                          className={`p-2 rounded-full transition border relative flex items-center justify-center ${
                            !selectedFormat 
                              ? 'opacity-40 border-white/5 text-slate-500 cursor-not-allowed'
                              : (status === 'converting' && pendingAction === 'download')
                                ? 'bg-white/5 border-white/5 text-slate-400 cursor-wait'
                                : 'bg-rose-600 hover:bg-rose-700 text-white active:scale-95 cursor-pointer border-rose-500/20'
                          }`}
                          title={
                            !selectedFormat 
                              ? "Select a format first to enable downloading" 
                              : (status === 'converting' && pendingAction === 'download')
                                ? `Converting & downloading in background (${progress}%)...` 
                                : "Download file to computer (will convert first if needed)"
                          }
                        >
                          {(status === 'converting' && pendingAction === 'download') ? (
                            <div className="relative w-4.5 h-4.5 flex items-center justify-center">
                              <svg className="absolute inset-0 w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                <circle
                                  cx="18"
                                  cy="18"
                                  r="16"
                                  fill="none"
                                  className="stroke-white/10"
                                  strokeWidth="3.5"
                                />
                                <circle
                                  cx="18"
                                  cy="18"
                                  r="16"
                                  fill="none"
                                  className="stroke-rose-500 transition-all duration-300"
                                  strokeWidth="3.5"
                                  strokeDasharray="100.5"
                                  strokeDashoffset={100.5 - (progress || 0)}
                                  strokeLinecap="round"
                                />
                              </svg>
                              <span className="text-[7.5px] font-bold font-mono text-rose-400 absolute select-none">
                                {progress}
                              </span>
                            </div>
                          ) : (
                            <Download className="w-4.5 h-4.5" />
                          )}
                        </button>
                      </div>
                    </div>
 
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
                        id="watch-btn-expand-description"
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
                  {(() => {
                    const offlineRecs = history.filter(item => 
                      item.id !== route.videoId && 
                      (item.savedInBrowser || item.downloadUrl || (item.ext && item.quality))
                    );
                    const showOfflineRecs = (activePlayItem?.isOffline || currentVideo?.isCached || !watchDetails) && offlineRecs.length > 0;

                    if (showOfflineRecs) {
                      return offlineRecs.slice(0, 10).map((item) => {
                        const storageId = `${item.id}-${item.quality}-${item.ext}`;
                        const isOfflineSaved = item.savedInBrowser;
                        return (
                          <div 
                            key={storageId} 
                            onClick={() => navigate('watch', { v: item.id })}
                            className="flex gap-2.5 group cursor-pointer"
                          >
                            <div className="relative w-40 aspect-video rounded-lg overflow-hidden bg-slate-900 border border-white/5 shrink-0">
                              {isOfflineSaved ? (
                                <OfflineThumbnail 
                                  storageId={storageId} 
                                  fallbackId={item.id} 
                                  className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                                />
                              ) : (
                                <img 
                                  src={`/api/v5/thumbnail/${item.id}`}
                                  alt={item.title}
                                  className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                                  loading="lazy"
                                />
                              )}
                              {item.duration && (
                                <div className="absolute bottom-1 right-1 bg-black/85 text-[9px] font-bold text-white px-1.5 py-0.5 rounded font-mono">
                                  {isNaN(item.duration) ? item.duration : formatTime(item.duration)}
                                </div>
                              )}
                            </div>
                            
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-bold text-white leading-tight line-clamp-2 group-hover:text-rose-400 transition" title={item.title}>
                                {item.title}
                              </span>
                              <span className="text-[10px] text-slate-400 mt-1 truncate">
                                {isOfflineSaved ? 'Offline Library' : 'Backend Cache'} • {item.quality || '720'}{item.ext === 'mp3' ? 'kbps' : 'p'}
                              </span>
                            </div>
                          </div>
                        );
                      });
                    }

                    return feedVideos.filter(v => v.id !== route.videoId).slice(0, 10).map((video) => (
                      <div 
                        key={video.id} 
                        onClick={() => navigate('watch', { v: video.id })}
                        className="flex gap-2.5 group cursor-pointer"
                      >
                        <div className="relative w-40 aspect-video rounded-lg overflow-hidden bg-slate-900 border border-white/5 shrink-0">
                          <img 
                            src={`/api/v5/thumbnail/${video.id}`} 
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
                    ));
                  })()}
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
                  <span>History</span>
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
                    const itemKey = item.ext ? `${item.id}-${item.quality}-${item.ext}` : item.id;
                    const storageId = item.ext ? `${item.id}-${item.quality}-${item.ext}` : '';
                    const isSaving = storageId ? savingIds.includes(storageId) : false;
                    return (
                      <div 
                        key={itemKey}
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
                              {item.ext ? (
                                <>
                                  {item.quality}{item.ext === 'mp3' ? 'kbps' : 'p'} • {item.ext.toUpperCase()} 
                                  {item.downloadedAt && ` • Saved ${item.downloadedAt}`}
                                  {item.watchedAt && ` • Watched ${item.watchedAt}`}
                                </>
                              ) : (
                                <>Watched {item.watchedAt}</>
                              )}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          {item.savedInBrowser ? (
                            <div className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-extrabold select-none">
                              OFFLINE
                            </div>
                          ) : item.ext ? (
                            <button
                              onClick={() => handleSaveHistoryItemToBrowser(item)}
                              disabled={isSaving}
                              className="px-3 py-1 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-full text-xs font-semibold cursor-pointer border border-white/5 transition"
                            >
                              {isSaving ? 'Saving...' : 'Save Offline'}
                            </button>
                          ) : null}

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

              {/* Default Region Selector */}
              <div className="bg-white/5 p-6 rounded-2xl border border-white/5 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5 select-none">
                  <h3 className="text-sm font-bold text-white">Default YouTube Region</h3>
                  <p className="text-xs text-slate-400 leading-normal">
                    Select the region code to fetch trending and category feeds for. 
                    If set to "Server Default", it will auto-detect your region based on the server IP.
                  </p>
                </div>

                <div className="flex gap-2 mt-2">
                  <select
                    id="yt-region-selector"
                    value={selectedRegion}
                    onChange={(e) => {
                      const region = e.target.value;
                      setSelectedRegion(region);
                      localStorage.setItem('yt-region-code', region);
                    }}
                    className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-100 focus:outline-none focus:border-rose-500/50 cursor-pointer"
                  >
                    <option value="">Server Default (Geolocated)</option>
                    <option value="US">United States (US)</option>
                    <option value="IN">India (IN)</option>
                    <option value="GB">United Kingdom (GB)</option>
                    <option value="CA">Canada (CA)</option>
                    <option value="AU">Australia (AU)</option>
                    <option value="DE">Germany (DE)</option>
                    <option value="FR">France (FR)</option>
                    <option value="JP">Japan (JP)</option>
                    <option value="BR">Brazil (BR)</option>
                    <option value="ZA">South Africa (ZA)</option>
                  </select>
                </div>
              </div>

              {/* Storage & Media Cache Manager */}
              <div className="bg-white/5 p-6 rounded-2xl border border-white/5 flex flex-col gap-5">
                <div className="flex flex-col gap-1.5 select-none">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Database className="w-4.5 h-4.5 text-rose-500" />
                    <span>Storage & Media Cache Manager</span>
                  </h3>
                  <p className="text-xs text-slate-400 leading-normal">
                    Monitor and manage your bandwidth saving backend disk caches and sandboxed offline database storage.
                  </p>
                </div>

                {/* Cache Toggle switch */}
                <div className="flex items-center justify-between p-4 bg-slate-900/40 border border-white/5 rounded-xl select-none">
                  <div className="flex flex-col gap-1 pr-4">
                    <span className="text-xs font-bold text-white">Enable Backend Disk Caching</span>
                    <span className="text-[10px] text-slate-400 leading-normal">
                      Automatically cache streamed videos on the server disk to save data on future plays. If disabled, videos are streamed live without caching.
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={enableBackendCache}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setEnableBackendCache(checked);
                        localStorage.setItem('tubehub_enable_backend_cache', checked ? 'true' : 'false');
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-800 rounded-full peer peer-focus:ring-2 peer-focus:ring-rose-500/25 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-slate-400 peer-checked:after:bg-rose-500 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-950/40 peer-checked:border peer-checked:border-rose-500/35 border border-white/5"></div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-1">
                  {/* Backend Cache Card */}
                  <div className="bg-slate-900/40 border border-white/5 rounded-xl p-4 flex flex-col justify-between gap-3">
                    <div className="flex flex-col gap-1 select-none">
                      <span className="text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Server-Side Cache</span>
                      <span className="text-xl font-black text-white">{formatStorageSize(backendCacheSize.totalBytes)}</span>
                      <span className="text-xs text-slate-400">{backendCacheSize.fileCount} cached media / thumbnail files</span>
                    </div>
                    <button
                      type="button"
                      disabled={isPurgingBackend || backendCacheSize.fileCount === 0}
                      onClick={handlePurgeBackendCache}
                      className="w-full py-2 bg-white/5 hover:bg-rose-950/30 hover:text-rose-400 hover:border-rose-500/30 text-slate-300 disabled:opacity-30 disabled:hover:bg-white/5 disabled:hover:text-slate-300 disabled:hover:border-white/10 rounded-xl text-xs font-bold border border-white/10 transition cursor-pointer select-none"
                    >
                      {isPurgingBackend ? 'Purging Cache...' : 'Purge Backend Cache'}
                    </button>
                  </div>

                  {/* Browser Offline Library Card */}
                  <div className="bg-slate-900/40 border border-white/5 rounded-xl p-4 flex flex-col justify-between gap-3">
                    <div className="flex flex-col gap-1 select-none">
                      <span className="text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Browser Offline Library</span>
                      <span className="text-xl font-black text-white">{formatStorageSize(browserStorageSize.totalBytes)}</span>
                      <span className="text-xs text-slate-400">{browserStorageSize.count} offline saved media items</span>
                    </div>
                    <button
                      type="button"
                      disabled={isClearingBrowser || browserStorageSize.count === 0}
                      onClick={handleClearBrowserStorage}
                      className="w-full py-2 bg-white/5 hover:bg-rose-950/30 hover:text-rose-400 hover:border-rose-500/30 text-slate-300 disabled:opacity-30 disabled:hover:bg-white/5 disabled:hover:text-slate-300 disabled:hover:border-white/10 rounded-xl text-xs font-bold border border-white/10 transition cursor-pointer select-none"
                    >
                      {isClearingBrowser ? 'Clearing Storage...' : 'Clear Offline Library'}
                    </button>
                  </div>
                </div>
              </div>

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

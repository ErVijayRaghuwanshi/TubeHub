import { useState, useEffect, useRef } from 'react';
import { fetchVideoInfo, startConversion, checkConversionStatus } from '../services/api';
import { saveMedia, deleteMedia, hasMedia, getMedia } from '../services/db';

/**
 * Validates a YouTube URL and extracts its 11-character Video ID.
 * @param {string} url 
 * @returns {string|boolean} The video ID if valid, otherwise false.
 */
export const isValidYoutubeUrl = (url) => {
  const match = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : false;
};

// Helper to fetch file as Blob with proxy fallbacks to bypass CORS
const fetchBlobWithProxy = async (targetUrl) => {
  try {
    const res = await fetch(targetUrl);
    if (res.ok) return await res.blob();
  } catch (err) {
    console.warn('Direct blob fetch failed, trying proxy fallbacks...', err);
  }

  const proxyList = [
    `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`,
    `https://thingproxy.freeboard.io/fetch/${targetUrl}`,
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
  ];

  for (const proxy of proxyList) {
    try {
      const res = await fetch(proxy);
      if (res.ok) return await res.blob();
    } catch (err) {
      console.warn(`Proxy failed (${proxy}):`, err);
    }
  }

  throw new Error('CORS restrictions prevented download to browser storage. Please use File System download instead.');
};

export function useYoutubeConverter() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle, validating, parsed, converting, ready, error
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [currentVideo, setCurrentVideo] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState('');

  // Formats states
  const [audioFormats, setAudioFormats] = useState([]);
  const [videoFormats, setVideoFormats] = useState([]);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // null, 'save', 'download'

  // Local Browser Storage States
  const [isSavingToBrowser, setIsSavingToBrowser] = useState(false);
  const [isSavedToBrowser, setIsSavedToBrowser] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savingIds, setSavingIds] = useState([]); // Array of IDs currently being saved from history
  
  // Initialize history from localStorage if available
  const [history, setHistory] = useState(() => {
    try {
      const stored = localStorage.getItem('tubehub_history') || localStorage.getItem('tube2audio_history');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const pollIntervalRef = useRef(null);

  // Sync history with localStorage
  useEffect(() => {
    localStorage.setItem('tubehub_history', JSON.stringify(history));
  }, [history]);

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Sync history stored items with IndexedDB on mount
  useEffect(() => {
    const syncHistoryWithDB = async () => {
      try {
        let changed = false;
        const updated = await Promise.all(history.map(async (item) => {
          const storageId = `${item.id}-${item.quality}-${item.ext}`;
          const saved = await hasMedia(storageId);
          if (item.savedInBrowser !== saved) {
            changed = true;
            return { ...item, savedInBrowser: saved };
          }
          return item;
        }));
        if (changed) {
          setHistory(updated);
        }
      } catch (e) {
        console.error('Error syncing history with IndexedDB:', e);
      }
    };
    syncHistoryWithDB();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check if current selectedFormat is already saved in IndexedDB
  useEffect(() => {
    async function checkSaved() {
      if (currentVideo && selectedFormat) {
        const storageId = `${currentVideo.id}-${selectedFormat.quality}-${selectedFormat.ext}`;
        const saved = await hasMedia(storageId).catch(() => false);
        setIsSavedToBrowser(saved);
      } else {
        setIsSavedToBrowser(false);
      }
    }
    checkSaved();
  }, [currentVideo, selectedFormat, history]);

  // Handle pending action when conversion finishes will be defined below handleSaveToBrowser

  /**
   * Phase 1: Validates YouTube URL and fetches video info metadata (formats & thumbnails)
   */
  const handleConvert = async (overrideUrl) => {
    const activeUrl = overrideUrl || url;
    if (!activeUrl.trim()) {
      setErrorMsg('Please enter a YouTube URL.');
      setStatus('error');
      return;
    }

    const videoId = /^[a-zA-Z0-9_-]{11}$/.test(activeUrl)
      ? activeUrl
      : isValidYoutubeUrl(activeUrl);

    if (!videoId) {
      setErrorMsg('Invalid YouTube URL. Please check the link and try again.');
      setStatus('error');
      return;
    }

    // Reset states for a new parsing run
    setErrorMsg('');
    setProgress(0);
    setDownloadUrl('');
    setCurrentVideo(null);
    setAudioFormats([]);
    setVideoFormats([]);
    setSelectedFormat(null);
    setPendingAction(null);
    setIsSavedToBrowser(false);
    setIsSavingToBrowser(false);
    setSaveError('');
    setStatus('validating');
    
    // Clear any previous intervals
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    try {
      // Fetch info and formats
      const infoData = await fetchVideoInfo(videoId);
      
      const histItem = history.find(item => item.id === infoData.videoId);
      const videoData = {
        id: infoData.videoId,
        title: (infoData.title && infoData.title.startsWith('Cached Video (') && histItem) ? histItem.title : (infoData.title || 'YouTube Video'),
        duration: (infoData.duration === 0 && histItem) ? histItem.duration : (infoData.duration || 'Unknown'),
        thumbnail: `/api/v5/thumbnail/${infoData.videoId}`,
        isCached: infoData.isCached
      };
      
      setCurrentVideo(videoData);

      const audios = infoData.formats?.audio || [];
      const videos = infoData.formats?.video || [];

      if (audios.length === 0 && videos.length === 0) {
        throw new Error('No audio or video formats available for this video.');
      }

      setAudioFormats(audios);
      setVideoFormats(videos);
      
      // Auto-select last used format preference if available
      const lastExt = localStorage.getItem('tubehub_last_ext');
      let lastQuality = localStorage.getItem('tubehub_last_quality');
      const cacheEnabled = localStorage.getItem('tubehub_enable_backend_cache') === 'true';

      // If cache is disabled, downgrade video qualities above 720p
      if (lastExt === 'mp4' && lastQuality && parseInt(lastQuality, 10) > 720 && !cacheEnabled) {
        lastQuality = '720';
      }

      let defaultFormat = null;
      const matches = [...videos, ...audios];
      if (lastExt && lastQuality) {
        defaultFormat = matches.find(f => f.ext === lastExt && String(f.quality) === String(lastQuality));
      }
      if (!defaultFormat) {
        // Fallback: select best video format <= 720p if cache is disabled, otherwise best video format
        if (!cacheEnabled && videos.length > 0) {
          defaultFormat = videos.find(f => f.quality <= 720) || videos[0];
        } else {
          defaultFormat = videos.length > 0 ? videos[0] : (audios.length > 0 ? audios[0] : null);
        }
      }
      setSelectedFormat(defaultFormat);

      // Add or update watch history
      setHistory(prev => {
        const existingIndex = prev.findIndex(item => item.id === videoData.id);
        const nowString = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let updatedItem;
        if (existingIndex !== -1) {
          const existing = prev[existingIndex];
          updatedItem = {
            ...existing,
            title: videoData.title,
            duration: videoData.duration,
            watchedAt: nowString
          };
        } else {
          updatedItem = {
            id: videoData.id,
            title: videoData.title,
            duration: videoData.duration,
            ext: '',
            quality: '',
            downloadedAt: '',
            downloadUrl: '',
            savedInBrowser: false,
            watchedAt: nowString
          };
        }
        const filtered = prev.filter(item => item.id !== videoData.id);
        return [updatedItem, ...filtered].slice(0, 100);
      });
      
      // Stop and let user select their format/quality option
      setStatus('parsed');

    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'An unexpected error occurred.');
      setStatus('error');
    }
  };

  /**
   * Phase 2: Starts actual conversion job for a selected format quality options
   * @param {object} format 
   */
  const handleStartConversion = async (format) => {
    if (!format || !format.token) return;

    setSelectedFormat(format);
    setProgress(0);
    setDownloadUrl('');
    setIsSavedToBrowser(false);
    setSaveError('');
    setStatus('converting');

    try {
      // Start conversion job
      const convertData = await startConversion(format.token);
      const jobId = convertData.jobId;

      if (!jobId) {
        throw new Error('Could not retrieve conversion Job ID from server.');
      }

      // Poll status every 2 seconds
      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusData = await checkConversionStatus(jobId);
          
          setProgress(statusData.progress || 0);

          if (statusData.status === 'completed') {
            clearInterval(pollIntervalRef.current);
            setDownloadUrl(statusData.downloadUrl);
            setStatus('ready');
          } else if (statusData.status === 'failed' || statusData.status === 'error') {
            clearInterval(pollIntervalRef.current);
            throw new Error('Conversion failed on the server.');
          }
        } catch (pollErr) {
          clearInterval(pollIntervalRef.current);
          setErrorMsg(pollErr.message);
          setStatus('error');
        }
      }, 2000);

    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'An unexpected error occurred during conversion.');
      setStatus('error');
    }
  };

  /**
   * Updates current selected format and resets relevant conversion states
   */
  const selectFormat = (format) => {
    setSelectedFormat(format);
    setDownloadUrl('');
    setProgress(0);
    setStatus('parsed');
    setPendingAction(null);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  /**
   * Phase 3: Handles user download action (adds item to history & triggers browser file download)
   */
  const handleDownload = (customUrl) => {
    const urlToUse = (typeof customUrl === 'string') ? customUrl : downloadUrl;
    if (!currentVideo || !selectedFormat) return;

    if (urlToUse) {
      // Trigger download
      const a = document.createElement('a');
      a.href = urlToUse;
      const sanitizedTitle = (currentVideo.title || 'download').replace(/[/?<>\\:*|"]/g, '_');
      a.download = `${sanitizedTitle}.${selectedFormat.ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Update or add download details to the existing history entry (keyed by video ID)
      setHistory(prev => {
        const existingIndex = prev.findIndex(item => item.id === currentVideo.id);
        const nowString = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let updatedItem;
        if (existingIndex !== -1) {
          const existing = prev[existingIndex];
          updatedItem = {
            ...existing,
            ext: selectedFormat.ext,
            quality: selectedFormat.quality,
            downloadedAt: nowString,
            downloadUrl: urlToUse,
            savedInBrowser: isSavedToBrowser
          };
        } else {
          updatedItem = {
            id: currentVideo.id,
            title: currentVideo.title,
            duration: currentVideo.duration,
            ext: selectedFormat.ext,
            quality: selectedFormat.quality,
            downloadedAt: nowString,
            downloadUrl: urlToUse,
            savedInBrowser: isSavedToBrowser,
            watchedAt: ''
          };
        }
        
        const filtered = prev.filter(item => item.id !== currentVideo.id);
        return [updatedItem, ...filtered].slice(0, 100);
      });
    } else {
      setPendingAction('download');
      if (status !== 'converting') {
        handleStartConversion(selectedFormat);
      }
    }
  };

  /**
   * Phase 4: Saves file locally inside browser storage (IndexedDB)
   */
  const handleSaveToBrowser = async (customUrl) => {
    const urlToUse = (typeof customUrl === 'string') ? customUrl : downloadUrl;
    if (!currentVideo || !selectedFormat) return;

    if (urlToUse) {
      setIsSavingToBrowser(true);
      setSaveError('');

      try {
        const blob = await fetchBlobWithProxy(urlToUse);
        const storageId = `${currentVideo.id}-${selectedFormat.quality}-${selectedFormat.ext}`;
        await saveMedia(storageId, blob);

        // Also save thumbnail blob offline
        try {
          const thumbnailUrl = `/api/v5/thumbnail/${currentVideo.id}`;
          const thumbnailBlob = await fetchBlobWithProxy(thumbnailUrl).catch(() => null);
          if (thumbnailBlob) {
            await saveMedia(`${storageId}-thumbnail`, thumbnailBlob);
          }
        } catch (thumbErr) {
          console.warn('Failed to save thumbnail offline:', thumbErr);
        }

        setIsSavedToBrowser(true);

        // Update or add save-offline details to history (keyed by video ID)
        setHistory(prev => {
          const existingIndex = prev.findIndex(item => item.id === currentVideo.id);
          const nowString = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          
          let updatedItem;
          if (existingIndex !== -1) {
            const existing = prev[existingIndex];
            updatedItem = {
              ...existing,
              ext: selectedFormat.ext,
              quality: selectedFormat.quality,
              downloadedAt: nowString,
              downloadUrl: urlToUse,
              savedInBrowser: true
            };
          } else {
            updatedItem = {
              id: currentVideo.id,
              title: currentVideo.title,
              duration: currentVideo.duration,
              ext: selectedFormat.ext,
              quality: selectedFormat.quality,
              downloadedAt: nowString,
              downloadUrl: urlToUse,
              savedInBrowser: true,
              watchedAt: ''
            };
          }
          
          const filtered = prev.filter(item => item.id !== currentVideo.id);
          return [updatedItem, ...filtered].slice(0, 100);
        });

      } catch (err) {
        console.error(err);
        setSaveError(err.message || 'Failed to save to browser storage.');
      } finally {
        setIsSavingToBrowser(false);
      }
    } else {
      setPendingAction('save');
      if (status !== 'converting') {
        handleStartConversion(selectedFormat);
      }
    }
  };

  // Handle pending action when conversion finishes
  useEffect(() => {
    if (status === 'ready' && downloadUrl && pendingAction) {
      const action = pendingAction;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingAction(null); // Clear first to avoid duplicate execution
      if (action === 'save') {
        handleSaveToBrowser(downloadUrl);
      } else if (action === 'download') {
        handleDownload(downloadUrl);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, downloadUrl, pendingAction]);

  /**
   * Phase 5: Deletes file from local browser storage
   */
  const handleDeleteFromBrowser = async (item) => {
    try {
      const storageId = `${item.id}-${item.quality}-${item.ext}`;
      await deleteMedia(storageId);
      try {
        await deleteMedia(`${storageId}-thumbnail`);
      } catch (thumbErr) {
        console.warn('Failed to delete offline thumbnail:', thumbErr);
      }
      
      setHistory(prev => prev.map(histItem => {
        if (histItem.id === item.id && histItem.ext === item.ext && histItem.quality === item.quality) {
          return { ...histItem, savedInBrowser: false };
        }
        return histItem;
      }));
    } catch (err) {
      console.error('Failed to delete media from browser storage:', err);
    }
  };

  /**
   * Saves an existing history item to browser storage.
   */
  const handleSaveHistoryItemToBrowser = async (item) => {
    setSavingIds(prev => [...prev, `${item.id}-${item.quality}-${item.ext}`]);
    try {
      const blob = await fetchBlobWithProxy(item.downloadUrl);
      const storageId = `${item.id}-${item.quality}-${item.ext}`;
      await saveMedia(storageId, blob);

      // Also save thumbnail blob offline
      try {
        const thumbnailUrl = `/api/v5/thumbnail/${item.id}`;
        const thumbnailBlob = await fetchBlobWithProxy(thumbnailUrl).catch(() => null);
        if (thumbnailBlob) {
          await saveMedia(`${storageId}-thumbnail`, thumbnailBlob);
        }
      } catch (thumbErr) {
        console.warn('Failed to save thumbnail offline:', thumbErr);
      }

      setHistory(prev => prev.map(histItem => {
        if (histItem.id === item.id && histItem.ext === item.ext && histItem.quality === item.quality) {
          return { ...histItem, savedInBrowser: true };
        }
        return histItem;
      }));
    } catch (err) {
      console.error('Failed to save history item to browser storage:', err);
      alert(err.message || 'Failed to save to browser storage.');
    } finally {
      setSavingIds(prev => prev.filter(id => id !== `${item.id}-${item.quality}-${item.ext}`));
    }
  };

  /**
   * Retrieves blob from browser IndexedDB and triggers file system download.
   */
  const handleDownloadFromBrowser = async (item) => {
    try {
      const storageId = `${item.id}-${item.quality}-${item.ext}`;
      const blob = await getMedia(storageId);
      if (!blob) {
        throw new Error('This file could not be found in your browser storage.');
      }
      
      const localUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = localUrl;
      const sanitizedTitle = (item.title || 'download').replace(/[/?<>\\:*|"]/g, '_');
      a.download = `${sanitizedTitle}.${item.ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(localUrl);
    } catch (err) {
      console.error('Download from browser storage failed:', err);
      alert(err.message || 'Failed to export file from browser storage.');
    }
  };

  const handleReset = () => {
    setUrl('');
    setStatus('idle');
    setCurrentVideo(null);
    setProgress(0);
    setDownloadUrl('');
    setAudioFormats([]);
    setVideoFormats([]);
    setSelectedFormat(null);
    setPendingAction(null);
    setIsSavedToBrowser(false);
    setIsSavingToBrowser(false);
    setSaveError('');
    setSavingIds([]);
  };

  const deleteHistoryItem = async (itemToDelete) => {
    if (itemToDelete.savedInBrowser) {
      const storageId = `${itemToDelete.id}-${itemToDelete.quality}-${itemToDelete.ext}`;
      try {
        await deleteMedia(storageId);
        await deleteMedia(`${storageId}-thumbnail`);
      } catch (e) {
        console.error('Failed to delete media from browser storage during item deletion:', e);
      }
    }
    setHistory(prev => prev.filter(item => 
      !(item.id === itemToDelete.id && item.ext === itemToDelete.ext && item.quality === itemToDelete.quality)
    ));
  };

  const clearHistory = async () => {
    for (const item of history) {
      if (item.savedInBrowser) {
        const storageId = `${item.id}-${item.quality}-${item.ext}`;
        try {
          await deleteMedia(storageId);
          await deleteMedia(`${storageId}-thumbnail`);
        } catch (e) {}
      }
    }
    setHistory([]);
  };

  return {
    url,
    setUrl,
    status,
    progress,
    errorMsg,
    history,
    currentVideo,
    setCurrentVideo,
    downloadUrl,
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
    handleStartConversion,
    selectFormat,
    handleDownload,
    handleSaveToBrowser,
    handleDeleteFromBrowser,
    handleSaveHistoryItemToBrowser,
    handleDownloadFromBrowser,
    handleReset,
    clearHistory,
    deleteHistoryItem
  };
}

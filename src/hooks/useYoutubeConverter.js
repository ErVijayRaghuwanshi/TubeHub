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

    const videoId = isValidYoutubeUrl(activeUrl);
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
    setIsSavedToBrowser(false);
    setIsSavingToBrowser(false);
    setSaveError('');
    setStatus('validating');
    
    // Clear any previous intervals
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    try {
      // Fetch info and formats
      const infoData = await fetchVideoInfo(videoId);
      
      const videoData = {
        id: infoData.videoId,
        title: infoData.title || 'YouTube Video',
        duration: infoData.duration || 'Unknown',
        thumbnail: `https://img.youtube.com/vi/${infoData.videoId}/hqdefault.jpg`
      };
      
      setCurrentVideo(videoData);

      const audios = infoData.formats?.audio || [];
      const videos = infoData.formats?.video || [];

      if (audios.length === 0 && videos.length === 0) {
        throw new Error('No audio or video formats available for this video.');
      }

      setAudioFormats(audios);
      setVideoFormats(videos);
      
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
   * Phase 3: Handles user download action (adds item to history)
   */
  const handleDownload = () => {
    if (!currentVideo || !selectedFormat) return;

    // Add to history list if not already present
    const exists = history.some(item => item.id === currentVideo.id && item.ext === selectedFormat.ext && item.quality === selectedFormat.quality);
    if (!exists) {
      const newHistory = [
        {
          id: currentVideo.id,
          title: currentVideo.title,
          duration: currentVideo.duration,
          ext: selectedFormat.ext,
          quality: selectedFormat.quality,
          downloadedAt: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          downloadUrl: downloadUrl,
          savedInBrowser: isSavedToBrowser
        },
        ...history
      ].slice(0, 100);
      
      setHistory(newHistory);
    }
  };

  /**
   * Phase 4: Saves file locally inside browser storage (IndexedDB)
   */
  const handleSaveToBrowser = async () => {
    if (!currentVideo || !selectedFormat || !downloadUrl) return;

    setIsSavingToBrowser(true);
    setSaveError('');

    try {
      const blob = await fetchBlobWithProxy(downloadUrl);
      const storageId = `${currentVideo.id}-${selectedFormat.quality}-${selectedFormat.ext}`;
      
      await saveMedia(storageId, blob);
      setIsSavedToBrowser(true);

      // Add to history (marking as saved in browser)
      const exists = history.some(item => item.id === currentVideo.id && item.ext === selectedFormat.ext && item.quality === selectedFormat.quality);
      
      if (exists) {
        setHistory(prev => prev.map(item => {
          if (item.id === currentVideo.id && item.ext === selectedFormat.ext && item.quality === selectedFormat.quality) {
            return { ...item, savedInBrowser: true };
          }
          return item;
        }));
      } else {
        const newHistory = [
          {
            id: currentVideo.id,
            title: currentVideo.title,
            duration: currentVideo.duration,
            ext: selectedFormat.ext,
            quality: selectedFormat.quality,
            downloadedAt: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            downloadUrl: downloadUrl,
            savedInBrowser: true
          },
          ...history
        ].slice(0, 100);
        setHistory(newHistory);
      }

    } catch (err) {
      console.error(err);
      setSaveError(err.message || 'Failed to save to browser storage.');
    } finally {
      setIsSavingToBrowser(false);
    }
  };

  /**
   * Phase 5: Deletes file from local browser storage
   */
  const handleDeleteFromBrowser = async (item) => {
    try {
      const storageId = `${item.id}-${item.quality}-${item.ext}`;
      await deleteMedia(storageId);
      
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
      // Sanitize filename for operating system compatibility
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
      } catch (e) {
        console.error('Failed to delete media from browser storage during item deletion:', e);
      }
    }
    setHistory(prev => prev.filter(item => 
      !(item.id === itemToDelete.id && item.ext === itemToDelete.ext && item.quality === itemToDelete.quality)
    ));
  };

  const clearHistory = async () => {
    // Optionally delete files from IndexedDB when clearing history
    for (const item of history) {
      if (item.savedInBrowser) {
        const storageId = `${item.id}-${item.quality}-${item.ext}`;
        try {
          await deleteMedia(storageId);
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
  };
}

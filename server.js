import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { exec, spawn } from 'child_process';
import youtubedl from 'youtube-dl-exec';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR);
}

// Ensure subdirectories exist
const cacheSubdir = path.join(DOWNLOADS_DIR, 'cache');
if (!fs.existsSync(cacheSubdir)) {
  fs.mkdirSync(cacheSubdir, { recursive: true });
}

// Migrate legacy downloads (downloads/[videoId]) to persistent cache (downloads/cache/[videoId])
try {
  const items = fs.readdirSync(DOWNLOADS_DIR);
  items.forEach(item => {
    if (item === 'cache' || item === 'temp' || item === 'cookies.txt') return;
    const oldPath = path.join(DOWNLOADS_DIR, item);
    const newPath = path.join(cacheSubdir, item);
    try {
      fs.renameSync(oldPath, newPath);
      console.log(`Migrated legacy download asset ${item} to persistent cache directory`);
    } catch (e) {
      console.warn(`Failed to migrate legacy asset ${item}:`, e.message);
    }
  });
} catch (err) {
  console.warn('Failed to perform legacy download assets migration:', err.message);
}

// Helper to get or create a video-specific persistent cache directory within downloads/cache
const getVideoDir = (videoId) => {
  const dir = path.join(DOWNLOADS_DIR, 'cache', videoId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};



// Detect FFmpeg presence
exec('ffmpeg -version', (err) => {
  if (!err) {
    console.log('FFmpeg is available on the system.');
  } else {
    console.log('FFmpeg is NOT available on the system. Audio/Video conversion might fail outside the container.');
  }
});

// Cache database for active background streams
const cacheJobs = {};
// Jobs database
const jobs = {};

// Helper to get base yt-dlp arguments/options
function getBaseYtdlOpts() {
  const opts = {
    noCheckCertificates: true,
    noWarnings: true
  };
  const cookiesPath = path.join(process.cwd(), 'cookies.txt');
  const downloadsCookiesPath = path.join(DOWNLOADS_DIR, 'cookies.txt');
  
  let selectedCookies = null;
  if (fs.existsSync(cookiesPath)) {
    selectedCookies = cookiesPath;
  } else if (fs.existsSync(downloadsCookiesPath)) {
    selectedCookies = downloadsCookiesPath;
  }

  if (selectedCookies) {
    try {
      let content = fs.readFileSync(selectedCookies, 'utf8');
      if (content && !content.trim().startsWith('#')) {
        console.log(`Fixing cookies file formatting for: ${selectedCookies}`);
        content = '# Netscape HTTP Cookie File\n' + content;
        fs.writeFileSync(selectedCookies, content, 'utf8');
      }
    } catch (e) {
      console.warn('Failed to auto-fix cookies header:', e);
    }
    opts.cookies = selectedCookies;
  }
  return opts;
}

// YouTube API Key configuration
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

// Helper to get API Key (checks environment variable or request header)
function getYouTubeApiKey(req) {
  return YOUTUBE_API_KEY || req.headers['x-youtube-api-key'] || '';
}

// Server region geolocation detection (on startup)
let serverRegion = 'US';
async function detectRegion() {
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (res.ok) {
      const data = await res.json();
      if (data.country_code) {
        serverRegion = data.country_code;
        console.log(`Detected server region: ${serverRegion}`);
      }
    }
  } catch (err) {
    console.warn('Failed to detect region from ipapi, falling back to US:', err.message);
  }
}
detectRegion();

// ----------------------------------------------------
// YouTube Data API Proxy Endpoints
// ----------------------------------------------------

// GET trending/popular videos
app.get('/api/v5/youtube/trending', async (req, res) => {
  const apiKey = getYouTubeApiKey(req);
  if (!apiKey) {
    return res.status(400).json({ success: false, message: 'YouTube API Key is required.' });
  }

  const { pageToken = '', regionCode = serverRegion, categoryId = '' } = req.query;
  let url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&chart=mostPopular&regionCode=${regionCode}&maxResults=12&key=${apiKey}`;
  if (pageToken) url += `&pageToken=${pageToken}`;
  if (categoryId) url += `&videoCategoryId=${categoryId}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`YouTube API returned status ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Trending fetch failed:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch trending videos.' });
  }
});

// GET search videos (enriched with duration & stats)
app.get('/api/v5/youtube/search', async (req, res) => {
  const apiKey = getYouTubeApiKey(req);
  if (!apiKey) {
    return res.status(400).json({ success: false, message: 'YouTube API Key is required.' });
  }

  const { q, pageToken = '', maxResults = 12 } = req.query;
  if (!q) {
    return res.status(400).json({ success: false, message: 'Missing query parameter q.' });
  }

  try {
    let searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=${maxResults}&key=${apiKey}`;
    if (pageToken) searchUrl += `&pageToken=${pageToken}`;

    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      throw new Error(`YouTube Search API returned status ${searchRes.status}`);
    }
    const searchData = await searchRes.json();

    if (!searchData.items || searchData.items.length === 0) {
      return res.json(searchData);
    }

    // Enrich search results with video statistics & durations
    const videoIds = searchData.items.map(item => item.id.videoId).filter(Boolean).join(',');
    if (videoIds) {
      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${videoIds}&key=${apiKey}`;
      const detailsRes = await fetch(detailsUrl);
      if (detailsRes.ok) {
        const detailsData = await detailsRes.json();
        const detailsMap = {};
        detailsData.items?.forEach(video => {
          detailsMap[video.id] = {
            statistics: video.statistics,
            contentDetails: video.contentDetails
          };
        });

        // Merge details into search items and flatten structure to match trending endpoint format
        searchData.items = searchData.items.map(item => {
          const videoId = item.id.videoId;
          const details = detailsMap[videoId];
          return {
            ...item,
            id: videoId,
            statistics: details?.statistics,
            contentDetails: details?.contentDetails
          };
        }).filter(item => item.id);
      }
    }

    res.json(searchData);
  } catch (err) {
    console.error('Search fetch failed:', err);
    res.status(500).json({ success: false, message: 'Failed to search videos.' });
  }
});

// GET search suggestions proxy
app.get('/api/v5/youtube/suggest', async (req, res) => {
  const { q = '' } = req.query;
  if (!q) {
    return res.json([]);
  }
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google suggests API returned status ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Suggestions proxy failed:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch suggestions.' });
  }
});

// GET video thumbnail proxy with backend caching
app.get('/api/v5/thumbnail/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const thumbnailPath = path.join(getVideoDir(videoId), 'thumbnail.jpg');

  try {
    // 1. If thumbnail is cached on backend, serve it directly
    if (fs.existsSync(thumbnailPath)) {
      return res.sendFile(thumbnailPath);
    }

    // 2. Fetch from YouTube and save to local backend cache
    const url = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    const response = await fetch(url);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(thumbnailPath, buffer);
      return res.sendFile(thumbnailPath);
    }
    
    throw new Error(`YouTube thumbnail fetch returned status ${response.status}`);
  } catch (err) {
    console.error(`Failed to fetch/cache thumbnail for video ${videoId}:`, err);
    res.status(404).send('Thumbnail not found.');
  }
});// GET channel avatar proxy with backend caching
app.get('/api/v5/channel/avatar/:channelId', async (req, res) => {
  const { channelId } = req.params;
  const avatarPath = path.join(DOWNLOADS_DIR, `channel_avatar_${channelId}.jpg`);

  try {
    // 1. Serve cached avatar if it exists
    if (fs.existsSync(avatarPath)) {
      return res.sendFile(avatarPath);
    }

    const apiKey = getYouTubeApiKey(req);
    // 2. Fetch using YouTube API key if configured
    if (!apiKey) {
      return res.redirect(`https://ui-avatars.com/api/?name=${channelId}&background=f43f5e&color=fff`);
    }

    const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`YouTube channel fetch returned status ${response.status}`);
    }
    const data = await response.json();
    const items = data.items || [];
    if (items.length > 0) {
      const avatarUrl = items[0].snippet?.thumbnails?.default?.url;
      if (avatarUrl) {
        const imageRes = await fetch(avatarUrl);
        if (imageRes.ok) {
          const arrayBuffer = await imageRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          fs.writeFileSync(avatarPath, buffer);
          return res.sendFile(avatarPath);
        }
      }
    }
    return res.redirect(`https://ui-avatars.com/api/?name=Channel&background=f43f5e&color=fff`);
  } catch (err) {
    console.error(`Failed to fetch/cache channel avatar for ${channelId}:`, err);
    return res.redirect(`https://ui-avatars.com/api/?name=Channel&background=f43f5e&color=fff`);
  }
});

// GET single video details
app.get('/api/v5/youtube/video/:videoId', async (req, res) => {
  const apiKey = getYouTubeApiKey(req);
  if (!apiKey) {
    return res.status(400).json({ success: false, message: 'YouTube API Key is required.' });
  }

  const { videoId } = req.params;
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`YouTube Video API returned status ${response.status}`);
    }
    const data = await response.json();
    const video = data.items?.[0] || null;
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }
    res.json(video);
  } catch (err) {
    console.error('Video details fetch failed:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch video details.' });
  }
});

// GET comment threads for a video
app.get('/api/v5/youtube/comments/:videoId', async (req, res) => {
  const apiKey = getYouTubeApiKey(req);
  if (!apiKey) {
    return res.status(400).json({ success: false, message: 'YouTube API Key is required.' });
  }

  const { videoId } = req.params;
  const { pageToken = '' } = req.query;
  try {
    let url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${videoId}&maxResults=20&order=relevance&textFormat=plainText&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`YouTube Comments API returned status ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Comments fetch failed:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch comments.' });
  }
});

// ----------------------------------------------------
// Privacy Stream Proxy with Background Caching
// ----------------------------------------------------

// Helper to write cache metadata JSON file (storing client-controlled TTL)
const writeCacheMetadata = (cachePath, ttl) => {
  if (!ttl) return;
  const jsonPath = cachePath + '.json';
  let expiresAt = null;

  if (ttl === 'infinite' || ttl === 'never' || ttl === '-1') {
    expiresAt = null;
  } else {
    const hours = parseFloat(ttl);
    if (!isNaN(hours) && hours > 0) {
      expiresAt = Date.now() + hours * 60 * 60 * 1000;
    }
  }

  try {
    fs.writeFileSync(jsonPath, JSON.stringify({ ttl, expiresAt }));
    console.log(`Wrote cache metadata for ${path.basename(cachePath)} with TTL: ${ttl} (${expiresAt ? new Date(expiresAt).toISOString() : 'infinite'})`);
  } catch (err) {
    console.error(`Failed to write cache metadata:`, err);
  }
};

// Helper to spawn a background cache download job using yt-dlp
function triggerBackgroundCacheDownload(videoId, quality, ext, cachePath, jobKey, ttl) {
  console.log(`Starting background cache download for format ${quality}.${ext} for video: ${videoId}`);
  let flags = {
    ...getBaseYtdlOpts(),
    output: cachePath
  };
  if (ext === 'mp3') {
    flags.extractAudio = true;
    flags.audioFormat = 'mp3';
    flags.audioQuality = `${quality}K`;
  } else {
    flags.format = `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best`;
    flags.mergeOutputFormat = 'mp4';
  }

  const child = youtubedl.exec(`https://www.youtube.com/watch?v=${videoId}`, flags);
  const job = {
    child,
    progress: 0,
    lastActive: Date.now(),
    filename: cachePath
  };
  cacheJobs[jobKey] = job;

  child.stdout.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
    if (match) {
      const percentage = parseFloat(match[1]);
      job.progress = Math.min(percentage, 99);
    }
  });

  child.then(() => {
    if (cacheJobs[jobKey] === job) {
      delete cacheJobs[jobKey];
    }
    writeCacheMetadata(cachePath, ttl);
    console.log(`Background cache download completed for format ${quality}.${ext} for video: ${videoId}`);
  }).catch((err) => {
    if (cacheJobs[jobKey] === job) {
      delete cacheJobs[jobKey];
    }
    if (fs.existsSync(cachePath)) {
      try { fs.unlinkSync(cachePath); } catch (e) {}
    }
    console.error(`Background cache download failed for format ${quality}.${ext} for video: ${videoId}`, err);
  });
}

// Helper to parse MP4 boxes from a buffer to get init and index ranges
function getMP4Ranges(buffer) {
  let offset = 0;
  let initEnd = 0;
  let indexStart = 0;
  let indexEnd = 0;

  while (offset < buffer.length - 8) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('utf8', offset + 4, offset + 8);
    if (size === 0 || size > 1000000) break;

    if (type === 'ftyp' || type === 'moov') {
      initEnd = offset + size;
    } else if (type === 'sidx') {
      indexStart = offset;
      indexEnd = offset + size;
      break;
    }
    offset += size;
  }

  return {
    initRange: `0-${initEnd - 1}`,
    indexRange: `${indexStart}-${indexEnd - 1}`
  };
}

// Fetch first 10KB of a URL to extract MP4 DASH ranges
async function getRangesForUrl(streamUrl) {
  try {
    const res = await fetch(streamUrl, {
      headers: { 'Range': 'bytes=0-9999' }
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`HTTP status ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return getMP4Ranges(buffer);
  } catch (err) {
    console.error('Failed to parse MP4 ranges from URL:', err);
    // Fallback safe defaults if network request fails
    return {
      initRange: '0-999',
      indexRange: '1000-1999'
    };
  }
}

// YouTube CDN HTTPS range proxy
app.get('/api/v5/youtube-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send('Missing url parameter.');
  }
  
  try {
    const parsedUrl = new URL(url);
    const headers = {};
    
    // Forward the Range header if present
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }
    
    // Ensure we send standard User-Agent or match base options
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    
    const options = {
      method: 'GET',
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: headers
    };
    
    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
      console.error('YouTube CDN proxy request failed:', err);
      if (!res.headersSent) {
        res.status(500).send('Proxy streaming failed.');
      }
    });
    
    req.on('close', () => {
      proxyReq.destroy();
    });
    
    proxyReq.end();
    
  } catch (err) {
    console.error('Failed to proxy YouTube CDN request:', err);
    if (!res.headersSent) {
      res.status(400).send('Invalid URL.');
    }
  }
});

// Dynamic proxy DASH manifest generator
app.get('/api/v5/stream/:videoId/manifest.mpd', async (req, res) => {
  const { videoId } = req.params;
  const { cache = 'false', quality = '720', ext = 'mp4', ttl } = req.query;
  
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Fetch video metadata
    const output = await youtubedl(videoUrl, {
      ...getBaseYtdlOpts(),
      dumpSingleJson: true
    });

    const formats = output.formats || [];
    
    // Find the best audio-only MP4 format (AAC)
    const audioFormat = formats
      .filter(f => f.acodec && f.acodec !== 'none' && f.vcodec === 'none' && (f.ext === 'm4a' || f.acodec.startsWith('mp4a')))
      .sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];

    if (!audioFormat) {
      return res.status(404).send('DASH compatible audio format not found.');
    }

    // Find the best video-only MP4 format (AVC/H264) for each of the standard target qualities: 1080, 720, 480, 360
    const targetQualities = [1080, 720, 480, 360];
    const uniqueVideoFormats = [];
    const seenFormatIds = new Set();

    for (const q of targetQualities) {
      const bestF = formats
        .filter(f => f.vcodec && f.vcodec !== 'none' && f.acodec === 'none' && f.ext === 'mp4' && f.vcodec.startsWith('avc1'))
        .filter(f => f.height && f.height <= q)
        .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0))[0];

      if (bestF && !seenFormatIds.has(bestF.format_id)) {
        seenFormatIds.add(bestF.format_id);
        bestF.standardQuality = q;
        uniqueVideoFormats.push(bestF);
      }
    }

    if (uniqueVideoFormats.length === 0) {
      return res.status(404).send('DASH compatible video formats not found.');
    }

    // Fetch index ranges in parallel for audio and all unique video formats
    const rangeRequests = [
      getRangesForUrl(audioFormat.url),
      ...uniqueVideoFormats.map(f => getRangesForUrl(f.url))
    ];

    const rangeResults = await Promise.all(rangeRequests);
    const audioRanges = rangeResults[0];
    const videoRangesList = rangeResults.slice(1);

    const duration = output.duration || 0;
    const host = req.get('host');
    const protocol = req.protocol;
    const proxyBase = `${protocol}://${host}/api/v5/youtube-proxy`;

    const audioProxyUrl = `${proxyBase}?url=${encodeURIComponent(audioFormat.url)}`;

    // Build the video representations XML blocks
    const videoRepresentations = uniqueVideoFormats.map((f, index) => {
      const videoRanges = videoRangesList[index];
      const videoProxyUrl = `${proxyBase}?url=${encodeURIComponent(f.url)}`;
      return `      <Representation id="video-${f.standardQuality}" bandwidth="${Math.round((f.tbr || 500) * 1000)}" codecs="${f.vcodec}" width="${f.width || 1280}" height="${f.height || 720}" frameRate="${f.fps || 30}">
        <BaseURL>${videoProxyUrl.replace(/&/g, '&amp;')}</BaseURL>
        <SegmentBase indexRange="${videoRanges.indexRange}">
          <Initialization range="${videoRanges.initRange}"/>
        </SegmentBase>
      </Representation>`;
    }).join('\n');

    const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" mediaPresentationDuration="PT${duration}S" minBufferTime="PT2.0S">
  <Period>
    <!-- Video Adaptation Set with multiple resolutions -->
    <AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
${videoRepresentations}
    </AdaptationSet>
    <!-- Audio Track -->
    <AdaptationSet mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
      <Representation id="audio" bandwidth="${Math.round((audioFormat.tbr || 128) * 1000)}" codecs="${audioFormat.acodec}" audioSamplingRate="${audioFormat.asr || 44100}">
        <BaseURL>${audioProxyUrl.replace(/&/g, '&amp;')}</BaseURL>
        <SegmentBase indexRange="${audioRanges.indexRange}">
          <Initialization range="${audioRanges.initRange}"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

    res.setHeader('Content-Type', 'application/dash+xml');
    res.send(mpd);

    // Trigger background cache download in parallel if cache=true is requested (for the selected initial quality)
    const cachePath = path.join(getVideoDir(videoId), `cache_${quality}.${ext}`);
    const jobKey = `${videoId}_${quality}_${ext}`;
    
    if (cache === 'true' && !cacheJobs[jobKey] && !fs.existsSync(cachePath)) {
      triggerBackgroundCacheDownload(videoId, quality, ext, cachePath, jobKey, ttl);
    }
    
  } catch (err) {
    console.error('Failed to generate dynamic proxy DASH manifest:', err);
    if (!res.headersSent) {
      res.status(500).send('Error generating manifest.');
    }
  }
});

app.get('/api/v5/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { ext = 'mp4', quality = '720', cache = 'false', ttl } = req.query;
  const videoDir = getVideoDir(videoId);
  const cachePath = path.join(videoDir, `cache_${quality}.${ext}`);
  const jobKey = `${videoId}_${quality}_${ext}`;

  try {
    // 1. If requested exact file is fully cached, serve it directly
    if (fs.existsSync(cachePath) && !cacheJobs[jobKey]) {
      console.log(`Streaming ${ext} directly from local backend format cache.`);
      writeCacheMetadata(cachePath, ttl); // Update cache expiry
      return res.sendFile(cachePath);
    }

    // 2. Find the highest quality cached MP4 video file for this videoId
    let bestCachedVideoPath = null;
    let bestCachedQuality = -1;
    try {
      const cacheFiles = fs.readdirSync(videoDir);
      for (const file of cacheFiles) {
        if (file.startsWith('cache_') && file.endsWith('.mp4')) {
          const prefix = 'cache_';
          const qualityStr = file.substring(prefix.length, file.length - 4);
          const qVal = parseInt(qualityStr, 10);
          if (!isNaN(qVal)) {
            // Ensure this cached file is fully written (no active cache job)
            const targetJobKey = `${videoId}_${qVal}_mp4`;
            if (!cacheJobs[targetJobKey] && qVal > bestCachedQuality) {
              bestCachedQuality = qVal;
              bestCachedVideoPath = path.join(videoDir, file);
            }
          }
        }
      }
    } catch (e) {}

    const reqQualityVal = parseInt(quality, 10) || 720;

    // 3. Serve higher quality cached video directly if requested format is video (mp4) and cached video quality >= requested quality
    if (ext === 'mp4' && bestCachedVideoPath && bestCachedQuality >= reqQualityVal) {
      console.log(`Streaming cached video ${bestCachedQuality}p directly for requested ${quality}p.`);
      return res.sendFile(bestCachedVideoPath);
    }
    // 4. Serve transcoded audio from cached video if requested format is audio (mp3)
    else if (ext === 'mp3' && bestCachedVideoPath) {
      console.log(`Streaming audio from best cached video (${bestCachedQuality}p) transcoded on the fly.`);
      res.setHeader('Content-Type', 'audio/mpeg');
      const ffmpegProcess = spawn('ffmpeg', [
        '-i', bestCachedVideoPath,
        '-b:a', `${quality}k`,
        '-f', 'mp3',
        '-map', 'a',
        'pipe:1'
      ]);

      ffmpegProcess.stdout.pipe(res);

      ffmpegProcess.on('error', (err) => {
        console.error(`FFmpeg streaming error for video ${videoId}:`, err);
      });

      req.on('close', () => {
        ffmpegProcess.kill();
      });
      return;
    }

    // 2. If video/audio is not cached, cache is enabled, and not currently downloading in background, trigger download
    const isCacheEnabled = cache === 'true';
    if (isCacheEnabled && !cacheJobs[jobKey] && !fs.existsSync(cachePath)) {
      triggerBackgroundCacheDownload(videoId, quality, ext, cachePath, jobKey, ttl);
    }

    // 3. Simultaneously, proxy the stream from YouTube via HTTPS Range Request proxy
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const formatSelector = ext === 'mp3'
      ? 'bestaudio[ext=m4a]/bestaudio/best'
      : `best[height<=${quality}][ext=mp4][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]`;

    const streamUrl = await youtubedl(videoUrl, {
      ...getBaseYtdlOpts(),
      getUrl: true,
      format: formatSelector
    });

    const parsedUrl = new URL(streamUrl);
    const headers = {};
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const options = {
      method: 'GET',
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: headers
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`Stream proxy failed for video ${videoId}:`, err);
      if (!res.headersSent) {
        res.status(500).send('Streaming failed.');
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });

    proxyReq.end();

  } catch (error) {
    console.error(`Failed to handle stream request for video ${videoId}:`, error);
    if (!res.headersSent) {
      res.status(500).send('Could not fetch video stream.');
    }
  }
});

// GET cache status/progress for a video
app.get('/api/v5/cache/status/:videoId', (req, res) => {
  const { videoId } = req.params;
  const { ext = 'mp4', quality = '720' } = req.query;
  const cachePath = path.join(getVideoDir(videoId), `cache_${quality}.${ext}`);
  const jobKey = `${videoId}_${quality}_${ext}`;
  const isFullyCached = fs.existsSync(cachePath) && !cacheJobs[jobKey];

  if (isFullyCached) {
    return res.json({ videoId, isCached: true, progress: 100 });
  }

  const job = cacheJobs[jobKey];
  if (job) {
    return res.json({ videoId, isCached: false, progress: job.progress || 0 });
  }

  res.json({ videoId, isCached: false, progress: 0 });
});

// Helper to recursively calculate size and count of files under a directory
const getDirStats = (dirPath) => {
  let totalBytes = 0;
  let fileCount = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        const sub = getDirStats(fullPath);
        totalBytes += sub.totalBytes;
        fileCount += sub.fileCount;
      } else {
        totalBytes += stats.size;
        fileCount++;
      }
    }
  } catch (e) {}
  return { totalBytes, fileCount };
};

// Helper to recursively purge directory contents except active cache jobs and cookies
const purgeDir = (dirPath, activeFilenames) => {
  let deletedCount = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        const deletedInSub = purgeDir(fullPath, activeFilenames);
        deletedCount += deletedInSub;
        // Clean up empty directories
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
        }
      } else {
        if (file === 'cookies.txt') continue;
        const isActivelyDownloading = activeFilenames.some(activePath => 
          path.resolve(activePath) === path.resolve(fullPath)
        );
        if (!isActivelyDownloading) {
          fs.unlinkSync(fullPath);
          deletedCount++;
        }
      }
    }
  } catch (e) {
    console.warn(`Purge directory warning for ${dirPath}:`, e);
  }
  return deletedCount;
};

// GET total size and file count of backend cache directory
app.get('/api/v5/cache/size', (req, res) => {
  try {
    const stats = getDirStats(DOWNLOADS_DIR);
    res.json(stats);
  } catch (err) {
    console.error('Could not calculate cache directory stats:', err);
    res.status(500).json({ success: false, message: 'Could not calculate cache size.' });
  }
});

// DELETE all files from backend cache directory
app.delete('/api/v5/cache', (req, res) => {
  try {
    const activeFilenames = Object.values(cacheJobs).map(job => job.filename);
    const deletedCount = purgeDir(DOWNLOADS_DIR, activeFilenames);
    res.json({ success: true, message: `Successfully cleared ${deletedCount} cache/media files from server.` });
  } catch (err) {
    console.error('Failed to clear cache:', err);
    res.status(500).json({ success: false, message: 'Could not clear cache directory.' });
  }
});

// ----------------------------------------------------
// Original Converter & Download Endpoints
// ----------------------------------------------------

// GET info endpoint (for legacy support or direct checks)
app.get('/api/v5/info/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    console.log(`Fetching info for video: ${videoId}`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    const output = await youtubedl(videoUrl, {
      ...getBaseYtdlOpts(),
      dumpSingleJson: true,
      preferFreeFormats: true,
    });

    // Fetch info and cache the thumbnail on server disk in the background
    const thumbnailPath = path.join(DOWNLOADS_DIR, `thumbnail_${videoId}.jpg`);
    if (!fs.existsSync(thumbnailPath)) {
      fetch(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`)
        .then(async (response) => {
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            fs.writeFileSync(thumbnailPath, buffer);
            console.log(`Pre-cached thumbnail on disk for video ${videoId}`);
          }
        })
        .catch((err) => console.warn('Failed to pre-cache thumbnail:', err));
    }
    
    const audioFormats = [
      { token: `audio-320-${videoId}`, quality: 320, ext: 'mp3' },
      { token: `audio-256-${videoId}`, quality: 256, ext: 'mp3' },
      { token: `audio-128-${videoId}`, quality: 128, ext: 'mp3' }
    ];

    const formats = output.formats || [];
    const videoFormats = [];
    
    const heights = [1080, 720, 480, 360];
    heights.forEach(h => {
      const hasRes = formats.some(f => f.height === h);
      if (hasRes) {
        videoFormats.push({ token: `video-${h}-${videoId}`, quality: h, ext: 'mp4' });
      }
    });

    if (videoFormats.length === 0) {
      const hasMuxed = formats.some(f => f.vcodec !== 'none' && f.acodec !== 'none');
      if (hasMuxed) {
        videoFormats.push({ token: `video-720-${videoId}`, quality: 720, ext: 'mp4' });
      }
    }

    const audioFormatsMapped = audioFormats.map(f => ({
      ...f,
      isCached: fs.existsSync(path.join(DOWNLOADS_DIR, videoId, `cache_${f.quality}.${f.ext}`)) && !cacheJobs[`${videoId}_${f.quality}_${f.ext}`]
    }));

    const videoFormatsMapped = videoFormats.map(f => ({
      ...f,
      isCached: fs.existsSync(path.join(DOWNLOADS_DIR, videoId, `cache_${f.quality}.${f.ext}`)) && !cacheJobs[`${videoId}_${f.quality}_${f.ext}`]
    }));

    const isCachedOnServer = audioFormatsMapped.some(f => f.isCached) || videoFormatsMapped.some(f => f.isCached);

    res.json({
      videoId,
      title: output.title,
      duration: parseInt(output.duration) || 0,
      isCached: isCachedOnServer,
      formats: {
        audio: audioFormatsMapped,
        video: videoFormatsMapped
      }
    });
  } catch (error) {
    console.error('Info fetch failed:', error);

    // OFFLINE FALLBACK: Check if cached file exists
    let cachedFiles = [];
    const videoDir = path.join(DOWNLOADS_DIR, videoId);
    try {
      if (fs.existsSync(videoDir)) {
        const files = fs.readdirSync(videoDir);
        cachedFiles = files.filter(f => f.startsWith('cache_'));
      }
    } catch (e) {}

    if (cachedFiles.length > 0) {
      console.log(`Offline fallback: serving info from backend cache for ${videoId}`);

      const audioFormats = [];
      const videoFormats = [];
      
      cachedFiles.forEach(file => {
        const parts = file.replace('cache_', '').split('.');
        const qualityStr = parts[0];
        const ext = parts[1];
        const quality = parseInt(qualityStr);
        if (ext === 'mp3') {
          audioFormats.push({
            token: `audio-${quality}-${videoId}`,
            quality,
            ext,
            isCached: true
          });
        } else if (ext === 'mp4') {
          videoFormats.push({
            token: `video-${quality}-${videoId}`,
            quality,
            ext,
            isCached: true
          });
        }
      });

      return res.json({
        videoId,
        title: `Cached Video (${videoId})`,
        duration: 0,
        isCached: true,
        formats: {
          audio: audioFormats,
          video: videoFormats
        }
      });
    }

    res.status(500).json({ success: false, message: 'Could not fetch YouTube video details.' });
  }
});

// POST convert endpoint
app.post('/api/v5/convert', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: 'Missing token parameter.' });
  }

  const parts = token.split('-');
  if (parts.length < 3) {
    return res.status(400).json({ success: false, message: 'Invalid token structure.' });
  }

  const type = parts[0]; // audio or video
  const quality = parseInt(parts[1]);
  const videoId = parts.slice(2).join('-'); // Handles videoIds containing hyphens

  const jobId = Math.random().toString(36).substring(2, 15);
  jobs[jobId] = {
    status: 'converting',
    progress: 0,
    title: '',
    ext: type === 'audio' ? 'mp3' : 'mp4'
  };

  res.json({ success: true, jobId });

  // Run conversion in background
  runConversionJob(jobId, videoId, type, quality);
});

// GET status endpoint
app.get('/api/v5/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];
  if (!job) {
    return res.status(404).json({ success: false, message: 'Job not found.' });
  }

  res.json({
    status: job.status,
    progress: Math.min(Math.round(job.progress), 100),
    downloadUrl: `/api/v5/download/${jobId}`
  });
});

// GET download endpoint
app.get('/api/v5/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];
  if (!job || job.status !== 'completed' || !job.filePath) {
    return res.status(404).send('File not found or conversion not completed.');
  }

  const safeTitle = (job.title || 'download').replace(/[/?<>\\*|"]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.${job.ext}"`);
  res.sendFile(job.filePath);
});

// Background job executor using youtube-dl-exec (yt-dlp)
// Background job executor using youtube-dl-exec (yt-dlp)
async function runConversionJob(jobId, videoId, type, quality) {
  const job = jobs[jobId];
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const outputPath = path.join(getVideoDir(videoId), `${jobId}.${job.ext}`);
    job.filePath = outputPath;

    // Fetch title info
    try {
      const output = await youtubedl(videoUrl, {
        ...getBaseYtdlOpts(),
        dumpSingleJson: true
      });
      job.title = output.title;
    } catch (e) {
      console.warn('Metadata fetch failed during job, using video ID title:', e);
      job.title = `Video ${videoId}`;
    }

    // ---------------------------------------------------------
    // DATA SAVER CHECK: Try to resolve instantly from cache
    // ---------------------------------------------------------
    const videoDir = getVideoDir(videoId);
    const cachePath = path.join(videoDir, `cache_${quality}.${job.ext}`);
    const exactJobKey = `${videoId}_${quality}_${job.ext}`;
    const isExactCacheComplete = fs.existsSync(cachePath) && !cacheJobs[exactJobKey];

    if (isExactCacheComplete) {
      fs.copyFileSync(cachePath, outputPath);
      job.progress = 100;
      job.status = 'completed';
      console.log(`Job ${jobId} (${type}) resolved instantly from exact format cache.`);
      return;
    }

    // If audio is requested, we can also extract it from ANY cached video file
    if (type === 'audio') {
      let bestCachedVideoPath = null;
      let bestCachedQuality = -1;
      try {
        if (fs.existsSync(videoDir)) {
          const files = fs.readdirSync(videoDir);
          for (const file of files) {
            if (file.startsWith('cache_') && file.endsWith('.mp4')) {
              const qStr = file.replace('cache_', '').replace('.mp4', '');
              const qVal = parseInt(qStr, 10);
              const targetJobKey = `${videoId}_${qVal}_mp4`;
              if (!isNaN(qVal) && !cacheJobs[targetJobKey] && qVal > bestCachedQuality) {
                bestCachedQuality = qVal;
                bestCachedVideoPath = path.join(videoDir, file);
              }
            }
          }
        }
      } catch (e) {}

      if (bestCachedVideoPath) {
        // Transcode the locally cached video to mp3 instantly using local ffmpeg
        console.log(`Transcoding local cache file ${bestCachedVideoPath} to audio job ${jobId}...`);
        const ffmpegProcess = spawn('ffmpeg', [
          '-i', bestCachedVideoPath,
          '-b:a', `${quality}k`,
          '-f', 'mp3',
          '-y',
          outputPath
        ]);

        ffmpegProcess.on('close', (code) => {
          if (code === 0) {
            job.progress = 100;
            job.status = 'completed';
            console.log(`Job ${jobId} (audio) resolved instantly via local transcode.`);
          } else {
            console.error(`Local transcode failed with code ${code}. Falling back to downloading.`);
            // Trigger download to cache path and wait for it
            if (!cacheJobs[exactJobKey] && !fs.existsSync(cachePath)) {
              triggerBackgroundCacheDownload(videoId, quality, job.ext, cachePath, exactJobKey, '24');
            }
            waitAndCopyCache(jobId, cachePath, exactJobKey, outputPath);
          }
        });
        return;
      }
    }

    // Fallback: standard download from YouTube to cache path, and then copy
    if (!cacheJobs[exactJobKey] && !fs.existsSync(cachePath)) {
      triggerBackgroundCacheDownload(videoId, quality, job.ext, cachePath, exactJobKey, '24');
    }

    await waitAndCopyCache(jobId, cachePath, exactJobKey, outputPath);

  } catch (error) {
    console.error(`Conversion job ${jobId} failed:`, error);
    job.status = 'failed';
  }
}

// Helper to wait for a cache download job to complete, syncing progress, and copy result
async function waitAndCopyCache(jobId, cachePath, exactJobKey, outputPath) {
  const job = jobs[jobId];
  if (cacheJobs[exactJobKey]) {
    console.log(`Job ${jobId} is waiting for cache download job ${exactJobKey} to complete...`);
    while (cacheJobs[exactJobKey]) {
      job.progress = cacheJobs[exactJobKey].progress || 0;
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (fs.existsSync(cachePath)) {
    fs.copyFileSync(cachePath, outputPath);
    job.progress = 100;
    job.status = 'completed';
    console.log(`Job ${jobId} resolved successfully from completed cache.`);
  } else {
    job.status = 'failed';
    console.error(`Job ${jobId} failed because cache file was not created.`);
  }
}

// ----------------------------------------------------
// Scheduled Downloads & Cache Cleanup
// ----------------------------------------------------
const CLEANUP_THRESHOLD_HOURS = parseInt(process.env.CLEANUP_THRESHOLD_HOURS) || 24;
const CLEANUP_INTERVAL_MINUTES = parseInt(process.env.CLEANUP_INTERVAL_MINUTES) || 60;

function startCleanupSchedule() {
  console.log(`Scheduling background cleanup every ${CLEANUP_INTERVAL_MINUTES} minutes. Default TTL is ${CLEANUP_THRESHOLD_HOURS} hours.`);
  
  setInterval(() => {
    console.log('Running scheduled cache and download cleanup...');
    const now = Date.now();
    const defaultThresholdMs = CLEANUP_THRESHOLD_HOURS * 60 * 60 * 1000;

    // 1. Clean files direct under downloads/ (like channel avatars or old conversions)
    try {
      if (fs.existsSync(DOWNLOADS_DIR)) {
        const files = fs.readdirSync(DOWNLOADS_DIR);
        files.forEach(file => {
          const filePath = path.join(DOWNLOADS_DIR, file);
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            if (file === 'cookies.txt') return;
            const ageMs = now - stats.mtimeMs;
            if (ageMs > defaultThresholdMs) {
              fs.unlinkSync(filePath);
              console.log(`Deleted stale download file: ${file} (Age: ${(ageMs / (60 * 60 * 1000)).toFixed(1)} hours)`);
            }
          }
        });
      }
    } catch (e) {
      console.error('Failed to clean root downloads dir:', e);
    }

    // 2. Clean files inside downloads/cache/ [videoId]/ folders
    try {
      const cacheDir = path.join(DOWNLOADS_DIR, 'cache');
      if (fs.existsSync(cacheDir)) {
        const videoDirs = fs.readdirSync(cacheDir);
        videoDirs.forEach(videoId => {
          const videoDir = path.join(cacheDir, videoId);
          if (fs.statSync(videoDir).isDirectory()) {
            const files = fs.readdirSync(videoDir);
            files.forEach(file => {
              if (file.endsWith('.json')) return; // handled with its media file
              if (file === 'thumbnail.jpg') return; // let thumbnail stay, or check its age

              const filePath = path.join(videoDir, file);
              if (fs.statSync(filePath).isFile()) {
                const jsonPath = filePath + '.json';
                let expiresAt = null;
                let hasJson = false;

                if (fs.existsSync(jsonPath)) {
                  try {
                    const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    expiresAt = meta.expiresAt;
                    hasJson = true;
                  } catch (err) {
                    console.warn(`Failed to parse cache metadata for ${file}:`, err);
                  }
                }

                let shouldDelete = false;
                let deleteReason = '';

                if (hasJson) {
                  if (expiresAt === null || expiresAt === -1) {
                    shouldDelete = false; // infinite TTL
                  } else if (now > expiresAt) {
                    shouldDelete = true;
                    deleteReason = `expired based on client TTL`;
                  }
                } else {
                  // Fallback to default threshold hours using file mtime
                  const stats = fs.statSync(filePath);
                  const ageMs = now - stats.mtimeMs;
                  if (ageMs > defaultThresholdMs) {
                    shouldDelete = true;
                    deleteReason = `exceeded default threshold of ${CLEANUP_THRESHOLD_HOURS} hours`;
                  }
                }

                if (shouldDelete) {
                  fs.unlinkSync(filePath);
                  if (fs.existsSync(jsonPath)) {
                    fs.unlinkSync(jsonPath);
                  }
                  console.log(`Deleted stale cache file: ${videoId}/${file} (${deleteReason})`);
                }
              }
            });

            // If video directory is empty (except thumbnail), remove it
            const remaining = fs.readdirSync(videoDir);
            const mediaRemaining = remaining.filter(f => f !== 'thumbnail.jpg' && !f.endsWith('.json'));
            if (mediaRemaining.length === 0) {
              remaining.forEach(f => {
                try { fs.unlinkSync(path.join(videoDir, f)); } catch (e) {}
              });
              fs.rmdirSync(videoDir);
              console.log(`Removed empty cache directory for video: ${videoId}`);
            }
          }
        });
      }
    } catch (e) {
      console.error('Failed to clean cache subdirectories:', e);
    }
  }, CLEANUP_INTERVAL_MINUTES * 60 * 1000);
}

// Helper to convert raw Cookie header string to Netscape format
function parseCookieStringToNetscape(cookieStr) {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# This file was generated automatically from a raw Cookie header',
    '# Domain\tSubdomains\tPath\tSecure\tExpiration\tName\tValue'
  ];
  
  const pairs = cookieStr.split(';');
  pairs.forEach(pair => {
    const trimmed = pair.trim();
    if (!trimmed) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const name = trimmed.substring(0, eqIndex);
    const value = trimmed.substring(eqIndex + 1);
    
    const domain = '.youtube.com';
    const subdomains = 'TRUE';
    const path = '/';
    const secure = name.startsWith('__Secure-') ? 'TRUE' : 'FALSE';
    const expiration = '2147483647'; // Year 2038
    
    lines.push(`${domain}\t${subdomains}\t${path}\t${secure}\t${expiration}\t${name}\t${value}`);
  });
  
  return lines.join('\n');
}

// POST endpoint to parse and import raw YouTube Cookie header
app.post('/api/v5/cookies', (req, res) => {
  const { cookieHeader } = req.body;
  if (!cookieHeader) {
    return res.status(400).json({ success: false, message: 'Missing cookieHeader parameter.' });
  }

  try {
    const netscapeContent = parseCookieStringToNetscape(cookieHeader);
    const cookiesPath = path.join(DOWNLOADS_DIR, 'cookies.txt');
    fs.writeFileSync(cookiesPath, netscapeContent, 'utf8');
    console.log('Successfully generated and saved Netscape cookies.txt from raw header');
    res.json({ success: true, message: 'Cookies imported successfully!' });
  } catch (err) {
    console.error('Failed to import cookies:', err);
    res.status(500).json({ success: false, message: 'Failed to save cookies on the server.' });
  }
});

// Serve static frontend assets from dist folder (production deployment)
app.use(express.static(path.join(__dirname, 'dist')));

// SPA router fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  startCleanupSchedule();
});

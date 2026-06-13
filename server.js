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

// YouTube API Key configuration
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

// Helper to get API Key (checks environment variable or request header)
function getYouTubeApiKey(req) {
  return YOUTUBE_API_KEY || req.headers['x-youtube-api-key'] || '';
}

// ----------------------------------------------------
// YouTube Data API Proxy Endpoints
// ----------------------------------------------------

// GET trending/popular videos
app.get('/api/v5/youtube/trending', async (req, res) => {
  const apiKey = getYouTubeApiKey(req);
  if (!apiKey) {
    return res.status(400).json({ success: false, message: 'YouTube API Key is required.' });
  }

  const { pageToken = '', regionCode = 'US', categoryId = '' } = req.query;
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

app.get('/api/v5/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const cachePath = path.join(DOWNLOADS_DIR, `cache_${videoId}.mp4`);

  try {
    // 1. If video is already fully cached locally, serve it directly
    if (fs.existsSync(cachePath) && !cacheJobs[videoId]) {
      console.log(`Streaming video ${videoId} directly from local backend cache.`);
      return res.sendFile(cachePath);
    }

    // 2. If video is not cached and not currently downloading in background, trigger download
    if (!cacheJobs[videoId] && !fs.existsSync(cachePath)) {
      console.log(`Stating background cache download for video: ${videoId}`);
      const flags = {
        output: cachePath,
        format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        noCheckCertificates: true,
        noWarnings: true
      };

      const child = youtubedl.exec(`https://www.youtube.com/watch?v=${videoId}`, flags);
      cacheJobs[videoId] = child;

      child.then(() => {
        delete cacheJobs[videoId];
        console.log(`Background cache download completed for video: ${videoId}`);
      }).catch((err) => {
        delete cacheJobs[videoId];
        if (fs.existsSync(cachePath)) {
          try { fs.unlinkSync(cachePath); } catch (e) {}
        }
        console.error(`Background cache download failed for video: ${videoId}`, err);
      });
    }

    // 3. Simultaneously, proxy the stream from YouTube via HTTPS Range Request proxy
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const streamUrl = await youtubedl(videoUrl, {
      getUrl: true,
      format: 'best[ext=mp4]/best',
      noCheckCertificates: true,
      noWarnings: true
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

    proxyReq.end();

  } catch (error) {
    console.error(`Failed to handle stream request for video ${videoId}:`, error);
    if (!res.headersSent) {
      res.status(500).send('Could not fetch video stream.');
    }
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
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
    });
    
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

    res.json({
      videoId,
      title: output.title,
      duration: parseInt(output.duration) || 0,
      formats: {
        audio: audioFormats,
        video: videoFormats
      }
    });
  } catch (error) {
    console.error('Info fetch failed:', error);
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
async function runConversionJob(jobId, videoId, type, quality) {
  const job = jobs[jobId];
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const outputPath = path.join(DOWNLOADS_DIR, `${jobId}.${job.ext}`);
    job.filePath = outputPath;

    // Fetch title info
    try {
      const output = await youtubedl(videoUrl, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true
      });
      job.title = output.title;
    } catch (e) {
      console.warn('Metadata fetch failed during job, using video ID title:', e);
      job.title = `Video ${videoId}`;
    }

    // ---------------------------------------------------------
    // DATA SAVER CHECK: Try to resolve instantly from cache
    // ---------------------------------------------------------
    const cachePath = path.join(DOWNLOADS_DIR, `cache_${videoId}.mp4`);
    const isCacheComplete = fs.existsSync(cachePath) && !cacheJobs[videoId];

    if (isCacheComplete) {
      if (type === 'video') {
        fs.copyFileSync(cachePath, outputPath);
        job.progress = 100;
        job.status = 'completed';
        console.log(`Job ${jobId} (video) resolved instantly from cache file.`);
        return;
      } else if (type === 'audio') {
        // Transcode the locally cached video to mp3 instantly using local ffmpeg
        console.log(`Transcoding local cache file ${cachePath} to audio job ${jobId}...`);
        const ffmpegProcess = spawn('ffmpeg', [
          '-i', cachePath,
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
            downloadFromYouTube(jobId, videoUrl, type, quality, outputPath);
          }
        });
        return;
      }
    }

    // Fallback: standard download from YouTube
    await downloadFromYouTube(jobId, videoUrl, type, quality, outputPath);

  } catch (error) {
    console.error(`Conversion job ${jobId} failed:`, error);
    job.status = 'failed';
  }
}

// Download stream executor helper
async function downloadFromYouTube(jobId, videoUrl, type, quality, outputPath) {
  const job = jobs[jobId];
  const flags = {
    output: outputPath,
    noCheckCertificates: true,
    noWarnings: true
  };

  if (type === 'audio') {
    flags.extractAudio = true;
    flags.audioFormat = 'mp3';
    flags.audioQuality = `${quality}K`;
  } else {
    flags.format = `bestvideo[height<=${quality}]+bestaudio/best`;
    flags.mergeOutputFormat = 'mp4';
  }

  console.log(`Downloading stream from YouTube for job ${jobId}...`);
  const child = youtubedl.exec(videoUrl, flags);
  
  child.stdout.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
    if (match) {
      const percentage = parseFloat(match[1]);
      job.progress = Math.min(percentage, 99);
    }
  });

  child.stderr.on('data', (data) => {
    console.warn(`[yt-dlp stderr for job ${jobId}]:`, data.toString());
  });

  await child;

  if (fs.existsSync(outputPath)) {
    job.progress = 100;
    job.status = 'completed';
    console.log(`Job ${jobId} downloaded successfully.`);
  } else {
    throw new Error(`Output file not found after download.`);
  }
}

// ----------------------------------------------------
// Scheduled Downloads & Cache Cleanup
// ----------------------------------------------------
const CLEANUP_THRESHOLD_HOURS = parseInt(process.env.CLEANUP_THRESHOLD_HOURS) || 24;
const CLEANUP_INTERVAL_MINUTES = parseInt(process.env.CLEANUP_INTERVAL_MINUTES) || 60;

function startCleanupSchedule() {
  console.log(`Scheduling background cleanup every ${CLEANUP_INTERVAL_MINUTES} minutes. Files older than ${CLEANUP_THRESHOLD_HOURS} hours will be deleted.`);
  
  setInterval(() => {
    console.log('Running scheduled downloads cleanup...');
    fs.readdir(DOWNLOADS_DIR, (err, files) => {
      if (err) {
        console.error('Failed to read downloads directory for cleanup:', err);
        return;
      }
      
      const now = Date.now();
      const thresholdMs = CLEANUP_THRESHOLD_HOURS * 60 * 60 * 1000;
      
      files.forEach((file) => {
        const filePath = path.join(DOWNLOADS_DIR, file);
        
        fs.stat(filePath, (err, stats) => {
          if (err) {
            console.error(`Failed to stat file ${file} for cleanup:`, err);
            return;
          }
          
          const ageMs = now - stats.mtimeMs;
          if (ageMs > thresholdMs) {
            fs.unlink(filePath, (err) => {
              if (err) {
                console.error(`Failed to delete old file ${file}:`, err);
              } else {
                console.log(`Deleted stale download file: ${file} (Age: ${(ageMs / (60 * 60 * 1000)).toFixed(1)} hours)`);
                
                // Remove job from tracking if applicable
                const jobId = path.basename(file, path.extname(file));
                const baseJobId = jobId.replace('cache_', '').split('_')[0];
                if (jobs[baseJobId]) {
                  delete jobs[baseJobId];
                  console.log(`Removed job ${baseJobId} from tracking database.`);
                }
              }
            });
          }
        });
      });
    });
  }, CLEANUP_INTERVAL_MINUTES * 60 * 1000);
}

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

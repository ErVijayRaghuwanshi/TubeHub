import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import youtubedl from 'youtube-dl-exec';
import { fileURLToPath } from 'url';

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

// Jobs database
const jobs = {};

// GET info endpoint
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
    
    // Group audio formats (we transcode from source to target bitrate)
    const audioFormats = [
      { token: `audio-320-${videoId}`, quality: 320, ext: 'mp3' },
      { token: `audio-256-${videoId}`, quality: 256, ext: 'mp3' },
      { token: `audio-128-${videoId}`, quality: 128, ext: 'mp3' }
    ];

    // Group video formats
    const formats = output.formats || [];
    const videoFormats = [];
    
    const heights = [1080, 720, 480, 360];
    heights.forEach(h => {
      const hasRes = formats.some(f => f.height === h);
      if (hasRes) {
        videoFormats.push({ token: `video-${h}-${videoId}`, quality: h, ext: 'mp4' });
      }
    });

    // Fallback if no specific heights are resolved
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

    // Fetch metadata first to extract title
    try {
      const output = await youtubedl(videoUrl, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true
      });
      job.title = output.title;
    } catch (e) {
      console.warn('Metadata fetch failed during job execution, using default video ID:', e);
      job.title = `Video ${videoId}`;
    }

    // Set up flags for yt-dlp execution
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
      // Best video quality up to requested height + best audio, muxed to mp4
      flags.format = `bestvideo[height<=${quality}]+bestaudio/best`;
      flags.mergeOutputFormat = 'mp4';
    }

    console.log(`Starting yt-dlp download/convert for job ${jobId} (Type: ${type}, Quality: ${quality})...`);
    
    // Spawn the yt-dlp subprocess
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

    // Wait for process completion
    await child;

    // Verify output file existence
    if (fs.existsSync(outputPath)) {
      job.progress = 100;
      job.status = 'completed';
      console.log(`Job ${jobId} completed successfully! Saved to ${outputPath}`);
    } else {
      throw new Error(`Output file not found at ${outputPath}`);
    }

  } catch (error) {
    console.error(`Conversion job ${jobId} failed:`, error);
    job.status = 'failed';
  }
}

// Serve static frontend assets from dist folder (production deployment)
app.use(express.static(path.join(__dirname, 'dist')));

// SPA router fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

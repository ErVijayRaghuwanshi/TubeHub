import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { exec, spawn } from 'child_process';
import ytdl from '@distube/ytdl-core';
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
let hasFfmpeg = false;
exec('ffmpeg -version', (err) => {
  if (!err) {
    hasFfmpeg = true;
    console.log('FFmpeg is available on the system.');
  } else {
    console.log('FFmpeg is NOT available. Media operations will fallback to direct streams (M4A for audio, pre-muxed for video).');
  }
});

// Jobs database
const jobs = {};

// GET info endpoint
app.get('/api/v5/info/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    console.log(`Fetching info for video: ${videoId}`);
    const info = await ytdl.getInfo(videoId);
    
    // Group audio formats (we will transcode from highest source to target bitrate)
    const audioFormats = [
      { token: `audio-320-${videoId}`, quality: 320, ext: 'mp3' },
      { token: `audio-256-${videoId}`, quality: 256, ext: 'mp3' },
      { token: `audio-128-${videoId}`, quality: 128, ext: 'mp3' }
    ];

    // Group video formats
    const formats = info.formats;
    const videoFormats = [];
    
    const heights = [1080, 720, 480, 360];
    heights.forEach(h => {
      const hasRes = formats.some(f => f.height === h);
      if (hasRes) {
        videoFormats.push({ token: `video-${h}-${videoId}`, quality: h, ext: 'mp4' });
      }
    });

    // In case no standard heights found, fallback to pre-muxed formats
    if (videoFormats.length === 0) {
      const hasMuxed = formats.some(f => f.hasVideo && f.hasAudio);
      if (hasMuxed) {
        videoFormats.push({ token: `video-720-${videoId}`, quality: 720, ext: 'mp4' });
      }
    }

    res.json({
      videoId,
      title: info.videoDetails.title,
      duration: parseInt(info.videoDetails.lengthSeconds) || 0,
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

// Background job executor
async function runConversionJob(jobId, videoId, type, quality) {
  const job = jobs[jobId];
  try {
    const info = await ytdl.getInfo(videoId);
    job.title = info.videoDetails.title;
    
    const outputPath = path.join(DOWNLOADS_DIR, `${jobId}.${job.ext}`);
    job.filePath = outputPath;

    if (type === 'audio') {
      const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
      if (!audioFormat) {
        throw new Error('No audio format found.');
      }

      if (hasFfmpeg) {
        const audioStream = ytdl(videoId, { format: audioFormat });
        const ffmpegProcess = spawn('ffmpeg', [
          '-i', 'pipe:0',
          '-b:a', `${quality}k`,
          '-f', 'mp3',
          '-y',
          outputPath
        ]);

        audioStream.pipe(ffmpegProcess.stdin);

        let totalDuration = parseInt(info.videoDetails.lengthSeconds) || 0;
        
        ffmpegProcess.stderr.on('data', (data) => {
          const text = data.toString();
          const match = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
          if (match && totalDuration > 0) {
            const hours = parseInt(match[1]);
            const minutes = parseInt(match[2]);
            const seconds = parseFloat(match[3]);
            const elapsed = hours * 3600 + minutes * 60 + seconds;
            job.progress = Math.min((elapsed / totalDuration) * 100, 99);
          }
        });

        ffmpegProcess.on('close', (code) => {
          if (code === 0) {
            job.progress = 100;
            job.status = 'completed';
          } else {
            console.error(`FFmpeg audio convert failed with exit code ${code}`);
            job.status = 'failed';
          }
        });

        audioStream.on('error', (err) => {
          console.error('Audio stream download error:', err);
          job.status = 'failed';
        });
        
      } else {
        // Fallback: save raw M4A/WebM audio stream if FFmpeg is missing
        const rawExt = audioFormat.container || 'm4a';
        job.ext = rawExt;
        const rawOutputPath = path.join(DOWNLOADS_DIR, `${jobId}.${rawExt}`);
        job.filePath = rawOutputPath;

        const stream = ytdl(videoId, { format: audioFormat });
        const writer = fs.createWriteStream(rawOutputPath);
        
        let downloaded = 0;
        const totalSize = parseInt(audioFormat.contentLength) || 1;

        stream.on('data', (chunk) => {
          downloaded += chunk.length;
          job.progress = Math.min((downloaded / totalSize) * 100, 99);
        });

        stream.pipe(writer);

        writer.on('finish', () => {
          job.progress = 100;
          job.status = 'completed';
        });

        stream.on('error', (err) => {
          console.error('Audio stream raw download error:', err);
          job.status = 'failed';
        });
      }
      
    } else {
      // Video Download & Muxing
      const formats = info.formats;
      
      if (hasFfmpeg) {
        // Download separate high-res video-only and highest audio-only streams and mux them
        const videoFormat = formats.find(f => f.height === quality && f.container === 'mp4' && !f.audioBitrate);
        const audioFormat = ytdl.chooseFormat(formats, { quality: 'highestaudio' });
        
        const actualVideoFormat = videoFormat || ytdl.chooseFormat(formats, { quality: 'highestvideo' });
        
        const videoTempPath = path.join(DOWNLOADS_DIR, `${jobId}_video.tmp`);
        const audioTempPath = path.join(DOWNLOADS_DIR, `${jobId}_audio.tmp`);
        
        const videoStream = ytdl(videoId, { format: actualVideoFormat });
        const videoWriter = fs.createWriteStream(videoTempPath);
        
        let videoProgress = 0;
        let audioProgress = 0;

        videoStream.on('data', (chunk) => {
          videoProgress += chunk.length;
          const videoSize = parseInt(actualVideoFormat.contentLength) || 1;
          job.progress = Math.min(((videoProgress / videoSize) * 80) + (audioProgress * 20), 80);
        });

        videoStream.pipe(videoWriter);
        
        videoWriter.on('finish', () => {
          const audioStream = ytdl(videoId, { format: audioFormat });
          const audioWriter = fs.createWriteStream(audioTempPath);
          
          audioStream.on('data', (chunk) => {
            audioProgress += chunk.length;
            const audioSize = parseInt(audioFormat.contentLength) || 1;
            job.progress = Math.min(80 + ((audioProgress / audioSize) * 15), 95);
          });
          
          audioStream.pipe(audioWriter);
          
          audioWriter.on('finish', () => {
            // Merge streams with FFmpeg
            const ffmpegProcess = spawn('ffmpeg', [
              '-i', videoTempPath,
              '-i', audioTempPath,
              '-c:v', 'copy',
              '-c:a', 'aac',
              '-y',
              outputPath
            ]);
            
            ffmpegProcess.on('close', (code) => {
              try {
                fs.unlinkSync(videoTempPath);
                fs.unlinkSync(audioTempPath);
              } catch (e) {
                console.warn('Temporary file cleanup failed:', e);
              }
              
              if (code === 0) {
                job.progress = 100;
                job.status = 'completed';
              } else {
                console.error(`FFmpeg video mux failed with exit code ${code}`);
                job.status = 'failed';
              }
            });
          });
        });
        
      } else {
        // Fallback: download the best pre-muxed resolution (audio+video in one file) if FFmpeg is missing
        const muxedFormat = formats.find(f => f.height <= quality && f.hasVideo && f.hasAudio) || formats.find(f => f.hasVideo && f.hasAudio);
        if (!muxedFormat) {
          throw new Error('No pre-muxed video format found.');
        }

        const stream = ytdl(videoId, { format: muxedFormat });
        const writer = fs.createWriteStream(outputPath);
        
        let downloaded = 0;
        const totalSize = parseInt(muxedFormat.contentLength) || 1;

        stream.on('data', (chunk) => {
          downloaded += chunk.length;
          job.progress = Math.min((downloaded / totalSize) * 100, 99);
        });

        stream.pipe(writer);

        writer.on('finish', () => {
          job.progress = 100;
          job.status = 'completed';
        });

        stream.on('error', (err) => {
          console.error('Muxed video download error:', err);
          job.status = 'failed';
        });
      }
    }
  } catch (error) {
    console.error('Conversion job failed:', error);
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

# TubeHub - Low-Level Design (LLD)

This document contains low-level details regarding database schemas, local storage layout, filesystem storage organization, job processes, transcoding arguments, and React state preservation mechanisms.

---

## 1. Storage & Filesystem Layout

### Backend Directory Structure:
The backend groups files within video ID subdirectories to prevent directory clutter:
```
downloads/
├── cookies.txt               # Stored cookies for yt-dlp authentication
└── [videoId]/                # Unique video ID subfolders (e.g. 2vYyHb34upc)
    ├── thumbnail.jpg         # Pre-cached or read-through video thumbnail
    ├── cache_720.mp4         # Completed cached video format (720p)
    ├── cache_128.mp3         # Completed cached audio format (128kbps)
    └── [jobId].mp4           # Active/Temporary conversion files in progress
```

### Browser Client Database (IndexedDB):
* **Database Name**: `tubehub_offline_db` (or legacy `tube2audio_db`)
* **Object Store**: `media_store`
* **Schema (Stored Key-Value Pairs)**:
  * Key: `${videoId}-${quality}-${ext}` (e.g. `2vYyHb34upc-720-mp4`)
    * Value: Blob (the video/audio file data)
  * Key: `${videoId}-${quality}-${ext}-thumbnail` (e.g. `2vYyHb34upc-720-mp4-thumbnail`)
    * Value: Blob (the pre-cached thumbnail image data)

---

## 2. LocalStorage Schema

The client uses `localStorage` to persist search history, region preference, caching preferences, playhead positions, and settings:

| Key Name | Data Type / Format | Purpose |
| :--- | :--- | :--- |
| `tubehub_history` | JSON Array: `[{ id, title, duration, ext, quality, watchedAt, downloadedAt, savedInBrowser }]` | Unified watch and download history. Keys are unified by video ID. |
| `tubehub_resume_positions` | JSON Object: `{ [videoId]: currentTime }` | Stores last tracked playhead position in seconds. Updated every 2 seconds during playback. |
| `tubehub_enable_backend_cache` | String: `"true"` or `"false"` | Tracks whether server-side caching is enabled for streaming playback. |
| `yt-region-code` | String: Region Code (e.g. `"US"`, `"IN"`) | Overrides default trending feeds list. |
| `tubehub_last_ext` | String: `"mp4"` or `"mp3"` | Stores user's last selected format extension preference. |
| `tubehub_last_quality` | String: Quality value (e.g. `"720"`, `"320"`) | Stores user's last selected format quality preference. |

---

## 3. Caching Job & Process Management

Server caching jobs are tracked statelessly in memory using the `cacheJobs` object:
```javascript
const cacheJobs = {
  // Key format: `${videoId}_${quality}_${ext}`
  "2vYyHb34upc_720_mp4": {
    child: ChildProcess,       // Spawned yt-dlp child process reference
    progress: 45,             // Current download percentage parsed from stdout
    lastActive: 1718304910394, // Last polled timestamp (refreshed by heartbeat)
    filename: "/path/to/downloads/2vYyHb34upc/cache_720.mp4" // Absolute destination path
  }
};
```

### Heartbeat Check Loop:
A 5-second interval loop validates job activity:
```javascript
setInterval(() => {
  const now = Date.now();
  Object.keys(cacheJobs).forEach(jobKey => {
    const job = cacheJobs[jobKey];
    if (job && (now - job.lastActive > 15000)) {
      console.log(`Killing stale cache job ${jobKey} due to inactivity.`);
      try { job.child.kill(); } catch (e) {}
      delete cacheJobs[jobKey];
    }
  });
}, 5000);
```

---

## 4. Transcoding & Streaming CLI Parameters

### Audio Extraction (FFmpeg):
When a user streams audio (`ext=mp3`) of a cached video on disk, the backend streams the transcoded output on-the-fly using `spawn`:
```bash
ffmpeg -i /path/to/downloads/[videoId]/cache_[videoQuality].mp4 -b:a [audioQuality]k -f mp3 -map a pipe:1
```
* `-i [path]`: Specifies input cached video source.
* `-b:a [quality]k`: Sets target audio bitrate (e.g. `128k`, `320k`).
* `-f mp3`: Forces output format as MP3.
* `-map a`: Discards video and maps only the audio stream.
* `pipe:1`: Outputs the raw stream directly to `stdout` (which is piped to Express `res`).

---

## 5. React State Preservation & Hoisted Refs

To prevent state losses during format switching and cache completion reloads:

### 1. ReadyState Timeupdate Safeguard
When a video source reloads, the browser triggers a `timeupdate` event as it resets `currentTime` to `0`. To prevent overwriting the saved position in `localStorage`, we verify `readyState >= 1` (meaning metadata has loaded):
```javascript
const handleVideoTimeUpdate = () => {
  if (!videoRef.current || isDraggingVideoTimeline) return;
  const curTime = videoRef.current.currentTime;
  setVideoCurrentTime(curTime);

  // ReadyState >= 1 (HAVE_METADATA) verifies the source is fully loaded
  if (route.videoId && videoRef.current.readyState >= 1) {
    if (Math.abs(curTime - lastSaveTimeRef.current) > 2) {
      saveResumePosition(route.videoId, curTime);
      lastSaveTimeRef.current = curTime;
    }
  }
};
```

### 2. State Switch Refs
Immediately before the stream URL changes (whether from selecting a format or background cache auto-reload), we record play states and active time:
```javascript
// Record details before switch
saveResumePosition(activePlayItem.id, currentTime);
wasPlayingBeforeSwitchRef.current = !videoRef.current.paused;
isFormatSwitchRef.current = true;
```
When `loadedmetadata` triggers, we restore the states:
```javascript
if (isFormatSwitchRef.current) {
  isFormatSwitchRef.current = false;
  if (wasPlayingBeforeSwitchRef.current) {
    videoRef.current.play().catch(() => {});
  } else {
    videoRef.current.pause();
  }
}
```

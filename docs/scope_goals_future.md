# TubeHub - Scope, Goals & Future Plans

This document outlines the definition, constraints, architectural goals, and future expansion roadmap for the TubeHub project.

---

## 1. Project Overview & Scope

TubeHub is a premium, personal web application designed for playing, converting, and archiving YouTube media locally. It prioritizes user privacy, data savings, and offline usage.

### In-Scope Features:
* **Privacy Proxying**: All streaming content, metadata details, search suggestions, and thumbnails are proxied through a local backend server to shield user identity.
* **On-the-Fly Audio Extraction**: Demuxes and transcodes cached server videos into high-quality MP3s instantly via FFmpeg.
* **Adaptive Caching**: Spawns server-side `yt-dlp` download jobs that automatically terminate if the user pauses or closes the player, saving internet bandwidth.
* **Offline Sandbox Library**: Persistent offline storage of audio/video blobs in the browser's IndexedDB database, playable fully offline.
* **Unified History**: Tracks both watched media and offline-saved formats in a single history list, unified by Video ID.
* **Metadata & Playhead Resumption**: Remembers exact playback times and playing states, resuming seamlessly even across video/audio format switches.

### Out-of-Scope Features:
* **Multi-User Sync Servers**: TubeHub is designed to run locally or as a private personal instance. Centralized cloud tracking databases or user registration profiles are out of scope to preserve user privacy.
* **Universal Media Scraping**: The project focus is specifically optimized for YouTube extraction and local indexing.

---

## 2. Core Architectural Goals

### 1. Privacy-First Operations
Decouple client browsers from tracking pixels and metadata collection by external CDN CDNs:
* Autocomplete suggestions utilize a backend server proxy requesting YouTube's suggestions API.
* Image thumbnails are cached on the backend disk and served locally through `/api/v5/thumbnail/:videoId`.
* Search results and trending feeds are loaded using server-side extraction libraries.

### 2. Bandwidth Minimization & Data Reduction
* **No Duplicate Downloads**: If a video format (e.g. 720p MP4) is already cached on the server, requests for lower resolutions (e.g. 360p) will play the cached 720p directly.
* **Local Transcoding**: If a user requests a `.mp3` stream of a video that is already cached as an `.mp4` on the server, the backend transcodes the audio on-the-fly and pipes it, saving the need to fetch anything from the internet.

### 3. Local Client Sandbox
All database operations (offline files, thumbnails, playhead positions, region overrides, and search history) are stored client-side in the browser using IndexedDB and LocalStorage. The client environment remains completely private and self-sufficient.

---

## 3. Future Roadmap

The following features are planned for subsequent design and deployment phases:

1. **Browser Cookie Extraction Integration**
   * **Goal**: Solve bot verification blocks and support playing/caching private or age-restricted videos.
   * **Design**: Add a settings field allowing users to upload or paste exported browser cookies (`cookies.txt`), which the server will store in the root of the `downloads/` directory and pass to yt-dlp.

2. **Playlist Downloading & Conversion**
   * **Goal**: Allow users to paste a YouTube playlist URL and download/convert all items in batch mode.
   * **Design**: Implement a background conversion queue on the server that processes items sequentially and updates the client via Server-Sent Events (SSE) or WebSockets.

3. **Casting Support (Chromecast & AirPlay)**
   * **Goal**: Play local server-cached media or IndexedDB files on local network smart devices.
   * **Design**: Integrate the Google Cast SDK and Apple AirPlay media stream protocol selectors into the custom media player interface.

4. **Cloud Database Sync & Backup**
   * **Goal**: Securely sync browser-side histories, resume positions, and settings across multiple devices owned by the same user.
   * **Design**: Create a client-side sync connector to personal cloud storage services (e.g., Nextcloud, ownCloud, or WebDAV) using encrypted JSON payloads.

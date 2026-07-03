# TubeHub 🎥🎵
> Premium YouTube to MP3 & MP4 Converter & Offline Browser Media Center.

**TubeHub** is a modern, high-performance web application that refactors the standard YouTube downloader utility into a fully featured **Offline Browser Media Dashboard**. Users can convert YouTube links, select from multiple audio/video transcoding formats, stream media using custom in-browser theater players, save files to local browser database storage (IndexedDB) for offline playback, and watch in a floating Chrome Picture-in-Picture window.

---

## 🌟 Key Features

### 1. Adaptive HD & UHD Playback (DASH Manifest Compiler)
*   **Dynamic Multi-Representation Compiler:** Uncached videos stream using **DASH (Dynamic Adaptive Streaming over HTTP)**. The backend dynamically compiles a custom multi-representation DASH XML manifest (`manifest.mpd`) containing parallel-mapped tracks for resolutions up to **8K (4320p), 4K (2160p), 2K (1440p)**, 1080p, 720p, 480p, and 360p, aligning cinematic/vertical custom aspect ratio heights.
*   **Intelligent Codec Isolation:** To maintain absolute stream stability inside `dash.js`, the compiler automatically matches the codec selection to avoid browser decoder crashes (e.g. standard resolutions below 1080p stream using `avc1` / H.264, while UHD resolutions trigger the modern `av01` / AV1 codec representation list).
*   **dash.js v5 Client Integration:** Playback is managed via a custom `dash.js` player configuration that overrides ABR to force manual quality locks in the browser without resetting the video element buffer, enabling **smooth, instant quality changes** without interrupts.

### 2. YouTube Converter & Transcoding Selection
*   **Audio Extractor (MP3):** Transcode audio streams in multiple qualities: `320 kbps (Ultra)`, `256 kbps (High)`, `192 kbps (Medium)`, and `128 kbps (Standard)`.
*   **Video Downloader (MP4):** Transcode video streams in multiple resolutions: `4320p (8K)`, `2160p (4K)`, `1440p (2K)`, `1080p (Full HD)`, `720p (HD)`, `480p (SD)`, and `360p (Mobile)`.
*   **Security Check Integration:** Seamless human verification checks powered by Cloudflare Turnstile inside a sleek dark theme widget.

### 3. Unified Conversion Caching & Concurrency
*   **Unified Cache Pipeline:** All video and audio downloads write directly to a shared backend `/downloads/cache/[videoId]/` repository.
*   **Instant Co-download Hook (Concurrency):** If Job A is actively downloading `cache_1080.mp4`, Job B (e.g. clicking "Download to Computer" for the same format) automatically detects the active download, binds its progress indicator to Job A in real-time, waits for it to complete, and copies the resulting cache file instantly.
*   **Loop-Free Status Polling:** A React-synchronized background heartbeat loop polls cache progress and updates dropdown options and player source states cleanly upon completion without UI/render lag.

### 4. TubeHub Browser Media Center (Offline DB)
*   **IndexedDB Binary Database:** Bypasses standard `localStorage` 5MB string limitations by saving full binary media Blobs directly inside the browser database.
*   **Offline Access Badge:** Saved files display a glowing green "Offline" badge.
*   **Instant Local Downloads:** Export saved media files instantly to your PC's filesystem directly from your local browser database, without querying the remote CDN servers again.
*   **Individual Library Deletion:** Delete cards individually to clean up the dashboard history list and automatically delete their cached media blobs from your browser storage.
*   **Live Library Filters:** Filter cards in real-time by *All Files*, *Audio (MP3)*, *Video (MP4)*, and *Offline Saved*, alongside a title search bar.

### 5. Theater Video Player & Google Chrome Auto-PiP
*   **Theater Modal Screen:** Play converted MP4 videos inside an enlarged, centered `max-w-5xl` theater player.
*   **Chrome Tab Auto-PiP:** Supports native browser Picture-in-Picture. If a video is playing, switching browser tabs automatically pops the video into an "always-on-top" floating window. Returning to the TubeHub tab automatically exits PiP and restores the player in the modal overlay.
*   **Internal Tab Auto-PiP:** Switching tabs within the app (e.g., leaving the Library to check the Converter tab) automatically triggers PiP via user clicks, keeping playback active while you convert new links.
*   **Chrome Media Session Controls:** Integrated hardware media keys (keyboard play/pause buttons) and OS media notification panels, showing the YouTube thumbnail artwork.

---

## 🛠️ Technology Stack
*   **Core Framework:** React 19 + Vite + ESModules
*   **Styling Engine:** Tailwind CSS v4 (vanilla directives)
*   **Icons Library:** Lucide React (feather-style vectors)
*   **Local Database:** IndexedDB API (async object store)
*   **Human Verification:** Cloudflare Turnstile API

---

## 🚀 Getting Started

### Prerequisites
*   Node.js (v18 or higher recommended)
*   npm or yarn

### Installation
1. Clone this repository to your local machine:
   ```bash
   git clone https://github.com/ErVijayRaghuwanshi/TubeHub.git
   cd TubeHub
   ```
2. Install package dependencies:
   ```bash
   npm install
   ```
3. Start the local development server:
   ```bash
   npm run dev
   ```
4. Build production bundle assets:
   ```bash
   npm run build
   ```

---

## ⚙️ How to Enable Chrome Auto-PiP
Because Chrome's native automatic Picture-in-Picture tab transitions are security-restricted, you must enable the feature flag:
1. Open a new Chrome tab and go to **`chrome://flags`**.
2. Search for **"Browser initiated automatic picture in picture"**.
3. Toggle the value from *Default* to **Enabled** and click **Relaunch**.
4. In your TubeHub site tab, click the **lock icon** next to the URL, and ensure **"Automatic picture-in-picture"** permission is **Allowed**.

---

## 👤 Author Information
*   **Author:** [Vijay Raghuwanshi](https://ervijayraghuwanshi.github.io/)
*   **Email:** [ervijayraghuwanshi@gmail.com](mailto:ervijayraghuwanshi@gmail.com)
*   **GitHub Profile:** [ErVijayRaghuwanshi](https://github.com/ErVijayRaghuwanshi)
*   **Project URL:** [https://github.com/ErVijayRaghuwanshi/TubeHub](https://github.com/ErVijayRaghuwanshi/TubeHub)

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

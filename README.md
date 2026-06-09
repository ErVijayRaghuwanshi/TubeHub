# TubeHub 🎥🎵
> Premium YouTube to MP3 & MP4 Converter & Offline Browser Media Center.

**TubeHub** is a modern, high-performance web application that refactors the standard YouTube downloader utility into a fully featured **Offline Browser Media Dashboard**. Users can convert YouTube links, select from multiple audio/video transcoding formats, stream media using custom in-browser theater players, save files to local browser database storage (IndexedDB) for offline playback, and watch in a floating Chrome Picture-in-Picture window.

---

## 🌟 Key Features

### 1. YouTube Converter & Transcoding Selection
*   **Audio Extractor (MP3):** Transcode audio streams in multiple qualities: `320 kbps (Ultra)`, `256 kbps (High)`, `192 kbps (Medium)`, and `128 kbps (Standard)`.
*   **Video Downloader (MP4):** Transcode video streams in multiple resolutions: `1080p (Full HD)`, `720p (HD)`, `480p (SD)`, and `360p (Mobile)`.
*   **Security Check Integration:** Seamless human verification checks powered by Cloudflare Turnstile inside a sleek dark theme widget.

### 2. YouTube-Style Responsive Card Grid
*   **YouTube Aesthetic:** Clean card structures featuring rounded corners, 16:9 aspect-video covers, uploader avatars, custom format badges (e.g. `MP3 • 320k`), and uploader details.
*   **Interactive Play Overlays:** Hovering over any card zooms the thumbnail slightly and reveals a glowing red circular YouTube Play button.
*   **Dynamic Grid Columns:** Fully responsive grid adapting dynamically across screens:
    *   **Mobile:** 1 column (`grid-cols-1`)
    *   **Tablet/Laptops:** 2 columns (`sm:grid-cols-2`)
    *   **Desktop/Large Screens:** 3 columns (`lg:grid-cols-3 gap-8`)
*   **Spacious Canvas:** Toggling to the library tab dynamically expands the layout width from `max-w-4xl` to `max-w-7xl` to give the video grid cinematic breathing room.

### 3. TubeHub Browser Media Center (Offline DB)
*   **IndexedDB Binary Database:** Bypasses standard `localStorage` 5MB string limitations by saving full binary media Blobs directly inside the browser database.
*   **Offline Access Badge:** Saved files display a glowing green "Offline" badge.
*   **Instant Local Downloads:** Export saved media files instantly to your PC's filesystem directly from your local browser database, without querying the remote CDN servers again.
*   **Individual Library Deletion:** Delete cards individually to clean up the dashboard history list and automatically delete their cached media blobs from your browser storage.
*   **Live Library Filters:** Filter cards in real-time by *All Files*, *Audio (MP3)*, *Video (MP4)*, and *Offline Saved*, alongside a title search bar.

### 4. Theater Video Player & Google Chrome Auto-PiP
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

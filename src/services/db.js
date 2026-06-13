// IndexedDB Service for storing media blobs locally in the browser.
// This supports offline playback and browser-based file management.

const DB_NAME = 'tube2audio_db';
const DB_VERSION = 1;
const STORE_NAME = 'media_store';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Saves a media blob to the database.
 * @param {string} id Unique identifier (videoId + format + quality)
 * @param {Blob} blob Converted audio/video file blob
 */
export async function saveMedia(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(blob, id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves a media blob from the database.
 * @param {string} id Unique identifier
 * @returns {Promise<Blob|null>} The media blob or null if not found
 */
export async function getMedia(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    
    request.onsuccess = (e) => resolve(e.target.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Deletes a media blob from the database.
 * @param {string} id Unique identifier
 */
export async function deleteMedia(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Checks if a media item exists in the database.
 * @param {string} id Unique identifier
 * @returns {Promise<boolean>}
 */
export async function hasMedia(id) {
  const item = await getMedia(id);
  return item !== null;
}

/**
 * Calculates the total size and count of all media blobs stored in IndexedDB.
 * @returns {Promise<{totalBytes: number, count: number}>}
 */
export async function getMediaSizeEstimate() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    let totalBytes = 0;
    let count = 0;
    
    const request = store.openCursor();
    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const val = cursor.value;
        if (val instanceof Blob) {
          totalBytes += val.size;
          if (!cursor.key.endsWith('-thumbnail')) {
            count++;
          }
        }
        cursor.continue();
      } else {
        resolve({ totalBytes, count });
      }
    };
    request.onerror = (e) => reject(request.error);
  });
}

/**
 * Clears all data inside the media store in IndexedDB.
 * @returns {Promise<void>}
 */
export async function clearAllStorage() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(request.error);
  });
}

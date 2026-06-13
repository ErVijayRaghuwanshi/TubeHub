// Frontend service to query our backend YouTube Data API proxy.
// Supports custom headers for user-supplied API keys stored in localStorage.

const BASE_URL = '/api/v5/youtube';

const getApiHeaders = () => {
  const headers = {
    'accept': 'application/json'
  };
  const userApiKey = localStorage.getItem('yt-api-key');
  if (userApiKey) {
    headers['x-youtube-api-key'] = userApiKey.trim();
  }
  return headers;
};

/**
 * Fetches trending/popular videos from the YouTube API.
 * @param {string} pageToken Page pagination token
 * @param {string} categoryId Optional category ID filter
 * @returns {Promise<object>} YouTube API videos response
 */
export async function fetchTrending(pageToken = '', categoryId = '') {
  let url = `${BASE_URL}/trending?regionCode=US`;
  if (pageToken) url += `&pageToken=${pageToken}`;
  if (categoryId) url += `&categoryId=${categoryId}`;

  const response = await fetch(url, { headers: getApiHeaders() });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch trending videos.');
  }
  return response.json();
}

/**
 * Searches YouTube videos based on a query string.
 * @param {string} query Search terms
 * @param {string} pageToken Page pagination token
 * @returns {Promise<object>} Enriched search results response
 */
export async function searchVideos(query, pageToken = '') {
  let url = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
  if (pageToken) url += `&pageToken=${pageToken}`;

  const response = await fetch(url, { headers: getApiHeaders() });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to search videos.');
  }
  return response.json();
}

/**
 * Fetches detailed metadata for a single video.
 * @param {string} videoId 
 * @returns {Promise<object>} Video details item object
 */
export async function fetchVideoDetails(videoId) {
  const url = `${BASE_URL}/video/${videoId}`;
  const response = await fetch(url, { headers: getApiHeaders() });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch video details.');
  }
  return response.json();
}

/**
 * Fetches comment threads for a video.
 * @param {string} videoId 
 * @param {string} pageToken Page pagination token
 * @returns {Promise<object>} Comment threads list response
 */
export async function fetchComments(videoId, pageToken = '') {
  let url = `${BASE_URL}/comments/${videoId}`;
  if (pageToken) url += `?pageToken=${pageToken}`;

  const response = await fetch(url, { headers: getApiHeaders() });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch comments.');
  }
  return response.json();
}

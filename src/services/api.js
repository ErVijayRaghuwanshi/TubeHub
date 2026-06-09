// API service for interacting with cdnframe conversion services.
// Uses local proxy prefix '/api/v5' to bypass CORS limitations in development.

const BASE_URL = '/api/v5';

// Memory cache for the API token and its expiry Unix timestamp
let cachedToken = null;
let cachedTokenExpiry = 0;

/**
 * Retrieves a valid token, either from memory cache or by generating a new one.
 * Tokens expire in 10 minutes (600 seconds), so we refresh when remaining life is < 30 seconds.
 */
export async function getValidToken() {
  const now = Math.floor(Date.now() / 1000);
  
  if (cachedToken && cachedTokenExpiry > now + 30) {
    return cachedToken;
  }

  try {
    const response = await fetch(`${BASE_URL}/auth`, {
      method: 'POST',
      headers: {
        'accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Token generation failed: Status ${response.status}`);
    }

    const data = await response.json();
    if (!data.success || !data.token) {
      throw new Error(data.message || 'Token generation request was unsuccessful.');
    }

    cachedToken = data.token;
    // Set expiry timestamp
    cachedTokenExpiry = now + (data.expiresIn || 600);
    return cachedToken;
  } catch (error) {
    console.error('Failed to generate clickapi.net access token:', error);
    // Return stale token as a fallback if request fails
    if (cachedToken) return cachedToken;
    throw error;
  }
}

/**
 * Helper to build authorization headers with auto-generated token.
 */
async function getAuthHeaders(customHeaders = {}) {
  const token = await getValidToken();
  return {
    'accept': 'application/json',
    'authorization': `Bearer ${token}`,
    ...customHeaders
  };
}

/**
 * Fetches info and formats for a given YouTube video ID.
 * @param {string} videoId 
 * @returns {Promise<object>} Video details and available stream formats.
 */
export async function fetchVideoInfo(videoId) {
  const targetUrl = `${BASE_URL}/info/${videoId}`;
  const headers = await getAuthHeaders();
  
  const response = await fetch(targetUrl, { headers });

  if (!response.ok) {
    throw new Error('Failed to fetch video info. The endpoint might be temporarily down or blocked.');
  }

  return response.json();
}

/**
 * Initiates a conversion process for a chosen video audio format.
 * @param {string} audioToken 
 * @returns {Promise<object>} Details of the conversion job, including jobId.
 */
export async function startConversion(audioToken, turnstileToken) {
  const targetUrl = `${BASE_URL}/convert`;
  const headers = await getAuthHeaders({
    'content-type': 'application/json'
  });
  
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: audioToken, turnstile: turnstileToken || '' })
  });

  if (!response.ok) {
    throw new Error('Failed to initiate conversion process.');
  }

  return response.json();
}

/**
 * Polls the status of an active conversion job.
 * @param {string} jobId 
 * @returns {Promise<object>} Status of the job including progress and downloadUrl.
 */
export async function checkConversionStatus(jobId) {
  const targetUrl = `${BASE_URL}/status/${jobId}`;
  const headers = await getAuthHeaders();
  
  const response = await fetch(targetUrl, { headers });

  if (!response.ok) {
    throw new Error('Error checking conversion status.');
  }

  return response.json();
}

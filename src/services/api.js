// API service for interacting with local conversion services.
// Uses local proxy prefix '/api/v5' to bypass CORS limitations in development.

const BASE_URL = '/api/v5';

/**
 * Fetches info and formats for a given YouTube video ID.
 * @param {string} videoId 
 * @returns {Promise<object>} Video details and available stream formats.
 */
export async function fetchVideoInfo(videoId) {
  const targetUrl = `${BASE_URL}/info/${videoId}`;
  const response = await fetch(targetUrl, {
    headers: {
      'accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch video info. The endpoint might be temporarily down or blocked.');
  }

  return response.json();
}

/**
 * Initiates a conversion process for a chosen video format.
 * @param {string} formatToken 
 * @returns {Promise<object>} Details of the conversion job, including jobId.
 */
export async function startConversion(formatToken) {
  const targetUrl = `${BASE_URL}/convert`;
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ token: formatToken })
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
  const response = await fetch(targetUrl, {
    headers: {
      'accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Error checking conversion status.');
  }

  return response.json();
}


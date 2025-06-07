
'use client';

// Helper function to get the API token.
// Prioritizes a user-set token from localStorage, then falls back to environment variable.
export function getApiToken(): string | null {
  if (typeof window === 'undefined') {
    // Return environment variable if on server or localStorage is not available
    return process.env.NEXT_PUBLIC_CHUNIREC_API_TOKEN || null;
  }
  const localToken = localStorage.getItem('chuniCalcData_userApiToken');
  if (localToken && localToken.trim() !== '') {
    return localToken.trim();
  }
  return process.env.NEXT_PUBLIC_CHUNIREC_API_TOKEN || null;
}

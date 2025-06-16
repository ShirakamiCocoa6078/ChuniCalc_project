
'use client';

// This function now primarily checks if the user has set a local reference token
// via the Advanced Settings. It's a HINT for the client that their overall API
// key setup *might* be incomplete if this local reference is missing.
// The actual API key used for calls is handled server-side by the proxy
// and sourced from the CHUNIREC_API_KEY environment variable.
export function getLocalReferenceApiToken(): string | null {
  if (typeof window === 'undefined') {
    return null; // Cannot access localStorage on server
  }
  const localToken = localStorage.getItem('chuniCalcData_userApiToken');
  if (localToken && localToken.trim() !== '') {
    return localToken.trim();
  }
  return null;
}


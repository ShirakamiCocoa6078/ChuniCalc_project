// src/hooks/useApiData.ts
"use client";

import useSWR from 'swr';
import type { ProfileData, RatingApiResponse, ShowallApiSongEntry, UserShowallApiResponse } from '@/types/result-page';
import { getLocalReferenceApiToken } from '@/lib/get-api-token';

const API_CALL_TIMEOUT_MS = 30000; // Increased from 15 seconds to 30 seconds

// General fetcher for SWR
const fetcher = async (url: string, isUserData: boolean = false) => {
  const proxyUrl = new URL(url, window.location.origin);
  
  // Add localApiToken only for user-specific data or if explicitly needed for global data in future
  if (isUserData) {
      const localToken = getLocalReferenceApiToken();
      if (localToken) {
        proxyUrl.searchParams.append('localApiToken', localToken);
      }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CALL_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(proxyUrl.toString(), { signal: controller.signal });
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.warn(`[SWR_FETCHER_TIMEOUT] API call to ${url} timed out after ${API_CALL_TIMEOUT_MS}ms.`);
      throw new Error(`API_TIMEOUT: Request to ${url.split('?')[0]} timed out.`);
    }
    console.error(`[SWR_FETCHER_ERROR] Network/fetch error for ${url}:`, error);
    throw error;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: { message: "Response not JSON" }}));
    const errorMessage = errorData?.error?.message || `An error occurred while fetching the data (status: ${response.status}).`;
    console.error(`[SWR_FETCHER_HTTP_ERROR] ${url} failed with status ${response.status}: ${errorMessage}`);
    const error = new Error(errorMessage) as any;
    error.info = errorData;
    error.status = response.status;
    throw error;
  }

  return response.json();
};


export function useProfileData(userName: string | null) {
  const key = userName ? `/api/chunirecApiProxy?proxyEndpoint=records/profile.json&user_name=${encodeURIComponent(userName)}&region=jp2` : null;
  return useSWR<ProfileData>(key, (url) => fetcher(url, true), {
    revalidateOnFocus: false, // Adjust as needed
    // dedupingInterval: USER_DATA_CACHE_EXPIRY_MS, // SWR handles deduping
  });
}

export function useUserRatingData(userName: string | null) {
  const key = userName ? `/api/chunirecApiProxy?proxyEndpoint=records/rating_data.json&user_name=${encodeURIComponent(userName)}&region=jp2` : null;
  return useSWR<RatingApiResponse>(key, (url) => fetcher(url, true), {
    revalidateOnFocus: false,
  });
}

export function useUserShowallData(userName: string | null) {
  const key = userName ? `/api/chunirecApiProxy?proxyEndpoint=records/showall.json&user_name=${encodeURIComponent(userName)}&region=jp2` : null;
  return useSWR<UserShowallApiResponse>(key, (url) => fetcher(url, true), {
    revalidateOnFocus: false,
  });
}

// Global music data might not need localApiToken unless specifically required by proxy configuration
export function useGlobalMusicData() {
  const key = `/api/chunirecApiProxy?proxyEndpoint=music/showall.json&region=jp2`;
  return useSWR<any[] | { records: any[] }>(key, (url) => fetcher(url, false), { // isUserData is false
    revalidateOnFocus: false,
    // dedupingInterval: GLOBAL_MUSIC_CACHE_EXPIRY_MS, // SWR handles deduping
  });
}


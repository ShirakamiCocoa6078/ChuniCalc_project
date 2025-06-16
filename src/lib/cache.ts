
'use client';

export const LOCAL_STORAGE_PREFIX = 'chuniCalcData_';
// USER_DATA_CACHE_EXPIRY_MS and GLOBAL_MUSIC_CACHE_EXPIRY_MS are no longer primary means
// for API data caching, as SWR will handle this.
// They can be kept for other potential non-SWR caching or removed if not used.
// For SWR, cache TTL is configured directly in useSWR options (e.g. dedupingInterval).

// export const USER_DATA_CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; 
// export const GLOBAL_MUSIC_CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
export const SIMULATION_CACHE_EXPIRY_MS = 1 * 24 * 60 * 60 * 1000; // Retained for now if sim results are cached
// export const GLOBAL_MUSIC_DATA_KEY = `${LOCAL_STORAGE_PREFIX}globalMusicData`; // SWR will use URL as key

export type CachedData<T> = {
  timestamp: number;
  data: T;
};

// getCachedData and setCachedData might be deprecated or have reduced usage
// if SWR fully replaces manual caching for API responses.
// They are kept here for now in case they are used for non-API data.

export function getCachedData<T>(key: string, expiryMs: number): T | null {
  if (typeof window === 'undefined') return null;
  // This function is now less relevant for API data if SWR is fully adopted for it.
  // Consider removing if no longer used for its original purpose.
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;
    const cached = JSON.parse(item) as CachedData<T>;
    if (Date.now() - cached.timestamp > expiryMs) {
      localStorage.removeItem(key);
      // console.log(`Cache expired and removed for key: ${key}`);
      return null;
    }
    // console.log(`Cache hit for key: ${key}`);
    return cached.data;
  } catch (error) {
    console.error("Error reading from localStorage for key:", key, error);
    localStorage.removeItem(key);
    return null;
  }
}

export function setCachedData<T>(key: string, data: T, expiryMs?: number): void {
  if (typeof window === 'undefined') return;
  // This function is now less relevant for API data if SWR is fully adopted for it.
  // Consider removing if no longer used for its original purpose.
  try {
    const item: CachedData<T> = { timestamp: Date.now(), data };
    localStorage.setItem(key, JSON.stringify(item));
    // console.log(`Data cached for key: ${key}` + (expiryMs ? ` with expiry ${expiryMs}ms` : ''));
  } catch (error) {
    console.error("Error writing to localStorage for key:", key, error);
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        alert('로컬 저장 공간이 부족하여 데이터를 캐시할 수 없습니다. 일부 오래된 캐시를 삭제해보세요.');
    }
  }
}

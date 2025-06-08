
'use client';

export const LOCAL_STORAGE_PREFIX = 'chuniCalcData_';
export const USER_DATA_CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for user data
export const GLOBAL_MUSIC_CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for global music list
export const GLOBAL_MUSIC_DATA_KEY = `${LOCAL_STORAGE_PREFIX}globalMusicData`;

export type CachedData<T> = {
  timestamp: number;
  data: T;
};

export function getCachedData<T>(key: string, expiryMs: number = USER_DATA_CACHE_EXPIRY_MS): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;
    const cached = JSON.parse(item) as CachedData<T>;
    if (Date.now() - cached.timestamp > expiryMs) {
      localStorage.removeItem(key);
      console.log(`Cache expired and removed for key: ${key}`);
      return null;
    }
    console.log(`Cache hit for key: ${key}`);
    return cached.data;
  } catch (error) {
    console.error("Error reading from localStorage for key:", key, error);
    localStorage.removeItem(key); // Remove corrupted data
    return null;
  }
}

export function setCachedData<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    const item: CachedData<T> = { timestamp: Date.now(), data };
    localStorage.setItem(key, JSON.stringify(item));
    console.log(`Data cached for key: ${key}`);
  } catch (error) {
    console.error("Error writing to localStorage for key:", key, error);
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        alert('로컬 저장 공간이 부족하여 데이터를 캐시할 수 없습니다. 일부 오래된 캐시를 삭제해보세요.');
    }
  }
}

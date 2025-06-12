
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, GLOBAL_MUSIC_CACHE_EXPIRY_MS, LOCAL_STORAGE_PREFIX, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc } from '@/lib/rating-utils';
import type { Song, ProfileData, RatingApiResponse, GlobalMusicApiResponse, UserShowallApiResponse, ShowallApiSongEntry, RatingApiSongEntry } from "@/types/result-page";

const BEST_COUNT = 30;
const NEW_COUNT = 20;

interface UseChuniResultDataProps {
  userNameForApi: string | null;
  currentRatingDisplay: string | null;
  targetRatingDisplay: string | null;
  locale: Locale;
  refreshNonce: number;
  clientHasMounted: boolean;
}

export function useChuniResultData({
  userNameForApi,
  currentRatingDisplay,
  targetRatingDisplay,
  locale,
  refreshNonce,
  clientHasMounted,
}: UseChuniResultDataProps) {
  const { toast } = useToast();

  const [apiPlayerName, setApiPlayerName] = useState<string | null>(null);
  const [best30SongsData, setBest30SongsData] = useState<Song[]>([]);
  const [new20SongsData, setNew20SongsData] = useState<Song[]>([]);
  const [combinedTopSongs, setCombinedTopSongs] = useState<Song[]>([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(true);
  const [errorLoadingSongs, setErrorLoadingSongs] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const [isScoreLimitReleased, setIsScoreLimitReleased] = useState(false);
  const [nonUpdatableB30Songs, setNonUpdatableB30Songs] = useState<Song[]>([]);
  const [updatableB30Songs, setUpdatableB30Songs] = useState<Song[]>([]);
  const [averageRatingOfUpdatableB30, setAverageRatingOfUpdatableB30] = useState<number | null>(null);
  const [groupAB30Songs, setGroupAB30Songs] = useState<Song[]>([]); // Step 1-6

  // 과제 1-1: 점수 상한 한계 해제 플래그 결정
  useEffect(() => {
    if (clientHasMounted) {
      const currentIsValidNumber = currentRatingDisplay && !isNaN(parseFloat(currentRatingDisplay));
      const targetIsValidNumber = targetRatingDisplay && !isNaN(parseFloat(targetRatingDisplay));

      if (currentIsValidNumber && targetIsValidNumber) {
        const currentRatingNum = parseFloat(currentRatingDisplay);
        const targetRatingNum = parseFloat(targetRatingDisplay);
        const limitReleaseCondition = (targetRatingNum - currentRatingNum) * 50 > 10;
        setIsScoreLimitReleased(limitReleaseCondition);
        console.log(`[CHAL_1-1_SCORE_CAP_RELEASE_CHECK] Score cap release flag SET to ${limitReleaseCondition}. ((target:${targetRatingNum} - current:${currentRatingNum}) * 50 > 10)`);
      } else {
        setIsScoreLimitReleased(false);
        console.log(`[CHAL_1-1_SCORE_CAP_RELEASE_CHECK] Ratings ('${currentRatingDisplay}', '${targetRatingDisplay}') not valid numbers or not available, score cap release flag defaults to false.`);
      }
    }
  }, [clientHasMounted, currentRatingDisplay, targetRatingDisplay]);


  useEffect(() => {
    const fetchAndProcessData = async () => {
      const defaultPlayerName = getTranslation(locale, 'resultPageDefaultPlayerName');
      const API_TOKEN = getApiToken();
      if (!API_TOKEN) {
        setErrorLoadingSongs(getTranslation(locale, 'resultPageErrorApiTokenNotSetResult'));
        setIsLoadingSongs(false);
        return;
      }

      if (!userNameForApi || userNameForApi === defaultPlayerName) {
        setErrorLoadingSongs(getTranslation(locale, 'resultPageErrorNicknameNotProvidedResult'));
        setApiPlayerName(defaultPlayerName);
        setIsLoadingSongs(false);
        return;
      }

      setIsLoadingSongs(true);
      setErrorLoadingSongs(null);
      setApiPlayerName(userNameForApi); 

      const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
      const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
      const globalMusicKey = GLOBAL_MUSIC_DATA_KEY;
      const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;

      const newSongTitlesRaw = NewSongsData.titles?.verse || [];
      const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());
      console.log(`[N20_PREP_1] Titles from NewSongs.json for matching (count: ${newSongTitlesToMatch.length}):`, newSongTitlesToMatch.slice(0, 3));
      
      let cachedProfileTimestamp: string | null = null;
      if (clientHasMounted) {
          const profileCacheItem = localStorage.getItem(profileKey);
          if (profileCacheItem) {
              try {
                  const parsed = JSON.parse(profileCacheItem) as { timestamp: number };
                  if (parsed && typeof parsed.timestamp === 'number') {
                     cachedProfileTimestamp = new Date(parsed.timestamp).toLocaleString(locale);
                  }
              } catch (e) { console.error("Error parsing profile cache timestamp for display", e); }
          }
      }
      setLastRefreshed(cachedProfileTimestamp ? getTranslation(locale, 'resultPageSyncStatus', cachedProfileTimestamp) : getTranslation(locale, 'resultPageSyncStatusNoCache'));

      let profileData = getCachedData<ProfileData>(profileKey);
      let ratingData = getCachedData<RatingApiResponse>(ratingDataKey, USER_DATA_CACHE_EXPIRY_MS);
      let globalMusicData = getCachedData<GlobalMusicApiResponse>(globalMusicKey, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
      let userShowallData = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);
      
      let globalMusicRecordsFromDataSource: ShowallApiSongEntry[] = globalMusicData?.records || [];
      let userShowallRecordsFromDataSource: ShowallApiSongEntry[] = userShowallData?.records || [];

      if (profileData) {
        setApiPlayerName(profileData.player_name || userNameForApi);
      }
      if (ratingData) {
        const bestEntriesApi = ratingData.best?.entries?.filter((e: any): e is RatingApiSongEntry =>
            e !== null && typeof e.id === 'string' && typeof e.diff === 'string' &&
            typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number')
        ) || [];
        const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
        setBest30SongsData(sortSongsByRatingDesc(mappedBestEntries));
        console.log("[CHAL_1-2_B30_LOAD] Best 30 songs data loaded from cache. Count:", mappedBestEntries.length, mappedBestEntries.slice(0,2));
      }


      if (!profileData || !ratingData || !globalMusicData?.records || !userShowallData?.records) {
        console.log("Fetching some data from API as cache is missing or expired...");
        const apiRequests = [];
        if (!profileData) {
          apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/profile.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'profile', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'profile', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        }
        if (!ratingData) {
          apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'rating', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'rating', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        }
        if (!globalMusicData?.records) {
          apiRequests.push(fetch(`https://api.chunirec.net/2.0/music/showall.json?region=jp2&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'globalMusic', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'globalMusic', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        }
        if (!userShowallData?.records) {
            apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'userShowall', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'userShowall', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        }
        
        if (apiRequests.length > 0) {
            try {
                const responses = await Promise.all(apiRequests);
                let criticalError = null;

                for (const res of responses) {
                    if (!res.ok) {
                        const errorMsg = `${res.type} data loading failed (status: ${res.status}): ${res.data?.error?.message || res.statusText || res.error || 'Unknown API error'}`;
                        if (!criticalError) criticalError = errorMsg; else console.warn(errorMsg);
                        continue;
                    }
                    if (res.type === 'profile' && !profileData) {
                      setApiPlayerName(res.data.player_name || userNameForApi);
                      setCachedData<ProfileData>(profileKey, res.data);
                      profileData = res.data; 
                    }
                    if (res.type === 'rating' && !ratingData) {
                      const bestEntriesApi = res.data.best?.entries?.filter((e: any): e is RatingApiSongEntry =>
                          e && e.id && e.diff && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number')
                      ) || [];
                      const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
                      setBest30SongsData(sortSongsByRatingDesc(mappedBestEntries));
                      console.log("[CHAL_1-2_B30_LOAD] Best 30 songs data loaded from API. Count:", mappedBestEntries.length, mappedBestEntries.slice(0,2));
                      setCachedData<RatingApiResponse>(ratingDataKey, res.data);
                      ratingData = res.data; 
                    }
                    if (res.type === 'globalMusic' && !globalMusicData?.records) {
                        let rawApiRecordsForGlobal: any[] = [];
                        if (Array.isArray(res.data)) { 
                            rawApiRecordsForGlobal = res.data;
                        } else if (res.data && Array.isArray(res.data.records)) { 
                            rawApiRecordsForGlobal = res.data.records; 
                        }

                        const flattenedGlobalMusicEntries: ShowallApiSongEntry[] = [];
                        if (rawApiRecordsForGlobal.length > 0 && rawApiRecordsForGlobal[0] && rawApiRecordsForGlobal[0].meta && typeof rawApiRecordsForGlobal[0].data === 'object') {
                            rawApiRecordsForGlobal.forEach(rawEntry => {
                                if (rawEntry && rawEntry.meta && rawEntry.data && typeof rawEntry.data === 'object') {
                                    const meta = rawEntry.meta;
                                    const difficulties = rawEntry.data;
                                    for (const diffKey in difficulties) {
                                        if (Object.prototype.hasOwnProperty.call(difficulties, diffKey)) {
                                            const diffData = difficulties[diffKey];
                                            if (diffData && meta.id && meta.title) {
                                                flattenedGlobalMusicEntries.push({
                                                    id: String(meta.id), title: String(meta.title), genre: String(meta.genre || "N/A"),
                                                    release: String(meta.release || ""), diff: diffKey.toUpperCase(), level: String(diffData.level || "N/A"),
                                                    const: (typeof diffData.const === 'number' || diffData.const === null) ? diffData.const : parseFloat(String(diffData.const)),
                                                    is_const_unknown: diffData.is_const_unknown === true,
                                                });
                                            }
                                        }
                                    }
                                }
                            });
                        } else if (rawApiRecordsForGlobal.length > 0) { 
                             rawApiRecordsForGlobal.forEach(entry => flattenedGlobalMusicEntries.push(entry as ShowallApiSongEntry)); 
                        }

                        globalMusicRecordsFromDataSource = flattenedGlobalMusicEntries.filter((e: any): e is ShowallApiSongEntry =>
                            e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' &&
                            typeof e.title === 'string' && e.title.trim() !== '' && (typeof e.release === 'string') && 
                            (e.const !== undefined) && e.level !== undefined && String(e.level).trim() !== '' 
                        );
                        setCachedData<GlobalMusicApiResponse>(globalMusicKey, { records: globalMusicRecordsFromDataSource }, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
                        console.log("[N20_PREP_2_API] Global music data (flattened & filtered) fetched from API and cached. Count:", globalMusicRecordsFromDataSource.length);
                    }
                    if (res.type === 'userShowall' && !userShowallData?.records) {
                        userShowallRecordsFromDataSource = (res.data.records || []).filter((e: any): e is ShowallApiSongEntry =>
                            e && e.id && e.diff && (e.score !== undefined)
                        );
                        setCachedData<UserShowallApiResponse>(userShowallKey, { records: userShowallRecordsFromDataSource }, USER_DATA_CACHE_EXPIRY_MS);
                        console.log("[N20_PREP_3_API] User's showall data fetched from API and cached. Count:", userShowallRecordsFromDataSource.length);
                    }
                }
                if (criticalError) throw new Error(criticalError);
                
                const newCacheTime = new Date().toLocaleString(locale);
                setLastRefreshed(getTranslation(locale, 'resultPageSyncStatus', newCacheTime));
                toast({ 
                    title: getTranslation(locale, 'resultPageToastApiLoadSuccessTitle'), 
                    description: getTranslation(locale, 'resultPageToastApiLoadSuccessDesc', newCacheTime) 
                });

            } catch (error) {
                console.error("Error fetching song data from API:", error);
                let detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', "Unknown error");
                if (error instanceof Error) detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', error.message);
                setErrorLoadingSongs(detailedErrorMessage);
                if (!apiPlayerName && userNameForApi !== defaultPlayerName) setApiPlayerName(userNameForApi);
            }
        } else { 
             toast({ 
                title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), 
                description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') 
            });
        }
      } else { 
         toast({ 
            title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), 
            description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') 
        });
      }

      // N20 Calculation
      let definedSongPoolEntries: ShowallApiSongEntry[] = [];
      if (globalMusicRecordsFromDataSource.length > 0) {
        definedSongPoolEntries = globalMusicRecordsFromDataSource.filter(globalSong => {
            if (globalSong.title) {
                const apiTitleTrimmedLower = globalSong.title.trim().toLowerCase();
                return newSongTitlesToMatch.includes(apiTitleTrimmedLower);
            }
            return false;
        });
        console.log(`[N20_STEP_DEF_POOL] Defined new song pool (found: ${definedSongPoolEntries.length}). First 3:`, definedSongPoolEntries.slice(0, 3).map(s => ({ title: s.title, id: s.id, diff: s.diff })));
      } else {
        console.warn("[N20_STEP_DEF_POOL] Global music data source is empty. Cannot define new song pool.");
      }
      
      if (definedSongPoolEntries.length > 0 && userShowallRecordsFromDataSource.length > 0) {
          const playedNewSongsForRating: Song[] = [];
          const userPlayedMap = new Map<string, ShowallApiSongEntry>();
          userShowallRecordsFromDataSource.forEach(usrSong => {
              if (usrSong.id && usrSong.diff) {
                  userPlayedMap.set(`${usrSong.id}_${usrSong.diff.toUpperCase()}`, usrSong);
              }
          });

          definedSongPoolEntries.forEach((newSongDef, index) => {
              const userPlayRecord = userPlayedMap.get(`${newSongDef.id}_${newSongDef.diff.toUpperCase()}`);
              if (userPlayRecord && typeof userPlayRecord.score === 'number' && userPlayRecord.score > 0) { 
                  const combinedSongEntry: ShowallApiSongEntry = { ...newSongDef, score: userPlayRecord.score, is_played: true, is_clear: userPlayRecord.is_clear, is_fullcombo: userPlayRecord.is_fullcombo, is_alljustice: userPlayRecord.is_alljustice, is_fullchain: userPlayRecord.is_fullchain };
                  const appSong = mapApiSongToAppSong(combinedSongEntry, index); 
                  if (appSong.currentRating > 0) playedNewSongsForRating.push(appSong);
              }
          });
          const sortedPlayedNewSongs = sortSongsByRatingDesc(playedNewSongsForRating);
          setNew20SongsData(sortedPlayedNewSongs.slice(0, NEW_COUNT));
          console.log(`[N20_CALC_USER] Final New 20 list (top ${NEW_COUNT}):`, sortedPlayedNewSongs.slice(0, NEW_COUNT).map(s => ({title: s.title, rating: s.currentRating, id: s.id, diff: s.diff })));
      } else {
          console.warn("[N20_CALC_USER] New song pool empty or user has no play records. Cannot calculate New 20.");
          setNew20SongsData([]);
      }
      setIsLoadingSongs(false);
    };

    if (clientHasMounted) {
      fetchAndProcessData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNameForApi, refreshNonce, clientHasMounted, locale]); 

  // 과제 1-3 & 1-4: 갱신 불가/가능 곡 분류
  useEffect(() => {
    if (best30SongsData.length > 0) {
      const nonUpdatable = best30SongsData.filter(song => song.currentScore >= 1009000);
      setNonUpdatableB30Songs(nonUpdatable);
      console.log(`[CHAL_1-3_NON_UPDATABLE_B30] Non-updatable B30 songs (score >= 1,009,000): ${nonUpdatable.length} songs.`, nonUpdatable.map(s => ({ title: s.title, score: s.currentScore })));
      
      const updatable = best30SongsData.filter(song => song.currentScore < 1009000);
      setUpdatableB30Songs(updatable);
      console.log(`[CHAL_1-4_UPDATABLE_B30] Updatable B30 songs (score < 1,009,000): ${updatable.length} songs.`, updatable.map(s => ({ title: s.title, score: s.currentScore, rating: s.currentRating })).slice(0, 5));
    } else {
      setNonUpdatableB30Songs([]);
      setUpdatableB30Songs([]);
    }
  }, [best30SongsData]);

  // 과제 1-5: '갱신 가능' 그룹 곡들의 현재 레이팅 값 평균을 '중간값'으로 계산
  useEffect(() => {
    if (updatableB30Songs.length > 0) {
      const sumOfRatings = updatableB30Songs.reduce((sum, song) => sum + song.currentRating, 0);
      const average = sumOfRatings / updatableB30Songs.length;
      setAverageRatingOfUpdatableB30(parseFloat(average.toFixed(2)));
      console.log(`[CHAL_1-5_AVG_RATING_UPDATABLE_B30] Average rating of updatable B30 songs: ${average.toFixed(2)} (${updatableB30Songs.length} songs)`);
    } else {
      setAverageRatingOfUpdatableB30(null);
      console.log(`[CHAL_1-5_AVG_RATING_UPDATABLE_B30] No updatable B30 songs to calculate average rating.`);
    }
  }, [updatableB30Songs]);

  // 과제 1-6: 그룹 A 분류 (중간값 이하, 레이팅 낮은 순 정렬)
  useEffect(() => {
    if (updatableB30Songs.length > 0 && averageRatingOfUpdatableB30 !== null) {
      const groupA = updatableB30Songs
        .filter(song => song.currentRating <= averageRatingOfUpdatableB30)
        .sort((a, b) => a.currentRating - b.currentRating); // 레이팅 낮은 순 (오름차순)
      setGroupAB30Songs(groupA);
      console.log(`[CHAL_1-6_GROUP_A_B30] Group A (<= avg rating, sorted asc): ${groupA.length} songs. Avg Rating: ${averageRatingOfUpdatableB30}. Sample:`, groupA.slice(0,3).map(s => ({title: s.title, rating: s.currentRating})));
    } else {
      setGroupAB30Songs([]);
      if (averageRatingOfUpdatableB30 === null && updatableB30Songs.length > 0) {
        console.log(`[CHAL_1-6_GROUP_A_B30] Group A not set because average rating is null, though updatable songs exist.`);
      }
    }
  }, [updatableB30Songs, averageRatingOfUpdatableB30]);


  // Combined songs logic
  useEffect(() => {
    if (!isLoadingSongs) {
      if (best30SongsData.length > 0 || new20SongsData.length > 0) {
        const songMap = new Map<string, Song>();
        best30SongsData.forEach(song => songMap.set(`${song.id}_${song.diff}`, song));
        new20SongsData.forEach(song => {
          const key = `${song.id}_${song.diff}`;
          if (!songMap.has(key)) songMap.set(key, song);
        });
        setCombinedTopSongs(sortSongsByRatingDesc(Array.from(songMap.values())));
      } else {
        setCombinedTopSongs([]);
      }
    }
  }, [best30SongsData, new20SongsData, isLoadingSongs]);

  // Cache combined data
  useEffect(() => {
    if (!isLoadingSongs && userNameForApi && userNameForApi !== getTranslation(locale, 'resultPageDefaultPlayerName') && clientHasMounted && (best30SongsData.length > 0 || new20SongsData.length > 0)) {
      const combinedDataKey = `${LOCAL_STORAGE_PREFIX}combined_b30_n20_${userNameForApi}`;
      const dataToCache = { best30: best30SongsData, new20: new20SongsData };
      setCachedData(combinedDataKey, dataToCache, USER_DATA_CACHE_EXPIRY_MS);
      // toast({ title: getTranslation(locale, 'toastInfoCombinedCacheSuccessTitle'), description: getTranslation(locale, 'toastInfoCombinedCacheSuccessDesc') }); // Consider if this toast is too frequent
    }
  }, [best30SongsData, new20SongsData, userNameForApi, isLoadingSongs, locale, clientHasMounted, toast]);

  return {
    apiPlayerName,
    best30SongsData,
    new20SongsData,
    combinedTopSongs,
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    isScoreLimitReleased,
    nonUpdatableB30Songs,
    updatableB30Songs,
    averageRatingOfUpdatableB30,
    groupAB30Songs, // Exporting Group A
  };
}


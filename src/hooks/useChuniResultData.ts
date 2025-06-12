
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, GLOBAL_MUSIC_CACHE_EXPIRY_MS, LOCAL_STORAGE_PREFIX, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateChunithmSongRating } from '@/lib/rating-utils';
import type { Song, ProfileData, RatingApiResponse, GlobalMusicApiResponse, UserShowallApiResponse, ShowallApiSongEntry, RatingApiSongEntry, CalculationStrategy } from "@/types/result-page";

const BEST_COUNT = 30;
const NEW_COUNT = 20;

interface UseChuniResultDataProps {
  userNameForApi: string | null;
  currentRatingDisplay: string | null;
  targetRatingDisplay: string | null;
  locale: Locale;
  refreshNonce: number;
  clientHasMounted: boolean;
  calculationStrategy: CalculationStrategy; // Added calculationStrategy
}

export function useChuniResultData({
  userNameForApi,
  currentRatingDisplay,
  targetRatingDisplay,
  locale,
  refreshNonce,
  clientHasMounted,
  calculationStrategy, // Consumed calculationStrategy
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
  const [groupAB30Songs, setGroupAB30Songs] = useState<Song[]>([]);
  const [groupBB30Songs, setGroupBB30Songs] = useState<Song[]>([]);

  // State variables for simulation (Task 1: Steps 1-8 to 1-12)
  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);
  const [targetRatingReached, setTargetRatingReached] = useState(false);
  const [allUpdatableSongsCapped, setAllUpdatableSongsCapped] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState<'idle' | 'running' | 'target_reached' | 'capped_target_not_reached' | 'error'>('idle');


  // 과제 0-1: 레이팅 계산 규칙은 rating-utils.ts 에 calculateChunithmSongRating로 이미 구현됨.

  // 과제 1-1: 점수 상한 한계 해제 플래그 결정
  useEffect(() => {
    if (clientHasMounted) {
      const currentIsValidNumber = currentRatingDisplay && !isNaN(parseFloat(currentRatingDisplay));
      const targetIsValidNumber = targetRatingDisplay && !isNaN(parseFloat(targetRatingDisplay));

      if (currentIsValidNumber && targetIsValidNumber) {
        const currentRatingNum = parseFloat(currentRatingDisplay);
        const targetRatingNum = parseFloat(targetRatingDisplay);
        // 과제 0-2: 예외 규칙: (목표 레이팅 - 현재 레이팅) * 50 > 10
        const limitReleaseCondition = (targetRatingNum - currentRatingNum) * 50 > 10;
        setIsScoreLimitReleased(limitReleaseCondition);
        console.log(`[CHAL_1-1_SCORE_CAP_RELEASE] Score cap release flag set to ${limitReleaseCondition}. ((target:${targetRatingNum} - current:${currentRatingNum}) * 50 > 10)`);
      } else {
        setIsScoreLimitReleased(false);
        console.log(`[CHAL_1-1_SCORE_CAP_RELEASE] Ratings ('${currentRatingDisplay}', '${targetRatingDisplay}') not valid numbers or not available, score cap release flag defaults to false.`);
      }
    }
  }, [clientHasMounted, currentRatingDisplay, targetRatingDisplay]);


  // 과제 1-2: B30 데이터 로드 (fetchAndProcessData 내에서 best30SongsData 설정)
  useEffect(() => {
    const fetchAndProcessData = async () => {
      // ... (기존 데이터 로딩 로직은 생략, 이전 단계에서 이미 구현됨) ...
      // 이 함수 내부에서 setBest30SongsData가 호출되면 1-2단계가 완료된 것으로 간주
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
      setSimulationStatus('idle'); // Reset simulation status on new data load/refresh

      const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
      const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
      const globalMusicKey = GLOBAL_MUSIC_DATA_KEY;
      const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;

      const newSongTitlesRaw = NewSongsData.titles?.verse || [];
      const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());
      
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

      let b30Loaded = false;
      if (profileData) {
        setApiPlayerName(profileData.player_name || userNameForApi);
      }
      if (ratingData) {
        const bestEntriesApi = ratingData.best?.entries?.filter((e: any): e is RatingApiSongEntry =>
            e !== null && typeof e.id === 'string' && e.id.trim() !== '' && 
            typeof e.diff === 'string' && e.diff.trim() !== '' &&
            typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') &&
            typeof e.title === 'string' && e.title.trim() !== ''
        ) || [];
        const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
        setBest30SongsData(sortSongsByRatingDesc(mappedBestEntries));
        console.log("[CHAL_1-2_B30_LOAD_CACHE] Best 30 songs data loaded from cache. Count:", mappedBestEntries.length);
        b30Loaded = true;
      }

      if (!profileData || !ratingData || !globalMusicData?.records || !userShowallData?.records) {
        console.log("Fetching some data from API as cache is missing or expired...");
        const apiRequests = [];
        if (!profileData) apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/profile.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'profile', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'profile', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        if (!ratingData) apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'rating', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'rating', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        if (!globalMusicData?.records) apiRequests.push(fetch(`https://api.chunirec.net/2.0/music/showall.json?region=jp2&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'globalMusic', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'globalMusic', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        if (!userShowallData?.records) apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'userShowall', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'userShowall', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        
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
                          e && e.id && typeof e.id === 'string' && e.id.trim() !== '' &&
                          e.diff && typeof e.diff === 'string' && e.diff.trim() !== '' &&
                          typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') &&
                          e.title && typeof e.title === 'string' && e.title.trim() !== ''
                      ) || [];
                      const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
                      setBest30SongsData(sortSongsByRatingDesc(mappedBestEntries));
                      console.log("[CHAL_1-2_B30_LOAD_API] Best 30 songs data loaded from API. Count:", mappedBestEntries.length);
                      b30Loaded = true;
                      setCachedData<RatingApiResponse>(ratingDataKey, res.data);
                      ratingData = res.data; 
                    }
                    if (res.type === 'globalMusic' && !globalMusicData?.records) {
                        let rawApiRecordsForGlobal: any[] = [];
                        if (Array.isArray(res.data)) rawApiRecordsForGlobal = res.data;
                        else if (res.data && Array.isArray(res.data.records)) rawApiRecordsForGlobal = res.data.records; 

                        const flattenedGlobalMusicEntries: ShowallApiSongEntry[] = [];
                        if (rawApiRecordsForGlobal.length > 0 && rawApiRecordsForGlobal[0] && rawApiRecordsForGlobal[0].meta && typeof rawApiRecordsForGlobal[0].data === 'object') {
                            rawApiRecordsForGlobal.forEach(rawEntry => {
                                if (rawEntry && rawEntry.meta && rawEntry.data && typeof rawEntry.data === 'object') {
                                    const meta = rawEntry.meta; const difficulties = rawEntry.data;
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
                    }
                    if (res.type === 'userShowall' && !userShowallData?.records) {
                        userShowallRecordsFromDataSource = (res.data.records || []).filter((e: any): e is ShowallApiSongEntry =>
                            e && e.id && typeof e.id === 'string' && e.id.trim() !== '' &&
                            e.diff && typeof e.diff === 'string' && e.diff.trim() !== '' &&
                            (e.score !== undefined) && e.title && typeof e.title === 'string' && e.title.trim() !== ''
                        );
                        setCachedData<UserShowallApiResponse>(userShowallKey, { records: userShowallRecordsFromDataSource }, USER_DATA_CACHE_EXPIRY_MS);
                    }
                }
                if (criticalError) throw new Error(criticalError);
                
                const newCacheTime = new Date().toLocaleString(locale);
                setLastRefreshed(getTranslation(locale, 'resultPageSyncStatus', newCacheTime));
                if (b30Loaded || (!ratingData && criticalError)) { // Only toast API success if rating data was part of it or if an error on rating occurred
                  toast({ title: getTranslation(locale, 'resultPageToastApiLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastApiLoadSuccessDesc', newCacheTime) });
                }
            } catch (error) {
                console.error("Error fetching song data from API:", error);
                let detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', "Unknown error");
                if (error instanceof Error) detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', error.message);
                setErrorLoadingSongs(detailedErrorMessage);
                if (!apiPlayerName && userNameForApi !== defaultPlayerName) setApiPlayerName(userNameForApi);
            }
        } else if (b30Loaded) { // Only toast cache success if B30 was indeed loaded from cache
             toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
        }
      } else if (b30Loaded) { // All data was from cache, and B30 was loaded.
         toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
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
                  const combinedSongEntry: ShowallApiSongEntry = { ...newSongDef, score: userPlayRecord.score, is_played: true, is_clear: userPlayRecord.is_clear, is_fullcombo: userPlayRecord.is_fullcombo, is_alljustice: userPlayRecord.is_alljustice };
                  const appSong = mapApiSongToAppSong(combinedSongEntry, index); 
                  if (appSong.currentRating > 0) playedNewSongsForRating.push(appSong);
              }
          });
          const sortedPlayedNewSongs = sortSongsByRatingDesc(playedNewSongsForRating);
          setNew20SongsData(sortedPlayedNewSongs.slice(0, NEW_COUNT));
      } else {
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
      console.log(`[CHAL_1-3_NON_UPDATABLE_B30] Non-updatable B30 songs (score >= 1,009,000): ${nonUpdatable.length} songs.`);
      
      const updatable = best30SongsData.filter(song => song.currentScore < 1009000);
      setUpdatableB30Songs(updatable);
      console.log(`[CHAL_1-4_UPDATABLE_B30] Updatable B30 songs (score < 1,009,000): ${updatable.length} songs.`);
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

  // 과제 1-6 (그룹 A 분류) & 1-7 (그룹 B 분류)
  useEffect(() => {
    if (updatableB30Songs.length > 0 && averageRatingOfUpdatableB30 !== null) {
      const groupA = updatableB30Songs
        .filter(song => song.currentRating <= averageRatingOfUpdatableB30!)
        .sort((a, b) => a.currentRating - b.currentRating); 
      setGroupAB30Songs(groupA);
      console.log(`[CHAL_1-6_GROUP_A_B30] Group A (<= avg rating ${averageRatingOfUpdatableB30}, sorted asc): ${groupA.length} songs.`);

      const groupB = updatableB30Songs
        .filter(song => song.currentRating > averageRatingOfUpdatableB30!)
        .sort((a, b) => a.currentRating - b.currentRating);
      setGroupBB30Songs(groupB);
      console.log(`[CHAL_1-7_GROUP_B_B30] Group B (> avg rating ${averageRatingOfUpdatableB30}, sorted asc): ${groupB.length} songs.`);
    } else {
      setGroupAB30Songs([]);
      setGroupBB30Songs([]);
    }
  }, [updatableB30Songs, averageRatingOfUpdatableB30]);

  // Helper function to find score for target rating (1-9, 1-10)
  const findScoreForTargetRating = useCallback((
    currentSong: Song,
    desiredRatingIncrease: number,
    isLimitReleased: boolean
  ): { newScore: number; newRating: number; capped: boolean } => {
    if (!currentSong.chartConstant) {
      console.warn(`[SIM_WARN_NO_CONST] Song ${currentSong.title} (${currentSong.diff}) has no chart constant. Cannot simulate score increase.`);
      return { newScore: currentSong.currentScore, newRating: currentSong.currentRating, capped: true };
    }

    const targetRating = parseFloat((currentSong.currentRating + desiredRatingIncrease).toFixed(4)); // Target with high precision
    const maxScore = isLimitReleased ? 1010000 : 1009000; 
    let newScore = currentSong.currentScore;
    let newRating = currentSong.currentRating;
    let cappedAtMax = false;

    if (currentSong.currentScore >= maxScore) {
        return { newScore: currentSong.currentScore, newRating: currentSong.currentRating, capped: true };
    }

    // Iterative search for the score
    // Start from currentScore + 1, up to maxScore
    // This is a dense search; could be optimized (e.g. binary search or intelligent steps)
    for (let scoreAttempt = currentSong.currentScore + 1; scoreAttempt <= maxScore; scoreAttempt += 1) { // Increment by 1 for precision
      const calculatedRating = calculateChunithmSongRating(scoreAttempt, currentSong.chartConstant);
      
      if (calculatedRating >= targetRating) {
        newScore = scoreAttempt;
        newRating = calculatedRating;
        break; 
      }
      if (scoreAttempt === maxScore) { // Reached max score
        newScore = maxScore;
        newRating = calculateChunithmSongRating(newScore, currentSong.chartConstant);
        cappedAtMax = true;
        break;
      }
    }
    // If targetRating is extremely small, it might be that currentRating already satisfies it or is higher.
    // Or if the smallest score increment (1) already overshoots the desiredRatingIncrease.
    // In such cases, if no score increase was found by the loop, make a minimal increment if not capped.
    if (newScore === currentSong.currentScore && currentSong.currentScore < maxScore && newRating < targetRating) {
        newScore = currentSong.currentScore + 1;
        newRating = calculateChunithmSongRating(newScore, currentSong.chartConstant);
    }
    
    return { newScore, newRating: parseFloat(newRating.toFixed(2)), capped: newScore >= maxScore || cappedAtMax };
  }, [isScoreLimitReleased]); // Removed calculateChunithmSongRating as it's imported globally

  // 과제 1-8: 1차 상승 루프 시작 (상태 초기화)
  useEffect(() => {
    if (calculationStrategy === 'average' && best30SongsData.length > 0 && simulationStatus === 'idle') {
      console.log("[SIM_INIT_AVERAGE] Initializing B30 simulation for 'Average' strategy.");
      setSimulatedB30Songs([...best30SongsData].map(song => ({...song}))); // Deep copy for simulation
      setTargetRatingReached(false);
      setAllUpdatableSongsCapped(false);
      const initialAvg = best30SongsData.reduce((sum, s) => sum + s.currentRating, 0) / Math.max(1, best30SongsData.length);
      setSimulatedAverageB30Rating(parseFloat(initialAvg.toFixed(2)));
      // Do not set to 'running' here, let the main simulation effect handle it.
    } else if (calculationStrategy !== 'average' && simulationStatus !== 'idle') {
        // If strategy changes, reset simulation related states for B30
        setSimulatedB30Songs([]);
        setSimulatedAverageB30Rating(null);
        setTargetRatingReached(false);
        setAllUpdatableSongsCapped(false);
        setSimulationStatus('idle');
        console.log("[SIM_RESET] Simulation states reset due to strategy change or re-evaluation.");
    }
  }, [calculationStrategy, best30SongsData, simulationStatus]); // Added simulationStatus to dependencies

  // 과제 1-9, 1-10, 1-11, 1-12: 시뮬레이션 루프, 중간 결과 확인, 종료 조건
  useEffect(() => {
    if (calculationStrategy !== 'average' || simulationStatus === 'target_reached' || simulationStatus === 'capped_target_not_reached' || isLoadingSongs) {
      if (simulationStatus === 'running') setSimulationStatus('idle'); // Stop running if conditions no longer met
      return;
    }
    
    // Start simulation if idle and conditions are met
    if (simulationStatus === 'idle' && groupAB30Songs.length > 0 && groupBB30Songs.length > 0 && simulatedB30Songs.length > 0 && targetRatingDisplay) {
        console.log("[SIM_START_ITERATION] Starting new simulation iteration for 'Average' strategy.");
        setSimulationStatus('running');
    }

    if (simulationStatus === 'running') {
        let internalSimulatedSongs = [...simulatedB30Songs.map(s => ({...s}))]; // Work on a mutable copy for this iteration
        let songsUpdatedInIter = false;
        
        // 1-9: 그룹 A 점수 상승 (레이팅 +0.001 목표)
        if (groupAB30Songs.length > 0) {
            const songToUpdateInA_original = groupAB30Songs[0]; // Lowest rating in original Group A
            const songInSimulatedA = internalSimulatedSongs.find(s => s.id === songToUpdateInA_original.id && s.diff === songToUpdateInA_original.diff);

            if (songInSimulatedA && songInSimulatedA.currentScore < (isScoreLimitReleased ? 1010000 : 1009000)) {
                const { newScore, newRating, capped } = findScoreForTargetRating(songInSimulatedA, 0.001, isScoreLimitReleased);
                if (newScore > songInSimulatedA.currentScore || newRating > songInSimulatedA.currentRating) {
                    songInSimulatedA.currentScore = newScore;
                    songInSimulatedA.currentRating = newRating;
                    console.log(`[SIM_GROUP_A_UPDATE] Song: ${songInSimulatedA.title}, New Score: ${newScore}, New Rating: ${newRating.toFixed(2)}, Capped: ${capped}`);
                    songsUpdatedInIter = true;
                }
            }
        }

        // 1-10: 그룹 B 점수 상승 (레이팅 +0.0005 목표)
        if (groupBB30Songs.length > 0) {
            const songToUpdateInB_original = groupBB30Songs[0]; // Lowest rating in original Group B
            const songInSimulatedB = internalSimulatedSongs.find(s => s.id === songToUpdateInB_original.id && s.diff === songToUpdateInB_original.diff);
            
            if (songInSimulatedB && songInSimulatedB.currentScore < (isScoreLimitReleased ? 1010000 : 1009000)) {
                const { newScore, newRating, capped } = findScoreForTargetRating(songInSimulatedB, 0.0005, isScoreLimitReleased);
                 if (newScore > songInSimulatedB.currentScore || newRating > songInSimulatedB.currentRating) {
                    songInSimulatedB.currentScore = newScore;
                    songInSimulatedB.currentRating = newRating;
                    console.log(`[SIM_GROUP_B_UPDATE] Song: ${songInSimulatedB.title}, New Score: ${newScore}, New Rating: ${newRating.toFixed(2)}, Capped: ${capped}`);
                    songsUpdatedInIter = true;
                }
            }
        }
        
        if (songsUpdatedInIter) {
            // Re-sort and update main state to trigger next effects
            const sortedSimulatedSongs = sortSongsByRatingDesc(internalSimulatedSongs);
            setSimulatedB30Songs(sortedSimulatedSongs);
            // The status will be set back to 'idle' by the 1-11/1-12 check effect or if no updates occurred.
        } else {
             // No songs were updated (e.g., all relevant songs are capped or no valid targets)
            console.log("[SIM_NO_UPDATES] No songs updated in this iteration. Checking for cap condition.");
            setSimulationStatus('idle'); // Prepare for cap check or stop.
            // Explicitly trigger cap check if no updates were made.
            // This is handled by the dependency array of the cap check useEffect.
        }
    }
    // Dependency on targetRatingDisplay to re-evaluate if target changes. GroupA/B ensure data is ready.
  }, [
    calculationStrategy, 
    simulationStatus, 
    isLoadingSongs,
    groupAB30Songs, 
    groupBB30Songs, 
    simulatedB30Songs, 
    targetRatingDisplay, 
    isScoreLimitReleased, 
    findScoreForTargetRating // findScoreForTargetRating is memoized by useCallback
  ]);

  // 1-11: 중간 결과 확인 (타겟 달성 여부)
  useEffect(() => {
    if (simulatedB30Songs.length > 0 && targetRatingDisplay) {
      const currentSimAvg = simulatedB30Songs.slice(0, BEST_COUNT).reduce((sum, s) => sum + s.currentRating, 0) / Math.min(simulatedB30Songs.length, BEST_COUNT);
      setSimulatedAverageB30Rating(parseFloat(currentSimAvg.toFixed(2)));
      console.log(`[SIM_AVG_RECALC] Simulated B30 Average Rating: ${currentSimAvg.toFixed(2)}`);

      const targetRatingNum = parseFloat(targetRatingDisplay);
      if (!isNaN(targetRatingNum) && currentSimAvg >= targetRatingNum) {
        setTargetRatingReached(true);
        setSimulationStatus('target_reached');
        console.log(`[SIM_TARGET_REACHED] Target rating ${targetRatingNum.toFixed(2)} reached. Simulated average: ${currentSimAvg.toFixed(2)}`);
      } else if (simulationStatus === 'running' && targetRatingReached) {
         // If status was running but target is now reached by this effect
         setSimulationStatus('target_reached');
      } else if (simulationStatus === 'running' && !targetRatingReached) {
         setSimulationStatus('idle'); // Ready for next iteration if target not reached
      }
    }
  }, [simulatedB30Songs, targetRatingDisplay, simulationStatus, targetRatingReached]); // Added targetRatingReached and simulationStatus

  // 1-12: 1차 상승 종료 확인 (모든 곡 상한 도달)
  useEffect(() => {
    if (targetRatingReached || simulationStatus !== 'idle' || updatableB30Songs.length === 0 || simulatedB30Songs.length === 0) {
      // If target is reached, or simulation isn't in a state to check for capping, or no updatable songs, bail.
      return;
    }

    let allCapped = true;
    for (const originalUpdatableSong of updatableB30Songs) {
      const simulatedVersion = simulatedB30Songs.find(s => s.id === originalUpdatableSong.id && s.diff === originalUpdatableSong.diff);
      if (simulatedVersion) {
        if (simulatedVersion.currentScore < (isScoreLimitReleased ? 1010000 : 1009000)) {
          allCapped = false;
          break;
        }
      } else {
        // This case should ideally not happen if simulatedB30Songs is properly initialized
        console.warn(`[SIM_CAP_CHECK_WARN] Original updatable song ${originalUpdatableSong.title} not found in simulated list.`);
        allCapped = false; // Treat as not capped if missing, to be safe
        break;
      }
    }

    if (allCapped) {
      setAllUpdatableSongsCapped(true);
      if (!targetRatingReached) { // Double check as this effect might run concurrently
        setSimulationStatus('capped_target_not_reached');
        console.log("[SIM_ALL_CAPPED_NO_TARGET] All updatable B30 songs have reached score cap, but target rating not met.");
      } else {
        // If target was reached and then all songs found to be capped.
        setSimulationStatus('target_reached'); // Ensure final status is correct
         console.log("[SIM_ALL_CAPPED_TARGET_MET] All updatable B30 songs capped, target rating was met.");
      }
    } else if (simulationStatus === 'idle' && !targetRatingReached && !allUpdatableSongsCapped) {
        // If idle, not reached, not all capped, means it's ready for another iteration if conditions in main sim loop allow
        // Or it means no updates occurred in the last iteration and it's stuck - this implies all songs that *could* be updated were, and they hit cap or no more increase possible.
        // This state indicates the main simulation loop should re-evaluate.
    }
  }, [simulatedB30Songs, updatableB30Songs, isScoreLimitReleased, targetRatingReached, simulationStatus, allUpdatableSongsCapped]); // Added allUpdatableSongsCapped


  // Combined songs logic
  useEffect(() => {
    if (!isLoadingSongs) {
      if (best30SongsData.length > 0 || new20SongsData.length > 0) {
        const songMap = new Map<string, Song>();
        // Use simulatedB30Songs if available and in average strategy, otherwise use best30SongsData
        const baseB30 = (calculationStrategy === 'average' && simulatedB30Songs.length > 0) ? simulatedB30Songs : best30SongsData;
        
        baseB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, song));
        new20SongsData.forEach(song => { // N20 simulation not yet implemented, using raw N20
          const key = `${song.id}_${song.diff}`;
          if (!songMap.has(key)) songMap.set(key, song);
        });
        setCombinedTopSongs(sortSongsByRatingDesc(Array.from(songMap.values())));
      } else {
        setCombinedTopSongs([]);
      }
    }
  }, [best30SongsData, new20SongsData, isLoadingSongs, simulatedB30Songs, calculationStrategy]);

  // Cache combined data
  useEffect(() => {
    if (!isLoadingSongs && userNameForApi && userNameForApi !== getTranslation(locale, 'resultPageDefaultPlayerName') && clientHasMounted && (best30SongsData.length > 0 || new20SongsData.length > 0)) {
      const combinedDataKey = `${LOCAL_STORAGE_PREFIX}combined_b30_n20_${userNameForApi}`;
      const dataToCache = { best30: best30SongsData, new20: new20SongsData }; // Cache original data
      setCachedData(combinedDataKey, dataToCache, USER_DATA_CACHE_EXPIRY_MS);
    }
  }, [best30SongsData, new20SongsData, userNameForApi, isLoadingSongs, locale, clientHasMounted]);

  return {
    apiPlayerName,
    best30SongsData: (calculationStrategy === 'average' && simulatedB30Songs.length > 0) ? simulatedB30Songs : best30SongsData, // Return simulated if active
    new20SongsData, // N20 simulation not yet handled
    combinedTopSongs,
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    isScoreLimitReleased,
    nonUpdatableB30Songs,
    updatableB30Songs,
    averageRatingOfUpdatableB30,
    groupAB30Songs,
    groupBB30Songs,
    // Simulation related state for UI display or further logic
    simulatedAverageB30Rating,
    targetRatingReached,
    allUpdatableSongsCapped,
    simulationStatus,
  };
}

// Ensure calculationStrategy is passed to the hook from ResultContent
// Add calculationStrategy to the props of useChuniResultData and its invocation in ResultContent
// Modify ResultContent to pass calculationStrategy to useChuniResultData hook.
// The hook now receives calculationStrategy from the ResultContent component.
// The ResultContent component already has calculationStrategy in its state.

// Example of how findScoreForTargetRating might be called (conceptual):
// if (songInSimulatedA && songInSimulatedA.currentScore < scoreCap) {
//   const desiredNewRatingForA = songInSimulatedA.currentRating + 0.001;
//   const updateResultA = findScoreForTargetRating(songInSimulatedA, desiredNewRatingForA, isScoreLimitReleased);
//   songInSimulatedA.currentScore = updateResultA.newScore;
//   songInSimulatedA.currentRating = updateResultA.newRating;
//   // if (updateResultA.capped) markAsCapped(songInSimulatedA);
// }
// This logic needs to be integrated into the main simulation useEffect.
```CDATA[</content>
  </change>
  <change>
    <file>/src/app/result/page.tsx</file>
    <content><![CDATA[
"use client";

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import SongCard from "@/components/SongCard";
import { User, Gauge, Target as TargetIconLucide, ArrowLeft, Loader2, AlertTriangle, BarChart3, TrendingUp, TrendingDown, RefreshCw, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslation } from '@/lib/translations';
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useChuniResultData } from "@/hooks/useChuniResultData"; 
import type { CalculationStrategy } from "@/types/result-page"; 
import { getApiToken } from '@/lib/get-api-token';
import { LOCAL_STORAGE_PREFIX } from '@/lib/cache';


function ResultContent() {
  const searchParams = useSearchParams();
  const { locale } = useLanguage();
  
  const initialUserName = searchParams.get("nickname");
  const initialCurrentRating = searchParams.get("current");
  const initialTargetRating = searchParams.get("target");

  const [userNameForApi, setUserNameForApi] = useState<string | null>(null);
  const [currentRatingDisplay, setCurrentRatingDisplay] = useState<string | null>(null);
  const [targetRatingDisplay, setTargetRatingDisplay] = useState<string | null>(null);

  const [calculationStrategy, setCalculationStrategy] = useState<CalculationStrategy>("average");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [clientHasMounted, setClientHasMounted] = useState(false);

  useEffect(() => {
    setClientHasMounted(true);
    setUserNameForApi(initialUserName || getTranslation(locale, 'resultPageDefaultPlayerName'));
    setCurrentRatingDisplay(initialCurrentRating || getTranslation(locale, 'resultPageNotAvailable'));
    setTargetRatingDisplay(initialTargetRating || getTranslation(locale, 'resultPageNotAvailable'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUserName, initialCurrentRating, initialTargetRating, locale]);

  const {
    apiPlayerName,
    best30SongsData,
    new20SongsData,
    combinedTopSongs,
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    simulatedAverageB30Rating, // Added for display
    targetRatingReached,      // Added for display
    allUpdatableSongsCapped,  // Added for display
    simulationStatus,         // Added for display
  } = useChuniResultData({
    userNameForApi,
    currentRatingDisplay,
    targetRatingDisplay,
    locale,
    refreshNonce,
    clientHasMounted,
    calculationStrategy, // Pass calculationStrategy to the hook
  });

  const handleRefreshData = useCallback(() => {
    const defaultPlayerName = getTranslation(locale, 'resultPageDefaultPlayerName');
    if (typeof window !== 'undefined' && userNameForApi && userNameForApi !== defaultPlayerName) {
        const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
        const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
        const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;
        const combinedDataKey = `${LOCAL_STORAGE_PREFIX}combined_b30_n20_${userNameForApi}`;
        localStorage.removeItem(profileKey);
        localStorage.removeItem(ratingDataKey);
        localStorage.removeItem(userShowallKey);
        localStorage.removeItem(combinedDataKey);
        console.log(`User-specific cache cleared for user: ${userNameForApi}`);
    }
    setRefreshNonce(prev => prev + 1);
  }, [userNameForApi, locale]);


  const best30GridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

  const renderSimulationStatus = () => {
    if (calculationStrategy !== 'average' || simulationStatus === 'idle' || isLoadingSongs) return null;

    let statusText = "";
    let bgColor = "bg-blue-100 dark:bg-blue-900";
    let textColor = "text-blue-700 dark:text-blue-300";

    switch (simulationStatus) {
      case 'running':
        statusText = "평균 옵션 시뮬레이션 실행 중...";
        bgColor = "bg-yellow-100 dark:bg-yellow-900";
        textColor = "text-yellow-700 dark:text-yellow-300";
        break;
      case 'target_reached':
        statusText = `목표 레이팅 ${targetRatingDisplay} 달성! (시뮬레이션된 B30 평균: ${simulatedAverageB30Rating?.toFixed(2)})`;
        bgColor = "bg-green-100 dark:bg-green-900";
        textColor = "text-green-700 dark:text-green-300";
        break;
      case 'capped_target_not_reached':
        statusText = `모든 갱신 가능 곡이 점수 상한에 도달했지만 목표 레이팅 ${targetRatingDisplay}에 미치지 못했습니다. (현 B30 평균: ${simulatedAverageB30Rating?.toFixed(2)}) 다음 단계(B30 교체)가 필요할 수 있습니다.`;
        bgColor = "bg-red-100 dark:bg-red-900";
        textColor = "text-red-700 dark:text-red-300";
        break;
      case 'error':
         statusText = "시뮬레이션 중 오류가 발생했습니다.";
         bgColor = "bg-red-100 dark:bg-red-900";
         textColor = "text-red-700 dark:text-red-300";
         break;
      default:
        return null;
    }

    return (
      <div className={cn("p-3 my-4 rounded-md text-sm flex items-center", bgColor, textColor)}>
        <Info className="w-5 h-5 mr-2" />
        <p>{statusText}</p>
      </div>
    );
  };


  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 p-4 bg-card border border-border rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex items-center gap-3">
            <User className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold font-headline">{apiPlayerName || userNameForApi || getTranslation(locale, 'resultPageDefaultPlayerName')}</h1>
              <Link href="/" className="text-sm text-primary hover:underline flex items-center">
                <ArrowLeft className="w-4 h-4 mr-1" /> {getTranslation(locale, 'resultPageButtonBackToCalc')}
              </Link>
            </div>
          </div>
          <div className="flex flex-col sm:items-end items-stretch gap-2">
            <div className="flex items-center justify-end gap-2 text-sm sm:text-base w-full">
              <div className="flex items-center p-2 bg-secondary rounded-md">
                <Gauge className="w-5 h-5 mr-2 text-primary" />
                <span>{getTranslation(locale, 'resultPageHeaderCurrent')} <span className="font-semibold">{currentRatingDisplay}</span></span>
              </div>
              <div className="flex items-center p-2 bg-secondary rounded-md">
                <TargetIconLucide className="w-5 h-5 mr-2 text-primary" />
                <span>{getTranslation(locale, 'resultPageHeaderTarget')} <span className="font-semibold">{targetRatingDisplay}</span></span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 w-full">
                <LanguageToggle />
                <ThemeToggle /> 
            </div>
          </div>
        </header>

        <div className="mb-4 flex flex-col sm:flex-row justify-between items-center gap-2">
            <p className="text-xs text-muted-foreground">
                {clientHasMounted && lastRefreshed
                    ? lastRefreshed
                    : getTranslation(locale, 'resultPageSyncStatusChecking')}
            </p>
            <Button 
                onClick={handleRefreshData} 
                variant="outline" 
                size="sm" 
                disabled={isLoadingSongs || !userNameForApi || userNameForApi === getTranslation(locale, 'resultPageDefaultPlayerName') || !getApiToken()}
            >
                <RefreshCw className={cn("w-4 h-4 mr-2", isLoadingSongs && "animate-spin")} />
                {getTranslation(locale, 'resultPageRefreshButton')}
            </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="font-headline text-xl">{getTranslation(locale, 'resultPageStrategyTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={calculationStrategy} 
              onValueChange={(value) => setCalculationStrategy(value as CalculationStrategy)}
              className="flex flex-col sm:flex-row gap-4"
            >
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                <RadioGroupItem value="average" id="r-average" />
                <Label htmlFor="r-average" className="flex items-center cursor-pointer">
                  <BarChart3 className="w-5 h-5 mr-2 text-primary" /> {getTranslation(locale, 'resultPageStrategyAverage')}
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                <RadioGroupItem value="peak" id="r-peak" />
                <Label htmlFor="r-peak" className="flex items-center cursor-pointer">
                  <TrendingUp className="w-5 h-5 mr-2 text-destructive" /> {getTranslation(locale, 'resultPageStrategyPeak')}
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                <RadioGroupItem value="floor" id="r-floor" />
                <Label htmlFor="r-floor" className="flex items-center cursor-pointer">
                  <TrendingDown className="w-5 h-5 mr-2 text-green-600" /> {getTranslation(locale, 'resultPageStrategyFloor')}
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground mt-2">
              {getTranslation(locale, 'resultPageStrategyDisclaimer')}
            </p>
          </CardContent>
        </Card>

        {renderSimulationStatus()}

        <Tabs defaultValue="best30" className="w-full">
          <TabsList className="grid w-full grid-cols-3 gap-1 mb-6 bg-muted p-1 rounded-lg">
            <TabsTrigger value="best30" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{getTranslation(locale, 'resultPageTabBest30')}</TabsTrigger>
            <TabsTrigger value="new20" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{getTranslation(locale, 'resultPageTabNew20')}</TabsTrigger>
            <TabsTrigger value="combined" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{getTranslation(locale, 'resultPageTabCombined')}</TabsTrigger>
          </TabsList>

          {isLoadingSongs ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-xl text-muted-foreground">{getTranslation(locale, 'resultPageLoadingSongsTitle')}</p>
              <p className="text-sm text-muted-foreground">
                { clientHasMounted && userNameForApi && userNameForApi !== getTranslation(locale, 'resultPageDefaultPlayerName')
                  ? ( (localStorage.getItem(`${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`) || localStorage.getItem(`${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`)) 
                    ? getTranslation(locale, 'resultPageLoadingCacheCheck')
                    : getTranslation(locale, 'resultPageLoadingApiFetch'))
                  : getTranslation(locale, 'resultPageLoadingDataStateCheck')
                }
              </p>
            </div>
          ) : errorLoadingSongs ? (
             <Card className="border-destructive">
              <CardHeader className="flex flex-row items-center space-x-2">
                <AlertTriangle className="w-6 h-6 text-destructive" />
                <CardTitle className="font-headline text-xl text-destructive">{getTranslation(locale, 'resultPageErrorLoadingTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-destructive">{errorLoadingSongs}</p>
                <p className="text-sm text-muted-foreground mt-2">{getTranslation(locale, 'resultPageErrorLoadingDesc')}</p>
                <Button asChild variant="outline" className="mt-4">
                  <Link href="/">{getTranslation(locale, 'resultPageButtonBackToCalc')}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <TabsContent value="best30">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">{getTranslation(locale, 'resultPageCardTitleBest30')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {best30SongsData.length > 0 ? (
                      <div className={cn("grid grid-cols-1 gap-4", best30GridCols)}>
                        {best30SongsData.map((song) => (
                          <SongCard key={`best30-${song.id}-${song.diff}`} song={song} calculationStrategy={calculationStrategy} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">{getTranslation(locale, 'resultPageNoBest30Data')}</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="new20">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">{getTranslation(locale, 'resultPageCardTitleNew20')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                       {new20SongsData.length > 0 ? (
                         <div className={cn("grid grid-cols-1 gap-4", best30GridCols )}>
                           {new20SongsData.map((song) => (
                             <SongCard key={`new20-${song.id}-${song.diff}`} song={song} calculationStrategy={calculationStrategy} />
                           ))}
                         </div>
                       ) : (
                         <p className="text-muted-foreground">{getTranslation(locale, 'resultPageNoNew20Data')}</p>
                       )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="combined">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">{getTranslation(locale, 'resultPageCardTitleCombined')}</CardTitle>
                  </CardHeader>
                  <CardContent> 
                    {combinedTopSongs.length > 0 ? (
                      <div className={cn("grid grid-cols-1 gap-4", best30GridCols)}>
                        {combinedTopSongs.map((song) => (
                          <SongCard key={`combined-${song.id}-${song.diff}`} song={song} calculationStrategy={calculationStrategy} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">{getTranslation(locale, 'resultPageNoCombinedData')}</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </main>
  );
}

export default function ResultPage() {
  const { locale } = useLanguage();
  return (
    <Suspense fallback={<div className="flex min-h-screen flex-col items-center justify-center text-xl"><Loader2 className="w-10 h-10 animate-spin mr-2" /> {getTranslation(locale, 'resultPageSuspenseFallback')}</div>}>
      <ResultContent />
    </Suspense>
  );
}

    
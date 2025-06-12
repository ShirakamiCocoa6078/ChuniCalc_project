
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
  calculationStrategy: CalculationStrategy;
}

export function useChuniResultData({
  userNameForApi,
  currentRatingDisplay,
  targetRatingDisplay,
  locale,
  refreshNonce,
  clientHasMounted,
  calculationStrategy,
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

  // State variables for simulation
  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);
  const [targetRatingReached, setTargetRatingReached] = useState(false);
  const [allUpdatableSongsCapped, setAllUpdatableSongsCapped] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState<'idle' | 'running_score_increase' | 'target_reached' | 'awaiting_replacement_loop' | 'replacing_song' | 'error'>('idle');


  // 과제 1-1: 점수 상한 한계 해제 플래그 결정 (0-2단계 규칙 적용)
  useEffect(() => {
    if (clientHasMounted) {
      const currentIsValidNumber = currentRatingDisplay && !isNaN(parseFloat(currentRatingDisplay));
      const targetIsValidNumber = targetRatingDisplay && !isNaN(parseFloat(targetRatingDisplay));

      if (currentIsValidNumber && targetIsValidNumber) {
        const currentRatingNum = parseFloat(currentRatingDisplay);
        const targetRatingNum = parseFloat(targetRatingDisplay);
        const limitReleaseCondition = (targetRatingNum - currentRatingNum) * 50 > 10;
        setIsScoreLimitReleased(limitReleaseCondition);
        console.log(`[CHAL_1-1_SCORE_CAP_RELEASE] Score cap release flag set to ${limitReleaseCondition}. ((target:${targetRatingNum} - current:${currentRatingNum}) * 50 > 10)`);
      } else {
        setIsScoreLimitReleased(false);
        console.log(`[CHAL_1-1_SCORE_CAP_RELEASE] Ratings ('${currentRatingDisplay}', '${targetRatingDisplay}') not valid numbers or not available, score cap release flag defaults to false.`);
      }
    }
  }, [clientHasMounted, currentRatingDisplay, targetRatingDisplay]);


  // 과제 1-2: 데이터 로드 (b30, n20 등)
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
                if (b30Loaded || (!ratingData && criticalError)) { 
                  toast({ title: getTranslation(locale, 'resultPageToastApiLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastApiLoadSuccessDesc', newCacheTime) });
                }
            } catch (error) {
                console.error("Error fetching song data from API:", error);
                let detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', "Unknown error");
                if (error instanceof Error) detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', error.message);
                setErrorLoadingSongs(detailedErrorMessage);
                if (!apiPlayerName && userNameForApi !== defaultPlayerName) setApiPlayerName(userNameForApi);
            }
        } else if (b30Loaded) { 
             toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
        }
      } else if (b30Loaded) { 
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

  // 과제 1-3 (갱신 불가 곡 분류) & 1-4 (갱신 가능 곡 분류)
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

  // 과제 1-6 (그룹 A 분류) & 1-7 (그룹 B 분류)
  useEffect(() => {
    if (updatableB30Songs.length > 0 && averageRatingOfUpdatableB30 !== null) {
      const groupA = updatableB30Songs
        .filter(song => song.currentRating <= averageRatingOfUpdatableB30!)
        .sort((a, b) => a.currentRating - b.currentRating); 
      setGroupAB30Songs(groupA);
      console.log(`[CHAL_1-6_GROUP_A_B30] Group A (<= avg rating ${averageRatingOfUpdatableB30}, sorted asc): ${groupA.length} songs. Sample:`, groupA.slice(0,3).map(s => ({title: s.title, rating: s.currentRating})));

      const groupB = updatableB30Songs
        .filter(song => song.currentRating > averageRatingOfUpdatableB30!)
        .sort((a, b) => a.currentRating - b.currentRating);
      setGroupBB30Songs(groupB);
      console.log(`[CHAL_1-7_GROUP_B_B30] Group B (> avg rating ${averageRatingOfUpdatableB30}, sorted asc): ${groupB.length} songs. Sample:`, groupB.slice(0,3).map(s => ({title: s.title, rating: s.currentRating})));
    } else {
      setGroupAB30Songs([]);
      setGroupBB30Songs([]);
    }
  }, [updatableB30Songs, averageRatingOfUpdatableB30]);

  // Helper function to find score for target rating (1-9, 1-10)
  const findScoreForTargetRating = useCallback((
    currentSong: Song,
    desiredRatingIncrease: number,
    isLimitReleasedLocal: boolean
  ): { newScore: number; newRating: number; capped: boolean } => {
    if (!currentSong.chartConstant) {
      console.warn(`[SIM_WARN_NO_CONST] Song ${currentSong.title} (${currentSong.diff}) has no chart constant. Cannot simulate score increase.`);
      return { newScore: currentSong.currentScore, newRating: currentSong.currentRating, capped: true };
    }

    const targetRatingValue = parseFloat((currentSong.currentRating + desiredRatingIncrease).toFixed(4));
    const maxScore = isLimitReleasedLocal ? 1010000 : 1009000; 
    let newScore = currentSong.currentScore;
    let newRating = currentSong.currentRating;
    let cappedAtMax = false;

    if (currentSong.currentScore >= maxScore) {
        return { newScore: currentSong.currentScore, newRating: currentSong.currentRating, capped: true };
    }

    // Iterative search for score
    // Start from currentScore + 1 to ensure some change if possible
    for (let scoreAttempt = currentSong.currentScore + 1; scoreAttempt <= maxScore; scoreAttempt += 1) { // Increment by 1 for precision
      const calculatedRating = calculateChunithmSongRating(scoreAttempt, currentSong.chartConstant);
      
      if (calculatedRating >= targetRatingValue) {
        newScore = scoreAttempt;
        newRating = calculatedRating;
        break; 
      }
      // If we reach maxScore and still haven't met targetRatingValue, this is the best we can do.
      if (scoreAttempt === maxScore) {
        newScore = maxScore;
        newRating = calculateChunithmSongRating(newScore, currentSong.chartConstant); // Rating at max score
        cappedAtMax = true; // Explicitly set capped if we hit maxScore here
        break;
      }
    }

    // If loop finished without breaking (i.e. targetRatingValue never met, but score didn't reach maxScore)
    // this usually means desiredRatingIncrease was too small to make a change with +1 score, or already at max possible rating for < maxScore
    // Ensure newScore is at least currentScore + 1 if possible and not already capped
    if (newScore === currentSong.currentScore && currentSong.currentScore < maxScore && newRating < targetRatingValue) {
        newScore = currentSong.currentScore + 1; // Try to nudge it by at least 1 point
        newRating = calculateChunithmSongRating(newScore, currentSong.chartConstant);
        if (newScore >= maxScore) cappedAtMax = true; // Check cap again if nudged to maxScore
    }
    
    return { newScore, newRating: parseFloat(newRating.toFixed(2)), capped: newScore >= maxScore || cappedAtMax };
  }, []);

  // 과제 1-8: 1차 상승 루프 시작 (상태 초기화)
  useEffect(() => {
    if (calculationStrategy === 'average' && best30SongsData.length > 0 && simulationStatus === 'idle') {
      console.log("[SIM_INIT_AVERAGE] Initializing B30 simulation for 'Average' strategy.");
      setSimulatedB30Songs([...best30SongsData].map(song => ({...song}))); // Deep copy
      setTargetRatingReached(false);
      setAllUpdatableSongsCapped(false);
      const initialAvg = best30SongsData.reduce((sum, s) => sum + s.currentRating, 0) / Math.max(1, best30SongsData.length);
      setSimulatedAverageB30Rating(parseFloat(initialAvg.toFixed(2)));
      // Do not automatically set to 'running_score_increase' here, let the next effect handle it based on conditions
    } else if (calculationStrategy !== 'average' && simulationStatus !== 'idle') {
        // Reset simulation states if strategy changes away from 'average'
        setSimulatedB30Songs([]);
        setSimulatedAverageB30Rating(null);
        setTargetRatingReached(false);
        setAllUpdatableSongsCapped(false);
        setSimulationStatus('idle');
        console.log("[SIM_RESET] Simulation states reset due to strategy change or re-evaluation.");
    }
  }, [calculationStrategy, best30SongsData, simulationStatus]); // simulationStatus added to dependencies

  // 과제 1-9, 1-10 (점수 상승) & 메인 시뮬레이션 루프 제어
  useEffect(() => {
    if (calculationStrategy !== 'average' || simulationStatus === 'target_reached' || simulationStatus === 'awaiting_replacement_loop' || isLoadingSongs) {
      if (simulationStatus === 'running_score_increase') setSimulationStatus('idle'); // Stop running if conditions no longer met
      return;
    }
    
    // Condition to start a new iteration of score increase
    if (simulationStatus === 'idle' && groupAB30Songs.length > 0 && groupBB30Songs.length > 0 && simulatedB30Songs.length > 0 && targetRatingDisplay) {
        console.log("[SIM_START_ITERATION] Starting new score increase iteration for 'Average' strategy.");
        setSimulationStatus('running_score_increase');
    }

    if (simulationStatus === 'running_score_increase') {
        let internalSimulatedSongs = [...simulatedB30Songs.map(s => ({...s}))]; // Work on a copy for this iteration
        let songsUpdatedInIter = false;
        
        // 1-9: 그룹 A 점수 상승
        if (groupAB30Songs.length > 0) {
            const songToUpdateInA_original = groupAB30Songs[0]; // Lowest rating in original Group A
            // Find this song in the current simulated list
            const songInSimulatedA = internalSimulatedSongs.find(s => s.id === songToUpdateInA_original.id && s.diff === songToUpdateInA_original.diff);

            if (songInSimulatedA && songInSimulatedA.currentScore < (isScoreLimitReleased ? 1010000 : 1009000)) {
                const { newScore, newRating, capped } = findScoreForTargetRating(songInSimulatedA, 0.001, isScoreLimitReleased);
                if (newScore > songInSimulatedA.currentScore || (newScore === songInSimulatedA.currentScore && newRating > songInSimulatedA.currentRating) ) { // Ensure actual increase
                    songInSimulatedA.currentScore = newScore;
                    songInSimulatedA.currentRating = newRating;
                    console.log(`[SIM_GROUP_A_UPDATE] Song: ${songInSimulatedA.title}, New Score: ${newScore}, New Rating: ${newRating.toFixed(2)}, Capped: ${capped}`);
                    songsUpdatedInIter = true;
                }
            }
        }

        // 1-10: 그룹 B 점수 상승
        if (groupBB30Songs.length > 0) {
            const songToUpdateInB_original = groupBB30Songs[0]; // Lowest rating in original Group B
            const songInSimulatedB = internalSimulatedSongs.find(s => s.id === songToUpdateInB_original.id && s.diff === songToUpdateInB_original.diff);
            
            if (songInSimulatedB && songInSimulatedB.currentScore < (isScoreLimitReleased ? 1010000 : 1009000)) {
                const { newScore, newRating, capped } = findScoreForTargetRating(songInSimulatedB, 0.0005, isScoreLimitReleased);
                 if (newScore > songInSimulatedB.currentScore || (newScore === songInSimulatedB.currentScore && newRating > songInSimulatedB.currentRating)) { // Ensure actual increase
                    songInSimulatedB.currentScore = newScore;
                    songInSimulatedB.currentRating = newRating;
                    console.log(`[SIM_GROUP_B_UPDATE] Song: ${songInSimulatedB.title}, New Score: ${newScore}, New Rating: ${newRating.toFixed(2)}, Capped: ${capped}`);
                    songsUpdatedInIter = true;
                }
            }
        }
        
        if (songsUpdatedInIter) {
            const sortedSimulatedSongs = sortSongsByRatingDesc(internalSimulatedSongs);
            setSimulatedB30Songs(sortedSimulatedSongs);
            // Status will be set to 'idle' by the 1-11/1-12 check effect to prepare for next iteration or termination.
        } else {
            // No songs were updated, implies all potential candidates are capped or stuck
            console.log("[SIM_NO_UPDATES] No songs updated in this score increase iteration. Potential cap or stuck state.");
            setSimulationStatus('idle'); // Set to idle to allow 1-12 check to run
        }
    }
  }, [
    calculationStrategy, 
    simulationStatus, 
    isLoadingSongs,
    groupAB30Songs, 
    groupBB30Songs, 
    simulatedB30Songs, 
    targetRatingDisplay, 
    isScoreLimitReleased, 
    findScoreForTargetRating
  ]);

  // 과제 1-11: 중간 결과 확인 (타겟 달성 여부)
  useEffect(() => {
    if (simulatedB30Songs.length > 0 && targetRatingDisplay && calculationStrategy === 'average') {
      const currentSimAvg = simulatedB30Songs.slice(0, BEST_COUNT).reduce((sum, s) => sum + s.currentRating, 0) / Math.min(simulatedB30Songs.length, BEST_COUNT);
      setSimulatedAverageB30Rating(parseFloat(currentSimAvg.toFixed(2)));
      console.log(`[SIM_AVG_RECALC] Simulated B30 Average Rating: ${currentSimAvg.toFixed(2)}`);

      const targetRatingNum = parseFloat(targetRatingDisplay);
      if (!isNaN(targetRatingNum) && currentSimAvg >= targetRatingNum) {
        setTargetRatingReached(true);
        setSimulationStatus('target_reached');
        console.log(`[SIM_TARGET_REACHED] Target rating ${targetRatingNum.toFixed(2)} reached. Simulated average: ${currentSimAvg.toFixed(2)}`);
      } else if (simulationStatus === 'running_score_increase' && !targetRatingReached) {
         // If still running and target not reached, set to idle to allow next iteration or cap check
         setSimulationStatus('idle'); 
      }
    }
  }, [simulatedB30Songs, targetRatingDisplay, simulationStatus, targetRatingReached, calculationStrategy]);

  // 과제 1-12: 1차 상승 종료 확인 (모든 곡 상한 도달) & 1-13 (B30 교체 루프 준비)
  useEffect(() => {
    // This effect should run if the simulation was 'idle' (meaning a score increase iteration just finished or no updates occurred)
    // and target hasn't been reached, and we are in 'average' strategy.
    if (targetRatingReached || simulationStatus !== 'idle' || updatableB30Songs.length === 0 || simulatedB30Songs.length === 0 || calculationStrategy !== 'average' || allUpdatableSongsCapped) {
      return;
    }

    let allCappedInSim = true;
    for (const originalUpdatableSong of updatableB30Songs) {
      const simulatedVersion = simulatedB30Songs.find(s => s.id === originalUpdatableSong.id && s.diff === originalUpdatableSong.diff);
      if (simulatedVersion) {
        if (simulatedVersion.currentScore < (isScoreLimitReleased ? 1010000 : 1009000)) {
          allCappedInSim = false;
          break;
        }
      } else {
        console.warn(`[SIM_CAP_CHECK_WARN] Original updatable song ${originalUpdatableSong.title} not found in simulated list during cap check.`);
        allCappedInSim = false; 
        break;
      }
    }

    if (allCappedInSim) {
      setAllUpdatableSongsCapped(true);
      if (!targetRatingReached) { 
        setSimulationStatus('awaiting_replacement_loop'); // 과제 1-13: 교체 루프 준비 상태로 변경
        console.log("[CHAL_1-13_AWAITING_REPLACEMENT] All updatable B30 songs have reached score cap, target not met. Awaiting B30 replacement loop.");
      } else {
        // Should have been caught by 1-11, but as a safeguard:
        setSimulationStatus('target_reached');
        console.log("[SIM_ALL_CAPPED_TARGET_MET] All updatable B30 songs capped, target rating was met.");
      }
    }
  }, [simulatedB30Songs, updatableB30Songs, isScoreLimitReleased, targetRatingReached, simulationStatus, calculationStrategy, allUpdatableSongsCapped]);


  // Combined songs logic
  useEffect(() => {
    if (!isLoadingSongs) {
      if (best30SongsData.length > 0 || new20SongsData.length > 0) {
        const songMap = new Map<string, Song>();
        // Use simulatedB30Songs if available for 'average' strategy and simulation is active/finished
        const baseB30 = (calculationStrategy === 'average' && simulatedB30Songs.length > 0 && (simulationStatus === 'target_reached' || simulationStatus === 'awaiting_replacement_loop' || simulationStatus === 'replacing_song')) ? simulatedB30Songs : best30SongsData;
        
        baseB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, song));
        new20SongsData.forEach(song => {
          const key = `${song.id}_${song.diff}`;
          if (!songMap.has(key)) songMap.set(key, song);
        });
        setCombinedTopSongs(sortSongsByRatingDesc(Array.from(songMap.values())));
      } else {
        setCombinedTopSongs([]);
      }
    }
  }, [best30SongsData, new20SongsData, isLoadingSongs, simulatedB30Songs, calculationStrategy, simulationStatus]);

  // Cache combined data
  useEffect(() => {
    if (!isLoadingSongs && userNameForApi && userNameForApi !== getTranslation(locale, 'resultPageDefaultPlayerName') && clientHasMounted && (best30SongsData.length > 0 || new20SongsData.length > 0)) {
      const combinedDataKey = `${LOCAL_STORAGE_PREFIX}combined_b30_n20_${userNameForApi}`;
      const dataToCache = { best30: best30SongsData, new20: new20SongsData }; // Cache original B30, not simulated one for this general cache
      setCachedData(combinedDataKey, dataToCache, USER_DATA_CACHE_EXPIRY_MS);
    }
  }, [best30SongsData, new20SongsData, userNameForApi, isLoadingSongs, locale, clientHasMounted]);

  return {
    apiPlayerName,
    best30SongsData: (calculationStrategy === 'average' && simulatedB30Songs.length > 0 && (simulationStatus === 'target_reached' || simulationStatus === 'awaiting_replacement_loop' || simulationStatus === 'replacing_song')) ? simulatedB30Songs : best30SongsData,
    new20SongsData,
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
    simulatedAverageB30Rating,
    targetRatingReached,
    allUpdatableSongsCapped,
    simulationStatus,
  };
}

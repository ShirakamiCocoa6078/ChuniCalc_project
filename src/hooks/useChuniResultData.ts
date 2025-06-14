
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import constOverrides from '@/data/const-overrides.json'; // Added
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateChunithmSongRating, calculateMaxPotentialRatingOfSongList } from '@/lib/rating-utils';
import { runFullSimulation } from '@/lib/simulation-logic';
import type {
  Song,
  ProfileData,
  RatingApiResponse,
  ShowallApiSongEntry,
  RatingApiSongEntry,
  CalculationStrategy,
  SimulationPhase,
  UserShowallApiResponse,
  SimulationInput,
  SimulationOutput
} from "@/types/result-page";

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;
const MAX_SCORE_FOR_MAX_RATING = 1009000; // SSS+ boundary for max const-based rating

// Helper to calculate average rating for a list based on a specific rating property (current or target)
const calculateAverageRating = (
  songs: Song[],
  count: number,
  ratingProperty: 'currentRating' | 'targetRating'
): number | null => {
  if (!songs || songs.length === 0) return null;
  const topSongs = [...songs]
    .sort((a, b) => b[ratingProperty] - a[ratingProperty]) // Sort by the specified rating property
    .slice(0, count);
  if (topSongs.length === 0) return 0; // Or null, depending on how you want to handle empty top list
  const sum = topSongs.reduce((acc, s) => acc + s[ratingProperty], 0);
  return parseFloat((sum / topSongs.length).toFixed(4));
};

const calculateOverallRatingFromAverages = (
  avgB30: number | null,
  avgN20: number | null,
  actualB30Count: number,
  actualN20Count: number
): number => {
  if (avgB30 === null || actualB30Count === 0) return 0;

  const effectiveB30Count = Math.min(actualB30Count, BEST_COUNT);
  const effectiveN20Count = Math.min(actualN20Count, NEW_20_COUNT);

  let totalRatingSum = 0;
  let totalSongCount = 0;

  if (effectiveB30Count > 0) {
    totalRatingSum += avgB30 * effectiveB30Count;
    totalSongCount += effectiveB30Count;
  }

  if (avgN20 !== null && effectiveN20Count > 0) {
     totalRatingSum += avgN20 * effectiveN20Count;
     totalSongCount += effectiveN20Count;
  }

  if (totalSongCount === 0) return 0;
  return parseFloat((totalRatingSum / totalSongCount).toFixed(4));
};


const flattenGlobalMusicEntry = (rawEntry: any): ShowallApiSongEntry[] => {
    const flattenedEntries: ShowallApiSongEntry[] = [];
    if (rawEntry && rawEntry.meta && rawEntry.data && typeof rawEntry.data === 'object') {
        const meta = rawEntry.meta;
        const difficulties = rawEntry.data;
        for (const diffKey in difficulties) {
            if (Object.prototype.hasOwnProperty.call(difficulties, diffKey)) {
                const diffData = difficulties[diffKey];
                if (diffData && meta.id && meta.title) {
                    flattenedEntries.push({
                        id: String(meta.id),
                        title: String(meta.title),
                        genre: String(meta.genre || "N/A"),
                        release: String(meta.release || ""),
                        diff: diffKey.toUpperCase(),
                        level: String(diffData.level || "N/A"),
                        const: (typeof diffData.const === 'number' || diffData.const === null) ? diffData.const : parseFloat(String(diffData.const)),
                        is_const_unknown: diffData.is_const_unknown === true,
                        score: undefined,
                        rating: undefined,
                        is_played: undefined,
                    });
                }
            }
        }
    } else if (rawEntry && rawEntry.id && rawEntry.title && rawEntry.diff) {
        flattenedEntries.push(rawEntry as ShowallApiSongEntry);
    }
    return flattenedEntries;
};

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

  const [originalB30SongsData, setOriginalB30SongsData] = useState<Song[]>([]);
  const [originalNew20SongsData, setOriginalNew20SongsData] = useState<Song[]>([]);
  const [allPlayedNewSongsPool, setAllPlayedNewSongsPool] = useState<Song[]>([]);
  const [allMusicData, setAllMusicData] = useState<ShowallApiSongEntry[]>([]);
  const [userPlayHistory, setUserPlayHistory] = useState<ShowallApiSongEntry[]>([]);

  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  const [simulatedNew20Songs, setSimulatedNew20Songs] = useState<Song[]>([]);
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);
  const [simulatedAverageNew20Rating, setSimulatedAverageNew20Rating] = useState<number | null>(null);
  const [finalOverallSimulatedRating, setFinalOverallSimulatedRating] = useState<number | null>(null);
  const [simulationLog, setSimulationLog] = useState<string[]>([]);
  const [combinedTopSongs, setCombinedTopSongs] = useState<Song[]>([]);

  const [isLoadingInitialData, setIsLoadingInitialData] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const [errorLoadingData, setErrorLoadingData] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  const [preSimulationMessage, setPreSimulationMessage] = useState<string | null>(null);

  const prevCalculationStrategyRef = useRef<CalculationStrategy | null>(null);


  useEffect(() => {
    const fetchAndProcessData = async () => {
      console.log("[DATA_FETCH_HOOK] Starting fetchAndProcessInitialData...");
      const defaultPlayerName = getTranslation(locale, 'resultPageDefaultPlayerName');
      const API_TOKEN = getApiToken();

      if (!API_TOKEN) { setErrorLoadingData(getTranslation(locale, 'resultPageErrorApiTokenNotSetResult')); setIsLoadingInitialData(false); return; }
      if (!userNameForApi || userNameForApi === defaultPlayerName) { setErrorLoadingData(getTranslation(locale, 'resultPageErrorNicknameNotProvidedResult')); setApiPlayerName(defaultPlayerName); setIsLoadingInitialData(false); return; }

      setIsLoadingInitialData(true); setErrorLoadingData(null); setApiPlayerName(userNameForApi);
      setOriginalB30SongsData([]); setOriginalNew20SongsData([]);
      setAllPlayedNewSongsPool([]); setAllMusicData([]); setUserPlayHistory([]);
      setSimulatedB30Songs([]); setSimulatedNew20Songs([]);
      setSimulatedAverageB30Rating(null); setSimulatedAverageNew20Rating(null);
      setFinalOverallSimulatedRating(null); setSimulationLog([]);
      setCurrentPhase('idle'); setPreSimulationMessage(null);

      const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
      const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
      const globalMusicKey = GLOBAL_MUSIC_DATA_KEY;
      const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;

      let profileCacheItem: { timestamp: number; data: ProfileData } | null = null;
      if (clientHasMounted) {
        const rawProfileCache = localStorage.getItem(profileKey);
        if (rawProfileCache) {
          try {
            profileCacheItem = JSON.parse(rawProfileCache);
            if (profileCacheItem && typeof profileCacheItem.timestamp === 'number') {
              setLastRefreshed(getTranslation(locale, 'resultPageSyncStatus', new Date(profileCacheItem.timestamp).toLocaleString(locale)));
            } else { setLastRefreshed(getTranslation(locale, 'resultPageSyncStatusNoCache'));}
          } catch (e) { localStorage.removeItem(profileKey); setLastRefreshed(getTranslation(locale, 'resultPageSyncStatusNoCache'));}
        } else { setLastRefreshed(getTranslation(locale, 'resultPageSyncStatusNoCache'));}
      }

      let profileData = profileCacheItem?.data;
      let ratingData = getCachedData<RatingApiResponse>(ratingDataKey, USER_DATA_CACHE_EXPIRY_MS);
      let globalMusicCacheRaw = getCachedData<any[]>(globalMusicKey, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
      let userShowallCache = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);

      let tempFlattenedGlobalMusicRecords: ShowallApiSongEntry[] = [];
      let tempUserShowallRecords: ShowallApiSongEntry[] = [];

      if (profileData) setApiPlayerName(profileData.player_name || userNameForApi);

      if (globalMusicCacheRaw) {
          globalMusicCacheRaw.forEach(rawEntry => {
              tempFlattenedGlobalMusicRecords.push(...flattenGlobalMusicEntry(rawEntry));
          });
          console.log(`[DATA_FETCH_HOOK] Loaded ${tempFlattenedGlobalMusicRecords.length} flattened global music entries from cache.`);
      }

      if (userShowallCache && Array.isArray(userShowallCache.records)) {
         tempUserShowallRecords = userShowallCache.records.filter((e: any): e is ShowallApiSongEntry => e && typeof e.id === 'string' && typeof e.diff === 'string');
         console.log(`[DATA_FETCH_HOOK] Loaded ${tempUserShowallRecords.length} user play history entries from cache.`);
      }

      if (!profileData || !ratingData || !globalMusicCacheRaw || tempFlattenedGlobalMusicRecords.length === 0 || !userShowallCache || tempUserShowallRecords.length === 0) {
        const apiRequestsMap = new Map<string, Promise<any>>();
        if (!profileData) apiRequestsMap.set('profile', fetch(`https://api.chunirec.net/2.0/records/profile.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'profile', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'profile', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!ratingData) apiRequestsMap.set('rating', fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'rating', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'rating', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!globalMusicCacheRaw || tempFlattenedGlobalMusicRecords.length === 0) apiRequestsMap.set('globalMusic', fetch(`https://api.chunirec.net/2.0/music/showall.json?region=jp2&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'globalMusic', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'globalMusic', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!userShowallCache || tempUserShowallRecords.length === 0) apiRequestsMap.set('userShowall', fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'userShowall', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'userShowall', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));

        if (apiRequestsMap.size > 0) {
          console.log(`[DATA_FETCH_HOOK] Fetching from API. Requests: ${Array.from(apiRequestsMap.keys()).join(', ')}`);
          try {
            const responses = await Promise.all(Array.from(apiRequestsMap.values()));
            let criticalError = null;
            let newCacheTimestamp = Date.now();

            for (const res of responses) {
              if (!res.ok) { const errorMsg = `${res.type} data API failed (status: ${res.status}): ${res.data?.error?.message || res.error || 'Unknown API error'}`; if (!criticalError) criticalError = errorMsg; console.error(`[DATA_FETCH_API_ERROR] ${errorMsg}`); continue; }

              if (res.type === 'profile' && !profileData) { setApiPlayerName(res.data.player_name || userNameForApi); setCachedData<ProfileData>(profileKey, res.data); profileData = res.data; }
              if (res.type === 'rating' && !ratingData) { setCachedData<RatingApiResponse>(ratingDataKey, res.data); ratingData = res.data; }
              if (res.type === 'globalMusic' && (!globalMusicCacheRaw || tempFlattenedGlobalMusicRecords.length === 0)) {
                const fetchedGlobalMusicApi = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                tempFlattenedGlobalMusicRecords = [];
                fetchedGlobalMusicApi.forEach(rawEntry => { tempFlattenedGlobalMusicRecords.push(...flattenGlobalMusicEntry(rawEntry)); });
                console.log(`[DATA_FETCH_HOOK] Fetched and set ${tempFlattenedGlobalMusicRecords.length} flattened global music entries from API.`);
              }
              if (res.type === 'userShowall' && (!userShowallCache || tempUserShowallRecords.length === 0)) {
                const records = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                tempUserShowallRecords = records.filter((e: any): e is ShowallApiSongEntry => e && typeof e.id === 'string' && typeof e.diff === 'string');
                console.log(`[DATA_FETCH_HOOK] Fetched and set ${tempUserShowallRecords.length} user play history entries from API.`);
              }
            }
            if (criticalError) throw new Error(criticalError);

            // Save to cache AFTER all API calls succeed for the missing data
            if (apiRequestsMap.has('globalMusic')) setCachedData<any[]>(globalMusicKey, globalMusicCacheRaw, GLOBAL_MUSIC_CACHE_EXPIRY_MS); // This seems wrong, should save the fetched data
            if (apiRequestsMap.has('userShowall')) setCachedData<UserShowallApiResponse>(userShowallKey, { records: tempUserShowallRecords });


            const newCacheTimeStr = new Date(newCacheTimestamp).toLocaleString(locale);
            setLastRefreshed(getTranslation(locale, 'resultPageSyncStatus', newCacheTimeStr));
            if (responses.some(res => res.ok)) toast({ title: getTranslation(locale, 'resultPageToastApiLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastApiLoadSuccessDesc', newCacheTimeStr) });

          } catch (error) {
            let detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', "Unknown error");
            if (error instanceof Error) detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', error.message);
            setErrorLoadingData(detailedErrorMessage);
            if (!apiPlayerName && userNameForApi !== defaultPlayerName) setApiPlayerName(userNameForApi);
          }
        }
      } else {
         console.log("[DATA_FETCH_HOOK] All initial data successfully loaded from cache.");
         toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
      }

      // --- Apply Constant Overrides ---
      if (Array.isArray(constOverrides) && constOverrides.length > 0 && tempFlattenedGlobalMusicRecords.length > 0) {
        console.log(`[CONST_OVERRIDE] Applying ${constOverrides.length} overrides to ${tempFlattenedGlobalMusicRecords.length} global songs...`);
        constOverrides.forEach(override => {
          let songsFoundAndOverridden = 0;
          tempFlattenedGlobalMusicRecords.forEach(globalSong => {
            if (globalSong.title.trim().toLowerCase() === override.title.trim().toLowerCase() &&
                globalSong.diff.toUpperCase() === override.diff.toUpperCase()) {
              if (typeof override.const === 'number') {
                globalSong.const = override.const;
                console.log(`[CONST_OVERRIDE_APPLIED] Overridden: ${override.title} (${override.diff}) to ${override.const}`);
                songsFoundAndOverridden++;
              } else {
                console.warn(`[CONST_OVERRIDE_SKIP] Invalid const value for ${override.title} (${override.diff}):`, override.const);
              }
            }
          });
          if (songsFoundAndOverridden === 0) {
            console.warn(`[CONST_OVERRIDE_NOT_FOUND] Song not found in master list for override: ${override.title} (${override.diff})`);
          }
        });
      } else {
        console.log("[CONST_OVERRIDE] No overrides to apply or global music list is empty.");
      }
      // --- End of Apply Constant Overrides ---

      setAllMusicData(tempFlattenedGlobalMusicRecords);
      setUserPlayHistory(tempUserShowallRecords);


      if (!ratingData) { setIsLoadingInitialData(false); setErrorLoadingData("Rating data missing after fetch/cache attempt."); return; }
      if (tempFlattenedGlobalMusicRecords.length === 0) { setIsLoadingInitialData(false); setErrorLoadingData("Global music data missing after fetch/cache attempt."); return; }
      if (tempUserShowallRecords.length === 0 && userNameForApi !== defaultPlayerName) { setIsLoadingInitialData(false); setErrorLoadingData("User play history missing after fetch/cache attempt."); return; }


      const initialB30ApiEntries = ratingData?.best?.entries?.filter((e: any): e is RatingApiSongEntry => e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && typeof e.title === 'string' && e.title.trim() !== '') || [];
      const processedOriginalB30 = sortSongsByRatingDesc(initialB30ApiEntries.map((entry, index) => {
        const masterSongData = tempFlattenedGlobalMusicRecords.find(ms => ms.id === entry.id && ms.diff.toUpperCase() === entry.diff.toUpperCase());
        return mapApiSongToAppSong(entry, index, masterSongData?.const ?? entry.const);
      }));
      setOriginalB30SongsData(processedOriginalB30);
      console.log(`[DATA_FETCH_HOOK] Original B30 songs mapped: ${processedOriginalB30.length}`);

      const newSongTitlesRaw = NewSongsData.titles?.verse || [];
      const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());

      const newSongDefinitions = tempFlattenedGlobalMusicRecords.filter(globalSong =>
        globalSong.title && newSongTitlesToMatch.includes(globalSong.title.trim().toLowerCase())
      );

      const userPlayedMap = new Map<string, ShowallApiSongEntry>();
      tempUserShowallRecords.forEach(usrSong => {
        if (usrSong.id && usrSong.diff) userPlayedMap.set(`${usrSong.id}_${usrSong.diff.toUpperCase()}`, usrSong);
      });

      const playedNewSongsApi = newSongDefinitions.reduce((acc, newSongDef) => {
        const userPlayRecord = userPlayedMap.get(`${newSongDef.id}_${newSongDef.diff.toUpperCase()}`);
        if (userPlayRecord && typeof userPlayRecord.score === 'number' && userPlayRecord.score >= 800000) {
          acc.push({ ...newSongDef, score: userPlayRecord.score, is_played: true, rating: userPlayRecord.rating }); // Include user's rating if available
        }
        return acc;
      }, [] as ShowallApiSongEntry[]);

      const mappedPlayedNewSongs = playedNewSongsApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)); // Const is already overridden if applicable
      const sortedAllPlayedNewSongsPool = sortSongsByRatingDesc(mappedPlayedNewSongs);
      setAllPlayedNewSongsPool(sortedAllPlayedNewSongsPool);

      const processedOriginalNew20 = sortedAllPlayedNewSongsPool.slice(0, NEW_20_COUNT);
      setOriginalNew20SongsData(processedOriginalNew20);
      console.log(`[DATA_FETCH_HOOK] Original N20 songs processed: ${processedOriginalNew20.length} (from pool of ${mappedPlayedNewSongs.length})`);

      setIsLoadingInitialData(false);
      console.log("[DATA_FETCH_HOOK] fetchAndProcessInitialData finished.");
    };

    if (clientHasMounted) fetchAndProcessData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNameForApi, refreshNonce, clientHasMounted, locale]);


  useEffect(() => {
    console.log(`[SIM_STRATEGY_EFFECT] Running. Strategy: ${calculationStrategy}, Prev: ${prevCalculationStrategyRef.current}, isLoading: ${isLoadingInitialData}, OriginalB30Count: ${originalB30SongsData.length}, currentPhase: ${currentPhase}`);

    setPreSimulationMessage(null);

    if (isLoadingInitialData || !clientHasMounted) {
      console.log("[SIM_STRATEGY_EFFECT] Waiting for initial data or client mount.");
      return;
    }

    const currentRatingNum = parseFloat(currentRatingDisplay || "0");
    const targetRatingNum = parseFloat(targetRatingDisplay || "0");

    if (calculationStrategy === "none" || calculationStrategy === null) {
      console.log("[SIM_STRATEGY_EFFECT] No strategy selected. Displaying original data.");
      const initialDisplayB30 = originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
      const initialDisplayN20 = originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
      setSimulatedB30Songs(initialDisplayB30);
      setSimulatedNew20Songs(initialDisplayN20);
      const initialB30Avg = calculateAverageRating(originalB30SongsData, BEST_COUNT, 'currentRating');
      const initialN20Avg = calculateAverageRating(originalNew20SongsData, NEW_20_COUNT, 'currentRating');
      setSimulatedAverageB30Rating(initialB30Avg);
      setSimulatedAverageNew20Rating(initialN20Avg);
      setFinalOverallSimulatedRating(calculateOverallRatingFromAverages(initialB30Avg, initialN20Avg, originalB30SongsData.length, originalNew20SongsData.length));
      setCurrentPhase('idle');
      setSimulationLog([getTranslation(locale, 'resultPageLogNoStrategy')]);
      prevCalculationStrategyRef.current = calculationStrategy;
      return;
    }

    if (originalB30SongsData.length === 0 && originalNew20SongsData.length === 0 && calculationStrategy !== 'none') {
        setErrorLoadingData(getTranslation(locale, 'resultPageNoBest30Data'));
        setCurrentPhase('error_data_fetch');
        return;
    }
    if (isNaN(currentRatingNum) || isNaN(targetRatingNum)) {
        setErrorLoadingData(getTranslation(locale, 'resultPageErrorInvalidRatingsInput'));
        setCurrentPhase('error_data_fetch');
        return;
    }


    let simulationScope: 'b30_only' | 'n20_only' | 'combined' = 'combined';
    let improvementMethod: 'floor' | 'peak' = 'floor'; // Default, will be overridden for combined_peak

    if (calculationStrategy === 'b30_only') simulationScope = 'b30_only';
    else if (calculationStrategy === 'n20_only') simulationScope = 'n20_only';
    else if (calculationStrategy === 'combined_floor') { simulationScope = 'combined'; improvementMethod = 'floor'; }
    else if (calculationStrategy === 'combined_peak') { simulationScope = 'combined'; improvementMethod = 'peak'; }


    // --- Pre-calculation for 'b30_only' or 'n20_only' ---
    if (simulationScope === 'b30_only' || simulationScope === 'n20_only') {
        let fixedListRatingSum = 0;
        let fixedListCount = 0;
        let variableListPotentialSongs: ShowallApiSongEntry[] = [];
        let variableListLimit = 0;
        let precalcMessageKey: keyof (typeof translations)['KR'] | null = null;

        if (simulationScope === 'b30_only') {
            originalNew20SongsData.forEach(song => fixedListRatingSum += song.currentRating);
            fixedListCount = originalNew20SongsData.length;

            const newSongsTitlesLower = (NewSongsData.titles?.verse || []).map(t => t.trim().toLowerCase());
            variableListPotentialSongs = allMusicData.filter(ms => {
                 const titleLower = ms.title.trim().toLowerCase();
                 return !newSongsTitlesLower.includes(titleLower) &&
                        !originalNew20SongsData.some(n20s => n20s.id === ms.id && n20s.diff === ms.diff.toUpperCase());
            });
            variableListLimit = BEST_COUNT;
            precalcMessageKey = 'resultPageErrorTargetUnreachableB30';
        } else { // n20_only
            originalB30SongsData.forEach(song => fixedListRatingSum += song.currentRating);
            fixedListCount = originalB30SongsData.length;
            // For N20, potential songs come from allPlayedNewSongsPool that are not in originalB30
            // allPlayedNewSongsPool already contains ShowallApiSongEntry like objects with user's score
            // But for theoretical max, we map them to max potential
            variableListPotentialSongs = allPlayedNewSongsPool
                .filter(poolSong => !originalB30SongsData.some(b30s => b30s.id === poolSong.id && b30s.diff === poolSong.diff))
                .map(pSong => ({ // Convert Song from pool to ShowallApiSongEntry for calculateMaxPotentialRatingOfSongList
                    id: pSong.id,
                    diff: pSong.diff,
                    title: pSong.title,
                    genre: pSong.genre || "N/A",
                    const: pSong.chartConstant,
                    level: pSong.level || "N/A",
                }));
            variableListLimit = NEW_20_COUNT;
            precalcMessageKey = 'resultPageErrorTargetUnreachableN20';
        }

        const { sum: variableListMaxPotentialSum, average: variableListMaxPotentialAvg } = calculateMaxPotentialRatingOfSongList(
            variableListPotentialSongs,
            variableListLimit,
            MAX_SCORE_FOR_MAX_RATING
        );

        let reachableRatingThisMode = 0;
        if (variableListMaxPotentialAvg !== null) {
             const totalSum = fixedListRatingSum + variableListMaxPotentialSum;
             const totalCount = fixedListCount + Math.min(variableListPotentialSongs.length, variableListLimit) ;
             if (totalCount > 0) {
                reachableRatingThisMode = parseFloat((totalSum / totalCount).toFixed(4));
             }
        } else if (fixedListCount > 0 && simulationScope === 'n20_only') { // N20 is empty, B30 has songs
            reachableRatingThisMode = parseFloat((fixedListRatingSum / fixedListCount).toFixed(4));
        } else if (fixedListCount > 0 && simulationScope === 'b30_only') { // B30 is empty, N20 has songs
            reachableRatingThisMode = parseFloat((fixedListRatingSum / fixedListCount).toFixed(4));
        }


        if (targetRatingNum > reachableRatingThisMode) {
            setPreSimulationMessage(getTranslation(locale, precalcMessageKey as keyof typeof translations['KR'], reachableRatingThisMode.toFixed(4)));
            setCurrentPhase('target_unreachable');
            // Display original data if target is unreachable
            const initialDisplayB30 = originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
            const initialDisplayN20 = originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
            setSimulatedB30Songs(initialDisplayB30);
            setSimulatedNew20Songs(initialDisplayN20);
            setSimulatedAverageB30Rating(calculateAverageRating(initialDisplayB30, BEST_COUNT, 'currentRating'));
            setSimulatedAverageNew20Rating(calculateAverageRating(initialDisplayN20, NEW_20_COUNT, 'currentRating'));
            setFinalOverallSimulatedRating(calculateOverallRatingFromAverages(
                calculateAverageRating(initialDisplayB30, BEST_COUNT, 'currentRating'),
                calculateAverageRating(initialDisplayN20, NEW_20_COUNT, 'currentRating'),
                initialDisplayB30.length,
                initialDisplayN20.length
            ));
            setIsSimulating(false);
            return; // Stop further processing
        }
    }


    const runSimulationAsync = async () => {
        if (isSimulating) { return; }
        setIsSimulating(true); setCurrentPhase('simulating');
        setSimulationLog(prev => [...prev, getTranslation(locale, 'resultPageLogSimulationStarting')]);

        const calculatedPhaseTransitionPoint = currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95;

        const simulationInput: SimulationInput = {
            originalB30Songs: JSON.parse(JSON.stringify(originalB30SongsData)),
            originalNew20Songs: JSON.parse(JSON.stringify(originalNew20SongsData)),
            allPlayedNewSongsPool: JSON.parse(JSON.stringify(allPlayedNewSongsPool)),
            allMusicData: JSON.parse(JSON.stringify(allMusicData)),
            userPlayHistory: JSON.parse(JSON.stringify(userPlayHistory)),
            currentRating: currentRatingNum,
            targetRating: targetRatingNum,
            calculationStrategy: calculationStrategy as CalculationStrategy, // Ensure it's not null
            improvementMethod: improvementMethod,
            simulationScope: simulationScope,
            isScoreLimitReleased: (targetRatingNum - currentRatingNum) * 50 > 10,
            phaseTransitionPoint: parseFloat(calculatedPhaseTransitionPoint.toFixed(4)),
        };

        console.log(`[SIM_STRATEGY_EFFECT] Calling runFullSimulation. Scope: ${simulationInput.simulationScope}, Method: ${simulationInput.improvementMethod}`);
        setSimulationLog(prev => [...prev, `Calling runFullSimulation (Scope: ${simulationInput.simulationScope}, Method: ${simulationInput.improvementMethod})...`]);

        try {
            const result: SimulationOutput = runFullSimulation(simulationInput);
            console.log("[SIM_STRATEGY_EFFECT] SimulationOutput received:", result);

            setSimulatedB30Songs(result.simulatedB30Songs);
            setSimulatedNew20Songs(result.simulatedNew20Songs);
            setSimulatedAverageB30Rating(result.finalAverageB30Rating);
            setSimulatedAverageNew20Rating(result.finalAverageNew20Rating);
            setFinalOverallSimulatedRating(result.finalOverallRating);
            setCurrentPhase(result.finalPhase); // This should now include 'target_unreachable' if set by runFullSimulation
            setSimulationLog(prev => [...prev, ...result.simulationLog, `Simulation Ended. Final Phase: ${result.finalPhase}`]);

            if (result.error) {
              setErrorLoadingData(getTranslation(locale, 'resultPageErrorSimulationGeneric', result.error));
              setCurrentPhase('error_simulation_logic');
            } else if (result.finalPhase === 'target_unreachable' && result.reachableRating) {
                 // This case might be handled by pre-calculation now, but as a fallback.
                 const messageKey = simulationScope === 'b30_only' ? 'resultPageErrorTargetUnreachableB30' : 'resultPageErrorTargetUnreachableN20';
                 setPreSimulationMessage(getTranslation(locale, messageKey as keyof typeof translations['KR'], result.reachableRating.toFixed(4)));
            }

        } catch (e: any) {
            console.error("[SIM_STRATEGY_EFFECT] Error during runFullSimulation call:", e);
            setErrorLoadingData(getTranslation(locale, 'resultPageErrorSimulationGeneric', e.message));
            setCurrentPhase('error_simulation_logic');
            setSimulationLog(prev => [...prev, `Critical error: ${e.message}`]);
        } finally {
            setIsSimulating(false);
            console.log("[SIM_STRATEGY_EFFECT] Simulation finished or errored. isSimulating set to false.");
        }
    };

    if (calculationStrategy !== 'none' && calculationStrategy !== null) {
      runSimulationAsync();
    } else {
      // This case should already be handled by the "No strategy selected" block above.
      // If it reaches here, ensure states are correctly set for idle/original display.
      setIsSimulating(false);
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    calculationStrategy, isLoadingInitialData, clientHasMounted, locale,
    originalB30SongsData, originalNew20SongsData, allPlayedNewSongsPool, allMusicData, userPlayHistory,
    currentRatingDisplay, targetRatingDisplay
  ]);


  useEffect(() => {
    console.log("[COMBINED_SONGS_EFFECT] Updating combinedTopSongs. isLoadingInitialData:", isLoadingInitialData, "isSimulating:", isSimulating);
    console.log("[COMBINED_SONGS_EFFECT] Current simulatedB30Songs count:", simulatedB30Songs.length, "Current simulatedNew20Songs count:", simulatedNew20Songs.length);

    if (isLoadingInitialData || isSimulating) {
      console.log("[COMBINED_SONGS_EFFECT] isLoadingInitialData or isSimulating is true. Setting combinedTopSongs to [].");
      setCombinedTopSongs([]);
      return;
    }

    const baseB30 = simulatedB30Songs.length > 0
        ? simulatedB30Songs
        : originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));

    const baseN20 = simulatedNew20Songs.length > 0
        ? simulatedNew20Songs
        : originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));

    console.log(`[COMBINED_SONGS_EFFECT] Using baseB30 count: ${baseB30.length}, baseN20 count: ${baseN20.length}`);

    if (baseB30.length > 0 || baseN20.length > 0) {
      const songMap = new Map<string, Song>();

      // For combined view, always use targetRating as the "currentRating" for sorting
      const songsToCombineB30 = baseB30.map(song => ({ ...song, currentRating: song.targetRating }));
      songsToCombineB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, { ...song }));
      console.log(`[COMBINED_SONGS_EFFECT] songMap after B30 processing. Size: ${songMap.size}`);

      const songsToCombineN20 = baseN20.map(song => ({ ...song, currentRating: song.targetRating }));
      songsToCombineN20.forEach(song => {
        const key = `${song.id}_${song.diff}`;
        const new20EffectiveRating = song.targetRating;
        const existingEntry = songMap.get(key);
        if (!existingEntry || new20EffectiveRating > existingEntry.currentRating) {
          songMap.set(key, { ...song, currentRating: new20EffectiveRating });
        }
      });
      console.log(`[COMBINED_SONGS_EFFECT] songMap after N20 processing. Size: ${songMap.size}`);
      setCombinedTopSongs(sortSongsByRatingDesc(Array.from(songMap.values())));
      console.log(`[COMBINED_SONGS_EFFECT] CombinedTopSongs updated. Count: ${Array.from(songMap.values()).length}`);
    } else {
      setCombinedTopSongs([]);
      console.log("[COMBINED_SONGS_EFFECT] No base B30 or N20 data. Setting combinedTopSongs to [].");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
      simulatedB30Songs, simulatedNew20Songs,
      originalB30SongsData, originalNew20SongsData, // Ensure originals are also deps if used as fallback
      isLoadingInitialData, isSimulating,
  ]);


  return {
    apiPlayerName,
    best30SongsData: simulatedB30Songs,
    new20SongsData: simulatedNew20Songs,
    combinedTopSongs,
    isLoadingSongs: isLoadingInitialData || isSimulating,
    errorLoadingSongs: errorLoadingData,
    lastRefreshed,
    currentPhase,
    simulatedAverageB30Rating,
    simulatedAverageNew20Rating,
    finalOverallSimulatedRating,
    simulationLog,
    preSimulationMessage,
  };
}


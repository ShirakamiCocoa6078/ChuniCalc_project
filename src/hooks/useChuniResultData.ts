
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateChunithmSongRating } from '@/lib/rating-utils';
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
  SimulationOutput,
  TheoreticalMaxInfo
} from "@/types/result-page";

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;
const MAX_SCORE_NORMAL = 1009000; // SSS+ boundary

// Helper to calculate average rating for a list based on targetRating
const calculateAverageTargetRating = (songs: Song[], count: number): number | null => {
  if (!songs || songs.length === 0) return null;
  const topSongs = sortSongsByRatingDesc([...songs].map(s => ({ ...s, currentRating: s.targetRating }))).slice(0, count);
  if (topSongs.length === 0) return null;
  const sum = topSongs.reduce((acc, s) => acc + s.targetRating, 0);
  return parseFloat((sum / topSongs.length).toFixed(4));
};

// Helper to calculate average rating for a list based on currentRating
const calculateAverageCurrentRating = (songs: Song[], count: number): number | null => {
  if (!songs || songs.length === 0) return null;
  const topSongs = sortSongsByRatingDesc([...songs]).slice(0, count);
  if (topSongs.length === 0) return null;
  const sum = topSongs.reduce((acc, s) => acc + s.currentRating, 0);
  return parseFloat((sum / topSongs.length).toFixed(4));
};

const calculateOverallRatingFromAverages = (
  avgB30: number | null,
  avgN20: number | null,
  actualB30Count: number, // Pass actual count from original list
  actualN20Count: number  // Pass actual count from original list
): number => {
  if (avgB30 === null || actualB30Count === 0) return 0;

  const effectiveB30Count = Math.min(actualB30Count, BEST_COUNT);
  const effectiveN20Count = Math.min(actualN20Count, NEW_20_COUNT);

  if (avgN20 !== null && effectiveN20Count > 0 && effectiveB30Count > 0) {
     const totalRatingSum = (avgB30 * effectiveB30Count) + (avgN20 * effectiveN20Count);
     const totalSongCount = effectiveB30Count + effectiveN20Count;
     if (totalSongCount === 0) return 0;
     return parseFloat((totalRatingSum / totalSongCount).toFixed(4));
  }
  return avgB30; // Default to B30 average if N20 is not applicable
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


// Helper function for pre-calculation
const calculateTheoreticalMaxOverallRating = (
  mode: "b30_only" | "n20_only",
  originalB30Songs: Song[],
  originalNew20Songs: Song[],
  allMusicData: ShowallApiSongEntry[],
  allPlayedNewSongsPool: Song[],
  locale: Locale
): TheoreticalMaxInfo => {
  let fixedListRatingSum = 0;
  let fixedListCount = 0;
  let variableListPotentialMaxRatingSum = 0;
  let variableListCount = 0;
  const newSongsTitlesLower = (NewSongsData.titles?.verse || []).map(t => t.trim().toLowerCase());

  if (mode === "b30_only") {
    // N20 is fixed
    fixedListRatingSum = originalNew20Songs.reduce((sum, song) => sum + song.currentRating, 0);
    fixedListCount = originalNew20Songs.length;

    // Calculate B30 potential
    const b30CandidatePool: Song[] = [...originalB30Songs];
    const originalB30Ids = new Set(originalB30Songs.map(s => `${s.id}_${s.diff}`));
    const originalN20Ids = new Set(originalNew20Songs.map(s => `${s.id}_${s.diff}`));

    allMusicData.forEach(apiSong => {
      if (!originalB30Ids.has(`${apiSong.id}_${apiSong.diff.toUpperCase()}`) &&
          !originalN20Ids.has(`${apiSong.id}_${apiSong.diff.toUpperCase()}`)) { // Must not be in fixed N20
        const song = mapApiSongToAppSong(apiSong, 0, apiSong.const);
        if (song.chartConstant) {
          b30CandidatePool.push(song);
        }
      }
    });

    const potentialB30Ratings = b30CandidatePool
      .map(song => song.chartConstant ? calculateChunithmSongRating(MAX_SCORE_NORMAL, song.chartConstant) : 0)
      .sort((a, b) => b - a)
      .slice(0, BEST_COUNT);

    variableListPotentialMaxRatingSum = potentialB30Ratings.reduce((sum, rating) => sum + rating, 0);
    variableListCount = potentialB30Ratings.length;

  } else { // n20_only mode
    // B30 is fixed
    fixedListRatingSum = originalB30Songs.reduce((sum, song) => sum + song.currentRating, 0);
    fixedListCount = originalB30Songs.length;

    // Calculate N20 potential (from allPlayedNewSongsPool)
    const n20CandidatePool: Song[] = [...allPlayedNewSongsPool]; // Already filtered for NewSongs.json and played

    const potentialN20Ratings = n20CandidatePool
      .map(song => song.chartConstant ? calculateChunithmSongRating(MAX_SCORE_NORMAL, song.chartConstant) : 0)
      .sort((a, b) => b - a)
      .slice(0, NEW_20_COUNT);

    variableListPotentialMaxRatingSum = potentialN20Ratings.reduce((sum, rating) => sum + rating, 0);
    variableListCount = potentialN20Ratings.length;
  }

  const totalMaxRatingSum = fixedListRatingSum + variableListPotentialMaxRatingSum;
  const totalSongCount = fixedListCount + variableListCount;
  const reachableRating = totalSongCount > 0 ? parseFloat((totalMaxRatingSum / totalSongCount).toFixed(4)) : 0;

  let message: string | null = null;
  // This function doesn't compare with target, the caller does.
  // It just returns the reachable value.
  // Message generation will be done in the hook.

  return { reachableRating, message };
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
  const [isSimulating, setIsSimulating] = useState(false); // For the actual runFullSimulation call
  const [errorLoadingData, setErrorLoadingData] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  const [phaseTransitionPoint, setPhaseTransitionPoint] = useState<number | null>(null);
  const [preCalculationMessage, setPreCalculationMessage] = useState<string | null>(null);

  const prevCalculationStrategyRef = useRef<CalculationStrategy>(null);


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
      setCurrentPhase('idle'); setPreCalculationMessage(null);

      const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
      const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
      const globalMusicKey = GLOBAL_MUSIC_DATA_KEY;
      const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;

      let profileCacheItem: CachedData<ProfileData> | null = null;
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
          setAllMusicData(tempFlattenedGlobalMusicRecords);
          console.log(`[DATA_FETCH_HOOK] Loaded ${tempFlattenedGlobalMusicRecords.length} flattened global music entries from cache.`);
      }

      if (userShowallCache && Array.isArray(userShowallCache.records)) {
         tempUserShowallRecords = userShowallCache.records.filter((e: any): e is ShowallApiSongEntry => e && typeof e.id === 'string' && typeof e.diff === 'string');
         setUserPlayHistory(tempUserShowallRecords);
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
                setAllMusicData(tempFlattenedGlobalMusicRecords);
                setCachedData<any[]>(globalMusicKey, fetchedGlobalMusicApi, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
                console.log(`[DATA_FETCH_HOOK] Fetched and set ${tempFlattenedGlobalMusicRecords.length} flattened global music entries from API.`);
              }
              if (res.type === 'userShowall' && (!userShowallCache || tempUserShowallRecords.length === 0)) {
                const records = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                tempUserShowallRecords = records.filter((e: any): e is ShowallApiSongEntry => e && typeof e.id === 'string' && typeof e.diff === 'string');
                setUserPlayHistory(tempUserShowallRecords);
                setCachedData<UserShowallApiResponse>(userShowallKey, { records: tempUserShowallRecords });
                console.log(`[DATA_FETCH_HOOK] Fetched and set ${tempUserShowallRecords.length} user play history entries from API.`);
              }
            }
            if (criticalError) throw new Error(criticalError);
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

      if (!ratingData) { setIsLoadingInitialData(false); setErrorLoadingData("Rating data missing."); return; }
      if (tempFlattenedGlobalMusicRecords.length === 0) { setIsLoadingInitialData(false); setErrorLoadingData("Global music data missing."); return; }
      if (tempUserShowallRecords.length === 0 && userNameForApi !== defaultPlayerName) { setIsLoadingInitialData(false); setErrorLoadingData("User play history missing."); return; }


      const initialB30ApiEntries = ratingData?.best?.entries?.filter((e: any): e is RatingApiSongEntry => e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && typeof e.title === 'string' && e.title.trim() !== '') || [];
      const processedOriginalB30 = sortSongsByRatingDesc(initialB30ApiEntries.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
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
          acc.push({ ...newSongDef, score: userPlayRecord.score, is_played: true });
        }
        return acc;
      }, [] as ShowallApiSongEntry[]);

      const mappedPlayedNewSongs = playedNewSongsApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
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
    setPreCalculationMessage(null); // Reset pre-calc message on strategy change

    if (isLoadingInitialData || !clientHasMounted) {
      console.log("[SIM_STRATEGY_EFFECT] Waiting for initial data or client mount.");
      return;
    }

    if (calculationStrategy === "none" || calculationStrategy === null) {
      console.log("[SIM_STRATEGY_EFFECT] No strategy selected or 'none'. Displaying original data.");
      const initialDisplayB30 = originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
      const initialDisplayN20 = originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
      setSimulatedB30Songs(initialDisplayB30);
      setSimulatedNew20Songs(initialDisplayN20);
      const initialB30Avg = calculateAverageCurrentRating(originalB30SongsData, BEST_COUNT);
      const initialN20Avg = calculateAverageCurrentRating(originalNew20SongsData, NEW_20_COUNT);
      setSimulatedAverageB30Rating(initialB30Avg);
      setSimulatedAverageNew20Rating(initialN20Avg);
      setFinalOverallSimulatedRating(calculateOverallRatingFromAverages(initialB30Avg, initialN20Avg, originalB30SongsData.length, originalNew20SongsData.length));
      setCurrentPhase('idle');
      setSimulationLog(["계산 전략이 선택되지 않았습니다. 현재 곡 데이터를 표시합니다."]);
      prevCalculationStrategyRef.current = calculationStrategy;
      return;
    }

    // --- Pre-calculation for focused modes ---
    if (calculationStrategy === "b30_focus" || calculationStrategy === "n20_focus") {
      if (!targetRatingDisplay || isNaN(parseFloat(targetRatingDisplay))) {
        setPreCalculationMessage("목표 레이팅을 올바르게 입력해주세요.");
        setCurrentPhase('idle'); // Or a new phase like 'awaiting_target_rating'
        return;
      }
      const targetRatingNum = parseFloat(targetRatingDisplay);
      const mode = calculationStrategy === "b30_focus" ? "b30_only" : "n20_only";
      const theoreticalMaxInfo = calculateTheoreticalMaxOverallRating(
        mode,
        originalB30SongsData,
        originalNew20SongsData,
        allMusicData,
        allPlayedNewSongsPool,
        locale
      );

      if (targetRatingNum > theoreticalMaxInfo.reachableRating) {
        const message = mode === "b30_only"
          ? `Best 30의 갱신으로 도달 할 수 있는 최대치(${theoreticalMaxInfo.reachableRating.toFixed(4)})에 이미 도달했거나 초과했습니다.`
          : `New 20의 갱신으로 도달 할 수 있는 최대치(${theoreticalMaxInfo.reachableRating.toFixed(4)})에 이미 도달했거나 초과했습니다.`;
        setPreCalculationMessage(message);
        setCurrentPhase('target_unreachable_info');
        // Display original data as there's no simulation to run
        const initialDisplayB30 = originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
        const initialDisplayN20 = originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
        setSimulatedB30Songs(initialDisplayB30);
        setSimulatedNew20Songs(initialDisplayN20);
        setSimulatedAverageB30Rating(calculateAverageCurrentRating(originalB30SongsData, BEST_COUNT));
        setSimulatedAverageNew20Rating(calculateAverageCurrentRating(originalNew20SongsData, NEW_20_COUNT));
        setFinalOverallSimulatedRating(calculateOverallRatingFromAverages(
            calculateAverageCurrentRating(originalB30SongsData, BEST_COUNT),
            calculateAverageCurrentRating(originalNew20SongsData, NEW_20_COUNT),
            originalB30SongsData.length,
            originalNew20SongsData.length
        ));
        return; // Stop further processing for this strategy
      }
    }
    // --- End of Pre-calculation ---


    if (prevCalculationStrategyRef.current !== calculationStrategy) {
      console.log(`[SIM_STRATEGY_EFFECT] Strategy changed from ${prevCalculationStrategyRef.current} to ${calculationStrategy}. Resetting simulation states for fresh run.`);
      setSimulatedB30Songs(originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })));
      setSimulatedNew20Songs(originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })));
      const currentB30Avg = calculateAverageCurrentRating(originalB30SongsData, BEST_COUNT);
      const currentN20Avg = calculateAverageCurrentRating(originalNew20SongsData, NEW_20_COUNT);
      setSimulatedAverageB30Rating(currentB30Avg);
      setSimulatedAverageNew20Rating(currentN20Avg);
      setFinalOverallSimulatedRating(calculateOverallRatingFromAverages(currentB30Avg, currentN20Avg, originalB30SongsData.length, originalNew20SongsData.length));
      setSimulationLog([]);
      prevCalculationStrategyRef.current = calculationStrategy;
    }

    if (!currentRatingDisplay || !targetRatingDisplay) { return; }
    if (originalB30SongsData.length === 0 && originalNew20SongsData.length === 0) {
        setErrorLoadingData(getTranslation(locale, 'resultPageNoBest30Data'));
        setCurrentPhase('error_data_fetch');
        return;
    }

    const runSimulationAsync = async () => {
        if (isSimulating) { return; }
        setIsSimulating(true); setCurrentPhase('simulating');
        setSimulationLog(prev => [...prev, "Preparing simulation input..."]);

        const currentRatingNum = parseFloat(currentRatingDisplay);
        const targetRatingNum = parseFloat(targetRatingDisplay);

        if (isNaN(currentRatingNum) || isNaN(targetRatingNum)) {
            setErrorLoadingData("Invalid rating numbers for simulation."); setCurrentPhase('error_data_fetch'); setIsSimulating(false); return;
        }

        const calculatedPhaseTransitionPoint = currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95;
        setPhaseTransitionPoint(parseFloat(calculatedPhaseTransitionPoint.toFixed(4)));

        let simMode: SimulationInput["simulationMode"];
        let algoPref: SimulationInput["algorithmPreference"];

        switch (calculationStrategy) {
            case "b30_focus":
                simMode = "b30_only";
                algoPref = "floor"; // Default algorithm for focused B30
                break;
            case "n20_focus":
                simMode = "n20_only";
                algoPref = "floor"; // Default algorithm for focused N20
                break;
            case "hybrid_floor":
                simMode = "hybrid";
                algoPref = "floor";
                break;
            case "hybrid_peak":
                simMode = "hybrid";
                algoPref = "peak";
                break;
            default: // Should not happen if "none" is handled above
                setIsSimulating(false);
                setCurrentPhase("idle");
                return;
        }

        const simulationInput: SimulationInput = {
            originalB30Songs: JSON.parse(JSON.stringify(originalB30SongsData)),
            originalNew20Songs: JSON.parse(JSON.stringify(originalNew20SongsData)),
            allPlayedNewSongsPool: JSON.parse(JSON.stringify(allPlayedNewSongsPool)),
            allMusicData: JSON.parse(JSON.stringify(allMusicData)),
            userPlayHistory: JSON.parse(JSON.stringify(userPlayHistory)),
            currentRating: currentRatingNum,
            targetRating: targetRatingNum,
            algorithmPreference: algoPref,
            simulationMode: simMode,
            isScoreLimitReleased: (targetRatingNum - currentRatingNum) * 50 > 10,
            phaseTransitionPoint: parseFloat(calculatedPhaseTransitionPoint.toFixed(4)),
        };

        console.log(`[SIM_STRATEGY_EFFECT] Calling runFullSimulation. Mode: ${simMode}, Algo: ${algoPref}`);
        setSimulationLog(prev => [...prev, `Calling runFullSimulation (Mode: ${simMode}, Algo: ${algoPref})...`]);

        try {
            const result: SimulationOutput = runFullSimulation(simulationInput);
            console.log("[SIM_STRATEGY_EFFECT] SimulationOutput received:", result);
            setSimulationLog(prev => [...prev, ...result.simulationLog, `Simulation Ended. Final Phase: ${result.finalPhase}`]);
            setSimulatedB30Songs(result.simulatedB30Songs);
            setSimulatedNew20Songs(result.simulatedNew20Songs);
            setSimulatedAverageB30Rating(result.finalAverageB30Rating);
            setSimulatedAverageNew20Rating(result.finalAverageNew20Rating);
            setFinalOverallSimulatedRating(result.finalOverallRating);
            setCurrentPhase(result.finalPhase);
            if (result.error) { setErrorLoadingData(`Simulation logic error: ${result.error}`); setCurrentPhase('error_simulation_logic');}
        } catch (e: any) {
            console.error("[SIM_STRATEGY_EFFECT] Error during runFullSimulation call:", e);
            setErrorLoadingData(`Critical error in simulation: ${e.message}`); setCurrentPhase('error_simulation_logic');
            setSimulationLog(prev => [...prev, `Critical error: ${e.message}`]);
        } finally {
            setIsSimulating(false);
            console.log("[SIM_STRATEGY_EFFECT] Simulation finished or errored. isSimulating set to false.");
        }
    };

    runSimulationAsync();

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
      originalB30SongsData, originalNew20SongsData,
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
    phaseTransitionPoint,
    currentPhase,
    simulatedAverageB30Rating,
    simulatedAverageNew20Rating,
    finalOverallSimulatedRating,
    simulationLog,
    preCalculationMessage,
  };
}

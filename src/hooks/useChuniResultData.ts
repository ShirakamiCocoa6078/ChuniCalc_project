
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS, SIMULATION_CACHE_EXPIRY_MS, CachedData } from "@/lib/cache";
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
  CachedSimulationResult
} from "@/types/result-page";

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;

// Helper: Calculate average rating for a list based on targetRating
const calculateAverageTargetRating = (songs: Song[], count: number): number | null => {
  if (!songs || songs.length === 0) return null;
  const topSongs = sortSongsByRatingDesc([...songs].map(s => ({ ...s, currentRating: s.targetRating }))).slice(0, count);
  if (topSongs.length === 0) return null;
  const sum = topSongs.reduce((acc, s) => acc + s.targetRating, 0);
  return parseFloat((sum / topSongs.length).toFixed(4));
};

// Helper: Calculate average rating for a list based on currentRating
const calculateAverageCurrentRating = (songs: Song[], count: number): number | null => {
  if (!songs || songs.length === 0) return null;
  // For current average, we use currentRating, not targetRating from simulated songs
  const topSongs = sortSongsByRatingDesc([...songs]).slice(0, count);
  if (topSongs.length === 0) return null;
  const sum = topSongs.reduce((acc, s) => acc + s.currentRating, 0);
  return parseFloat((sum / topSongs.length).toFixed(4));
};


// Helper to calculate overall rating
const calculateOverallRating = (
  avgB30: number | null,
  avgN20: number | null,
  originalB30Count: number,
  originalN20Count: number
): number => {
  if (avgB30 === null) return 0;

  const actualN20Count = Math.min(originalN20Count, NEW_20_COUNT);

  if (avgN20 !== null && actualN20Count > 0 && originalB30Count >= BEST_COUNT) {
    return parseFloat(
      (((avgB30 * BEST_COUNT) + (avgN20 * actualN20Count)) / (BEST_COUNT + actualN20Count)).toFixed(4)
    );
  }
  return avgB30;
};


const flattenGlobalMusicEntry = (rawEntry: any): ShowallApiSongEntry[] => {
    const flattenedEntries: ShowallApiSongEntry[] = [];
    if (rawEntry && rawEntry.meta && rawEntry.data && typeof rawEntry.data === 'object') {
        const meta = rawEntry.meta;
        const difficulties = rawEntry.data;
        for (const diffKey in difficulties) {
            if (Object.prototype.hasOwnProperty.call(difficulties, diffKey)) {
                const diffData = difficulties[diffKey];
                if (diffData && meta.id && meta.title) { // Ensure essential fields exist
                    flattenedEntries.push({
                        id: String(meta.id),
                        title: String(meta.title),
                        genre: String(meta.genre || "N/A"),
                        release: String(meta.release || ""),
                        diff: diffKey.toUpperCase(),
                        level: String(diffData.level || "N/A"),
                        const: (typeof diffData.const === 'number' || diffData.const === null) ? diffData.const : parseFloat(String(diffData.const)),
                        is_const_unknown: diffData.is_const_unknown === true,
                        // These fields won't be present in global music, initialize if needed or rely on mapApiSongToAppSong defaults
                        score: undefined,
                        rating: undefined,
                        is_played: undefined,
                    });
                }
            }
        }
    } else if (rawEntry && rawEntry.id && rawEntry.title && rawEntry.diff) { // Already flattened structure (e.g. from cache)
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
  calculationStrategy: CalculationStrategy | null;
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
  const [initialSourceDataTimestamp, setInitialSourceDataTimestamp] = useState<number | null>(null);

  // Store initial fetched data
  const [originalB30SongsData, setOriginalB30SongsData] = useState<Song[]>([]);
  const [originalNew20SongsData, setOriginalNew20SongsData] = useState<Song[]>([]);
  const [allPlayedNewSongsPool, setAllPlayedNewSongsPool] = useState<Song[]>([]);
  const [allMusicData, setAllMusicData] = useState<ShowallApiSongEntry[]>([]);
  const [userPlayHistory, setUserPlayHistory] = useState<ShowallApiSongEntry[]>([]);

  // Store final simulation results for display
  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  const [simulatedNew20Songs, setSimulatedNew20Songs] = useState<Song[]>([]);
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);
  const [simulatedAverageNew20Rating, setSimulatedAverageNew20Rating] = useState<number | null>(null);
  const [finalOverallSimulatedRating, setFinalOverallSimulatedRating] = useState<number | null>(null);
  const [simulationLog, setSimulationLog] = useState<string[]>([]);
  const [combinedTopSongs, setCombinedTopSongs] = useState<Song[]>([]);

  // General States
  const [isLoadingInitialData, setIsLoadingInitialData] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const [errorLoadingData, setErrorLoadingData] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  const [phaseTransitionPoint, setPhaseTransitionPoint] = useState<number | null>(null);

  const prevCalculationStrategyRef = useRef<CalculationStrategy | null>(null);


  // Effect 1: Fetch all initial data needed for simulation
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
      setCurrentPhase('idle');
      setInitialSourceDataTimestamp(null);

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
              setInitialSourceDataTimestamp(profileCacheItem.timestamp);
            } else {
              setLastRefreshed(getTranslation(locale, 'resultPageSyncStatusNoCache'));
            }
          } catch (e) {
            console.warn("Failed to parse profile cache, removing item.", e);
            localStorage.removeItem(profileKey);
            setLastRefreshed(getTranslation(locale, 'resultPageSyncStatusNoCache'));
          }
        } else {
          setLastRefreshed(getTranslation(locale, 'resultPageSyncStatusNoCache'));
        }
      }

      let profileData = profileCacheItem?.data;
      let ratingData = getCachedData<RatingApiResponse>(ratingDataKey, USER_DATA_CACHE_EXPIRY_MS);
      let globalMusicCacheRaw = getCachedData<any[]>(globalMusicKey, GLOBAL_MUSIC_CACHE_EXPIRY_MS); // Expects array of raw entries
      let userShowallCache = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);
      
      let fetchedFromApi = false;
      let tempFlattenedGlobalMusicRecords: ShowallApiSongEntry[] = [];
      let tempUserShowallRecords: ShowallApiSongEntry[] = [];

      if (profileData) setApiPlayerName(profileData.player_name || userNameForApi);

      if (globalMusicCacheRaw) {
          globalMusicCacheRaw.forEach(rawEntry => {
              tempFlattenedGlobalMusicRecords.push(...flattenGlobalMusicEntry(rawEntry));
          });
          console.log(`[DATA_FETCH_HOOK] Loaded ${tempFlattenedGlobalMusicRecords.length} flattened global music entries from cache.`);
          setAllMusicData(tempFlattenedGlobalMusicRecords); // Set state here if loaded from cache
      }

      if (userShowallCache && Array.isArray(userShowallCache.records)) {
         tempUserShowallRecords = userShowallCache.records.filter((e: any): e is ShowallApiSongEntry => e && typeof e.id === 'string' && typeof e.diff === 'string');
         console.log(`[DATA_FETCH_HOOK] Loaded ${tempUserShowallRecords.length} user play history entries from cache.`);
         setUserPlayHistory(tempUserShowallRecords); // Set state here
      }


      if (!profileData || !ratingData || !globalMusicCacheRaw || !userShowallCache || tempUserShowallRecords.length === 0 || tempFlattenedGlobalMusicRecords.length === 0) {
        fetchedFromApi = true;
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
              
              if (res.type === 'profile' && !profileData) { setApiPlayerName(res.data.player_name || userNameForApi); setCachedData<ProfileData>(profileKey, res.data); profileData = res.data; setInitialSourceDataTimestamp(newCacheTimestamp); }
              if (res.type === 'rating' && !ratingData) { setCachedData<RatingApiResponse>(ratingDataKey, res.data); ratingData = res.data; }
              if (res.type === 'globalMusic' && (!globalMusicCacheRaw || tempFlattenedGlobalMusicRecords.length === 0)) {
                const fetchedGlobalMusicApi = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                tempFlattenedGlobalMusicRecords = []; // Reset before re-populating
                fetchedGlobalMusicApi.forEach(rawEntry => {
                    tempFlattenedGlobalMusicRecords.push(...flattenGlobalMusicEntry(rawEntry));
                });
                setAllMusicData(tempFlattenedGlobalMusicRecords); // Set state
                setCachedData<any[]>(globalMusicKey, fetchedGlobalMusicApi, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
                console.log(`[DATA_FETCH_HOOK] Fetched and set ${tempFlattenedGlobalMusicRecords.length} flattened global music entries from API.`);
              }
              if (res.type === 'userShowall' && (!userShowallCache || tempUserShowallRecords.length === 0)) {
                const records = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                tempUserShowallRecords = records.filter((e: any): e is ShowallApiSongEntry => e && typeof e.id === 'string' && typeof e.diff === 'string');
                setUserPlayHistory(tempUserShowallRecords); // Set state
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

      if (!ratingData) {
        setErrorLoadingData(getTranslation(locale, 'resultPageErrorLoadingDesc', "Rating data is missing after fetch/cache attempt."));
        setIsLoadingInitialData(false);
        return;
      }
      if (tempFlattenedGlobalMusicRecords.length === 0) {
        setErrorLoadingData(getTranslation(locale, 'resultPageErrorLoadingDesc', "Global music data is missing or empty."));
        setIsLoadingInitialData(false);
        return;
      }
      if (tempUserShowallRecords.length === 0 && userNameForApi !== defaultPlayerName) { // Only error if not default player
        setErrorLoadingData(getTranslation(locale, 'resultPageErrorLoadingDesc', "User play history is missing or empty."));
        setIsLoadingInitialData(false);
        return;
      }

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

      if (fetchedFromApi && initialSourceDataTimestamp === null) {
        setInitialSourceDataTimestamp(Date.now());
      }

      setIsLoadingInitialData(false);
      console.log("[DATA_FETCH_HOOK] fetchAndProcessInitialData finished.");
    };

    if (clientHasMounted) fetchAndProcessData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNameForApi, refreshNonce, clientHasMounted, locale]); // Removed toast


  // Effect 2: Run simulation when strategy or relevant inputs change OR set initial display
  useEffect(() => {
    console.log(`[SIM_STRATEGY_EFFECT] Running. Strategy: ${calculationStrategy}, Prev: ${prevCalculationStrategyRef.current}, isLoading: ${isLoadingInitialData}, OriginalB30Count: ${originalB30SongsData.length}, currentPhase: ${currentPhase}`);

    if (isLoadingInitialData || !clientHasMounted) {
      console.log("[SIM_STRATEGY_EFFECT] Waiting for initial data or client mount.");
      return;
    }

    // If no strategy is selected, display the original data.
    if (!calculationStrategy) {
      console.log("[SIM_STRATEGY_EFFECT] No strategy selected. Displaying original data.");
      // Ensure original data is mapped with targetScore/Rating = currentScore/Rating
      const initialDisplayB30 = originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
      const initialDisplayN20 = originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
      
      setSimulatedB30Songs(initialDisplayB30);
      setSimulatedNew20Songs(initialDisplayN20);
      
      const initialB30Avg = calculateAverageCurrentRating(originalB30SongsData, BEST_COUNT);
      const initialN20Avg = calculateAverageCurrentRating(originalNew20SongsData, NEW_20_COUNT);
      
      setSimulatedAverageB30Rating(initialB30Avg);
      setSimulatedAverageNew20Rating(initialN20Avg);
      setFinalOverallSimulatedRating(calculateOverallRating(initialB30Avg, initialN20Avg, originalB30SongsData.length, originalNew20SongsData.length));
      
      setCurrentPhase('idle');
      setSimulationLog(["No calculation strategy selected. Displaying current song data."]);
      prevCalculationStrategyRef.current = null;
      return;
    }

    // At this point, a calculationStrategy IS selected and initial data IS loaded.
    // Proceed with simulation.

    // Reset simulation states if strategy has actually changed
    if (prevCalculationStrategyRef.current !== calculationStrategy) {
      console.log(`[SIM_STRATEGY_EFFECT] Strategy changed from ${prevCalculationStrategyRef.current} to ${calculationStrategy}. Resetting simulation states for fresh run.`);
      setSimulatedB30Songs(originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })));
      setSimulatedNew20Songs(originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })));
      
      const currentB30Avg = calculateAverageCurrentRating(originalB30SongsData, BEST_COUNT);
      const currentN20Avg = calculateAverageCurrentRating(originalNew20SongsData, NEW_20_COUNT);
      setSimulatedAverageB30Rating(currentB30Avg);
      setSimulatedAverageNew20Rating(currentN20Avg);
      setFinalOverallSimulatedRating(calculateOverallRating(currentB30Avg, currentN20Avg, originalB30SongsData.length, originalNew20SongsData.length));
      
      setSimulationLog([]);
      prevCalculationStrategyRef.current = calculationStrategy;
    }

    if (!currentRatingDisplay || !targetRatingDisplay) {
      console.log("[SIM_STRATEGY_EFFECT] Missing current/target rating display for simulation run. Aborting.");
      // Do not set error phase here, as it might be a transient state before form inputs are fully available
      return;
    }
    if (originalB30SongsData.length === 0 && originalNew20SongsData.length === 0 && calculationStrategy) {
        console.log("[SIM_STRATEGY_EFFECT] No original song data available to simulate on. Aborting.");
        setErrorLoadingData(getTranslation(locale, 'resultPageNoBest30Data')); // Or a more general "no data for simulation"
        setCurrentPhase('error_data_fetch');
        return;
    }
    
    const runSimulationAsync = async () => {
        if (isSimulating) {
            console.log("[SIM_STRATEGY_EFFECT] Already simulating, skipping new run.");
            return;
        }
        setIsSimulating(true);
        setCurrentPhase('simulating');
        setSimulationLog(prev => [...prev, "Preparing simulation input..."]);

        const currentRatingNum = parseFloat(currentRatingDisplay);
        const targetRatingNum = parseFloat(targetRatingDisplay);
        
        if (isNaN(currentRatingNum) || isNaN(targetRatingNum)) {
            console.error("[SIM_STRATEGY_EFFECT] Invalid current or target rating values.");
            setErrorLoadingData("Invalid rating numbers for simulation.");
            setCurrentPhase('error_data_fetch');
            setIsSimulating(false);
            return;
        }

        const calculatedPhaseTransitionPoint = currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95;
        setPhaseTransitionPoint(parseFloat(calculatedPhaseTransitionPoint.toFixed(4)));

        const simulationInput: SimulationInput = {
            originalB30Songs: JSON.parse(JSON.stringify(originalB30SongsData)),
            originalNew20Songs: JSON.parse(JSON.stringify(originalNew20SongsData)),
            allPlayedNewSongsPool: JSON.parse(JSON.stringify(allPlayedNewSongsPool)),
            allMusicData: JSON.parse(JSON.stringify(allMusicData)),
            userPlayHistory: JSON.parse(JSON.stringify(userPlayHistory)),
            currentRating: currentRatingNum,
            targetRating: targetRatingNum,
            calculationStrategy: calculationStrategy!,
            isScoreLimitReleased: (targetRatingNum - currentRatingNum) * 50 > 10,
            phaseTransitionPoint: parseFloat(calculatedPhaseTransitionPoint.toFixed(4)),
        };
        
        console.log("[SIM_STRATEGY_EFFECT] Calling runFullSimulation with input. Original B30 for input:", simulationInput.originalB30Songs.length, "Original N20 for input:", simulationInput.originalNew20Songs.length);
        setSimulationLog(prev => [...prev, "Calling runFullSimulation..."]);

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

            if (result.error) {
                setErrorLoadingData(`Simulation logic error: ${result.error}`);
                setCurrentPhase('error_simulation_logic');
            }

        } catch (e: any) {
            console.error("[SIM_STRATEGY_EFFECT] Error during runFullSimulation call:", e);
            setErrorLoadingData(`Critical error in simulation: ${e.message}`);
            setCurrentPhase('error_simulation_logic');
            setSimulationLog(prev => [...prev, `Critical error: ${e.message}`]);
        } finally {
            setIsSimulating(false);
            console.log("[SIM_STRATEGY_EFFECT] Simulation finished or errored. isSimulating set to false.");
        }
    };
    
    runSimulationAsync();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    calculationStrategy,
    isLoadingInitialData,
    originalB30SongsData,
    originalNew20SongsData,
    allPlayedNewSongsPool,
    allMusicData,
    userPlayHistory,
    currentRatingDisplay,
    targetRatingDisplay,
    clientHasMounted,
    locale // Added locale because getTranslation is used in an error path
  ]);


  // Effect 3: Update combined song list for UI
  useEffect(() => {
    console.log("[COMBINED_SONGS_EFFECT] Updating combinedTopSongs. isLoadingSongs:", (isLoadingInitialData || isSimulating));
    console.log("[COMBINED_SONGS_EFFECT] Current simulatedB30Songs count:", simulatedB30Songs.length, "Current simulatedNew20Songs count:", simulatedNew20Songs.length);
    
    if (isLoadingInitialData || isSimulating) {
      console.log("[COMBINED_SONGS_EFFECT] isLoadingInitialData or isSimulating is true. Setting combinedTopSongs to [].");
      setCombinedTopSongs([]);
      return;
    }

    // Use simulated lists if available and populated, otherwise fallback to original data (mapped to have targetScore/Rating for consistency)
    const baseB30 = simulatedB30Songs.length > 0 
        ? simulatedB30Songs 
        : originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
    
    const baseN20 = simulatedNew20Songs.length > 0 
        ? simulatedNew20Songs 
        : originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));

    console.log(`[COMBINED_SONGS_EFFECT] Using baseB30 count: ${baseB30.length}, baseN20 count: ${baseN20.length}`);

    if (baseB30.length > 0 || baseN20.length > 0) {
      const songMap = new Map<string, Song>();

      // For combined view, we care about the *target* rating from the simulation
      // or current rating if no simulation has effectively run.
      const songsToCombineB30 = baseB30.map(song => ({ ...song, currentRating: song.targetRating }));
      songsToCombineB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, { ...song }));
      console.log(`[COMBINED_SONGS_EFFECT] songMap after B30 processing. Size: ${songMap.size}`);


      const songsToCombineN20 = baseN20.map(song => ({ ...song, currentRating: song.targetRating }));
      songsToCombineN20.forEach(song => {
        const key = `${song.id}_${song.diff}`;
        const new20EffectiveTargetRating = song.targetRating; 
        
        const existingEntry = songMap.get(key);
        if (!existingEntry || new20EffectiveTargetRating > existingEntry.currentRating) {
          // Update currentRating in the map for sorting, but keep original targetRating
          songMap.set(key, { ...song, currentRating: new20EffectiveTargetRating }); 
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
      simulatedB30Songs,
      simulatedNew20Songs,
      originalB30SongsData, // To handle initial display before simulation
      originalNew20SongsData, // To handle initial display before simulation
      isLoadingInitialData,
      isSimulating,
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
  };
}


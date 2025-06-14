
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS, SIMULATION_CACHE_EXPIRY_MS, CachedData } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc } from '@/lib/rating-utils';
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
                    });
                }
            }
        }
    } else if (rawEntry && rawEntry.id && rawEntry.title && rawEntry.diff) { // Already flattened structure
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

  // General States
  const [isLoadingInitialData, setIsLoadingInitialData] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const [errorLoadingData, setErrorLoadingData] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  const [phaseTransitionPoint, setPhaseTransitionPoint] = useState<number | null>(null); // For UI display

  const prevCalculationStrategyRef = useRef<CalculationStrategy | null>(null);
  const [combinedTopSongs, setCombinedTopSongs] = useState<Song[]>([]);


  // Effect 1: Fetch all initial data needed for simulation
  useEffect(() => {
    const fetchAndProcessInitialData = async () => {
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
      let globalMusicCacheRaw = getCachedData<any[]>(globalMusicKey, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
      let userShowallCache = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);
      
      let fetchedFromApi = false;

      if (profileData) setApiPlayerName(profileData.player_name || userNameForApi);

      let tempFlattenedGlobalMusic: ShowallApiSongEntry[] = [];
      if (globalMusicCacheRaw) {
        globalMusicCacheRaw.forEach(rawEntry => {
            tempFlattenedGlobalMusic.push(...flattenGlobalMusicEntry(rawEntry));
        });
        setAllMusicData(tempFlattenedGlobalMusic);
        console.log(`[DATA_FETCH_HOOK] Loaded ${tempFlattenedGlobalMusic.length} flattened global music entries from cache.`);
      }

      let tempUserShowallRecords: ShowallApiSongEntry[] = [];
      if (userShowallCache && userShowallCache.records) {
         tempUserShowallRecords = userShowallCache.records.filter((e: any): e is ShowallApiSongEntry => e && typeof e.id === 'string' && typeof e.diff === 'string');
         setUserPlayHistory(tempUserShowallRecords);
         console.log(`[DATA_FETCH_HOOK] Loaded ${tempUserShowallRecords.length} user play history entries from cache.`);
      }


      if (!profileData || !ratingData || !globalMusicCacheRaw || !userShowallCache || !tempUserShowallRecords.length) {
        fetchedFromApi = true;
        const apiRequestsMap = new Map<string, Promise<any>>();
        if (!profileData) apiRequestsMap.set('profile', fetch(`https://api.chunirec.net/2.0/records/profile.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'profile', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'profile', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!ratingData) apiRequestsMap.set('rating', fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'rating', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'rating', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!globalMusicCacheRaw) apiRequestsMap.set('globalMusic', fetch(`https://api.chunirec.net/2.0/music/showall.json?region=jp2&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'globalMusic', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'globalMusic', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!userShowallCache || !tempUserShowallRecords.length) apiRequestsMap.set('userShowall', fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'userShowall', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'userShowall', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));

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
              if (res.type === 'globalMusic' && !globalMusicCacheRaw) {
                const fetchedGlobalMusicApi = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                tempFlattenedGlobalMusic = []; // Reset before re-populating
                fetchedGlobalMusicApi.forEach(rawEntry => {
                    tempFlattenedGlobalMusic.push(...flattenGlobalMusicEntry(rawEntry));
                });
                setAllMusicData(tempFlattenedGlobalMusic);
                setCachedData<ShowallApiSongEntry[]>(globalMusicKey, fetchedGlobalMusicApi, GLOBAL_MUSIC_CACHE_EXPIRY_MS); // Cache raw API response
                console.log(`[DATA_FETCH_HOOK] Fetched and set ${tempFlattenedGlobalMusic.length} flattened global music entries from API.`);
              }
              if (res.type === 'userShowall' && (!userShowallCache || !tempUserShowallRecords.length)) {
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

      // --- Process fetched data into original song lists ---
      // Ensure ratingData and other necessary data are defined before proceeding
      if (!ratingData) {
        setErrorLoadingData(getTranslation(locale, 'resultPageErrorLoadingDesc', "Rating data is missing after fetch/cache attempt."));
        setIsLoadingInitialData(false);
        return;
      }
      const initialB30ApiEntries = ratingData?.best?.entries?.filter((e: any): e is RatingApiSongEntry => e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && typeof e.title === 'string' && e.title.trim() !== '') || [];
      const processedOriginalB30 = sortSongsByRatingDesc(initialB30ApiEntries.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
      setOriginalB30SongsData(processedOriginalB30);
      console.log(`[DATA_FETCH_HOOK] Original B30 songs mapped: ${processedOriginalB30.length}`);

      if (tempFlattenedGlobalMusic.length === 0 && allMusicData.length > 0) { // Fallback if API failed but cache had something
        tempFlattenedGlobalMusic = allMusicData;
      }
      if (tempUserShowallRecords.length === 0 && userPlayHistory.length > 0) { // Fallback
        tempUserShowallRecords = userPlayHistory;
      }


      const newSongTitlesRaw = NewSongsData.titles?.verse || [];
      const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());

      const newSongDefinitions = tempFlattenedGlobalMusic.filter(globalSong =>
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
      setAllPlayedNewSongsPool(sortSongsByRatingDesc(mappedPlayedNewSongs));
      const processedOriginalNew20 = sortSongsByRatingDesc(mappedPlayedNewSongs).slice(0, NEW_20_COUNT);
      setOriginalNew20SongsData(processedOriginalNew20);
      console.log(`[DATA_FETCH_HOOK] Original N20 songs processed: ${processedOriginalNew20.length} (from pool of ${mappedPlayedNewSongs.length})`);

      if (fetchedFromApi && initialSourceDataTimestamp === null) { // If API was fetched and timestamp wasn't set from profile
        setInitialSourceDataTimestamp(Date.now()); // Use current time as source data timestamp
      }


      setIsLoadingInitialData(false);
      console.log("[DATA_FETCH_HOOK] fetchAndProcessInitialData finished.");
    };

    if (clientHasMounted) fetchAndProcessInitialData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNameForApi, refreshNonce, clientHasMounted, locale]);


  // Effect 2: Run simulation when strategy or relevant inputs change
  useEffect(() => {
    const runSimulationAsync = async () => {
      console.log("[SIM_STRATEGY_EFFECT] Running. Strategy:", calculationStrategy, "Prev:", prevCalculationStrategyRef.current, "ActualChange:", prevCalculationStrategyRef.current !== calculationStrategy, "isLoading:", isLoadingInitialData, "OriginalB30Count:", originalB30SongsData.length, "currentPhase:", currentPhase);

      if (isLoadingInitialData || !calculationStrategy || !currentRatingDisplay || !targetRatingDisplay || (originalB30SongsData.length === 0 && originalNew20SongsData.length === 0)) {
        if (calculationStrategy && (prevCalculationStrategyRef.current === calculationStrategy && currentPhase !== 'idle' && currentPhase !== 'simulating')) {
          // Strategy is set, but data might not be ready or something else is off, but not a strategy change.
          // This could be after an error, so don't reset unless strategy *actually* changes.
          console.log("[SIM_STRATEGY_EFFECT] Conditions not met for simulation, but strategy hasn't changed. No reset. Current phase:", currentPhase);
        } else if (calculationStrategy) {
           console.log("[SIM_STRATEGY_EFFECT] Conditions not met for simulation. Resetting to original display for strategy:", calculationStrategy);
           setSimulatedB30Songs(originalB30SongsData.map(s_song => ({...s_song, targetScore: s_song.currentScore, targetRating: s_song.currentRating })));
           setSimulatedNew20Songs(originalNew20SongsData.map(s_song => ({...s_song, targetScore: s_song.currentScore, targetRating: s_song.currentRating })));
           // Recalculate initial averages based on *current* ratings of original songs
            const initialB30Avg = originalB30SongsData.length > 0 ? parseFloat((originalB30SongsData.slice(0, BEST_COUNT).reduce((sum, s_song) => sum + s_song.currentRating, 0) / Math.min(originalB30SongsData.length, BEST_COUNT)).toFixed(4)) : null;
            const initialN20Avg = originalNew20SongsData.length > 0 ? parseFloat((originalNew20SongsData.slice(0, NEW_20_COUNT).reduce((sum, s_song) => sum + s_song.currentRating, 0) / Math.min(originalNew20SongsData.length, NEW_20_COUNT)).toFixed(4)) : null;
            setSimulatedAverageB30Rating(initialB30Avg);
            setSimulatedAverageNew20Rating(initialN20Avg);
            
            let overallInitial = 0;
            if(initialB30Avg !== null) {
                if(initialN20Avg !== null && originalNew20SongsData.length > 0 && originalB30SongsData.length >= BEST_COUNT) { // N20 only counts if B30 is full
                    overallInitial = parseFloat((((initialB30Avg * BEST_COUNT) + (initialN20Avg * Math.min(originalNew20SongsData.length, NEW_20_COUNT))) / (BEST_COUNT + Math.min(originalNew20SongsData.length, NEW_20_COUNT))).toFixed(4));
                } else {
                    overallInitial = initialB30Avg;
                }
            }
            setFinalOverallSimulatedRating(overallInitial);
           setCurrentPhase('idle');
           setSimulationLog(["Simulation not run: Initial data missing or calculation strategy not ready."]);
        }
        return;
      }

      // Reset simulation states only if strategy has actually changed or if we are in a non-simulating idle phase
      if (prevCalculationStrategyRef.current !== calculationStrategy || (currentPhase === 'idle' && calculationStrategy)) {
        console.log(`[SIM_STRATEGY_EFFECT] Strategy changed from ${prevCalculationStrategyRef.current} to ${calculationStrategy} or restarting from idle. Resetting simulation states.`);
        setSimulatedB30Songs(originalB30SongsData.map(s_song => ({...s_song, targetScore: s_song.currentScore, targetRating: s_song.currentRating })));
        console.log("[SIM_STRATEGY_EFFECT] SimulatedB30Songs reset from original due to strategy change.");
        setSimulatedNew20Songs(originalNew20SongsData.map(s_song => ({...s_song, targetScore: s_song.currentScore, targetRating: s_song.currentRating })));
        console.log("[SIM_STRATEGY_EFFECT] SimulatedNew20Songs reset from original due to strategy change.");

        const initialB30Avg = originalB30SongsData.length > 0 ? parseFloat((originalB30SongsData.slice(0, BEST_COUNT).reduce((sum, s_song) => sum + s_song.currentRating, 0) / Math.min(originalB30SongsData.length, BEST_COUNT)).toFixed(4)) : null;
        const initialN20Avg = originalNew20SongsData.length > 0 ? parseFloat((originalNew20SongsData.slice(0, NEW_20_COUNT).reduce((sum, s_song) => sum + s_song.currentRating, 0) / Math.min(originalNew20SongsData.length, NEW_20_COUNT)).toFixed(4)) : null;
        setSimulatedAverageB30Rating(initialB30Avg);
        setSimulatedAverageNew20Rating(initialN20Avg);
        
        let overallInitial = 0;
        if(initialB30Avg !== null) {
            if(initialN20Avg !== null && originalNew20SongsData.length > 0 && originalB30SongsData.length >= BEST_COUNT) {
                overallInitial = parseFloat((((initialB30Avg * BEST_COUNT) + (initialN20Avg * Math.min(originalNew20SongsData.length, NEW_20_COUNT))) / (BEST_COUNT + Math.min(originalNew20SongsData.length, NEW_20_COUNT))).toFixed(4));
            } else {
                overallInitial = initialB30Avg;
            }
        }
        setFinalOverallSimulatedRating(overallInitial);
        prevCalculationStrategyRef.current = calculationStrategy;
        // Cache logic removed as per user request
      }


      setIsSimulating(true);
      setCurrentPhase('simulating');
      setSimulationLog(["Preparing simulation input..."]);

      const currentRatingNum = parseFloat(currentRatingDisplay);
      const targetRatingNum = parseFloat(targetRatingDisplay);
      
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
        calculationStrategy: calculationStrategy,
        isScoreLimitReleased: (targetRatingNum - currentRatingNum) * 50 > 10, // Original logic for this flag
        phaseTransitionPoint: parseFloat(calculatedPhaseTransitionPoint.toFixed(4)),
      };
      
      console.log("[SIM_STRATEGY_EFFECT] Calling runFullSimulation with input. Current B30 song count for input:", simulationInput.originalB30Songs.length);
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
        } else {
          // Cache saving logic removed
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

    if (clientHasMounted) { // Ensure this runs only on client
        runSimulationAsync();
    }
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
    clientHasMounted // Added clientHasMounted
  ]);


  // Effect 3: Update combined song list for UI
  useEffect(() => {
    console.log("[COMBINED_SONGS_EFFECT] Updating combinedTopSongs. isLoadingSongs:", isLoadingInitialData, "isSimulating:", isSimulating);
    console.log("[COMBINED_SONGS_EFFECT] Current simulatedB30Songs count:", simulatedB30Songs.length, "Current simulatedNew20Songs count:", simulatedNew20Songs.length);
    if (isLoadingInitialData || isSimulating) {
      console.log("[COMBINED_SONGS_EFFECT] isLoadingInitialData or isSimulating is true. Setting combinedTopSongs to [].");
      setCombinedTopSongs([]);
      return;
    }

    const baseB30 = simulatedB30Songs.length > 0 ? simulatedB30Songs : originalB30SongsData;
    const baseN20 = simulatedNew20Songs.length > 0 ? simulatedNew20Songs : originalNew20SongsData;
    console.log(`[COMBINED_SONGS_EFFECT] Using baseB30 count: ${baseB30.length}, baseN20 count: ${baseN20.length}`);


    if (baseB30.length > 0 || baseN20.length > 0) {
      const songMap = new Map<string, Song>();

      const songsToCombineB30 = baseB30.map(song => ({ ...song, currentRating: song.targetRating }));
      songsToCombineB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, { ...song }));
      console.log(`[COMBINED_SONGS_EFFECT] songMap after B30 processing. Size: ${songMap.size}`);


      const songsToCombineN20 = baseN20.map(song => ({ ...song, currentRating: song.targetRating }));
      songsToCombineN20.forEach(song => {
        const key = `${song.id}_${song.diff}`;
        const new20EffectiveRating = song.targetRating; // Corrected: was s.targetRating
        if (!songMap.has(key) || (songMap.has(key) && new20EffectiveRating > songMap.get(key)!.currentRating)) {
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
      simulatedB30Songs,
      simulatedNew20Songs,
      originalB30SongsData,
      originalNew20SongsData,
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


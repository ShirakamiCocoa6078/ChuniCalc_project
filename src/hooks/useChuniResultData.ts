
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc } from '@/lib/rating-utils';
import { runFullSimulation } from '@/lib/simulation-logic'; // Import the new pure function
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
  const [isLoadingInitialData, setIsLoadingInitialData] = useState(true); // For initial API fetches
  const [isSimulating, setIsSimulating] = useState(false); // For when the pure function is running
  const [errorLoadingData, setErrorLoadingData] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle'); // Simplified phase for UI

  const prevCalculationStrategyRef = useRef<CalculationStrategy | null>(null);

  // Effect 1: Fetch all initial data needed for simulation
  useEffect(() => {
    const fetchAndProcessInitialData = async () => {
      console.log("[DATA_FETCH_HOOK] Starting fetchAndProcessInitialData...");
      const defaultPlayerName = getTranslation(locale, 'resultPageDefaultPlayerName');
      const API_TOKEN = getApiToken();

      if (!API_TOKEN) { setErrorLoadingData(getTranslation(locale, 'resultPageErrorApiTokenNotSetResult')); setIsLoadingInitialData(false); return; }
      if (!userNameForApi || userNameForApi === defaultPlayerName) { setErrorLoadingData(getTranslation(locale, 'resultPageErrorNicknameNotProvidedResult')); setApiPlayerName(defaultPlayerName); setIsLoadingInitialData(false); return; }

      setIsLoadingInitialData(true); setErrorLoadingData(null); setApiPlayerName(userNameForApi);
      // Clear previous original data
      setOriginalB30SongsData([]); setOriginalNew20SongsData([]);
      setAllPlayedNewSongsPool([]); setAllMusicData([]); setUserPlayHistory([]);
      // Clear previous simulation results
      setSimulatedB30Songs([]); setSimulatedNew20Songs([]);
      setSimulatedAverageB30Rating(null); setSimulatedAverageNew20Rating(null);
      setFinalOverallSimulatedRating(null); setSimulationLog([]);
      setCurrentPhase('idle');

      const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
      const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
      const globalMusicKey = GLOBAL_MUSIC_DATA_KEY;
      const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;

      let cachedProfileTimestamp: string | null = null;
      if (clientHasMounted) {
        const profileCacheItem = localStorage.getItem(profileKey);
        if (profileCacheItem) { try { const parsed = JSON.parse(profileCacheItem) as { timestamp: number }; if (parsed && typeof parsed.timestamp === 'number') { cachedProfileTimestamp = new Date(parsed.timestamp).toLocaleString(locale); } } catch (e) { console.warn("Failed to parse profile cache timestamp", e); } }
      }
      setLastRefreshed(cachedProfileTimestamp ? getTranslation(locale, 'resultPageSyncStatus', cachedProfileTimestamp) : getTranslation(locale, 'resultPageSyncStatusNoCache'));

      let profileData = getCachedData<ProfileData>(profileKey);
      let ratingData = getCachedData<RatingApiResponse>(ratingDataKey, USER_DATA_CACHE_EXPIRY_MS);
      let globalMusicCacheRaw = getCachedData<any[]>(globalMusicKey, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
      let userShowallCache = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);

      if (profileData) setApiPlayerName(profileData.player_name || userNameForApi);

      let tempFlattenedGlobalMusic: ShowallApiSongEntry[] = [];
      if (globalMusicCacheRaw) {
        tempFlattenedGlobalMusic = globalMusicCacheRaw.reduce((acc, entry) => acc.concat(flattenGlobalMusicEntry(entry)), [] as ShowallApiSongEntry[]);
        setAllMusicData(tempFlattenedGlobalMusic);
      }

      let tempUserShowallRecords: ShowallApiSongEntry[] = userShowallCache?.records || [];
      if (tempUserShowallRecords.length > 0) {
        setUserPlayHistory(tempUserShowallRecords);
      }

      if (!profileData || !ratingData || !globalMusicCacheRaw || !userShowallCache) {
        const apiRequestsMap = new Map<string, Promise<any>>();
        if (!profileData) apiRequestsMap.set('profile', fetch(`https://api.chunirec.net/2.0/records/profile.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'profile', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'profile', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!ratingData) apiRequestsMap.set('rating', fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'rating', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'rating', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!globalMusicCacheRaw) apiRequestsMap.set('globalMusic', fetch(`https://api.chunirec.net/2.0/music/showall.json?region=jp2&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'globalMusic', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'globalMusic', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!userShowallCache) apiRequestsMap.set('userShowall', fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'userShowall', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'userShowall', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));

        if (apiRequestsMap.size > 0) {
          try {
            const responses = await Promise.all(Array.from(apiRequestsMap.values()));
            let criticalError = null;
            for (const res of responses) {
              if (!res.ok) { const errorMsg = `${res.type} data API failed (status: ${res.status}): ${res.data?.error?.message || res.error || 'Unknown API error'}`; if (!criticalError) criticalError = errorMsg; console.error(`[DATA_FETCH_API_ERROR] ${errorMsg}`); continue; }
              if (res.type === 'profile' && !profileData) { setApiPlayerName(res.data.player_name || userNameForApi); setCachedData<ProfileData>(profileKey, res.data); profileData = res.data; }
              if (res.type === 'rating' && !ratingData) { setCachedData<RatingApiResponse>(ratingDataKey, res.data); ratingData = res.data; }
              if (res.type === 'globalMusic' && !globalMusicCacheRaw) {
                const fetchedGlobalMusicApi = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                tempFlattenedGlobalMusic = fetchedGlobalMusicApi.reduce((acc, entry) => acc.concat(flattenGlobalMusicEntry(entry)), [] as ShowallApiSongEntry[]);
                setAllMusicData(tempFlattenedGlobalMusic);
                setCachedData<ShowallApiSongEntry[]>(globalMusicKey, tempFlattenedGlobalMusic, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
              }
              if (res.type === 'userShowall' && !userShowallCache) {
                tempUserShowallRecords = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                setUserPlayHistory(tempUserShowallRecords);
                setCachedData<UserShowallApiResponse>(userShowallKey, { records: tempUserShowallRecords });
              }
            }
            if (criticalError) throw new Error(criticalError);
            const newCacheTime = new Date().toLocaleString(locale);
            setLastRefreshed(getTranslation(locale, 'resultPageSyncStatus', newCacheTime));
            if (responses.some(res => res.ok)) toast({ title: getTranslation(locale, 'resultPageToastApiLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastApiLoadSuccessDesc', newCacheTime) });
          } catch (error) {
            let detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', "Unknown error");
            if (error instanceof Error) detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', error.message);
            setErrorLoadingData(detailedErrorMessage);
            if (!apiPlayerName && userNameForApi !== defaultPlayerName) setApiPlayerName(userNameForApi);
          }
        }
      } else {
         console.log("[DATA_FETCH_HOOK] All initial data loaded from cache.");
         toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
      }

      // --- Process fetched data into original song lists ---
      const initialB30ApiEntries = ratingData?.best?.entries?.filter((e: any): e is RatingApiSongEntry => e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && typeof e.title === 'string' && e.title.trim() !== '') || [];
      const processedOriginalB30 = sortSongsByRatingDesc(initialB30ApiEntries.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
      setOriginalB30SongsData(processedOriginalB30);
      console.log(`[DATA_FETCH_HOOK] Original B30 songs mapped: ${processedOriginalB30.length}`);

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

      setIsLoadingInitialData(false);
      console.log("[DATA_FETCH_HOOK] fetchAndProcessInitialData finished.");
    };

    if (clientHasMounted) fetchAndProcessInitialData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNameForApi, refreshNonce, clientHasMounted, locale]);


  // Effect 2: Run simulation when strategy or relevant inputs change
  useEffect(() => {
    const runSimulationAsync = async () => {
      if (isLoadingInitialData || !calculationStrategy || !currentRatingDisplay || !targetRatingDisplay || originalB30SongsData.length === 0) {
        // Don't run simulation if data is still loading, no strategy, or no B30 base data
        if (calculationStrategy) { // If strategy is set but other conditions fail
             console.log("[SIM_RUN_EFFECT] Conditions not met for simulation. Strategy:", calculationStrategy, "isLoadingInitial:", isLoadingInitialData, "B30 count:", originalB30SongsData.length);
             // Reset simulation display states if strategy is present but sim can't run
             setSimulatedB30Songs(originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating })));
             setSimulatedNew20Songs(originalNew20SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating })));
             setSimulatedAverageB30Rating(originalB30SongsData.length > 0 ? originalB30SongsData.reduce((sum, s) => sum + s.currentRating, 0) / Math.min(originalB30SongsData.length, BEST_COUNT) : null);
             setSimulatedAverageNew20Rating(originalNew20SongsData.length > 0 ? originalNew20SongsData.reduce((sum, s) => sum + s.currentRating, 0) / Math.min(originalNew20SongsData.length, NEW_20_COUNT) : null);
             setFinalOverallSimulatedRating(parseFloat(currentRatingDisplay || "0"));
             setSimulationLog(["Simulation not run: Initial data missing or strategy not ready."]);
             setCurrentPhase('idle');
        }
        return;
      }

      // Reset simulation states if strategy has actually changed
      if (prevCalculationStrategyRef.current !== calculationStrategy) {
        console.log(`[SIM_RUN_EFFECT] Strategy changed from ${prevCalculationStrategyRef.current} to ${calculationStrategy}. Resetting display states.`);
        setSimulatedB30Songs(originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating })));
        setSimulatedNew20Songs(originalNew20SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating })));
        // Recalculate initial averages based on *current* ratings of original songs
        const initialB30Avg = originalB30SongsData.length > 0 ? parseFloat((originalB30SongsData.slice(0, BEST_COUNT).reduce((sum, s) => sum + s.currentRating, 0) / Math.min(originalB30SongsData.length, BEST_COUNT)).toFixed(4)) : null;
        const initialN20Avg = originalNew20SongsData.length > 0 ? parseFloat((originalNew20SongsData.slice(0, NEW_20_COUNT).reduce((sum, s) => sum + s.currentRating, 0) / Math.min(originalNew20SongsData.length, NEW_20_COUNT)).toFixed(4)) : null;
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
        setCurrentPhase('simulating'); // Indicate simulation is about to start
        prevCalculationStrategyRef.current = calculationStrategy;
      }


      setIsSimulating(true);
      setCurrentPhase('simulating');
      setSimulationLog(["Preparing simulation input..."]);

      const currentRatingNum = parseFloat(currentRatingDisplay);
      const targetRatingNum = parseFloat(targetRatingDisplay);
      const isScoreLimitReleased = (targetRatingNum - currentRatingNum) * 50 > 10;
      const phaseTransitionPoint = currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95;

      const simulationInput: SimulationInput = {
        originalB30Songs: JSON.parse(JSON.stringify(originalB30SongsData)), // Deep copy
        originalNew20Songs: JSON.parse(JSON.stringify(originalNew20SongsData)), // Deep copy
        allPlayedNewSongsPool: JSON.parse(JSON.stringify(allPlayedNewSongsPool)),
        allMusicData: JSON.parse(JSON.stringify(allMusicData)),
        userPlayHistory: JSON.parse(JSON.stringify(userPlayHistory)),
        currentRating: currentRatingNum,
        targetRating: targetRatingNum,
        calculationStrategy: calculationStrategy,
        isScoreLimitReleased,
        phaseTransitionPoint: parseFloat(phaseTransitionPoint.toFixed(4)),
      };
      
      console.log("[SIM_RUN_EFFECT] Calling runFullSimulation with input:", simulationInput);
      setSimulationLog(prev => [...prev, "Calling runFullSimulation..."]);

      // Offload the heavy computation to a non-blocking task if possible, or directly call.
      // For simplicity here, direct call. For web workers, it'd be more complex.
      try {
        const result: SimulationOutput = runFullSimulation(simulationInput);
        console.log("[SIM_RUN_EFFECT] SimulationOutput received:", result);
        setSimulationLog(prev => [...prev, ...result.simulationLog, `Simulation Ended. Final Phase: ${result.finalPhase}`]);

        setSimulatedB30Songs(result.simulatedB30Songs);
        setSimulatedNew20Songs(result.simulatedNew20Songs);
        setSimulatedAverageB30Rating(result.finalAverageB30Rating);
        setSimulatedAverageNew20Rating(result.finalAverageNew20Rating);
        setFinalOverallSimulatedRating(result.finalOverallRating);
        setCurrentPhase(result.finalPhase);
        if (result.error) {
          setErrorLoadingData(`Simulation logic error: ${result.error}`);
        }

      } catch (e: any) {
          console.error("[SIM_RUN_EFFECT] Error during runFullSimulation call:", e);
          setErrorLoadingData(`Critical error in simulation: ${e.message}`);
          setCurrentPhase('error_simulation_logic');
          setSimulationLog(prev => [...prev, `Critical error: ${e.message}`]);
      } finally {
          setIsSimulating(false);
      }
    };

    runSimulationAsync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    calculationStrategy,
    isLoadingInitialData, // Re-run if data finishes loading AND strategy is set
    originalB30SongsData, // And other original data lists if they are fetched independently
    originalNew20SongsData,
    allPlayedNewSongsPool,
    allMusicData,
    userPlayHistory,
    currentRatingDisplay, // Target rating changes should also re-trigger
    targetRatingDisplay
  ]);


  // Effect 3: Update combined song list for UI
  const [combinedTopSongs, setCombinedTopSongs] = useState<Song[]>([]);
  useEffect(() => {
    if (isLoadingInitialData && !isSimulating) { // If initial data is loading OR simulation is running, don't update combined yet.
      setCombinedTopSongs([]);
      return;
    }

    const baseB30 = simulatedB30Songs.length > 0 ? simulatedB30Songs : originalB30SongsData;
    const baseN20 = simulatedNew20Songs.length > 0 ? simulatedNew20Songs : originalNew20SongsData;

    if (baseB30.length > 0 || baseN20.length > 0) {
      const songMap = new Map<string, Song>();

      const songsToCombineB30 = baseB30.map(s => ({ ...s, currentRating: s.targetRating })); // Use targetRating from simulation
      songsToCombineB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, { ...song }));

      const songsToCombineN20 = baseN20.map(s => ({ ...s, currentRating: s.targetRating })); // Use targetRating from simulation
      songsToCombineN20.forEach(song => {
        const key = `${song.id}_${song.diff}`;
        const new20EffectiveRating = s.targetRating;
        if (!songMap.has(key) || (songMap.has(key) && new20EffectiveRating > songMap.get(key)!.currentRating)) {
          songMap.set(key, { ...song, currentRating: new20EffectiveRating });
        }
      });
      setCombinedTopSongs(sortSongsByRatingDesc(Array.from(songMap.values())));
    } else {
      setCombinedTopSongs([]);
    }
  }, [simulatedB30Songs, simulatedNew20Songs, originalB30SongsData, originalNew20SongsData, isLoadingInitialData, isSimulating]);


  return {
    apiPlayerName,
    // Return final simulated states for UI
    best30SongsData: simulatedB30Songs,
    new20SongsData: simulatedNew20Songs,
    combinedTopSongs,
    isLoadingSongs: isLoadingInitialData || isSimulating, // Combined loading state
    errorLoadingSongs: errorLoadingData,
    lastRefreshed,
    currentPhase, // Simplified phase
    simulatedAverageB30Rating,
    simulatedAverageNew20Rating,
    finalOverallSimulatedRating, // For display
    simulationLog, // For potential display on test page or debug
    // Removed intermediate simulation states as they are now internal to simulation-logic.ts
  };
}

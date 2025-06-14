
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import constOverridesInternal from '@/data/const-overrides.json'; // Renamed to avoid conflict
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
  SimulationOutput,
  ConstOverride
} from "@/types/result-page";

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;
const MAX_SCORE_FOR_MAX_RATING = 1009000; // SSS+ boundary for max const-based rating


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
        // Handle cases where the entry might already be somewhat flattened or is a direct song entry
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
  const [allPlayedNewSongsPool, setAllPlayedNewSongsPool] = useState<Song[]>([]); // For N20 replacements
  const [allMusicData, setAllMusicData] = useState<ShowallApiSongEntry[]>([]); // For B30 replacements (excluding N20)
  const [userPlayHistory, setUserPlayHistory] = useState<ShowallApiSongEntry[]>([]); // User's full play history for reference

  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  const [simulatedNew20Songs, setSimulatedNew20Songs] = useState<Song[]>([]);
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);
  const [simulatedAverageNew20Rating, setSimulatedAverageNew20Rating] = useState<number | null>(null);
  const [finalOverallSimulatedRating, setFinalOverallSimulatedRating] = useState<number | null>(null);
  const [simulationLog, setSimulationLog] = useState<string[]>([]);
  const [combinedTopSongs, setCombinedTopSongs] = useState<Song[]>([]);

  const [isLoadingInitialData, setIsLoadingInitialData] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const [errorLoadingData, setErrorLoadingData] = useState<string | null>(null); // Also used for pre-sim messages
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  const [preSimulationMessage, setPreSimulationMessage] = useState<string | null>(null); // Specific for pre-calc messages

  const prevCalculationStrategyRef = useRef<CalculationStrategy>(calculationStrategy);


  // Effect 1: Fetch and process initial data
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
            let fetchedGlobalMusicApiForCache: any[] | undefined = undefined; // To store the direct API response for global music
            let fetchedUserShowallForCache: UserShowallApiResponse | undefined = undefined;


            for (const res of responses) {
              if (!res.ok) { const errorMsg = `${res.type} data API failed (status: ${res.status}): ${res.data?.error?.message || res.error || 'Unknown API error'}`; if (!criticalError) criticalError = errorMsg; console.error(`[DATA_FETCH_API_ERROR] ${errorMsg}`); continue; }

              if (res.type === 'profile' && !profileData) { setApiPlayerName(res.data.player_name || userNameForApi); setCachedData<ProfileData>(profileKey, res.data); profileData = res.data; }
              if (res.type === 'rating' && !ratingData) { setCachedData<RatingApiResponse>(ratingDataKey, res.data); ratingData = res.data; }
              if (res.type === 'globalMusic' && (!globalMusicCacheRaw || tempFlattenedGlobalMusicRecords.length === 0)) {
                const fetchedGlobalMusicRaw = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                fetchedGlobalMusicApiForCache = fetchedGlobalMusicRaw; // Store for caching
                tempFlattenedGlobalMusicRecords = []; // Clear before re-populating
                fetchedGlobalMusicRaw.forEach(rawEntry => { tempFlattenedGlobalMusicRecords.push(...flattenGlobalMusicEntry(rawEntry)); });
                console.log(`[DATA_FETCH_HOOK] Fetched and set ${tempFlattenedGlobalMusicRecords.length} flattened global music entries from API.`);
              }
              if (res.type === 'userShowall' && (!userShowallCache || tempUserShowallRecords.length === 0)) {
                const records = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                fetchedUserShowallForCache = { records }; // Store for caching
                tempUserShowallRecords = records.filter((e: any): e is ShowallApiSongEntry => e && typeof e.id === 'string' && typeof e.diff === 'string');
                console.log(`[DATA_FETCH_HOOK] Fetched and set ${tempUserShowallRecords.length} user play history entries from API.`);
              }
            }
            if (criticalError) throw new Error(criticalError);

            if (fetchedGlobalMusicApiForCache) setCachedData<any[]>(globalMusicKey, fetchedGlobalMusicApiForCache, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
            if (fetchedUserShowallForCache) setCachedData<UserShowallApiResponse>(userShowallKey, fetchedUserShowallForCache);


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

      // Apply Constant Overrides
      const overridesToApply = constOverridesInternal as ConstOverride[];
      if (Array.isArray(overridesToApply) && overridesToApply.length > 0 && tempFlattenedGlobalMusicRecords.length > 0) {
        console.log(`[CONST_OVERRIDE] Applying ${overridesToApply.length} overrides to ${tempFlattenedGlobalMusicRecords.length} global songs...`);
        overridesToApply.forEach(override => {
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
          // Ensure the global const (possibly overridden) is prioritized for mapping
          const globalDefinitionForConst = tempFlattenedGlobalMusicRecords.find(gs => gs.id === newSongDef.id && gs.diff === newSongDef.diff);
          acc.push({
            ...newSongDef, // This already has the global (potentially overridden) const
            score: userPlayRecord.score,
            is_played: true,
            rating: userPlayRecord.rating, // User's play rating, mapApiSongToAppSong will recalculate if needed
            // Explicitly use the const from the (possibly overridden) global definition
            const: globalDefinitionForConst?.const ?? newSongDef.const,
          });
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


  // Effect 2: Handle calculation strategy changes and run simulation
  useEffect(() => {
    const strategyChanged = prevCalculationStrategyRef.current !== calculationStrategy;
    prevCalculationStrategyRef.current = calculationStrategy;

    console.log(`[SIM_STRATEGY_EFFECT] Running. Strategy: ${calculationStrategy}, Prev: ${prevCalculationStrategyRef.current}, ActualChange: ${strategyChanged} isLoading: ${isLoadingInitialData}, OriginalB30Count: ${originalB30SongsData.length}, currentPhase: ${currentPhase}`);

    if (isLoadingInitialData || !clientHasMounted) {
      console.log("[SIM_STRATEGY_EFFECT] Waiting for initial data or client mount.");
      return;
    }

    // Always clear previous pre-simulation messages when strategy changes or inputs affecting it change
    setPreSimulationMessage(null);
    setErrorLoadingData(null); // Clear general errors too

    const currentRatingNum = parseFloat(currentRatingDisplay || "0");
    const targetRatingNum = parseFloat(targetRatingDisplay || "0");

    if (isNaN(currentRatingNum) || isNaN(targetRatingNum)) {
      setErrorLoadingData(getTranslation(locale, 'resultPageErrorInvalidRatingsInput'));
      setCurrentPhase('error_data_fetch');
      return;
    }

    // Determine simulation scope and improvement method based on UI strategy
    let simScopeForInput: 'b30_only' | 'n20_only' | 'combined' = 'combined';
    let improvementMethodForInput: 'floor' | 'peak' = 'floor'; // Default heuristic

    if (calculationStrategy === 'b30_focus') {
      simScopeForInput = 'b30_only';
      improvementMethodForInput = 'floor'; // Example: b30_focus always uses floor, or make this configurable
    } else if (calculationStrategy === 'n20_focus') {
      simScopeForInput = 'n20_only';
      improvementMethodForInput = 'floor'; // Example
    } else if (calculationStrategy === 'combined_floor') {
      simScopeForInput = 'combined';
      improvementMethodForInput = 'floor';
    } else if (calculationStrategy === 'combined_peak') {
      simScopeForInput = 'combined';
      improvementMethodForInput = 'peak';
    } else if (calculationStrategy === 'none' || calculationStrategy === null) {
      console.log("[SIM_STRATEGY_EFFECT] No strategy selected. Displaying original data.");
      const initialDisplayB30 = originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
      const initialDisplayN20 = originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
      setSimulatedB30Songs(initialDisplayB30);
      setSimulatedNew20Songs(initialDisplayN20);

      const avgB30 = calculateMaxPotentialRatingOfSongList(initialDisplayB30, BEST_COUNT, 0, 'currentRating').average;
      const avgN20 = calculateMaxPotentialRatingOfSongList(initialDisplayN20, NEW_20_COUNT, 0, 'currentRating').average;

      setSimulatedAverageB30Rating(avgB30);
      setSimulatedAverageNew20Rating(avgN20);
      setFinalOverallSimulatedRating(
        calculateMaxPotentialRatingOfSongList(
            [...initialDisplayB30, ...initialDisplayN20], // Combine for overall calculation if needed
            BEST_COUNT + NEW_20_COUNT, // Placeholder, actual overall calc is more nuanced
            0,
            'currentRating',
            avgB30, // Pass pre-calculated averages
            avgN20,
            initialDisplayB30.length,
            initialDisplayN20.length
        ).overallAverage || 0 // Assuming calculateMaxPotentialRatingOfSongList can return overall
      );
      setCurrentPhase('idle');
      setSimulationLog([getTranslation(locale, 'resultPageLogNoStrategy')]);
      return;
    }


    // Pre-calculation for focused modes
    if (simScopeForInput === 'b30_only' || simScopeForInput === 'n20_only') {
      const {
        reachableRating,
        messageKey,
        maxedB30ForDisplay, // Get the theoretical max lists for display
        maxedN20ForDisplay,
        avgB30AtMax,
        avgN20AtMax,
        overallAtMax,
      } = calculateTheoreticalMaxOverallRating(
        simScopeForInput,
        originalB30SongsData,
        originalNew20SongsData,
        allMusicData,
        allPlayedNewSongsPool,
        MAX_SCORE_FOR_MAX_RATING
      );

      if (targetRatingNum > reachableRating) {
        setPreSimulationMessage(getTranslation(locale, messageKey, reachableRating.toFixed(4)));
        setCurrentPhase(simScopeForInput === 'b30_only' ? 'target_unreachable_b30_fixed_n20' : 'target_unreachable_n20_fixed_b30');
        // Display the "maxed out" song lists
        setSimulatedB30Songs(maxedB30ForDisplay);
        setSimulatedNew20Songs(maxedN20ForDisplay);
        setSimulatedAverageB30Rating(avgB30AtMax);
        setSimulatedAverageNew20Rating(avgN20AtMax);
        setFinalOverallSimulatedRating(overallAtMax);
        setIsSimulating(false);
        return; // Exit if target is unreachable
      }
    }

    // Proceed with simulation
    const runSimulationAsync = async () => {
      if (isSimulating && !strategyChanged) {
        console.log("[SIM_STRATEGY_EFFECT] Simulation already in progress for the current strategy, skipping new run.");
        return;
      }
      if (isSimulating && strategyChanged) {
          console.warn("[SIM_STRATEGY_EFFECT] Strategy changed while a simulation was (conceptually) in progress. This should ideally be handled by aborting the previous one or queueing. For now, proceeding with new strategy.");
          // Potentially reset some simulation-specific states if needed.
      }

      setIsSimulating(true);
      setCurrentPhase('simulating');
      setSimulationLog([getTranslation(locale, 'resultPageLogSimulationStarting')]);

      const simulationInput: SimulationInput = {
        originalB30Songs: JSON.parse(JSON.stringify(originalB30SongsData)),
        originalNew20Songs: JSON.parse(JSON.stringify(originalNew20SongsData)),
        allPlayedNewSongsPool: JSON.parse(JSON.stringify(allPlayedNewSongsPool)),
        allMusicData: JSON.parse(JSON.stringify(allMusicData)),
        userPlayHistory: JSON.parse(JSON.stringify(userPlayHistory)),
        currentRating: currentRatingNum,
        targetRating: targetRatingNum,
        simulationScope: simScopeForInput,
        improvementMethod: improvementMethodForInput,
        isScoreLimitReleased: (targetRatingNum - currentRatingNum) * 50 > 10,
        phaseTransitionPoint: parseFloat((currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95).toFixed(4)),
      };

      console.log(`[SIM_STRATEGY_EFFECT] Calling runFullSimulation. Scope: ${simulationInput.simulationScope}, Method: ${simulationInput.improvementMethod}`);
      try {
        const result: SimulationOutput = runFullSimulation(simulationInput);
        console.log("[SIM_STRATEGY_EFFECT] SimulationOutput received:", result);

        setSimulatedB30Songs(result.simulatedB30Songs);
        setSimulatedNew20Songs(result.simulatedNew20Songs);
        setSimulatedAverageB30Rating(result.finalAverageB30Rating);
        setSimulatedAverageNew20Rating(result.finalAverageNew20Rating);
        setFinalOverallSimulatedRating(result.finalOverallRating);
        setCurrentPhase(result.finalPhase);
        setSimulationLog(prev => [...prev, ...result.simulationLog, `Simulation Ended. Final Phase: ${result.finalPhase}`]);

        if (result.error) {
          setErrorLoadingData(getTranslation(locale, 'resultPageErrorSimulationGeneric', result.error));
          setCurrentPhase('error_simulation_logic');
        } else if (result.finalPhase === 'target_unreachable_b30_fixed_n20' || result.finalPhase === 'target_unreachable_n20_fixed_b30') {
            // This case should ideally be caught by pre-calculation, but as a fallback
            const msgKey = result.finalPhase === 'target_unreachable_b30_fixed_n20' ? 'reachableRatingB30OnlyMessage' : 'reachableRatingN20OnlyMessage';
            setPreSimulationMessage(getTranslation(locale, msgKey, result.reachableRating?.toFixed(4) || 'N/A'));
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

    runSimulationAsync();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    calculationStrategy, isLoadingInitialData, clientHasMounted, locale,
    originalB30SongsData, originalNew20SongsData, allPlayedNewSongsPool, allMusicData, userPlayHistory,
    currentRatingDisplay, targetRatingDisplay // Ensure these trigger re-evaluation when they change
  ]);


  // Effect 3: Update combinedTopSongs for UI display
  useEffect(() => {
    console.log("[COMBINED_SONGS_EFFECT] Updating combinedTopSongs. isLoadingInitialData:", isLoadingInitialData, "isSimulating:", isSimulating);
    console.log("[COMBINED_SONGS_EFFECT] Current simulatedB30Songs count:", simulatedB30Songs.length, "Current simulatedNew20Songs count:", simulatedNew20Songs.length);

    if (isLoadingInitialData || isSimulating) {
      console.log("[COMBINED_SONGS_EFFECT] isLoadingInitialData or isSimulating is true. Setting combinedTopSongs to [].");
      setCombinedTopSongs([]);
      return;
    }

    // Use simulated lists if available, otherwise fall back to original data for initial display
    const baseB30 = simulatedB30Songs.length > 0
        ? simulatedB30Songs
        : originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));

    const baseN20 = simulatedNew20Songs.length > 0
        ? simulatedNew20Songs
        : originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));

    console.log(`[COMBINED_SONGS_EFFECT] Using baseB30 count: ${baseB30.length}, baseN20 count: ${baseN20.length}`);

    if (baseB30.length > 0 || baseN20.length > 0) {
      const songMap = new Map<string, Song>();

      // When combining, we care about the *target* rating achieved in simulation
      // or current rating if no simulation has effectively run for that song.
      const songsToCombineB30 = baseB30.map(song => ({ ...song, displayRating: song.targetRating }));
      songsToCombineB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, { ...song }));
      console.log(`[COMBINED_SONGS_EFFECT] songMap after B30 processing. Size: ${songMap.size}`);

      const songsToCombineN20 = baseN20.map(song => ({ ...song, displayRating: song.targetRating }));
      songsToCombineN20.forEach(song => {
        const key = `${song.id}_${song.diff}`;
        const new20EffectiveRating = song.displayRating; // Use targetRating as displayRating
        const existingEntry = songMap.get(key);
        if (!existingEntry || new20EffectiveRating > (existingEntry as Song & {displayRating: number}).displayRating) {
          songMap.set(key, { ...song });
        }
      });
      console.log(`[COMBINED_SONGS_EFFECT] songMap after N20 processing. Size: ${songMap.size}`);

      // Sort by displayRating (which is targetRating)
      const combinedAndSorted = Array.from(songMap.values()).sort((a, b) =>
        (b as Song & {displayRating: number}).displayRating - (a as Song & {displayRating: number}).displayRating
      );
      setCombinedTopSongs(combinedAndSorted);
      console.log(`[COMBINED_SONGS_EFFECT] CombinedTopSongs updated. Count: ${combinedAndSorted.length}`);
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


  // Helper function for pre-calculation (can be moved to utils or stay here)
  // This function needs to be defined or imported if it's not already part of this file
  const calculateTheoreticalMaxOverallRating = (
    focusMode: 'b30_only' | 'n20_only',
    currentB30: Song[],
    currentN20: Song[],
    allMusic: ShowallApiSongEntry[],
    allPlayedNew: Song[],
    maxScore: number
  ): { reachableRating: number; messageKey: keyof (typeof getTranslation.__localeType)['KR']; maxedB30ForDisplay: Song[]; maxedN20ForDisplay: Song[]; avgB30AtMax: number | null; avgN20AtMax: number | null; overallAtMax: number; } => {
    let fixedListRatingSum = 0;
    let fixedListCount = 0;
    let variableListCandidatePool: ShowallApiSongEntry[] = [];
    let variableListLimit = 0;
    let messageKeyToReturn: keyof (typeof getTranslation.__localeType)['KR'] = 'resultPageErrorSimulationGeneric'; // Default message

    let b30ToDisplayAtMax: Song[] = JSON.parse(JSON.stringify(currentB30)); // Start with current
    let n20ToDisplayAtMax: Song[] = JSON.parse(JSON.stringify(currentN20));
    let finalAvgB30AtMax: number | null = null;
    let finalAvgN20AtMax: number | null = null;


    if (focusMode === 'b30_only') {
      messageKeyToReturn = 'reachableRatingB30OnlyMessage';
      // N20 is fixed: Use their current ratings for the sum
      currentN20.forEach(song => fixedListRatingSum += song.currentRating);
      fixedListCount = currentN20.length;
      finalAvgN20AtMax = calculateMaxPotentialRatingOfSongList(currentN20, NEW_20_COUNT, 0, 'currentRating').average; // Avg of current N20
      n20ToDisplayAtMax = currentN20.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})); // N20 displayed as is


      // B30 candidates: current B30 + all other non-N20 songs from allMusic
      const n20IdsAndDiffs = new Set(currentN20.map(s => `${s.id}_${s.diff}`));
      variableListCandidatePool = allMusic.filter(ms => !n20IdsAndDiffs.has(`${ms.id}_${ms.diff.toUpperCase()}`));
      variableListLimit = BEST_COUNT;

      const { list: maxedB30List, average: avgB30FromMaxed } = calculateMaxPotentialRatingOfSongList(variableListCandidatePool, variableListLimit, maxScore, 'targetRating');
      fixedListRatingSum += maxedB30List.reduce((sum, s) => sum + s.targetRating, 0); // Sum of targetRatings (which are maxed)
      fixedListCount += maxedB30List.length; // Should be BEST_COUNT if enough candidates
      finalAvgB30AtMax = avgB30FromMaxed;
      b30ToDisplayAtMax = maxedB30List;


    } else { // n20_only
      messageKeyToReturn = 'reachableRatingN20OnlyMessage';
      // B30 is fixed
      currentB30.forEach(song => fixedListRatingSum += song.currentRating);
      fixedListCount = currentB30.length;
      finalAvgB30AtMax = calculateMaxPotentialRatingOfSongList(currentB30, BEST_COUNT, 0, 'currentRating').average;
      b30ToDisplayAtMax = currentB30.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating}));

      // N20 candidates: current N20 + all other played new songs not in B30
      // allPlayedNewSongsPool are already Song objects
      const b30IdsAndDiffs = new Set(currentB30.map(s => `${s.id}_${s.diff}`));
      const n20CandidatePoolAsSongs: Song[] = allPlayedNew.filter(pns => !b30IdsAndDiffs.has(`${pns.id}_${pns.diff}`));
      variableListLimit = NEW_20_COUNT;

      // Convert Song[] to ShowallApiSongEntry[] for calculateMaxPotentialRatingOfSongList if it expects that type
      const n20CandidatePoolForCalc: ShowallApiSongEntry[] = n20CandidatePoolAsSongs.map(s => ({
          id: s.id, title: s.title, diff: s.diff, genre: s.genre || "N/A", const: s.chartConstant, level: s.level || "N/A"
      }));

      const { list: maxedN20List, average: avgN20FromMaxed } = calculateMaxPotentialRatingOfSongList(n20CandidatePoolForCalc, variableListLimit, maxScore, 'targetRating');
      fixedListRatingSum += maxedN20List.reduce((sum, s) => sum + s.targetRating, 0);
      fixedListCount += maxedN20List.length;
      finalAvgN20AtMax = avgN20FromMaxed;
      n20ToDisplayAtMax = maxedN20List;
    }

    const overallReachable = fixedListCount > 0 ? parseFloat((fixedListRatingSum / fixedListCount).toFixed(4)) : 0;
    const overallRatingAtMaxForDisplay = calculateMaxPotentialRatingOfSongList(
        [], 0, 0, 'currentRating', // Dummy values for songs, limit, score, prop
        finalAvgB30AtMax, finalAvgN20AtMax,
        b30ToDisplayAtMax.length, n20ToDisplayAtMax.length
    ).overallAverage || 0;


    return {
      reachableRating: overallReachable,
      messageKey: messageKeyToReturn,
      maxedB30ForDisplay: b30ToDisplayAtMax,
      maxedN20ForDisplay: n20ToDisplayAtMax,
      avgB30AtMax: finalAvgB30AtMax,
      avgN20AtMax: finalAvgN20AtMax,
      overallAtMax: overallRatingAtMaxForDisplay
    };
  };


  return {
    apiPlayerName,
    best30SongsData: simulatedB30Songs,
    new20SongsData: simulatedNew20Songs,
    combinedTopSongs,
    isLoadingSongs: isLoadingInitialData || isSimulating,
    errorLoadingSongs: errorLoadingData || preSimulationMessage, // Combine general errors with pre-sim messages
    lastRefreshed,
    currentPhase,
    // Pass through averages and overall from simulation or pre-calculation display
    simulatedAverageB30Rating,
    simulatedAverageNew20Rating,
    finalOverallSimulatedRating,
    simulationLog,
    preSimulationMessage, // Keep this if ResultPage specifically uses it, otherwise errorLoadingSongs is enough
  };
}


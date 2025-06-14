// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from "@/hooks/use-toast";
// import { getApiToken } from "@/lib/get-api-token"; // No longer used
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import constOverridesInternal from '@/data/const-overrides.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateAverageAndOverallRating, calculateTheoreticalMaxRatingsForList } from '@/lib/rating-utils';
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
  ConstOverride,
} from "@/types/result-page";

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;
const MAX_SCORE_ASSUMED_FOR_POTENTIAL = 1009000;


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
    } else if (rawEntry && rawEntry.id && rawEntry.title && rawEntry.diff) { // Handle already flat entries if they exist
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

async function fetchApiViaProxy<T>(proxyEndpoint: string, params: Record<string, string> = {}): Promise<{data: T, headers: Headers, ok: boolean, status: number }> {
  const url = new URL(`/api/chunirecApiProxy`, window.location.origin);
  url.searchParams.append('proxyEndpoint', proxyEndpoint);
  for (const key in params) {
    url.searchParams.append(key, params[key]);
  }

  const response = await fetch(url.toString());
  const responseData = await response.json().catch(err => {
      console.warn(`[PROXY_FETCH] Failed to parse JSON from proxy for ${proxyEndpoint}: ${err.message}`);
      if (!response.ok) {
        return response.text().then(text => ({ error: `API Error (non-JSON): ${text}`}));
      }
      return { error: 'Failed to parse JSON response from proxy.' };
    });

  return { data: responseData, headers: response.headers, ok: response.ok, status: response.status };
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
  const [errorLoadingData, setErrorLoadingData] = useState<string | null>(null); // Also used for pre-sim messages
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  
  // Holds the pre-computation result for 'b30_only' or 'n20_only' modes.
  const [preComputationResult, setPreComputationResult] = useState<{ reachableRating: number; messageKey: string; theoreticalMaxSongsB30?: Song[], theoreticalMaxSongsN20?: Song[] } | null>(null);


  const prevCalculationStrategyRef = useRef<CalculationStrategy>(calculationStrategy);


  useEffect(() => {
    const fetchAndProcessData = async () => {
      console.log("[DATA_FETCH_HOOK] Starting fetchAndProcessInitialData...");
      const defaultPlayerName = getTranslation(locale, 'resultPageDefaultPlayerName');
      
      if (!userNameForApi || userNameForApi === defaultPlayerName) { 
        setErrorLoadingData(getTranslation(locale, 'resultPageErrorNicknameNotProvidedResult')); 
        setApiPlayerName(defaultPlayerName); 
        setIsLoadingInitialData(false); return; 
      }

      setIsLoadingInitialData(true); setErrorLoadingData(null); setApiPlayerName(userNameForApi);
      setOriginalB30SongsData([]); setOriginalNew20SongsData([]);
      setAllPlayedNewSongsPool([]); setAllMusicData([]); setUserPlayHistory([]);
      setSimulatedB30Songs([]); setSimulatedNew20Songs([]);
      setSimulatedAverageB30Rating(null); setSimulatedAverageNew20Rating(null);
      setFinalOverallSimulatedRating(null); setSimulationLog([]);
      setCurrentPhase('idle'); setPreComputationResult(null);

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
      setUserPlayHistory(tempUserShowallRecords);

      if (!profileData || !ratingData || !globalMusicCacheRaw || tempFlattenedGlobalMusicRecords.length === 0 || !userShowallCache || tempUserShowallRecords.length === 0) {
        const apiRequestsMap = new Map<string, Promise<any>>();
        if (!profileData) apiRequestsMap.set('profile', fetchApiViaProxy('records/profile.json', { region: 'jp2', user_name: userNameForApi }).then(res => ({ type: 'profile', ...res })));
        if (!ratingData) apiRequestsMap.set('rating', fetchApiViaProxy('records/rating_data.json', { region: 'jp2', user_name: userNameForApi }).then(res => ({ type: 'rating', ...res })));
        if (!globalMusicCacheRaw || tempFlattenedGlobalMusicRecords.length === 0) apiRequestsMap.set('globalMusic', fetchApiViaProxy('music/showall.json', { region: 'jp2' }).then(res => ({ type: 'globalMusic', ...res })));
        if (!userShowallCache || tempUserShowallRecords.length === 0) apiRequestsMap.set('userShowall', fetchApiViaProxy('records/showall.json', { region: 'jp2', user_name: userNameForApi }).then(res => ({ type: 'userShowall', ...res })));
        
        if (apiRequestsMap.size > 0) {
          console.log(`[DATA_FETCH_HOOK] Fetching from API via Proxy. Requests: ${Array.from(apiRequestsMap.keys()).join(', ')}`);
          try {
            const responses = await Promise.all(Array.from(apiRequestsMap.values()));
            let criticalError = null;
            let newCacheTimestamp = Date.now();
            let fetchedGlobalMusicApiForCache: any[] | undefined = undefined;
            let fetchedUserShowallForCache: UserShowallApiResponse | undefined = undefined;

            for (const res of responses) {
              if (!res.ok) { 
                const errorMsg = `${res.type} data API failed (status: ${res.status}): ${res.data?.error?.message || 'Unknown API error from proxy'}`; 
                if (!criticalError) criticalError = errorMsg; 
                console.error(`[DATA_FETCH_API_ERROR] ${errorMsg}`); continue; 
              }
              if (res.data.error && res.type !== 'profile') { // Profile 403 is handled differently
                 const errorMsg = `${res.type} data API returned error: ${res.data.error.message || 'Unknown error structure'}`;
                 if (!criticalError) criticalError = errorMsg;
                 console.error(`[DATA_FETCH_API_ERROR] ${errorMsg}`); continue;
              }


              if (res.type === 'profile') {
                if (res.status === 403 && res.data?.error?.code === 40301) { // Private user
                    criticalError = getTranslation(locale, 'toastErrorAccessDeniedDesc', userNameForApi, res.data.error.code);
                } else if (!profileData && res.ok && !res.data.error) {
                    setApiPlayerName(res.data.player_name || userNameForApi); setCachedData<ProfileData>(profileKey, res.data); profileData = res.data;
                } else if (!res.ok) {
                    criticalError = `${res.type} data API failed (status: ${res.status}): ${res.data?.error?.message || 'Unknown API error from proxy'}`;
                }
              }
              if (res.type === 'rating' && !ratingData && res.ok && !res.data.error) { setCachedData<RatingApiResponse>(ratingDataKey, res.data); ratingData = res.data; }
              if (res.type === 'globalMusic' && (!globalMusicCacheRaw || tempFlattenedGlobalMusicRecords.length === 0) && res.ok && !res.data.error) {
                const apiGlobalMusicData = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                fetchedGlobalMusicApiForCache = apiGlobalMusicData;
                tempFlattenedGlobalMusicRecords = [];
                apiGlobalMusicData.forEach(rawEntry => { tempFlattenedGlobalMusicRecords.push(...flattenGlobalMusicEntry(rawEntry)); });
                console.log(`[DATA_FETCH_HOOK] Fetched and set ${tempFlattenedGlobalMusicRecords.length} flattened global music entries from API.`);
              }
              if (res.type === 'userShowall' && (!userShowallCache || tempUserShowallRecords.length === 0) && res.ok && !res.data.error) {
                const records = res.data?.records || []; // records/showall now returns {records: [...]}
                fetchedUserShowallForCache = { records };
                tempUserShowallRecords = records.filter((e: any): e is ShowallApiSongEntry => e && typeof e.id === 'string' && typeof e.diff === 'string');
                setUserPlayHistory(tempUserShowallRecords);
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
         if (clientHasMounted) toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
      }

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
            // console.warn(`[CONST_OVERRIDE_NOT_FOUND] Song not found in master list for override: ${override.title} (${override.diff})`);
          }
        });
      } else {
        // console.log("[CONST_OVERRIDE] No overrides to apply or global music list is empty.");
      }
      setAllMusicData(tempFlattenedGlobalMusicRecords);

      if (!ratingData) { setIsLoadingInitialData(false); setErrorLoadingData("Rating data missing after fetch/cache attempt."); return; }
      if (tempFlattenedGlobalMusicRecords.length === 0) { setIsLoadingInitialData(false); setErrorLoadingData("Global music data missing after fetch/cache attempt."); return; }
      if (tempUserShowallRecords.length === 0 && userNameForApi !== defaultPlayerName) { console.warn("[DATA_FETCH_HOOK] User play history is empty.");}


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
          const globalDefinitionForConst = tempFlattenedGlobalMusicRecords.find(gs => gs.id === newSongDef.id && gs.diff === newSongDef.diff);
          acc.push({
            ...newSongDef,
            score: userPlayRecord.score,
            is_played: true,
            rating: userPlayRecord.rating,
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


  useEffect(() => {
    const strategyJustChanged = prevCalculationStrategyRef.current !== calculationStrategy;
    prevCalculationStrategyRef.current = calculationStrategy;

    console.log(`[SIM_STRATEGY_EFFECT] Running. Strategy: ${calculationStrategy}, Prev Ref: ${prevCalculationStrategyRef.current}, ActualChange: ${strategyJustChanged} isLoading: ${isLoadingInitialData}, OriginalB30Count: ${originalB30SongsData.length}, currentPhase: ${currentPhase}`);

    if (isLoadingInitialData || !clientHasMounted) {
      console.log("[SIM_STRATEGY_EFFECT] Waiting for initial data or client mount.");
      return;
    }
    
    setErrorLoadingData(null); // Clear previous errors/messages
    setPreComputationResult(null); // Clear previous pre-computation results

    const currentRatingNum = parseFloat(currentRatingDisplay || "0");
    const targetRatingNum = parseFloat(targetRatingDisplay || "0");

    if (isNaN(currentRatingNum) || isNaN(targetRatingNum)) {
      setErrorLoadingData(getTranslation(locale, 'resultPageErrorInvalidRatingsInput'));
      setCurrentPhase('error_data_fetch');
      return;
    }

    // Determine simulation scope and improvement method from UI strategy
    let simScope: SimulationInput['simulationScope'] = 'combined';
    let improveMethod: SimulationInput['improvementMethod'] = 'floor'; // Default heuristic

    if (calculationStrategy === 'b30_only') {
      simScope = 'b30_only';
      improveMethod = 'floor'; // Or allow choice later
    } else if (calculationStrategy === 'n20_only') {
      simScope = 'n20_only';
      improveMethod = 'floor'; // Or allow choice later
    } else if (calculationStrategy === 'combined_floor') {
      simScope = 'combined';
      improveMethod = 'floor';
    } else if (calculationStrategy === 'combined_peak') {
      simScope = 'combined';
      improveMethod = 'peak';
    } else if (calculationStrategy === 'none' || calculationStrategy === null) {
      console.log("[SIM_STRATEGY_EFFECT] No strategy selected. Displaying original data.");
      const initialDisplayB30 = originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
      const initialDisplayN20 = originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
      setSimulatedB30Songs(initialDisplayB30);
      setSimulatedNew20Songs(initialDisplayN20);

      const avgB30Result = calculateAverageAndOverallRating(initialDisplayB30, BEST_COUNT, 'currentRating');
      const avgN20Result = calculateAverageAndOverallRating(initialDisplayN20, NEW_20_COUNT, 'currentRating');
      const overallResult = calculateAverageAndOverallRating([], 0, 'currentRating', avgB30Result.average, avgN20Result.average, initialDisplayB30.length, initialDisplayN20.length);

      setSimulatedAverageB30Rating(avgB30Result.average);
      setSimulatedAverageNew20Rating(avgN20Result.average);
      setFinalOverallSimulatedRating(overallResult.overallAverage || 0);
      setCurrentPhase('idle');
      setSimulationLog([getTranslation(locale, 'resultPageLogNoStrategy')]);
      return;
    }

    // --- Pre-calculation for focused modes ---
    if (simScope === 'b30_only' || simScope === 'n20_only') {
      let fixedListRatingSum = 0;
      let fixedListCount = 0;
      let fixedListSongs: Song[] = [];
      let variableListCandidatePool: (Song | ShowallApiSongEntry)[] = [];
      let variableListLimit = 0;
      let messageKey: keyof ReturnType<typeof getTranslation>['KR'] = 'resultPageErrorSimulationGeneric';
      
      const currentB30ForPreCalc = originalB30SongsData.map(s => ({...s, ratingToUse: s.currentRating}));
      const currentN20ForPreCalc = originalNew20SongsData.map(s => ({...s, ratingToUse: s.currentRating}));
      
      const b30AvgForFixed = calculateAverageAndOverallRating(currentB30ForPreCalc, BEST_COUNT, 'ratingToUse').average;
      const n20AvgForFixed = calculateAverageAndOverallRating(currentN20ForPreCalc, NEW_20_COUNT, 'ratingToUse').average;

      if (simScope === 'b30_only') {
        messageKey = 'reachableRatingB30OnlyMessage';
        fixedListSongs = originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
        fixedListRatingSum = (n20AvgForFixed || 0) * Math.min(NEW_20_COUNT, currentN20ForPreCalc.length);
        fixedListCount = Math.min(NEW_20_COUNT, currentN20ForPreCalc.length);

        const b30PreCalcCandidates = allMusicData.filter(ms => {
            const isNewSong = NewSongsData.titles.verse.some(title => title.trim().toLowerCase() === ms.title.trim().toLowerCase());
            const isInFixedN20 = originalNew20SongsData.some(n20s => n20s.id === ms.id && n20s.diff.toUpperCase() === ms.diff.toUpperCase());
            return !isNewSong && !isInFixedN20; 
        });
        variableListCandidatePool = [...originalB30SongsData, ...b30PreCalcCandidates];
        variableListLimit = BEST_COUNT;
      } else { // n20_only
        messageKey = 'reachableRatingN20OnlyMessage';
        fixedListSongs = originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
        fixedListRatingSum = (b30AvgForFixed || 0) * Math.min(BEST_COUNT, currentB30ForPreCalc.length);
        fixedListCount = Math.min(BEST_COUNT, currentB30ForPreCalc.length);

        variableListCandidatePool = allPlayedNewSongsPool.filter(pns =>
            !originalB30SongsData.some(b30s => b30s.id === pns.id && b30s.diff === pns.diff)
        );
        variableListLimit = NEW_20_COUNT;
      }

      const { list: maxedVariableList, average: avgVariableAtMax, sum: sumVariableAtMax } =
        calculateTheoreticalMaxRatingsForList(variableListCandidatePool, variableListLimit, MAX_SCORE_ASSUMED_FOR_POTENTIAL);

      const totalRatingSumAtMax = fixedListRatingSum + sumVariableAtMax;
      const totalEffectiveSongsAtMax = fixedListCount + maxedVariableList.length;
      const reachableRating = totalEffectiveSongsAtMax > 0 ? parseFloat((totalRatingSumAtMax / totalEffectiveSongsAtMax).toFixed(4)) : 0;

      if (targetRatingNum > reachableRating) {
        setErrorLoadingData(getTranslation(locale, messageKey, reachableRating.toFixed(4)));
        setCurrentPhase('target_unreachable'); // Use this generic phase for UI
        setPreComputationResult({ reachableRating, messageKey, theoreticalMaxSongsB30: simScope === 'b30_only' ? maxedVariableList : fixedListSongs, theoreticalMaxSongsN20: simScope === 'n20_only' ? maxedVariableList : fixedListSongs });
        
        // Display the "maxed out" state
        if (simScope === 'b30_only') {
          setSimulatedB30Songs(maxedVariableList);
          setSimulatedNew20Songs(fixedListSongs); // N20 is fixed
          setSimulatedAverageB30Rating(avgVariableAtMax);
          setSimulatedAverageNew20Rating(n20AvgForFixed);
        } else { // n20_only
          setSimulatedB30Songs(fixedListSongs); // B30 is fixed
          setSimulatedNew20Songs(maxedVariableList);
          setSimulatedAverageB30Rating(b30AvgForFixed);
          setSimulatedAverageNew20Rating(avgVariableAtMax);
        }
        setFinalOverallSimulatedRating(reachableRating);
        setIsSimulating(false);
        return;
      }
    }
    // --- End Pre-calculation ---


    const runSimulationAsync = async () => {
      if (isSimulating && !strategyJustChanged) {
        console.log("[SIM_STRATEGY_EFFECT] Simulation already in progress for the current strategy, skipping new run.");
        return;
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
        simulationScope: simScope,
        improvementMethod: improveMethod,
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
        } else if (result.unreachableMessage && result.reachableRating !== undefined) {
            // This path might be hit if simulation itself determines unreachable (e.g. stuck_both)
            setErrorLoadingData(result.unreachableMessage);
            setCurrentPhase(result.finalPhase); 
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
    currentRatingDisplay, targetRatingDisplay
  ]);


  useEffect(() => {
    console.log("[COMBINED_SONGS_EFFECT] Updating combinedTopSongs. isLoadingInitialData:", isLoadingInitialData, "isSimulating:", isSimulating);
    console.log("[COMBINED_SONGS_EFFECT] Current simulatedB30Songs count:", simulatedB30Songs.length, "Current simulatedNew20Songs count:", simulatedNew20Songs.length);

    if (isLoadingInitialData || isSimulating) {
      // console.log("[COMBINED_SONGS_EFFECT] isLoadingInitialData or isSimulating is true. Setting combinedTopSongs to [].");
      // setCombinedTopSongs([]); // Avoid clearing if simulation is running, let it update once done.
      return;
    }
    
    let baseB30: Song[];
    let baseN20: Song[];

    if (preComputationResult && currentPhase === 'target_unreachable') {
        baseB30 = preComputationResult.theoreticalMaxSongsB30 || [];
        baseN20 = preComputationResult.theoreticalMaxSongsN20 || [];
        console.log(`[COMBINED_SONGS_EFFECT] Using preComputationResult for combined. B30: ${baseB30.length}, N20: ${baseN20.length}`);
    } else {
        baseB30 = simulatedB30Songs.length > 0
            ? simulatedB30Songs
            : originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));

        baseN20 = simulatedNew20Songs.length > 0
            ? simulatedNew20Songs
            : originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
        console.log(`[COMBINED_SONGS_EFFECT] Using simulated or original data. B30: ${baseB30.length}, N20: ${baseN20.length}`);
    }


    if (baseB30.length > 0 || baseN20.length > 0) {
      const songMap = new Map<string, Song & { displayRating: number }>();

      const songsToCombineB30 = baseB30.map(song => ({ ...song, displayRating: song.targetRating }));
      songsToCombineB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, { ...song }));
      // console.log(`[COMBINED_SONGS_EFFECT] songMap after B30 processing. Size: ${songMap.size}`);

      const songsToCombineN20 = baseN20.map(song => ({ ...song, displayRating: song.targetRating }));
      songsToCombineN20.forEach(song => {
        const key = `${song.id}_${song.diff}`;
        const new20EffectiveRating = song.targetRating; // Use targetRating as displayRating is derived from it.
        const existingEntry = songMap.get(key);
        if (!existingEntry || new20EffectiveRating > existingEntry.displayRating) {
          songMap.set(key, { ...song, displayRating: new20EffectiveRating });
        }
      });
      // console.log(`[COMBINED_SONGS_EFFECT] songMap after N20 processing. Size: ${songMap.size}`);

      const combinedAndSorted = Array.from(songMap.values()).sort((a, b) =>
        b.displayRating - a.displayRating
      );
      setCombinedTopSongs(combinedAndSorted);
      // console.log(`[COMBINED_SONGS_EFFECT] CombinedTopSongs updated. Count: ${combinedAndSorted.length}`);
    } else {
      setCombinedTopSongs([]);
      // console.log("[COMBINED_SONGS_EFFECT] No base B30 or N20 data. Setting combinedTopSongs to [].");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
      simulatedB30Songs, simulatedNew20Songs,
      originalB30SongsData, originalNew20SongsData,
      isLoadingInitialData, isSimulating, preComputationResult, currentPhase // Added preComputationResult and currentPhase
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
    preComputationResult, 
  };
}
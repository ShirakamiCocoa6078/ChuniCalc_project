
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import constOverridesInternal from '@/data/const-overrides.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateAverageAndOverallRating, calculateTheoreticalMaxRatingsForList, calculateChunithmSongRating } from '@/lib/rating-utils'; // Updated import
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
const MAX_SCORE_NORMAL = 1009000;


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

  const prevCalculationStrategyRef = useRef<CalculationStrategy>(calculationStrategy);


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
       setUserPlayHistory(tempUserShowallRecords);


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
            let fetchedGlobalMusicApiForCache: any[] | undefined = undefined;
            let fetchedUserShowallForCache: UserShowallApiResponse | undefined = undefined;


            for (const res of responses) {
              if (!res.ok) { const errorMsg = `${res.type} data API failed (status: ${res.status}): ${res.data?.error?.message || res.error || 'Unknown API error'}`; if (!criticalError) criticalError = errorMsg; console.error(`[DATA_FETCH_API_ERROR] ${errorMsg}`); continue; }

              if (res.type === 'profile' && !profileData) { setApiPlayerName(res.data.player_name || userNameForApi); setCachedData<ProfileData>(profileKey, res.data); profileData = res.data; }
              if (res.type === 'rating' && !ratingData) { setCachedData<RatingApiResponse>(ratingDataKey, res.data); ratingData = res.data; }
              if (res.type === 'globalMusic' && (!globalMusicCacheRaw || tempFlattenedGlobalMusicRecords.length === 0)) {
                const fetchedGlobalMusicRaw = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                fetchedGlobalMusicApiForCache = fetchedGlobalMusicRaw;
                tempFlattenedGlobalMusicRecords = [];
                fetchedGlobalMusicRaw.forEach(rawEntry => { tempFlattenedGlobalMusicRecords.push(...flattenGlobalMusicEntry(rawEntry)); });
                console.log(`[DATA_FETCH_HOOK] Fetched and set ${tempFlattenedGlobalMusicRecords.length} flattened global music entries from API.`);
              }
              if (res.type === 'userShowall' && (!userShowallCache || tempUserShowallRecords.length === 0)) {
                const records = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                fetchedUserShowallForCache = { records };
                tempUserShowallRecords = records.filter((e: any): e is ShowallApiSongEntry => e && typeof e.id === 'string' && typeof e.diff === 'string');
                setUserPlayHistory(tempUserShowallRecords); // Update state here as well
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
    const strategyChanged = prevCalculationStrategyRef.current !== calculationStrategy;
    prevCalculationStrategyRef.current = calculationStrategy;

    console.log(`[SIM_STRATEGY_EFFECT] Running. Strategy: ${calculationStrategy}, Prev Ref: ${prevCalculationStrategyRef.current}, ActualChange: ${strategyChanged} isLoading: ${isLoadingInitialData}, OriginalB30Count: ${originalB30SongsData.length}, currentPhase: ${currentPhase}`);

    if (isLoadingInitialData || !clientHasMounted) {
      console.log("[SIM_STRATEGY_EFFECT] Waiting for initial data or client mount.");
      return;
    }

    setPreSimulationMessage(null);
    setErrorLoadingData(null);

    const currentRatingNum = parseFloat(currentRatingDisplay || "0");
    const targetRatingNum = parseFloat(targetRatingDisplay || "0");

    if (isNaN(currentRatingNum) || isNaN(targetRatingNum)) {
      setErrorLoadingData(getTranslation(locale, 'resultPageErrorInvalidRatingsInput'));
      setCurrentPhase('error_data_fetch');
      return;
    }

    let simScope: SimulationInput['simulationScope'] = 'combined';
    let improveMethod: SimulationInput['improvementMethod'] = 'floor'; // Default for focused modes unless specified

    if (calculationStrategy === 'b30_focus') {
      simScope = 'b30_only';
      improveMethod = 'floor'; // Or some default for b30_focus
    } else if (calculationStrategy === 'n20_focus') {
      simScope = 'n20_only';
      improveMethod = 'floor'; // Or some default for n20_focus
    } else if (calculationStrategy === 'combined_floor') {
      simScope = 'combined';
      improveMethod = 'floor';
    } else if (calculationStrategy === 'combined_peak') {
      simScope = 'combined';
      improveMethod = 'peak';
    } else if (calculationStrategy === 'none' || calculationStrategy === null) {
      console.log("[SIM_STRATEGY_EFFECT] No strategy selected. Displaying original data.");
      const initialDisplayB30 = originalB30SongsData.map(s_1 => ({ ...s_1, targetScore: s_1.currentScore, targetRating: s_1.currentRating }));
      const initialDisplayN20 = originalNew20SongsData.map(s_2 => ({ ...s_2, targetScore: s_2.currentScore, targetRating: s_2.currentRating }));
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

    // Pre-calculation for focused modes
    if (simScope === 'b30_only' || simScope === 'n20_only') {
      let fixedListRatingSum = 0;
      let fixedListCount = 0;
      let variableListCandidatePool: (Song | ShowallApiSongEntry)[] = [];
      let variableListLimit = 0;
      let messageKey: keyof ReturnType<typeof getTranslation>['KR'] = 'resultPageErrorSimulationGeneric';
      let preCalcPhase: SimulationPhase = 'idle';

      let currentB30ForPreCalc = originalB30SongsData.map(s => ({...s, ratingToUse: s.currentRating}));
      let currentN20ForPreCalc = originalNew20SongsData.map(s => ({...s, ratingToUse: s.currentRating}));
      
      let fixedB30AvgForPreCalc = calculateAverageAndOverallRating(currentB30ForPreCalc, BEST_COUNT, 'ratingToUse').average;
      let fixedN20AvgForPreCalc = calculateAverageAndOverallRating(currentN20ForPreCalc, NEW_20_COUNT, 'ratingToUse').average;

      if (simScope === 'b30_only') {
        messageKey = 'reachableRatingB30OnlyMessage';
        preCalcPhase = 'target_unreachable_b30_fixed_n20';
        fixedListRatingSum = (fixedN20AvgForPreCalc || 0) * Math.min(NEW_20_COUNT, currentN20ForPreCalc.length);
        fixedListCount = Math.min(NEW_20_COUNT, currentN20ForPreCalc.length);

        const b30PreCalcPool = allMusicData.filter(ms => {
            const isNewSong = NewSongsData.titles.verse.some(title => title.trim().toLowerCase() === ms.title.trim().toLowerCase());
            const isInFixedN20 = originalNew20SongsData.some(n20s => n20s.id === ms.id && n20s.diff.toUpperCase() === ms.diff.toUpperCase());
            return !isNewSong && !isInFixedN20; // B30 candidates are non-new songs not in fixed N20
        });
        variableListCandidatePool = [...originalB30SongsData, ...b30PreCalcPool]; // Include current B30 as potential candidates
        variableListLimit = BEST_COUNT;

      } else { // n20_only
        messageKey = 'reachableRatingN20OnlyMessage';
        preCalcPhase = 'target_unreachable_n20_fixed_b30';
        fixedListRatingSum = (fixedB30AvgForPreCalc || 0) * Math.min(BEST_COUNT, currentB30ForPreCalc.length);
        fixedListCount = Math.min(BEST_COUNT, currentB30ForPreCalc.length);

        variableListCandidatePool = allPlayedNewSongsPool.filter(pns =>
            !originalB30SongsData.some(b30s => b30s.id === pns.id && b30s.diff === pns.diff)
        ); // N20 candidates are played new songs not in fixed B30
        variableListLimit = NEW_20_COUNT;
      }

      const { list: maxedVariableList, average: avgVariableAtMax, sum: sumVariableAtMax } =
        calculateTheoreticalMaxRatingsForList(variableListCandidatePool, variableListLimit, MAX_SCORE_NORMAL);

      const totalRatingSumAtMax = fixedListRatingSum + sumVariableAtMax;
      const totalEffectiveSongsAtMax = fixedListCount + maxedVariableList.length;
      const reachableRating = totalEffectiveSongsAtMax > 0 ? parseFloat((totalRatingSumAtMax / totalEffectiveSongsAtMax).toFixed(4)) : 0;

      if (targetRatingNum > reachableRating) {
        setPreSimulationMessage(getTranslation(locale, messageKey, reachableRating.toFixed(4)));
        setCurrentPhase(preCalcPhase);
        // Display the "maxed out" song lists for this scenario
        if (simScope === 'b30_only') {
          setSimulatedB30Songs(maxedVariableList); // These are the theoretically maxed B30
          setSimulatedNew20Songs(originalNew20SongsData.map(s_3 => ({ ...s_3, targetScore: s_3.currentScore, targetRating: s_3.currentRating }))); // N20 is fixed
          setSimulatedAverageB30Rating(avgVariableAtMax);
          setSimulatedAverageNew20Rating(fixedN20AvgForPreCalc);
        } else { // n20_only
          setSimulatedB30Songs(originalB30SongsData.map(s_4 => ({ ...s_4, targetScore: s_4.currentScore, targetRating: s_4.currentRating }))); // B30 is fixed
          setSimulatedNew20Songs(maxedVariableList); // These are the theoretically maxed N20
          setSimulatedAverageB30Rating(fixedB30AvgForPreCalc);
          setSimulatedAverageNew20Rating(avgVariableAtMax);
        }
        setFinalOverallSimulatedRating(reachableRating);
        setIsSimulating(false);
        return;
      }
    }


    const runSimulationAsync = async () => {
      if (isSimulating && !strategyChanged) {
        console.log("[SIM_STRATEGY_EFFECT] Simulation already in progress for the current strategy, skipping new run.");
        return;
      }
      if (isSimulating && strategyChanged) {
          console.warn("[SIM_STRATEGY_EFFECT] Strategy changed while a simulation was (conceptually) in progress. Proceeding with new strategy.");
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
        isScoreLimitReleased: (targetRatingNum - currentRatingNum) * 50 > 10, // Example threshold
        phaseTransitionPoint: parseFloat((currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95).toFixed(4)), // Example
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
        setCurrentPhase(result.finalPhase); // This should come from simulation result
        setSimulationLog(prev => [...prev, ...result.simulationLog, `Simulation Ended. Final Phase: ${result.finalPhase}`]);

        if (result.error) {
          setErrorLoadingData(getTranslation(locale, 'resultPageErrorSimulationGeneric', result.error));
          setCurrentPhase('error_simulation_logic');
        } else if (result.unreachableMessage && result.reachableRating !== undefined) {
            // This path might be hit if simulation itself determines unreachable (e.g. stuck_both)
            // but pre-calc should catch most target_unreachable cases for focused modes.
            setPreSimulationMessage(result.unreachableMessage); // Or set errorLoadingData
            setCurrentPhase(result.finalPhase); // e.g. target_unreachable_b30_fixed_n20
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
      console.log("[COMBINED_SONGS_EFFECT] isLoadingInitialData or isSimulating is true. Setting combinedTopSongs to [].");
      setCombinedTopSongs([]);
      return;
    }

    const baseB30 = simulatedB30Songs.length > 0
        ? simulatedB30Songs
        : originalB30SongsData.map(s_5 => ({ ...s_5, targetScore: s_5.currentScore, targetRating: s_5.currentRating }));

    const baseN20 = simulatedNew20Songs.length > 0
        ? simulatedNew20Songs
        : originalNew20SongsData.map(s_6 => ({ ...s_6, targetScore: s_6.currentScore, targetRating: s_6.currentRating }));

    console.log(`[COMBINED_SONGS_EFFECT] Using baseB30 count: ${baseB30.length}, baseN20 count: ${baseN20.length}`);

    if (baseB30.length > 0 || baseN20.length > 0) {
      const songMap = new Map<string, Song & { displayRating: number }>();

      const songsToCombineB30 = baseB30.map(song => ({ ...song, displayRating: song.targetRating }));
      songsToCombineB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, { ...song }));
      console.log(`[COMBINED_SONGS_EFFECT] songMap after B30 processing. Size: ${songMap.size}`);

      const songsToCombineN20 = baseN20.map(song => ({ ...song, displayRating: song.targetRating }));
      songsToCombineN20.forEach(song => {
        const key = `${song.id}_${song.diff}`;
        const new20EffectiveRating = song.displayRating;
        const existingEntry = songMap.get(key);
        if (!existingEntry || new20EffectiveRating > existingEntry.displayRating) {
          songMap.set(key, { ...song });
        }
      });
      console.log(`[COMBINED_SONGS_EFFECT] songMap after N20 processing. Size: ${songMap.size}`);

      const combinedAndSorted = Array.from(songMap.values()).sort((a, b) =>
        b.displayRating - a.displayRating
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


  return {
    apiPlayerName,
    best30SongsData: simulatedB30Songs,
    new20SongsData: simulatedNew20Songs,
    combinedTopSongs,
    isLoadingSongs: isLoadingInitialData || isSimulating,
    errorLoadingSongs: errorLoadingData || preSimulationMessage,
    lastRefreshed,
    currentPhase,
    simulatedAverageB30Rating,
    simulatedAverageNew20Rating,
    finalOverallSimulatedRating,
    simulationLog,
    preSimulationMessage,
  };
}


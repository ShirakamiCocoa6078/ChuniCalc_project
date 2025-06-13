
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS, SIMULATION_CACHE_EXPIRY_MS, type CachedData } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateChunithmSongRating, getNextGradeBoundaryScore, findMinScoreForTargetRating } from '@/lib/rating-utils';
import type { Song, ProfileData, RatingApiResponse, GlobalMusicApiResponse, UserShowallApiResponse, ShowallApiSongEntry, RatingApiSongEntry, CalculationStrategy, SimulationPhase, CachedSimulationResult } from "@/types/result-page";

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;

const getSimulationCacheKey = (
  userName: string | null,
  currentRating: string | null,
  targetRating: string | null,
  strategy: CalculationStrategy | null
): string | null => {
  if (!userName || !currentRating || !targetRating || !strategy) return null;
  const normCurrent = parseFloat(currentRating).toFixed(2);
  const normTarget = parseFloat(targetRating).toFixed(2);
  return `${LOCAL_STORAGE_PREFIX}simulation_${userName}_${normCurrent}_${normTarget}_${strategy}`;
};

// Helper function to flatten raw global music entries
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

// Helper: Check if a song is considered "high constant" for the floor strategy
const isSongHighConstantForFloor = (song: Song, currentOverallRating: number | null): boolean => {
  if (!song.chartConstant || currentOverallRating === null) return false;
  // 현재 B30 평균값 - 1.8 을 하고, 그 결과값에 대해 소수점 한자리만 남긴 값 (버림)
  const thresholdBase = currentOverallRating - 1.8;
  const threshold = Math.floor(thresholdBase * 10) / 10; // 소수점 첫째 자리까지 버림
  return song.chartConstant > threshold;
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
  const [originalB30SongsData, setOriginalB30SongsData] = useState<Song[]>([]);
  const [new20SongsData, setNew20SongsData] = useState<Song[]>([]);
  const [combinedTopSongs, setCombinedTopSongs] = useState<Song[]>([]);

  const [isLoadingSongs, setIsLoadingSongs] = useState(true);
  const [errorLoadingSongs, setErrorLoadingSongs] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const [isScoreLimitReleased, setIsScoreLimitReleased] = useState(false); 
  const [phaseTransitionPoint, setPhaseTransitionPoint] = useState<number | null>(null); 
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');

  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);
  
  const [sortedPrimaryLeapCandidates, setSortedPrimaryLeapCandidates] = useState<Song[]>([]);
  const [currentLeapProcessingGroup, setCurrentLeapProcessingGroup] = useState<'primary' | 'secondary' | null>(null);

  const [fineTuningCandidateSongs, setFineTuningCandidateSongs] = useState<Song[]>([]); 

  const [allMusicData, setAllMusicData] = useState<ShowallApiSongEntry[]>([]);
  const [userPlayHistory, setUserPlayHistory] = useState<ShowallApiSongEntry[]>([]);
  const [songToReplace, setSongToReplace] = useState<Song | null>(null);
  const [candidateSongsForReplacement, setCandidateSongsForReplacement] = useState<Song[]>([]);
  const [optimalCandidateSong, setOptimalCandidateSong] = useState<Song | null>(null);
  
  const prevCalculationStrategyRef = useRef<CalculationStrategy | null>(null);


  useEffect(() => {
    if (clientHasMounted && currentRatingDisplay && targetRatingDisplay) {
      const currentRatingNum = parseFloat(currentRatingDisplay);
      const targetRatingNum = parseFloat(targetRatingDisplay);

      if (!isNaN(currentRatingNum) && isFinite(currentRatingNum) && !isNaN(targetRatingNum) && isFinite(targetRatingNum)) {
        const limitReleaseCondition = (targetRatingNum - currentRatingNum) * 50 > 10;
        setIsScoreLimitReleased(limitReleaseCondition);
        
        const transitionPoint = currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95;
        setPhaseTransitionPoint(parseFloat(transitionPoint.toFixed(4)));
      } else {
        setIsScoreLimitReleased(false);
        setPhaseTransitionPoint(null);
      }
    }
  }, [clientHasMounted, currentRatingDisplay, targetRatingDisplay]);

  useEffect(() => {
    const fetchAndProcessData = async () => {
      console.log("[DATA_FETCH] Starting fetchAndProcessData...");
      const defaultPlayerName = getTranslation(locale, 'resultPageDefaultPlayerName');
      const API_TOKEN = getApiToken();

      if (!API_TOKEN) { setErrorLoadingSongs(getTranslation(locale, 'resultPageErrorApiTokenNotSetResult')); setIsLoadingSongs(false); return; }
      if (!userNameForApi || userNameForApi === defaultPlayerName) { setErrorLoadingSongs(getTranslation(locale, 'resultPageErrorNicknameNotProvidedResult')); setApiPlayerName(defaultPlayerName); setIsLoadingSongs(false); return; }

      setIsLoadingSongs(true); setErrorLoadingSongs(null); setApiPlayerName(userNameForApi); 
      setOriginalB30SongsData([]); setNew20SongsData([]); setCombinedTopSongs([]); 

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
      
      let flattenedGlobalMusicRecords: ShowallApiSongEntry[] = [];
      if (globalMusicCacheRaw) {
          console.log(`[DATA_FETCH] Global music cache found. Count: ${globalMusicCacheRaw.length}. Sample:`, globalMusicCacheRaw.slice(0,1));
          if (globalMusicCacheRaw.length > 0 && globalMusicCacheRaw[0]?.meta && globalMusicCacheRaw[0]?.data) {
              console.log("[DATA_FETCH] Global music cache seems raw (nested meta/data). Flattening...");
              flattenedGlobalMusicRecords = globalMusicCacheRaw.reduce((acc, entry) => acc.concat(flattenGlobalMusicEntry(entry)), [] as ShowallApiSongEntry[]);
          } else {
              console.log("[DATA_FETCH] Global music cache seems already flat or is not nested.");
              flattenedGlobalMusicRecords = globalMusicCacheRaw as ShowallApiSongEntry[];
          }
      }
      setAllMusicData(flattenedGlobalMusicRecords); // Set state early if cache exists

      let tempUserShowallRecords: ShowallApiSongEntry[] = userShowallCache?.records || [];
      setUserPlayHistory(tempUserShowallRecords); // Set state early if cache exists

      console.log(`[DATA_FETCH] Cache status - Profile: ${!!profileData}, Rating: ${!!ratingData}, GlobalMusic (after potential flattening): ${flattenedGlobalMusicRecords.length}, UserShowall: ${tempUserShowallRecords.length}`);

      let initialB30ApiEntries: RatingApiSongEntry[] = [];
      if (ratingData?.best?.entries) {
        initialB30ApiEntries = ratingData.best.entries.filter((e: any): e is RatingApiSongEntry => e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && typeof e.title === 'string' && e.title.trim() !== '') || [];
      }
      
      if (!profileData || !ratingData || !globalMusicCacheRaw || !userShowallCache) {
        console.log("[DATA_FETCH] Cache miss for one or more items. Fetching from API.");
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
              if (res.type === 'rating' && !ratingData) {
                initialB30ApiEntries = res.data.best?.entries?.filter((e: any): e is RatingApiSongEntry => e && e.id && typeof e.id === 'string' && e.id.trim() !== '' && e.diff && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && e.title && typeof e.title === 'string' && e.title.trim() !== '') || [];
                setCachedData<RatingApiResponse>(ratingDataKey, res.data);
                ratingData = res.data; 
              }
              if (res.type === 'globalMusic' && !globalMusicCacheRaw) {
                const fetchedGlobalMusicRaw = Array.isArray(res.data) ? res.data : (res.data?.records || []); 
                const justFetchedFlattenedGlobal = fetchedGlobalMusicRaw.reduce((acc, entry) => acc.concat(flattenGlobalMusicEntry(entry)), [] as ShowallApiSongEntry[]);
                console.log(`[DATA_FETCH_API] Fetched and flattened global music: ${justFetchedFlattenedGlobal.length} entries.`);
                setAllMusicData(justFetchedFlattenedGlobal); 
                setCachedData<ShowallApiSongEntry[]>(globalMusicKey, justFetchedFlattenedGlobal, GLOBAL_MUSIC_CACHE_EXPIRY_MS); 
                flattenedGlobalMusicRecords = justFetchedFlattenedGlobal; // Update main variable too
              }
              if (res.type === 'userShowall' && !userShowallCache) {
                const fetchedUserShowallRecords = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                setUserPlayHistory(fetchedUserShowallRecords);
                setCachedData<UserShowallApiResponse>(userShowallKey, { records: fetchedUserShowallRecords });
                userShowallCache = { records: fetchedUserShowallRecords };
                tempUserShowallRecords = fetchedUserShowallRecords; // Update main variable
              }
            }
            if (criticalError) throw new Error(criticalError);
            const newCacheTime = new Date().toLocaleString(locale);
            setLastRefreshed(getTranslation(locale, 'resultPageSyncStatus', newCacheTime));
            if (responses.some(res => res.ok)) toast({ title: getTranslation(locale, 'resultPageToastApiLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastApiLoadSuccessDesc', newCacheTime) });
          } catch (error) {
            let detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', "Unknown error");
            if (error instanceof Error) detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', error.message);
            setErrorLoadingSongs(detailedErrorMessage); console.error("[DATA_FETCH_API_CATCH_ERROR]", error);
            if (!apiPlayerName && userNameForApi !== defaultPlayerName) setApiPlayerName(userNameForApi);
          }
        }
      } else {
        console.log("[DATA_FETCH] All data loaded from cache.");
        // Ensure allMusicData and userPlayHistory are set from potentially already processed cache
        if (flattenedGlobalMusicRecords.length > 0 && allMusicData.length === 0) {
            setAllMusicData(flattenedGlobalMusicRecords);
            console.log(`[DATA_FETCH] Set allMusicData from processed cache: ${flattenedGlobalMusicRecords.length}`);
        }
        if (tempUserShowallRecords.length > 0 && userPlayHistory.length === 0) {
            setUserPlayHistory(tempUserShowallRecords);
            console.log(`[DATA_FETCH] Set userPlayHistory from processed cache: ${tempUserShowallRecords.length}`);
        }
        toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
      }

      const mappedOriginalB30 = sortSongsByRatingDesc(initialB30ApiEntries.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
      setOriginalB30SongsData(mappedOriginalB30);
      console.log(`[DATA_FETCH] Original B30 songs mapped: ${mappedOriginalB30.length}`);
      
      if (flattenedGlobalMusicRecords.length > 0 && tempUserShowallRecords.length > 0) {
        console.log("[NEW20_PROCESS] Starting New20 processing.");
        const newSongTitlesRaw = NewSongsData.titles?.verse || [];
        const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());
        console.log(`[NEW20_PROCESS] Titles from NewSongs.json: ${newSongTitlesToMatch.length}`);

        const newSongDefinitions = flattenedGlobalMusicRecords.filter(globalSong => 
          globalSong.title && newSongTitlesToMatch.includes(globalSong.title.trim().toLowerCase())
        );
        console.log(`[NEW20_PROCESS] Matched new song definitions from global music: ${newSongDefinitions.length}`);

        const userPlayedMap = new Map<string, ShowallApiSongEntry>();
        tempUserShowallRecords.forEach(usrSong => {
          if (usrSong.id && usrSong.diff) userPlayedMap.set(`${usrSong.id}_${usrSong.diff.toUpperCase()}`, usrSong);
        });
        console.log(`[NEW20_PROCESS] User played map created with ${userPlayedMap.size} entries.`);

        const playedNewSongsApi = newSongDefinitions.reduce((acc, newSongDef) => {
          const userPlayRecord = userPlayedMap.get(`${newSongDef.id}_${newSongDef.diff.toUpperCase()}`);
          if (userPlayRecord && typeof userPlayRecord.score === 'number' && userPlayRecord.score >= 800000) {
            acc.push({ 
              ...newSongDef, 
              score: userPlayRecord.score, 
              is_played: true, 
              is_clear: userPlayRecord.is_clear, 
              is_fullcombo: userPlayRecord.is_fullcombo, 
              is_alljustice: userPlayRecord.is_alljustice,
            });
          }
          return acc;
        }, [] as ShowallApiSongEntry[]);
        console.log(`[NEW20_PROCESS] Filtered played new songs (score >= 800k): ${playedNewSongsApi.length}`);

        const sortedNewSongsFull = sortSongsByRatingDesc(playedNewSongsApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
        const finalNew20 = sortedNewSongsFull.slice(0, NEW_20_COUNT);
        setNew20SongsData(finalNew20);
        console.log(`[NEW20_PROCESS] Final New20 songs processed (top ${NEW_20_COUNT}): ${finalNew20.length}`);
        if(finalNew20.length === 0 && newSongDefinitions.length > 0 && tempUserShowallRecords.length > 0) {
            console.warn("[NEW20_PROCESS_WARN] No New20 songs after filtering by play history, despite having definitions and play history. Check score >= 800k filter or matching logic.");
        }

      } else { 
        setNew20SongsData([]); 
        console.log("[NEW20_PROCESS] Skipped New20 processing due to missing global music or user showall data.");
      }
      setIsLoadingSongs(false);
      console.log("[DATA_FETCH] fetchAndProcessData finished.");
    };

    if (clientHasMounted) fetchAndProcessData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNameForApi, refreshNonce, clientHasMounted, locale]); 

  useEffect(() => {
    const prevStrategy = prevCalculationStrategyRef.current;
    const currentStrat = calculationStrategy;
    const actualStrategyChanged = prevStrategy !== currentStrat;

    console.log(`[SIM_STRATEGY_EFFECT] Running. Strategy: ${currentStrat}, Prev: ${prevStrategy}, ActualChange: ${actualStrategyChanged}, isLoading: ${isLoadingSongs}, OriginalB30Count: ${originalB30SongsData.length}, currentPhase: ${currentPhase}`);

    if (isLoadingSongs && !actualStrategyChanged) { 
        console.log("[SIM_STRATEGY_EFFECT] Data still loading and strategy unchanged. Deferring full processing.");
        return;
    }
    
    if (actualStrategyChanged) {
        console.log(`[SIM_STRATEGY_EFFECT] Strategy changed from ${prevStrategy} to ${currentStrat}. Resetting simulation states.`);
        setSortedPrimaryLeapCandidates([]);
        setCurrentLeapProcessingGroup(null);
        setFineTuningCandidateSongs([]);
        setSongToReplace(null);
        setCandidateSongsForReplacement([]);
        setOptimalCandidateSong(null);
        
        if (originalB30SongsData.length > 0) {
          setSimulatedB30Songs(originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})));
          console.log("[SIM_STRATEGY_EFFECT] SimulatedB30Songs reset from original due to strategy change.");
        } else {
          setSimulatedB30Songs([]); 
          console.log("[SIM_STRATEGY_EFFECT] OriginalB30SongsData is empty, SimulatedB30Songs set to empty.");
        }
        setCurrentPhase('idle'); 
    }
    
    if (!isLoadingSongs && currentStrat) {
        const simCacheKey = getSimulationCacheKey(userNameForApi, currentRatingDisplay, targetRatingDisplay, currentStrat);
        const ratingDataCacheKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
        const ratingDataCacheItem = clientHasMounted ? localStorage.getItem(ratingDataCacheKey) : null;
        let currentSourceDataTimestamp = 0;
        if (ratingDataCacheItem) { try { currentSourceDataTimestamp = (JSON.parse(ratingDataCacheItem) as CachedData<any>).timestamp; } catch (e) { console.warn("[SIM_CACHE] Failed to parse rating_data timestamp for cache validation.", e); } }

        let cacheHit = false;
        if (simCacheKey && currentSourceDataTimestamp > 0 && clientHasMounted) {
            const cachedSim = getCachedData<CachedSimulationResult>(simCacheKey, SIMULATION_CACHE_EXPIRY_MS);
            if (cachedSim && cachedSim.sourceDataTimestamp === currentSourceDataTimestamp) {
                if (cachedSim.finalPhase === 'error') {
                    console.log(`[SIM_CACHE] Error state cache found for strategy ${currentStrat}. Ignoring and re-simulating.`);
                    // No cacheHit = true, proceed to simulation
                } else {
                    console.log(`[SIM_CACHE] Valid simulation cache found for strategy ${currentStrat}. Loading from cache.`);
                    setSimulatedB30Songs(cachedSim.simulatedB30Songs);
                    setSimulatedAverageB30Rating(cachedSim.simulatedAverageB30Rating);
                    setCurrentPhase(cachedSim.finalPhase); 
                    if (!lastRefreshed?.includes(new Date(currentSourceDataTimestamp).toLocaleString(locale))) {
                      setLastRefreshed(getTranslation(locale, 'resultPageSyncStatus', new Date(currentSourceDataTimestamp).toLocaleString(locale)) + " (Sim Cache)");
                    }
                    cacheHit = true;
                }
            } else if (cachedSim) {
                console.log(`[SIM_CACHE] Stale simulation cache for ${currentStrat} (source data timestamp mismatch). Will re-simulate.`);
            } else {
                console.log(`[SIM_CACHE] No simulation cache found for strategy ${currentStrat}. Will simulate.`);
            }
        } else if (simCacheKey && clientHasMounted) {
             console.log(`[SIM_CACHE] Cannot validate simulation cache for ${currentStrat} (missing source data timestamp or not client mounted for localStorage). Will simulate.`);
        }
        
        if (!cacheHit) {
            if (simulatedB30Songs.length === 0 && originalB30SongsData.length > 0) {
                 setSimulatedB30Songs(originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})));
                 console.log("[SIM_STRATEGY_EFFECT] SimulatedB30Songs was empty but original data exists. Resetting for new simulation.");
            } else if (actualStrategyChanged && originalB30SongsData.length > 0){
                 setSimulatedB30Songs(originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})));
                 console.log("[SIM_STRATEGY_EFFECT] Double check: SimulatedB30Songs reset for new simulation after strategy change.");
            }

            console.log(`[SIM_STRATEGY_EFFECT] Strategy '${currentStrat}' selected. Cache miss or error cache ignored. Starting/Continuing new simulation. CurrentPhase: ${currentPhase}`);
            const currentRatingNum = parseFloat(currentRatingDisplay || "0");
            const targetRatingNum = parseFloat(targetRatingDisplay || "0");

            if (currentRatingNum < targetRatingNum && originalB30SongsData.length > 0) {
                if (currentPhase === 'idle' || actualStrategyChanged) { 
                    console.log(`[SIM_STRATEGY_EFFECT] Setting phase to initializing_leap_phase. CurrentPhase was: ${currentPhase}, ActualChange: ${actualStrategyChanged}`);
                    setCurrentPhase('initializing_leap_phase');
                } else {
                    console.log(`[SIM_STRATEGY_EFFECT] Strategy active, phase is ${currentPhase}, not resetting phase from here.`);
                }
            } else {
                console.log(`[SIM_STRATEGY_EFFECT] Target not higher than current, or no originalB30. Setting phase to idle.`);
                setCurrentPhase('idle');
            }
        }
    } else if (!currentStrat) { 
        console.log("[SIM_STRATEGY_EFFECT] Strategy deselected (null). Phase set to Idle. Resetting simB30 from original.");
        if (originalB30SongsData.length > 0) {
             setSimulatedB30Songs(originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})));
        } else {
             setSimulatedB30Songs([]);
        }
        setCurrentPhase('idle');
    }

    if (actualStrategyChanged) {
        prevCalculationStrategyRef.current = currentStrat;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculationStrategy, isLoadingSongs, originalB30SongsData, userNameForApi, currentRatingDisplay, targetRatingDisplay, clientHasMounted, locale, refreshNonce]);


  useEffect(() => {
    if (!isLoadingSongs) {
      const baseB30ForCombined = simulatedB30Songs.length > 0 ? simulatedB30Songs : originalB30SongsData;
      if (baseB30ForCombined.length > 0 || new20SongsData.length > 0) {
        const songMap = new Map<string, Song>();
        
        const songsToCombine = baseB30ForCombined.map(s => ({
          ...s,
          currentRating: s.targetRating, 
        }));

        songsToCombine.forEach(song => songMap.set(`${song.id}_${song.diff}`, { ...song }));
        
        new20SongsData.forEach(song => { 
            const key = `${song.id}_${song.diff}`; 
            const new20EffectiveRating = song.targetRating; 
            if (!songMap.has(key) || (songMap.has(key) && new20EffectiveRating > songMap.get(key)!.currentRating)) {
                songMap.set(key, { ...song, currentRating: new20EffectiveRating }); 
            }
        });
        setCombinedTopSongs(sortSongsByRatingDesc(Array.from(songMap.values())));
      } else { setCombinedTopSongs([]); }
    }
  }, [originalB30SongsData, new20SongsData, simulatedB30Songs, isLoadingSongs]);

  useEffect(() => {
    if (simulatedB30Songs.length > 0) {
      const topSongsForAvg = sortSongsByRatingDesc([...simulatedB30Songs].map(s => ({...s, currentRating: s.targetRating}))).slice(0, BEST_COUNT);
      const newAverage = topSongsForAvg.length > 0 ? topSongsForAvg.reduce((sum, s) => sum + s.targetRating, 0) / topSongsForAvg.length : 0;
      const newAverageFixed = parseFloat(newAverage.toFixed(4));
      setSimulatedAverageB30Rating(newAverageFixed);
      console.log(`[SIM_AVG_RATING_UPDATE] Calculated new average B30 rating: ${newAverageFixed} from ${topSongsForAvg.length} songs. Top song tR: ${topSongsForAvg[0]?.targetRating.toFixed(4)}`);
    } else if (originalB30SongsData.length > 0 && !isLoadingSongs) { 
      const topOriginalSongs = sortSongsByRatingDesc([...originalB30SongsData]).slice(0, BEST_COUNT);
      const originalAverage = topOriginalSongs.length > 0 ? topOriginalSongs.reduce((sum, s) => sum + s.currentRating, 0) / topOriginalSongs.length : 0;
      const originalAverageFixed = parseFloat(originalAverage.toFixed(4));
      setSimulatedAverageB30Rating(originalAverageFixed);
      console.log(`[SIM_AVG_RATING_UPDATE] Initial/fallback average B30 rating from original data: ${originalAverageFixed}`);
    } else {
      setSimulatedAverageB30Rating(null);
      console.log(`[SIM_AVG_RATING_UPDATE] No B30 data to calculate average, setting to null.`);
    }
  }, [simulatedB30Songs, originalB30SongsData, isLoadingSongs]);

  useEffect(() => {
    if (!isLoadingSongs && calculationStrategy && userNameForApi && currentRatingDisplay && targetRatingDisplay &&
        (currentPhase === 'target_reached' || currentPhase === 'stuck_awaiting_replacement' || currentPhase === 'error' ||
         (currentPhase === 'idle' && simulatedAverageB30Rating !== null && parseFloat(currentRatingDisplay || "0") >= parseFloat(targetRatingDisplay || "0"))
        ) && 
        simulatedB30Songs.length > 0) {

      const ratingDataCacheKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
      const ratingDataCacheItem = clientHasMounted ? localStorage.getItem(ratingDataCacheKey) : null;
      let sourceDataTimestamp = 0;
      if (ratingDataCacheItem) {
        try {
          sourceDataTimestamp = (JSON.parse(ratingDataCacheItem) as CachedData<any>).timestamp;
        } catch (e) { console.warn("[SIM_CACHE_SAVE] Could not parse rating_data timestamp for saving.", e); }
      }

      if (sourceDataTimestamp === 0 && originalB30SongsData.length > 0) { 
        console.warn("[SIM_CACHE_SAVE] sourceDataTimestamp is 0, indicating rating_data cache might be missing or unparsable. Skipping simulation cache save to prevent using invalid source association.");
        return;
      }
      
      const simCacheKey = getSimulationCacheKey(userNameForApi, currentRatingDisplay, targetRatingDisplay, calculationStrategy);
      if (simCacheKey) {
        const resultToCache: CachedSimulationResult = {
          timestamp: Date.now(),
          sourceDataTimestamp,
          simulatedB30Songs: simulatedB30Songs,
          simulatedAverageB30Rating: simulatedAverageB30Rating,
          finalPhase: currentPhase,
        };
        console.log(`[SIM_CACHE_SAVE] Saving simulation result to cache for key ${simCacheKey}. Phase: ${currentPhase}, SourceTS: ${sourceDataTimestamp}`);
        setCachedData<CachedSimulationResult>(simCacheKey, resultToCache, SIMULATION_CACHE_EXPIRY_MS);
      }
    }
  }, [currentPhase, calculationStrategy, simulatedB30Songs, simulatedAverageB30Rating, isLoadingSongs, userNameForApi, currentRatingDisplay, targetRatingDisplay, clientHasMounted, originalB30SongsData.length, locale]);


  // --- LEAP PHASE LOGIC ---
  useEffect(() => {
    if (currentPhase === 'initializing_leap_phase' && !isLoadingSongs && simulatedB30Songs.length > 0 && calculationStrategy) {
        console.log(`[SIM_DEBUG_LEAP_INIT] Phase: Initializing Leap. Strategy: ${calculationStrategy}. Full B30 before sort:`, simulatedB30Songs.map(s => ({t:s.title.substring(0,10), id:s.id, d:s.diff, cS:s.currentScore, cR:s.currentRating.toFixed(4), tS:s.targetScore, tR:s.targetRating.toFixed(4), const: s.chartConstant })));
        
        const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;
        const updatableSongs = simulatedB30Songs.filter(song => song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);
        console.log(`[SIM_DEBUG_LEAP_INIT] Updatable songs for Leap (targetScore < ${scoreCap}, valid const): ${updatableSongs.length}`);

        if (updatableSongs.length === 0) {
            console.log("[SIM_DEBUG_LEAP_INIT] No updatable songs with valid const. Moving to stuck/replacement.");
            setCurrentPhase('stuck_awaiting_replacement'); return;
        }

        let sortedAllUpdatable: Song[] = [];
        if (calculationStrategy === 'floor') {
            // "저점" 전략: 악곡 상수 낮은 순 -> 레이팅 낮은 순 -> 점수 낮은 순 (높은 상수곡 후순위 처리 임시 비활성화)
            sortedAllUpdatable = [...updatableSongs].sort((a, b) => {
                 // const aIsHighConst = isSongHighConstantForFloor(a, simulatedAverageB30Rating); // 주석 처리됨
                 // const bIsHighConst = isSongHighConstantForFloor(b, simulatedAverageB30Rating); // 주석 처리됨
                 // if (aIsHighConst !== bIsHighConst) return aIsHighConst ? 1 : -1; // 주석 처리됨
                
                const constA = a.chartConstant ?? Infinity;
                const constB = b.chartConstant ?? Infinity;
                if (constA !== constB) return constA - constB;
                if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating;
                return a.targetScore - b.targetScore;
            });
            console.log(`[SIM_DEBUG_LEAP_INIT] Floor Strategy (No HighConstantRule) - Sorted all updatable: ${sortedAllUpdatable.length}. Sample:`, sortedAllUpdatable.slice(0,3).map(s=>({t:s.title, cnst:s.chartConstant, r:s.targetRating.toFixed(2)})));

        } else if (calculationStrategy === 'peak') {
            // "고점" 전략: (현재는 단순화된 레이팅 높은 순)
             sortedAllUpdatable = [...updatableSongs].sort((a, b) => {
                if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating;
                return b.targetScore - a.targetScore;
            });
            console.log(`[SIM_DEBUG_LEAP_INIT] Peak Strategy - Sorted all updatable by targetRating desc: ${sortedAllUpdatable.length}`);
        }
        
        setSortedPrimaryLeapCandidates(sortedAllUpdatable);
        setCurrentLeapProcessingGroup('primary'); // 항상 primary로 시작 (secondary는 현재 사용 안함)
            
        if (sortedAllUpdatable.length > 0 ) {
            setCurrentPhase('analyzing_leap_efficiency');
        } else if (updatableSongs.length > 0) { 
            console.log("[SIM_DEBUG_LEAP_INIT] Updatable songs exist, but candidate list is empty after sort. This is unexpected. Moving to stuck/replacement.");
            setCurrentPhase('stuck_awaiting_replacement');
        } else {
             console.log("[SIM_DEBUG_LEAP_INIT] No updatable songs for leap phase. Moving to stuck/replacement.");
             setCurrentPhase('stuck_awaiting_replacement');
        }
    }
  }, [currentPhase, isLoadingSongs, simulatedB30Songs, calculationStrategy, isScoreLimitReleased, simulatedAverageB30Rating]);

  useEffect(() => {
    if (currentPhase === 'analyzing_leap_efficiency' && currentLeapProcessingGroup === 'primary') { 
        const candidatesToAnalyze = sortedPrimaryLeapCandidates;
        console.log(`[SIM_DEBUG_LEAP_ANALYZE] Phase: Analyzing Leap Efficiency for primary group. Candidates: ${candidatesToAnalyze.length}`);
        
        if (candidatesToAnalyze.length === 0) {
             console.log("[SIM_DEBUG_LEAP_ANALYZE] No candidates to analyze. Moving to fine-tuning init.");
             setCurrentPhase('initializing_fine_tuning_phase');
             return;
        }
        setCurrentPhase('performing_leap_jump');
    }
  }, [currentPhase, currentLeapProcessingGroup, sortedPrimaryLeapCandidates, calculationStrategy]);

  useEffect(() => {
    if (currentPhase === 'performing_leap_jump' && calculationStrategy && simulatedB30Songs.length > 0) {
        let optimalLeapSong: (Song & { leapEfficiency?: number; scoreToReachNextGrade?: number; ratingAtNextGrade?: number }) | null = null;
        const candidatesToConsider = sortedPrimaryLeapCandidates; 

        if (calculationStrategy === 'floor') {
            console.log(`[SIM_DEBUG_LEAP_PERFORM] Floor Strategy: Attempting leap for top candidate from sorted list. Candidates count: ${candidatesToConsider.length}`);
            if (candidatesToConsider.length > 0) {
                const songToAttemptLeap = candidatesToConsider[0]; // 정렬된 목록의 첫 번째 곡 (가장 낮은 상수 등)
                 const nextGradeScore = getNextGradeBoundaryScore(songToAttemptLeap.targetScore);
                 let leapEfficiency = 0; let scoreToReachNextGrade: number | undefined = undefined; let ratingAtNextGrade: number | undefined = undefined;

                if (songToAttemptLeap.chartConstant && nextGradeScore && songToAttemptLeap.targetScore < nextGradeScore) {
                    const currentSongRating = songToAttemptLeap.targetRating;
                    const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, songToAttemptLeap.chartConstant);
                    const ratingIncrease = potentialRatingAtNextGrade - currentSongRating;
                    const scoreIncrease = nextGradeScore - songToAttemptLeap.targetScore;
                    if (scoreIncrease > 0 && ratingIncrease > 0.00005) leapEfficiency = ratingIncrease / scoreIncrease;
                    scoreToReachNextGrade = nextGradeScore; ratingAtNextGrade = potentialRatingAtNextGrade;
                }

                if (leapEfficiency > 0 && scoreToReachNextGrade && ratingAtNextGrade) {
                    optimalLeapSong = { ...songToAttemptLeap, leapEfficiency, scoreToReachNextGrade, ratingAtNextGrade };
                    console.log(`[SIM_DEBUG_LEAP_PERFORM] Floor Strategy: Valid leap found for ${optimalLeapSong.title}. Eff: ${leapEfficiency.toFixed(4)}`);
                } else {
                    console.log(`[SIM_DEBUG_LEAP_PERFORM] Floor Strategy: Leap not possible or not efficient for ${songToAttemptLeap.title}. Moving to fine-tuning init.`);
                    setCurrentPhase('initializing_fine_tuning_phase'); // 바로 미세조정으로
                    return; 
                }
            } else {
                 console.log(`[SIM_DEBUG_LEAP_PERFORM] Floor Strategy: No candidates in sortedPrimaryLeapCandidates. Moving to fine-tuning init.`);
                 setCurrentPhase('initializing_fine_tuning_phase'); // 바로 미세조정으로
                 return;
            }
        } else if (calculationStrategy === 'peak') {
            const songsWithCalculatedEfficiency = candidatesToConsider.map(song => {
                const nextGradeScore = getNextGradeBoundaryScore(song.targetScore);
                let leapEfficiency = 0; let scoreToReachNextGrade: number | undefined = undefined; let ratingAtNextGrade: number | undefined = undefined;
                if (song.chartConstant && nextGradeScore && song.targetScore < nextGradeScore) {
                    const currentSongRating = song.targetRating;
                    const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, song.chartConstant);
                    const ratingIncrease = potentialRatingAtNextGrade - currentSongRating;
                    const scoreIncrease = nextGradeScore - song.targetScore;
                    if (scoreIncrease > 0 && ratingIncrease > 0.00005) leapEfficiency = ratingIncrease / scoreIncrease;
                    scoreToReachNextGrade = nextGradeScore; ratingAtNextGrade = potentialRatingAtNextGrade;
                }
                return { ...song, leapEfficiency, scoreToReachNextGrade, ratingAtNextGrade };
            }).filter(s => s.leapEfficiency !== undefined && s.leapEfficiency > 0);

            console.log(`[SIM_DEBUG_LEAP_PERFORM] Peak Strategy: Performing Leap Jump. Songs with efficiency: ${songsWithCalculatedEfficiency.length}`);
            if (songsWithCalculatedEfficiency.length > 0) {
                const sortedForLeap = [...songsWithCalculatedEfficiency].sort((a, b) => (b.leapEfficiency || 0) - (a.leapEfficiency || 0));
                optimalLeapSong = sortedForLeap[0];
                console.log("[SIM_DEBUG_LEAP_PERFORM] Peak Strategy: Sorted for leap. Optimal:", optimalLeapSong ? {t:optimalLeapSong.title, eff:optimalLeapSong.leapEfficiency} : "None");
            } else {
                 optimalLeapSong = null; 
            }
        }
        
        if (!optimalLeapSong || typeof optimalLeapSong.scoreToReachNextGrade !== 'number' || typeof optimalLeapSong.ratingAtNextGrade !== 'number') {
            console.log(`[SIM_DEBUG_LEAP_PERFORM] No valid optimal leap song found for ${calculationStrategy}. Moving to fine-tuning init.`);
            setCurrentPhase('initializing_fine_tuning_phase');
            return;
        }
        console.log(`[SIM_DEBUG_LEAP_PERFORM] Optimal leap song chosen: ${optimalLeapSong.title} (${optimalLeapSong.diff}), tS ${optimalLeapSong.scoreToReachNextGrade}, tR ${optimalLeapSong.ratingAtNextGrade.toFixed(4)}`);

        const newSimulatedB30 = simulatedB30Songs.map(song => {
            if (song.id === optimalLeapSong!.id && song.diff === optimalLeapSong!.diff) {
                return {
                    ...song, 
                    targetScore: optimalLeapSong!.scoreToReachNextGrade!,
                    targetRating: parseFloat(optimalLeapSong!.ratingAtNextGrade!.toFixed(4)),
                };
            }
            return song;
        });
        setSimulatedB30Songs(newSimulatedB30); 
        setCurrentPhase('evaluating_leap_result');
    }
  }, [currentPhase, calculationStrategy, simulatedB30Songs, sortedPrimaryLeapCandidates ]);
  
  useEffect(() => {
    if (currentPhase === 'evaluating_leap_result' && simulatedAverageB30Rating !== null && targetRatingDisplay && phaseTransitionPoint !== null) {
      const targetRatingNum = parseFloat(targetRatingDisplay);
      console.log(`[SIM_DEBUG_LEAP_EVAL] Phase: Evaluating Leap. Avg B30: ${simulatedAverageB30Rating.toFixed(4)}, Target: ${targetRatingNum.toFixed(4)}, Transition Pt: ${phaseTransitionPoint.toFixed(4)}`);

      if (simulatedAverageB30Rating >= targetRatingNum) {
        console.log("[SIM_DEBUG_LEAP_EVAL] Target Reached during Leap Phase.");
        setCurrentPhase('target_reached');
      } else if (simulatedAverageB30Rating >= phaseTransitionPoint) {
         console.log("[SIM_DEBUG_LEAP_EVAL] Leap Phase reached transition point. Moving to Fine-Tuning.");
        setCurrentPhase('transitioning_to_fine_tuning');
      } else {
        console.log("[SIM_DEBUG_LEAP_EVAL] Continuing Leap Phase (re-initializing).");
        setCurrentPhase('initializing_leap_phase'); 
      }
    }
  }, [currentPhase, simulatedAverageB30Rating, targetRatingDisplay, phaseTransitionPoint]);

  // --- FINE-TUNING PHASE LOGIC ---
  useEffect(() => {
    if (currentPhase === 'transitioning_to_fine_tuning') {
      setCurrentPhase('initializing_fine_tuning_phase');
    }
  }, [currentPhase]);

  useEffect(() => {
    if (currentPhase === 'initializing_fine_tuning_phase' && !isLoadingSongs && simulatedB30Songs.length > 0 && calculationStrategy) {
        console.log(`[SIM_DEBUG_FINE_INIT] Phase: Initializing Fine-Tuning. Strategy: ${calculationStrategy}`);
        const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;
        const updatableSongs = simulatedB30Songs.filter(song => song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);
        console.log(`[SIM_DEBUG_FINE_INIT] Updatable songs for Fine-Tuning: ${updatableSongs.length}`);

        if (updatableSongs.length === 0) {
            console.log("[SIM_DEBUG_FINE_INIT] No updatable songs for fine-tuning. Moving to stuck/replacement.");
            setCurrentPhase('stuck_awaiting_replacement'); return;
        }
        
        let sortedCandidatesForFineTune: Song[] = [];
        if (calculationStrategy === 'floor') {
            sortedCandidatesForFineTune = [...updatableSongs].sort((a, b) => {
                // const aIsHighConst = isSongHighConstantForFloor(a, simulatedAverageB30Rating); // 주석 처리됨
                // const bIsHighConst = isSongHighConstantForFloor(b, simulatedAverageB30Rating); // 주석 처리됨
                // if (aIsHighConst !== bIsHighConst) return aIsHighConst ? 1 : -1; // 주석 처리됨

                const constA = a.chartConstant ?? Infinity;
                const constB = b.chartConstant ?? Infinity;
                if (constA !== constB) return constA - constB;
                if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating;
                return a.targetScore - b.targetScore;
            });
            console.log(`[SIM_DEBUG_FINE_INIT] Floor Strategy (No HighConstantRule) - Sorted all for fine-tune: ${sortedCandidatesForFineTune.length}. Sample:`, sortedCandidatesForFineTune.slice(0,3).map(s=>({t:s.title, cnst:s.chartConstant, r:s.targetRating.toFixed(2)})));
        } else if (calculationStrategy === 'peak') {
            sortedCandidatesForFineTune = [...updatableSongs].sort((a, b) => {
                if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating; 
                return b.targetScore - a.targetScore;
            });
            console.log(`[SIM_DEBUG_FINE_INIT] Peak Strategy - Sorted all for fine-tune by targetRating desc: ${sortedCandidatesForFineTune.length}`);
        }
        
        setFineTuningCandidateSongs(sortedCandidatesForFineTune);
        
        if (sortedCandidatesForFineTune.length > 0) {
             setCurrentPhase('performing_fine_tuning');
        } else { 
            console.log("[SIM_DEBUG_FINE_INIT] Updatable songs exist, but candidate list for fine-tuning is empty. Moving to stuck/replacement.");
            setCurrentPhase('stuck_awaiting_replacement');
        }
    }
  }, [currentPhase, isLoadingSongs, simulatedB30Songs, calculationStrategy, isScoreLimitReleased, simulatedAverageB30Rating]);

  useEffect(() => {
    if (currentPhase === 'performing_fine_tuning' && calculationStrategy && simulatedB30Songs.length > 0 && fineTuningCandidateSongs.length > 0) {
      console.log(`[SIM_DEBUG_FINE_PERFORM] Phase: Performing Fine-Tuning. Candidates: ${fineTuningCandidateSongs.length}. Sample:`, fineTuningCandidateSongs.slice(0,3).map(s=>({t:s.title, tR:s.targetRating.toFixed(2), tS:s.targetScore})));
      let newSimulatedB30Songs = [...simulatedB30Songs];
      const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;
      let songWasUpdatedThisPass = false;

      const groupToTune = fineTuningCandidateSongs; 

      for (const candidateSong of groupToTune) {
        const songIndexInSimulated = newSimulatedB30Songs.findIndex(s => s.id === candidateSong.id && s.diff === candidateSong.diff);
        if (songIndexInSimulated === -1) { 
          console.warn(`[SIM_DEBUG_FINE_PERFORM] Candidate ${candidateSong.title} (${candidateSong.diff}) not found in simulatedB30. Skipping.`);
          continue; 
        }

        let currentSongInSim = newSimulatedB30Songs[songIndexInSimulated];
        if (currentSongInSim.targetScore < scoreCap && currentSongInSim.chartConstant) {
          const targetMicroTuneRating = currentSongInSim.targetRating + 0.0001; 
          const minScoreInfo = findMinScoreForTargetRating(currentSongInSim, targetMicroTuneRating, isScoreLimitReleased);

          if (minScoreInfo.possible && minScoreInfo.score > currentSongInSim.targetScore && minScoreInfo.score <= scoreCap) {
            const updatedSong = {
              ...currentSongInSim, 
              targetScore: minScoreInfo.score, 
              targetRating: parseFloat(minScoreInfo.rating.toFixed(4)),
            };
            newSimulatedB30Songs[songIndexInSimulated] = updatedSong;
            songWasUpdatedThisPass = true;
            console.log(`[SIM_DEBUG_FINE_PERFORM] Updated ${updatedSong.title} (${updatedSong.diff}): tS ${updatedSong.targetScore}, tR ${updatedSong.targetRating.toFixed(4)}`);
            break; 
          }
        }
      }
      
      if (songWasUpdatedThisPass) {
        setSimulatedB30Songs(newSimulatedB30Songs);
        setCurrentPhase('evaluating_fine_tuning_result');
      } else {
        console.log(`[SIM_DEBUG_FINE_PERFORM] No songs updated during this fine-tuning pass (${groupToTune.length} candidates). Moving to stuck/replacement.`);
        setFineTuningCandidateSongs([]); 
        setCurrentPhase('stuck_awaiting_replacement');
      }
    } else if (currentPhase === 'performing_fine_tuning' && fineTuningCandidateSongs.length === 0 && simulatedB30Songs.length > 0 && !isLoadingSongs) {
      console.log(`[SIM_DEBUG_FINE_PERFORM] Candidate list for fine-tuning is empty. Moving to stuck/replacement.`);
      setCurrentPhase('stuck_awaiting_replacement');
    }
  }, [currentPhase, calculationStrategy, simulatedB30Songs, fineTuningCandidateSongs, isScoreLimitReleased, isLoadingSongs ]);

  useEffect(() => {
    if (currentPhase === 'evaluating_fine_tuning_result' && simulatedAverageB30Rating !== null && targetRatingDisplay) {
      const targetRatingNum = parseFloat(targetRatingDisplay);
      console.log(`[SIM_DEBUG_FINE_EVAL] Phase: Evaluating Fine-Tuning. Avg B30: ${simulatedAverageB30Rating.toFixed(4)}, Target: ${targetRatingNum.toFixed(4)}`);

      if (simulatedAverageB30Rating >= targetRatingNum) {
        console.log("[SIM_DEBUG_FINE_EVAL] Target Reached during Fine-Tuning.");
        setCurrentPhase('target_reached');
      } else {
        console.log(`[SIM_DEBUG_FINE_EVAL] Target not reached. Re-initializing fine-tuning phase to iterate again.`);
        setCurrentPhase('initializing_fine_tuning_phase');
      }
    }
  }, [currentPhase, simulatedAverageB30Rating, targetRatingDisplay, calculationStrategy]);


  // --- B30 REPLACEMENT PHASE LOGIC ---
  useEffect(() => {
    if (currentPhase === 'stuck_awaiting_replacement' && simulatedB30Songs.length > 0) {
      const sortedB30ForReplacement = [...simulatedB30Songs].sort((a, b) => a.targetRating - b.targetRating);
      const songOut = sortedB30ForReplacement[0]; 
      if (songOut) {
        console.log(`[SIM_DEBUG_REPLACE_INIT] Stuck. Song to potentially replace (lowest tR in B30): ${songOut.title} (${songOut.diff}), tR: ${songOut.targetRating.toFixed(4)}`);
        setSongToReplace(songOut);
        setCurrentPhase('awaiting_external_data_for_replacement');
      } else {
        console.error("[SIM_DEBUG_REPLACE_INIT] Stuck, but no song found to replace in B30. Error.");
        setCurrentPhase('error');
      }
    } else if (currentPhase === 'stuck_awaiting_replacement' && simulatedB30Songs.length === 0) {
      console.error("[SIM_DEBUG_REPLACE_INIT] Stuck, but B30 is empty. Error.");
      setCurrentPhase('error');
    }
  }, [currentPhase, simulatedB30Songs]);

  useEffect(() => {
    if (currentPhase === 'awaiting_external_data_for_replacement') {
      console.log("[SIM_DEBUG_REPLACE_AWAIT_DATA] Awaiting external data for replacement.");
      if (allMusicData && allMusicData.length > 0 && userPlayHistory && userPlayHistory.length > 0 && songToReplace) {
         console.log("[SIM_DEBUG_REPLACE_AWAIT_DATA] External data (allMusic, userHistory) and songToReplace are present. Moving to identify candidates.");
        setCurrentPhase('identifying_candidates');
      } else if (!songToReplace) {
        console.error("[SIM_DEBUG_REPLACE_AWAIT_DATA] songToReplace is null. Error.");
        setCurrentPhase('error');
      } else {
          console.log(`[SIM_DEBUG_REPLACE_AWAIT_DATA] Waiting. AllMusic: ${allMusicData?.length}, UserHistory: ${userPlayHistory?.length}, SongToReplace: ${!!songToReplace}`);
          if (!allMusicData || allMusicData.length === 0 || !userPlayHistory || userPlayHistory.length === 0) {
            console.warn("[SIM_DEBUG_REPLACE_AWAIT_DATA] Missing allMusicData or userPlayHistory. Cannot proceed with replacement. This might indicate an issue with initial data load or cache for these. Triggering error.");
            setCurrentPhase('error'); 
          }
      }
    }
  }, [currentPhase, allMusicData, userPlayHistory, songToReplace]);

  useEffect(() => {
    if (currentPhase === 'identifying_candidates' && songToReplace && allMusicData && allMusicData.length > 0) {
      console.log(`[SIM_DEBUG_REPLACE_IDENTIFY] Identifying replacement candidates for ${songToReplace.title} (tR: ${songToReplace.targetRating.toFixed(4)}). allMusicData count: ${allMusicData.length}`);
      const currentB30IdsAndDiffs = new Set(simulatedB30Songs.map(s => `${s.id}_${s.diff}`));
      
      const newSongsTitlesLower = (NewSongsData.titles?.verse || []).map(t => t.trim().toLowerCase());

      const potentialCandidatesApi = allMusicData.filter(globalSong => {
        if (!globalSong.id || !globalSong.diff || !globalSong.title) return false;
        const songKey = `${globalSong.id}_${globalSong.diff.toUpperCase()}`;
        if (currentB30IdsAndDiffs.has(songKey)) return false; 

        // Exclude songs from NewSongs.json
        if (newSongsTitlesLower.includes(globalSong.title.trim().toLowerCase())) {
          // console.log(`[SIM_DEBUG_REPLACE_IDENTIFY_FILTER_EXCLUDE_NEWSONG] Excluding new song: ${globalSong.title}`);
          return false;
        }
        
        const tempSongObjForConst = mapApiSongToAppSong(globalSong, 0, globalSong.const);
        if (!tempSongObjForConst.chartConstant) {
            return false; 
        }
        
        const scoreForMaxRating = isScoreLimitReleased ? 1010000 : 1009000;
        const potentialMaxRating = calculateChunithmSongRating(scoreForMaxRating, tempSongObjForConst.chartConstant);
        const shouldInclude = potentialMaxRating > songToReplace.targetRating;
        return shouldInclude; 
      });
      console.log(`[SIM_DEBUG_REPLACE_IDENTIFY] Found ${potentialCandidatesApi.length} potential candidates from allMusicData after initial filter. Sample:`, potentialCandidatesApi.slice(0,2).map(s=>({t:s.title, d:s.diff, c:s.const, l:s.level})));

      const mappedCandidates = potentialCandidatesApi.map(apiEntry => {
        const playedVersion = userPlayHistory.find(p => p.id === apiEntry.id && p.diff.toUpperCase() === apiEntry.diff.toUpperCase());
        const songWithScore = playedVersion ? { ...apiEntry, score: playedVersion.score, rating: playedVersion.rating } : { ...apiEntry, score: 0, rating: 0 }; 
        return mapApiSongToAppSong(songWithScore, 0, apiEntry.const); 
      }).filter(song => song.chartConstant !== null); 
      console.log(`[SIM_DEBUG_REPLACE_IDENTIFY] Mapped ${mappedCandidates.length} candidates to AppSong format (with valid chartConstant). Sample:`, mappedCandidates.slice(0,2).map(s=>({t:s.title, cS:s.currentScore, cR:s.currentRating.toFixed(4), const:s.chartConstant })));

      setCandidateSongsForReplacement(mappedCandidates);
      if (mappedCandidates.length > 0) {
        setCurrentPhase('candidates_identified');
      } else {
        console.warn("[SIM_DEBUG_REPLACE_IDENTIFY] No replacement candidates found after mapping and filtering. Possibly stuck permanently or target too high.");
        setCurrentPhase('error'); 
      }
    } else if (currentPhase === 'identifying_candidates' && (!songToReplace || !allMusicData || allMusicData.length === 0)) {
      console.error("[SIM_DEBUG_REPLACE_IDENTIFY] Error state: songToReplace is null or allMusicData is empty or undefined.");
      setCurrentPhase('error');
    }
  }, [currentPhase, songToReplace, allMusicData, userPlayHistory, simulatedB30Songs, isScoreLimitReleased]);
  
  useEffect(() => {
    if (currentPhase === 'candidates_identified' && songToReplace && candidateSongsForReplacement.length > 0) {
        console.log(`[SIM_DEBUG_REPLACE_CANDIDATES_ID] ${candidateSongsForReplacement.length} candidates identified for ${songToReplace.title}. Moving to select optimal.`);
        setCurrentPhase('selecting_optimal_candidate');
    } else if (currentPhase === 'candidates_identified' && (candidateSongsForReplacement.length === 0 || !songToReplace)) {
        console.warn(`[SIM_DEBUG_REPLACE_CANDIDATES_ID] No candidates (${candidateSongsForReplacement.length}) or no song to replace (${!!songToReplace}). Moving to error.`);
        setCurrentPhase('error'); 
    }
  }, [currentPhase, candidateSongsForReplacement, songToReplace]);

  useEffect(() => {
    if (currentPhase === 'selecting_optimal_candidate' && songToReplace && candidateSongsForReplacement.length > 0) {
      console.log(`[SIM_DEBUG_REPLACE_SELECT_OPT] Selecting optimal candidate to replace ${songToReplace.title} (tR: ${songToReplace.targetRating.toFixed(4)}) from ${candidateSongsForReplacement.length} candidates.`);
      let bestCandidateInfo: { song: Song | null; effort: number; neededScore: number; resultingRating: number } = { song: null, effort: Infinity, neededScore: 0, resultingRating: 0 };

      candidateSongsForReplacement.forEach(candidate => {
        if (!candidate.chartConstant) return; 
        const targetRatingForCandidate = songToReplace.targetRating + 0.0001; 
        const minScoreInfo = findMinScoreForTargetRating(candidate, targetRatingForCandidate, isScoreLimitReleased);

        if (minScoreInfo.possible) {
          const effort = candidate.currentScore > 0 ? (minScoreInfo.score - candidate.currentScore) : minScoreInfo.score; 
          if (effort < bestCandidateInfo.effort || (effort === bestCandidateInfo.effort && minScoreInfo.rating > bestCandidateInfo.resultingRating)) {
            bestCandidateInfo = { song: candidate, effort, neededScore: minScoreInfo.score, resultingRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
          }
        }
      });

      if (bestCandidateInfo.song) {
        const finalOptimalCandidate: Song = {
          ...bestCandidateInfo.song, 
          targetScore: bestCandidateInfo.neededScore, 
          targetRating: bestCandidateInfo.resultingRating 
        };
        console.log(`[SIM_DEBUG_REPLACE_SELECT_OPT] Optimal candidate selected: ${finalOptimalCandidate.title} (${finalOptimalCandidate.diff}). Needs score: ${finalOptimalCandidate.targetScore} for tR: ${finalOptimalCandidate.targetRating.toFixed(4)}. Effort: ${bestCandidateInfo.effort}. Original cS: ${finalOptimalCandidate.currentScore}, cR: ${finalOptimalCandidate.currentRating.toFixed(4)}`);
        setOptimalCandidateSong(finalOptimalCandidate);
        setCurrentPhase('optimal_candidate_selected');
      } else {
        console.warn("[SIM_DEBUG_REPLACE_SELECT_OPT] No optimal candidate could achieve the target rating (or better with same effort). Stuck or error.");
        setCurrentPhase('error');
      }
    }
  }, [currentPhase, candidateSongsForReplacement, songToReplace, isScoreLimitReleased]);

  useEffect(() => {
      if (currentPhase === 'optimal_candidate_selected' && optimalCandidateSong && songToReplace) {
          console.log(`[SIM_DEBUG_REPLACE_OPTIMAL_SEL] Optimal candidate ${optimalCandidateSong.title} selected. Moving to replace ${songToReplace.title}.`);
          setCurrentPhase('replacing_song');
      }
  }, [currentPhase, optimalCandidateSong, songToReplace]);

  useEffect(() => {
    if (currentPhase === 'replacing_song' && optimalCandidateSong && songToReplace) {
      console.log(`[SIM_DEBUG_REPLACE_PERFORM] Replacing ${songToReplace.title} (tR: ${songToReplace.targetRating.toFixed(4)}) with ${optimalCandidateSong.title} (new tS: ${optimalCandidateSong.targetScore}, new tR: ${optimalCandidateSong.targetRating.toFixed(4)}).`);
      
      const newB30EntryForOptimalCandidate: Song = {
        ...optimalCandidateSong, 
      };
      
      const updatedB30 = simulatedB30Songs.filter(s => !(s.id === songToReplace.id && s.diff === songToReplace.diff));
      updatedB30.push(newB30EntryForOptimalCandidate); 
      
      console.log(`[SIM_DEBUG_REPLACE_PERFORM] B30 count before replace: ${simulatedB30Songs.length}, after removing old: ${updatedB30.length -1}, after adding new: ${updatedB30.length}`);
      setSimulatedB30Songs(updatedB30); 
      
      setSongToReplace(null); 
      setOptimalCandidateSong(null); 
      setCandidateSongsForReplacement([]);
      
      console.log("[SIM_DEBUG_REPLACE_PERFORM] Song replaced. Restarting simulation from Leap Phase.");
      setCurrentPhase('initializing_leap_phase'); 
    }
  }, [currentPhase, optimalCandidateSong, songToReplace, simulatedB30Songs]);


  return {
    apiPlayerName,
    best30SongsData: simulatedB30Songs.length > 0 
      ? simulatedB30Songs 
      : (originalB30SongsData.length > 0 
          ? originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating }))
          : []),
    new20SongsData,
    combinedTopSongs,
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    isScoreLimitReleased,
    phaseTransitionPoint,
    currentPhase,
    simulatedAverageB30Rating,
  };
}


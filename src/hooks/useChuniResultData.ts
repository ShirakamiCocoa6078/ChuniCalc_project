
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
const NEW_20_COUNT = 20; // Max items for the New 20 list

const getSimulationCacheKey = (
  listType: 'b30' | 'n20',
  userName: string | null,
  currentRating: string | null,
  targetRating: string | null,
  strategy: CalculationStrategy | null
): string | null => {
  if (!userName || !currentRating || !targetRating || !strategy) return null;
  const normCurrent = parseFloat(currentRating).toFixed(2);
  const normTarget = parseFloat(targetRating).toFixed(2);
  const prefix = listType === 'n20' ? `${LOCAL_STORAGE_PREFIX}simulation_new20_` : `${LOCAL_STORAGE_PREFIX}simulation_`;
  return `${prefix}${userName}_${normCurrent}_${normTarget}_${strategy}`;
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
        // Already flat or a different structure that matches ShowallApiSongEntry (e.g., user records)
        flattenedEntries.push(rawEntry as ShowallApiSongEntry);
    }
    return flattenedEntries;
};

// Helper: Check if a song is considered "high constant" for the floor strategy
const isSongHighConstantForFloor = (song: Song, currentOverallAverageRatingForList: number | null): boolean => {
  if (!song.chartConstant || currentOverallAverageRatingForList === null) return false;
  const thresholdBase = currentOverallAverageRatingForList - 1.8;
  const threshold = Math.floor(thresholdBase * 10) / 10; 
  // console.log(`[isSongHighConstantForFloor] Song: ${song.title}, Const: ${song.chartConstant}, AvgRating: ${currentOverallAverageRatingForList.toFixed(4)}, ThresholdBase: ${thresholdBase.toFixed(4)}, Threshold: ${threshold.toFixed(1)} -> HighConst: ${song.chartConstant > threshold}`);
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
  
  // Best 30 States
  const [originalB30SongsData, setOriginalB30SongsData] = useState<Song[]>([]);
  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);
  const [sortedPrimaryLeapCandidatesB30, setSortedPrimaryLeapCandidatesB30] = useState<Song[]>([]);
  const [fineTuningCandidateSongsB30, setFineTuningCandidateSongsB30] = useState<Song[]>([]); 
  const [songToReplaceB30, setSongToReplaceB30] = useState<Song | null>(null);
  const [candidateSongsForReplacementB30, setCandidateSongsForReplacementB30] = useState<Song[]>([]);
  const [optimalCandidateSongB30, setOptimalCandidateSongB30] = useState<Song | null>(null);

  // New 20 States
  const [originalNew20SongsData, setOriginalNew20SongsData] = useState<Song[]>([]);
  const [simulatedNew20Songs, setSimulatedNew20Songs] = useState<Song[]>([]);
  const [simulatedAverageNew20Rating, setSimulatedAverageNew20Rating] = useState<number | null>(null);
  const [allPlayedNewSongsPool, setAllPlayedNewSongsPool] = useState<Song[]>([]); // For N20 replacement
  const [sortedPrimaryLeapCandidatesN20, setSortedPrimaryLeapCandidatesN20] = useState<Song[]>([]);
  const [fineTuningCandidateSongsN20, setFineTuningCandidateSongsN20] = useState<Song[]>([]);
  const [songToReplaceN20, setSongToReplaceN20] = useState<Song | null>(null);
  const [candidateSongsForReplacementN20, setCandidateSongsForReplacementN20] = useState<Song[]>([]);
  const [optimalCandidateSongN20, setOptimalCandidateSongN20] = useState<Song | null>(null);
  
  // Combined states
  const [combinedTopSongs, setCombinedTopSongs] = useState<Song[]>([]);

  // General Simulation States
  const [isLoadingSongs, setIsLoadingSongs] = useState(true);
  const [errorLoadingSongs, setErrorLoadingSongs] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [isScoreLimitReleased, setIsScoreLimitReleased] = useState(false); 
  const [phaseTransitionPoint, setPhaseTransitionPoint] = useState<number | null>(null); 
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  const [simulationTargetList, setSimulationTargetList] = useState<'b30' | 'n20' | 'idle'>('idle');
  
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
      setOriginalB30SongsData([]); setOriginalNew20SongsData([]); 
      setSimulatedB30Songs([]); setSimulatedNew20Songs([]);
      setCombinedTopSongs([]); 
      setAllPlayedNewSongsPool([]);

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
          console.log(`[DATA_FETCH] Global music cache found. Count: ${globalMusicCacheRaw.length}.`);
          if (globalMusicCacheRaw.length > 0 && globalMusicCacheRaw[0]?.meta && globalMusicCacheRaw[0]?.data) {
              console.log("[DATA_FETCH] Global music cache seems raw (nested meta/data). Flattening...");
              flattenedGlobalMusicRecords = globalMusicCacheRaw.reduce((acc, entry) => acc.concat(flattenGlobalMusicEntry(entry)), [] as ShowallApiSongEntry[]);
          } else {
              console.log("[DATA_FETCH] Global music cache seems already flat or is not nested.");
              flattenedGlobalMusicRecords = globalMusicCacheRaw as ShowallApiSongEntry[];
          }
      }
      // This state needs to be set regardless of API fetch for other hooks to use if cache is hit
      if (flattenedGlobalMusicRecords.length > 0) {
        setAllMusicData(flattenedGlobalMusicRecords);
      }


      let tempUserShowallRecords: ShowallApiSongEntry[] = userShowallCache?.records || [];
      // This state also needs to be set for other hooks
      if (tempUserShowallRecords.length > 0) {
        setUserPlayHistory(tempUserShowallRecords);
      }


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
                flattenedGlobalMusicRecords = justFetchedFlattenedGlobal; 
              }
              if (res.type === 'userShowall' && !userShowallCache) {
                const fetchedUserShowallRecords = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                setUserPlayHistory(fetchedUserShowallRecords);
                setCachedData<UserShowallApiResponse>(userShowallKey, { records: fetchedUserShowallRecords });
                userShowallCache = { records: fetchedUserShowallRecords };
                tempUserShowallRecords = fetchedUserShowallRecords; 
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
        // This is crucial if the above API block was skipped.
        if (flattenedGlobalMusicRecords.length > 0 && allMusicData.length === 0) {
            setAllMusicData(flattenedGlobalMusicRecords);
            console.log(`[DATA_FETCH] Set allMusicData from processed cache (main cache load block): ${flattenedGlobalMusicRecords.length}`);
        } else if (flattenedGlobalMusicRecords.length > 0 && allMusicData.length > 0) {
             console.log(`[DATA_FETCH] allMusicData already set. Current count: ${allMusicData.length}. Cache count: ${flattenedGlobalMusicRecords.length}`);
        }

        if (tempUserShowallRecords.length > 0 && userPlayHistory.length === 0) {
            setUserPlayHistory(tempUserShowallRecords);
            console.log(`[DATA_FETCH] Set userPlayHistory from processed cache (main cache load block): ${tempUserShowallRecords.length}`);
        } else if (tempUserShowallRecords.length > 0 && userPlayHistory.length > 0) {
            console.log(`[DATA_FETCH] userPlayHistory already set. Current count: ${userPlayHistory.length}. Cache count: ${tempUserShowallRecords.length}`);
        }
        toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
      }

      const mappedOriginalB30 = sortSongsByRatingDesc(initialB30ApiEntries.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
      setOriginalB30SongsData(mappedOriginalB30);
      setSimulatedB30Songs(mappedOriginalB30.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating })));
      console.log(`[DATA_FETCH] Original B30 songs mapped: ${mappedOriginalB30.length}`);
      
      // Process New20 songs
      if (flattenedGlobalMusicRecords.length > 0 && tempUserShowallRecords.length > 0) {
        console.log("[NEW20_PROCESS] Starting New20 processing.");
        const newSongTitlesRaw = NewSongsData.titles?.verse || [];
        const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());
        
        const newSongDefinitions = flattenedGlobalMusicRecords.filter(globalSong => 
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
        setAllPlayedNewSongsPool(mappedPlayedNewSongs); // Save for N20 replacement
        
        const sortedNewSongsFull = sortSongsByRatingDesc(mappedPlayedNewSongs);
        const finalNew20 = sortedNewSongsFull.slice(0, NEW_20_COUNT);
        setOriginalNew20SongsData(finalNew20);
        setSimulatedNew20Songs(finalNew20.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating })));
        console.log(`[NEW20_PROCESS] Final New20 songs processed (top ${NEW_20_COUNT}): ${finalNew20.length}`);
      } else { 
        setOriginalNew20SongsData([]); 
        setSimulatedNew20Songs([]);
        setAllPlayedNewSongsPool([]);
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

    console.log(`[SIM_STRATEGY_EFFECT] Running. Strategy: ${currentStrat}, Prev: ${prevStrategy}, ActualChange: ${actualStrategyChanged}, isLoading: ${isLoadingSongs}, OriginalB30Count: ${originalB30SongsData.length}, OriginalN20Count: ${originalNew20SongsData.length}, currentPhase: ${currentPhase}`);

    if (isLoadingSongs && !actualStrategyChanged) { 
        console.log("[SIM_STRATEGY_EFFECT] Data still loading and strategy unchanged. Deferring full processing.");
        return;
    }
    
    if (actualStrategyChanged) {
        console.log(`[SIM_STRATEGY_EFFECT] Strategy changed from ${prevStrategy} to ${currentStrat}. Resetting simulation states.`);
        // Reset B30 sim states
        setSortedPrimaryLeapCandidatesB30([]);
        setFineTuningCandidateSongsB30([]);
        setSongToReplaceB30(null);
        setCandidateSongsForReplacementB30([]);
        setOptimalCandidateSongB30(null);
        if (originalB30SongsData.length > 0) {
          setSimulatedB30Songs(originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})));
          console.log("[SIM_STRATEGY_EFFECT] SimulatedB30Songs reset from original B30 data.");
        } else {
          setSimulatedB30Songs([]); 
          console.log("[SIM_STRATEGY_EFFECT] OriginalB30SongsData empty, SimulatedB30Songs set to empty.");
        }

        // Reset N20 sim states
        setSortedPrimaryLeapCandidatesN20([]);
        setFineTuningCandidateSongsN20([]);
        setSongToReplaceN20(null);
        setCandidateSongsForReplacementN20([]);
        setOptimalCandidateSongN20(null);
        if (originalNew20SongsData.length > 0) {
            setSimulatedNew20Songs(originalNew20SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})));
            console.log("[SIM_STRATEGY_EFFECT] SimulatedNew20Songs reset from original N20 data.");
        } else {
            setSimulatedNew20Songs([]);
            console.log("[SIM_STRATEGY_EFFECT] OriginalNew20SongsData empty, SimulatedNew20Songs set to empty.");
        }
        
        setCurrentPhase('idle'); 
        setSimulationTargetList('idle');
    }
    
    // Attempt to load from cache or start simulation if strategy is active
    if (!isLoadingSongs && currentStrat) {
        const currentRatingNum = parseFloat(currentRatingDisplay || "0");
        const targetRatingNum = parseFloat(targetRatingDisplay || "0");
        const ratingDataCacheKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
        const ratingDataCacheItem = clientHasMounted ? localStorage.getItem(ratingDataCacheKey) : null;
        let currentSourceDataTimestamp = 0;
        if (ratingDataCacheItem) { try { currentSourceDataTimestamp = (JSON.parse(ratingDataCacheItem) as CachedData<any>).timestamp; } catch (e) { console.warn("[SIM_CACHE] Failed to parse rating_data timestamp for cache validation.", e); } }

        let b30CacheHit = false;
        const simCacheKeyB30 = getSimulationCacheKey('b30', userNameForApi, currentRatingDisplay, targetRatingDisplay, currentStrat);
        if (simCacheKeyB30 && currentSourceDataTimestamp > 0 && clientHasMounted) {
            const cachedSimB30 = getCachedData<CachedSimulationResult>(simCacheKeyB30, SIMULATION_CACHE_EXPIRY_MS);
            if (cachedSimB30 && cachedSimB30.sourceDataTimestamp === currentSourceDataTimestamp) {
                if (cachedSimB30.finalPhase === 'error') {
                    console.log(`[SIM_CACHE] B30: Error state cache found for strategy ${currentStrat}. Ignoring.`);
                } else {
                    console.log(`[SIM_CACHE] B30: Valid simulation cache found. Loading from cache.`);
                    setSimulatedB30Songs(cachedSimB30.simulatedB30Songs);
                    setSimulatedAverageB30Rating(cachedSimB30.simulatedAverageB30Rating);
                    b30CacheHit = true; // B30 part is cached
                }
            }
        }

        let n20CacheHit = false;
        const simCacheKeyN20 = getSimulationCacheKey('n20', userNameForApi, currentRatingDisplay, targetRatingDisplay, currentStrat);
        if (simCacheKeyN20 && currentSourceDataTimestamp > 0 && clientHasMounted) {
            const cachedSimN20 = getCachedData<CachedSimulationResult>(simCacheKeyN20, SIMULATION_CACHE_EXPIRY_MS);
             if (cachedSimN20 && cachedSimN20.sourceDataTimestamp === currentSourceDataTimestamp) {
                 if (cachedSimN20.finalPhase === 'error') {
                    console.log(`[SIM_CACHE] N20: Error state cache found for strategy ${currentStrat}. Ignoring.`);
                 } else {
                    console.log(`[SIM_CACHE] N20: Valid simulation cache found. Loading from cache.`);
                    setSimulatedNew20Songs(cachedSimN20.simulatedB30Songs); // N20 uses same structure, 'simulatedB30Songs' field
                    setSimulatedAverageNew20Rating(cachedSimN20.simulatedAverageB30Rating);
                    n20CacheHit = true; // N20 part is cached
                 }
             }
        }
        
        // Determine overall phase based on cache hits
        if (b30CacheHit && n20CacheHit) {
            console.log("[SIM_CACHE] Both B30 and N20 loaded from cache. Setting phase to 'target_reached' or 'error' based on cached N20 phase.");
            // Assume N20 cache phase is more indicative if both hit, or check overall target
            const cachedSimN20 = getCachedData<CachedSimulationResult>(simCacheKeyN20!, SIMULATION_CACHE_EXPIRY_MS);
            setCurrentPhase(cachedSimN20!.finalPhase); // Restore phase from N20 cache
            setSimulationTargetList('idle'); // Both done
            if (!lastRefreshed?.includes(new Date(currentSourceDataTimestamp).toLocaleString(locale))) {
              setLastRefreshed(getTranslation(locale, 'resultPageSyncStatus', new Date(currentSourceDataTimestamp).toLocaleString(locale)) + " (Sim Cache B30 & N20)");
            }
        } else { // At least one part needs simulation
            if (simulatedB30Songs.length === 0 && originalB30SongsData.length > 0) {
                 setSimulatedB30Songs(originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})));
            }
            if (simulatedNew20Songs.length === 0 && originalNew20SongsData.length > 0) {
                 setSimulatedNew20Songs(originalNew20SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})));
            }
            
            console.log(`[SIM_STRATEGY_EFFECT] Strategy '${currentStrat}' active. Cache miss for at least one part. Starting new simulation cycle.`);
            if (currentRatingNum < targetRatingNum && (originalB30SongsData.length > 0 || originalNew20SongsData.length > 0)) {
                if (currentPhase === 'idle' || actualStrategyChanged) { 
                    console.log(`[SIM_STRATEGY_EFFECT] Setting target to B30 and phase to initializing_leap_phase.`);
                    setSimulationTargetList('b30'); // Start with B30
                    setCurrentPhase('initializing_leap_phase');
                }
            } else {
                setCurrentPhase('idle');
                setSimulationTargetList('idle');
            }
        }

    } else if (!currentStrat) { 
        console.log("[SIM_STRATEGY_EFFECT] Strategy deselected (null). Phase set to Idle. Resetting sim lists from original.");
        if (originalB30SongsData.length > 0) {
             setSimulatedB30Songs(originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})));
        } else { setSimulatedB30Songs([]); }
        if (originalNew20SongsData.length > 0) {
             setSimulatedNew20Songs(originalNew20SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})));
        } else { setSimulatedNew20Songs([]); }
        setCurrentPhase('idle');
        setSimulationTargetList('idle');
    }

    if (actualStrategyChanged) {
        prevCalculationStrategyRef.current = currentStrat;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculationStrategy, isLoadingSongs, originalB30SongsData, originalNew20SongsData, userNameForApi, currentRatingDisplay, targetRatingDisplay, clientHasMounted, locale, refreshNonce]);


  useEffect(() => {
    if (!isLoadingSongs) {
      const baseB30 = simulatedB30Songs.length > 0 ? simulatedB30Songs : originalB30SongsData;
      const baseN20 = simulatedNew20Songs.length > 0 ? simulatedNew20Songs : originalNew20SongsData;

      if (baseB30.length > 0 || baseN20.length > 0) {
        const songMap = new Map<string, Song>();
        
        const songsToCombineB30 = baseB30.map(s => ({ ...s, currentRating: s.targetRating }));
        songsToCombineB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, { ...song }));
        
        const songsToCombineN20 = baseN20.map(s => ({ ...s, currentRating: s.targetRating }));
        songsToCombineN20.forEach(song => { 
            const key = `${song.id}_${song.diff}`; 
            const new20EffectiveRating = song.targetRating; 
            if (!songMap.has(key) || (songMap.has(key) && new20EffectiveRating > songMap.get(key)!.currentRating)) {
                songMap.set(key, { ...song, currentRating: new20EffectiveRating }); 
            }
        });
        setCombinedTopSongs(sortSongsByRatingDesc(Array.from(songMap.values())));
      } else { setCombinedTopSongs([]); }
    }
  }, [originalB30SongsData, originalNew20SongsData, simulatedB30Songs, simulatedNew20Songs, isLoadingSongs]);

  // Calculate simulatedAverageB30Rating
  useEffect(() => {
    const songsToAvg = simulatedB30Songs.length > 0 ? simulatedB30Songs : originalB30SongsData;
    if (songsToAvg.length > 0) {
      const topSongsForAvg = sortSongsByRatingDesc([...songsToAvg].map(s => ({...s, currentRating: s.targetRating}))).slice(0, BEST_COUNT);
      const newAverage = topSongsForAvg.length > 0 ? topSongsForAvg.reduce((sum, s) => sum + s.targetRating, 0) / topSongsForAvg.length : 0;
      const newAverageFixed = parseFloat(newAverage.toFixed(4));
      setSimulatedAverageB30Rating(newAverageFixed);
    } else {
      setSimulatedAverageB30Rating(null);
    }
  }, [simulatedB30Songs, originalB30SongsData]);

  // Calculate simulatedAverageNew20Rating
  useEffect(() => {
    const songsToAvgN20 = simulatedNew20Songs.length > 0 ? simulatedNew20Songs : originalNew20SongsData;
    if (songsToAvgN20.length > 0) {
        // For New20, we use NEW_20_COUNT (or actual length if less)
        const topSongsForN20Avg = sortSongsByRatingDesc([...songsToAvgN20].map(s => ({...s, currentRating: s.targetRating}))).slice(0, NEW_20_COUNT);
        const newN20Average = topSongsForN20Avg.length > 0 ? topSongsForN20Avg.reduce((sum, s) => sum + s.targetRating, 0) / topSongsForN20Avg.length : 0;
        const newN20AverageFixed = parseFloat(newN20Average.toFixed(4));
        setSimulatedAverageNew20Rating(newN20AverageFixed);
    } else {
        setSimulatedAverageNew20Rating(null);
    }
  }, [simulatedNew20Songs, originalNew20SongsData]);


  // Save B30 simulation to cache
  useEffect(() => {
    if (!isLoadingSongs && calculationStrategy && userNameForApi && currentRatingDisplay && targetRatingDisplay &&
        (currentPhase === 'target_reached' || currentPhase === 'stuck_awaiting_replacement' || currentPhase === 'error' ||
         (currentPhase === 'idle' && simulatedAverageB30Rating !== null && parseFloat(currentRatingDisplay || "0") >= parseFloat(targetRatingDisplay || "0"))
        ) && 
        simulatedB30Songs.length > 0 && simulationTargetList !== 'n20' /* Save B30 when B30 is done or sim is globally done */) {

      const ratingDataCacheKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
      const ratingDataCacheItem = clientHasMounted ? localStorage.getItem(ratingDataCacheKey) : null;
      let sourceDataTimestamp = 0;
      if (ratingDataCacheItem) { try { sourceDataTimestamp = (JSON.parse(ratingDataCacheItem) as CachedData<any>).timestamp; } catch (e) { console.warn("[SIM_CACHE_SAVE_B30] Could not parse rating_data timestamp for saving.", e); } }

      if (sourceDataTimestamp === 0 && originalB30SongsData.length > 0) { 
        console.warn("[SIM_CACHE_SAVE_B30] sourceDataTimestamp is 0. Skipping B30 simulation cache save."); return;
      }
      
      const simCacheKeyB30 = getSimulationCacheKey('b30', userNameForApi, currentRatingDisplay, targetRatingDisplay, calculationStrategy);
      if (simCacheKeyB30) {
        const resultToCache: CachedSimulationResult = {
          timestamp: Date.now(), sourceDataTimestamp,
          simulatedB30Songs: simulatedB30Songs,
          simulatedAverageB30Rating: simulatedAverageB30Rating,
          finalPhase: currentPhase, // This reflects the phase when B30 part finished or global finish
        };
        console.log(`[SIM_CACHE_SAVE_B30] Saving B30 simulation result for key ${simCacheKeyB30}. Phase: ${currentPhase}`);
        setCachedData<CachedSimulationResult>(simCacheKeyB30, resultToCache, SIMULATION_CACHE_EXPIRY_MS);
      }
    }
  }, [currentPhase, calculationStrategy, simulatedB30Songs, simulatedAverageB30Rating, isLoadingSongs, userNameForApi, currentRatingDisplay, targetRatingDisplay, clientHasMounted, originalB30SongsData.length, simulationTargetList]);

  // Save N20 simulation to cache
  useEffect(() => {
    if (!isLoadingSongs && calculationStrategy && userNameForApi && currentRatingDisplay && targetRatingDisplay &&
        (currentPhase === 'target_reached' || currentPhase === 'stuck_awaiting_replacement' || currentPhase === 'error' ||
         (currentPhase === 'idle' && simulatedAverageB30Rating !== null && parseFloat(currentRatingDisplay || "0") >= parseFloat(targetRatingDisplay || "0")) // Using B30 avg here for overall check, might need overall_avg
        ) && 
        simulatedNew20Songs.length > 0 && simulationTargetList !== 'b30' /* Save N20 when N20 is done or sim is globally done */) {

      const ratingDataCacheKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`; // N20 source still depends on overall user data freshness
      const ratingDataCacheItem = clientHasMounted ? localStorage.getItem(ratingDataCacheKey) : null;
      let sourceDataTimestamp = 0;
      if (ratingDataCacheItem) { try { sourceDataTimestamp = (JSON.parse(ratingDataCacheItem) as CachedData<any>).timestamp; } catch (e) { console.warn("[SIM_CACHE_SAVE_N20] Could not parse rating_data timestamp for saving.", e); } }

      if (sourceDataTimestamp === 0 && originalNew20SongsData.length > 0) {
         console.warn("[SIM_CACHE_SAVE_N20] sourceDataTimestamp is 0. Skipping N20 simulation cache save."); return;
      }
      
      const simCacheKeyN20 = getSimulationCacheKey('n20', userNameForApi, currentRatingDisplay, targetRatingDisplay, calculationStrategy);
      if (simCacheKeyN20) {
        const resultToCache: CachedSimulationResult = {
          timestamp: Date.now(), sourceDataTimestamp,
          simulatedB30Songs: simulatedNew20Songs, // Cache structure uses 'simulatedB30Songs' field
          simulatedAverageB30Rating: simulatedAverageNew20Rating, // Cache structure uses 'simulatedAverageB30Rating' field
          finalPhase: currentPhase,
        };
        console.log(`[SIM_CACHE_SAVE_N20] Saving N20 simulation result for key ${simCacheKeyN20}. Phase: ${currentPhase}`);
        setCachedData<CachedSimulationResult>(simCacheKeyN20, resultToCache, SIMULATION_CACHE_EXPIRY_MS);
      }
    }
  }, [currentPhase, calculationStrategy, simulatedNew20Songs, simulatedAverageNew20Rating, isLoadingSongs, userNameForApi, currentRatingDisplay, targetRatingDisplay, clientHasMounted, originalNew20SongsData.length, simulationTargetList, simulatedAverageB30Rating]);


  // --- MAIN SIMULATION PHASE CONTROLLER ---
  useEffect(() => {
    if (isLoadingSongs || !calculationStrategy || currentPhase === 'target_reached' || currentPhase === 'error' || simulationTargetList === 'idle') {
        if(currentPhase === 'target_reached') console.log("[SIM_MAIN_LOOP] Target reached. Simulation idle.");
        if(currentPhase === 'error') console.log("[SIM_MAIN_LOOP] Error state. Simulation idle.");
        return;
    }
    console.log(`[SIM_MAIN_LOOP] Current Phase: ${currentPhase}, Target List: ${simulationTargetList}`);

    const targetRatingNum = parseFloat(targetRatingDisplay || "0");
    // Calculate current overall simulated rating
    // This is a simplified overall rating; actual CHUNITHM may use top 10 of New Songs for its "New Songs Rating" part.
    // For now, we use the average of the simulated NEW_20_COUNT songs.
    const currentOverallSimRating = 
        (simulatedAverageB30Rating !== null && simulatedAverageNew20Rating !== null && originalB30SongsData.length >= BEST_COUNT && originalNew20SongsData.length > 0)
        ? ((simulatedAverageB30Rating * BEST_COUNT) + (simulatedAverageNew20Rating * Math.min(originalNew20SongsData.length, NEW_20_COUNT))) / (BEST_COUNT + Math.min(originalNew20SongsData.length, NEW_20_COUNT))
        : (simulatedAverageB30Rating !== null && originalB30SongsData.length >= BEST_COUNT)
            ? simulatedAverageB30Rating // Fallback if N20 data is missing/empty
            : parseFloat(currentRatingDisplay || "0"); // Fallback to initial if B30 is also not ready
    
    if (currentOverallSimRating >= targetRatingNum) {
        console.log(`[SIM_MAIN_LOOP] Overall target ${targetRatingNum.toFixed(4)} reached with current sim rating ${currentOverallSimRating.toFixed(4)}. Setting phase to target_reached.`);
        setCurrentPhase('target_reached');
        setSimulationTargetList('idle');
        return;
    }

    // Determine active list and states based on simulationTargetList
    const isB30Target = simulationTargetList === 'b30';
    const activeSimulatedList = isB30Target ? simulatedB30Songs : simulatedNew20Songs;
    const activeOriginalList = isB30Target ? originalB30SongsData : originalNew20SongsData;
    const setActiveSimulatedList = isB30Target ? setSimulatedB30Songs : setSimulatedNew20Songs;
    const activeSortedPrimaryLeapCandidates = isB30Target ? sortedPrimaryLeapCandidatesB30 : sortedPrimaryLeapCandidatesN20;
    const setActiveSortedPrimaryLeapCandidates = isB30Target ? setSortedPrimaryLeapCandidatesB30 : setSortedPrimaryLeapCandidatesN20;
    const activeFineTuningCandidateSongs = isB30Target ? fineTuningCandidateSongsB30 : fineTuningCandidateSongsN20;
    const setActiveFineTuningCandidateSongs = isB30Target ? setFineTuningCandidateSongsB30 : setFineTuningCandidateSongsN20;
    const activeSongToReplace = isB30Target ? songToReplaceB30 : songToReplaceN20;
    const setActiveSongToReplace = isB30Target ? setSongToReplaceB30 : setSongToReplaceN20;
    const activeCandidateSongsForReplacement = isB30Target ? candidateSongsForReplacementB30 : candidateSongsForReplacementN20;
    const setActiveCandidateSongsForReplacement = isB30Target ? setCandidateSongsForReplacementB30 : setCandidateSongsForReplacementN20;
    const activeOptimalCandidateSong = isB30Target ? optimalCandidateSongB30 : optimalCandidateSongN20;
    const setActiveOptimalCandidateSong = isB30Target ? setOptimalCandidateSongB30 : setOptimalCandidateSongN20;
    const activeAverageRating = isB30Target ? simulatedAverageB30Rating : simulatedAverageNew20Rating;
    const listName = isB30Target ? "B30" : "N20";


    // --- LEAP PHASE LOGIC ---
    if (currentPhase === 'initializing_leap_phase') {
        console.log(`[SIM_DEBUG_LEAP_INIT - ${listName}] Phase: Initializing Leap. Strategy: ${calculationStrategy}. Full list before sort:`, activeSimulatedList.length);
        const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;
        const updatableSongs = activeSimulatedList.filter(song => song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);
        
        if (updatableSongs.length === 0) {
            console.log(`[SIM_DEBUG_LEAP_INIT - ${listName}] No updatable songs with valid const. Moving to fine-tuning init for ${listName}.`);
            setCurrentPhase('initializing_fine_tuning_phase'); return;
        }

        let sortedCandidates: Song[] = [];
        if (calculationStrategy === 'floor') {
            sortedCandidates = [...updatableSongs].sort((a, b) => {
                 // const aIsHighConst = isSongHighConstantForFloor(a, activeAverageRating); // Temporarily disabled for testing specific request
                 // const bIsHighConst = isSongHighConstantForFloor(b, activeAverageRating); // Temporarily disabled
                 // if (aIsHighConst !== bIsHighConst) return aIsHighConst ? 1 : -1; // Temporarily disabled
                const constA = a.chartConstant ?? Infinity; const constB = b.chartConstant ?? Infinity;
                if (constA !== constB) return constA - constB;
                if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating;
                return a.targetScore - b.targetScore;
            });
            console.log(`[SIM_DEBUG_LEAP_INIT - ${listName}] Floor Strategy (No HighConstantRule) - Sorted all updatable: ${sortedCandidates.length}.`);
        } else if (calculationStrategy === 'peak') {
            sortedCandidates = [...updatableSongs].sort((a, b) => {
                if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating;
                return b.targetScore - a.targetScore;
            });
        }
        setActiveSortedPrimaryLeapCandidates(sortedCandidates);
        if (sortedCandidates.length > 0 ) setCurrentPhase('analyzing_leap_efficiency');
        else { console.log(`[SIM_DEBUG_LEAP_INIT - ${listName}] No candidates after sort. Moving to fine-tuning init.`); setCurrentPhase('initializing_fine_tuning_phase'); }
    }

    if (currentPhase === 'analyzing_leap_efficiency') { 
        console.log(`[SIM_DEBUG_LEAP_ANALYZE - ${listName}] Phase: Analyzing Leap Efficiency. Candidates: ${activeSortedPrimaryLeapCandidates.length}`);
        if (activeSortedPrimaryLeapCandidates.length === 0) {
             console.log(`[SIM_DEBUG_LEAP_ANALYZE - ${listName}] No candidates to analyze. Moving to fine-tuning init.`);
             setCurrentPhase('initializing_fine_tuning_phase'); return;
        }
        setCurrentPhase('performing_leap_jump');
    }

    if (currentPhase === 'performing_leap_jump') {
        let optimalLeapSong: (Song & { leapEfficiency?: number; scoreToReachNextGrade?: number; ratingAtNextGrade?: number }) | null = null;
        const candidatesToConsider = activeSortedPrimaryLeapCandidates; 

        if (calculationStrategy === 'floor') {
            if (candidatesToConsider.length > 0) {
                const songToAttemptLeap = candidatesToConsider[0];
                const nextGradeScore = getNextGradeBoundaryScore(songToAttemptLeap.targetScore);
                let leapEfficiency = 0; let scoreToReachNextGrade: number | undefined = undefined; let ratingAtNextGrade: number | undefined = undefined;
                if (songToAttemptLeap.chartConstant && nextGradeScore && songToAttemptLeap.targetScore < nextGradeScore) {
                    const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, songToAttemptLeap.chartConstant);
                    const ratingIncrease = potentialRatingAtNextGrade - songToAttemptLeap.targetRating;
                    const scoreIncrease = nextGradeScore - songToAttemptLeap.targetScore;
                    if (scoreIncrease > 0 && ratingIncrease > 0.00005) leapEfficiency = ratingIncrease / scoreIncrease;
                    scoreToReachNextGrade = nextGradeScore; ratingAtNextGrade = potentialRatingAtNextGrade;
                }
                if (leapEfficiency > 0 && scoreToReachNextGrade && ratingAtNextGrade) {
                    optimalLeapSong = { ...songToAttemptLeap, leapEfficiency, scoreToReachNextGrade, ratingAtNextGrade };
                } else {
                    console.log(`[SIM_DEBUG_LEAP_PERFORM - ${listName}] Floor Strategy: Leap not possible for ${songToAttemptLeap.title}. Moving to fine-tuning init.`);
                    setCurrentPhase('initializing_fine_tuning_phase'); return; 
                }
            } else { setCurrentPhase('initializing_fine_tuning_phase'); return; }
        } else if (calculationStrategy === 'peak') { /* Peak logic as before */
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
            if (songsWithCalculatedEfficiency.length > 0) {
                optimalLeapSong = [...songsWithCalculatedEfficiency].sort((a, b) => (b.leapEfficiency || 0) - (a.leapEfficiency || 0))[0];
            }
        }
        
        if (!optimalLeapSong || typeof optimalLeapSong.scoreToReachNextGrade !== 'number' || typeof optimalLeapSong.ratingAtNextGrade !== 'number') {
            setCurrentPhase('initializing_fine_tuning_phase'); return;
        }
        
        const newSimulatedList = activeSimulatedList.map(song => 
            (song.id === optimalLeapSong!.id && song.diff === optimalLeapSong!.diff) 
            ? { ...song, targetScore: optimalLeapSong!.scoreToReachNextGrade!, targetRating: parseFloat(optimalLeapSong!.ratingAtNextGrade!.toFixed(4)) } 
            : song
        );
        setActiveSimulatedList(newSimulatedList); 
        setCurrentPhase('evaluating_leap_result');
    }
  
    if (currentPhase === 'evaluating_leap_result') {
      if (activeAverageRating === null || phaseTransitionPoint === null) { setCurrentPhase('error'); return; } // Should not happen
      console.log(`[SIM_DEBUG_LEAP_EVAL - ${listName}] Avg Rating: ${activeAverageRating.toFixed(4)}, Target Overall: ${targetRatingNum.toFixed(4)}, Transition Pt: ${phaseTransitionPoint.toFixed(4)}`);
      
      // Check overall target first
      if (currentOverallSimRating >= targetRatingNum) { setCurrentPhase('target_reached'); setSimulationTargetList('idle'); return; }

      if (activeAverageRating >= phaseTransitionPoint && isB30Target) { // Only B30 uses phaseTransitionPoint for now
        setCurrentPhase('transitioning_to_fine_tuning');
      } else {
        setCurrentPhase('initializing_leap_phase'); // Loop leap for current list
      }
    }

    // --- FINE-TUNING PHASE LOGIC ---
    if (currentPhase === 'transitioning_to_fine_tuning') {
      setCurrentPhase('initializing_fine_tuning_phase');
    }

    if (currentPhase === 'initializing_fine_tuning_phase') {
        console.log(`[SIM_DEBUG_FINE_INIT - ${listName}] Phase: Initializing Fine-Tuning. Strategy: ${calculationStrategy}`);
        const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;
        const updatableSongs = activeSimulatedList.filter(song => song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);

        if (updatableSongs.length === 0) {
            console.log(`[SIM_DEBUG_FINE_INIT - ${listName}] No updatable songs. Moving to stuck/replacement for ${listName}.`);
            setCurrentPhase('stuck_awaiting_replacement'); return;
        }
        
        let sortedCandidates: Song[] = [];
        if (calculationStrategy === 'floor') {
             sortedCandidates = [...updatableSongs].sort((a, b) => {
                // const aIsHighConst = isSongHighConstantForFloor(a, activeAverageRating); // Temporarily disabled
                // const bIsHighConst = isSongHighConstantForFloor(b, activeAverageRating); // Temporarily disabled
                // if (aIsHighConst !== bIsHighConst) return aIsHighConst ? 1 : -1; // Temporarily disabled
                const constA = a.chartConstant ?? Infinity; const constB = b.chartConstant ?? Infinity;
                if (constA !== constB) return constA - constB;
                if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating;
                return a.targetScore - b.targetScore;
            });
        } else if (calculationStrategy === 'peak') {
            sortedCandidates = [...updatableSongs].sort((a, b) => {
                if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating; 
                return b.targetScore - a.targetScore;
            });
        }
        setActiveFineTuningCandidateSongs(sortedCandidates);
        if (sortedCandidates.length > 0) setCurrentPhase('performing_fine_tuning');
        else { console.log(`[SIM_DEBUG_FINE_INIT - ${listName}] No candidates after sort. Moving to stuck/replacement.`); setCurrentPhase('stuck_awaiting_replacement'); }
    }

    if (currentPhase === 'performing_fine_tuning') {
      let newSimulatedList = [...activeSimulatedList];
      const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;
      let songWasUpdatedThisPass = false;
      
      if(activeFineTuningCandidateSongs.length === 0) {
          console.log(`[SIM_DEBUG_FINE_PERFORM - ${listName}] No candidates for fine-tuning. Moving to stuck/replacement.`);
          setCurrentPhase('stuck_awaiting_replacement'); return;
      }

      for (const candidateSong of activeFineTuningCandidateSongs) {
        const songIndexInSimulated = newSimulatedList.findIndex(s => s.id === candidateSong.id && s.diff === candidateSong.diff);
        if (songIndexInSimulated === -1) continue; 

        let currentSongInSim = newSimulatedList[songIndexInSimulated];
        if (currentSongInSim.targetScore < scoreCap && currentSongInSim.chartConstant) {
          const targetMicroTuneRating = currentSongInSim.targetRating + 0.0001; 
          const minScoreInfo = findMinScoreForTargetRating(currentSongInSim, targetMicroTuneRating, isScoreLimitReleased);

          if (minScoreInfo.possible && minScoreInfo.score > currentSongInSim.targetScore && minScoreInfo.score <= scoreCap) {
            const updatedSong = { ...currentSongInSim, targetScore: minScoreInfo.score, targetRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
            newSimulatedList[songIndexInSimulated] = updatedSong;
            songWasUpdatedThisPass = true;
            console.log(`[SIM_DEBUG_FINE_PERFORM - ${listName}] Updated ${updatedSong.title}: tS ${updatedSong.targetScore}, tR ${updatedSong.targetRating.toFixed(4)}`);
            break; 
          }
        }
      }
      
      if (songWasUpdatedThisPass) {
        setActiveSimulatedList(newSimulatedList);
        setCurrentPhase('evaluating_fine_tuning_result');
      } else {
        console.log(`[SIM_DEBUG_FINE_PERFORM - ${listName}] No songs updated. Moving to stuck/replacement.`);
        setActiveFineTuningCandidateSongs([]); 
        setCurrentPhase('stuck_awaiting_replacement');
      }
    }

    if (currentPhase === 'evaluating_fine_tuning_result') {
      if (activeAverageRating === null) { setCurrentPhase('error'); return; }
      console.log(`[SIM_DEBUG_FINE_EVAL - ${listName}] Avg Rating: ${activeAverageRating.toFixed(4)}, Target Overall: ${targetRatingNum.toFixed(4)}`);

      if (currentOverallSimRating >= targetRatingNum) { setCurrentPhase('target_reached'); setSimulationTargetList('idle'); return; }
      else { setCurrentPhase('initializing_fine_tuning_phase'); } // Loop fine-tuning for current list
    }

    // --- B30/N20 REPLACEMENT PHASE LOGIC ---
    if (currentPhase === 'stuck_awaiting_replacement') {
        if (activeSimulatedList.length === 0 && activeOriginalList.length > 0) { // List became empty during sim?
             console.error(`[SIM_DEBUG_REPLACE_INIT - ${listName}] Stuck, but activeSimulatedList is empty while original had data. Erroring.`);
             setCurrentPhase('error'); setSimulationTargetList('idle'); return;
        }
        if (activeSimulatedList.length === 0 && activeOriginalList.length === 0) { // List was always empty
             console.log(`[SIM_DEBUG_REPLACE_INIT - ${listName}] Stuck, and list was initially empty. Cannot replace.`);
             if (isB30Target) { // B30 was empty or got stuck
                console.log(`[SIM_DEBUG_REPLACE_INIT - ${listName}] B30 stuck or empty, trying N20.`);
                setSimulationTargetList('n20'); setCurrentPhase('initializing_leap_phase');
             } else { // N20 was also empty or got stuck
                console.log(`[SIM_DEBUG_REPLACE_INIT - ${listName}] Both B30 and N20 stuck or empty. Global error.`);
                setCurrentPhase('error'); setSimulationTargetList('idle');
             }
             return;
        }

      const sortedListForReplacement = [...activeSimulatedList].sort((a, b) => a.targetRating - b.targetRating);
      const songOut = sortedListForReplacement[0]; 
      if (songOut) {
        console.log(`[SIM_DEBUG_REPLACE_INIT - ${listName}] Stuck. Song to potentially replace: ${songOut.title}, tR: ${songOut.targetRating.toFixed(4)}`);
        setActiveSongToReplace(songOut);
        setCurrentPhase('awaiting_external_data_for_replacement');
      } else { // Should not happen if activeSimulatedList has items
        console.error(`[SIM_DEBUG_REPLACE_INIT - ${listName}] Stuck, but no song found to replace. Error.`);
        if (isB30Target) { setSimulationTargetList('n20'); setCurrentPhase('initializing_leap_phase'); } 
        else { setCurrentPhase('error'); setSimulationTargetList('idle'); }
      }
    }

    if (currentPhase === 'awaiting_external_data_for_replacement') {
      console.log(`[SIM_DEBUG_REPLACE_AWAIT_DATA - ${listName}] Awaiting external data.`);
      const necessaryDataPresent = isB30Target 
        ? (allMusicData && allMusicData.length > 0 && activeSongToReplace) 
        : (allPlayedNewSongsPool && allPlayedNewSongsPool.length > 0 && activeSongToReplace);

      if (necessaryDataPresent) {
        console.log(`[SIM_DEBUG_REPLACE_AWAIT_DATA - ${listName}] External data present. Moving to identify candidates.`);
        setCurrentPhase('identifying_candidates');
      } else {
          console.log(`[SIM_DEBUG_REPLACE_AWAIT_DATA - ${listName}] Waiting. AllMusic: ${allMusicData?.length}, AllPlayedNewPool: ${allPlayedNewSongsPool?.length}, SongToReplace: ${!!activeSongToReplace}`);
          if (!activeSongToReplace) { setCurrentPhase('error'); setSimulationTargetList('idle'); }
          // If data is missing and it's B30's turn, N20 might still be viable
          else if (isB30Target && (!allMusicData || allMusicData.length === 0)) {
             console.warn(`[SIM_DEBUG_REPLACE_AWAIT_DATA - B30] Missing allMusicData for B30 replacement. Switching to N20 simulation.`);
             setSimulationTargetList('n20'); setCurrentPhase('initializing_leap_phase');
          } 
          // If data is missing and it's N20's turn, then global error
          else if (!isB30Target && (!allPlayedNewSongsPool || allPlayedNewSongsPool.length === 0)) {
             console.error(`[SIM_DEBUG_REPLACE_AWAIT_DATA - N20] Missing allPlayedNewSongsPool for N20 replacement. Global error.`);
             setCurrentPhase('error'); setSimulationTargetList('idle');
          }
      }
    }

    if (currentPhase === 'identifying_candidates') {
      if (!activeSongToReplace) { setCurrentPhase('error'); setSimulationTargetList('idle'); return; }
      console.log(`[SIM_DEBUG_REPLACE_IDENTIFY - ${listName}] Identifying candidates for ${activeSongToReplace.title} (tR: ${activeSongToReplace.targetRating.toFixed(4)})`);
      
      let potentialCandidates: Song[] = [];
      if (isB30Target) {
          const currentB30IdsAndDiffs = new Set(simulatedB30Songs.map(s => `${s.id}_${s.diff}`));
          const newSongsTitlesLower = (NewSongsData.titles?.verse || []).map(t => t.trim().toLowerCase());
          potentialCandidates = allMusicData.filter(globalSong => {
            if (!globalSong.id || !globalSong.diff || !globalSong.title) return false;
            if (currentB30IdsAndDiffs.has(`${globalSong.id}_${globalSong.diff.toUpperCase()}`)) return false;
            if (newSongsTitlesLower.includes(globalSong.title.trim().toLowerCase())) return false;
            const tempSongObj = mapApiSongToAppSong(globalSong, 0, globalSong.const);
            if (!tempSongObj.chartConstant) return false;
            const scoreForMaxRating = isScoreLimitReleased ? 1010000 : 1009000;
            const potentialMaxRating = calculateChunithmSongRating(scoreForMaxRating, tempSongObj.chartConstant);
            return potentialMaxRating > activeSongToReplace.targetRating;
          }).map(apiEntry => {
            const playedVersion = userPlayHistory.find(p => p.id === apiEntry.id && p.diff.toUpperCase() === apiEntry.diff.toUpperCase());
            return mapApiSongToAppSong(playedVersion ? { ...apiEntry, score: playedVersion.score, rating: playedVersion.rating } : { ...apiEntry, score: 0, rating: 0 }, 0, apiEntry.const);
          }).filter(song => song.chartConstant !== null);
      } else { // N20 target
          const currentN20IdsAndDiffs = new Set(simulatedNew20Songs.map(s => `${s.id}_${s.diff}`));
          potentialCandidates = allPlayedNewSongsPool.filter(newSongPoolEntry => {
              if (currentN20IdsAndDiffs.has(`${newSongPoolEntry.id}_${newSongPoolEntry.diff}`)) return false;
              if (!newSongPoolEntry.chartConstant) return false;
              const scoreForMaxRating = isScoreLimitReleased ? 1010000 : 1009000;
              const potentialMaxRating = calculateChunithmSongRating(scoreForMaxRating, newSongPoolEntry.chartConstant);
              return potentialMaxRating > activeSongToReplace.targetRating;
          }); // allPlayedNewSongsPool is already Song[] type
      }
      
      setActiveCandidateSongsForReplacement(potentialCandidates);
      if (potentialCandidates.length > 0) setCurrentPhase('candidates_identified');
      else {
        console.warn(`[SIM_DEBUG_REPLACE_IDENTIFY - ${listName}] No replacement candidates found.`);
        if (isB30Target) { setSimulationTargetList('n20'); setCurrentPhase('initializing_leap_phase'); }
        else { setCurrentPhase('error'); setSimulationTargetList('idle'); }
      }
    }
    
    if (currentPhase === 'candidates_identified') {
        if (activeCandidateSongsForReplacement.length === 0 || !activeSongToReplace) {
            if (isB30Target) { setSimulationTargetList('n20'); setCurrentPhase('initializing_leap_phase'); }
            else { setCurrentPhase('error'); setSimulationTargetList('idle'); }
            return;
        }
        console.log(`[SIM_DEBUG_REPLACE_CANDIDATES_ID - ${listName}] ${activeCandidateSongsForReplacement.length} candidates for ${activeSongToReplace.title}. Selecting optimal.`);
        setCurrentPhase('selecting_optimal_candidate');
    }

    if (currentPhase === 'selecting_optimal_candidate') {
      if (!activeSongToReplace || activeCandidateSongsForReplacement.length === 0) { 
          if (isB30Target) { setSimulationTargetList('n20'); setCurrentPhase('initializing_leap_phase'); }
          else { setCurrentPhase('error'); setSimulationTargetList('idle'); }
          return; 
      }
      let bestCandidateInfo: { song: Song | null; effort: number; neededScore: number; resultingRating: number } = { song: null, effort: Infinity, neededScore: 0, resultingRating: 0 };
      activeCandidateSongsForReplacement.forEach(candidate => {
        if (!candidate.chartConstant) return; 
        const targetRatingForCandidate = activeSongToReplace.targetRating + 0.0001; 
        const minScoreInfo = findMinScoreForTargetRating(candidate, targetRatingForCandidate, isScoreLimitReleased);
        if (minScoreInfo.possible) {
          const effort = candidate.currentScore > 0 ? (minScoreInfo.score - candidate.currentScore) : minScoreInfo.score; 
          if (effort < bestCandidateInfo.effort || (effort === bestCandidateInfo.effort && minScoreInfo.rating > bestCandidateInfo.resultingRating)) {
            bestCandidateInfo = { song: candidate, effort, neededScore: minScoreInfo.score, resultingRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
          }
        }
      });

      if (bestCandidateInfo.song) {
        setActiveOptimalCandidateSong({ ...bestCandidateInfo.song, targetScore: bestCandidateInfo.neededScore, targetRating: bestCandidateInfo.resultingRating });
        setCurrentPhase('optimal_candidate_selected');
      } else {
        console.warn(`[SIM_DEBUG_REPLACE_SELECT_OPT - ${listName}] No optimal candidate found.`);
        if (isB30Target) { setSimulationTargetList('n20'); setCurrentPhase('initializing_leap_phase'); }
        else { setCurrentPhase('error'); setSimulationTargetList('idle'); }
      }
    }

    if (currentPhase === 'optimal_candidate_selected') {
        if (!activeOptimalCandidateSong || !activeSongToReplace) {
             if (isB30Target) { setSimulationTargetList('n20'); setCurrentPhase('initializing_leap_phase'); }
             else { setCurrentPhase('error'); setSimulationTargetList('idle'); }
             return;
        }
        setCurrentPhase('replacing_song');
    }

    if (currentPhase === 'replacing_song') {
      if (!activeOptimalCandidateSong || !activeSongToReplace) { 
          if (isB30Target) { setSimulationTargetList('n20'); setCurrentPhase('initializing_leap_phase'); }
          else { setCurrentPhase('error'); setSimulationTargetList('idle'); }
          return; 
      }
      console.log(`[SIM_DEBUG_REPLACE_PERFORM - ${listName}] Replacing ${activeSongToReplace.title} with ${activeOptimalCandidateSong.title}`);
      const updatedList = activeSimulatedList.filter(s => !(s.id === activeSongToReplace.id && s.diff === activeSongToReplace.diff));
      updatedList.push({ ...activeOptimalCandidateSong });
      setActiveSimulatedList(updatedList); 
      setActiveSongToReplace(null); setActiveOptimalCandidateSong(null); setActiveCandidateSongsForReplacement([]);
      setCurrentPhase('initializing_leap_phase'); // Restart simulation for the current list
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentPhase, isLoadingSongs, calculationStrategy, simulationTargetList, 
    targetRatingDisplay, currentRatingDisplay, phaseTransitionPoint, isScoreLimitReleased,
    // B30 states
    simulatedB30Songs, originalB30SongsData, simulatedAverageB30Rating,
    sortedPrimaryLeapCandidatesB30, fineTuningCandidateSongsB30,
    songToReplaceB30, candidateSongsForReplacementB30, optimalCandidateSongB30,
    // N20 states
    simulatedNew20Songs, originalNew20SongsData, simulatedAverageNew20Rating,
    allPlayedNewSongsPool, userPlayHistory, allMusicData, /* Added allMusicData and userPlayHistory here */
    sortedPrimaryLeapCandidatesN20, fineTuningCandidateSongsN20,
    songToReplaceN20, candidateSongsForReplacementN20, optimalCandidateSongN20,
  ]);


  return {
    apiPlayerName,
    best30SongsData: simulatedB30Songs.length > 0 
      ? simulatedB30Songs 
      : (originalB30SongsData.length > 0 
          ? originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating }))
          : []),
    new20SongsData: simulatedNew20Songs.length > 0
      ? simulatedNew20Songs
      : (originalNew20SongsData.length > 0
          ? originalNew20SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating }))
          : []),
    combinedTopSongs,
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    isScoreLimitReleased,
    phaseTransitionPoint,
    currentPhase,
    simulatedAverageB30Rating,
    simulatedAverageNew20Rating, // expose this
  };
}


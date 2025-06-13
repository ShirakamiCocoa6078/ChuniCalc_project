
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateChunithmSongRating, getNextGradeBoundaryScore, findMinScoreForTargetRating } from '@/lib/rating-utils';
import type { Song, ProfileData, RatingApiResponse, GlobalMusicApiResponse, UserShowallApiResponse, ShowallApiSongEntry, RatingApiSongEntry, CalculationStrategy } from "@/types/result-page";

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;

type SimulationPhase =
  | 'idle'
  | 'initializing_leap_phase'
  | 'analyzing_leap_efficiency'
  | 'performing_leap_jump'
  | 'evaluating_leap_result'
  | 'transitioning_to_fine_tuning'
  | 'initializing_fine_tuning_phase'
  | 'performing_fine_tuning'
  | 'evaluating_fine_tuning_result'
  | 'target_reached'
  | 'stuck_awaiting_replacement' 
  | 'awaiting_external_data_for_replacement'
  | 'identifying_candidates'
  | 'candidates_identified'
  | 'selecting_optimal_candidate'
  | 'optimal_candidate_selected'
  | 'replacing_song'
  | 'error';


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

  const [leapTargetGroup, setLeapTargetGroup] = useState<Song[]>([]);
  const [songsWithLeapEfficiency, setSongsWithLeapEfficiency] = useState<Array<Song & { leapEfficiency?: number; scoreToReachNextGrade?: number; ratingAtNextGrade?: number }>>([]);
  
  const [fineTuningPrimaryGroup, setFineTuningPrimaryGroup] = useState<Song[]>([]);
  const [fineTuningExpansionGroup, setFineTuningExpansionGroup] = useState<Song[]>([]);


  const [allMusicData, setAllMusicData] = useState<ShowallApiSongEntry[]>([]);
  const [userPlayHistory, setUserPlayHistory] = useState<ShowallApiSongEntry[]>([]);

  const [songToReplace, setSongToReplace] = useState<Song | null>(null);
  const [candidateSongsForReplacement, setCandidateSongsForReplacement] = useState<Song[]>([]);
  const [optimalCandidateSong, setOptimalCandidateSong] = useState<Song | null>(null);

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
      
      if (!calculationStrategy && currentPhase !== 'idle') {
        setCurrentPhase('idle');
        setSimulatedB30Songs([...originalB30SongsData]); 
      } else if (calculationStrategy && currentPhase === 'idle' && originalB30SongsData.length > 0) {
        setSimulatedB30Songs([...originalB30SongsData]);
      }


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
      let globalMusicCache = getCachedData<GlobalMusicApiResponse>(globalMusicKey, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
      let userShowallCache = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);

      if (profileData) setApiPlayerName(profileData.player_name || userNameForApi);
      console.log(`[DATA_FETCH] Cache status - Profile: ${!!profileData}, Rating: ${!!ratingData}, GlobalMusic: ${!!globalMusicCache}, UserShowall: ${!!userShowallCache}`);

      let initialB30ApiEntries: RatingApiSongEntry[] = [];
      if (ratingData?.best?.entries) {
        initialB30ApiEntries = ratingData.best.entries.filter((e: any): e is RatingApiSongEntry => e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && typeof e.title === 'string' && e.title.trim() !== '') || [];
      }
      
      let tempGlobalMusicRecords: ShowallApiSongEntry[] = globalMusicCache?.records || [];
      let tempUserShowallRecords: ShowallApiSongEntry[] = userShowallCache?.records || [];

      if (!profileData || !ratingData || !globalMusicCache || !userShowallCache) {
        console.log("[DATA_FETCH] Cache miss for one or more items. Fetching from API.");
        const apiRequestsMap = new Map<string, Promise<any>>();
        if (!profileData) apiRequestsMap.set('profile', fetch(`https://api.chunirec.net/2.0/records/profile.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'profile', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'profile', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!ratingData) apiRequestsMap.set('rating', fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'rating', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'rating', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!globalMusicCache) apiRequestsMap.set('globalMusic', fetch(`https://api.chunirec.net/2.0/music/showall.json?region=jp2&token=${API_TOKEN}`).then(res => res.json().then(data => ({ type: 'globalMusic', data, ok: res.ok, status: res.status })).catch(() => ({ type: 'globalMusic', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
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
              if (res.type === 'globalMusic' && !globalMusicCache) {
                tempGlobalMusicRecords = Array.isArray(res.data) ? res.data : (res.data?.records || []); 
                setCachedData<GlobalMusicApiResponse>(globalMusicKey, { records: tempGlobalMusicRecords }, GLOBAL_MUSIC_CACHE_EXPIRY_MS); 
                globalMusicCache = { records: tempGlobalMusicRecords };
              }
              if (res.type === 'userShowall' && !userShowallCache) {
                tempUserShowallRecords = Array.isArray(res.data) ? res.data : (res.data?.records || []);
                setCachedData<UserShowallApiResponse>(userShowallKey, { records: tempUserShowallRecords });
                userShowallCache = { records: tempUserShowallRecords };
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
        toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
      }

      const mappedOriginalB30 = sortSongsByRatingDesc(initialB30ApiEntries.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
      setOriginalB30SongsData(mappedOriginalB30);
      setSimulatedB30Songs([...mappedOriginalB30]); 
      console.log(`[DATA_FETCH] Original B30 songs mapped: ${mappedOriginalB30.length}`);

      const currentGlobalMusic = globalMusicCache?.records || [];
      const currentUserShowall = userShowallCache?.records || [];

      setAllMusicData(currentGlobalMusic);
      setUserPlayHistory(currentUserShowall);
      console.log(`[DATA_FETCH] Global music records: ${currentGlobalMusic.length}, User showall records: ${currentUserShowall.length}`);
      
      if (currentGlobalMusic.length > 0 && currentUserShowall.length > 0) {
        console.log("[NEW20_PROCESS] Starting New20 processing.");
        const newSongTitlesRaw = NewSongsData.titles?.verse || [];
        const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());
        console.log(`[NEW20_PROCESS] Titles from NewSongs.json: ${newSongTitlesToMatch.length}`);

        const newSongDefinitions = currentGlobalMusic.filter(globalSong =>
          globalSong.title && newSongTitlesToMatch.includes(globalSong.title.trim().toLowerCase())
        );
        console.log(`[NEW20_PROCESS] Matched new song definitions from global music: ${newSongDefinitions.length}`);

        const userPlayedMap = new Map<string, ShowallApiSongEntry>();
        currentUserShowall.forEach(usrSong => {
          if (usrSong.id && usrSong.diff) userPlayedMap.set(`${usrSong.id}_${usrSong.diff.toUpperCase()}`, usrSong);
        });
        console.log(`[NEW20_PROCESS] User played map created with ${userPlayedMap.size} entries.`);

        const playedNewSongsApi = newSongDefinitions.reduce((acc, newSongDef) => {
          const userPlayRecord = userPlayedMap.get(`${newSongDef.id}_${newSongDef.diff.toUpperCase()}`);
          if (userPlayRecord && typeof userPlayRecord.score === 'number' && userPlayRecord.score >= 800000) {
            acc.push({ 
              ...newSongDef, 
              score: userPlayRecord.score, 
              rating: userPlayRecord.rating, 
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
        if(finalNew20.length === 0 && newSongDefinitions.length > 0 && currentUserShowall.length > 0) {
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
    if (!isLoadingSongs) {
      const baseB30ForCombined = simulatedB30Songs.length > 0 ? simulatedB30Songs : originalB30SongsData;
      if (baseB30ForCombined.length > 0 || new20SongsData.length > 0) {
        const songMap = new Map<string, Song>();
        baseB30ForCombined.forEach(song => songMap.set(`${song.id}_${song.diff}`, { ...song }));
        new20SongsData.forEach(song => { 
            const key = `${song.id}_${song.diff}`; 
            if (!songMap.has(key) || (songMap.has(key) && song.currentRating > songMap.get(key)!.currentRating)) {
                songMap.set(key, { ...song });
            }
        });
        setCombinedTopSongs(sortSongsByRatingDesc(Array.from(songMap.values())));
      } else { setCombinedTopSongs([]); }
    }
  }, [originalB30SongsData, new20SongsData, simulatedB30Songs, isLoadingSongs]);

  useEffect(() => {
    if (simulatedB30Songs.length > 0) {
      const topSongsForAvg = sortSongsByRatingDesc([...simulatedB30Songs].map(s => ({...s, currentRating: s.targetRating}))).slice(0, BEST_COUNT);
      const newAverage = topSongsForAvg.reduce((sum, s) => sum + s.targetRating, 0) / Math.min(BEST_COUNT, topSongsForAvg.length);
      const newAverageFixed = parseFloat(newAverage.toFixed(4));
      setSimulatedAverageB30Rating(newAverageFixed);
      console.log(`[SIM_DEBUG_AVG_RATING] Calculated new average B30 rating: ${newAverageFixed} from ${topSongsForAvg.length} songs. Top song tR: ${topSongsForAvg[0]?.targetRating}`);
    } else if (originalB30SongsData.length > 0 && simulatedB30Songs.length === 0 && !isLoadingSongs) {
      const topOriginalSongs = sortSongsByRatingDesc([...originalB30SongsData]).slice(0, BEST_COUNT);
      const originalAverage = topOriginalSongs.reduce((sum, s) => sum + s.currentRating, 0) / Math.min(BEST_COUNT, topOriginalSongs.length);
      setSimulatedAverageB30Rating(parseFloat(originalAverage.toFixed(4)));
       console.log(`[SIM_DEBUG_AVG_RATING] Initial average B30 rating from original data: ${parseFloat(originalAverage.toFixed(4))}`);
    } else {
      setSimulatedAverageB30Rating(null);
    }
  }, [simulatedB30Songs, originalB30SongsData, isLoadingSongs]);

  useEffect(() => {
    if (!isLoadingSongs && originalB30SongsData.length > 0 && calculationStrategy && currentPhase === 'idle' &&
      currentRatingDisplay && targetRatingDisplay && parseFloat(currentRatingDisplay) < parseFloat(targetRatingDisplay)) {
      setSimulatedB30Songs([...originalB30SongsData].map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating}))); 
      setCurrentPhase('initializing_leap_phase');
      console.log("[SIM_DEBUG_PHASE_CHANGE] Idle -> Initializing Leap Phase. Strategy selected, B30 songs reset to original.");
    } else if (!calculationStrategy && currentPhase !== 'idle') {
      setCurrentPhase('idle');
      setSimulatedB30Songs([...originalB30SongsData].map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating})));
      console.log("[SIM_DEBUG_PHASE_CHANGE] Strategy deselected. Resetting to Idle and original B30 data.");
    }
  }, [isLoadingSongs, originalB30SongsData, calculationStrategy, currentPhase, currentRatingDisplay, targetRatingDisplay]);

  useEffect(() => {
    if (currentPhase === 'initializing_leap_phase' && !isLoadingSongs && simulatedB30Songs.length > 0 && calculationStrategy) {
      console.log("[SIM_DEBUG_LEAP_INIT] Phase: Initializing Leap. Full B30 before filtering:", simulatedB30Songs.map(s => ({t:s.title, id:s.id, d:s.diff, cS:s.currentScore, cR:s.currentRating, tS:s.targetScore, tR:s.targetRating})));
      const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;
      const updatable = simulatedB30Songs.filter(song => song.targetScore < scoreCap);
      console.log(`[SIM_DEBUG_LEAP_INIT] Updatable songs for Leap Phase (targetScore < ${scoreCap}): ${updatable.length}`, updatable.map(s => ({t:s.title, tS:s.targetScore, tR:s.targetRating})));

      if (updatable.length === 0) {
        console.log("[SIM_DEBUG_LEAP_INIT] No updatable songs found. Moving to stuck/replacement.");
        setCurrentPhase('stuck_awaiting_replacement'); return;
      }

      let determinedLeapTargetGroup: Song[] = [];
      const sortedUpdatableForMedian = [...updatable].sort((a, b) => a.targetRating - b.targetRating);
      let medianRating: number;

      if (sortedUpdatableForMedian.length === 0) { medianRating = 0; }
      else if (sortedUpdatableForMedian.length % 2 === 0) {
        const mid1 = sortedUpdatableForMedian[sortedUpdatableForMedian.length / 2 - 1].targetRating;
        const mid2 = sortedUpdatableForMedian[sortedUpdatableForMedian.length / 2].targetRating;
        medianRating = (mid1 + mid2) / 2;
      } else {
        medianRating = sortedUpdatableForMedian[Math.floor(sortedUpdatableForMedian.length / 2)].targetRating;
      }
      console.log(`[SIM_DEBUG_LEAP_INIT] Median targetRating of updatable songs: ${medianRating.toFixed(4)}`);

      if (calculationStrategy === 'floor') {
        determinedLeapTargetGroup = updatable.filter(song => song.targetRating <= medianRating);
         console.log(`[SIM_DEBUG_LEAP_INIT] Leap Target Group (Floor Strategy - tR <= median): ${determinedLeapTargetGroup.length} songs.`, determinedLeapTargetGroup.map(s => ({t:s.title, tR:s.targetRating})));
      } else if (calculationStrategy === 'peak') {
        determinedLeapTargetGroup = updatable.filter(song => song.targetRating > medianRating);
         console.log(`[SIM_DEBUG_LEAP_INIT] Leap Target Group (Peak Strategy - tR > median): ${determinedLeapTargetGroup.length} songs.`, determinedLeapTargetGroup.map(s => ({t:s.title, tR:s.targetRating})));
      }

      setLeapTargetGroup(determinedLeapTargetGroup);

      if (determinedLeapTargetGroup.length > 0) setCurrentPhase('analyzing_leap_efficiency');
      else {
        console.log("[SIM_DEBUG_LEAP_INIT] Determined leap target group is empty. Moving to stuck/replacement.");
        setCurrentPhase('stuck_awaiting_replacement');
      }
    }
  }, [currentPhase, isLoadingSongs, simulatedB30Songs, calculationStrategy, isScoreLimitReleased]);

  useEffect(() => {
    if (currentPhase === 'analyzing_leap_efficiency' && leapTargetGroup.length > 0) {
      console.log("[SIM_DEBUG_LEAP_ANALYZE] Phase: Analyzing Leap Efficiency. Target group:", leapTargetGroup.map(s => ({t:s.title, tS:s.targetScore, tR:s.targetRating, const:s.chartConstant})));
      const songsWithCalculatedEfficiency = leapTargetGroup.map(song => {
        const nextGradeScore = getNextGradeBoundaryScore(song.targetScore);
        let leapEfficiency = 0; let scoreToReachNextGrade: number | undefined = undefined; let ratingAtNextGrade: number | undefined = undefined;

        if (song.chartConstant && nextGradeScore && song.targetScore < nextGradeScore) {
          const currentSongRating = song.targetRating;
          const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, song.chartConstant);
          const ratingIncrease = potentialRatingAtNextGrade - currentSongRating;
          const scoreIncrease = nextGradeScore - song.targetScore;
          if (scoreIncrease > 0 && ratingIncrease > 0) leapEfficiency = ratingIncrease / scoreIncrease;
          scoreToReachNextGrade = nextGradeScore; ratingAtNextGrade = potentialRatingAtNextGrade;
        }
        return { ...song, leapEfficiency, scoreToReachNextGrade, ratingAtNextGrade };
      }).filter(s => s.leapEfficiency !== undefined && s.leapEfficiency > 0);
      
      console.log("[SIM_DEBUG_LEAP_ANALYZE] Songs with calculated Leap Efficiency (filtered for >0 efficiency):", songsWithCalculatedEfficiency.map(s=> ({t:s.title, eff:s.leapEfficiency, nextS:s.scoreToReachNextGrade, nextR:s.ratingAtNextGrade })));
      setSongsWithLeapEfficiency(songsWithCalculatedEfficiency);

      if (songsWithCalculatedEfficiency.length > 0) setCurrentPhase('performing_leap_jump');
      else { 
        console.log("[SIM_DEBUG_LEAP_ANALYZE] No songs with positive leap efficiency. Moving to stuck/replacement.");
        setCurrentPhase('stuck_awaiting_replacement'); 
      }
    }
  }, [currentPhase, leapTargetGroup]);

  useEffect(() => {
    if (currentPhase === 'performing_leap_jump' && songsWithLeapEfficiency.length > 0 && simulatedB30Songs.length > 0) {
      console.log("[SIM_DEBUG_LEAP_PERFORM] Phase: Performing Leap Jump. Songs with efficiency before sort:", songsWithLeapEfficiency.map(s=>({t:s.title, tR: s.targetRating, eff:s.leapEfficiency})));

      let optimalLeapSong: (Song & { leapEfficiency?: number; scoreToReachNextGrade?: number; ratingAtNextGrade?: number }) | null = null;

      if (calculationStrategy === 'floor') {
        const sortedFloorGroupForLeap = [...songsWithLeapEfficiency].sort((a, b) => {
          if (a.targetRating !== b.targetRating) {
            return a.targetRating - b.targetRating; // Ascending targetRating (lowest first)
          }
          return (b.leapEfficiency || 0) - (a.leapEfficiency || 0); // Descending leapEfficiency as tie-breaker
        });
        optimalLeapSong = sortedFloorGroupForLeap[0];
        console.log("[SIM_DEBUG_LEAP_PERFORM] Floor Strategy: Sorted for optimal leap:", sortedFloorGroupForLeap.map(s=>({t:s.title, tR: s.targetRating, eff:s.leapEfficiency})));
      } else if (calculationStrategy === 'peak') {
         // For 'peak', keep original logic: highest efficiency from its target group.
        const sortedByEfficiency = [...songsWithLeapEfficiency].sort((a, b) => (b.leapEfficiency || 0) - (a.leapEfficiency || 0));
        optimalLeapSong = sortedByEfficiency[0];
        console.log("[SIM_DEBUG_LEAP_PERFORM] Peak Strategy: Sorted for optimal leap (by efficiency):", sortedByEfficiency.map(s=>({t:s.title, tR: s.targetRating, eff:s.leapEfficiency})));
      }


      if (!optimalLeapSong || typeof optimalLeapSong.scoreToReachNextGrade !== 'number' || typeof optimalLeapSong.ratingAtNextGrade !== 'number') {
        console.log("[SIM_DEBUG_LEAP_PERFORM] No valid optimal leap song found. Moving to stuck/replacement.");
        setCurrentPhase('stuck_awaiting_replacement'); return;
      }
      console.log("[SIM_DEBUG_LEAP_PERFORM] Optimal leap song chosen:", {title: optimalLeapSong.title, diff: optimalLeapSong.diff, currentScore: optimalLeapSong.currentScore, currentRating: optimalLeapSong.currentRating, targetScore: optimalLeapSong.scoreToReachNextGrade, targetRating: optimalLeapSong.ratingAtNextGrade});

      const newSimulatedB30 = simulatedB30Songs.map(song => {
        if (song.id === optimalLeapSong!.id && song.diff === optimalLeapSong!.diff) {
          return {
            ...song,
            targetScore: optimalLeapSong!.scoreToReachNextGrade!,
            targetRating: optimalLeapSong!.ratingAtNextGrade!,
          };
        }
        return song;
      });
      setSimulatedB30Songs(newSimulatedB30); 
      setSongsWithLeapEfficiency([]); 
      setLeapTargetGroup([]); 
      setCurrentPhase('evaluating_leap_result');
    } else if (currentPhase === 'performing_leap_jump' && songsWithLeapEfficiency.length === 0) {
      console.log("[SIM_DEBUG_LEAP_PERFORM] No songs with efficiency to perform leap. Moving to stuck/replacement.");
      setCurrentPhase('stuck_awaiting_replacement');
    }
  }, [currentPhase, songsWithLeapEfficiency, simulatedB30Songs, calculationStrategy]);
  
  useEffect(() => {
    if (currentPhase === 'evaluating_leap_result' && simulatedAverageB30Rating !== null && targetRatingDisplay && phaseTransitionPoint !== null) {
      const targetRatingNum = parseFloat(targetRatingDisplay);
      console.log(`[SIM_DEBUG_LEAP_EVAL] Phase: Evaluating Leap. Avg B30: ${simulatedAverageB30Rating.toFixed(4)}, Target: ${targetRatingNum.toFixed(4)}, Transition Pt: ${phaseTransitionPoint.toFixed(4)}`);

      if (simulatedAverageB30Rating >= targetRatingNum) {
        console.log("[SIM_DEBUG_LEAP_EVAL] Target Reached.");
        setCurrentPhase('target_reached');
      } else if (simulatedAverageB30Rating >= phaseTransitionPoint) {
         console.log("[SIM_DEBUG_LEAP_EVAL] Transitioning to Fine-Tuning.");
        setCurrentPhase('transitioning_to_fine_tuning');
      } else {
        console.log("[SIM_DEBUG_LEAP_EVAL] Continuing Leap Phase.");
        setCurrentPhase('initializing_leap_phase');
      }
    }
  }, [currentPhase, simulatedAverageB30Rating, targetRatingDisplay, phaseTransitionPoint]);

  useEffect(() => {
    if (currentPhase === 'transitioning_to_fine_tuning') {
      setCurrentPhase('initializing_fine_tuning_phase');
    }
  }, [currentPhase]);

  useEffect(() => {
    if (currentPhase === 'initializing_fine_tuning_phase' && simulatedB30Songs.length > 0 && calculationStrategy) {
      console.log("[SIM_DEBUG_FINE_TUNING_INIT] Phase: Initializing Fine-Tuning. Full B30 before filtering:", simulatedB30Songs.map(s => ({t:s.title,id:s.id,d:s.diff,cS:s.currentScore,cR:s.currentRating,tS:s.targetScore,tR:s.targetRating})));
      const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;
      const updatableSongs = simulatedB30Songs.filter(song => song.targetScore < scoreCap);
      console.log(`[SIM_DEBUG_FINE_TUNING_INIT] Updatable songs for Fine-Tuning (targetScore < ${scoreCap}): ${updatableSongs.length}`, updatableSongs.map(s => ({t:s.title, tS:s.targetScore, tR:s.targetRating})));

      if (updatableSongs.length === 0) {
        console.log("[SIM_DEBUG_FINE_TUNING_INIT] No updatable songs. Moving to stuck/replacement.");
        setCurrentPhase('stuck_awaiting_replacement'); return;
      }

      const sortedUpdatable = [...updatableSongs].sort((a, b) => a.targetRating - b.targetRating);
      let medianRating: number;
      if (sortedUpdatable.length === 0) { medianRating = 0; }
      else if (sortedUpdatable.length % 2 === 0) {
        medianRating = (sortedUpdatable[sortedUpdatable.length / 2 - 1].targetRating + sortedUpdatable[sortedUpdatable.length / 2].targetRating) / 2;
      } else {
        medianRating = sortedUpdatable[Math.floor(sortedUpdatable.length / 2)].targetRating;
      }
      console.log(`[SIM_DEBUG_FINE_TUNING_INIT] Median targetRating of updatable songs: ${medianRating.toFixed(4)}`);

      let primaryGroup: Song[] = [];
      let expansionGroup: Song[] = [];

      if (calculationStrategy === 'floor') {
        primaryGroup = updatableSongs.filter(s => s.targetRating <= medianRating);
        expansionGroup = updatableSongs.filter(s => s.targetRating > medianRating);
        console.log(`[SIM_DEBUG_FINE_TUNING_INIT] Floor Strategy - Primary (tR <= median): ${primaryGroup.length} songs. Expansion (tR > median): ${expansionGroup.length} songs.`);
      } else if (calculationStrategy === 'peak') {
        primaryGroup = updatableSongs.filter(s => s.targetRating > medianRating);
        expansionGroup = updatableSongs.filter(s => s.targetRating <= medianRating);
        console.log(`[SIM_DEBUG_FINE_TUNING_INIT] Peak Strategy - Primary (tR > median): ${primaryGroup.length} songs. Expansion (tR <= median): ${expansionGroup.length} songs.`);
      }
      
      setFineTuningPrimaryGroup(primaryGroup);
      setFineTuningExpansionGroup(expansionGroup);

      if (primaryGroup.length > 0 || expansionGroup.length > 0) {
        setCurrentPhase('performing_fine_tuning');
      } else {
        console.log("[SIM_DEBUG_FINE_TUNING_INIT] Both primary and expansion groups for fine-tuning are empty. Moving to stuck/replacement.");
        setCurrentPhase('stuck_awaiting_replacement');
      }
    }
  }, [currentPhase, simulatedB30Songs, calculationStrategy, isScoreLimitReleased]);

  useEffect(() => {
    if (currentPhase === 'performing_fine_tuning' && calculationStrategy) {
      console.log("[SIM_DEBUG_FINE_TUNING_PERFORM] Phase: Performing Fine-Tuning.");
      let newSimulatedB30Songs = [...simulatedB30Songs];
      const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;
      let songsWereUpdated = false;

      let groupToTune: Song[] = [];
      if (fineTuningPrimaryGroup.length > 0) {
        groupToTune = [...fineTuningPrimaryGroup];
        console.log(`[SIM_DEBUG_FINE_TUNING_PERFORM] Using primary group (${calculationStrategy} strategy): ${groupToTune.length} songs.`);
      } else if (fineTuningExpansionGroup.length > 0) {
        groupToTune = [...fineTuningExpansionGroup];
        console.log(`[SIM_DEBUG_FINE_TUNING_PERFORM] Primary group empty, using expansion group (${calculationStrategy} strategy): ${groupToTune.length} songs.`);
      } else {
        console.log("[SIM_DEBUG_FINE_TUNING_PERFORM] No songs in primary or expansion group for fine-tuning. Moving to stuck/replacement.");
        setCurrentPhase('stuck_awaiting_replacement');
        return;
      }
      
      // Sort the group to be tuned based on strategy
      let sortedGroupToTune: Song[];
      if (calculationStrategy === 'floor') {
        sortedGroupToTune = [...groupToTune].sort((a, b) => {
          if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating; // Ascending targetRating
          return a.currentScore - b.currentScore; // Tie-breaker
        });
        console.log("[SIM_DEBUG_FINE_TUNING_PERFORM] Floor Strategy: Sorted group for tuning (lowest tR first):", sortedGroupToTune.map(s => ({ t: s.title, r: s.targetRating.toFixed(4), s: s.targetScore })));
      } else { // 'peak'
        sortedGroupToTune = [...groupToTune].sort((a,b) => {
            if (a.targetRating !== b.targetRating) return b.targetRating - a.targetRating; // Descending targetRating for peak
            return b.currentScore - a.currentScore; // Tie-breaker
        });
        console.log("[SIM_DEBUG_FINE_TUNING_PERFORM] Peak Strategy: Sorted group for tuning (highest tR first):", sortedGroupToTune.map(s => ({ t: s.title, r: s.targetRating.toFixed(4), s: s.targetScore })));
      }


      sortedGroupToTune.forEach(songFromGroup => {
        const songIndexInSimulated = newSimulatedB30Songs.findIndex(s => s.id === songFromGroup.id && s.diff === songFromGroup.diff);
        if (songIndexInSimulated === -1) { 
          console.warn(`[SIM_DEBUG_FINE_TUNING_PERFORM] Song ${songFromGroup.title} (${songFromGroup.diff}) from tuning group not found in simulatedB30. Skipping.`);
          return; 
        }

        let currentSongInSim = newSimulatedB30Songs[songIndexInSimulated];
        if (currentSongInSim.targetScore < scoreCap && currentSongInSim.chartConstant) {
          // Attempt to increase rating by a very small amount
          const targetMicroTuneRating = currentSongInSim.targetRating + 0.0001; 
          const minScoreInfo = findMinScoreForTargetRating(currentSongInSim, targetMicroTuneRating, isScoreLimitReleased);

          if (minScoreInfo.possible && minScoreInfo.score > currentSongInSim.targetScore && minScoreInfo.score <= scoreCap) {
            const updatedSong = {
              ...currentSongInSim,
              targetScore: minScoreInfo.score, 
              targetRating: minScoreInfo.rating,
            };
            newSimulatedB30Songs[songIndexInSimulated] = updatedSong;
            songsWereUpdated = true;
            console.log(`[SIM_DEBUG_FINE_TUNING_PERFORM] Updated ${updatedSong.title} (${updatedSong.diff}): tS ${currentSongInSim.targetScore} -> ${updatedSong.targetScore}, tR ${currentSongInSim.targetRating.toFixed(4)} -> ${updatedSong.targetRating.toFixed(4)}`);
          }
        }
      });
      
      if (!songsWereUpdated && fineTuningPrimaryGroup.length > 0 && fineTuningExpansionGroup.length > 0) {
         // If primary group had no updates, and expansion group exists, try expansion group next iteration
         console.log("[SIM_DEBUG_FINE_TUNING_PERFORM] No updates in primary group, will try expansion group if available in next fine-tuning init.");
         setFineTuningPrimaryGroup([]); // Empty primary to force expansion next time
      } else if (!songsWereUpdated) {
        console.log("[SIM_DEBUG_FINE_TUNING_PERFORM] No songs were updated in this fine-tuning pass. Moving to stuck/replacement.");
        setCurrentPhase('stuck_awaiting_replacement');
        return;
      }
      
      setSimulatedB30Songs(newSimulatedB30Songs); // sort is done in average calculation effect
      setCurrentPhase('evaluating_fine_tuning_result');
    }
  }, [currentPhase, calculationStrategy, fineTuningPrimaryGroup, fineTuningExpansionGroup, isScoreLimitReleased, simulatedB30Songs]);

  useEffect(() => {
    if (currentPhase === 'evaluating_fine_tuning_result' && simulatedAverageB30Rating !== null && targetRatingDisplay) {
      const targetRatingNum = parseFloat(targetRatingDisplay);
      console.log(`[SIM_DEBUG_FINE_TUNING_EVAL] Phase: Evaluating Fine-Tuning. Avg B30: ${simulatedAverageB30Rating.toFixed(4)}, Target: ${targetRatingNum.toFixed(4)}`);

      if (simulatedAverageB30Rating >= targetRatingNum) {
        console.log("[SIM_DEBUG_FINE_TUNING_EVAL] Target Reached.");
        setCurrentPhase('target_reached');
      } else {
        const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;
        const canStillFineTune = simulatedB30Songs.some(s => s.targetScore < scoreCap);
        if (canStillFineTune) {
          console.log("[SIM_DEBUG_FINE_TUNING_EVAL] Can still fine-tune. Re-initializing fine-tuning phase.");
          setCurrentPhase('initializing_fine_tuning_phase');
        } else {
          console.log("[SIM_DEBUG_FINE_TUNING_EVAL] Cannot fine-tune further. Moving to stuck/replacement.");
          setCurrentPhase('stuck_awaiting_replacement');
        }
      }
    }
  }, [currentPhase, simulatedAverageB30Rating, targetRatingDisplay, simulatedB30Songs, isScoreLimitReleased]);

  useEffect(() => {
    if (currentPhase === 'stuck_awaiting_replacement' && simulatedB30Songs.length > 0) {
      const sortedB30ForReplacement = [...simulatedB30Songs].sort((a, b) => a.targetRating - b.targetRating); // Sort by targetRating to find lowest
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
      if (allMusicData.length > 0 && userPlayHistory.length > 0 && songToReplace) {
         console.log("[SIM_DEBUG_REPLACE_AWAIT_DATA] External data (allMusic, userHistory) and songToReplace are present. Moving to identify candidates.");
        setCurrentPhase('identifying_candidates');
      } else if (!songToReplace) {
        console.error("[SIM_DEBUG_REPLACE_AWAIT_DATA] songToReplace is null. Error.");
        setCurrentPhase('error');
      } else {
          console.log(`[SIM_DEBUG_REPLACE_AWAIT_DATA] Waiting. AllMusic: ${allMusicData.length}, UserHistory: ${userPlayHistory.length}, SongToReplace: ${!!songToReplace}`);
      }
    }
  }, [currentPhase, allMusicData, userPlayHistory, songToReplace]);

  useEffect(() => {
    if (currentPhase === 'identifying_candidates' && songToReplace && allMusicData.length > 0) {
      console.log(`[SIM_DEBUG_REPLACE_IDENTIFY] Identifying replacement candidates for ${songToReplace.title} (tR: ${songToReplace.targetRating.toFixed(4)}).`);
      const currentB30IdsAndDiffs = new Set(simulatedB30Songs.map(s => `${s.id}_${s.diff}`));
      
      const potentialCandidatesApi = allMusicData.filter(globalSong => {
        if (!globalSong.id || !globalSong.diff || !globalSong.title) return false;
        const songKey = `${globalSong.id}_${globalSong.diff.toUpperCase()}`;
        if (currentB30IdsAndDiffs.has(songKey)) return false; // Already in B30
        
        // Use a temporary AppSong-like object to check potential max rating
        const tempSongObjForConst = mapApiSongToAppSong(globalSong, 0, globalSong.const);
        if (!tempSongObjForConst.chartConstant) return false; // Skip if no valid chart constant
        
        // Potential max rating for this global song (if SSS+)
        const potentialMaxRating = calculateChunithmSongRating(1009000, tempSongObjForConst.chartConstant);
        return potentialMaxRating > songToReplace.targetRating; // Only consider if it can potentially exceed the song being replaced
      });
      console.log(`[SIM_DEBUG_REPLACE_IDENTIFY] Found ${potentialCandidatesApi.length} potential candidates from allMusicData after initial filter.`);

      const mappedCandidates = potentialCandidatesApi.map(apiEntry => {
        const playedVersion = userPlayHistory.find(p => p.id === apiEntry.id && p.diff.toUpperCase() === apiEntry.diff.toUpperCase());
        const songWithScore = playedVersion ? { ...apiEntry, score: playedVersion.score, rating: playedVersion.rating } : { ...apiEntry, score: 0, rating: 0 };
        return mapApiSongToAppSong(songWithScore, 0, apiEntry.const); 
      });
      console.log(`[SIM_DEBUG_REPLACE_IDENTIFY] Mapped ${mappedCandidates.length} candidates to AppSong format. Sample:`, mappedCandidates.slice(0,2).map(s=>({t:s.title, cS:s.currentScore, cR:s.currentRating, const:s.chartConstant })));

      setCandidateSongsForReplacement(mappedCandidates);
      if (mappedCandidates.length > 0) {
        setCurrentPhase('candidates_identified');
      } else {
        console.warn("[SIM_DEBUG_REPLACE_IDENTIFY] No replacement candidates found. Possibly stuck permanently or target too high.");
        setCurrentPhase('error'); 
      }
    } else if (currentPhase === 'identifying_candidates' && (!songToReplace || allMusicData.length === 0)) {
      console.error("[SIM_DEBUG_REPLACE_IDENTIFY] Error state: songToReplace is null or allMusicData is empty.");
      setCurrentPhase('error');
    }
  }, [currentPhase, songToReplace, allMusicData, userPlayHistory, simulatedB30Songs]);
  
  useEffect(() => {
    if (currentPhase === 'candidates_identified' && songToReplace && candidateSongsForReplacement.length > 0) {
        console.log(`[SIM_DEBUG_REPLACE_CANDIDATES_ID] ${candidateSongsForReplacement.length} candidates identified for ${songToReplace.title}. Moving to select optimal.`);
        setCurrentPhase('selecting_optimal_candidate');
    } else if (currentPhase === 'candidates_identified' && (candidateSongsForReplacement.length === 0 || !songToReplace)) {
        console.error("[SIM_DEBUG_REPLACE_CANDIDATES_ID] No candidates or no song to replace. Error.");
        setCurrentPhase('error'); 
    }
  }, [currentPhase, candidateSongsForReplacement, songToReplace]);

  useEffect(() => {
    if (currentPhase === 'selecting_optimal_candidate' && songToReplace && candidateSongsForReplacement.length > 0) {
      console.log(`[SIM_DEBUG_REPLACE_SELECT_OPT] Selecting optimal candidate to replace ${songToReplace.title} (tR: ${songToReplace.targetRating.toFixed(4)}) from ${candidateSongsForReplacement.length} candidates.`);
      let bestCandidateInfo: { song: Song | null; effort: number; neededScore: number; resultingRating: number } = { song: null, effort: Infinity, neededScore: 0, resultingRating: 0 };

      candidateSongsForReplacement.forEach(candidate => {
        if (!candidate.chartConstant) return; // Should have been filtered, but double check
        // Target rating for the candidate should be slightly higher than the song it's replacing
        const targetRatingForCandidate = songToReplace.targetRating + 0.0001; 
        const minScoreInfo = findMinScoreForTargetRating(candidate, targetRatingForCandidate, isScoreLimitReleased);

        if (minScoreInfo.possible) {
          // Effort is the score increase needed from its *current* play score (or from 0 if unplayed)
          const effort = candidate.currentScore > 0 ? (minScoreInfo.score - candidate.currentScore) : minScoreInfo.score;
          if (effort < bestCandidateInfo.effort || (effort === bestCandidateInfo.effort && minScoreInfo.rating > bestCandidateInfo.resultingRating)) {
            bestCandidateInfo = { song: candidate, effort, neededScore: minScoreInfo.score, resultingRating: minScoreInfo.rating };
          }
        }
      });

      if (bestCandidateInfo.song) {
        const finalOptimalCandidate: Song = {
          ...bestCandidateInfo.song, 
          // currentScore & currentRating are from play history (or 0)
          targetScore: bestCandidateInfo.neededScore, 
          targetRating: bestCandidateInfo.resultingRating 
        };
        console.log(`[SIM_DEBUG_REPLACE_SELECT_OPT] Optimal candidate selected: ${finalOptimalCandidate.title} (${finalOptimalCandidate.diff}). Needs score: ${finalOptimalCandidate.targetScore} for tR: ${finalOptimalCandidate.targetRating.toFixed(4)}. Effort: ${bestCandidateInfo.effort}. Original cS: ${bestCandidateInfo.song.currentScore}, cR: ${bestCandidateInfo.song.currentRating.toFixed(4)}`);
        setOptimalCandidateSong(finalOptimalCandidate);
        setCurrentPhase('optimal_candidate_selected');
      } else {
        console.warn("[SIM_DEBUG_REPLACE_SELECT_OPT] No optimal candidate could achieve the target rating. Stuck or error.");
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
        // When it enters B30, its current state IS its target state after achieving the replacement score
        currentScore: optimalCandidateSong.targetScore, 
        currentRating: optimalCandidateSong.targetRating,
        // targetScore and targetRating are already set from selection phase
      };
      
      const updatedB30 = simulatedB30Songs.filter(s => !(s.id === songToReplace.id && s.diff === songToReplace.diff));
      updatedB30.push(newB30EntryForOptimalCandidate);
      
      console.log(`[SIM_DEBUG_REPLACE_PERFORM] B30 count before replace: ${simulatedB30Songs.length}, after removing old: ${simulatedB30Songs.filter(s => !(s.id === songToReplace.id && s.diff === songToReplace.diff)).length}, after adding new: ${updatedB30.length}`);
      setSimulatedB30Songs(updatedB30); // Sorting is handled by the average calculation effect
      
      setSongToReplace(null); 
      setOptimalCandidateSong(null); 
      setCandidateSongsForReplacement([]);
      
      console.log("[SIM_DEBUG_REPLACE_PERFORM] Song replaced. Restarting simulation from Leap Phase.");
      setCurrentPhase('initializing_leap_phase'); 
    }
  }, [currentPhase, optimalCandidateSong, songToReplace, simulatedB30Songs]);


  return {
    apiPlayerName,
    best30SongsData: simulatedB30Songs.length > 0 ? simulatedB30Songs : originalB30SongsData.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating })),
    new20SongsData,
    combinedTopSongs,
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    isScoreLimitReleased,
    phaseTransitionPoint,
    calculationStrategy, 
    currentPhase,
    simulatedAverageB30Rating,
  };
}


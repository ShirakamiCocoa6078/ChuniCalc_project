
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
const NEW_20_COUNT = 20; // Added for clarity

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

  // const [_updatableForLeapPhase, _setUpdatableForLeapPhase] = useState<Song[]>([]); 
  const [leapTargetGroup, setLeapTargetGroup] = useState<Song[]>([]);
  const [songsWithLeapEfficiency, setSongsWithLeapEfficiency] = useState<Array<Song & { leapEfficiency?: number; scoreToReachNextGrade?: number; ratingAtNextGrade?: number }>>([]);

  // const [_updatableForFineTuning, _setUpdatableForFineTuning] = useState<Song[]>([]); 
  const [fineTuningTargetGroup, setFineTuningTargetGroup] = useState<Song[]>([]);
  const [fineTuningGroupA, setFineTuningGroupA] = useState<Song[]>([]);
  const [fineTuningGroupB, setFineTuningGroupB] = useState<Song[]>([]);

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
         // If strategy is selected and we were idle, re-init with current data
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
                tempGlobalMusicRecords = res.data.records || []; 
                setCachedData<GlobalMusicApiResponse>(globalMusicKey, { records: tempGlobalMusicRecords }, GLOBAL_MUSIC_CACHE_EXPIRY_MS); 
                globalMusicCache = { records: tempGlobalMusicRecords };
              }
              if (res.type === 'userShowall' && !userShowallCache) {
                tempUserShowallRecords = res.data.records || []; 
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

        const sortedNewSongs = sortSongsByRatingDesc(playedNewSongsApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
        setNew20SongsData(sortedNewSongs.slice(0, NEW_20_COUNT));
        console.log(`[NEW20_PROCESS] Final New20 songs processed (top ${NEW_20_COUNT}): ${new20SongsData.length}`);
        if(new20SongsData.length === 0 && newSongDefinitions.length > 0 && currentUserShowall.length > 0) {
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
      const topSongsForAvg = sortSongsByRatingDesc([...simulatedB30Songs]).slice(0, BEST_COUNT);
      const newAverage = topSongsForAvg.reduce((sum, s) => sum + s.targetRating, 0) / Math.min(BEST_COUNT, topSongsForAvg.length);
      const newAverageFixed = parseFloat(newAverage.toFixed(4));
      setSimulatedAverageB30Rating(newAverageFixed);
    } else if (originalB30SongsData.length > 0 && simulatedB30Songs.length === 0 && !isLoadingSongs) {
      const topOriginalSongs = sortSongsByRatingDesc([...originalB30SongsData]).slice(0, BEST_COUNT);
      const originalAverage = topOriginalSongs.reduce((sum, s) => sum + s.currentRating, 0) / Math.min(BEST_COUNT, topOriginalSongs.length);
      setSimulatedAverageB30Rating(parseFloat(originalAverage.toFixed(4)));
    } else {
      setSimulatedAverageB30Rating(null);
    }
  }, [simulatedB30Songs, originalB30SongsData, isLoadingSongs]);

  useEffect(() => {
    if (!isLoadingSongs && originalB30SongsData.length > 0 && calculationStrategy && currentPhase === 'idle' &&
      currentRatingDisplay && targetRatingDisplay && parseFloat(currentRatingDisplay) < parseFloat(targetRatingDisplay)) {
      setSimulatedB30Songs([...originalB30SongsData]); 
      setCurrentPhase('initializing_leap_phase');
    } else if (!calculationStrategy && currentPhase !== 'idle') {
      setCurrentPhase('idle');
      setSimulatedB30Songs([...originalB30SongsData]);
    }
  }, [isLoadingSongs, originalB30SongsData, calculationStrategy, currentPhase, currentRatingDisplay, targetRatingDisplay]);

  useEffect(() => {
    if (currentPhase === 'initializing_leap_phase' && !isLoadingSongs && simulatedB30Songs.length > 0 && calculationStrategy) {
      const updatable = simulatedB30Songs.filter(song => song.currentScore < 1009000);
      // _setUpdatableForLeapPhase(updatable); // This state isn't directly used for logic flow, but might be for UI later

      if (updatable.length === 0) {
        setCurrentPhase('stuck_awaiting_replacement'); return;
      }

      let determinedLeapTargetGroup: Song[] = [];
      const sortedUpdatableForMedian = [...updatable].sort((a, b) => a.currentRating - b.currentRating);
      let medianRating: number;

      if (sortedUpdatableForMedian.length === 0) { medianRating = 0; }
      else if (sortedUpdatableForMedian.length % 2 === 0) {
        const mid1 = sortedUpdatableForMedian[sortedUpdatableForMedian.length / 2 - 1].currentRating;
        const mid2 = sortedUpdatableForMedian[sortedUpdatableForMedian.length / 2].currentRating;
        medianRating = (mid1 + mid2) / 2;
      } else {
        medianRating = sortedUpdatableForMedian[Math.floor(sortedUpdatableForMedian.length / 2)].currentRating;
      }

      if (calculationStrategy === 'average') {
        determinedLeapTargetGroup = [...updatable];
      } else if (calculationStrategy === 'floor') {
        determinedLeapTargetGroup = updatable.filter(song => song.currentRating <= medianRating);
      } else if (calculationStrategy === 'peak') {
        determinedLeapTargetGroup = updatable.filter(song => song.currentRating > medianRating);
      }

      setLeapTargetGroup(determinedLeapTargetGroup);

      if (determinedLeapTargetGroup.length > 0) setCurrentPhase('analyzing_leap_efficiency');
      else {
        setCurrentPhase('stuck_awaiting_replacement');
      }
    }
  }, [currentPhase, isLoadingSongs, simulatedB30Songs, calculationStrategy]);

  useEffect(() => {
    if (currentPhase === 'analyzing_leap_efficiency' && leapTargetGroup.length > 0) {
      const songsWithCalculatedEfficiency = leapTargetGroup.map(song => {
        const nextGradeScore = getNextGradeBoundaryScore(song.currentScore);
        let leapEfficiency = 0; let scoreToReachNextGrade: number | undefined = undefined; let ratingAtNextGrade: number | undefined = undefined;

        if (song.chartConstant && nextGradeScore && song.currentScore < nextGradeScore) {
          const currentSongRating = song.currentRating;
          const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, song.chartConstant);
          const ratingIncrease = potentialRatingAtNextGrade - currentSongRating;
          const scoreIncrease = nextGradeScore - song.currentScore;
          if (scoreIncrease > 0 && ratingIncrease > 0) leapEfficiency = ratingIncrease / scoreIncrease;
          scoreToReachNextGrade = nextGradeScore; ratingAtNextGrade = potentialRatingAtNextGrade;
        }
        return { ...song, leapEfficiency, scoreToReachNextGrade, ratingAtNextGrade };
      }).filter(s => s.leapEfficiency !== undefined && s.leapEfficiency > 0);

      setSongsWithLeapEfficiency(songsWithCalculatedEfficiency);

      if (songsWithCalculatedEfficiency.length > 0) setCurrentPhase('performing_leap_jump');
      else { setCurrentPhase('stuck_awaiting_replacement'); }
    }
  }, [currentPhase, leapTargetGroup]);

  useEffect(() => {
    if (currentPhase === 'performing_leap_jump' && songsWithLeapEfficiency.length > 0 && simulatedB30Songs.length > 0) {
      const sortedByEfficiency = [...songsWithLeapEfficiency].sort((a, b) => (b.leapEfficiency || 0) - (a.leapEfficiency || 0));
      const optimalLeapSong = sortedByEfficiency[0];

      if (!optimalLeapSong || typeof optimalLeapSong.scoreToReachNextGrade !== 'number' || typeof optimalLeapSong.ratingAtNextGrade !== 'number') {
        setCurrentPhase('stuck_awaiting_replacement'); return;
      }

      const newSimulatedB30 = simulatedB30Songs.map(song => {
        if (song.id === optimalLeapSong.id && song.diff === optimalLeapSong.diff) {
          return {
            ...song,
            // currentScore and currentRating are kept from before this specific leap
            targetScore: optimalLeapSong.scoreToReachNextGrade!,
            targetRating: optimalLeapSong.ratingAtNextGrade!,
          };
        }
        return song;
      });
      setSimulatedB30Songs(sortSongsByRatingDesc(newSimulatedB30)); 
      setSongsWithLeapEfficiency([]); 
      setLeapTargetGroup([]); 
      setCurrentPhase('evaluating_leap_result');
    } else if (currentPhase === 'performing_leap_jump' && songsWithLeapEfficiency.length === 0) {
      setCurrentPhase('stuck_awaiting_replacement');
    }
  }, [currentPhase, songsWithLeapEfficiency, simulatedB30Songs]);
  
  useEffect(() => {
    if (currentPhase === 'evaluating_leap_result' && simulatedAverageB30Rating !== null && targetRatingDisplay && phaseTransitionPoint !== null) {
      const targetRatingNum = parseFloat(targetRatingDisplay);

      if (simulatedAverageB30Rating >= targetRatingNum) {
        setCurrentPhase('target_reached');
      } else if (simulatedAverageB30Rating >= phaseTransitionPoint) {
        setCurrentPhase('transitioning_to_fine_tuning');
      } else {
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
      const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;
      const updatableSongs = simulatedB30Songs.filter(song => song.targetScore < scoreCap);
      // _setUpdatableForFineTuning(updatableSongs);

      if (updatableSongs.length === 0) {
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

      let proceedToPerformingFineTuning = false;
      setFineTuningGroupA([]); setFineTuningGroupB([]); setFineTuningTargetGroup([]);

      if (calculationStrategy === 'average') {
        const groupA = updatableSongs.filter(s => s.targetRating <= medianRating);
        const groupB = updatableSongs.filter(s => s.targetRating > medianRating);
        setFineTuningGroupA(groupA);
        setFineTuningGroupB(groupB);
        if (groupA.length > 0 || groupB.length > 0) proceedToPerformingFineTuning = true;
      } else if (calculationStrategy === 'floor' || calculationStrategy === 'peak') {
        let primaryGroup: Song[] = [];
        if (calculationStrategy === 'floor') primaryGroup = updatableSongs.filter(s => s.targetRating <= medianRating);
        else primaryGroup = updatableSongs.filter(s => s.targetRating > medianRating);
        
        if (primaryGroup.length > 0) {
          setFineTuningTargetGroup(primaryGroup); proceedToPerformingFineTuning = true;
        } else {
          let expansionGroup: Song[] = [];
          if (calculationStrategy === 'floor') expansionGroup = updatableSongs.filter(s => s.targetRating > medianRating);
          else expansionGroup = updatableSongs.filter(s => s.targetRating <= medianRating);
          
          if (expansionGroup.length > 0) {
            console.log(`[FineTuning_Init] Primary group for ${calculationStrategy} empty. Expanding to other group (${expansionGroup.length} songs).`);
            setFineTuningTargetGroup(expansionGroup); proceedToPerformingFineTuning = true;
          }
        }
      }

      if (proceedToPerformingFineTuning) setCurrentPhase('performing_fine_tuning');
      else {
        setCurrentPhase('stuck_awaiting_replacement');
      }
    }
  }, [currentPhase, simulatedB30Songs, calculationStrategy, isScoreLimitReleased]);

  useEffect(() => {
    if (currentPhase === 'performing_fine_tuning') {
      let newSimulatedB30Songs = [...simulatedB30Songs];
      // let madeChangeInFineTuning = false; // Not strictly needed if phase always moves to eval
      const scoreCap = isScoreLimitReleased ? 1010000 : 1009000;

      const songsToActuallyTune: Song[] = [];
      if (calculationStrategy === 'average') songsToActuallyTune.push(...fineTuningGroupA, ...fineTuningGroupB);
      else if (calculationStrategy === 'floor' || calculationStrategy === 'peak') songsToActuallyTune.push(...fineTuningTargetGroup);
      
      songsToActuallyTune.forEach(songFromGroup => {
        const songIndexInSimulated = newSimulatedB30Songs.findIndex(s => s.id === songFromGroup.id && s.diff === songFromGroup.diff);
        if (songIndexInSimulated === -1) { return; }

        let currentSongInSim = newSimulatedB30Songs[songIndexInSimulated];
        if (currentSongInSim.targetScore < scoreCap && currentSongInSim.chartConstant) {
          const targetMicroTuneRating = currentSongInSim.targetRating + 0.0001; 
          const minScoreInfo = findMinScoreForTargetRating(currentSongInSim, targetMicroTuneRating, isScoreLimitReleased);

          if (minScoreInfo.possible && minScoreInfo.score > currentSongInSim.targetScore && minScoreInfo.score <= scoreCap) {
            const updatedSong = {
              ...currentSongInSim,
              // currentScore & currentRating are kept from before this fine-tuning step
              targetScore: minScoreInfo.score, 
              targetRating: minScoreInfo.rating,
            };
            newSimulatedB30Songs[songIndexInSimulated] = updatedSong;
            // madeChangeInFineTuning = true; // Not strictly needed
          }
        }
      });
      
      setSimulatedB30Songs(sortSongsByRatingDesc(newSimulatedB30Songs));
      setCurrentPhase('evaluating_fine_tuning_result');
    }
  }, [currentPhase, calculationStrategy, fineTuningGroupA, fineTuningGroupB, fineTuningTargetGroup, isScoreLimitReleased, simulatedB30Songs]);

  useEffect(() => {
    if (currentPhase === 'evaluating_fine_tuning_result' && simulatedAverageB30Rating !== null && targetRatingDisplay) {
      const targetRatingNum = parseFloat(targetRatingDisplay);
      if (simulatedAverageB30Rating >= targetRatingNum) {
        setCurrentPhase('target_reached');
      } else {
        setCurrentPhase('initializing_fine_tuning_phase');
      }
    }
  }, [currentPhase, simulatedAverageB30Rating, targetRatingDisplay]);

  useEffect(() => {
    if (currentPhase === 'stuck_awaiting_replacement' && simulatedB30Songs.length > 0) {
      const sortedB30ForReplacement = [...simulatedB30Songs].sort((a, b) => a.targetRating - b.targetRating);
      const songOut = sortedB30ForReplacement[0]; 
      if (songOut) {
        setSongToReplace(songOut);
        setCurrentPhase('awaiting_external_data_for_replacement');
      } else {
        setCurrentPhase('error');
      }
    } else if (currentPhase === 'stuck_awaiting_replacement' && simulatedB30Songs.length === 0) {
      setCurrentPhase('error');
    }
  }, [currentPhase, simulatedB30Songs]);

  useEffect(() => {
    if (currentPhase === 'awaiting_external_data_for_replacement') {
      if (allMusicData.length > 0 && userPlayHistory.length > 0 && songToReplace) {
        setCurrentPhase('identifying_candidates');
      } else if (!songToReplace) {
        setCurrentPhase('error');
      }
    }
  }, [currentPhase, allMusicData, userPlayHistory, songToReplace]);

  useEffect(() => {
    if (currentPhase === 'identifying_candidates' && songToReplace && allMusicData.length > 0) {
      const currentB30IdsAndDiffs = new Set(simulatedB30Songs.map(s => `${s.id}_${s.diff}`));
      
      const potentialCandidatesApi = allMusicData.filter(globalSong => {
        if (!globalSong.id || !globalSong.diff || !globalSong.title) return false;
        if (currentB30IdsAndDiffs.has(`${globalSong.id}_${globalSong.diff.toUpperCase()}`)) return false;
        
        const tempSongObjForConst = mapApiSongToAppSong(globalSong, 0, globalSong.const);
        if (!tempSongObjForConst.chartConstant) return false;
        
        const potentialMaxRating = tempSongObjForConst.chartConstant + 2.15;
        return potentialMaxRating > songToReplace.targetRating; 
      });

      const mappedCandidates = potentialCandidatesApi.map(apiEntry => {
        const playedVersion = userPlayHistory.find(p => p.id === apiEntry.id && p.diff.toUpperCase() === apiEntry.diff.toUpperCase());
        const songWithScore = playedVersion ? { ...apiEntry, score: playedVersion.score } : { ...apiEntry, score: 0 };
        return mapApiSongToAppSong(songWithScore, 0, apiEntry.const); 
      });

      setCandidateSongsForReplacement(mappedCandidates);
      setCurrentPhase(mappedCandidates.length > 0 ? 'candidates_identified' : 'error'); 
    } else if (currentPhase === 'identifying_candidates' && (!songToReplace || allMusicData.length === 0)) {
      setCurrentPhase('error');
    }
  }, [currentPhase, songToReplace, allMusicData, userPlayHistory, simulatedB30Songs]);
  
  useEffect(() => {
    if (currentPhase === 'candidates_identified' && songToReplace && candidateSongsForReplacement.length > 0) {
        setCurrentPhase('selecting_optimal_candidate');
    } else if (currentPhase === 'candidates_identified' && (candidateSongsForReplacement.length === 0 || !songToReplace)) {
        setCurrentPhase('error'); 
    }
  }, [currentPhase, candidateSongsForReplacement, songToReplace]);

  useEffect(() => {
    if (currentPhase === 'selecting_optimal_candidate' && songToReplace && candidateSongsForReplacement.length > 0) {
      let bestCandidateInfo: { song: Song | null; effort: number; neededScore: number; resultingRating: number } = { song: null, effort: Infinity, neededScore: 0, resultingRating: 0 };

      candidateSongsForReplacement.forEach(candidate => {
        if (!candidate.chartConstant) return;
        const targetRatingForCandidate = songToReplace.targetRating + 0.0001; 
        const minScoreInfo = findMinScoreForTargetRating(candidate, targetRatingForCandidate, isScoreLimitReleased);

        if (minScoreInfo.possible) {
          const effort = candidate.currentScore > 0 ? (minScoreInfo.score - candidate.currentScore) : minScoreInfo.score;
          if (effort < bestCandidateInfo.effort || (effort === bestCandidateInfo.effort && minScoreInfo.rating > bestCandidateInfo.resultingRating)) {
            bestCandidateInfo = { song: candidate, effort, neededScore: minScoreInfo.score, resultingRating: minScoreInfo.rating };
          }
        }
      });

      if (bestCandidateInfo.song) {
        const finalOptimalCandidate: Song = {
          ...bestCandidateInfo.song, 
          targetScore: bestCandidateInfo.neededScore, 
          targetRating: bestCandidateInfo.resultingRating 
        };
        setOptimalCandidateSong(finalOptimalCandidate);
        setCurrentPhase('optimal_candidate_selected');
      } else {
        setCurrentPhase('error');
      }
    }
  }, [currentPhase, candidateSongsForReplacement, songToReplace, isScoreLimitReleased]);

  useEffect(() => {
      if (currentPhase === 'optimal_candidate_selected' && optimalCandidateSong && songToReplace) {
          setCurrentPhase('replacing_song');
      }
  }, [currentPhase, optimalCandidateSong, songToReplace]);

  useEffect(() => {
    if (currentPhase === 'replacing_song' && optimalCandidateSong && songToReplace) {
      const newB30EntryForOptimalCandidate: Song = {
        ...optimalCandidateSong,
        currentScore: optimalCandidateSong.targetScore, 
        currentRating: optimalCandidateSong.targetRating,
      };
      
      const updatedB30 = simulatedB30Songs.filter(s => !(s.id === songToReplace.id && s.diff === songToReplace.diff));
      updatedB30.push(newB30EntryForOptimalCandidate);

      setSimulatedB30Songs(sortSongsByRatingDesc(updatedB30)); 
      
      setSongToReplace(null); 
      setOptimalCandidateSong(null); 
      setCandidateSongsForReplacement([]);
      
      setCurrentPhase('initializing_leap_phase'); 
    }
  }, [currentPhase, optimalCandidateSong, songToReplace, simulatedB30Songs]);


  return {
    apiPlayerName,
    best30SongsData: simulatedB30Songs.length > 0 ? simulatedB30Songs : originalB30SongsData,
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


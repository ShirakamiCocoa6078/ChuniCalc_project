
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateChunithmSongRating, getNextGradeBoundaryScore, findMinScoreForTargetRating } from '@/lib/rating-utils';
import type { Song, ProfileData, RatingApiResponse, GlobalMusicApiResponse, UserShowallApiResponse, ShowallApiSongEntry, RatingApiSongEntry, CalculationStrategy } from "@/types/result-page";

const BEST_COUNT = 30;

type SimulationPhase = 
  | 'idle'
  // 과제 0: 초기 설정
  // 과제 1: 도약 페이즈
  | 'initializing_leap_phase' 
  | 'analyzing_leap_efficiency'
  | 'performing_leap_jump' 
  | 'evaluating_leap_result' 
  // 과제 1 -> 과제 2 전환
  | 'transitioning_to_fine_tuning'
  // 과제 2: 미세 조정 페이즈
  | 'initializing_fine_tuning_phase' 
  | 'performing_fine_tuning'
  | 'evaluating_fine_tuning_result' // New state for 2-3
  // 공통 종료/예외 상태
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
  const [best30SongsData, setBest30SongsData] = useState<Song[]>([]);
  const [new20SongsData, setNew20SongsData] = useState<Song[]>([]);
  const [combinedTopSongs, setCombinedTopSongs] = useState<Song[]>([]);
  
  const [isLoadingSongs, setIsLoadingSongs] = useState(true);
  const [errorLoadingSongs, setErrorLoadingSongs] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  // 과제 0: 시스템 초기 설정
  const [isScoreLimitReleased, setIsScoreLimitReleased] = useState(false); // 0-2
  const [phaseTransitionPoint, setPhaseTransitionPoint] = useState<number | null>(null); // 0-4
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  
  // 시뮬레이션 공통 상태
  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);

  // 과제 1: 도약 페이즈 관련 상태
  const [updatableForLeapPhase, setUpdatableForLeapPhase] = useState<Song[]>([]); 
  const [leapTargetGroup, setLeapTargetGroup] = useState<Song[]>([]); 
  const [songsWithLeapEfficiency, setSongsWithLeapEfficiency] = useState<Array<Song & { leapEfficiency?: number; scoreToReachNextGrade?: number; ratingAtNextGrade?: number }>>([]); 
  
  // 과제 2: 미세 조정 페이즈 관련 상태
  const [updatableForFineTuning, setUpdatableForFineTuning] = useState<Song[]>([]); 
  const [fineTuningTargetGroup, setFineTuningTargetGroup] = useState<Song[]>([]); 
  const [fineTuningGroupA, setFineTuningGroupA] = useState<Song[]>([]); 
  const [fineTuningGroupB, setFineTuningGroupB] = useState<Song[]>([]);

  // 외부 데이터 (전체 곡 목록, 사용자 전체 플레이 기록)
  const [allMusicData, setAllMusicData] = useState<ShowallApiSongEntry[]>([]);
  const [userPlayHistory, setUserPlayHistory] = useState<ShowallApiSongEntry[]>([]);

  // 과제 3: B30 교체 관련 상태
  const [songToReplace, setSongToReplace] = useState<Song | null>(null);
  const [candidateSongsForReplacement, setCandidateSongsForReplacement] = useState<Song[]>([]);
  const [optimalCandidateSong, setOptimalCandidateSong] = useState<Song | null>(null);
  
  // --- 과제 0-2, 0-4: 초기 설정 (점수 상한, 페이즈 전환점) ---
  useEffect(() => {
    if (clientHasMounted && currentRatingDisplay && targetRatingDisplay) {
      const currentRatingNum = parseFloat(currentRatingDisplay);
      const targetRatingNum = parseFloat(targetRatingDisplay);

      if (!isNaN(currentRatingNum) && isFinite(currentRatingNum) && !isNaN(targetRatingNum) && isFinite(targetRatingNum)) {
        const limitReleaseCondition = (targetRatingNum - currentRatingNum) * 50 > 10; 
        setIsScoreLimitReleased(limitReleaseCondition);
        console.log(`[CHAL_0-2_SCORE_CAP_RELEASE] Score cap release flag set to ${limitReleaseCondition}. Max score consideration: ${limitReleaseCondition ? 1010000 : 1009000}`);
        
        const transitionPoint = currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95; 
        setPhaseTransitionPoint(parseFloat(transitionPoint.toFixed(4)));
        console.log(`[CHAL_0-4_PHASE_TRANSITION_POINT] Phase transition point calculated: ${transitionPoint.toFixed(4)}`);
      } else {
        setIsScoreLimitReleased(false);
        setPhaseTransitionPoint(null);
        console.warn(`[CHAL_0-2/0-4] Ratings not valid. Score cap release defaults to false. Phase transition point not set.`);
      }
    }
  }, [clientHasMounted, currentRatingDisplay, targetRatingDisplay]);

  // --- 기본 데이터 로드 (B30, N20, 전체 곡, 사용자 기록 등) ---
  useEffect(() => {
    const fetchAndProcessData = async () => {
      const defaultPlayerName = getTranslation(locale, 'resultPageDefaultPlayerName');
      const API_TOKEN = getApiToken();

      if (!API_TOKEN) {
        setErrorLoadingSongs(getTranslation(locale, 'resultPageErrorApiTokenNotSetResult'));
        setIsLoadingSongs(false);
        return;
      }
      if (!userNameForApi || userNameForApi === defaultPlayerName) {
        setErrorLoadingSongs(getTranslation(locale, 'resultPageErrorNicknameNotProvidedResult'));
        setApiPlayerName(defaultPlayerName);
        setIsLoadingSongs(false);
        return;
      }

      setIsLoadingSongs(true);
      setErrorLoadingSongs(null);
      setApiPlayerName(userNameForApi);
      setCurrentPhase('idle'); 

      const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
      const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
      const globalMusicKey = GLOBAL_MUSIC_DATA_KEY;
      const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;

      let cachedProfileTimestamp: string | null = null;
      if (clientHasMounted) {
          const profileCacheItem = localStorage.getItem(profileKey);
          if (profileCacheItem) { try { const parsed = JSON.parse(profileCacheItem) as { timestamp: number }; if (parsed && typeof parsed.timestamp === 'number') { cachedProfileTimestamp = new Date(parsed.timestamp).toLocaleString(locale); }} catch (e) { /* silent */ }}
      }
      setLastRefreshed(cachedProfileTimestamp ? getTranslation(locale, 'resultPageSyncStatus', cachedProfileTimestamp) : getTranslation(locale, 'resultPageSyncStatusNoCache'));

      let profileData = getCachedData<ProfileData>(profileKey);
      let ratingData = getCachedData<RatingApiResponse>(ratingDataKey, USER_DATA_CACHE_EXPIRY_MS);
      let globalMusicCache = getCachedData<GlobalMusicApiResponse>(globalMusicKey, GLOBAL_MUSIC_CACHE_EXPIRY_MS); // Use specific expiry for global
      let userShowallCache = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);
      
      let tempAllMusic: ShowallApiSongEntry[] = globalMusicCache?.records || [];
      let tempUserHistory: ShowallApiSongEntry[] = userShowallCache?.records || [];

      if (profileData) setApiPlayerName(profileData.player_name || userNameForApi);
      
      let initialB30ApiEntries: RatingApiSongEntry[] = [];
      if (ratingData?.best?.entries) {
        initialB30ApiEntries = ratingData.best.entries.filter((e: any): e is RatingApiSongEntry => e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && typeof e.title === 'string' && e.title.trim() !== '') || [];
      }

      if (!profileData || !ratingData || !globalMusicCache || !userShowallCache) {
        const apiRequestsMap = new Map<string, Promise<any>>();
        if (!profileData) apiRequestsMap.set('profile', fetch(`https://api.chunirec.net/2.0/records/profile.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'profile', data, ok: res.ok, status: res.status})).catch(() => ({type: 'profile', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!ratingData) apiRequestsMap.set('rating', fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'rating', data, ok: res.ok, status: res.status})).catch(() => ({type: 'rating', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!globalMusicCache) apiRequestsMap.set('globalMusic', fetch(`https://api.chunirec.net/2.0/music/showall.json?region=jp2&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'globalMusic', data, ok: res.ok, status: res.status})).catch(() => ({type: 'globalMusic', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!userShowallCache) apiRequestsMap.set('userShowall', fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'userShowall', data, ok: res.ok, status: res.status})).catch(() => ({type: 'userShowall', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        
        if (apiRequestsMap.size > 0) {
          try {
            const responses = await Promise.all(Array.from(apiRequestsMap.values()));
            let criticalError = null;
            for (const res of responses) {
              if (!res.ok) { const errorMsg = `${res.type} data API failed (status: ${res.status}): ${res.data?.error?.message || res.error || 'Unknown API error'}`; if (!criticalError) criticalError = errorMsg; continue; }
              if (res.type === 'profile' && !profileData) { setApiPlayerName(res.data.player_name || userNameForApi); setCachedData<ProfileData>(profileKey, res.data); }
              if (res.type === 'rating' && !ratingData) {
                initialB30ApiEntries = res.data.best?.entries?.filter((e: any): e is RatingApiSongEntry => e && e.id && typeof e.id === 'string' && e.id.trim() !== '' && e.diff && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && e.title && typeof e.title === 'string' && e.title.trim() !== '') || [];
                setCachedData<RatingApiResponse>(ratingDataKey, res.data);
              }
              if (res.type === 'globalMusic' && !globalMusicCache) {
                 tempAllMusic = res.data.records || [];
                 setCachedData<GlobalMusicApiResponse>(globalMusicKey, res.data, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
              }
              if (res.type === 'userShowall' && !userShowallCache) {
                 tempUserHistory = res.data.records || [];
                 setCachedData<UserShowallApiResponse>(userShowallKey, res.data);
              }
            }
            if (criticalError) throw new Error(criticalError);
            const newCacheTime = new Date().toLocaleString(locale);
            setLastRefreshed(getTranslation(locale, 'resultPageSyncStatus', newCacheTime));
            if (responses.some(res => res.ok)) toast({ title: getTranslation(locale, 'resultPageToastApiLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastApiLoadSuccessDesc', newCacheTime) });
          } catch (error) {
            let detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', "Unknown error");
            if (error instanceof Error) detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', error.message);
            setErrorLoadingSongs(detailedErrorMessage);
            if (!apiPlayerName && userNameForApi !== defaultPlayerName) setApiPlayerName(userNameForApi);
          }
        }
      } else { 
         toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
      }
      
      const mappedB30 = sortSongsByRatingDesc(initialB30ApiEntries.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
      setBest30SongsData(mappedB30);
      setSimulatedB30Songs([...mappedB30]); // Initialize simulatedB30Songs
      
      setAllMusicData(tempAllMusic); 
      setUserPlayHistory(tempUserHistory);

      if (tempAllMusic.length > 0 && tempUserHistory.length > 0) {
          const newSongTitlesRaw = NewSongsData.titles?.verse || [];
          const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());
          
          const newSongDefinitions = tempAllMusic.filter(globalSong => 
              globalSong.title && newSongTitlesToMatch.includes(globalSong.title.trim().toLowerCase())
          );

          const userPlayedMap = new Map<string, ShowallApiSongEntry>();
          tempUserHistory.forEach(usrSong => {
              if (usrSong.id && usrSong.diff) userPlayedMap.set(`${usrSong.id}_${usrSong.diff.toUpperCase()}`, usrSong);
          });

          const playedNewSongsApi = newSongDefinitions.reduce((acc, newSongDef) => {
              const userPlayRecord = userPlayedMap.get(`${newSongDef.id}_${newSongDef.diff.toUpperCase()}`);
              if (userPlayRecord && typeof userPlayRecord.score === 'number' && userPlayRecord.score >= 800000) {
                  acc.push({ ...newSongDef, score: userPlayRecord.score, rating: userPlayRecord.rating, is_played: true, is_clear: userPlayRecord.is_clear, is_fullcombo: userPlayRecord.is_fullcombo, is_alljustice: userPlayRecord.is_alljustice, });
              }
              return acc;
          }, [] as ShowallApiSongEntry[]);

          const finalNew20 = sortSongsByRatingDesc( playedNewSongsApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)) );
          setNew20SongsData(finalNew20);
      } else { setNew20SongsData([]); }
      setIsLoadingSongs(false);
    };

    if (clientHasMounted) fetchAndProcessData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNameForApi, refreshNonce, clientHasMounted, locale]); 

  // --- Combined Top Songs (B30 + N20) ---
   useEffect(() => {
    if (!isLoadingSongs) {
      const baseB30ForCombined = simulatedB30Songs.length > 0 ? simulatedB30Songs : best30SongsData;
      if (baseB30ForCombined.length > 0 || new20SongsData.length > 0) {
        const songMap = new Map<string, Song>();
        baseB30ForCombined.forEach(song => songMap.set(`${song.id}_${song.diff}`, {...song}));
        new20SongsData.forEach(song => { const key = `${song.id}_${song.diff}`; if (!songMap.has(key)) songMap.set(key, {...song}); });
        setCombinedTopSongs(sortSongsByRatingDesc(Array.from(songMap.values())));
      } else { setCombinedTopSongs([]); }
    }
  }, [best30SongsData, new20SongsData, simulatedB30Songs, isLoadingSongs]);

  // --- B30 평균 레이팅 재계산 (simulatedB30Songs 변경 시) ---
  useEffect(() => {
    if (simulatedB30Songs.length > 0) {
      const topSongsForAvg = sortSongsByRatingDesc([...simulatedB30Songs]).slice(0, BEST_COUNT);
      const newAverage = topSongsForAvg.reduce((sum, s) => sum + s.currentRating, 0) / Math.min(BEST_COUNT, topSongsForAvg.length);
      const newAverageFixed = parseFloat(newAverage.toFixed(4));
      setSimulatedAverageB30Rating(newAverageFixed);
      console.log(`[SIM_AVG_UPDATE] Simulated average B30 rating updated to: ${newAverageFixed}`);
    } else if (best30SongsData.length > 0 && simulatedB30Songs.length === 0) { // For initial load before simulation can modify simB30
        const initialAvg = best30SongsData.slice(0, BEST_COUNT).reduce((sum, s) => sum + s.currentRating, 0) / Math.min(BEST_COUNT, best30SongsData.length);
        setSimulatedAverageB30Rating(parseFloat(initialAvg.toFixed(4)));
    } else {
      setSimulatedAverageB30Rating(null);
    }
  }, [simulatedB30Songs, best30SongsData]);


  // --- 시뮬레이션 시작 조건 ---
  useEffect(() => {
    if (!isLoadingSongs && best30SongsData.length > 0 && calculationStrategy && currentPhase === 'idle' &&
        currentRatingDisplay && targetRatingDisplay && parseFloat(currentRatingDisplay) < parseFloat(targetRatingDisplay)) {
      console.log(`[SIM_START_CONDITION_MET] Conditions met for starting simulation. Strategy: ${calculationStrategy}. Current: ${currentRatingDisplay}, Target: ${targetRatingDisplay}.`);
      setSimulatedB30Songs([...best30SongsData]); // Ensure simulatedB30 is reset to original B30
      setCurrentPhase('initializing_leap_phase');
    }
  }, [isLoadingSongs, best30SongsData, calculationStrategy, currentPhase, currentRatingDisplay, targetRatingDisplay]);


  // --- 과제 1: 도약 페이즈 ---
  // 1-1: 도약 대상 그룹 결정
  useEffect(() => {
    if (currentPhase === 'initializing_leap_phase' && !isLoadingSongs && simulatedB30Songs.length > 0 && calculationStrategy) {
      console.log("[LEAP_PHASE_1-1] Determining Leap Target Group...");
      
      const updatable = simulatedB30Songs.filter(song => song.currentScore < 1009000); // Per problem spec
      setUpdatableForLeapPhase(updatable);
      console.log(`[LEAP_PHASE_1-1_INFO] 'Updatable for Leap' (score < 1,009,000): ${updatable.length} songs from simulatedB30.`);

      if (updatable.length === 0) {
        console.warn("[LEAP_PHASE_1-1_WARN] No songs in 'Updatable for Leap' group. Cannot proceed with leap phase. Moving to replacement check.");
        setLeapTargetGroup([]);
        setCurrentPhase('stuck_awaiting_replacement'); // Trigger replacement logic (3-x)
        return;
      }

      let determinedLeapTargetGroup: Song[] = [];
      const sortedUpdatableForMedian = [...updatable].sort((a, b) => a.currentRating - b.currentRating);
      let medianRating: number;
      const midIndex = Math.floor(sortedUpdatableForMedian.length / 2);

      if (sortedUpdatableForMedian.length === 0) medianRating = 0;
      else if (sortedUpdatableForMedian.length % 2 === 0 && sortedUpdatableForMedian.length > 0) medianRating = (sortedUpdatableForMedian[midIndex - 1].currentRating + sortedUpdatableForMedian[midIndex].currentRating) / 2;
      else medianRating = sortedUpdatableForMedian[midIndex].currentRating;
      
      console.log(`[LEAP_PHASE_1-1_INFO] Median rating for updatableLeap: ${medianRating.toFixed(4)}`);

      if (calculationStrategy === 'average') {
        determinedLeapTargetGroup = [...updatable];
      } else if (calculationStrategy === 'floor') {
        determinedLeapTargetGroup = updatable.filter(song => song.currentRating <= medianRating);
      } else if (calculationStrategy === 'peak') {
        determinedLeapTargetGroup = updatable.filter(song => song.currentRating > medianRating);
      }
      
      setLeapTargetGroup(determinedLeapTargetGroup);
      console.log(`[LEAP_PHASE_1-1_RESULT] Leap Target Group (Strategy: ${calculationStrategy}): ${determinedLeapTargetGroup.length} songs.`);
      
      if (determinedLeapTargetGroup.length > 0) setCurrentPhase('analyzing_leap_efficiency'); 
      else { 
          console.warn(`[LEAP_PHASE_1-1_WARN] Leap Target Group is empty for strategy ${calculationStrategy}. Stuck, moving to replacement.`); 
          setCurrentPhase('stuck_awaiting_replacement'); 
      }
    }
  }, [currentPhase, isLoadingSongs, simulatedB30Songs, calculationStrategy]);

  // 1-2: 효율성 분석
  useEffect(() => {
    if (currentPhase === 'analyzing_leap_efficiency' && leapTargetGroup.length > 0) {
      console.log("[LEAP_PHASE_1-2] Analyzing leap efficiency for target group...");
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
      console.log(`[LEAP_PHASE_1-2_RESULT] Calculated leap efficiencies (positive only): ${songsWithCalculatedEfficiency.length} songs.`);
      
      if (songsWithCalculatedEfficiency.length > 0) setCurrentPhase('performing_leap_jump');
      else { console.log("[LEAP_PHASE_1-2_WARN] No songs with positive leap efficiency. Moving to stuck/replacement."); setCurrentPhase('stuck_awaiting_replacement'); }
    }
  }, [currentPhase, leapTargetGroup]);

  // 1-3: 최적 대상 점수 도약
  useEffect(() => {
    if (currentPhase === 'performing_leap_jump' && songsWithLeapEfficiency.length > 0 && simulatedB30Songs.length > 0) {
      console.log("[LEAP_PHASE_1-3] Performing leap jump for most efficient song...");
      const sortedByEfficiency = [...songsWithLeapEfficiency].sort((a, b) => (b.leapEfficiency || 0) - (a.leapEfficiency || 0));
      const optimalLeapSong = sortedByEfficiency[0];

      if (!optimalLeapSong || typeof optimalLeapSong.scoreToReachNextGrade !== 'number' || typeof optimalLeapSong.ratingAtNextGrade !== 'number') {
        console.error("[LEAP_PHASE_1-3_ERROR] Invalid optimal song or missing data for leap.", optimalLeapSong);
        setCurrentPhase('stuck_awaiting_replacement'); return;
      }
      console.log(`[LEAP_PHASE_1-3_INFO] Optimal leap: ${optimalLeapSong.title} (Diff: ${optimalLeapSong.diff}). Score ${optimalLeapSong.currentScore} -> ${optimalLeapSong.scoreToReachNextGrade}`);

      const newSimulatedB30 = simulatedB30Songs.map(song => {
        if (song.id === optimalLeapSong.id && song.diff === optimalLeapSong.diff) {
          return { 
            ...song, 
            currentScore: optimalLeapSong.scoreToReachNextGrade!, 
            currentRating: optimalLeapSong.ratingAtNextGrade!, 
            targetScore: optimalLeapSong.scoreToReachNextGrade!, 
            targetRating: optimalLeapSong.ratingAtNextGrade! 
          };
        }
        return song;
      });
      setSimulatedB30Songs(sortSongsByRatingDesc(newSimulatedB30));
      setSongsWithLeapEfficiency([]); 
      setLeapTargetGroup([]); 
      setCurrentPhase('evaluating_leap_result');
    } else if (currentPhase === 'performing_leap_jump' && songsWithLeapEfficiency.length === 0) {
        console.log("[LEAP_PHASE_1-3_INFO] No songs with efficiency found (performing_leap_jump). Moving to stuck/replacement."); setCurrentPhase('stuck_awaiting_replacement');
    }
  }, [currentPhase, songsWithLeapEfficiency, simulatedB30Songs]);
  
  // 1-4: 결과 확인 및 페이즈 판단
  useEffect(() => {
    if (currentPhase === 'evaluating_leap_result' && simulatedAverageB30Rating !== null && targetRatingDisplay) {
      console.log(`[LEAP_PHASE_1-4] Evaluating leap result. Current avg B30: ${simulatedAverageB30Rating}, Target: ${targetRatingDisplay}`);
      const targetRatingNum = parseFloat(targetRatingDisplay);

      if (simulatedAverageB30Rating >= targetRatingNum) {
        console.log(`[LEAP_PHASE_1-4_TARGET_REACHED] Target rating ${targetRatingNum} reached! Current avg: ${simulatedAverageB30Rating}`);
        setCurrentPhase('target_reached');
      } else if (phaseTransitionPoint !== null && simulatedAverageB30Rating >= phaseTransitionPoint) {
        console.log(`[LEAP_PHASE_1-4_TRANSITION_TO_FINE_TUNING] Phase transition point ${phaseTransitionPoint.toFixed(4)} reached. Current avg: ${simulatedAverageB30Rating}. Transitioning to fine-tuning.`);
        setCurrentPhase('transitioning_to_fine_tuning');
      } else {
        console.log(`[LEAP_PHASE_1-4_LOOP_BACK_LEAP] Target/transition point not reached. Looping back to re-initialize leap phase.`);
        setCurrentPhase('initializing_leap_phase'); 
      }
    }
  }, [currentPhase, simulatedAverageB30Rating, targetRatingDisplay, phaseTransitionPoint]);

  // --- 과제 2: 미세 조정 페이즈 ---
  // 2-0: 페이즈 전환
  useEffect(() => {
    if (currentPhase === 'transitioning_to_fine_tuning') {
        console.log("[FINE_TUNING_PHASE_2-0_TRANSITION] Transitioning to Fine-tuning Phase.");
        setCurrentPhase('initializing_fine_tuning_phase');
    }
  }, [currentPhase]);

  // 2-1: 미세 조정 대상 그룹 결정
  useEffect(() => {
    if (currentPhase === 'initializing_fine_tuning_phase' && simulatedB30Songs.length > 0 && calculationStrategy) {
        console.log("[FINE_TUNING_PHASE_2-1] Determining Fine-tuning Target Group(s)...");
        const updatable = simulatedB30Songs.filter(song => song.currentScore < 1009000); // Per problem spec
        setUpdatableForFineTuning(updatable);
        console.log(`[FINE_TUNING_PHASE_2-1_INFO] 'Updatable for Fine-tuning': ${updatable.length} songs.`);

        if (updatable.length === 0) {
            console.warn("[FINE_TUNING_PHASE_2-1_WARN] No updatable songs for fine-tuning. Stuck.");
            setCurrentPhase('stuck_awaiting_replacement');
            return;
        }
        
        const sortedUpdatableForMedian = [...updatable].sort((a,b) => a.currentRating - b.currentRating);
        let medianRating;
        const midIndex = Math.floor(sortedUpdatableForMedian.length / 2);
        if (sortedUpdatableForMedian.length === 0) medianRating = 0;
        else if (sortedUpdatableForMedian.length % 2 === 0 && sortedUpdatableForMedian.length > 0) medianRating = (sortedUpdatableForMedian[midIndex - 1].currentRating + sortedUpdatableForMedian[midIndex].currentRating) / 2;
        else medianRating = sortedUpdatableForMedian[midIndex].currentRating;
        console.log(`[FINE_TUNING_PHASE_2-1_INFO] Median rating for updatableFineTuning: ${medianRating.toFixed(4)}`);

        let groupsDetermined = false;
        if (calculationStrategy === 'average') {
            const groupA = updatable.filter(s => s.currentRating <= medianRating);
            const groupB = updatable.filter(s => s.currentRating > medianRating);
            setFineTuningGroupA(groupA);
            setFineTuningGroupB(groupB);
            console.log(`[FINE_TUNING_PHASE_2-1_AVG_STRATEGY] Group A (<=median): ${groupA.length}, Group B (>median): ${groupB.length}`);
            if (groupA.length > 0 || groupB.length > 0) groupsDetermined = true;
        } else if (calculationStrategy === 'floor') {
            const targetGroupFT = updatable.filter(s => s.currentRating <= medianRating);
            setFineTuningTargetGroup(targetGroupFT);
            console.log(`[FINE_TUNING_PHASE_2-1_FLOOR_STRATEGY] Target Group: ${targetGroupFT.length}`);
            if (targetGroupFT.length > 0) groupsDetermined = true;
        } else if (calculationStrategy === 'peak') {
            const targetGroupFT = updatable.filter(s => s.currentRating > medianRating);
            setFineTuningTargetGroup(targetGroupFT);
            console.log(`[FINE_TUNING_PHASE_2-1_PEAK_STRATEGY] Target Group: ${targetGroupFT.length}`);
            if (targetGroupFT.length > 0) groupsDetermined = true;
        }

        if (groupsDetermined) {
            setCurrentPhase('performing_fine_tuning');
        } else {
            console.warn(`[FINE_TUNING_PHASE_2-1_WARN] No fine-tuning target groups determined for strategy ${calculationStrategy}. Stuck.`);
            setCurrentPhase('stuck_awaiting_replacement');
        }
    }
  }, [currentPhase, simulatedB30Songs, calculationStrategy]);

  // 2-2: 미세 조정 실행
  useEffect(() => {
    if (currentPhase === 'performing_fine_tuning') {
        console.log("[FINE_TUNING_PHASE_2-2] Performing fine-tuning for target song(s)...");
        let newSimulatedB30Songs = [...simulatedB30Songs];
        let madeChangeInFineTuning = false;

        const songsToActuallyTune: Song[] = [];
        if (calculationStrategy === 'average') {
            songsToActuallyTune.push(...fineTuningGroupA, ...fineTuningGroupB);
        } else if (calculationStrategy === 'floor' || calculationStrategy === 'peak') {
            songsToActuallyTune.push(...fineTuningTargetGroup);
        }
        
        console.log(`[FINE_TUNING_PHASE_2-2_INFO] Total songs considered for fine-tuning this iteration: ${songsToActuallyTune.length}`);

        songsToActuallyTune.forEach(songFromGroup => {
            const songIndexInSimulated = newSimulatedB30Songs.findIndex(s => s.id === songFromGroup.id && s.diff === songFromGroup.diff);
            if (songIndexInSimulated === -1) {
                 console.warn(`[FINE_TUNING_PHASE_2-2_WARN] Song from group ${songFromGroup.title} not found in current simulatedB30. Skipping.`);
                 return; 
            }
            
            let currentSongInSim = newSimulatedB30Songs[songIndexInSimulated];
            const maxScoreAllowed = isScoreLimitReleased ? 1010000 : 1009000;

            if (currentSongInSim.currentScore < maxScoreAllowed) {
                const targetMicroTuneRating = currentSongInSim.currentRating + 0.0001; 
                const minScoreInfo = findMinScoreForTargetRating(currentSongInSim, targetMicroTuneRating, isScoreLimitReleased);

                if (minScoreInfo.possible && minScoreInfo.score > currentSongInSim.currentScore && minScoreInfo.score <= maxScoreAllowed) {
                    console.log(`[FINE_TUNING_PHASE_2-2_UPDATE] Fine-tuning ${currentSongInSim.title} (${currentSongInSim.diff}): Score ${currentSongInSim.currentScore} -> ${minScoreInfo.score}, Rating ${currentSongInSim.currentRating.toFixed(4)} -> ${minScoreInfo.rating.toFixed(4)}`);
                    currentSongInSim = {
                        ...currentSongInSim,
                        currentScore: minScoreInfo.score,
                        currentRating: minScoreInfo.rating,
                        targetScore: minScoreInfo.score, 
                        targetRating: minScoreInfo.rating, 
                    };
                    newSimulatedB30Songs[songIndexInSimulated] = currentSongInSim;
                    madeChangeInFineTuning = true;
                }
            }
        });
        
        if (madeChangeInFineTuning) {
             console.log("[FINE_TUNING_PHASE_2-2_INFO] Changes made during fine-tuning. Updating B30 songs.");
             setSimulatedB30Songs(sortSongsByRatingDesc(newSimulatedB30Songs));
        } else {
            console.log("[FINE_TUNING_PHASE_2-2_INFO] No changes made during this fine-tuning iteration. (This might lead to stuck_awaiting_replacement if target not met)");
        }
        setCurrentPhase('evaluating_fine_tuning_result');
    }
  }, [currentPhase, simulatedB30Songs, calculationStrategy, fineTuningGroupA, fineTuningGroupB, fineTuningTargetGroup, isScoreLimitReleased]);

  // 2-3: 최종 목표 확인 (미세 조정 페이즈)
  useEffect(() => {
    if (currentPhase === 'evaluating_fine_tuning_result' && simulatedAverageB30Rating !== null && targetRatingDisplay) {
      console.log(`[FINE_TUNING_PHASE_2-3] Evaluating fine-tuning result. Current avg B30: ${simulatedAverageB30Rating}, Target: ${targetRatingDisplay}`);
      const targetRatingNum = parseFloat(targetRatingDisplay);

      if (simulatedAverageB30Rating >= targetRatingNum) {
        console.log(`[FINE_TUNING_PHASE_2-3_TARGET_REACHED] Target rating ${targetRatingNum} reached! Current avg: ${simulatedAverageB30Rating}`);
        setCurrentPhase('target_reached');
      } else {
        // If no changes were made in the last 'performing_fine_tuning' and target is not met,
        // it implies that fine-tuning cannot further improve the rating with the current B30 songs.
        // We need a way to detect this "no effective change" state to prevent infinite loops if 2-1 keeps re-initializing with the same songs.
        // For now, the problem statement says "loop back to 2-1".
        // The breakout will happen if 2-1 determines no groups can be formed (e.g., all updatable songs are already at max for micro-tune).
        console.log(`[FINE_TUNING_PHASE_2-3_LOOP_BACK] Target not reached. Looping back to re-initialize fine-tuning phase.`);
        setCurrentPhase('initializing_fine_tuning_phase'); 
      }
    }
  }, [currentPhase, simulatedAverageB30Rating, targetRatingDisplay]);


  // --- 과제 3: B30 교체 로직 ---
  useEffect(() => {
    if (currentPhase === 'stuck_awaiting_replacement' && simulatedB30Songs.length > 0) {
      console.log("[REPLACE_LOGIC_TRIGGERED] Stuck. Identifying song to replace from B30.");
      const sortedB30ForReplacement = [...simulatedB30Songs].sort((a,b) => a.currentRating - b.currentRating);
      const songOut = sortedB30ForReplacement[0]; 
      if (songOut) {
        setSongToReplace(songOut);
        console.log(`[REPLACE_LOGIC] Song to replace: ${songOut.title} (Rating: ${songOut.currentRating.toFixed(4)})`);
        setCurrentPhase('awaiting_external_data_for_replacement'); 
      } else {
        console.error("[REPLACE_LOGIC_ERROR] Could not find a song to replace in B30 (simulatedB30Songs is empty or problematic).");
        setCurrentPhase('error');
      }
    } else if (currentPhase === 'stuck_awaiting_replacement' && simulatedB30Songs.length === 0) {
        console.error("[REPLACE_LOGIC_ERROR] Stuck, but simulatedB30Songs is empty. Cannot proceed with replacement.");
        setCurrentPhase('error');
    }
  }, [currentPhase, simulatedB30Songs]);

  useEffect(() => {
    if (currentPhase === 'awaiting_external_data_for_replacement') {
        if (allMusicData.length > 0 && userPlayHistory.length > 0 && songToReplace) {
            console.log("[REPLACE_LOGIC_DATA_READY] External data loaded. Proceeding to identify candidates.");
            setCurrentPhase('identifying_candidates');
        } else if (!songToReplace) {
            console.warn("[REPLACE_LOGIC_DATA_WAIT] songToReplace is null. Cannot identify candidates yet. This might indicate an issue in prior phase.");
             setCurrentPhase('error'); // Or some other recovery/stuck state
        } else if (allMusicData.length === 0 || userPlayHistory.length === 0){
            console.log("[REPLACE_LOGIC_DATA_WAIT] Waiting for external music/play history data. Data might be loading or missing from initial fetch.");
            // Potentially trigger a re-fetch or notify user if data is persistently missing.
            // For now, it relies on the initial fetch in fetchAndProcessData. If it never arrives, it's stuck.
            // Consider adding a timeout or explicit error state if data isn't available after a while.
        }
    }
  }, [currentPhase, allMusicData, userPlayHistory, songToReplace]);


  useEffect(() => {
    if (currentPhase === 'identifying_candidates' && songToReplace && allMusicData.length > 0) {
      console.log(`[REPLACE_LOGIC_IDENTIFYING] Identifying candidates to replace '${songToReplace.title}'.`);
      
      const currentB30IdsAndDiffs = new Set(simulatedB30Songs.map(s => `${s.id}_${s.diff}`));
      
      const potentialCandidatesApi = allMusicData.filter(globalSong => {
        if (!globalSong.id || !globalSong.diff || !globalSong.title) return false; 
        if (currentB30IdsAndDiffs.has(`${globalSong.id}_${globalSong.diff.toUpperCase()}`)) return false;
        
        const tempSongObjForConst = mapApiSongToAppSong(globalSong, 0, globalSong.const);
        if (!tempSongObjForConst.chartConstant) return false;
        
        const potentialMaxRating = tempSongObjForConst.chartConstant + 2.15; 
        return potentialMaxRating > songToReplace.currentRating;
      });

      const mappedCandidates = potentialCandidatesApi.map(apiEntry => {
        const playedVersion = userPlayHistory.find(p => p.id === apiEntry.id && p.diff.toUpperCase() === apiEntry.diff.toUpperCase());
        return mapApiSongToAppSong(playedVersion || apiEntry, 0, apiEntry.const); 
      });

      setCandidateSongsForReplacement(mappedCandidates);
      console.log(`[REPLACE_LOGIC_CANDIDATES_FOUND] Found ${mappedCandidates.length} potential candidates.`);
      setCurrentPhase('candidates_identified');
    } else if (currentPhase === 'identifying_candidates' && (!songToReplace || allMusicData.length === 0)) {
        console.warn("[REPLACE_LOGIC_IDENTIFYING_STUCK] Missing songToReplace or allMusicData. Cannot identify candidates.");
        setCurrentPhase('error'); 
    }
  }, [currentPhase, songToReplace, allMusicData, userPlayHistory, simulatedB30Songs]);

  useEffect(() => {
    if (currentPhase === 'candidates_identified' && songToReplace) { // Ensure songToReplace is still valid
      if (candidateSongsForReplacement.length === 0) {
          console.log("[REPLACE_LOGIC_NO_CANDIDATES_FOUND] No candidates found after identification. Simulation may be stuck or complete if no external improvements possible.");
          setCurrentPhase('error'); // Or a specific "no_more_improvements" state
          return;
      }
      console.log("[REPLACE_LOGIC_SELECTING_OPTIMAL] Selecting optimal candidate.");
      setCurrentPhase('selecting_optimal_candidate');
      let bestCandidateInfo: { song: Song | null; effort: number; neededScore: number; resultingRating: number } = { song: null, effort: Infinity, neededScore: 0, resultingRating: 0 };
      
      candidateSongsForReplacement.forEach(candidate => {
        if (!candidate.chartConstant) return; 
        const minScoreInfo = findMinScoreForTargetRating(candidate, songToReplace.currentRating + 0.0001, isScoreLimitReleased);
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
        console.log(`[REPLACE_LOGIC_OPTIMAL_SELECTED] Optimal candidate: ${finalOptimalCandidate.title} (Target Score: ${finalOptimalCandidate.targetScore}, Target Rating: ${finalOptimalCandidate.targetRating.toFixed(4)})`);
        setCurrentPhase('optimal_candidate_selected');
      } else {
        console.log("[REPLACE_LOGIC_NO_OPTIMAL] No suitable optimal candidate found. Simulation may be stuck or complete if no further improvements possible.");
        setCurrentPhase('error'); 
      }
    } else if (currentPhase === 'candidates_identified' && !songToReplace) {
        console.error("[REPLACE_LOGIC_ERROR] In 'candidates_identified' but songToReplace is null. This shouldn't happen.");
        setCurrentPhase('error');
    }
  }, [currentPhase, candidateSongsForReplacement, songToReplace, isScoreLimitReleased]);

  useEffect(() => {
    if (currentPhase === 'optimal_candidate_selected' && optimalCandidateSong && songToReplace) {
      console.log(`[REPLACE_LOGIC_REPLACING] Replacing '${songToReplace.title}' with '${optimalCandidateSong.title}'`);
      setCurrentPhase('replacing_song');
      const newB30EntryForOptimalCandidate: Song = {
        ...optimalCandidateSong,
        currentScore: optimalCandidateSong.targetScore, 
        currentRating: optimalCandidateSong.targetRating,
      };
      const updatedB30 = simulatedB30Songs.filter(s => !(s.id === songToReplace.id && s.diff === songToReplace.diff));
      updatedB30.push(newB30EntryForOptimalCandidate);
      
      setSimulatedB30Songs(sortSongsByRatingDesc(updatedB30));
      console.log("[REPLACE_LOGIC_COMPLETE] B30 list updated. Resetting for next evaluation cycle (back to Leap Phase).");
      setSongToReplace(null); setOptimalCandidateSong(null); setCandidateSongsForReplacement([]);
      // After replacement, always go back to the beginning of the Leap Phase (1-1)
      // to re-evaluate the new B30 set from scratch.
      setCurrentPhase('initializing_leap_phase'); 
    }
  }, [currentPhase, optimalCandidateSong, songToReplace, simulatedB30Songs]);

  const displaySongs = currentPhase === 'idle' && simulatedB30Songs.length === 0 && best30SongsData.length > 0
    ? best30SongsData
    : simulatedB30Songs;

  return {
    apiPlayerName,
    best30SongsData: displaySongs, // Use displaySongs for UI
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

    updatableForLeapPhase,
    leapTargetGroup,
    songsWithLeapEfficiency,

    updatableForFineTuning,
    fineTuningTargetGroup,
    fineTuningGroupA,
    fineTuningGroupB,

    songToReplace,
    optimalCandidateSong,
    candidateSongsForReplacement, // For debugging if needed
  };
}

    
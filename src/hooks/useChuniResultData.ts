
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateChunithmSongRating, findMinScoreForTargetRating, getNextGradeBoundaryScore } from '@/lib/rating-utils';
import type { Song, ProfileData, RatingApiResponse, GlobalMusicApiResponse, UserShowallApiResponse, ShowallApiSongEntry, RatingApiSongEntry, CalculationStrategy } from "@/types/result-page";

const BEST_COUNT = 30;
// const NEW_COUNT = 20; // Currently not used for New 20 calculation in this revised approach

type SimulationPhase = 
  | 'idle' // 초기 또는 완료/중단 상태
  | 'initializing_leap_phase' // 1-1 시작
  | 'analyzing_leap_efficiency' // 1-2 시작
  | 'performing_leap_jump' // 1-3 시작
  | 'evaluating_leap_result' // 1-4 시작
  | 'transitioning_to_fine_tuning' // 1-4B 조건 충족 시
  | 'initializing_fine_tuning_phase' // 2-1 시작
  | 'performing_fine_tuning' // 2-2 시작
  | 'evaluating_fine_tuning_result' // 2-3 시작
  | 'target_reached' // 최종 목표 달성
  | 'stuck_awaiting_replacement' // 진행 불가, 곡 교체 로직 대기 (3-1, 3-2 준비)
  | 'awaiting_external_data_for_replacement' // 곡 교체를 위한 외부 데이터 로딩 대기
  | 'identifying_candidates' // 외부 곡 후보 탐색 중
  | 'candidates_identified' // 외부 곡 후보 탐색 완료
  | 'selecting_optimal_candidate' // 최적 교체 후보 선정 중
  | 'optimal_candidate_selected' // 최적 교체 후보 선정 완료
  | 'replacing_song' // B30 리스트 교체 중 (이 상태는 'optimal_candidate_selected' 직후 짧게 거치거나 통합될 수 있음)
  | 'error';


interface UseChuniResultDataProps {
  userNameForApi: string | null;
  currentRatingDisplay: string | null;
  targetRatingDisplay: string | null;
  locale: Locale;
  refreshNonce: number;
  clientHasMounted: boolean;
  calculationStrategy: CalculationStrategy | null; // Can be null initially
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
  
  // 시뮬레이션 상태 및 결과
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);

  // 과제 1: 도약 페이즈 관련 상태
  const [updatableForLeapPhase, setUpdatableForLeapPhase] = useState<Song[]>([]); // 1-1
  const [leapTargetGroup, setLeapTargetGroup] = useState<Song[]>([]); // 1-1
  const [songsWithLeapEfficiency, setSongsWithLeapEfficiency] = useState<Array<Song & { leapEfficiency?: number; scoreToReachNextGrade?: number; ratingAtNextGrade?: number }>>([]); // 1-2

  // 외부 데이터 (전체 곡 목록, 사용자 전체 플레이 기록)
  const [allMusicData, setAllMusicData] = useState<ShowallApiSongEntry[]>([]);
  const [userPlayHistory, setUserPlayHistory] = useState<ShowallApiSongEntry[]>([]);


  // --- 과제 0-2, 0-4: 초기 설정 (점수 상한, 페이즈 전환점) ---
  useEffect(() => {
    if (clientHasMounted && currentRatingDisplay && targetRatingDisplay) {
      const currentRatingNum = parseFloat(currentRatingDisplay);
      const targetRatingNum = parseFloat(targetRatingDisplay);

      if (!isNaN(currentRatingNum) && isFinite(currentRatingNum) && !isNaN(targetRatingNum) && isFinite(targetRatingNum)) {
        // 0-2: 점수 상한 한계 해제 규칙
        const limitReleaseCondition = (targetRatingNum - currentRatingNum) * 50 > 10;
        setIsScoreLimitReleased(limitReleaseCondition);
        console.log(`[CHAL_0-2_SCORE_CAP_RELEASE] Score cap release flag set to ${limitReleaseCondition}. ((target:${targetRatingNum} - current:${currentRatingNum}) * 50 > 10)`);
        
        // 0-4: 페이즈 전환점 계산 (목표 - 현재 레이팅의 95% 지점)
        const transitionPoint = currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95;
        setPhaseTransitionPoint(parseFloat(transitionPoint.toFixed(4)));
        console.log(`[CHAL_0-4_PHASE_TRANSITION_POINT] Phase transition point calculated: ${transitionPoint.toFixed(4)}`);
      } else {
        setIsScoreLimitReleased(false);
        setPhaseTransitionPoint(null);
        console.warn(`[CHAL_0-2/0-4] Ratings ('${currentRatingDisplay}', '${targetRatingDisplay}') not valid numbers. Score cap release defaults to false. Phase transition point not set.`);
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
          if (profileCacheItem) { try { const parsed = JSON.parse(profileCacheItem) as { timestamp: number }; if (parsed && typeof parsed.timestamp === 'number') { cachedProfileTimestamp = new Date(parsed.timestamp).toLocaleString(locale); }} catch (e) { console.error("Error parsing profile cache timestamp", e); }}
      }
      setLastRefreshed(cachedProfileTimestamp ? getTranslation(locale, 'resultPageSyncStatus', cachedProfileTimestamp) : getTranslation(locale, 'resultPageSyncStatusNoCache'));

      let profileData = getCachedData<ProfileData>(profileKey);
      let ratingData = getCachedData<RatingApiResponse>(ratingDataKey, USER_DATA_CACHE_EXPIRY_MS);
      let globalMusicCache = getCachedData<GlobalMusicApiResponse>(globalMusicKey, USER_DATA_CACHE_EXPIRY_MS); // Using USER_DATA_CACHE_EXPIRY_MS for now
      let userShowallCache = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);

      if (profileData) setApiPlayerName(profileData.player_name || userNameForApi);
      
      let initialB30: Song[] = [];
      if (ratingData?.best?.entries) {
        const bestEntriesApi = ratingData.best.entries.filter((e: any): e is RatingApiSongEntry => e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && typeof e.title === 'string' && e.title.trim() !== '') || [];
        initialB30 = sortSongsByRatingDesc(bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
        setBest30SongsData(initialB30);
        setSimulatedB30Songs([...initialB30]);
        if (initialB30.length > 0) {
            const avg = initialB30.slice(0, BEST_COUNT).reduce((sum, s) => sum + s.currentRating, 0) / Math.min(BEST_COUNT, initialB30.length);
            setSimulatedAverageB30Rating(parseFloat(avg.toFixed(4)));
        } else {
            setSimulatedAverageB30Rating(null);
        }
      }

      if (globalMusicCache?.records) {
        setAllMusicData(globalMusicCache.records);
      }
      if (userShowallCache?.records) {
        setUserPlayHistory(userShowallCache.records);
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
                const bestEntriesApi = res.data.best?.entries?.filter((e: any): e is RatingApiSongEntry => e && e.id && typeof e.id === 'string' && e.id.trim() !== '' && e.diff && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && e.title && typeof e.title === 'string' && e.title.trim() !== '') || [];
                const newB30 = sortSongsByRatingDesc(bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
                setBest30SongsData(newB30);
                setSimulatedB30Songs([...newB30]); // Also update simulated songs
                 if (newB30.length > 0) {
                    const avg = newB30.slice(0, BEST_COUNT).reduce((sum, s) => sum + s.currentRating, 0) / Math.min(BEST_COUNT, newB30.length);
                    setSimulatedAverageB30Rating(parseFloat(avg.toFixed(4)));
                } else {
                    setSimulatedAverageB30Rating(null);
                }
                setCachedData<RatingApiResponse>(ratingDataKey, res.data);
              }
              if (res.type === 'globalMusic' && !globalMusicCache) {
                 setAllMusicData(res.data.records || []);
                 setCachedData<GlobalMusicApiResponse>(globalMusicKey, res.data);
              }
              if (res.type === 'userShowall' && !userShowallCache) {
                 setUserPlayHistory(res.data.records || []);
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
      } else { // All data from cache
         toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
      }

      // New 20 songs logic (placeholder for now, as it's not the primary focus of the hybrid engine's B30 part)
      // const newSongTitlesRaw = NewSongsData.titles?.verse || [];
      // const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());
      setNew20SongsData([]); 

      setIsLoadingSongs(false);
    };

    if (clientHasMounted) {
      fetchAndProcessData();
    }
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
      } else {
        setCombinedTopSongs([]);
      }
    }
  }, [best30SongsData, new20SongsData, simulatedB30Songs, isLoadingSongs]);


  // --- 과제 1-1: 시뮬레이션 시작 및 '도약 대상 그룹' 결정 ---
  useEffect(() => {
    if (!isLoadingSongs && best30SongsData.length > 0 && calculationStrategy && currentPhase === 'idle' &&
        currentRatingDisplay && targetRatingDisplay && parseFloat(currentRatingDisplay) < parseFloat(targetRatingDisplay)) {
      console.log(`[CHAL_1-1_INIT_LEAP_PHASE] Kicking off leap phase. Strategy: ${calculationStrategy}`);
      setCurrentPhase('initializing_leap_phase');
    }
  }, [isLoadingSongs, best30SongsData, calculationStrategy, currentPhase, currentRatingDisplay, targetRatingDisplay]);

  useEffect(() => {
    if (currentPhase === 'initializing_leap_phase' && !isLoadingSongs && best30SongsData.length > 0) {
      console.log("[CHAL_1-1_DETERMINE_LEAP_TARGETS] Determining Leap Target Group...");
      
      const updatable = best30SongsData.filter(song => song.currentScore < 1009000);
      setUpdatableForLeapPhase(updatable);
      console.log(`[CHAL_1-1_DETERMINE_LEAP_TARGETS] 'Updatable for Leap' (score < 1,009,000): ${updatable.length} songs.`);

      let determinedLeapTargetGroup: Song[] = [];
      if (updatable.length === 0) {
        console.warn("[CHAL_1-1_DETERMINE_LEAP_TARGETS] No songs in 'Updatable for Leap' group. Cannot proceed with leap phase.");
        setCurrentPhase('stuck_awaiting_replacement');
        setLeapTargetGroup([]);
        return;
      }

      if (calculationStrategy === 'average') {
        determinedLeapTargetGroup = [...updatable];
      } else {
        const sortedUpdatable = [...updatable].sort((a, b) => a.currentRating - b.currentRating);
        let medianRating: number;
        const midIndex = Math.floor(sortedUpdatable.length / 2);
        if (sortedUpdatable.length % 2 === 0) { // Even number of songs
          medianRating = (sortedUpdatable[midIndex - 1].currentRating + sortedUpdatable[midIndex].currentRating) / 2;
        } else { // Odd number of songs
          medianRating = sortedUpdatable[midIndex].currentRating;
        }
        console.log(`[CHAL_1-1_DETERMINE_LEAP_TARGETS] Median rating for updatableLeap: ${medianRating.toFixed(4)}`);

        if (calculationStrategy === 'floor') {
          determinedLeapTargetGroup = updatable.filter(song => song.currentRating <= medianRating);
        } else if (calculationStrategy === 'peak') {
          determinedLeapTargetGroup = updatable.filter(song => song.currentRating > medianRating);
        }
      }
      
      setLeapTargetGroup(determinedLeapTargetGroup);
      console.log(`[CHAL_1-1_DETERMINE_LEAP_TARGETS] Leap Target Group (Strategy: ${calculationStrategy}): ${determinedLeapTargetGroup.length} songs. Sample:`, determinedLeapTargetGroup.slice(0,3).map(s => ({title: s.title, rating: s.currentRating})));
      
      if (determinedLeapTargetGroup.length > 0) {
        setCurrentPhase('analyzing_leap_efficiency'); 
      } else {
        console.warn(`[CHAL_1-1_DETERMINE_LEAP_TARGETS] Leap Target Group is empty for strategy ${calculationStrategy}.`);
        setCurrentPhase('stuck_awaiting_replacement'); 
      }
    }
  }, [currentPhase, isLoadingSongs, best30SongsData, calculationStrategy]);

  // --- 과제 1-2: '도약 대상 그룹' 효율성 분석 ---
  useEffect(() => {
    if (currentPhase === 'analyzing_leap_efficiency' && leapTargetGroup.length > 0) {
      console.log("[CHAL_1-2_ANALYZE_EFFICIENCY] Analyzing leap efficiency for target group...");
      const songsWithCalculatedEfficiency = leapTargetGroup.map(song => {
        const nextGradeScore = getNextGradeBoundaryScore(song.currentScore);
        let leapEfficiency = 0;
        let scoreToReachNextGrade: number | undefined = undefined;
        let ratingAtNextGrade: number | undefined = undefined;

        if (song.chartConstant && nextGradeScore && song.currentScore < nextGradeScore) {
          const currentSongRating = song.currentRating;
          const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, song.chartConstant);
          const ratingIncrease = potentialRatingAtNextGrade - currentSongRating;
          const scoreIncrease = nextGradeScore - song.currentScore;

          if (scoreIncrease > 0 && ratingIncrease > 0) {
            leapEfficiency = ratingIncrease / scoreIncrease;
            scoreToReachNextGrade = nextGradeScore;
            ratingAtNextGrade = potentialRatingAtNextGrade;
          }
        }
        return { ...song, leapEfficiency, scoreToReachNextGrade, ratingAtNextGrade };
      });

      setSongsWithLeapEfficiency(songsWithCalculatedEfficiency);
      console.log("[CHAL_1-2_ANALYZE_EFFICIENCY] Calculated leap efficiencies (sample):", songsWithCalculatedEfficiency.filter(s => (s.leapEfficiency || 0) > 0).slice(0, 5).map(s => ({ title: s.title, eff: s.leapEfficiency?.toFixed(6) })));
      
      const hasEfficientSongs = songsWithCalculatedEfficiency.some(s => (s.leapEfficiency || 0) > 0);
      if (hasEfficientSongs) {
        setCurrentPhase('performing_leap_jump');
      } else {
        console.log("[CHAL_1-2_ANALYZE_EFFICIENCY] No songs with positive leap efficiency found. Cannot proceed with leap jump.");
        setCurrentPhase('stuck_awaiting_replacement'); // Or another appropriate state
      }
    }
  }, [currentPhase, leapTargetGroup]);


  return {
    apiPlayerName,
    best30SongsData: simulatedB30Songs.length > 0 ? simulatedB30Songs : best30SongsData,
    new20SongsData,
    combinedTopSongs,
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    
    // 과제 0
    isScoreLimitReleased,
    phaseTransitionPoint,
    calculationStrategy, // Expose for UI and other logic

    // 시뮬레이션 상태 및 결과
    currentPhase,
    simulatedAverageB30Rating,

    // 과제 1
    updatableForLeapPhase,
    leapTargetGroup,
    songsWithLeapEfficiency,
  };
}

    
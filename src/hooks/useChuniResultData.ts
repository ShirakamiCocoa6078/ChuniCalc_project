
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, GLOBAL_MUSIC_CACHE_EXPIRY_MS, LOCAL_STORAGE_PREFIX, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateChunithmSongRating, findMinScoreForTargetRating, getNextGradeBoundaryScore } from '@/lib/rating-utils';
import type { Song, ProfileData, RatingApiResponse, GlobalMusicApiResponse, UserShowallApiResponse, ShowallApiSongEntry, RatingApiSongEntry, CalculationStrategy } from "@/types/result-page";

const BEST_COUNT = 30;
const NEW_COUNT = 20;

type SimulationPhase = 
  | 'idle'
  | 'initializing_leap_phase' // 1-1 시작
  | 'analyzing_leap_efficiency' // 1-2 시작
  | 'performing_leap_jump' // 1-3 시작
  | 'evaluating_leap_result' // 1-4 시작
  | 'transitioning_to_fine_tuning' // 1-4B 조건 충족 시
  | 'initializing_fine_tuning_phase' // 2-1 시작
  | 'performing_fine_tuning' // 2-2 시작
  | 'evaluating_fine_tuning_result' // 2-3 시작
  | 'target_reached' // 최종 목표 달성
  | 'stuck_awaiting_replacement' // 3-1, 3-2 준비 (도약/미세조정으로 더이상 진행 불가)
  | 'error';


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
  const [best30SongsData, setBest30SongsData] = useState<Song[]>([]);
  const [new20SongsData, setNew20SongsData] = useState<Song[]>([]);
  const [combinedTopSongs, setCombinedTopSongs] = useState<Song[]>([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(true);
  const [errorLoadingSongs, setErrorLoadingSongs] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  // 0-2단계: 점수 상한 한계 해제 규칙
  const [isScoreLimitReleased, setIsScoreLimitReleased] = useState(false);
  // 0-4단계: 페이즈 전환점
  const [phaseTransitionPoint, setPhaseTransitionPoint] = useState<number | null>(null);
  
  // 시뮬레이션 상태 및 결과
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]); // 시뮬레이션 중 B30 곡 목록
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null); // 시뮬레이션된 B30 평균

  // 과제 1-1 관련 상태
  const [updatableForLeapPhase, setUpdatableForLeapPhase] = useState<Song[]>([]);
  const [leapTargetGroup, setLeapTargetGroup] = useState<Song[]>([]);


  // --- 초기 데이터 로드 및 기본 설정 ---
  useEffect(() => {
    if (clientHasMounted) {
      const currentIsValidNumber = currentRatingDisplay && !isNaN(parseFloat(currentRatingDisplay)) && isFinite(parseFloat(currentRatingDisplay));
      const targetIsValidNumber = targetRatingDisplay && !isNaN(parseFloat(targetRatingDisplay)) && isFinite(parseFloat(targetRatingDisplay));

      if (currentIsValidNumber && targetIsValidNumber) {
        const currentRatingNum = parseFloat(currentRatingDisplay);
        const targetRatingNum = parseFloat(targetRatingDisplay);
        
        // 0-2단계: 점수 상한 한계 해제 규칙
        const limitReleaseCondition = (targetRatingNum - currentRatingNum) * 50 > 10;
        setIsScoreLimitReleased(limitReleaseCondition);
        console.log(`[CHAL_0-2_SCORE_CAP_RELEASE] Score cap release flag set to ${limitReleaseCondition}. ((target:${targetRatingNum} - current:${currentRatingNum}) * 50 > 10)`);
        
        // 0-4단계: 페이즈 전환점 계산
        const transitionPoint = currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95;
        setPhaseTransitionPoint(parseFloat(transitionPoint.toFixed(4)));
        console.log(`[CHAL_0-4_PHASE_TRANSITION_POINT] Phase transition point calculated: ${transitionPoint.toFixed(4)}`);

      } else {
        setIsScoreLimitReleased(false);
        setPhaseTransitionPoint(null);
        console.log(`[CHAL_0-2/0-4] Ratings ('${currentRatingDisplay}', '${targetRatingDisplay}') not valid numbers or not available. Score cap release defaults to false. Phase transition point not set.`);
      }
    }
  }, [clientHasMounted, currentRatingDisplay, targetRatingDisplay]);

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
      setCurrentPhase('idle'); // 데이터 로드 시 페이즈 초기화

      const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
      const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
      // const globalMusicKey = GLOBAL_MUSIC_DATA_KEY; // 향후 교체 로직에 필요
      // const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`; // 향후 교체 로직에 필요

      let cachedProfileTimestamp: string | null = null;
      if (clientHasMounted) {
          const profileCacheItem = localStorage.getItem(profileKey);
          if (profileCacheItem) { try { const parsed = JSON.parse(profileCacheItem) as { timestamp: number }; if (parsed && typeof parsed.timestamp === 'number') { cachedProfileTimestamp = new Date(parsed.timestamp).toLocaleString(locale); }} catch (e) { console.error("Error parsing profile cache timestamp", e); }}
      }
      setLastRefreshed(cachedProfileTimestamp ? getTranslation(locale, 'resultPageSyncStatus', cachedProfileTimestamp) : getTranslation(locale, 'resultPageSyncStatusNoCache'));

      let profileData = getCachedData<ProfileData>(profileKey);
      let ratingData = getCachedData<RatingApiResponse>(ratingDataKey, USER_DATA_CACHE_EXPIRY_MS);
      
      let b30LoadedFromCache = false;
      if (profileData) setApiPlayerName(profileData.player_name || userNameForApi);
      
      if (ratingData) {
        const bestEntriesApi = ratingData.best?.entries?.filter((e: any): e is RatingApiSongEntry => e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && typeof e.title === 'string' && e.title.trim() !== '') || [];
        const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
        const sortedB30 = sortSongsByRatingDesc(mappedBestEntries);
        setBest30SongsData(sortedB30);
        setSimulatedB30Songs(sortedB30.map(s => ({...s}))); // 시뮬레이션 B30 초기화
        if (sortedB30.length > 0) {
          const initialAvg = sortedB30.reduce((sum, s) => sum + s.currentRating, 0) / Math.max(1, sortedB30.length);
          setSimulatedAverageB30Rating(parseFloat(initialAvg.toFixed(4)));
        } else {
          setSimulatedAverageB30Rating(null);
        }
        b30LoadedFromCache = true;
      }

      if (!profileData || !ratingData) {
        const apiRequests = [];
        if (!profileData) apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/profile.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'profile', data, ok: res.ok, status: res.status})).catch(() => ({type: 'profile', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        if (!ratingData) apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'rating', data, ok: res.ok, status: res.status})).catch(() => ({type: 'rating', error: 'JSON_PARSE_ERROR', ok: false, status: res.status }))));
        
        if (apiRequests.length > 0) {
          try {
            const responses = await Promise.all(apiRequests);
            let criticalError = null;
            for (const res of responses) {
              if (!res.ok) { const errorMsg = `${res.type} data API failed (status: ${res.status}): ${res.data?.error?.message || res.error || 'Unknown API error'}`; if (!criticalError) criticalError = errorMsg; continue; }
              if (res.type === 'profile' && !profileData) { setApiPlayerName(res.data.player_name || userNameForApi); setCachedData<ProfileData>(profileKey, res.data); }
              if (res.type === 'rating' && !ratingData) {
                const bestEntriesApi = res.data.best?.entries?.filter((e: any): e is RatingApiSongEntry => e && e.id && typeof e.id === 'string' && e.id.trim() !== '' && e.diff && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && e.title && typeof e.title === 'string' && e.title.trim() !== '') || [];
                const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
                const sortedB30 = sortSongsByRatingDesc(mappedBestEntries);
                setBest30SongsData(sortedB30);
                setSimulatedB30Songs(sortedB30.map(s => ({...s}))); // 시뮬레이션 B30 초기화
                if (sortedB30.length > 0) {
                  const initialAvg = sortedB30.reduce((sum, s) => sum + s.currentRating, 0) / Math.max(1, sortedB30.length);
                  setSimulatedAverageB30Rating(parseFloat(initialAvg.toFixed(4)));
                } else {
                  setSimulatedAverageB30Rating(null);
                }
                setCachedData<RatingApiResponse>(ratingDataKey, res.data);
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
      } else if (b30LoadedFromCache) {
         toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
      }

      // New 20 songs logic - can be simplified or removed if not focus of current tasks
      const newSongTitlesRaw = NewSongsData.titles?.verse || [];
      const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());
      // For New20, we need global music list and user's full play history.
      // These are not fetched in this simplified version to focus on B30.
      // If New20 is needed, fetching for GLOBAL_MUSIC_DATA_KEY and userShowallKey must be re-enabled.
      setNew20SongsData([]); // Placeholder

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
    if (!isLoadingSongs && best30SongsData.length > 0 && calculationStrategy && currentPhase === 'idle' && parseFloat(currentRatingDisplay || "0") < parseFloat(targetRatingDisplay || "0")) {
        console.log(`[CHAL_1-1_INIT] Kicking off leap phase. Strategy: ${calculationStrategy}`);
        setCurrentPhase('initializing_leap_phase');
    }
  }, [isLoadingSongs, best30SongsData, calculationStrategy, currentPhase, currentRatingDisplay, targetRatingDisplay]);

  useEffect(() => {
    if (currentPhase === 'initializing_leap_phase' && !isLoadingSongs && best30SongsData.length > 0) {
      console.log("[CHAL_1-1] Determining Leap Target Group...");
      
      // 1-1: '갱신 가능' 그룹 (점수 < 1,009,000점)
      const updatableLeap = best30SongsData.filter(song => song.currentScore < 1009000);
      setUpdatableForLeapPhase(updatableLeap);
      console.log(`[CHAL_1-1] 'Updatable for Leap' (score < 1,009,000): ${updatableLeap.length} songs.`);

      let determinedLeapTargetGroup: Song[] = [];
      if (updatableLeap.length === 0) {
        console.warn("[CHAL_1-1] No songs in 'Updatable for Leap' group. Cannot proceed with leap phase.");
        setCurrentPhase('stuck_awaiting_replacement'); // Or an error/idle state
        setLeapTargetGroup([]);
        return;
      }

      if (calculationStrategy === 'average') {
        determinedLeapTargetGroup = [...updatableLeap];
      } else {
        // '저점' 또는 '고점' 기준: 중간값 계산
        const sortedUpdatable = [...updatableLeap].sort((a, b) => a.currentRating - b.currentRating);
        let medianRating: number;
        const mid = Math.floor(sortedUpdatable.length / 2);
        if (sortedUpdatable.length % 2 === 0) {
          medianRating = (sortedUpdatable[mid - 1].currentRating + sortedUpdatable[mid].currentRating) / 2;
        } else {
          medianRating = sortedUpdatable[mid].currentRating;
        }
        console.log(`[CHAL_1-1] Median rating for updatableLeap: ${medianRating.toFixed(4)}`);

        if (calculationStrategy === 'floor') {
          determinedLeapTargetGroup = updatableLeap.filter(song => song.currentRating <= medianRating);
        } else if (calculationStrategy === 'peak') {
          determinedLeapTargetGroup = updatableLeap.filter(song => song.currentRating > medianRating);
        }
      }
      
      setLeapTargetGroup(determinedLeapTargetGroup);
      console.log(`[CHAL_1-1] Leap Target Group (Strategy: ${calculationStrategy}): ${determinedLeapTargetGroup.length} songs. Sample:`, determinedLeapTargetGroup.slice(0,3).map(s => ({title: s.title, rating: s.currentRating})));
      
      if (determinedLeapTargetGroup.length > 0) {
        setCurrentPhase('analyzing_leap_efficiency'); // 다음 단계로
      } else {
        console.warn(`[CHAL_1-1] Leap Target Group is empty for strategy ${calculationStrategy}. Cannot proceed with leap phase normally.`);
        // 적절한 다음 상태 설정 (예: 바로 교체 로직으로 가거나, 에러 처리)
        setCurrentPhase('stuck_awaiting_replacement'); 
      }
    }
  }, [currentPhase, isLoadingSongs, best30SongsData, calculationStrategy]);


  return {
    apiPlayerName,
    best30SongsData: simulatedB30Songs.length > 0 ? simulatedB30Songs : best30SongsData, // 보여줄 때는 시뮬레이션 값 우선
    new20SongsData, // 현재 새 과제에서는 직접 사용되지 않음
    combinedTopSongs,
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    
    isScoreLimitReleased, // 0-2
    phaseTransitionPoint, // 0-4

    // 시뮬레이션 상태 및 결과
    currentPhase,
    simulatedAverageB30Rating,

    // 과제 1-1 결과
    updatableForLeapPhase,
    leapTargetGroup,
  };
}

    
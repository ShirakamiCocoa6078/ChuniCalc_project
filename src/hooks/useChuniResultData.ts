
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY, LOCAL_STORAGE_PREFIX } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateChunithmSongRating, findMinScoreForTargetRating, getNextGradeBoundaryScore } from '@/lib/rating-utils';
import type { Song, ProfileData, RatingApiResponse, GlobalMusicApiResponse, UserShowallApiResponse, ShowallApiSongEntry, RatingApiSongEntry, CalculationStrategy } from "@/types/result-page";

const BEST_COUNT = 30;

// Hybrid Engine Simulation Phases
type SimulationPhase = 
  | 'idle' // 초기 또는 완료/중단 상태
  | 'initializing_leap_phase' // 1-1 시작: 도약 페이즈 초기화
  | 'analyzing_leap_efficiency' // 1-2 시작: 도약 효율성 분석
  | 'performing_leap_jump' // 1-3 시작: 최적 대상 점수 도약
  | 'evaluating_leap_result' // 1-4 시작: 도약 결과 평가 및 다음 페이즈 판단
  | 'transitioning_to_fine_tuning' // 1-4B 조건 충족 시: 미세 조정 페이즈로 전환
  | 'initializing_fine_tuning_phase' // 2-1 시작: 미세 조정 페이즈 초기화
  | 'performing_fine_tuning' // 2-2 시작: 미세 조정 실행
  | 'evaluating_fine_tuning_result' // 2-3 시작: 미세 조정 결과 평가
  | 'target_reached' // 최종 목표 달성
  | 'stuck_awaiting_replacement' // 진행 불가, 곡 교체 로직 대기
  | 'awaiting_external_data_for_replacement' // 곡 교체를 위한 외부 데이터 로딩 대기
  | 'identifying_candidates' // 외부 곡 후보 탐색 중
  | 'candidates_identified' // 외부 곡 후보 탐색 완료
  | 'selecting_optimal_candidate' // 최적 교체 후보 선정 중
  | 'optimal_candidate_selected' // 최적 교체 후보 선정 완료
  | 'replacing_song' // B30 리스트 교체 중
  | 'error'; // 오류 발생


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
  const [isScoreLimitReleased, setIsScoreLimitReleased] = useState(false);
  const [phaseTransitionPoint, setPhaseTransitionPoint] = useState<number | null>(null);
  
  // 시뮬레이션 공통 상태
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);

  // 과제 1: 도약 페이즈 관련 상태
  const [updatableForLeapPhase, setUpdatableForLeapPhase] = useState<Song[]>([]);
  const [leapTargetGroup, setLeapTargetGroup] = useState<Song[]>([]);
  const [songsWithLeapEfficiency, setSongsWithLeapEfficiency] = useState<Array<Song & { leapEfficiency?: number; scoreToReachNextGrade?: number; ratingAtNextGrade?: number }>>([]);

  // 외부 데이터 (전체 곡 목록, 사용자 전체 플레이 기록)
  const [allMusicData, setAllMusicData] = useState<ShowallApiSongEntry[]>([]);
  const [userPlayHistory, setUserPlayHistory] = useState<ShowallApiSongEntry[]>([]);
  
  // --- 과제 0-2, 0-4: 초기 설정 (점수 상한, 페이즈 전환점) ---
  useEffect(() => {
    if (clientHasMounted && currentRatingDisplay && targetRatingDisplay) {
      const currentRatingNum = parseFloat(currentRatingDisplay);
      const targetRatingNum = parseFloat(targetRatingDisplay);

      if (!isNaN(currentRatingNum) && isFinite(currentRatingNum) && !isNaN(targetRatingNum) && isFinite(targetRatingNum)) {
        const limitReleaseCondition = (targetRatingNum - currentRatingNum) * 50 > 10;
        setIsScoreLimitReleased(limitReleaseCondition);
        console.log(`[CHAL_0-2_SCORE_CAP_RELEASE] Score cap release flag set to ${limitReleaseCondition}.`);
        
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
      // ... (기존 데이터 로드 로직은 대부분 유지, 아래 부분 추가/수정) ...
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
      setCurrentPhase('idle'); // 데이터 로드 시작 시 idle로 설정

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
      let globalMusicCache = getCachedData<GlobalMusicApiResponse>(globalMusicKey, USER_DATA_CACHE_EXPIRY_MS);
      let userShowallCache = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);
      
      let tempAllMusic: ShowallApiSongEntry[] = globalMusicCache?.records || [];
      let tempUserHistory: ShowallApiSongEntry[] = userShowallCache?.records || [];

      if (profileData) setApiPlayerName(profileData.player_name || userNameForApi);
      
      let initialB30: Song[] = [];
      if (ratingData?.best?.entries) {
        const bestEntriesApi = ratingData.best.entries.filter((e: any): e is RatingApiSongEntry => e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && typeof e.title === 'string' && e.title.trim() !== '') || [];
        initialB30 = sortSongsByRatingDesc(bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
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
                initialB30 = sortSongsByRatingDesc(bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
                setCachedData<RatingApiResponse>(ratingDataKey, res.data);
              }
              if (res.type === 'globalMusic' && !globalMusicCache) {
                 tempAllMusic = res.data.records || [];
                 setCachedData<GlobalMusicApiResponse>(globalMusicKey, res.data);
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
      
      setBest30SongsData(initialB30);
      setSimulatedB30Songs([...initialB30]); // Initialize simulated songs
      if (initialB30.length > 0) {
        const avg = initialB30.slice(0, BEST_COUNT).reduce((sum, s) => sum + s.currentRating, 0) / Math.min(BEST_COUNT, initialB30.length);
        setSimulatedAverageB30Rating(parseFloat(avg.toFixed(4)));
      } else {
        setSimulatedAverageB30Rating(null);
      }

      setAllMusicData(tempAllMusic);
      setUserPlayHistory(tempUserHistory);

      // New 20 songs logic (using NewSongs.json and user's full play history)
      if (tempAllMusic.length > 0 && tempUserHistory.length > 0) {
          const newSongTitlesRaw = NewSongsData.titles?.verse || [];
          const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());

          // 1. Filter global music list to get only "new songs" definitions
          const newSongDefinitions = tempAllMusic.filter(globalSong => 
              globalSong.title && newSongTitlesToMatch.includes(globalSong.title.trim().toLowerCase())
          );

          // 2. Create a map of user's played songs for quick lookup
          const userPlayedMap = new Map<string, ShowallApiSongEntry>();
          tempUserHistory.forEach(usrSong => {
              if (usrSong.id && usrSong.diff) {
                  userPlayedMap.set(`${usrSong.id}_${usrSong.diff.toUpperCase()}`, usrSong);
              }
          });
          
          // 3. Filter new song definitions for songs the user has played (score >= 800k)
          const playedNewSongsApi = newSongDefinitions.reduce((acc, newSongDef) => {
              const userPlayRecord = userPlayedMap.get(`${newSongDef.id}_${newSongDef.diff.toUpperCase()}`);
              if (userPlayRecord && typeof userPlayRecord.score === 'number' && userPlayRecord.score >= 800000) {
                  acc.push({
                      ...newSongDef, // from global music (has const, level, title etc.)
                      score: userPlayRecord.score, // from user history
                      rating: userPlayRecord.rating, // from user history if available, else calculated
                      is_played: true,
                      is_clear: userPlayRecord.is_clear,
                      is_fullcombo: userPlayRecord.is_fullcombo,
                      is_alljustice: userPlayRecord.is_alljustice,
                  });
              }
              return acc;
          }, [] as ShowallApiSongEntry[]);
          
          const finalNew20 = sortSongsByRatingDesc(
              playedNewSongsApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const))
          );
          setNew20SongsData(finalNew20);
      } else {
          setNew20SongsData([]);
      }

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


  // --- 과제 1: 도약 페이즈 ---

  // 1-0: 시뮬레이션 시작 조건 확인
  useEffect(() => {
    if (!isLoadingSongs && best30SongsData.length > 0 && calculationStrategy && currentPhase === 'idle' &&
        currentRatingDisplay && targetRatingDisplay && parseFloat(currentRatingDisplay) < parseFloat(targetRatingDisplay)) {
      console.log(`[CHAL_1-0_START_SIM] Conditions met. Current: ${currentRatingDisplay}, Target: ${targetRatingDisplay}. Strategy: ${calculationStrategy}. Starting Leap Phase.`);
      setCurrentPhase('initializing_leap_phase');
    }
  }, [isLoadingSongs, best30SongsData, calculationStrategy, currentPhase, currentRatingDisplay, targetRatingDisplay]);


  // 1-1: 시뮬레이션 시작 및 '도약 대상 그룹' 결정
  useEffect(() => {
    if (currentPhase === 'initializing_leap_phase' && !isLoadingSongs && best30SongsData.length > 0 && calculationStrategy) {
      console.log("[CHAL_1-1_INIT_LEAP_PHASE] Determining Leap Target Group...");
      
      const updatable = best30SongsData.filter(song => song.currentScore < 1009000);
      setUpdatableForLeapPhase(updatable);
      console.log(`[CHAL_1-1_INFO] 'Updatable for Leap' (score < 1,009,000): ${updatable.length} songs.`);

      if (updatable.length === 0) {
        console.warn("[CHAL_1-1_WARN] No songs in 'Updatable for Leap' group. Cannot proceed with leap phase.");
        setCurrentPhase('stuck_awaiting_replacement'); // Or another appropriate state
        setLeapTargetGroup([]);
        return;
      }

      let determinedLeapTargetGroup: Song[] = [];
      if (calculationStrategy === 'average') {
        determinedLeapTargetGroup = [...updatable];
      } else {
        const sortedUpdatable = [...updatable].sort((a, b) => a.currentRating - b.currentRating);
        let medianRating: number;
        const midIndex = Math.floor(sortedUpdatable.length / 2);
        if (sortedUpdatable.length % 2 === 0 && sortedUpdatable.length > 0) {
          medianRating = (sortedUpdatable[midIndex - 1].currentRating + sortedUpdatable[midIndex].currentRating) / 2;
        } else if (sortedUpdatable.length > 0) {
          medianRating = sortedUpdatable[midIndex].currentRating;
        } else { // Should not happen if updatable.length > 0, but as a fallback
            medianRating = 0; 
        }
        console.log(`[CHAL_1-1_INFO] Median rating for updatableLeap: ${medianRating.toFixed(4)}`);

        if (calculationStrategy === 'floor') {
          determinedLeapTargetGroup = updatable.filter(song => song.currentRating <= medianRating);
        } else if (calculationStrategy === 'peak') {
          determinedLeapTargetGroup = updatable.filter(song => song.currentRating > medianRating);
        }
      }
      
      setLeapTargetGroup(determinedLeapTargetGroup);
      console.log(`[CHAL_1-1_RESULT] Leap Target Group (Strategy: ${calculationStrategy}): ${determinedLeapTargetGroup.length} songs. Sample:`, determinedLeapTargetGroup.slice(0,3).map(s => ({title: s.title, rating: s.currentRating})));
      
      if (determinedLeapTargetGroup.length > 0) {
        setCurrentPhase('analyzing_leap_efficiency'); 
      } else {
        console.warn(`[CHAL_1-1_WARN] Leap Target Group is empty for strategy ${calculationStrategy}.`);
        setCurrentPhase('stuck_awaiting_replacement'); 
      }
    }
  }, [currentPhase, isLoadingSongs, best30SongsData, calculationStrategy]);

  // 1-2: '도약 대상 그룹' 효율성 분석
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
      }).filter(s => s.leapEfficiency !== undefined && s.leapEfficiency > 0); // Only keep songs with positive efficiency

      setSongsWithLeapEfficiency(songsWithCalculatedEfficiency);
      console.log("[CHAL_1-2_RESULT] Calculated leap efficiencies (sample, positive efficiency only):", songsWithCalculatedEfficiency.slice(0, 5).map(s => ({ title: s.title, eff: s.leapEfficiency?.toFixed(6), nextScore: s.scoreToReachNextGrade })));
      
      if (songsWithCalculatedEfficiency.length > 0) {
        setCurrentPhase('performing_leap_jump');
      } else {
        console.log("[CHAL_1-2_WARN] No songs with positive leap efficiency found. Cannot proceed with leap jump.");
        setCurrentPhase('stuck_awaiting_replacement'); 
      }
    }
  }, [currentPhase, leapTargetGroup]);

  // 1-3: 최적 대상 점수 도약
  useEffect(() => {
    if (currentPhase === 'performing_leap_jump' && songsWithLeapEfficiency.length > 0 && simulatedB30Songs.length > 0) {
      console.log("[CHAL_1-3_PERFORM_LEAP_JUMP] Performing leap jump for most efficient song...");

      // Find the song with the highest leapEfficiency.
      // If multiple, prioritize one with lower currentRating (can be added later if needed).
      const sortedByEfficiency = [...songsWithLeapEfficiency].sort((a, b) => (b.leapEfficiency || 0) - (a.leapEfficiency || 0));
      const optimalLeapSong = sortedByEfficiency[0];

      if (!optimalLeapSong || !optimalLeapSong.scoreToReachNextGrade || !optimalLeapSong.ratingAtNextGrade) {
        console.error("[CHAL_1-3_ERROR] Could not find a valid optimal song for leap jump or missing required data (scoreToReachNextGrade/ratingAtNextGrade).", optimalLeapSong);
        setCurrentPhase('error'); // Or 'stuck_awaiting_replacement'
        return;
      }

      console.log(`[CHAL_1-3_INFO] Optimal leap song: ${optimalLeapSong.title} (Diff: ${optimalLeapSong.diff}). Current Score: ${optimalLeapSong.currentScore}, Target Score: ${optimalLeapSong.scoreToReachNextGrade}`);

      const newSimulatedB30 = simulatedB30Songs.map(song => {
        if (song.id === optimalLeapSong.id && song.diff === optimalLeapSong.diff) {
          console.log(`[CHAL_1-3_UPDATE] Updating song: ${song.title} from Score ${song.currentScore} -> ${optimalLeapSong.scoreToReachNextGrade}, Rating ${song.currentRating.toFixed(4)} -> ${optimalLeapSong.ratingAtNextGrade?.toFixed(4)}`);
          return {
            ...song,
            currentScore: optimalLeapSong.scoreToReachNextGrade!,
            currentRating: optimalLeapSong.ratingAtNextGrade!,
            targetScore: optimalLeapSong.scoreToReachNextGrade!, // Reflect that this is the new target/current
            targetRating: optimalLeapSong.ratingAtNextGrade!,
          };
        }
        return song;
      });

      setSimulatedB30Songs(sortSongsByRatingDesc(newSimulatedB30));
      // Clear efficiency list as it's based on previous state
      setSongsWithLeapEfficiency([]); 
      // Reset leap target group as it will be re-evaluated
      setLeapTargetGroup([]); 
      setCurrentPhase('evaluating_leap_result');
    } else if (currentPhase === 'performing_leap_jump' && songsWithLeapEfficiency.length === 0) {
        console.log("[CHAL_1-3_INFO] No songs with positive efficiency were available to perform leap jump. Moving to stuck/replacement.");
        setCurrentPhase('stuck_awaiting_replacement');
    }
  }, [currentPhase, songsWithLeapEfficiency, simulatedB30Songs]);


  return {
    apiPlayerName,
    best30SongsData: simulatedB30Songs.length > 0 && currentPhase !== 'idle' ? simulatedB30Songs : best30SongsData, // Show simulated if ongoing
    new20SongsData,
    combinedTopSongs,
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    
    isScoreLimitReleased,
    phaseTransitionPoint,
    calculationStrategy,

    currentPhase,
    simulatedAverageB30Rating, // This will be calculated in 1-4

    updatableForLeapPhase,
    leapTargetGroup,
    songsWithLeapEfficiency,
  };
}

    
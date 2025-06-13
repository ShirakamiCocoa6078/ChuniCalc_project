
// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, GLOBAL_MUSIC_CACHE_EXPIRY_MS, LOCAL_STORAGE_PREFIX, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateChunithmSongRating, findMinScoreForTargetRating } from '@/lib/rating-utils';
import type { Song, ProfileData, RatingApiResponse, GlobalMusicApiResponse, UserShowallApiResponse, ShowallApiSongEntry, RatingApiSongEntry, CalculationStrategy } from "@/types/result-page";

const BEST_COUNT = 30;
const NEW_COUNT = 20;

// 페이즈 상태 정의 (향후 사용)
type SimulationPhase = 'idle' | 'do_yaku_phase' | 'bi_se_chosei_phase' | 'completed' | 'error';


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
  calculationStrategy, // 0-3단계: 사용자 선택 기능
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
  // 0-4단계: 페이즈 전환점 (향후 사용)
  const [phaseTransitionPoint, setPhaseTransitionPoint] = useState<number | null>(null);

  // 현재 시뮬레이션 페이즈 (향후 사용)
  const [currentPhase, setCurrentPhase] = useState<SimulationPhase>('idle');
  // 시뮬레이션된 B30 곡 목록 (향후 사용, 초기값은 원본 best30)
  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  // 시뮬레이션된 B30 평균 레이팅 (향후 사용)
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);


  // 0-2단계: 점수 상한 한계 해제 규칙 적용
  useEffect(() => {
    if (clientHasMounted) {
      const currentIsValidNumber = currentRatingDisplay && !isNaN(parseFloat(currentRatingDisplay)) && isFinite(parseFloat(currentRatingDisplay));
      const targetIsValidNumber = targetRatingDisplay && !isNaN(parseFloat(targetRatingDisplay)) && isFinite(parseFloat(targetRatingDisplay));

      if (currentIsValidNumber && targetIsValidNumber) {
        const currentRatingNum = parseFloat(currentRatingDisplay);
        const targetRatingNum = parseFloat(targetRatingDisplay);
        const limitReleaseCondition = (targetRatingNum - currentRatingNum) * 50 > 10;
        setIsScoreLimitReleased(limitReleaseCondition);
        console.log(`[CHAL_0-2_SCORE_CAP_RELEASE] Score cap release flag set to ${limitReleaseCondition}. ((target:${targetRatingNum} - current:${currentRatingNum}) * 50 > 10)`);
        
        // 0-4단계: 페이즈 전환점 계산
        const transitionPoint = currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95;
        setPhaseTransitionPoint(parseFloat(transitionPoint.toFixed(4))); // 소수점 4자리까지
        console.log(`[CHAL_0-4_PHASE_TRANSITION_POINT] Phase transition point calculated: ${transitionPoint.toFixed(4)}`);

      } else {
        setIsScoreLimitReleased(false);
        setPhaseTransitionPoint(null);
        console.log(`[CHAL_0-2_SCORE_CAP_RELEASE] Ratings ('${currentRatingDisplay}', '${targetRatingDisplay}') not valid numbers or not available, score cap release flag defaults to false. Phase transition point not set.`);
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
      //setCurrentPhase('idle'); // 시뮬레이션 상태 초기화

      const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
      const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
      const globalMusicKey = GLOBAL_MUSIC_DATA_KEY;
      const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;

      const newSongTitlesRaw = NewSongsData.titles?.verse || [];
      const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());
      
      let cachedProfileTimestamp: string | null = null;
      if (clientHasMounted) {
          const profileCacheItem = localStorage.getItem(profileKey);
          if (profileCacheItem) {
              try {
                  const parsed = JSON.parse(profileCacheItem) as { timestamp: number };
                  if (parsed && typeof parsed.timestamp === 'number') {
                     cachedProfileTimestamp = new Date(parsed.timestamp).toLocaleString(locale);
                  }
              } catch (e) { console.error("Error parsing profile cache timestamp for display", e); }
          }
      }
      setLastRefreshed(cachedProfileTimestamp ? getTranslation(locale, 'resultPageSyncStatus', cachedProfileTimestamp) : getTranslation(locale, 'resultPageSyncStatusNoCache'));

      let profileData = getCachedData<ProfileData>(profileKey);
      let ratingData = getCachedData<RatingApiResponse>(ratingDataKey, USER_DATA_CACHE_EXPIRY_MS);
      let globalMusicCachedData = getCachedData<GlobalMusicApiResponse>(globalMusicKey, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
      let userShowallCachedData = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);
      
      let tempAllMusicData: ShowallApiSongEntry[] = globalMusicCachedData?.records || [];
      let tempUserPlayHistory: ShowallApiSongEntry[] = userShowallCachedData?.records || [];

      let b30Loaded = false;
      if (profileData) {
        setApiPlayerName(profileData.player_name || userNameForApi);
      }
      if (ratingData) {
        const bestEntriesApi = ratingData.best?.entries?.filter((e: any): e is RatingApiSongEntry =>
            e !== null && typeof e.id === 'string' && e.id.trim() !== '' && 
            typeof e.diff === 'string' && e.diff.trim() !== '' &&
            typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') &&
            typeof e.title === 'string' && e.title.trim() !== ''
        ) || [];
        const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
        const sortedB30 = sortSongsByRatingDesc(mappedBestEntries);
        setBest30SongsData(sortedB30);
        setSimulatedB30Songs(sortedB30.map(s => ({...s}))); // 초기 simulatedB30 설정
        if (sortedB30.length > 0) {
            const initialAvg = sortedB30.reduce((sum, s) => sum + s.currentRating, 0) / Math.max(1, sortedB30.length);
            setSimulatedAverageB30Rating(parseFloat(initialAvg.toFixed(4)));
        } else {
            setSimulatedAverageB30Rating(null);
        }
        console.log("[DATA_LOAD_CACHE] Best 30 songs data loaded from cache. Count:", mappedBestEntries.length);
        b30Loaded = true;
      }

      if (!profileData || !ratingData || !globalMusicCachedData?.records || !userShowallCachedData?.records) {
        console.log("Fetching some data from API as cache is missing or expired...");
        const apiRequests = [];
        if (!profileData) apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/profile.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'profile', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'profile', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        if (!ratingData) apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'rating', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'rating', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        if (!globalMusicCachedData?.records) apiRequests.push(fetch(`https://api.chunirec.net/2.0/music/showall.json?region=jp2&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'globalMusic', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'globalMusic', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        if (!userShowallCachedData?.records) apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'userShowall', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'userShowall', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        
        if (apiRequests.length > 0) {
            try {
                const responses = await Promise.all(apiRequests);
                let criticalError = null;

                for (const res of responses) {
                    if (!res.ok) {
                        const errorMsg = `${res.type} data loading failed (status: ${res.status}): ${res.data?.error?.message || res.statusText || res.error || 'Unknown API error'}`;
                        if (!criticalError) criticalError = errorMsg; else console.warn(errorMsg);
                        continue;
                    }
                    if (res.type === 'profile' && !profileData) {
                      setApiPlayerName(res.data.player_name || userNameForApi);
                      setCachedData<ProfileData>(profileKey, res.data);
                      profileData = res.data; 
                    }
                    if (res.type === 'rating' && !ratingData) {
                      const bestEntriesApi = res.data.best?.entries?.filter((e: any): e is RatingApiSongEntry =>
                          e && e.id && typeof e.id === 'string' && e.id.trim() !== '' &&
                          e.diff && typeof e.diff === 'string' && e.diff.trim() !== '' &&
                          typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') &&
                          e.title && typeof e.title === 'string' && e.title.trim() !== ''
                      ) || [];
                      const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
                      const sortedB30 = sortSongsByRatingDesc(mappedBestEntries);
                      setBest30SongsData(sortedB30);
                      setSimulatedB30Songs(sortedB30.map(s => ({...s}))); // 초기 simulatedB30 설정
                        if (sortedB30.length > 0) {
                            const initialAvg = sortedB30.reduce((sum, s) => sum + s.currentRating, 0) / Math.max(1, sortedB30.length);
                            setSimulatedAverageB30Rating(parseFloat(initialAvg.toFixed(4)));
                        } else {
                            setSimulatedAverageB30Rating(null);
                        }
                      console.log("[DATA_LOAD_API] Best 30 songs data loaded from API. Count:", mappedBestEntries.length);
                      b30Loaded = true;
                      setCachedData<RatingApiResponse>(ratingDataKey, res.data);
                      ratingData = res.data; 
                    }
                    if (res.type === 'globalMusic' && !globalMusicCachedData?.records) {
                        let rawApiRecordsForGlobal: any[] = [];
                        if (Array.isArray(res.data)) rawApiRecordsForGlobal = res.data;
                        else if (res.data && Array.isArray(res.data.records)) rawApiRecordsForGlobal = res.data.records; 

                        const flattenedGlobalMusicEntries: ShowallApiSongEntry[] = [];
                        if (rawApiRecordsForGlobal.length > 0 && rawApiRecordsForGlobal[0] && rawApiRecordsForGlobal[0].meta && typeof rawApiRecordsForGlobal[0].data === 'object') {
                            rawApiRecordsForGlobal.forEach(rawEntry => {
                                if (rawEntry && rawEntry.meta && rawEntry.data && typeof rawEntry.data === 'object') {
                                    const meta = rawEntry.meta; const difficulties = rawEntry.data;
                                    for (const diffKey in difficulties) {
                                        if (Object.prototype.hasOwnProperty.call(difficulties, diffKey)) {
                                            const diffData = difficulties[diffKey];
                                            if (diffData && meta.id && meta.title) {
                                                flattenedGlobalMusicEntries.push({
                                                    id: String(meta.id), title: String(meta.title), genre: String(meta.genre || "N/A"),
                                                    release: String(meta.release || ""), diff: diffKey.toUpperCase(), level: String(diffData.level || "N/A"),
                                                    const: (typeof diffData.const === 'number' || diffData.const === null) ? diffData.const : parseFloat(String(diffData.const)),
                                                    is_const_unknown: diffData.is_const_unknown === true,
                                                });
                                            }
                                        }
                                    }
                                }
                            });
                        } else if (rawApiRecordsForGlobal.length > 0) { 
                             rawApiRecordsForGlobal.forEach(entry => flattenedGlobalMusicEntries.push(entry as ShowallApiSongEntry)); 
                        }
                        tempAllMusicData = flattenedGlobalMusicEntries.filter((e: any): e is ShowallApiSongEntry =>
                            e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' &&
                            typeof e.title === 'string' && e.title.trim() !== '' && (typeof e.release === 'string') && 
                            (e.const !== undefined) && e.level !== undefined && String(e.level).trim() !== '' 
                        );
                        setCachedData<GlobalMusicApiResponse>(globalMusicKey, { records: tempAllMusicData }, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
                    }
                    if (res.type === 'userShowall' && !userShowallCachedData?.records) {
                        tempUserPlayHistory = (res.data.records || []).filter((e: any): e is ShowallApiSongEntry =>
                            e && e.id && typeof e.id === 'string' && e.id.trim() !== '' &&
                            e.diff && typeof e.diff === 'string' && e.diff.trim() !== '' &&
                            (e.score !== undefined) && e.title && typeof e.title === 'string' && e.title.trim() !== ''
                        );
                        setCachedData<UserShowallApiResponse>(userShowallKey, { records: tempUserPlayHistory }, USER_DATA_CACHE_EXPIRY_MS);
                    }
                }
                if (criticalError) throw new Error(criticalError);
                
                const newCacheTime = new Date().toLocaleString(locale);
                setLastRefreshed(getTranslation(locale, 'resultPageSyncStatus', newCacheTime));
                if (b30Loaded || (!ratingData && criticalError)) { 
                  toast({ title: getTranslation(locale, 'resultPageToastApiLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastApiLoadSuccessDesc', newCacheTime) });
                }
            } catch (error) {
                console.error("Error fetching song data from API:", error);
                let detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', "Unknown error");
                if (error instanceof Error) detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', error.message);
                setErrorLoadingSongs(detailedErrorMessage);
                if (!apiPlayerName && userNameForApi !== defaultPlayerName) setApiPlayerName(userNameForApi);
            }
        } else if (b30Loaded) { 
             toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
        }
      } else if (b30Loaded) { 
         toast({ title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') });
      }

      //setAllMusicData(tempAllMusicData); // 향후 외부 곡 탐색 시 사용
      //setUserPlayHistory(tempUserPlayHistory); // 향후 외부 곡 탐색 시 사용
      console.log(`[DATA_LOAD_COMPLETE] AllMusicData (raw): ${tempAllMusicData.length} records, UserPlayHistory (raw): ${tempUserPlayHistory.length} records.`);


      let definedSongPoolEntries: ShowallApiSongEntry[] = [];
      if (tempAllMusicData.length > 0) {
        definedSongPoolEntries = tempAllMusicData.filter(globalSong => {
            if (globalSong.title) {
                const apiTitleTrimmedLower = globalSong.title.trim().toLowerCase();
                return newSongTitlesToMatch.includes(apiTitleTrimmedLower);
            }
            return false;
        });
      }
      
      if (definedSongPoolEntries.length > 0 && tempUserPlayHistory.length > 0) {
          const playedNewSongsForRating: Song[] = [];
          const userPlayedMap = new Map<string, ShowallApiSongEntry>();
          tempUserPlayHistory.forEach(usrSong => {
              if (usrSong.id && usrSong.diff) {
                  userPlayedMap.set(`${usrSong.id}_${usrSong.diff.toUpperCase()}`, usrSong);
              }
          });

          definedSongPoolEntries.forEach((newSongDef, index) => {
              const userPlayRecord = userPlayedMap.get(`${newSongDef.id}_${newSongDef.diff.toUpperCase()}`);
              if (userPlayRecord && typeof userPlayRecord.score === 'number' && userPlayRecord.score > 0) { 
                  const combinedSongEntry: ShowallApiSongEntry = { ...newSongDef, score: userPlayRecord.score, is_played: true, is_clear: userPlayRecord.is_clear, is_fullcombo: userPlayRecord.is_fullcombo, is_alljustice: userPlayRecord.is_alljustice };
                  const appSong = mapApiSongToAppSong(combinedSongEntry, index); 
                  if (appSong.currentRating > 0) playedNewSongsForRating.push(appSong);
              }
          });
          const sortedPlayedNewSongs = sortSongsByRatingDesc(playedNewSongsForRating);
          setNew20SongsData(sortedPlayedNewSongs.slice(0, NEW_COUNT));
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


  // 모든 곡 카드에 현재 점수와 레이팅만 표시되도록 targetScore, targetRating을 current와 동일하게 설정
  // 시뮬레이션 과정에서 targetScore, targetRating이 변경되면 SongCard가 다르게 표시할 것임
  const getDisplaySongs = (songs: Song[]): Song[] => {
    return songs.map(song => ({
      ...song,
      targetScore: song.currentScore,
      targetRating: song.currentRating,
    }));
  };

  useEffect(() => {
    if (!isLoadingSongs) {
      const baseB30ForCombined = (currentPhase !== 'idle' && simulatedB30Songs.length > 0) ? simulatedB30Songs : best30SongsData;
      
      if (baseB30ForCombined.length > 0 || new20SongsData.length > 0) {
        const songMap = new Map<string, Song>();
        
        getDisplaySongs(baseB30ForCombined).forEach(song => songMap.set(`${song.id}_${song.diff}`, {...song}));
        getDisplaySongs(new20SongsData).forEach(song => {
          const key = `${song.id}_${song.diff}`;
          if (!songMap.has(key)) songMap.set(key, {...song});
        });
        setCombinedTopSongs(sortSongsByRatingDesc(Array.from(songMap.values())));
      } else {
        setCombinedTopSongs([]);
      }
    }
  }, [best30SongsData, new20SongsData, isLoadingSongs, simulatedB30Songs, currentPhase]);


  useEffect(() => {
    if (!isLoadingSongs && userNameForApi && userNameForApi !== getTranslation(locale, 'resultPageDefaultPlayerName') && clientHasMounted && (best30SongsData.length > 0 || new20SongsData.length > 0)) {
      const combinedDataKey = `${LOCAL_STORAGE_PREFIX}combined_b30_n20_${userNameForApi}`;
      const dataToCache = { best30: best30SongsData, new20: new20SongsData }; 
      setCachedData(combinedDataKey, dataToCache, USER_DATA_CACHE_EXPIRY_MS);
    }
  }, [best30SongsData, new20SongsData, userNameForApi, isLoadingSongs, locale, clientHasMounted]);

  // 새로운 과제 로직은 이 아래에 추가될 것입니다.
  // 예: 도약 페이즈, 미세 조정 페이즈 관리 useEffect 등

  return {
    apiPlayerName,
    best30SongsData: getDisplaySongs( (currentPhase !== 'idle' && simulatedB30Songs.length > 0) ? simulatedB30Songs : best30SongsData ),
    new20SongsData: getDisplaySongs(new20SongsData),
    combinedTopSongs, // combinedTopSongs는 이미 getDisplaySongs 로직을 내부적으로 포함
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    
    // 0-2단계 반환
    isScoreLimitReleased,
    // 0-4단계 반환
    phaseTransitionPoint,

    // 시뮬레이션 결과 (향후 채워짐)
    currentPhase,
    simulatedAverageB30Rating,
    // simulationStatus (과제 0에서는 simulationStatus 대신 currentPhase 사용)
  };
}

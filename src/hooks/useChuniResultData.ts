
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

  const [isScoreLimitReleased, setIsScoreLimitReleased] = useState(false);
  const [nonUpdatableB30Songs, setNonUpdatableB30Songs] = useState<Song[]>([]);
  const [updatableB30Songs, setUpdatableB30Songs] = useState<Song[]>([]);
  const [averageRatingOfUpdatableB30, setAverageRatingOfUpdatableB30] = useState<number | null>(null);
  const [groupAB30Songs, setGroupAB30Songs] = useState<Song[]>([]);
  const [groupBB30Songs, setGroupBB30Songs] = useState<Song[]>([]);

  const [simulatedB30Songs, setSimulatedB30Songs] = useState<Song[]>([]);
  const [simulatedAverageB30Rating, setSimulatedAverageB30Rating] = useState<number | null>(null);
  const [targetRatingReached, setTargetRatingReached] = useState(false);
  const [allUpdatableSongsCapped, setAllUpdatableSongsCapped] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState<'idle' | 'running_score_increase' | 'target_reached' | 'awaiting_replacement_loop' | 'replacing_song' | 'awaiting_external_data_for_replacement' | 'identifying_candidates' | 'candidates_identified' | 'selecting_optimal_candidate' | 'optimal_candidate_selected' | 'error'>('idle');
  const [songToReplace, setSongToReplace] = useState<Song | null>(null);
  const [allMusicData, setAllMusicData] = useState<ShowallApiSongEntry[]>([]);
  const [userPlayHistory, setUserPlayHistory] = useState<ShowallApiSongEntry[]>([]);
  const [candidateSongsForReplacement, setCandidateSongsForReplacement] = useState<Song[]>([]);
  const [optimalCandidateSong, setOptimalCandidateSong] = useState<Song | null>(null);


  useEffect(() => {
    if (clientHasMounted) {
      const currentIsValidNumber = currentRatingDisplay && !isNaN(parseFloat(currentRatingDisplay)) && isFinite(parseFloat(currentRatingDisplay));
      const targetIsValidNumber = targetRatingDisplay && !isNaN(parseFloat(targetRatingDisplay)) && isFinite(parseFloat(targetRatingDisplay));

      if (currentIsValidNumber && targetIsValidNumber) {
        const currentRatingNum = parseFloat(currentRatingDisplay);
        const targetRatingNum = parseFloat(targetRatingDisplay);
        const limitReleaseCondition = (targetRatingNum - currentRatingNum) * 50 > 10;
        setIsScoreLimitReleased(limitReleaseCondition);
        console.log(`[CHAL_1-1_SCORE_CAP_RELEASE] Score cap release flag set to ${limitReleaseCondition}. ((target:${targetRatingNum} - current:${currentRatingNum}) * 50 > 10)`);
      } else {
        setIsScoreLimitReleased(false);
        console.log(`[CHAL_1-1_SCORE_CAP_RELEASE] Ratings ('${currentRatingDisplay}', '${targetRatingDisplay}') not valid numbers or not available, score cap release flag defaults to false.`);
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
      setSimulationStatus('idle'); 
      setSongToReplace(null);
      setCandidateSongsForReplacement([]); 
      setOptimalCandidateSong(null);

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
      
      let tempGlobalMusicRecords: ShowallApiSongEntry[] = globalMusicCachedData?.records || [];
      let tempUserShowallRecords: ShowallApiSongEntry[] = userShowallCachedData?.records || [];

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
        setBest30SongsData(sortSongsByRatingDesc(mappedBestEntries));
        console.log("[CHAL_1-2_B30_LOAD_CACHE] Best 30 songs data loaded from cache. Count:", mappedBestEntries.length, mappedBestEntries.slice(0,3).map(s => ({t:s.title, r:s.currentRating, c:s.chartConstant})));
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
                      setBest30SongsData(sortSongsByRatingDesc(mappedBestEntries));
                      console.log("[CHAL_1-2_B30_LOAD_API] Best 30 songs data loaded from API. Count:", mappedBestEntries.length, mappedBestEntries.slice(0,3).map(s => ({t:s.title, r:s.currentRating, c:s.chartConstant})));
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
                        tempGlobalMusicRecords = flattenedGlobalMusicEntries.filter((e: any): e is ShowallApiSongEntry =>
                            e && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.diff === 'string' && e.diff.trim() !== '' &&
                            typeof e.title === 'string' && e.title.trim() !== '' && (typeof e.release === 'string') && 
                            (e.const !== undefined) && e.level !== undefined && String(e.level).trim() !== '' 
                        );
                        setCachedData<GlobalMusicApiResponse>(globalMusicKey, { records: tempGlobalMusicRecords }, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
                    }
                    if (res.type === 'userShowall' && !userShowallCachedData?.records) {
                        tempUserShowallRecords = (res.data.records || []).filter((e: any): e is ShowallApiSongEntry =>
                            e && e.id && typeof e.id === 'string' && e.id.trim() !== '' &&
                            e.diff && typeof e.diff === 'string' && e.diff.trim() !== '' &&
                            (e.score !== undefined) && e.title && typeof e.title === 'string' && e.title.trim() !== ''
                        );
                        setCachedData<UserShowallApiResponse>(userShowallKey, { records: tempUserShowallRecords }, USER_DATA_CACHE_EXPIRY_MS);
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

      setAllMusicData(tempGlobalMusicRecords);
      setUserPlayHistory(tempUserShowallRecords);
      console.log(`[DATA_LOAD_COMPLETE] AllMusicData: ${tempGlobalMusicRecords.length} records, UserPlayHistory: ${tempUserShowallRecords.length} records.`);


      let definedSongPoolEntries: ShowallApiSongEntry[] = [];
      if (tempGlobalMusicRecords.length > 0) {
        definedSongPoolEntries = tempGlobalMusicRecords.filter(globalSong => {
            if (globalSong.title) {
                const apiTitleTrimmedLower = globalSong.title.trim().toLowerCase();
                return newSongTitlesToMatch.includes(apiTitleTrimmedLower);
            }
            return false;
        });
      }
      
      if (definedSongPoolEntries.length > 0 && tempUserShowallRecords.length > 0) {
          const playedNewSongsForRating: Song[] = [];
          const userPlayedMap = new Map<string, ShowallApiSongEntry>();
          tempUserShowallRecords.forEach(usrSong => {
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

  useEffect(() => {
    if (best30SongsData.length > 0) {
      const nonUpdatable = best30SongsData.filter(song => song.currentScore >= 1009000);
      setNonUpdatableB30Songs(nonUpdatable);
      console.log(`[CHAL_1-3_NON_UPDATABLE_B30] Non-updatable B30 songs (score >= 1,009,000): ${nonUpdatable.length} songs.`, nonUpdatable.map(s => ({ title: s.title, score: s.currentScore })));
      
      const updatable = best30SongsData.filter(song => song.currentScore < 1009000);
      setUpdatableB30Songs(updatable);
      console.log(`[CHAL_1-4_UPDATABLE_B30] Updatable B30 songs (score < 1,009,000): ${updatable.length} songs.`, updatable.map(s => ({ title: s.title, score: s.currentScore, rating: s.currentRating })).slice(0, 5));
    } else {
      setNonUpdatableB30Songs([]);
      setUpdatableB30Songs([]);
    }
  }, [best30SongsData]);

  useEffect(() => {
    if (updatableB30Songs.length > 0) {
      const sumOfRatings = updatableB30Songs.reduce((sum, song) => sum + song.currentRating, 0);
      const average = sumOfRatings / updatableB30Songs.length;
      setAverageRatingOfUpdatableB30(parseFloat(average.toFixed(2)));
      console.log(`[CHAL_1-5_AVG_RATING_UPDATABLE_B30] Average rating of updatable B30 songs: ${average.toFixed(2)} (${updatableB30Songs.length} songs)`);
    } else {
      setAverageRatingOfUpdatableB30(null);
      console.log(`[CHAL_1-5_AVG_RATING_UPDATABLE_B30] No updatable B30 songs to calculate average rating.`);
    }
  }, [updatableB30Songs]);

  useEffect(() => {
    if (updatableB30Songs.length > 0 && averageRatingOfUpdatableB30 !== null) {
      const groupA = updatableB30Songs
        .filter(song => song.currentRating <= averageRatingOfUpdatableB30!)
        .sort((a, b) => a.currentRating - b.currentRating); 
      setGroupAB30Songs(groupA);
      console.log(`[CHAL_1-6_GROUP_A_B30] Group A (<= avg rating ${averageRatingOfUpdatableB30}, sorted asc): ${groupA.length} songs. Sample:`, groupA.slice(0,3).map(s => ({title: s.title, rating: s.currentRating})));

      const groupB = updatableB30Songs
        .filter(song => song.currentRating > averageRatingOfUpdatableB30!)
        .sort((a, b) => a.currentRating - b.currentRating);
      setGroupBB30Songs(groupB);
      console.log(`[CHAL_1-7_GROUP_B_B30] Group B (> avg rating ${averageRatingOfUpdatableB30}, sorted asc): ${groupB.length} songs. Sample:`, groupB.slice(0,3).map(s => ({title: s.title, rating: s.currentRating})));
    } else {
      setGroupAB30Songs([]);
      setGroupBB30Songs([]);
    }
  }, [updatableB30Songs, averageRatingOfUpdatableB30]);

  const findScoreForTargetRating = useCallback((
    currentSong: Song,
    desiredRatingIncrease: number,
    isLimitReleasedLocal: boolean
  ): { newScore: number; newRating: number; capped: boolean } => {
    if (!currentSong.chartConstant) {
      console.warn(`[SIM_WARN_NO_CONST] Song ${currentSong.title} (${currentSong.diff}) has no chart constant. Cannot simulate score increase.`);
      return { newScore: currentSong.currentScore, newRating: currentSong.currentRating, capped: true };
    }

    const targetRatingValue = parseFloat((currentSong.currentRating + desiredRatingIncrease).toFixed(4));
    const maxScore = isLimitReleasedLocal ? 1010000 : 1009000; 
    let newScore = currentSong.currentScore;
    let newRating = currentSong.currentRating;
    let cappedAtMax = false;

    if (currentSong.currentScore >= maxScore) {
        return { newScore: currentSong.currentScore, newRating: currentSong.currentRating, capped: true };
    }
    
    for (let scoreAttempt = currentSong.currentScore + 1; scoreAttempt <= maxScore; scoreAttempt += 1) { 
      const calculatedRating = calculateChunithmSongRating(scoreAttempt, currentSong.chartConstant);
      
      if (calculatedRating >= targetRatingValue) {
        newScore = scoreAttempt;
        newRating = calculatedRating;
        break; 
      }
      if (scoreAttempt === maxScore) {
        newScore = maxScore;
        newRating = calculateChunithmSongRating(newScore, currentSong.chartConstant); 
        cappedAtMax = true; 
        break;
      }
    }

    if (newScore === currentSong.currentScore && currentSong.currentScore < maxScore && newRating < targetRatingValue) {
        newScore = currentSong.currentScore + 1; 
        newRating = calculateChunithmSongRating(newScore, currentSong.chartConstant);
        if (newScore >= maxScore) cappedAtMax = true; 
    }
    
    return { newScore, newRating: parseFloat(newRating.toFixed(2)), capped: newScore >= maxScore || cappedAtMax };
  }, []);

  useEffect(() => {
    if (calculationStrategy === 'average' && best30SongsData.length > 0 && simulationStatus === 'idle' && !isLoadingSongs) {
      console.log("[SIM_INIT_AVERAGE_1-8] Initializing B30 simulation for 'Average' strategy.");
      setSimulatedB30Songs([...best30SongsData].map(song => ({...song}))); 
      setTargetRatingReached(false);
      setAllUpdatableSongsCapped(false);
      setSongToReplace(null);
      const initialAvg = best30SongsData.reduce((sum, s) => sum + s.currentRating, 0) / Math.max(1, best30SongsData.length);
      setSimulatedAverageB30Rating(parseFloat(initialAvg.toFixed(2)));
    } else if (calculationStrategy !== 'average' && simulationStatus !== 'idle') {
        setSimulatedB30Songs([]);
        setSimulatedAverageB30Rating(null);
        setTargetRatingReached(false);
        setAllUpdatableSongsCapped(false);
        setSimulationStatus('idle');
        setSongToReplace(null);
        setOptimalCandidateSong(null);
        console.log("[SIM_RESET] Simulation states reset due to strategy change or re-evaluation.");
    }
  }, [calculationStrategy, best30SongsData, simulationStatus, isLoadingSongs]); 

  useEffect(() => {
    if (calculationStrategy !== 'average' || simulationStatus === 'target_reached' || simulationStatus === 'awaiting_replacement_loop' || simulationStatus === 'replacing_song' || simulationStatus === 'awaiting_external_data_for_replacement' || simulationStatus === 'identifying_candidates' || simulationStatus === 'candidates_identified' || simulationStatus === 'selecting_optimal_candidate' || simulationStatus === 'optimal_candidate_selected' || isLoadingSongs) {
      if (simulationStatus === 'running_score_increase') setSimulationStatus('idle'); 
      return;
    }
    
    if (simulationStatus === 'idle' && groupAB30Songs.length > 0 && groupBB30Songs.length > 0 && simulatedB30Songs.length > 0 && targetRatingDisplay) {
        console.log("[SIM_START_ITERATION_1-9_1-10] Starting new score increase iteration for 'Average' strategy.");
        setSimulationStatus('running_score_increase');
    }

    if (simulationStatus === 'running_score_increase') {
        let internalSimulatedSongs = [...simulatedB30Songs.map(s => ({...s}))]; 
        let songsUpdatedInIter = false;
        
        if (groupAB30Songs.length > 0) {
            const songToUpdateInA_original = groupAB30Songs[0]; 
            const songInSimulatedA = internalSimulatedSongs.find(s => s.id === songToUpdateInA_original.id && s.diff === songToUpdateInA_original.diff);

            if (songInSimulatedA && songInSimulatedA.currentScore < (isScoreLimitReleased ? 1010000 : 1009000)) {
                const { newScore, newRating } = findScoreForTargetRating(songInSimulatedA, 0.001, isScoreLimitReleased);
                if (newScore > songInSimulatedA.currentScore || (newScore === songInSimulatedA.currentScore && newRating > songInSimulatedA.currentRating) ) { 
                    songInSimulatedA.targetScore = newScore; // Update targetScore as well
                    songInSimulatedA.targetRating = newRating; // Update targetRating
                    songInSimulatedA.currentScore = newScore; // Update current for next sim step
                    songInSimulatedA.currentRating = newRating;
                    console.log(`[SIM_GROUP_A_UPDATE_1-9] Song: ${songInSimulatedA.title}, New Score: ${newScore}, New Rating: ${newRating.toFixed(2)}`);
                    songsUpdatedInIter = true;
                }
            }
        }

        if (groupBB30Songs.length > 0) {
            const songToUpdateInB_original = groupBB30Songs[0]; 
            const songInSimulatedB = internalSimulatedSongs.find(s => s.id === songToUpdateInB_original.id && s.diff === songToUpdateInB_original.diff);
            
            if (songInSimulatedB && songInSimulatedB.currentScore < (isScoreLimitReleased ? 1010000 : 1009000)) {
                const { newScore, newRating } = findScoreForTargetRating(songInSimulatedB, 0.0005, isScoreLimitReleased);
                 if (newScore > songInSimulatedB.currentScore || (newScore === songInSimulatedB.currentScore && newRating > songInSimulatedB.currentRating)) { 
                    songInSimulatedB.targetScore = newScore;
                    songInSimulatedB.targetRating = newRating;
                    songInSimulatedB.currentScore = newScore; 
                    songInSimulatedB.currentRating = newRating;
                    console.log(`[SIM_GROUP_B_UPDATE_1-10] Song: ${songInSimulatedB.title}, New Score: ${newScore}, New Rating: ${newRating.toFixed(2)}`);
                    songsUpdatedInIter = true;
                }
            }
        }
        
        if (songsUpdatedInIter) {
            const sortedSimulatedSongs = sortSongsByRatingDesc(internalSimulatedSongs);
            setSimulatedB30Songs(sortedSimulatedSongs);
        } else {
            console.log("[SIM_NO_UPDATES_1-9_1-10] No songs updated in this score increase iteration. Potential cap or stuck state.");
            setSimulationStatus('idle'); 
        }
    }
  }, [
    calculationStrategy, 
    simulationStatus, 
    isLoadingSongs,
    groupAB30Songs, 
    groupBB30Songs, 
    simulatedB30Songs, 
    targetRatingDisplay, 
    isScoreLimitReleased, 
    findScoreForTargetRating
  ]);

  useEffect(() => {
    if (simulatedB30Songs.length > 0 && targetRatingDisplay && calculationStrategy === 'average') {
      const currentSimAvg = simulatedB30Songs.slice(0, BEST_COUNT).reduce((sum, s) => sum + s.currentRating, 0) / Math.min(simulatedB30Songs.length, BEST_COUNT);
      setSimulatedAverageB30Rating(parseFloat(currentSimAvg.toFixed(2)));
      console.log(`[SIM_AVG_RECALC_1-11] Simulated B30 Average Rating: ${currentSimAvg.toFixed(2)}`);

      const targetRatingNum = parseFloat(targetRatingDisplay);
      if (!isNaN(targetRatingNum) && currentSimAvg >= targetRatingNum) {
        setTargetRatingReached(true);
        setSimulationStatus('target_reached');
        console.log(`[SIM_TARGET_REACHED_1-11] Target rating ${targetRatingNum.toFixed(2)} reached. Simulated average: ${currentSimAvg.toFixed(2)}`);
      } else if (simulationStatus === 'running_score_increase' && !targetRatingReached) {
         setSimulationStatus('idle'); 
      }
    }
  }, [simulatedB30Songs, targetRatingDisplay, simulationStatus, targetRatingReached, calculationStrategy]);

  useEffect(() => {
    if (targetRatingReached || simulationStatus !== 'idle' || updatableB30Songs.length === 0 || simulatedB30Songs.length === 0 || calculationStrategy !== 'average' || allUpdatableSongsCapped) {
      return;
    }

    let allCappedInSim = true;
    for (const originalUpdatableSong of updatableB30Songs) {
      const simulatedVersion = simulatedB30Songs.find(s => s.id === originalUpdatableSong.id && s.diff === originalUpdatableSong.diff);
      if (simulatedVersion) {
        if (simulatedVersion.currentScore < (isScoreLimitReleased ? 1010000 : 1009000)) {
          allCappedInSim = false;
          break;
        }
      } else {
        console.warn(`[SIM_CAP_CHECK_WARN_1-12] Original updatable song ${originalUpdatableSong.title} not found in simulated list during cap check.`);
        allCappedInSim = false; 
        break;
      }
    }

    if (allCappedInSim) {
      setAllUpdatableSongsCapped(true);
      if (!targetRatingReached) { 
        setSimulationStatus('awaiting_replacement_loop'); // CHAL_1-13
        console.log("[CHAL_1-13_AWAITING_REPLACEMENT] All updatable B30 songs have reached score cap, target not met. Status to 'awaiting_replacement_loop'.");
      } else {
        setSimulationStatus('target_reached');
        console.log("[SIM_ALL_CAPPED_TARGET_MET_1-12] All updatable B30 songs capped, target rating was met.");
      }
    }
  }, [simulatedB30Songs, updatableB30Songs, isScoreLimitReleased, targetRatingReached, simulationStatus, calculationStrategy, allUpdatableSongsCapped]);

  useEffect(() => {
    if (simulationStatus === 'awaiting_replacement_loop' && !targetRatingReached) { // CHAL_1-14
      if (simulatedB30Songs.length > 0) {
        const currentB30ForReplacement = sortSongsByRatingDesc([...simulatedB30Songs]).slice(0, BEST_COUNT);
        if (currentB30ForReplacement.length > 0) {
            const sortedForMinRating = [...currentB30ForReplacement].sort((a,b) => a.currentRating - b.currentRating);
            const songToReplaceCandidate = sortedForMinRating[0];
            setSongToReplace(songToReplaceCandidate);
            setSimulationStatus('replacing_song'); 
            console.log(`[CHAL_1-14_SONG_TO_REPLACE] Identified song to replace: ${songToReplaceCandidate.title} (Rating: ${songToReplaceCandidate.currentRating.toFixed(2)}). Status to 'replacing_song'.`);
        } else {
            console.error("[CHAL_1-14_ERROR] No songs in B30 to consider for replacement.");
            setSimulationStatus('error'); 
        }
      } else {
        console.error("[CHAL_1-14_ERROR] Simulated B30 songs list is empty. Cannot identify song to replace.");
        setSimulationStatus('error');
      }
    }
  }, [simulationStatus, simulatedB30Songs, targetRatingReached]);

  useEffect(() => { // CHAL_1-15: External candidate search
    if (simulationStatus === 'replacing_song' && songToReplace) {
        if (allMusicData.length === 0 || userPlayHistory.length === 0) {
            console.log("[CHAL_1-15_WAIT_DATA] Waiting for allMusicData and/or userPlayHistory. Status to 'awaiting_external_data_for_replacement'.");
            setSimulationStatus('awaiting_external_data_for_replacement');
            return; 
        }
        console.log("[CHAL_1-15_START_IDENTIFY] Starting candidate identification. Song to replace:", songToReplace.title);
        setSimulationStatus('identifying_candidates');
    }

    if (simulationStatus === 'identifying_candidates' && songToReplace && allMusicData.length > 0) {
        console.log(`[CHAL_1-15_EXEC_IDENTIFY] Identifying candidates. AllMusicData: ${allMusicData.length}, UserPlayHistory: ${userPlayHistory.length}. Target rating to beat: ${songToReplace.currentRating.toFixed(2)}`);
        
        const currentB30IdsAndDiffs = new Set(simulatedB30Songs.slice(0, BEST_COUNT).map(s => `${s.id}_${s.diff}`));
        const candidates: Song[] = [];

        allMusicData.forEach((apiSongEntry, index) => {
            if (currentB30IdsAndDiffs.has(`${apiSongEntry.id}_${apiSongEntry.diff.toUpperCase()}`)) {
                return; 
            }

            const tempSongForConst = mapApiSongToAppSong({ ...apiSongEntry, score: 0, rating: 0 }, index);
            const chartConstant = tempSongForConst.chartConstant;

            if (chartConstant && chartConstant > 0) {
                const potentialMaxRating = calculateChunithmSongRating(1010000, chartConstant); 
                if (potentialMaxRating > songToReplace.currentRating) {
                    const userPlayRecord = userPlayHistory.find(
                        (play) => play.id === apiSongEntry.id && play.diff.toUpperCase() === apiSongEntry.diff.toUpperCase()
                    );

                    let candidateSong: Song;
                    if (userPlayRecord && typeof userPlayRecord.score === 'number') {
                        candidateSong = mapApiSongToAppSong(userPlayRecord, index);
                    } else {
                        candidateSong = mapApiSongToAppSong({ ...apiSongEntry, score: 0, rating: 0 }, index);
                    }
                    candidates.push(candidateSong);
                }
            }
        });

        setCandidateSongsForReplacement(candidates);
        console.log(`[CHAL_1-15_RESULT_CANDIDATES] Identified ${candidates.length} candidates. Sample:`, candidates.slice(0, 3).map(c => ({ title: c.title, diff: c.diff, rating: c.currentRating, const: c.chartConstant })));
        setSimulationStatus('candidates_identified');
    }
  }, [simulationStatus, songToReplace, allMusicData, userPlayHistory, simulatedB30Songs]);

  // CHAL_1-16: Select optimal candidate
  useEffect(() => {
    if (simulationStatus === 'candidates_identified' && candidateSongsForReplacement.length > 0 && songToReplace) {
        console.log(`[CHAL_1-16_START_OPTIMAL_SELECT] Selecting optimal candidate. Candidates: ${candidateSongsForReplacement.length}, To Replace: ${songToReplace.title} (Rating: ${songToReplace.currentRating.toFixed(2)})`);
        setSimulationStatus('selecting_optimal_candidate');

        let bestCandidateInfo: { song: Song; effort: number; neededScore: number; resultingRating: number } | null = null;
        const targetRatingToBeat = songToReplace.currentRating + 0.001;

        candidateSongsForReplacement.forEach(candidate => {
            if (!candidate.chartConstant) return;

            const scoreInfo = findMinScoreForTargetRating(candidate, targetRatingToBeat, isScoreLimitReleased);

            if (scoreInfo.possible) {
                const effort = candidate.currentScore > 0 ? (scoreInfo.score - candidate.currentScore) : scoreInfo.score;
                
                if (bestCandidateInfo === null || effort < bestCandidateInfo.effort) {
                    bestCandidateInfo = {
                        song: candidate,
                        effort: effort,
                        neededScore: scoreInfo.score,
                        resultingRating: scoreInfo.rating,
                    };
                } else if (effort === bestCandidateInfo.effort) {
                    // Tie-breaking: higher resulting rating is better
                    if (scoreInfo.rating > bestCandidateInfo.resultingRating) {
                         bestCandidateInfo = {
                            song: candidate,
                            effort: effort,
                            neededScore: scoreInfo.score,
                            resultingRating: scoreInfo.rating,
                        };
                    }
                }
            }
        });

        if (bestCandidateInfo) {
            const finalOptimalCandidate = {
                ...bestCandidateInfo.song,
                targetScore: bestCandidateInfo.neededScore,
                targetRating: bestCandidateInfo.resultingRating,
            };
            setOptimalCandidateSong(finalOptimalCandidate);
            setSimulationStatus('optimal_candidate_selected');
            console.log(`[CHAL_1-16_OPTIMAL_SELECTED] Optimal candidate: ${finalOptimalCandidate.title} (Diff: ${finalOptimalCandidate.diff}). Score needed: ${finalOptimalCandidate.targetScore}, New Rating: ${finalOptimalCandidate.targetRating.toFixed(2)}, Effort: ${bestCandidateInfo.effort}`);
        } else {
            console.warn("[CHAL_1-16_NO_OPTIMAL_CANDIDATE] No suitable optimal candidate found to replace the song. This might indicate an issue or that no external song can improve the B30 average further with less effort than alternatives.");
            // Potentially loop back or handle error state - for now, log and change status
            // This could mean we need to try replacing a different song from B30, or the simulation ends.
            // For now, setting to error to highlight. A more robust solution might try replacing the *next* lowest B30 song.
            setSimulationStatus('error'); 
        }
    } else if (simulationStatus === 'candidates_identified' && candidateSongsForReplacement.length === 0 && songToReplace) {
        console.warn(`[CHAL_1-16_NO_CANDIDATES_FOUND] No candidates were identified in step 1-15 for song: ${songToReplace.title}. Cannot select optimal candidate.`);
        setSimulationStatus('error'); // Or another state indicating no way forward with this replacement
    }
  }, [simulationStatus, candidateSongsForReplacement, songToReplace, isScoreLimitReleased, findMinScoreForTargetRating]);


  useEffect(() => {
    if (!isLoadingSongs) {
      if (best30SongsData.length > 0 || new20SongsData.length > 0) {
        const songMap = new Map<string, Song>();
        const baseB30 = (calculationStrategy === 'average' && simulatedB30Songs.length > 0 && (simulationStatus.startsWith('running') || simulationStatus === 'target_reached' || simulationStatus === 'awaiting_replacement_loop' || simulationStatus === 'replacing_song' || simulationStatus === 'identifying_candidates' || simulationStatus === 'candidates_identified' || simulationStatus === 'selecting_optimal_candidate' || simulationStatus === 'optimal_candidate_selected' )) ? simulatedB30Songs : best30SongsData;
        
        baseB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, {...song}));
        new20SongsData.forEach(song => {
          const key = `${song.id}_${song.diff}`;
          if (!songMap.has(key)) songMap.set(key, {...song});
        });
        setCombinedTopSongs(sortSongsByRatingDesc(Array.from(songMap.values())));
      } else {
        setCombinedTopSongs([]);
      }
    }
  }, [best30SongsData, new20SongsData, isLoadingSongs, simulatedB30Songs, calculationStrategy, simulationStatus]);

  useEffect(() => {
    if (!isLoadingSongs && userNameForApi && userNameForApi !== getTranslation(locale, 'resultPageDefaultPlayerName') && clientHasMounted && (best30SongsData.length > 0 || new20SongsData.length > 0)) {
      const combinedDataKey = `${LOCAL_STORAGE_PREFIX}combined_b30_n20_${userNameForApi}`;
      const dataToCache = { best30: best30SongsData, new20: new20SongsData }; 
      setCachedData(combinedDataKey, dataToCache, USER_DATA_CACHE_EXPIRY_MS);
    }
  }, [best30SongsData, new20SongsData, userNameForApi, isLoadingSongs, locale, clientHasMounted]);

  return {
    apiPlayerName,
    best30SongsData: (calculationStrategy === 'average' && simulatedB30Songs.length > 0 && (simulationStatus.startsWith('running') || simulationStatus.startsWith('awaiting') || simulationStatus.startsWith('replacing') || simulationStatus.startsWith('identifying') || simulationStatus.startsWith('candidate') || simulationStatus.startsWith('selecting') || simulationStatus.startsWith('optimal') || simulationStatus === 'target_reached' )) ? simulatedB30Songs : best30SongsData,
    new20SongsData,
    combinedTopSongs,
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    isScoreLimitReleased,
    nonUpdatableB30Songs,
    updatableB30Songs,
    averageRatingOfUpdatableB30,
    groupAB30Songs,
    groupBB30Songs,
    simulatedAverageB30Rating,
    targetRatingReached,
    allUpdatableSongsCapped,
    simulationStatus,
    songToReplace,
    candidateSongsForReplacement, 
    optimalCandidateSong,
  };
}

    

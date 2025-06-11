
"use client";

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import SongCard, { type Song } from "@/components/SongCard";
import { User, Gauge, Target as TargetIconLucide, ArrowLeft, Loader2, AlertTriangle, BarChart3, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { getCachedData, setCachedData, GLOBAL_MUSIC_CACHE_EXPIRY_MS, LOCAL_STORAGE_PREFIX, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_DATA_KEY } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslation } from '@/lib/translations';


const BEST_COUNT = 30;
const NEW_COUNT = 20;


type ProfileData = {
    player_name: string;
    rating?: number | string;
};

type RatingApiSongEntry = {
  id: string;
  diff: string;
  title: string;
  score: number;
  rating: number;
  genre?: string;
  const?: number;
  updated_at?: string;
};

export type ShowallApiSongEntry = {
  id: string;
  diff: string;
  title: string;
  genre: string;
  const: number | null;
  level: number | string;
  release?: string; 
  score?: number; // User's score if played
  rating?: number | null; // User's calculated rating for this song, or internal rating from API
  is_played?: boolean;
  updated_at?: string;
  is_clear?: boolean;
  is_fullcombo?: boolean;
  is_alljustice?: boolean;
  is_fullchain?: boolean;
  is_const_unknown?: boolean;
};


export type CalculationStrategy = "average" | "peak" | "floor";

const calculateChunithmSongRating = (score: number, chartConstant: number | undefined | null): number => {
  if (typeof chartConstant !== 'number' || chartConstant <= 0) {
    return 0;
  }

  let ratingValue = 0;

  if (score >= 1009000) { // SSS+
    ratingValue = chartConstant + 2.15;
  } else if (score >= 1007500) { // SSS
    ratingValue = chartConstant + 2.00 + Math.min(0.14, Math.floor(Math.max(0, score - 1007500) / 100) * 0.01);
  } else if (score >= 1005000) { // SS+
    ratingValue = chartConstant + 1.50 + Math.min(0.49, Math.floor(Math.max(0, score - 1005000) / 50) * 0.01);
  } else if (score >= 1000000) { // SS
    ratingValue = chartConstant + 1.00 + Math.min(0.49, Math.floor(Math.max(0, score - 1000000) / 100) * 0.01);
  } else if (score >= 990000) { // S+
    ratingValue = chartConstant + 0.60 + Math.min(0.39, Math.floor(Math.max(0, score - 990000) / 250) * 0.01);
  } else if (score >= 975000) { // S
    ratingValue = chartConstant + 0.00 + Math.min(0.59, Math.floor(Math.max(0, score - 975000) / 250) * 0.01);
  } else if (score >= 950000) { // AAA
    ratingValue = chartConstant - 1.50;
  } else if (score >= 925000) { // AA
    ratingValue = chartConstant - 3.00;
  } else if (score >= 900000) { // A
    ratingValue = chartConstant - 5.00;
  } else if (score >= 800000) { // BBB
    ratingValue = (chartConstant - 5.00) / 2.0;
  } else { // C and below
    ratingValue = 0;
  }

  return Math.max(0, parseFloat(ratingValue.toFixed(2)));
};

const mapApiSongToAppSong = (
    apiSong: RatingApiSongEntry | ShowallApiSongEntry,
    _index: number,
    chartConstantOverride?: number // This override is primarily for rating_data.json best30 entries
): Song => {
  const score = typeof apiSong.score === 'number' ? apiSong.score : 0;

  let effectiveChartConstant: number | null = null;

  // Priority 1: chartConstantOverride (typically for RatingApiSongEntry from best30)
  if (typeof chartConstantOverride === 'number' && chartConstantOverride > 0) {
    effectiveChartConstant = chartConstantOverride;
  } else {
    // For ShowallApiSongEntry or if chartConstantOverride is not applicable
    // Priority 2: apiSong.const if it's a positive number
    if (typeof apiSong.const === 'number' && apiSong.const > 0) {
      effectiveChartConstant = apiSong.const;
    } 
    // Priority 3: User's rule for when apiSong.const is 0
    else if (apiSong.const === 0) {
      if ((typeof apiSong.level === 'string' || typeof apiSong.level === 'number') && String(apiSong.level).trim() !== "") {
        const parsedLevel = parseFloat(String(apiSong.level));
        if (!isNaN(parsedLevel) && parsedLevel > 0) {
          const isInteger = parsedLevel % 1 === 0;
          const isXpoint5 = Math.abs((parsedLevel * 10) % 10) === 5;

          if (isInteger || isXpoint5) {
            effectiveChartConstant = parsedLevel;
          }
        }
      }
    } 
    // Priority 4: Original fallback if apiSong.is_const_unknown is true and const wasn't positive or 0 (i.e. likely null)
    // This applies if effectiveChartConstant is still null at this point.
    else if (effectiveChartConstant === null && (apiSong as ShowallApiSongEntry).is_const_unknown && 
             (typeof apiSong.level === 'string' || typeof apiSong.level === 'number') &&
             String(apiSong.level).trim() !== "") {
      const parsedLevel = parseFloat(String(apiSong.level));
      if (!isNaN(parsedLevel) && parsedLevel > 0) {
        effectiveChartConstant = parsedLevel; // Use any valid numeric level as const
      }
    }
  }

  let calculatedCurrentRating: number;
  if (typeof effectiveChartConstant === 'number' && effectiveChartConstant > 0 && score > 0) {
    calculatedCurrentRating = calculateChunithmSongRating(score, effectiveChartConstant);
  } else {
    calculatedCurrentRating = typeof apiSong.rating === 'number' ? apiSong.rating : 0;
  }
  const currentRating = calculatedCurrentRating;

  const targetScoreImprovementFactor = (1001000 - score > 0 && score > 0) ? (1001000 - score) / 10 : 10000;
  const targetScore = Math.max(score, Math.min(1001000, score + Math.floor(Math.random() * targetScoreImprovementFactor)));

  let targetRating: number;
  if (typeof effectiveChartConstant === 'number' && effectiveChartConstant > 0) {
    targetRating = calculateChunithmSongRating(targetScore, effectiveChartConstant);
  } else {
     targetRating = parseFloat(Math.max(currentRating, Math.min(17.85, currentRating + Math.random() * 0.2)).toFixed(2));
  }

  return {
    id: apiSong.id,
    diff: apiSong.diff,
    title: apiSong.title,
    chartConstant: effectiveChartConstant,
    currentScore: score,
    currentRating: currentRating,
    targetScore: targetScore,
    targetRating: targetRating,
  };
};

const difficultyOrder: { [key: string]: number } = {
  ULT: 5,
  MAS: 4,
  EXP: 3,
  ADV: 2,
  BAS: 1,
};

const sortSongsByRatingDesc = (songs: Song[]): Song[] => {
  return [...songs].sort((a, b) => {
    if (b.currentRating !== a.currentRating) {
      return b.currentRating - a.currentRating;
    }
    if (b.currentScore !== a.currentScore) {
        return b.currentScore - a.currentScore;
    }
    const diffAOrder = difficultyOrder[a.diff.toUpperCase() as keyof typeof difficultyOrder] || 0;
    const diffBOrder = difficultyOrder[b.diff.toUpperCase() as keyof typeof difficultyOrder] || 0;
    return diffBOrder - diffAOrder;
  });
};


type RatingApiResponse = {
    best?: { entries?: RatingApiSongEntry[] };
};

// This type now expects `records` to be ShowallApiSongEntry[] (flattened)
export type GlobalMusicApiResponse = {
    records?: ShowallApiSongEntry[]; 
}

type UserShowallApiResponse = {
    records?: ShowallApiSongEntry[]; // Assumes user's records are already somewhat flat or processed to match ShowallApiSongEntry structure relevant fields.
}


function ResultContent() {
  const searchParams = useSearchParams();
  const { locale } = useLanguage();
  const userNameForApi = searchParams.get("nickname") || getTranslation(locale, 'resultPageDefaultPlayerName');
  const currentRatingDisplay = searchParams.get("current") || getTranslation(locale, 'resultPageNotAvailable');
  const targetRatingDisplay = searchParams.get("target") || getTranslation(locale, 'resultPageNotAvailable');
  const { toast } = useToast();

  const [apiPlayerName, setApiPlayerName] = useState<string | null>(userNameForApi === getTranslation(locale, 'resultPageDefaultPlayerName') ? getTranslation(locale, 'resultPageDefaultPlayerName') : null);
  const [best30SongsData, setBest30SongsData] = useState<Song[]>([]);
  const [new20SongsData, setNew20SongsData] = useState<Song[]>([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(true);
  const [errorLoadingSongs, setErrorLoadingSongs] = useState<string | null>(null);
  const [calculationStrategy, setCalculationStrategy] = useState<CalculationStrategy>("average");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [clientHasMounted, setClientHasMounted] = useState(false);

  useEffect(() => {
    setClientHasMounted(true);
  }, []);


  const handleRefreshData = useCallback(() => {
    if (typeof window !== 'undefined' && userNameForApi && userNameForApi !== getTranslation(locale, 'resultPageDefaultPlayerName')) {
        const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
        const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
        const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;
        localStorage.removeItem(profileKey);
        localStorage.removeItem(ratingDataKey);
        localStorage.removeItem(userShowallKey);
        // Optionally clear global music too if you want a full refresh:
        // localStorage.removeItem(GLOBAL_MUSIC_DATA_KEY); 
        console.log(`User-specific cache cleared for user: ${userNameForApi}`);
        toast({ 
            title: getTranslation(locale, 'resultPageToastRefreshingDataTitle'), 
            description: getTranslation(locale, 'resultPageToastRefreshingDataDesc') 
        });
    }
    setRefreshNonce(prev => prev + 1);
  }, [userNameForApi, toast, locale]);

  useEffect(() => {
    const fetchAndProcessData = async () => {
      const API_TOKEN = getApiToken();
      if (!API_TOKEN) {
        setErrorLoadingSongs(getTranslation(locale, 'resultPageErrorApiTokenNotSetResult'));
        setIsLoadingSongs(false);
        return;
      }

      if (!userNameForApi || userNameForApi === getTranslation(locale, 'resultPageDefaultPlayerName')) {
        setErrorLoadingSongs(getTranslation(locale, 'resultPageErrorNicknameNotProvidedResult'));
        setApiPlayerName(getTranslation(locale, 'resultPageDefaultPlayerName'));
        setIsLoadingSongs(false);
        return;
      }

      setIsLoadingSongs(true);
      setErrorLoadingSongs(null);

      const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
      const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
      const globalMusicKey = GLOBAL_MUSIC_DATA_KEY;
      const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;


      const newSongTitlesRaw = NewSongsData.titles?.verse || [];
      const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());
      console.log(`[N20_PREP_1] Titles from NewSongs.json for matching (count: ${newSongTitlesToMatch.length}):`, newSongTitlesToMatch.slice(0, 3));

      const cachedProfile = getCachedData<ProfileData>(profileKey);
      const cachedRatingData = getCachedData<RatingApiResponse>(ratingDataKey, USER_DATA_CACHE_EXPIRY_MS);
      const cachedGlobalMusicData = getCachedData<GlobalMusicApiResponse>(globalMusicKey, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
      const cachedUserShowallData = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);
      
      let globalMusicRecordsFromDataSource: ShowallApiSongEntry[] = [];
      let userShowallRecordsFromDataSource: ShowallApiSongEntry[] = [];


      let cacheTimestamp = getTranslation(locale, 'resultPageSyncStatusNoCache');
      if (clientHasMounted) {
        const userCacheTimestampItem = localStorage.getItem(profileKey); 
        if (userCacheTimestampItem) {
            try {
                const parsedItem = JSON.parse(userCacheTimestampItem);
                if (parsedItem && typeof parsedItem.timestamp === 'number') {
                    cacheTimestamp = new Date(parsedItem.timestamp).toLocaleString();
                }
            } catch (e) { console.error("Error parsing user cache timestamp", e); }
        }
      }
      setLastRefreshed(cachedProfile ? getTranslation(locale, 'resultPageSyncStatus', cacheTimestamp) : getTranslation(locale, 'resultPageSyncStatusNoCache'));


      if (cachedProfile) {
        setApiPlayerName(cachedProfile.player_name || userNameForApi);
      }
      if (cachedRatingData) {
        const bestEntriesApi = cachedRatingData.best?.entries?.filter((e: any): e is RatingApiSongEntry =>
            e !== null && typeof e.id === 'string' && typeof e.diff === 'string' &&
            typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number')
        ) || [];
        const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
        setBest30SongsData(sortSongsByRatingDesc(mappedBestEntries));
      }

      if (cachedGlobalMusicData && cachedGlobalMusicData.records) {
        console.log("[N20_PREP_2_CACHE] Loading global music data (expected flattened) from localStorage cache...");
        globalMusicRecordsFromDataSource = cachedGlobalMusicData.records.filter((e: any): e is ShowallApiSongEntry =>
            e && e.id && e.diff && e.title && (e.release || typeof e.release === 'string') && (e.const !== undefined) && e.level !== undefined
        );
      }
      if (cachedUserShowallData && cachedUserShowallData.records) {
        console.log("[N20_PREP_3_CACHE] Loading user's showall data from localStorage cache...");
        userShowallRecordsFromDataSource = cachedUserShowallData.records.filter((e: any): e is ShowallApiSongEntry =>
            e && e.id && e.diff && (e.score !== undefined) 
        );
      }


      if (!cachedProfile || !cachedRatingData || !cachedGlobalMusicData || !cachedGlobalMusicData.records || !cachedUserShowallData || !cachedUserShowallData.records) {
        console.log("Fetching some data from API as cache is missing or expired...");
        const apiRequests = [];
        if (!cachedProfile) {
          apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/profile.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'profile', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'profile', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        }
        if (!cachedRatingData) {
          apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'rating', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'rating', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        }
        if (!cachedGlobalMusicData || !cachedGlobalMusicData.records) {
          apiRequests.push(fetch(`https://api.chunirec.net/2.0/music/showall.json?region=jp2&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'globalMusic', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'globalMusic', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        }
        if (!cachedUserShowallData || !cachedUserShowallData.records) {
            apiRequests.push(fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`).then(res => res.json().then(data => ({type: 'userShowall', data, ok: res.ok, status: res.status, statusText: res.statusText})).catch(() => ({type: 'userShowall', error: 'JSON_PARSE_ERROR', ok: false, status: res.status, statusText: res.statusText }))));
        }
        

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
                    if (res.type === 'profile' && !cachedProfile) {
                    setApiPlayerName(res.data.player_name || userNameForApi);
                    setCachedData<ProfileData>(profileKey, res.data);
                    }
                    if (res.type === 'rating' && !cachedRatingData) {
                    const bestEntriesApi = res.data.best?.entries?.filter((e: any): e is RatingApiSongEntry =>
                        e && e.id && e.diff && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number')
                    ) || [];
                    const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
                    setBest30SongsData(sortSongsByRatingDesc(mappedBestEntries));
                    setCachedData<RatingApiResponse>(ratingDataKey, res.data);
                    }
                    if (res.type === 'globalMusic' && (!cachedGlobalMusicData || !cachedGlobalMusicData.records)) {
                        let rawApiRecordsForGlobal: any[] = [];
                        if (Array.isArray(res.data)) { 
                            rawApiRecordsForGlobal = res.data;
                            console.log("[RESULT_PAGE_GLOBAL_MUSIC_API] API response is a direct array. Count:", rawApiRecordsForGlobal.length);
                        } else if (res.data && Array.isArray(res.data.records)) { 
                            rawApiRecordsForGlobal = res.data.records;
                             console.log("[RESULT_PAGE_GLOBAL_MUSIC_API] API response is an object with .records array. Count:", rawApiRecordsForGlobal.length);
                        } else {
                            console.warn("[RESULT_PAGE_GLOBAL_MUSIC_API_WARN] music/showall.json API response was not an array and did not have a .records array. Response:", res.data);
                        }

                        const flattenedGlobalMusicEntries: ShowallApiSongEntry[] = [];
                        if (rawApiRecordsForGlobal.length > 0 && rawApiRecordsForGlobal[0] && rawApiRecordsForGlobal[0].meta && rawApiRecordsForGlobal[0].data) { // Check for {meta, data} structure
                            rawApiRecordsForGlobal.forEach(rawEntry => {
                                if (rawEntry && rawEntry.meta && rawEntry.data && typeof rawEntry.data === 'object') {
                                    const meta = rawEntry.meta;
                                    const difficulties = rawEntry.data;
                                    for (const diffKey in difficulties) {
                                        if (Object.prototype.hasOwnProperty.call(difficulties, diffKey)) {
                                            const diffData = difficulties[diffKey];
                                            if (diffData && meta.id && meta.title) {
                                                flattenedGlobalMusicEntries.push({
                                                    id: String(meta.id),
                                                    title: String(meta.title),
                                                    genre: String(meta.genre || "N/A"),
                                                    release: String(meta.release || ""),
                                                    diff: diffKey.toUpperCase(),
                                                    level: String(diffData.level || "N/A"),
                                                    const: (typeof diffData.const === 'number' || diffData.const === null) ? diffData.const : parseFloat(String(diffData.const)),
                                                    is_const_unknown: diffData.is_const_unknown === true,
                                                });
                                            }
                                        }
                                    }
                                }
                            });
                             console.log(`[RESULT_PAGE_GLOBAL_MUSIC_API] Flattened ${flattenedGlobalMusicEntries.length} entries from ${rawApiRecordsForGlobal.length} raw API records.`);
                        } else if (rawApiRecordsForGlobal.length > 0) { // Assume it's already flat ShowallApiSongEntry[] if not {meta,data}
                             console.log("[RESULT_PAGE_GLOBAL_MUSIC_API] Assuming API provided already flattened records for global music. Count:", rawApiRecordsForGlobal.length);
                             rawApiRecordsForGlobal.forEach(entry => flattenedGlobalMusicEntries.push(entry as ShowallApiSongEntry)); 
                        }


                        globalMusicRecordsFromDataSource = flattenedGlobalMusicEntries.filter((e: any): e is ShowallApiSongEntry =>
                            e && e.id && e.diff && e.title && (e.release || typeof e.release === 'string') && (e.const !== undefined) && e.level !== undefined
                        );
                        setCachedData<GlobalMusicApiResponse>(globalMusicKey, { records: globalMusicRecordsFromDataSource }, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
                        console.log("[N20_PREP_2_API] Global music data (flattened) fetched from API and cached. Count:", globalMusicRecordsFromDataSource.length);
                    }
                    if (res.type === 'userShowall' && (!cachedUserShowallData || !cachedUserShowallData.records)) {
                        userShowallRecordsFromDataSource = (res.data.records || []).filter((e: any): e is ShowallApiSongEntry =>
                            e && e.id && e.diff && (e.score !== undefined)
                        );
                        setCachedData<UserShowallApiResponse>(userShowallKey, { records: userShowallRecordsFromDataSource }, USER_DATA_CACHE_EXPIRY_MS);
                        console.log("[N20_PREP_3_API] User's showall data fetched from API and cached.");
                    }
                }
                if (criticalError) throw new Error(criticalError);
                
                const newCacheTime = new Date().toLocaleString();
                setLastRefreshed(getTranslation(locale, 'resultPageSyncStatus', newCacheTime));
                toast({ 
                    title: getTranslation(locale, 'resultPageToastApiLoadSuccessTitle'), 
                    description: getTranslation(locale, 'resultPageToastApiLoadSuccessDesc', newCacheTime) 
                });

            } catch (error) {
                console.error("Error fetching song data from API:", error);
                let detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', "Unknown error");
                if (error instanceof Error) detailedErrorMessage = getTranslation(locale, 'toastErrorRatingFetchFailedDesc', error.message);
                setErrorLoadingSongs(detailedErrorMessage);
                if (!apiPlayerName && userNameForApi !== getTranslation(locale, 'resultPageDefaultPlayerName')) setApiPlayerName(userNameForApi);
            }
        } else {
             toast({ 
                title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), 
                description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') 
            });
        }
      } else {
         toast({ 
            title: getTranslation(locale, 'resultPageToastCacheLoadSuccessTitle'), 
            description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') 
        });
      }

      // Step 2: Define new song pool from global music data
      let definedSongPoolEntries: ShowallApiSongEntry[] = [];
      if (globalMusicRecordsFromDataSource.length > 0) {
        definedSongPoolEntries = globalMusicRecordsFromDataSource.filter(globalSong => {
            if (globalSong.title) {
                const apiTitleTrimmedLower = globalSong.title.trim().toLowerCase();
                return newSongTitlesToMatch.includes(apiTitleTrimmedLower);
            }
            return false;
        });
        console.log(`[N20_STEP_DEF_POOL] Defined new song pool (found: ${definedSongPoolEntries.length}). First 3:`, definedSongPoolEntries.slice(0, 3).map(s => ({ title: s.title, id: s.id, diff: s.diff })));
      } else {
        console.warn("[N20_STEP_DEF_POOL] Global music data source is empty. Cannot define new song pool.");
      }
      
      // Step 3: Process user's play records for these new songs to calculate New 20
      if (definedSongPoolEntries.length > 0 && userShowallRecordsFromDataSource.length > 0) {
          console.log(`[N20_CALC_USER] Starting New 20 calculation. Defined new songs: ${definedSongPoolEntries.length}, User's total records: ${userShowallRecordsFromDataSource.length}`);

          const playedNewSongsForRating: Song[] = [];

          const userPlayedMap = new Map<string, ShowallApiSongEntry>();
          userShowallRecordsFromDataSource.forEach(usrSong => {
              if (usrSong.id && usrSong.diff) {
                  userPlayedMap.set(`${usrSong.id}_${usrSong.diff.toUpperCase()}`, usrSong);
              }
          });
          console.log(`[N20_CALC_USER] User play map created with ${userPlayedMap.size} entries.`);

          definedSongPoolEntries.forEach((newSongDef, index) => {
              const userPlayRecord = userPlayedMap.get(`${newSongDef.id}_${newSongDef.diff.toUpperCase()}`);

              if (userPlayRecord && typeof userPlayRecord.score === 'number' && userPlayRecord.score > 0) {
                  const combinedSongEntry: ShowallApiSongEntry = {
                      ...newSongDef, 
                      score: userPlayRecord.score, 
                      is_played: true,
                      is_clear: userPlayRecord.is_clear,
                      is_fullcombo: userPlayRecord.is_fullcombo,
                      is_alljustice: userPlayRecord.is_alljustice,
                      is_fullchain: userPlayRecord.is_fullchain,
                  };
                  
                  const appSong = mapApiSongToAppSong(combinedSongEntry, index); 
                  if (appSong.currentRating > 0) {
                       playedNewSongsForRating.push(appSong);
                  }
              }
          });

          console.log(`[N20_CALC_USER] Found ${playedNewSongsForRating.length} played new songs with calculated ratings.`);
          
          const sortedPlayedNewSongs = sortSongsByRatingDesc(playedNewSongsForRating);
          const finalNew20Songs = sortedPlayedNewSongs.slice(0, NEW_COUNT);

          console.log(`[N20_CALC_USER] Final New 20 list (top ${NEW_COUNT}):`, finalNew20Songs.map(s => ({title: s.title, rating: s.currentRating, score: s.currentScore, id: s.id, diff: s.diff })));
          setNew20SongsData(finalNew20Songs);

      } else if (definedSongPoolEntries.length === 0) {
          console.warn("[N20_CALC_USER] New song pool is empty. Cannot calculate New 20.");
          setNew20SongsData([]);
      } else { 
          console.warn("[N20_CALC_USER] User has no play records, or records/showall.json failed to load/returned empty. Cannot calculate New 20 based on user plays.");
          setNew20SongsData([]);
      }

      setIsLoadingSongs(false);
    };

    if (clientHasMounted) { 
      fetchAndProcessData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNameForApi, refreshNonce, clientHasMounted, locale]); 

  const best30GridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
  const new20GridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
  const combinedBest30GridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4";
  const combinedNew20GridCols = "sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3";


  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 p-4 bg-card border border-border rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex items-center gap-3">
            <User className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold font-headline">{apiPlayerName || userNameForApi}</h1>
              <Link href="/" className="text-sm text-primary hover:underline flex items-center">
                <ArrowLeft className="w-4 h-4 mr-1" /> {getTranslation(locale, 'resultPageButtonBackToCalc')}
              </Link>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-4 text-sm sm:text-base w-full sm:w-auto">
            <div className="flex items-center p-2 bg-secondary rounded-md">
              <Gauge className="w-5 h-5 mr-2 text-primary" />
              <span>{getTranslation(locale, 'resultPageHeaderCurrent')} <span className="font-semibold">{currentRatingDisplay}</span></span>
            </div>
            <div className="flex items-center p-2 bg-secondary rounded-md">
              <TargetIconLucide className="w-5 h-5 mr-2 text-primary" />
              <span>{getTranslation(locale, 'resultPageHeaderTarget')} <span className="font-semibold">{targetRatingDisplay}</span></span>
            </div>
          </div>
        </header>

        <div className="mb-4 flex flex-col sm:flex-row justify-between items-center gap-2">
            <p className="text-xs text-muted-foreground">
                {clientHasMounted
                    ? lastRefreshed
                    : getTranslation(locale, 'resultPageSyncStatusChecking')}
            </p>
            <Button onClick={handleRefreshData} variant="outline" size="sm" disabled={isLoadingSongs || !userNameForApi || userNameForApi === getTranslation(locale, 'resultPageDefaultPlayerName') || !getApiToken()}>
                <RefreshCw className={cn("w-4 h-4 mr-2", isLoadingSongs && "animate-spin")} />
                {getTranslation(locale, 'resultPageRefreshButton')}
            </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="font-headline text-xl">{getTranslation(locale, 'resultPageStrategyTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              defaultValue="average"
              onValueChange={(value) => setCalculationStrategy(value as CalculationStrategy)}
              className="flex flex-col sm:flex-row gap-4"
            >
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                <RadioGroupItem value="average" id="r-average" />
                <Label htmlFor="r-average" className="flex items-center cursor-pointer">
                  <BarChart3 className="w-5 h-5 mr-2 text-primary" /> {getTranslation(locale, 'resultPageStrategyAverage')}
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                <RadioGroupItem value="peak" id="r-peak" />
                <Label htmlFor="r-peak" className="flex items-center cursor-pointer">
                  <TrendingUp className="w-5 h-5 mr-2 text-destructive" /> {getTranslation(locale, 'resultPageStrategyPeak')}
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                <RadioGroupItem value="floor" id="r-floor" />
                <Label htmlFor="r-floor" className="flex items-center cursor-pointer">
                  <TrendingDown className="w-5 h-5 mr-2 text-green-600" /> {getTranslation(locale, 'resultPageStrategyFloor')}
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground mt-2">
              {getTranslation(locale, 'resultPageStrategyDisclaimer')}
            </p>
          </CardContent>
        </Card>

        <Tabs defaultValue="best30" className="w-full">
          <TabsList className="grid w-full grid-cols-3 gap-1 mb-6 bg-muted p-1 rounded-lg">
            <TabsTrigger value="best30" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{getTranslation(locale, 'resultPageTabBest30')}</TabsTrigger>
            <TabsTrigger value="new20" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{getTranslation(locale, 'resultPageTabNew20')}</TabsTrigger>
            <TabsTrigger value="combined" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{getTranslation(locale, 'resultPageTabCombined')}</TabsTrigger>
          </TabsList>

          {isLoadingSongs ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-xl text-muted-foreground">{getTranslation(locale, 'resultPageLoadingSongsTitle')}</p>
              <p className="text-sm text-muted-foreground">
                { clientHasMounted
                  ? ( (getCachedData<ProfileData>(`${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`) || getCachedData<RatingApiResponse>(`${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`) || getCachedData<GlobalMusicApiResponse>(GLOBAL_MUSIC_DATA_KEY) || getCachedData<UserShowallApiResponse>(`${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`))
                    ? getTranslation(locale, 'resultPageLoadingCacheCheck')
                    : getTranslation(locale, 'resultPageLoadingApiFetch'))
                  : getTranslation(locale, 'resultPageLoadingDataStateCheck')
                }
              </p>
            </div>
          ) : errorLoadingSongs ? (
             <Card className="border-destructive">
              <CardHeader className="flex flex-row items-center space-x-2">
                <AlertTriangle className="w-6 h-6 text-destructive" />
                <CardTitle className="font-headline text-xl text-destructive">{getTranslation(locale, 'resultPageErrorLoadingTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-destructive">{errorLoadingSongs}</p>
                <p className="text-sm text-muted-foreground mt-2">{getTranslation(locale, 'resultPageErrorLoadingDesc')}</p>
                <Button asChild variant="outline" className="mt-4">
                  <Link href="/">{getTranslation(locale, 'resultPageButtonBackToCalc')}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <TabsContent value="best30">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">{getTranslation(locale, 'resultPageCardTitleBest30')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {best30SongsData.length > 0 ? (
                      <div className={cn(
                        "grid grid-cols-1 gap-4",
                        best30GridCols
                      )}>
                        {best30SongsData.map((song) => (
                          <SongCard key={`best30-${song.id}-${song.diff}`} song={song} calculationStrategy={calculationStrategy} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">{getTranslation(locale, 'resultPageNoBest30Data')}</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="new20">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">{getTranslation(locale, 'resultPageCardTitleNew20')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                       {new20SongsData.length > 0 ? (
                         <div className={cn(
                           "grid grid-cols-1 gap-4",
                           new20GridCols
                         )}>
                           {new20SongsData.map((song) => (
                             <SongCard key={`new20-${song.id}-${song.diff}`} song={song} calculationStrategy={calculationStrategy} />
                           ))}
                         </div>
                       ) : (
                         <p className="text-muted-foreground">{getTranslation(locale, 'resultPageNoNew20Data')}</p>
                       )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="combined">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">{getTranslation(locale, 'resultPageCardTitleCombined')}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col lg:flex-row gap-6">
                    <div className="lg:w-3/5"> 
                      <h3 className="text-xl font-semibold mb-3 font-headline">{getTranslation(locale, 'resultPageSubHeaderBest30')}</h3>
                      {best30SongsData.length > 0 ? (
                        <div className={cn(
                          "grid grid-cols-1 gap-4",
                          combinedBest30GridCols 
                        )}>
                          {best30SongsData.map((song) => (
                            <SongCard key={`combo-best30-${song.id}-${song.diff}`} song={song} calculationStrategy={calculationStrategy} />
                          ))}
                        </div>
                      ) : (
                         <p className="text-muted-foreground">{getTranslation(locale, 'resultPageNoBest30Data')}</p>
                      )}
                    </div>
                    <div className="lg:w-2/5">
                      <h3 className="text-xl font-semibold mb-3 font-headline">{getTranslation(locale, 'resultPageSubHeaderNew20')}</h3>
                       {new20SongsData.length > 0 ? (
                         <div className={cn(
                           "grid grid-cols-1 gap-4",
                           combinedNew20GridCols
                         )}>
                           {new20SongsData.map((song) => (
                             <SongCard key={`combo-new20-${song.id}-${song.diff}`} song={song} calculationStrategy={calculationStrategy} />
                           ))}
                         </div>
                       ) : (
                         <p className="text-muted-foreground">{getTranslation(locale, 'resultPageNoNew20Data')}</p>
                       )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </main>
  );
}

export default function ResultPage() {
  const { locale } = useLanguage();
  return (
    <Suspense fallback={<div className="flex min-h-screen flex-col items-center justify-center text-xl"><Loader2 className="w-10 h-10 animate-spin mr-2" /> {getTranslation(locale, 'resultPageSuspenseFallback')}</div>}>
      <ResultContent />
    </Suspense>
  );
}

    

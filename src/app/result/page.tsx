
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
import NewSongsData from '@/data/NewSongs.json'; // Step 1: Import NewSongsData


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
  if (typeof chartConstantOverride === 'number' && chartConstantOverride > 0) {
    effectiveChartConstant = chartConstantOverride;
  } else if (typeof apiSong.const === 'number' && apiSong.const > 0) {
    effectiveChartConstant = apiSong.const;
  } else if (
    (apiSong as ShowallApiSongEntry).is_const_unknown &&
    (typeof apiSong.level === 'string' || typeof apiSong.level === 'number')
  ) {
    const parsedLevel = parseFloat(String(apiSong.level));
    if (!isNaN(parsedLevel) && parsedLevel > 0) {
      effectiveChartConstant = parsedLevel;
    }
  }

  let calculatedCurrentRating: number;
  if (typeof effectiveChartConstant === 'number' && effectiveChartConstant > 0 && score > 0) {
    calculatedCurrentRating = calculateChunithmSongRating(score, effectiveChartConstant);
  } else {
    // For songs without a constant or score (e.g., unplayed new songs, or API errors),
    // use the rating from API if available, otherwise 0.
    calculatedCurrentRating = typeof apiSong.rating === 'number' ? apiSong.rating : 0;
  }
  const currentRating = calculatedCurrentRating;

  // Target score/rating logic remains, can be adjusted later
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

type GlobalMusicApiResponse = {
    records?: ShowallApiSongEntry[];
}

type UserShowallApiResponse = {
    records?: ShowallApiSongEntry[];
}


function ResultContent() {
  const searchParams = useSearchParams();
  const userNameForApi = searchParams.get("nickname") || "플레이어";
  const currentRatingDisplay = searchParams.get("current") || "N/A";
  const targetRatingDisplay = searchParams.get("target") || "N/A";
  const { toast } = useToast();

  const [apiPlayerName, setApiPlayerName] = useState<string | null>(userNameForApi === "플레이어" ? "플레이어" : null);
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
    if (typeof window !== 'undefined' && userNameForApi && userNameForApi !== "플레이어") {
        const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
        const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
        const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;
        localStorage.removeItem(profileKey);
        localStorage.removeItem(ratingDataKey);
        localStorage.removeItem(userShowallKey);
        // Optionally clear global music too if you want a full refresh:
        // localStorage.removeItem(GLOBAL_MUSIC_DATA_KEY); 
        console.log(`User-specific cache cleared for user: ${userNameForApi}`);
        toast({ title: "데이터 새로고침 중", description: "사용자 관련 캐시를 지우고 API에서 최신 데이터를 가져옵니다." });
    }
    setRefreshNonce(prev => prev + 1);
  }, [userNameForApi, toast]);

  useEffect(() => {
    const fetchAndProcessData = async () => {
      const API_TOKEN = getApiToken();
      if (!API_TOKEN) {
        setErrorLoadingSongs("API 토큰이 설정되지 않았습니다. 곡 정보를 가져올 수 없습니다. 고급 설정에서 로컬 토큰을 입력하거나 환경 변수를 확인해주세요.");
        setIsLoadingSongs(false);
        return;
      }

      if (!userNameForApi || userNameForApi === "플레이어") {
        setErrorLoadingSongs("사용자 닉네임이 제공되지 않아 데이터를 가져올 수 없습니다.");
        setApiPlayerName("플레이어");
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
      const cachedRatingData = getCachedData<RatingApiResponse>(ratingDataKey);
      const cachedGlobalMusicData = getCachedData<GlobalMusicApiResponse>(globalMusicKey, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
      const cachedUserShowallData = getCachedData<UserShowallApiResponse>(userShowallKey, USER_DATA_CACHE_EXPIRY_MS);
      
      let globalMusicRecordsFromDataSource: ShowallApiSongEntry[] = [];
      let userShowallRecordsFromDataSource: ShowallApiSongEntry[] = [];


      let cacheTimestamp = 'N/A';
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
      setLastRefreshed(cachedProfile ? cacheTimestamp : '사용자 캐시 없음');


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
        console.log("[N20_PREP_2_CACHE] Loading global music data from localStorage cache...");
        globalMusicRecordsFromDataSource = cachedGlobalMusicData.records.filter((e: any): e is ShowallApiSongEntry =>
            e && e.id && e.diff && e.title && (e.release || typeof e.release === 'string') && (e.const !== undefined) && e.level !== undefined
        );
      }
      if (cachedUserShowallData && cachedUserShowallData.records) {
        console.log("[N20_PREP_3_CACHE] Loading user's showall data from localStorage cache...");
        userShowallRecordsFromDataSource = cachedUserShowallData.records.filter((e: any): e is ShowallApiSongEntry =>
            e && e.id && e.diff && (e.score !== undefined) // score is crucial for played songs
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
                        globalMusicRecordsFromDataSource = (res.data.records || []).filter((e: any): e is ShowallApiSongEntry =>
                            e && e.id && e.diff && e.title && (e.release || typeof e.release === 'string') && (e.const !== undefined) && e.level !== undefined
                        );
                        setCachedData<GlobalMusicApiResponse>(globalMusicKey, { records: globalMusicRecordsFromDataSource }, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
                        console.log("[N20_PREP_2_API] Global music data fetched from API and cached.");
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
                setLastRefreshed(newCacheTime);
                toast({ title: "데이터 로드 완료 (API)", description: `API에서 최신 데이터를 성공적으로 불러와 캐시했습니다. (${newCacheTime})` });

            } catch (error) {
                console.error("Error fetching song data from API:", error);
                let detailedErrorMessage = "알 수 없는 오류로 곡 정보를 가져오지 못했습니다.";
                if (error instanceof Error) detailedErrorMessage = error.message;
                setErrorLoadingSongs(detailedErrorMessage);
                if (!apiPlayerName && userNameForApi !== "플레이어") setApiPlayerName(userNameForApi);
            }
        } else {
             toast({ title: "데이터 로드 완료 (캐시)", description: `로컬 캐시에서 데이터를 성공적으로 불러왔습니다.` });
        }
      } else {
         toast({ title: "데이터 로드 완료 (캐시)", description: `로컬 캐시에서 데이터를 성공적으로 불러왔습니다.` });
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
                  
                  const appSong = mapApiSongToAppSong(combinedSongEntry, index); // chartConstantOverride is undefined
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
      } else { // userShowallRecordsFromDataSource.length === 0 but definedSongPoolEntries.length > 0
          console.warn("[N20_CALC_USER] User has no play records, or records/showall.json failed to load/returned empty. Cannot calculate New 20 based on user plays.");
          setNew20SongsData([]);
      }

      setIsLoadingSongs(false);
    };

    if (clientHasMounted) { 
      fetchAndProcessData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNameForApi, refreshNonce, clientHasMounted]); 

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
                <ArrowLeft className="w-4 h-4 mr-1" /> 계산기로 돌아가기
              </Link>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-4 text-sm sm:text-base w-full sm:w-auto">
            <div className="flex items-center p-2 bg-secondary rounded-md">
              <Gauge className="w-5 h-5 mr-2 text-primary" />
              <span>현재: <span className="font-semibold">{currentRatingDisplay}</span></span>
            </div>
            <div className="flex items-center p-2 bg-secondary rounded-md">
              <TargetIconLucide className="w-5 h-5 mr-2 text-primary" />
              <span>목표: <span className="font-semibold">{targetRatingDisplay}</span></span>
            </div>
          </div>
        </header>

        <div className="mb-4 flex flex-col sm:flex-row justify-between items-center gap-2">
            <p className="text-xs text-muted-foreground">
                {clientHasMounted
                    ? (lastRefreshed && lastRefreshed !== '사용자 캐시 없음' ? `사용자 데이터 동기화: ${lastRefreshed}` : '캐시된 사용자 데이터가 없거나 만료되었습니다.')
                    : '동기화 상태 확인 중...'}
            </p>
            <Button onClick={handleRefreshData} variant="outline" size="sm" disabled={isLoadingSongs || !userNameForApi || userNameForApi === "플레이어" || !getApiToken()}>
                <RefreshCw className={cn("w-4 h-4 mr-2", isLoadingSongs && "animate-spin")} />
                사용자 데이터 새로고침
            </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="font-headline text-xl">전략 선택</CardTitle>
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
                  <BarChart3 className="w-5 h-5 mr-2 text-primary" /> 평균 (Average)
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                <RadioGroupItem value="peak" id="r-peak" />
                <Label htmlFor="r-peak" className="flex items-center cursor-pointer">
                  <TrendingUp className="w-5 h-5 mr-2 text-destructive" /> 고점 (Peak Performance)
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                <RadioGroupItem value="floor" id="r-floor" />
                <Label htmlFor="r-floor" className="flex items-center cursor-pointer">
                  <TrendingDown className="w-5 h-5 mr-2 text-green-600" /> 저점 (Fill Bottom Slots)
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground mt-2">
              * 현재 이 전략 선택은 UI 프로토타입이며, 실제 목표 점수 계산 로직은 아직 구현되지 않았습니다.
            </p>
          </CardContent>
        </Card>

        <Tabs defaultValue="best30" className="w-full">
          <TabsList className="grid w-full grid-cols-3 gap-1 mb-6 bg-muted p-1 rounded-lg">
            <TabsTrigger value="best30" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Best 30</TabsTrigger>
            <TabsTrigger value="new20" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">New 20</TabsTrigger>
            <TabsTrigger value="combined" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Best30 + New20</TabsTrigger>
          </TabsList>

          {isLoadingSongs ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-xl text-muted-foreground">곡 데이터를 불러오는 중입니다...</p>
              <p className="text-sm text-muted-foreground">
                { clientHasMounted
                  ? ( (getCachedData<ProfileData>(`${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`) || getCachedData<GlobalMusicApiResponse>(GLOBAL_MUSIC_DATA_KEY) || getCachedData<UserShowallApiResponse>(`${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`))
                    ? '캐시를 확인/갱신 중입니다...'
                    : 'Chunirec API에서 데이터를 가져오고 있습니다. 잠시만 기다려주세요.')
                  : '데이터 상태 확인 중...'
                }
              </p>
            </div>
          ) : errorLoadingSongs ? (
             <Card className="border-destructive">
              <CardHeader className="flex flex-row items-center space-x-2">
                <AlertTriangle className="w-6 h-6 text-destructive" />
                <CardTitle className="font-headline text-xl text-destructive">데이터 로딩 오류</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-destructive">{errorLoadingSongs}</p>
                <p className="text-sm text-muted-foreground mt-2">입력한 닉네임이 정확한지, Chunirec에 데이터가 공개되어 있는지, 또는 API 토큰이 유효한지 확인해주세요. 문제가 지속되면 '데이터 새로고침' 버튼을 사용해보세요.</p>
                <Button asChild variant="outline" className="mt-4">
                  <Link href="/">계산기로 돌아가기</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <TabsContent value="best30">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">Best 30 곡</CardTitle>
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
                      <p className="text-muted-foreground">Best 30 곡 데이터가 없습니다. (Chunirec API의 `rating_data.json` 응답을 확인해주세요)</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="new20">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">New 20 곡</CardTitle>
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
                         <p className="text-muted-foreground">New 20 곡 데이터가 없습니다. 사용자가 NewSongs.json에 포함된 곡을 플레이하지 않았거나, 관련 API 데이터 로딩에 실패했을 수 있습니다. (콘솔 로그 확인)</p>
                       )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="combined">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">Best 30 + New 20 (통합 보기)</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col lg:flex-row gap-6">
                    <div className="lg:w-3/5"> 
                      <h3 className="text-xl font-semibold mb-3 font-headline">Best 30</h3>
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
                         <p className="text-muted-foreground">Best 30 곡 데이터가 없습니다.</p>
                      )}
                    </div>
                    <div className="lg:w-2/5">
                      <h3 className="text-xl font-semibold mb-3 font-headline">New 20</h3>
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
                         <p className="text-muted-foreground">New 20 곡 데이터가 없습니다. (콘솔 로그 확인)</p>
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
  return (
    <Suspense fallback={<div className="flex min-h-screen flex-col items-center justify-center text-xl"><Loader2 className="w-10 h-10 animate-spin mr-2" /> 결과 로딩 중...</div>}>
      <ResultContent />
    </Suspense>
  );
}

    

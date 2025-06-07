
"use client";

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SongCard, { type Song } from "@/components/SongCard";
import { User, Gauge, Target as TargetIconLucide, ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const API_TOKEN = process.env.NEXT_PUBLIC_CHUNIREC_API_TOKEN;
const BEST_COUNT = 30;
const NEW_COUNT = 20;
const TARGET_NEW_SONG_RELEASE_DATE = "2024-12-12"; // 기준 출시일 (변경 금지)

type RatingApiSongEntry = {
  id: string;
  diff: string;
  title: string;
  score: number;
  rating: number; // API에서 제공하는 레이팅 (폴백용)
  genre?: string;
  const?: number; // 보면 정수
  updated_at?: string;
};

type ShowallApiSongEntry = {
  id: string;
  diff: string;
  level: number | string;
  title: string;
  const: number; // 보면 정수
  score: number;
  rating: number; // API에서 제공하는 레이팅 (폴백용)
  is_const_unknown: boolean;
  is_clear: boolean;
  is_fullcombo: boolean;
  is_alljustice: boolean;
  is_fullchain: boolean;
  genre: string;
  updated_at: string;
  is_played: boolean;
};

type MusicSearchApiEntry = {
  id: string;
  title: string;
  genre: string;
  artist: string;
  release: string; // "YYYY-MM-DD"
};

const calculateChunithmSongRating = (score: number, chartConstant: number | undefined | null): number => {
  if (typeof chartConstant !== 'number' || chartConstant <= 0) {
    return 0;
  }

  let ratingValue = 0;

  if (score >= 1009000) { // SSS+
    ratingValue = chartConstant + 2.15;
  } else if (score >= 1007500) { // SSS (1,007,500 ~ 1,008,999)
    // Max bonus: floor((1008999 - 1007500) / 100) * 0.01 = 14 * 0.01 = 0.14
    ratingValue = chartConstant + 2.00 + Math.min(0.14, Math.floor(Math.max(0, score - 1007500) / 100) * 0.01);
  } else if (score >= 1005000) { // SS+ (1,005,000 ~ 1,007,499)
    // Max bonus: floor((1007499 - 1005000) / 50) * 0.01 = 49 * 0.01 = 0.49
    ratingValue = chartConstant + 1.50 + Math.min(0.49, Math.floor(Math.max(0, score - 1005000) / 50) * 0.01);
  } else if (score >= 1000000) { // SS (1,000,000 ~ 1,004,999)
    // Max bonus: floor((1004999 - 1000000) / 100) * 0.01 = 49 * 0.01 = 0.49
    ratingValue = chartConstant + 1.00 + Math.min(0.49, Math.floor(Math.max(0, score - 1000000) / 100) * 0.01);
  } else if (score >= 990000) { // S+ (990,000 ~ 999,999)
    // Max bonus: floor((999999 - 990000) / 250) * 0.01 = 39 * 0.01 = 0.39
    ratingValue = chartConstant + 0.60 + Math.min(0.39, Math.floor(Math.max(0, score - 990000) / 250) * 0.01);
  } else if (score >= 975000) { // S (975,000 ~ 989,999)
    // Max bonus: floor((989999 - 975000) / 250) * 0.01 = 59 * 0.01 = 0.59
    ratingValue = chartConstant + 0.00 + Math.min(0.59, Math.floor(Math.max(0, score - 975000) / 250) * 0.01);
  } else if (score >= 950000) { // AAA
    ratingValue = chartConstant - 1.50;
  } else if (score >= 925000) { // AA
    ratingValue = chartConstant - 3.00;
  } else if (score >= 900000) { // A
    ratingValue = chartConstant - 5.00;
  } else if (score >= 800000) { // BBB
    ratingValue = (chartConstant - 5.00) / 2.0;
  } else { // C or below
    ratingValue = 0;
  }
  return Math.max(0, parseFloat(ratingValue.toFixed(2)));
};

const mapApiSongToAppSong = (apiSong: RatingApiSongEntry | ShowallApiSongEntry, _index: number): Song => {
  const score = apiSong.score;
  const chartConst = apiSong.const;
  let calculatedCurrentRating: number;

  const isConstUnknown = 'is_const_unknown' in apiSong && apiSong.is_const_unknown;

  if (isConstUnknown) {
    calculatedCurrentRating = typeof apiSong.rating === 'number' ? apiSong.rating : 0;
  } else if (typeof chartConst === 'number' && chartConst > 0 && typeof score === 'number') {
    calculatedCurrentRating = calculateChunithmSongRating(score, chartConst);
  } else {
    calculatedCurrentRating = typeof apiSong.rating === 'number' ? apiSong.rating : 0;
  }
  
  const currentRating = calculatedCurrentRating;

  // AI 추천 목표 점수 (기존 로직 유지)
  const targetScoreImprovementFactor = (1001000 - score > 0 && score > 0) ? (1001000 - score) / 10 : 10000;
  const targetScore = Math.max(score, Math.min(1001000, score + Math.floor(Math.random() * targetScoreImprovementFactor)));
  
  let targetRating: number;
  if (isConstUnknown) {
    // 보면 정수를 모르면, 현재 레이팅에서 약간의 향상치만 더함 (기존 로직과 유사하게)
    targetRating = parseFloat(Math.max(currentRating, Math.min(17.85, currentRating + Math.random() * 0.2)).toFixed(2));
  } else if (typeof chartConst === 'number' && chartConst > 0) {
    targetRating = calculateChunithmSongRating(targetScore, chartConst);
  } else {
    // 보면 정수도 없고, API 레이팅도 없다면 현재 레이팅 기준으로 처리
     targetRating = parseFloat(Math.max(currentRating, Math.min(17.85, currentRating + Math.random() * 0.2)).toFixed(2));
  }
  
  return {
    id: apiSong.id,
    diff: apiSong.diff,
    title: apiSong.title,
    jacketUrl: `https://placehold.co/120x120.png?text=Jkt`, // 자켓 이미지 로딩 비활성화
    currentScore: score,
    currentRating: currentRating,
    targetScore: targetScore,
    targetRating: targetRating,
  };
};

const sortSongsByRatingDesc = (songs: Song[]): Song[] => {
  return [...songs].sort((a, b) => {
    if (b.currentRating !== a.currentRating) {
      return b.currentRating - a.currentRating;
    }
    const scoreDiffA = a.targetScore > 0 ? (a.targetScore - a.currentScore) : -Infinity;
    const scoreDiffB = b.targetScore > 0 ? (b.targetScore - a.currentScore) : -Infinity;
    return scoreDiffB - scoreDiffA;
  });
};

const difficultyOrder: { [key: string]: number } = {
  MAS: 4,
  EXP: 3,
  ADV: 2,
  BAS: 1,
};

const calculateNewSongs = (
  allMusicEntries: MusicSearchApiEntry[],
  allUserRecords: ShowallApiSongEntry[],
  count: number
): Song[] => {
  if (!allMusicEntries || allMusicEntries.length === 0 || !allUserRecords || allUserRecords.length === 0) {
    return [];
  }

  // 1. Filter music entries: release date > TARGET_NEW_SONG_RELEASE_DATE and genre != "WORLD'S END"
  const eligibleNewMusic = allMusicEntries.filter(music => {
    return music.release > TARGET_NEW_SONG_RELEASE_DATE && music.genre !== "WORLD'S END";
  });
  console.log(`Eligible new music (after target release date '${TARGET_NEW_SONG_RELEASE_DATE}' & genre filter):`, eligibleNewMusic);


  if (eligibleNewMusic.length === 0) {
    console.warn(`No music found released after ${TARGET_NEW_SONG_RELEASE_DATE} or matching genre criteria.`);
    return [];
  }

  const eligibleNewMusicIds = new Set<string>(eligibleNewMusic.map(m => m.id));

  // 2. Filter user records: played, score > 0, and is one of the eligible new music
  const userPlayedEligibleNewSongs = allUserRecords.filter(record =>
    eligibleNewMusicIds.has(record.id) && record.is_played && record.score > 0
  );
  console.log("User played eligible new songs (before sorting/slicing):", userPlayedEligibleNewSongs);


  if (userPlayedEligibleNewSongs.length === 0) {
    console.warn("User has not played any of the eligible new songs or scores are 0.");
    return [];
  }
  
  // 3. Map to Song type (this will apply the new rating calculation)
  const mappedUserPlayedNewSongs = userPlayedEligibleNewSongs.map((record, index) => mapApiSongToAppSong(record, index));

  // 4. Sort these user-played eligible new songs with calculated ratings
  //    Rating (desc), Score (desc), Difficulty (MAS > EXP > ADV > BAS)
  mappedUserPlayedNewSongs.sort((a, b) => {
    if (b.currentRating !== a.currentRating) { // Use calculated rating
      return b.currentRating - a.currentRating;
    }
    if (b.currentScore !== a.currentScore) { // Use score from record
      return b.currentScore - a.currentScore;
    }
    const diffAUpper = a.diff.toUpperCase();
    const diffBUpper = b.diff.toUpperCase();
    const diffAOrder = difficultyOrder[diffAUpper] || 0;
    const diffBOrder = difficultyOrder[diffBUpper] || 0;
    return diffBOrder - diffAOrder;
  });

  // 5. Take top 'count'
  return mappedUserPlayedNewSongs.slice(0, count);
};


function ResultContent() {
  const searchParams = useSearchParams();
  const userNameForApi = searchParams.get("nickname") || "플레이어";
  const currentRatingDisplay = searchParams.get("current") || "N/A";
  const targetRatingDisplay = searchParams.get("target") || "N/A";

  const [apiPlayerName, setApiPlayerName] = useState<string | null>(null);
  const [best30SongsData, setBest30SongsData] = useState<Song[]>([]);
  const [new20SongsData, setNew20SongsData] = useState<Song[]>([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(true);
  const [errorLoadingSongs, setErrorLoadingSongs] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlayerProfile = async () => {
      if (!API_TOKEN || !userNameForApi || userNameForApi === "플레이어") {
        setApiPlayerName(userNameForApi);
        return;
      }
      try {
        const response = await fetch(
          `https://api.chunirec.net/2.0/records/profile.json?region=jp2&user_name=${encodeURIComponent(userNameForApi)}&token=${API_TOKEN}`
        );
        if (response.ok) {
          const data = await response.json();
          if (data.player_name) {
            setApiPlayerName(data.player_name);
          } else {
            setApiPlayerName(userNameForApi);
          }
        } else {
          console.error("Failed to fetch player profile:", response.status);
          setApiPlayerName(userNameForApi);
        }
      } catch (error) {
        console.error("Error fetching player profile:", error);
        setApiPlayerName(userNameForApi);
      }
    };
    fetchPlayerProfile();
  }, [userNameForApi]);


  useEffect(() => {
    const fetchSongData = async () => {
      if (!API_TOKEN) {
        setErrorLoadingSongs("API 토큰이 설정되지 않았습니다. 곡 정보를 가져올 수 없습니다.");
        setIsLoadingSongs(false);
        return;
      }

      const userNameParam = userNameForApi ? `&user_name=${encodeURIComponent(userNameForApi)}` : "";
      if (!userNameParam && !searchParams.get("user_id")) {
         setErrorLoadingSongs("사용자 정보(닉네임 또는 ID)가 없어 곡 정보를 가져올 수 없습니다.");
         setIsLoadingSongs(false);
         return;
      }

      setIsLoadingSongs(true);
      setErrorLoadingSongs(null);

      const musicSearchBaseQuery = "since:2024-01-01"; // 이 날짜는 TARGET_NEW_SONG_RELEASE_DATE 이전이어야 함

      try {
        const [ratingDataResponse, showallResponse, musicSearchResponse] = await Promise.all([
          fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2${userNameParam}&token=${API_TOKEN}`),
          fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2${userNameParam}&token=${API_TOKEN}`),
          fetch(`https://api.chunirec.net/2.0/music/search.json?q=${encodeURIComponent(musicSearchBaseQuery)}&region=jp2&token=${API_TOKEN}`)
        ]);

        let criticalError = null;

        const ratingData = await ratingDataResponse.json();
        console.log('Chunirec rating_data.json API Response:', ratingData);

        if (!ratingDataResponse.ok) {
          const errorData = ratingData || {};
          let errorMessage = `곡 레이팅 정보를 가져오는 데 실패했습니다. (상태: ${ratingDataResponse.status})`;
          if (errorData.error && errorData.error.message) errorMessage += `: ${errorData.error.message}`;
          if (ratingDataResponse.status === 404) errorMessage = `사용자 '${userNameForApi || '정보 없음'}'의 레이팅 데이터를 찾을 수 없습니다. (rating_data)`;
          else if (ratingDataResponse.status === 403 && errorData.error?.code === 403) errorMessage = `Chunirec API 토큰이 유효하지 않거나, 사용자 '${userNameForApi || '정보 없음'}' 데이터 접근 권한이 없습니다. (rating_data)`;
          criticalError = errorMessage;
        } else {
          const bestEntriesApi = ratingData.best?.entries?.filter((e: any): e is RatingApiSongEntry => e !== null && typeof e.id === 'string' && typeof e.diff === 'string' && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number')) || [];
          const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index));
          setBest30SongsData(sortSongsByRatingDesc(mappedBestEntries));
        }

        const showallData = await showallResponse.json();
        console.log('Chunirec showall.json API Response:', showallData);
        let allUserRecords: ShowallApiSongEntry[] = [];
        if (!showallResponse.ok) {
          const errorData = showallData || {};
          let errorMessage = `전체 곡 기록 정보를 가져오는 데 실패했습니다. (상태: ${showallResponse.status})`;
           if (errorData.error && errorData.error.message) errorMessage += `: ${errorData.error.message}`;
          if (showallResponse.status === 404) errorMessage = `사용자 '${userNameForApi || '정보 없음'}'의 전체 곡 기록을 찾을 수 없습니다. (showall)`;
          else if (showallResponse.status === 403 && errorData.error?.code === 403) errorMessage = `Chunirec API 토큰이 유효하지 않거나, 사용자 '${userNameForApi || '정보 없음'}' 데이터 접근 권한이 없습니다. (showall)`;

          if (!criticalError) criticalError = errorMessage;
          else console.warn("Also failed to fetch showall.json:", errorMessage);
        } else {
          allUserRecords = showallData.records?.filter((e: any): e is ShowallApiSongEntry => e !== null && typeof e.id === 'string' && typeof e.diff === 'string' && typeof e.updated_at === 'string' && typeof e.rating === 'number' && typeof e.score === 'number' && typeof e.is_played === 'boolean' && typeof e.const === 'number') || [];
        }

        const musicSearchData = await musicSearchResponse.json();
        console.log('Chunirec music/search.json API Response:', musicSearchData);
        let allMusicEntriesFromSearch: MusicSearchApiEntry[] = [];
        if (!musicSearchResponse.ok) {
            const errorData = musicSearchData || {};
            let errorMessage = `최신 곡 목록을 가져오는 데 실패했습니다. (상태: ${musicSearchResponse.status})`;
            if (errorData.error && errorData.error.message) errorMessage += `: ${errorData.error.message}`;
            else if (musicSearchResponse.status === 400) errorMessage += `. 검색어 '${musicSearchBaseQuery}'를 확인해주세요.`;

            if (!criticalError) criticalError = errorMessage;
            else console.warn("Also failed to fetch music/search.json:", errorMessage);
        } else {
            allMusicEntriesFromSearch = musicSearchData.filter((e: any): e is MusicSearchApiEntry =>
                e !== null &&
                typeof e.id === 'string' &&
                typeof e.title === 'string' &&
                typeof e.genre === 'string' &&
                typeof e.release === 'string'
            ) || [];
        }

        if (criticalError) {
            throw new Error(criticalError);
        }

        if (allMusicEntriesFromSearch.length > 0 && allUserRecords.length > 0) {
            const calculatedNewSongs = calculateNewSongs(allMusicEntriesFromSearch, allUserRecords, NEW_COUNT);
            setNew20SongsData(calculatedNewSongs); 
        } else {
            setNew20SongsData([]);
            if (allMusicEntriesFromSearch.length === 0) console.warn("No music entries found from music/search API or it failed, impacting New 20 calculation.");
            if (allUserRecords.length === 0) console.warn("No user records found from showall API or it failed, impacting New 20 calculation.");
        }


      } catch (error) {
        console.error("Error fetching song data:", error);
        setErrorLoadingSongs(error instanceof Error ? error.message : "알 수 없는 오류로 곡 정보를 가져오지 못했습니다.");
        setBest30SongsData([]);
        setNew20SongsData([]);
      } finally {
        setIsLoadingSongs(false);
      }
    };

    fetchSongData();
  }, [userNameForApi]);

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

        <Tabs defaultValue="best30" className="w-full">
          <TabsList className="grid w-full grid-cols-3 gap-1 mb-6 bg-muted p-1 rounded-lg">
            <TabsTrigger value="best30" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm">Best 30</TabsTrigger>
            <TabsTrigger value="new20" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm">New 20</TabsTrigger>
            <TabsTrigger value="best30new20" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm">Best30 + New20</TabsTrigger>
          </TabsList>

          {isLoadingSongs ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-xl text-muted-foreground">곡 데이터를 불러오는 중입니다...</p>
              <p className="text-sm text-muted-foreground">Chunirec API에서 데이터를 가져오고 있습니다. 잠시만 기다려주세요.</p>
            </div>
          ) : errorLoadingSongs ? (
             <Card className="border-destructive">
              <CardHeader className="flex flex-row items-center space-x-2">
                <AlertTriangle className="w-6 h-6 text-destructive" />
                <CardTitle className="font-headline text-xl text-destructive">데이터 로딩 오류</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-destructive">{errorLoadingSongs}</p>
                <p className="text-sm text-muted-foreground mt-2">입력한 닉네임이 정확한지, Chunirec에 데이터가 공개되어 있는지, 또는 API 토큰이 유효한지 확인해주세요.</p>
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
                          <SongCard key={`best30-${song.id}-${song.diff}`} song={song} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">Best 30 곡 데이터가 없습니다.</p>
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
                          <SongCard key={`new20-${song.id}-${song.diff}`} song={song} />
                        ))}
                      </div>
                     ) : (
                       <p className="text-muted-foreground">New 20 곡 데이터가 없습니다. (지정된 날짜 이후 출시된 곡 중 플레이 기록이 없거나, 관련 API 호출에 문제가 있을 수 있습니다.)</p>
                     )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="best30new20">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">Best 30 + New 20 곡</CardTitle>
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
                            <SongCard key={`combo-best30-${song.id}-${song.diff}`} song={song} />
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
                            <SongCard key={`combo-new20-${song.id}-${song.diff}`} song={song} />
                          ))}
                        </div>
                       ) : (
                          <p className="text-muted-foreground">New 20 곡 데이터가 없습니다. (지정된 날짜 이후 출시된 곡 중 플레이 기록이 없거나, 관련 API 호출에 문제가 있을 수 있습니다.)</p>
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


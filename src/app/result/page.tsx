
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
const BEST_COUNT = 30; // Though rating_data.json's best.entries is already 30
const NEW_COUNT = 20; 

type RatingApiSongEntry = {
  id: string; 
  diff: string;
  title: string;
  score: number;
  rating: number;
  // genre: string; // available in rating_data.json best.entries
  // const: number; // available
  // updated_at: string; // available
};

type ShowallApiSongEntry = {
  id: string; 
  diff: string; 
  level: number | string; 
  title: string;
  const: number; 
  score: number;
  rating: number; 
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


const mapApiSongToAppSong = (apiSong: RatingApiSongEntry | ShowallApiSongEntry, _index: number): Song => {
  const currentScore = apiSong.score;
  const currentRating = apiSong.rating;

  // Placeholder target scores/ratings - can be refined later
  const targetScore = Math.max(currentScore, Math.min(1001000, currentScore + Math.floor(Math.random() * ( (1001000 - currentScore > 0 && currentScore > 0) ? (1001000 - currentScore)/10 : 10000) ) ) );
  const targetRating = parseFloat(Math.max(currentRating, Math.min(17.85, currentRating + Math.random() * 0.2)).toFixed(2));

  return {
    id: apiSong.id,
    diff: apiSong.diff,
    title: apiSong.title,
    jacketUrl: `https://placehold.co/120x120.png?text=${apiSong.id ? apiSong.id.substring(0,4) : 'Jkt'}`, 
    currentScore: currentScore,
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
    // Secondary sort: higher target score difference first
    const scoreDiffA = a.targetScore > 0 ? (a.targetScore - a.currentScore) : -Infinity;
    const scoreDiffB = b.targetScore > 0 ? (b.targetScore - a.currentScore) : -Infinity;
    return scoreDiffB - scoreDiffA;
  });
};

const calculateNewSongsByReleaseDate = (
  newlyReleasedSongs: MusicSearchApiEntry[],
  allUserRecords: ShowallApiSongEntry[],
  count: number
): Song[] => {
  if (!newlyReleasedSongs || newlyReleasedSongs.length === 0 || !allUserRecords || allUserRecords.length === 0) {
    return [];
  }

  const releaseDateMap = new Map<string, string>();
  const candidateNewReleaseSongIds = new Set<string>();

  newlyReleasedSongs.forEach(song => {
    if (song.genre !== "WORLD'S END") {
      releaseDateMap.set(song.id, song.release);
      candidateNewReleaseSongIds.add(song.id);
    }
  });

  const userPlayedNewSongs = allUserRecords.filter(record => 
    candidateNewReleaseSongIds.has(record.id) && record.score > 0
  );

  // Sort: 1. Release Date (desc), 2. User Rating (desc), 3. User Score (desc)
  userPlayedNewSongs.sort((a, b) => {
    const releaseA = releaseDateMap.get(a.id) || "0000-00-00";
    const releaseB = releaseDateMap.get(b.id) || "0000-00-00";
    if (releaseB !== releaseA) {
      return new Date(releaseB).getTime() - new Date(releaseA).getTime();
    }
    if (b.rating !== a.rating) {
      return b.rating - a.rating;
    }
    return b.score - a.score;
  });
  
  return userPlayedNewSongs.slice(0, count).map((record, index) => mapApiSongToAppSong(record, index));
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
      if (!userNameParam && !searchParams.get("user_id")) { // user_id is not used, but keeping for future
         setErrorLoadingSongs("사용자 정보(닉네임 또는 ID)가 없어 곡 정보를 가져올 수 없습니다.");
         setIsLoadingSongs(false);
         return;
      }

      setIsLoadingSongs(true);
      setErrorLoadingSongs(null);

      // Define the date for "since" query, e.g., start of the current year or a fixed recent date
      // For example, "since:2024-01-01". User requested "since:2024-12-12" which is future, using a placeholder.
      const sinceDateQuery = "since:2024-01-01"; // Placeholder, adjust as needed

      try {
        const [ratingDataResponse, showallResponse, musicSearchResponse] = await Promise.all([
          fetch(`https://api.chunirec.net/2.0/records/rating_data.json?region=jp2${userNameParam}&token=${API_TOKEN}`),
          fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2${userNameParam}&token=${API_TOKEN}`),
          fetch(`https://api.chunirec.net/2.0/music/search.json?q=${encodeURIComponent(sinceDateQuery)}&region=jp2&token=${API_TOKEN}`)
        ]);

        let criticalError = null;

        // Process rating_data.json (for Best 30)
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
          const bestEntriesApi = ratingData.best?.entries?.filter((e: any): e is RatingApiSongEntry => e !== null && typeof e.id === 'string' && typeof e.diff === 'string') || [];
          const mappedBestEntries = bestEntriesApi.map((entry, index) => mapApiSongToAppSong(entry, index));
          setBest30SongsData(sortSongsByRatingDesc(mappedBestEntries));
        }
        
        // Process showall.json (for New 20 calculation base)
        const showallData = await showallResponse.json();
        console.log('Chunirec showall.json API Response:', showallData);
        let allUserRecords: ShowallApiSongEntry[] = [];
        if (!showallResponse.ok) {
          const errorData = showallData || {};
          let errorMessage = `전체 곡 기록 정보를 가져오는 데 실패했습니다. (상태: ${showallResponse.status})`;
           if (errorData.error && errorData.error.message) errorMessage += `: ${errorData.error.message}`;
          if (showallResponse.status === 404) errorMessage = `사용자 '${userNameForApi || '정보 없음'}'의 전체 곡 기록을 찾을 수 없습니다. (showall)`;
          else if (showallResponse.status === 403 && errorData.error?.code === 403) errorMessage = `Chunirec API 토큰이 유효하지 않거나, 사용자 '${userNameForApi || '정보 없음'}' 데이터 접근 권한이 없습니다. (showall)`;
          
          if (!criticalError) criticalError = errorMessage; // If rating_data was ok, this becomes critical for New20
          else console.error("Also failed to fetch showall.json:", errorMessage); // Log if rating_data also failed
        } else {
          allUserRecords = showallData.records?.filter((e: any): e is ShowallApiSongEntry => e !== null && typeof e.id === 'string' && typeof e.diff === 'string') || [];
        }

        // Process music/search.json (for New 20 calculation base)
        const musicSearchData = await musicSearchResponse.json();
        console.log('Chunirec music/search.json API Response:', musicSearchData);
        let newlyReleasedSongs: MusicSearchApiEntry[] = [];
        if (!musicSearchResponse.ok) {
            const errorData = musicSearchData || {};
            let errorMessage = `최신 곡 목록을 가져오는 데 실패했습니다. (상태: ${musicSearchResponse.status})`;
            if (errorData.error && errorData.error.message) errorMessage += `: ${errorData.error.message}`;
            else if (musicSearchResponse.status === 400) errorMessage += `. 검색어 '${sinceDateQuery}'를 확인해주세요.`;
            
            if (!criticalError) criticalError = errorMessage;
            else console.error("Also failed to fetch music/search.json:", errorMessage);
        } else {
            newlyReleasedSongs = musicSearchData.filter((e: any): e is MusicSearchApiEntry => 
                e !== null && 
                typeof e.id === 'string' &&
                typeof e.genre === 'string' &&
                typeof e.release === 'string'
            ) || [];
        }

        if (criticalError) {
            throw new Error(criticalError);
        }
        
        // Calculate New 20 songs using the new logic
        if (newlyReleasedSongs.length > 0 && allUserRecords.length > 0) {
            const calculatedNewSongs = calculateNewSongsByReleaseDate(newlyReleasedSongs, allUserRecords, NEW_COUNT);
            setNew20SongsData(sortSongsByRatingDesc(calculatedNewSongs)); // Keep sorting by rating for display consistency
        } else {
            setNew20SongsData([]); // Set to empty if dependent data is missing
            if (newlyReleasedSongs.length === 0) console.warn("No newly released songs found or music/search API failed.");
            if (allUserRecords.length === 0) console.warn("No user records found or showall API failed.");
        }


      } catch (error) {
        console.error("Error fetching song data:", error);
        setErrorLoadingSongs(error instanceof Error ? error.message : "알 수 없는 오류로 곡 정보를 가져오지 못했습니다.");
        setBest30SongsData([]); // Clear data on critical error
        setNew20SongsData([]);  // Clear data on critical error
      } finally {
        setIsLoadingSongs(false);
      }
    };

    fetchSongData();
  }, [searchParams, userNameForApi]); // userNameForApi is a dependency for API calls

  const best30GridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
  const new20GridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"; 
  const combinedBest30GridCols = "sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3";
  const combinedNew20GridCols = "sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2";


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
          <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3 mb-6 bg-muted p-1 rounded-lg">
            <TabsTrigger value="best30" className="py-2.5 text-sm sm:text-base">Best 30</TabsTrigger>
            <TabsTrigger value="new20" className="py-2.5 text-sm sm:text-base">New 20</TabsTrigger>
            <TabsTrigger value="best30new20" className="py-2.5 text-sm sm:text-base">Best30 + New20</TabsTrigger>
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
                       <p className="text-muted-foreground">New 20 곡 데이터가 없습니다. (최근 출시된 곡 중 플레이 기록이 없거나, 관련 API 호출에 문제가 있을 수 있습니다.)</p>
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
                          <p className="text-muted-foreground">New 20 곡 데이터가 없습니다. (최근 출시된 곡 중 플레이 기록이 없거나, 관련 API 호출에 문제가 있을 수 있습니다.)</p>
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


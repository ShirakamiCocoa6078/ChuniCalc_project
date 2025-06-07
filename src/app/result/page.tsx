
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

const API_TOKEN = process.env.CHUNIREC_API_TOKEN;

type ApiSongEntry = {
  id: string;
  title: string;
  score: number;
  rating: number;
  // Chunirec API rating_data.json 응답에는 jacketUrl이 없음
  // diff, const, genre 등 다른 유용한 정보도 포함될 수 있음
};

const mapApiSongToAppSong = (apiSong: ApiSongEntry, index: number): Song => {
  const currentScore = apiSong.score;
  const currentRating = apiSong.rating;

  // 목표 점수/레이팅 생성 로직 (기존 placeholder 로직 참고)
  // 실제 API 데이터에서는 targetScore, targetRating이 없으므로, 필요시 다른 로직으로 대체해야 함.
  // 여기서는 현재 값에서 약간 높게 설정하여 표시.
  const targetScore = Math.max(currentScore, Math.min(1001000, currentScore + Math.floor(Math.random() * ( (1001000 - currentScore > 0 && currentScore > 0) ? (1001000 - currentScore)/10 : 10000) ) ) );
  const targetRating = parseFloat(Math.max(currentRating, Math.min(17.85, currentRating + Math.random() * 0.2)).toFixed(2));

  return {
    id: apiSong.id || `song-${index}`,
    title: apiSong.title,
    jacketUrl: `https://placehold.co/120x120.png?text=${apiSong.id ? apiSong.id.substring(0,4) : 'Song'}`,
    currentScore: currentScore,
    currentRating: currentRating,
    targetScore: targetScore,
    targetRating: targetRating,
  };
};

const sortSongs = (songs: Song[]): Song[] => {
  return [...songs].sort((a, b) => {
    if (b.currentRating !== a.currentRating) {
      return b.currentRating - a.currentRating;
    }
    const scoreDiffA = a.targetScore > 0 ? (a.targetScore - a.currentScore) : -Infinity;
    const scoreDiffB = b.targetScore > 0 ? (b.targetScore - a.currentScore) : -Infinity;
    return scoreDiffB - scoreDiffA;
  });
};

function ResultContent() {
  const searchParams = useSearchParams();
  const userNameForApi = searchParams.get("nickname") || "플레이어";
  const currentRatingDisplay = searchParams.get("current") || "N/A";
  const targetRatingDisplay = searchParams.get("target") || "N/A";

  const [apiPlayerName, setApiPlayerName] = useState<string | null>(userNameForApi);
  const [best30SongsData, setBest30SongsData] = useState<Song[]>([]);
  const [new20SongsData, setNew20SongsData] = useState<Song[]>([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(true);
  const [errorLoadingSongs, setErrorLoadingSongs] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlayerProfile = async () => {
      if (!API_TOKEN || !userNameForApi || userNameForApi === "플레이어") {
        setApiPlayerName(userNameForApi); // Fallback to URL nickname if no API call needed
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
            setApiPlayerName(userNameForApi); // Fallback if player_name not in response
          }
        } else {
          console.error("Failed to fetch player profile:", response.status);
          setApiPlayerName(userNameForApi); // Fallback on error
        }
      } catch (error) {
        console.error("Error fetching player profile:", error);
        setApiPlayerName(userNameForApi); // Fallback on error
      }
    };
    fetchPlayerProfile();
  }, [userNameForApi]);


  useEffect(() => {
    const fetchSongData = async () => {
      if (!API_TOKEN) {
        setErrorLoadingSongs("API 토큰이 설정되지 않았습니다. 곡 정보를 가져올 수 없습니다.");
        setIsLoadingSongs(false);
        setBest30SongsData([]);
        setNew20SongsData([]);
        return;
      }

      const userNameParam = userNameForApi ? `&user_name=${encodeURIComponent(userNameForApi)}` : "";
      if (!userNameParam && !searchParams.get("user_id")) { // user_name과 user_id 둘 다 없으면
        setErrorLoadingSongs("사용자 정보(닉네임 또는 ID)가 없어 곡 정보를 가져올 수 없습니다.");
        setIsLoadingSongs(false);
        setBest30SongsData([]);
        setNew20SongsData([]);
        return;
      }

      try {
        setIsLoadingSongs(true);
        setErrorLoadingSongs(null);

        const response = await fetch(
          `https://api.chunirec.net/2.0/records/rating_data.json?region=jp2${userNameParam}&token=${API_TOKEN}`
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          let errorMessage = `곡 정보를 가져오는 데 실패했습니다. (상태: ${response.status})`;
          if (errorData && errorData.error && errorData.error.message) {
            errorMessage += `: ${errorData.error.message}`;
          }
          if (response.status === 404) {
            errorMessage = `사용자 '${userNameForApi || '정보 없음'}'의 레이팅 데이터를 찾을 수 없습니다. Chunirec에 데이터가 등록되어 있는지 확인해주세요.`;
          } else if (response.status === 403 && errorData.error?.code === 403) { // 구체적인 403 에러 코드 확인
             errorMessage = `사용자 '${userNameForApi || '정보 없음'}'의 데이터에 접근할 권한이 없습니다. 비공개 사용자이거나 친구가 아닐 수 있습니다. (오류 코드: ${errorData.error.code})`;
          } else if (response.status === 403) { // 일반적인 403 에러
            errorMessage = `API 접근 권한 오류입니다. 토큰이 유효한지 확인해주세요. (상태: ${response.status})`;
          }
          throw new Error(errorMessage);
        }

        const data = await response.json();
        // console.log('Chunirec rating_data.json API Response:', data);


        const bestEntries = data.best?.entries?.filter((e: any) => e !== null).map(mapApiSongToAppSong) || [];
        setBest30SongsData(sortSongs(bestEntries));

        // New 20 (Recent 10) 데이터는 현재 API 연동하지 않음
        // const recentEntries = data.recent?.entries?.filter((e: any) => e !== null).map(mapApiSongToAppSong) || [];
        // setNew20SongsData(sortSongs(recentEntries));
        setNew20SongsData([]);


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
  }, [searchParams, userNameForApi]);

  const best30GridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
  const new20GridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4"; // 20곡일 경우 컬럼 수 (현재는 10곡만)

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
                <p className="text-sm text-muted-foreground mt-2">입력한 닉네임이 정확한지, Chunirec에 데이터가 공개되어 있는지 확인해주세요.</p>
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
                          <SongCard key={`best30-${song.id}`} song={song} />
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
                        new20GridCols // 20곡 기준 컬럼 수
                      )}>
                        {new20SongsData.map((song) => (
                          <SongCard key={`new20-${song.id}`} song={song} />
                        ))}
                      </div>
                     ) : (
                       <p className="text-muted-foreground">New 20 곡 데이터가 없습니다. (API 연동 확인 중)</p>
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
                            <SongCard key={`combo-best30-${song.id}`} song={song} />
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
                           combinedNew20GridCols // 20곡 기준 컬럼 수
                        )}>
                          {new20SongsData.map((song) => (
                            <SongCard key={`combo-new20-${song.id}`} song={song} />
                          ))}
                        </div>
                       ) : (
                          <p className="text-muted-foreground">New 20 곡 데이터가 없습니다. (API 연동 확인 중)</p>
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

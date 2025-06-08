
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { ArrowLeft, Loader2, AlertTriangle, Send, Search as SearchIcon, BarChartHorizontal } from "lucide-react";
import { LOCAL_STORAGE_PREFIX } from "@/lib/cache";
import NewSongsData from '@/data/NewSongs.json';
import type { ShowallApiSongEntry, Song } from "@/app/result/page"; // Import types

const DEVELOPER_MODE_KEY = `${LOCAL_STORAGE_PREFIX}isDeveloperMode`;
const NEW_20_DEBUG_COUNT = 20;

type ApiEndpoint = 
  | "/2.0/records/profile.json"
  | "/2.0/records/rating_data.json"
  | "/2.0/records/showall.json"
  | "/2.0/records/course.json"
  | "/2.0/music/showall.json";

interface UserApiTestState {
  loading: boolean;
  error: string | null;
  data: any | null;
  nickname: string;
  rateLimitLimit: string | null;
  rateLimitRemaining: string | null;
  rateLimitReset: string | null;
  searchTerm: string;
}

interface GlobalApiTestState {
  loading: boolean;
  error: string | null;
  data: any | null;
  rateLimitLimit: string | null;
  rateLimitRemaining: string | null;
  rateLimitReset: string | null;
  searchTerm: string;
}

interface New20DebugState {
  nickname: string;
  isLoadingGlobalMusic: boolean;
  isLoadingUserRecords: boolean;
  globalMusic: ShowallApiSongEntry[] | null;
  userRecords: ShowallApiSongEntry[] | null;
  definedNewSongPool: ShowallApiSongEntry[] | null;
  playedNewSongs: Song[] | null;
  top20Result: Song[] | null;
  step1Output: string; // Titles from NewSongs.json
  step2Output: string; // Defined new song pool (JSON)
  step3Output: string; // Played new songs (JSON)
  step4Output: string; // Top 20 new songs (JSON)
  error: string | null;
}

const initialUserApiTestState: UserApiTestState = {
  loading: false,
  error: null,
  data: null,
  nickname: "cocoa", 
  rateLimitLimit: null,
  rateLimitRemaining: null,
  rateLimitReset: null,
  searchTerm: "",
};

const initialGlobalApiTestState: GlobalApiTestState = {
  loading: false,
  error: null,
  data: null,
  rateLimitLimit: null,
  rateLimitRemaining: null,
  rateLimitReset: null,
  searchTerm: "",
};

const initialNew20DebugState: New20DebugState = {
  nickname: "cocoa",
  isLoadingGlobalMusic: false,
  isLoadingUserRecords: false,
  globalMusic: null,
  userRecords: null,
  definedNewSongPool: null,
  playedNewSongs: null,
  top20Result: null,
  step1Output: "NewSongs.json 로드 전",
  step2Output: "신곡 목록 정의 전",
  step3Output: "플레이한 신곡 필터링 전",
  step4Output: "상위 20곡 선정 전",
  error: null,
};

// Helper functions (copied or adapted from result/page.tsx)
const difficultyOrder: { [key: string]: number } = {
  ULT: 5, MAS: 4, EXP: 3, ADV: 2, BAS: 1,
};

const calculateChunithmSongRatingForDebug = (score: number, chartConstant: number | undefined | null): number => {
  if (typeof chartConstant !== 'number' || chartConstant <= 0) return 0;
  let ratingValue = 0;
  if (score >= 1009000) ratingValue = chartConstant + 2.15;
  else if (score >= 1007500) ratingValue = chartConstant + 2.00 + Math.min(0.14, Math.floor(Math.max(0, score - 1007500) / 100) * 0.01);
  else if (score >= 1005000) ratingValue = chartConstant + 1.50 + Math.min(0.49, Math.floor(Math.max(0, score - 1005000) / 50) * 0.01);
  else if (score >= 1000000) ratingValue = chartConstant + 1.00 + Math.min(0.49, Math.floor(Math.max(0, score - 1000000) / 100) * 0.01);
  else if (score >= 990000) ratingValue = chartConstant + 0.60 + Math.min(0.39, Math.floor(Math.max(0, score - 990000) / 250) * 0.01);
  else if (score >= 975000) ratingValue = chartConstant + 0.00 + Math.min(0.59, Math.floor(Math.max(0, score - 975000) / 250) * 0.01);
  else if (score >= 950000) ratingValue = chartConstant - 1.50;
  else if (score >= 925000) ratingValue = chartConstant - 3.00;
  else if (score >= 900000) ratingValue = chartConstant - 5.00;
  else if (score >= 800000) ratingValue = (chartConstant - 5.00) / 2.0;
  else ratingValue = 0;
  return Math.max(0, parseFloat(ratingValue.toFixed(2)));
};

const mapApiSongToAppSongForDebug = (apiSong: ShowallApiSongEntry, chartConstantOverride?: number): Omit<Song, 'targetScore' | 'targetRating'> => {
  const score = typeof apiSong.score === 'number' ? apiSong.score : 0;
  let effectiveChartConstant: number | null = null;
  if (typeof chartConstantOverride === 'number' && chartConstantOverride > 0) effectiveChartConstant = chartConstantOverride;
  else if (typeof apiSong.const === 'number' && apiSong.const > 0) effectiveChartConstant = apiSong.const;
  else if (apiSong.is_const_unknown && (typeof apiSong.level === 'string' || typeof apiSong.level === 'number')) {
    const parsedLevel = parseFloat(String(apiSong.level));
    if (!isNaN(parsedLevel) && parsedLevel > 0) effectiveChartConstant = parsedLevel;
  }
  
  const currentRating = (typeof effectiveChartConstant === 'number' && effectiveChartConstant > 0 && score > 0)
    ? calculateChunithmSongRatingForDebug(score, effectiveChartConstant)
    : (typeof apiSong.rating === 'number' ? apiSong.rating : 0);

  return {
    id: apiSong.id, diff: apiSong.diff, title: apiSong.title,
    chartConstant: effectiveChartConstant, currentScore: score, currentRating: currentRating,
  };
};

const sortSongsByRatingDescForDebug = (songs: Omit<Song, 'targetScore' | 'targetRating'>[]): Omit<Song, 'targetScore' | 'targetRating'>[] => {
  return [...songs].sort((a, b) => {
    if (b.currentRating !== a.currentRating) return b.currentRating - a.currentRating;
    if (b.currentScore !== a.currentScore) return b.currentScore - a.currentScore;
    const diffAOrder = difficultyOrder[a.diff.toUpperCase() as keyof typeof difficultyOrder] || 0;
    const diffBOrder = difficultyOrder[b.diff.toUpperCase() as keyof typeof difficultyOrder] || 0;
    return diffBOrder - diffAOrder;
  });
};


export default function ApiTestPage() {
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);
  const [clientHasMounted, setClientHasMounted] = useState(false);
  const { toast } = useToast();

  const [profileState, setProfileState] = useState<UserApiTestState>({...initialUserApiTestState});
  const [ratingDataState, setRatingDataState] = useState<UserApiTestState>({...initialUserApiTestState});
  const [userShowallState, setUserShowallState] = useState<UserApiTestState>({...initialUserApiTestState});
  const [courseState, setCourseState] = useState<UserApiTestState>({...initialUserApiTestState});
  const [globalMusicState, setGlobalMusicState] = useState<GlobalApiTestState>({...initialGlobalApiTestState});
  
  const [new20Debug, setNew20Debug] = useState<New20DebugState>(initialNew20DebugState);

  useEffect(() => {
    setClientHasMounted(true);
    if (typeof window !== 'undefined') {
      const devMode = localStorage.getItem(DEVELOPER_MODE_KEY);
      setIsDeveloperMode(devMode === 'true');
    }
  }, []);

  const fetchApiForDebug = useCallback(async (endpoint: '/2.0/music/showall.json' | '/2.0/records/showall.json', nickname?: string): Promise<ShowallApiSongEntry[] | null> => {
    const apiToken = getApiToken();
    if (!apiToken) {
      toast({ title: "API 토큰 없음", variant: "destructive" });
      setNew20Debug(prev => ({ ...prev, error: "API 토큰이 없습니다." }));
      return null;
    }
    
    let url = `https://api.chunirec.net${endpoint}?token=${apiToken}`;
    if (endpoint === '/2.0/music/showall.json') {
      url += '&region=jp2';
    } else if (endpoint === '/2.0/records/showall.json' && nickname) {
      url += `&region=jp2&user_name=${encodeURIComponent(nickname)}`;
    } else if (endpoint === '/2.0/records/showall.json' && !nickname) {
      toast({ title: "닉네임 필요", variant: "destructive" });
      setNew20Debug(prev => ({ ...prev, error: "사용자 기록을 가져오려면 닉네임이 필요합니다." }));
      return null;
    }

    try {
      const response = await fetch(url);
      const responseData = await response.json();
      if (!response.ok) {
        const errorMsg = `API 오류 (${endpoint}, 상태: ${response.status}): ${responseData.error?.message || JSON.stringify(responseData)}`;
        toast({ title: "API 호출 실패", description: errorMsg, variant: "destructive" });
        setNew20Debug(prev => ({ ...prev, error: errorMsg }));
        return null;
      }
      return responseData.records || [];
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : `알 수 없는 API 오류 (${endpoint})`;
      toast({ title: "API 호출 실패", description: errorMsg, variant: "destructive" });
      setNew20Debug(prev => ({ ...prev, error: errorMsg }));
      return null;
    }
  }, [toast]);

  const handleLoadDebugData = async () => {
    setNew20Debug(prev => ({ ...prev, isLoadingGlobalMusic: true, isLoadingUserRecords: true, error: null }));
    const globalMusicData = await fetchApiForDebug('/2.0/music/showall.json');
    const userRecordsData = await fetchApiForDebug('/2.0/records/showall.json', new20Debug.nickname);
    setNew20Debug(prev => ({
      ...prev,
      globalMusic: globalMusicData,
      userRecords: userRecordsData,
      isLoadingGlobalMusic: false,
      isLoadingUserRecords: false,
      step1Output: `Global Music: ${globalMusicData?.length ?? 0} 곡, User Records: ${userRecordsData?.length ?? 0} 곡`,
      step2Output: "신곡 목록 정의 전",
      step3Output: "플레이한 신곡 필터링 전",
      step4Output: "상위 20곡 선정 전",
    }));
  };

  const handleDefineNewSongPool = () => {
    if (!new20Debug.globalMusic) {
      toast({ title: "전역 음악 데이터 없음", description: "먼저 관련 데이터를 로드해주세요.", variant: "destructive" });
      setNew20Debug(prev => ({ ...prev, error: "전역 음악 데이터가 로드되지 않았습니다."}));
      return;
    }
    const newSongTitles = NewSongsData.titles?.verse || [];
    const pool = new20Debug.globalMusic.filter(song => newSongTitles.includes(song.title));
    setNew20Debug(prev => ({
      ...prev,
      definedNewSongPool: pool,
      step1Output: `NewSongs.json의 verse 목록에서 ${newSongTitles.length}개의 제목 로드 완료.`,
      step2Output: `정의된 신곡 풀: ${pool.length} 항목 (모든 난이도 포함)\n${JSON.stringify(pool.slice(0, 5).map(s => ({ title: s.title, id: s.id, diff: s.diff, const: s.const })), null, 2)}...\n(전체 목록은 콘솔 확인)`,
      step3Output: "플레이한 신곡 필터링 전",
      step4Output: "상위 20곡 선정 전",
      error: null,
    }));
    console.log("Defined New Song Pool (Debug):", pool);
  };

  const handleFilterPlayedNewSongs = () => {
    if (!new20Debug.definedNewSongPool || !new20Debug.userRecords) {
      toast({ title: "필요 데이터 부족", description: "신곡 풀 또는 사용자 기록이 없습니다.", variant: "destructive" });
      setNew20Debug(prev => ({ ...prev, error: "신곡 풀 또는 사용자 기록 데이터가 없습니다."}));
      return;
    }
    const userRecordsMap = new Map<string, ShowallApiSongEntry>();
    new20Debug.userRecords.forEach(record => {
      userRecordsMap.set(`${record.id}-${record.diff.toUpperCase()}`, record);
    });

    const played = new20Debug.definedNewSongPool.reduce((acc, definedSong) => {
      const userRecord = userRecordsMap.get(`${definedSong.id}-${definedSong.diff.toUpperCase()}`);
      if (userRecord && typeof userRecord.score === 'number' && userRecord.score > 0) {
        // Create a combined entry for mapping, ensuring we use the 'const' from the defined pool (global music)
        const combinedEntry: ShowallApiSongEntry = {
            ...definedSong, // Base properties from global music
            score: userRecord.score, // Score from user record
            is_played: userRecord.is_played,
            updated_at: userRecord.updated_at,
            is_clear: userRecord.is_clear,
            is_fullcombo: userRecord.is_fullcombo,
            is_alljustice: userRecord.is_alljustice,
            is_fullchain: userRecord.is_fullchain,
            // rating will be recalculated by mapApiSongToAppSongForDebug
        };
        acc.push(mapApiSongToAppSongForDebug(combinedEntry, definedSong.const ?? undefined) as Song);
      }
      return acc;
    }, [] as Song[]);
    
    setNew20Debug(prev => ({
      ...prev,
      playedNewSongs: played,
      step3Output: `플레이한 신곡: ${played.length} 곡\n${JSON.stringify(played.slice(0, 5).map(s => ({ title: s.title, score: s.currentScore, rating: s.currentRating, chart_const: s.chartConstant })), null, 2)}...\n(전체 목록은 콘솔 확인)`,
      step4Output: "상위 20곡 선정 전",
      error: null,
    }));
    console.log("Played New Songs (Debug):", played);
  };
  
  const handleGetTop20NewSongs = () => {
    if (!new20Debug.playedNewSongs) {
      toast({ title: "플레이한 신곡 데이터 없음", variant: "destructive" });
      setNew20Debug(prev => ({ ...prev, error: "플레이한 신곡 데이터가 없습니다."}));
      return;
    }
    const sorted = sortSongsByRatingDescForDebug(new20Debug.playedNewSongs);
    const top20 = sorted.slice(0, NEW_20_DEBUG_COUNT);
    setNew20Debug(prev => ({
      ...prev,
      top20Result: top20,
      step4Output: `상위 ${NEW_20_DEBUG_COUNT}곡:\n${JSON.stringify(top20.map(s => ({ title: s.title, score: s.currentScore, rating: s.currentRating, chart_const: s.chartConstant })), null, 2)}`,
      error: null,
    }));
    console.log("Top 20 New Songs (Debug):", top20);
  };


  const handleFetch = async (
    endpoint: ApiEndpoint, 
    setState: React.Dispatch<React.SetStateAction<UserApiTestState | GlobalApiTestState>>,
    nicknameFromState?: string 
  ) => {
    const apiToken = getApiToken();
    if (!apiToken) {
      toast({ title: "API 토큰 없음", description: "API를 호출하려면 토큰이 필요합니다.", variant: "destructive" });
      setState(prev => ({ ...prev, loading: false, error: "API 토큰이 없습니다." }));
      return;
    }
    
    const requiresNickname = endpoint !== "/2.0/music/showall.json";
    if (requiresNickname && (!nicknameFromState || nicknameFromState.trim() === "")) {
       toast({ title: "닉네임 필요", description: "이 엔드포인트에는 사용자 닉네임이 필요합니다.", variant: "destructive" });
       setState(prev => ({ ...prev, loading: false, error: "닉네임이 필요합니다." }));
       return;
    }

    setState(prev => ({ ...prev, loading: true, error: null, data: null, rateLimitLimit: null, rateLimitRemaining: null, rateLimitReset: null }));

    let url = `https://api.chunirec.net${endpoint}?token=${apiToken}`;
    if (requiresNickname && nicknameFromState) {
      url += `&region=jp2&user_name=${encodeURIComponent(nicknameFromState.trim())}`;
    } else if (endpoint === "/2.0/music/showall.json") {
      url += `&region=jp2`;
    }


    try {
      const response = await fetch(url);
      const responseData = await response.json().catch(() => ({ error: { message: "JSON 파싱 실패" }})); 

      const limit = response.headers.get('X-Rate-Limit-Limit');
      const remaining = response.headers.get('X-Rate-Limit-Remaining');
      const resetHeader = response.headers.get('X-Rate-Limit-Reset');
      const resetString = resetHeader ? new Date(parseInt(resetHeader) * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul'}) : null;


      if (!response.ok) {
         const errorMsg = `API 오류 (상태: ${response.status}): ${responseData.error?.message || JSON.stringify(responseData)}`;
         setState(prev => ({
          ...prev,
          loading: false,
          error: errorMsg,
          data: responseData, 
          rateLimitLimit: limit,
          rateLimitRemaining: remaining,
          rateLimitReset: resetString,
        }));
        toast({ title: `${endpoint} 호출 실패`, description: errorMsg, variant: "destructive" });
        return; 
      }

      setState(prev => ({
        ...prev,
        loading: false,
        data: responseData,
        error: null,
        rateLimitLimit: limit,
        rateLimitRemaining: remaining,
        rateLimitReset: resetString,
      }));
      toast({ title: `${endpoint} 호출 성공`, description: "데이터를 성공적으로 가져왔습니다." });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "알 수 없는 API 오류";
      setState(prev => ({ ...prev, loading: false, error: errorMessage, data: null, rateLimitLimit: null, rateLimitRemaining: null, rateLimitReset: null }));
      toast({ title: `${endpoint} 호출 실패`, description: errorMessage, variant: "destructive" });
    }
  };

  const displayFilteredData = (data: any, searchTerm: string | undefined): string => {
    if (data === null || data === undefined) return "";
    
    const originalStringifiedData = JSON.stringify(data, null, 2);
    if (!searchTerm || searchTerm.trim() === "") {
      return originalStringifiedData;
    }

    const lowerSearchTerm = searchTerm.toLowerCase();

    if (Array.isArray(data)) {
      const filteredArray = data.filter(item => 
        JSON.stringify(item).toLowerCase().includes(lowerSearchTerm)
      );
      if (filteredArray.length > 0) {
        return JSON.stringify(filteredArray, null, 2);
      }
    } else if (typeof data === 'object') {
      if (originalStringifiedData.toLowerCase().includes(lowerSearchTerm)) {
        return originalStringifiedData;
      }
    } else { 
      if (String(data).toLowerCase().includes(lowerSearchTerm)) {
        return String(data);
      }
    }
    
    return "검색 결과가 없습니다.";
  };


  if (!clientHasMounted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">페이지 로딩 중...</p>
      </div>
    );
  }

  if (!isDeveloperMode) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
        <AlertTriangle className="h-16 w-16 text-destructive mb-4" />
        <h1 className="text-2xl font-bold mb-2">접근 제한</h1>
        <p className="text-muted-foreground mb-6">이 페이지는 개발자 모드가 활성화된 경우에만 접근할 수 있습니다.</p>
        <Button asChild>
          <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" />메인 페이지로 돌아가기</Link>
        </Button>
      </div>
    );
  }
  
  const renderApiTestSection = (
    title: string,
    endpoint: ApiEndpoint,
    state: UserApiTestState | GlobalApiTestState,
    setState: React.Dispatch<React.SetStateAction<UserApiTestState | GlobalApiTestState>>,
    requiresNickname: boolean,
    supportsSearch: boolean = false
  ) => {
    const currentNickname = requiresNickname ? (state as UserApiTestState).nickname : undefined;
    
    const handleNicknameChangeForState = (value: string) => {
        if (requiresNickname) {
            (setState as React.Dispatch<React.SetStateAction<UserApiTestState>>)(prev => ({...prev, nickname: value}));
        }
    }

    const handleSearchTermChange = (value: string) => {
        setState(prev => ({...prev, searchTerm: value }));
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription><code>{endpoint}</code></CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {requiresNickname && (
            <div className="space-y-1">
              <Label htmlFor={`${endpoint}-nickname`}>사용자 닉네임 (user_name)</Label>
              <Input
                id={`${endpoint}-nickname`}
                value={currentNickname}
                onChange={(e) => handleNicknameChangeForState(e.target.value)}
                placeholder="예: cocoa"
              />
            </div>
          )}
          <Button onClick={() => handleFetch(endpoint, setState, currentNickname)} disabled={state.loading} className="w-full">
            {state.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            데이터 가져오기
          </Button>

          {supportsSearch && state.data && (
            <div className="space-y-1 pt-2">
              <Label htmlFor={`${endpoint}-search`} className="flex items-center">
                <SearchIcon className="mr-2 h-4 w-4 text-muted-foreground" /> 응답 내용 검색
              </Label>
              <Input
                id={`${endpoint}-search`}
                value={state.searchTerm}
                onChange={(e) => handleSearchTermChange(e.target.value)}
                placeholder="검색할 문자열 입력..."
              />
            </div>
          )}

          {(state.rateLimitLimit || state.rateLimitRemaining || state.rateLimitReset) && (
            <div className="mt-4 p-3 border rounded-md bg-muted/50 text-xs">
              <h4 className="font-semibold mb-1 text-sm">응답 헤더 정보:</h4>
              {state.rateLimitLimit && <p>X-Rate-Limit-Limit: {state.rateLimitLimit}</p>}
              {state.rateLimitRemaining && <p>X-Rate-Limit-Remaining: {state.rateLimitRemaining}</p>}
              {state.rateLimitReset && <p>X-Rate-Limit-Reset: {state.rateLimitReset} (Asia/Seoul)</p>}
            </div>
          )}

          {state.error && (
            <div className="mt-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              <p className="font-semibold">오류:</p>
              <pre className="whitespace-pre-wrap break-all">{state.error}</pre>
            </div>
          )}
          {state.data && (
            <div className="mt-2 space-y-1">
              <Label>응답 데이터 {state.searchTerm && `(검색어: "${state.searchTerm}")`}:</Label>
              <Textarea
                readOnly
                value={displayFilteredData(state.data, state.searchTerm)}
                className="h-64 font-mono text-xs"
                rows={15}
              />
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderNew20DebugSection = () => {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center"><BarChartHorizontal className="mr-2 h-5 w-5" /> New 20 상세 분석 도구</CardTitle>
          <CardDescription>New 20 곡 목록이 생성되는 과정을 단계별로 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1">
            <Label htmlFor="new20-debug-nickname">사용자 닉네임</Label>
            <Input
              id="new20-debug-nickname"
              value={new20Debug.nickname}
              onChange={(e) => setNew20Debug(prev => ({ ...prev, nickname: e.target.value }))}
              placeholder="예: cocoa"
            />
          </div>

          {new20Debug.error && (
             <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              <p className="font-semibold">오류:</p>
              <pre className="whitespace-pre-wrap break-all">{new20Debug.error}</pre>
            </div>
          )}

          <div className="space-y-2">
            <Button onClick={handleLoadDebugData} className="w-full" disabled={new20Debug.isLoadingGlobalMusic || new20Debug.isLoadingUserRecords}>
              {(new20Debug.isLoadingGlobalMusic || new20Debug.isLoadingUserRecords) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              1. 관련 데이터 로드 (Global Music & User Records)
            </Button>
            <Textarea readOnly value={new20Debug.step1Output || "데이터 로드 전"} className="h-20 font-mono text-xs" />
          </div>

          <div className="space-y-2">
            <Button onClick={handleDefineNewSongPool} className="w-full" disabled={!new20Debug.globalMusic}>
              2. NewSongs.json 기반 신곡 목록 정의
            </Button>
            <Textarea readOnly value={new20Debug.step2Output} className="h-32 font-mono text-xs" />
          </div>
          
          <div className="space-y-2">
            <Button onClick={handleFilterPlayedNewSongs} className="w-full" disabled={!new20Debug.definedNewSongPool || !new20Debug.userRecords}>
              3. 플레이한 신곡 필터링 및 레이팅 계산
            </Button>
            <Textarea readOnly value={new20Debug.step3Output} className="h-32 font-mono text-xs" />
          </div>

          <div className="space-y-2">
            <Button onClick={handleGetTop20NewSongs} className="w-full" disabled={!new20Debug.playedNewSongs}>
              4. 상위 {NEW_20_DEBUG_COUNT}곡 선정
            </Button>
            <Textarea readOnly value={new20Debug.step4Output} className="h-48 font-mono text-xs" />
          </div>
        </CardContent>
      </Card>
    );
  };


  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold font-headline">개발자 API 테스트</h1>
          <Button asChild variant="outline">
            <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" />메인으로</Link>
          </Button>
        </header>

        <div className="space-y-6">
          {renderApiTestSection("사용자 프로필", "/2.0/records/profile.json", profileState, setProfileState as React.Dispatch<React.SetStateAction<UserApiTestState>>, true, false)}
          {renderApiTestSection("사용자 레이팅 데이터 (Best 30 등)", "/2.0/records/rating_data.json", ratingDataState, setRatingDataState as React.Dispatch<React.SetStateAction<UserApiTestState>>, true, true)}
          {renderApiTestSection("사용자 전체 곡 기록", "/2.0/records/showall.json", userShowallState, setUserShowallState as React.Dispatch<React.SetStateAction<UserApiTestState>>, true, true)}
          {renderApiTestSection("사용자 코스 기록", "/2.0/records/course.json", courseState, setCourseState as React.Dispatch<React.SetStateAction<UserApiTestState>>, true, false)}
          {renderApiTestSection("전체 악곡 목록", "/2.0/music/showall.json", globalMusicState, setGlobalMusicState as React.Dispatch<React.SetStateAction<GlobalApiTestState>>, false, true)}
          {renderNew20DebugSection()}
        </div>
      </div>
    </main>
  );
}


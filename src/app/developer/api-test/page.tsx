
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
import { ArrowLeft, Loader2, AlertTriangle, Send, Search as SearchIcon, ListChecks, PlaySquare, Filter, Star, DatabaseZap, FileJson, Server } from "lucide-react";
import { LOCAL_STORAGE_PREFIX, getCachedData, setCachedData, GLOBAL_MUSIC_DATA_KEY, USER_DATA_CACHE_EXPIRY_MS, GLOBAL_MUSIC_CACHE_EXPIRY_MS } from "@/lib/cache";
import type { ShowallApiSongEntry as AppShowallApiSongEntry, Song as AppSongType } from "@/app/result/page"; // Renamed to avoid conflict
import NewSongsData from '@/data/NewSongs.json';

const DEVELOPER_MODE_KEY = `${LOCAL_STORAGE_PREFIX}isDeveloperMode`;

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


interface New20DebugState {
  nickname: string;
  loadingStep: string | null;
  error: string | null;

  step1NewSongTitlesRaw: string[];
  step1Output: string;

  globalMusicDataForN20: AppShowallApiSongEntry[] | null;

  step2DefinedSongPoolRaw: AppShowallApiSongEntry[] | null;
  step2Output: string;
}

const initialNew20DebugState: New20DebugState = {
  nickname: "cocoa",
  loadingStep: null,
  error: null,
  step1NewSongTitlesRaw: [],
  step1Output: "아직 실행되지 않음. (1단계: NewSongs.json 제목 & 전체 악곡 로드)",
  globalMusicDataForN20: null,
  step2DefinedSongPoolRaw: null,
  step2Output: "아직 실행되지 않음. (2단계: 전체 악곡 목록에서 신곡 정의)",
};


const findSmallestEnclosingBlockHelper = (jsonDataStr: string, term: string): string | null => {
    if (!term || term.trim() === "") return jsonDataStr;
    const lowerTerm = term.toLowerCase();

    let matchIndices: number[] = [];
    let i = -1;
    while ((i = jsonDataStr.toLowerCase().indexOf(lowerTerm, i + 1)) !== -1) {
        matchIndices.push(i);
    }

    if (matchIndices.length === 0) return `"${term}" not found.`;

    let smallestValidBlock: string | null = null;

    for (const matchIndex of matchIndices) {
        let openBraceIndex = -1;
        let openBracketIndex = -1;

        for (let startIdx = matchIndex; startIdx >= 0; startIdx--) {
            if (jsonDataStr[startIdx] === '{') {
                openBraceIndex = startIdx;
                break;
            }
            if (jsonDataStr[startIdx] === '[') {
                openBracketIndex = startIdx;
                break;
            }
        }

        const startCharIndex = Math.max(openBraceIndex, openBracketIndex);
        if (startCharIndex === -1 && jsonDataStr[0] !== '[' && jsonDataStr[0] !== '{') {
             continue;
        }

        let startParseIndex = startCharIndex !== -1 ? startCharIndex : 0;
        const startChar = jsonDataStr[startParseIndex];
        const endChar = startChar === '{' ? '}' : ']';
        let balance = 0;

        for (let endIdx = startParseIndex; endIdx < jsonDataStr.length; endIdx++) {
            if (jsonDataStr[endIdx] === startChar) balance++;
            else if (jsonDataStr[endIdx] === endChar) balance--;

            if (balance === 0) {
                const currentBlock = jsonDataStr.substring(startParseIndex, endIdx + 1);
                if (currentBlock.toLowerCase().includes(lowerTerm)) {
                    try {
                        JSON.parse(currentBlock);
                        if (!smallestValidBlock || currentBlock.length < smallestValidBlock.length) {
                            smallestValidBlock = currentBlock;
                        }
                    } catch (e) { /* ignore invalid JSON snippets */ }
                }
                break;
            }
        }
    }
    try {
        return smallestValidBlock ? JSON.stringify(JSON.parse(smallestValidBlock), null, 2) : `Could not find a valid JSON block for "${term}".`;
    } catch {
        return smallestValidBlock || `Could not find a valid JSON block for "${term}".`;
    }
};


const displayFilteredData = (
    data: any,
    searchTerm: string | undefined,
    endpoint: ApiEndpoint | "N20_DEBUG_GLOBAL" | "N20_DEBUG_USER" | "N20_DEBUG_POOL"
): { content: string; summary?: string } => {
  if (data === null || data === undefined) return { content: "" };

  const lowerSearchTerm = searchTerm?.toLowerCase().trim();
  const originalStringifiedData = JSON.stringify(data, null, 2);


  if (endpoint === "/2.0/records/rating_data.json" || endpoint === "/2.0/records/showall.json" || endpoint === "N20_DEBUG_USER" || endpoint === "N20_DEBUG_POOL") {
    const lines = originalStringifiedData.split('\n');
    const numDigits = String(lines.length).length;
    let summaryText: string | undefined = undefined;
    const matchingLineNumbers: number[] = [];

    const processedLines = lines.map((line, index) => {
      const lineNumber = index + 1;
      const displayLineNumber = `  ${String(lineNumber).padStart(numDigits, ' ')}. `;
      if (lowerSearchTerm && line.toLowerCase().includes(lowerSearchTerm)) {
        matchingLineNumbers.push(lineNumber);
        return `* ${String(lineNumber).padStart(numDigits, ' ')}. ${line}`;
      }
      return displayLineNumber + line;
    });

    const content = processedLines.join('\n');

    if (lowerSearchTerm) {
        if (matchingLineNumbers.length > 0) {
            const maxLinesToShowInSummary = 5;
            const linesToShow = matchingLineNumbers.slice(0, maxLinesToShowInSummary).join(', ');
            const remainingCount = matchingLineNumbers.length - maxLinesToShowInSummary;
            summaryText = `일치하는 라인: ${linesToShow}`;
            if (remainingCount > 0) {
                summaryText += ` (+ ${remainingCount}개 더보기)`;
            }
        } else {
            summaryText = `"${searchTerm}" 검색 결과 없음.`;
        }
    }
    return { content, summary: summaryText };
  }

  if (endpoint === "/2.0/music/showall.json" || endpoint === "N20_DEBUG_GLOBAL") {
    if (!lowerSearchTerm || lowerSearchTerm === "") {
        return { content: originalStringifiedData };
    }

    let searchResultContent: string;
    const dataToSearch = typeof data === 'string' ? JSON.parse(data) : data;

    if (Array.isArray(dataToSearch)) {
        const matchedResults: string[] = [];
        dataToSearch.forEach(item => {
            const itemStr = JSON.stringify(item, null, 2);
            if (itemStr.toLowerCase().includes(lowerSearchTerm)) {
                const smallestBlock = findSmallestEnclosingBlockHelper(itemStr, lowerSearchTerm);
                matchedResults.push(smallestBlock || itemStr);
            }
        });
        searchResultContent = matchedResults.length > 0 ? matchedResults.map(r => { try { return JSON.stringify(JSON.parse(r), null, 2); } catch { return r; }}).join('\n\n---\n\n') : `"${searchTerm}" not found.`;
    } else if (typeof dataToSearch === 'object' && dataToSearch !== null) {
        const stringifiedObject = JSON.stringify(dataToSearch, null, 2);
        if (stringifiedObject.toLowerCase().includes(lowerSearchTerm)) {
            const smallest = findSmallestEnclosingBlockHelper(stringifiedObject, lowerSearchTerm);
            searchResultContent = smallest
                ? (() => {
                    try {
                        return JSON.stringify(JSON.parse(smallest), null, 2);
                    } catch (e) {
                        return smallest; // Return smallest as is if parsing fails
                    }
                })()
                : stringifiedObject;
        } else {
            searchResultContent = `"${searchTerm}" not found.`;
        }
    } else {
        searchResultContent = originalStringifiedData;
    }
    return {
        content: searchResultContent,
        summary: `검색어 "${searchTerm}"에 대한 결과 (일치하는 최소 단위 객체):`
    };
  }

  return { content: originalStringifiedData };
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
  const [new20Debug, setNew20Debug] = useState<New20DebugState>({...initialNew20DebugState});


  useEffect(() => {
    setClientHasMounted(true);
    if (typeof window !== 'undefined') {
      const devMode = localStorage.getItem(DEVELOPER_MODE_KEY);
      setIsDeveloperMode(devMode === 'true');
    }
  }, []);


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
      let resetString = null;
      if (resetHeader) {
        const resetTimestamp = parseInt(resetHeader) * 1000;
        if (!isNaN(resetTimestamp)) {
           resetString = new Date(resetTimestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul'});
        } else {
           resetString = "Invalid Date";
        }
      }


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


  const fetchApiForDebug = async (endpoint: "/2.0/music/showall.json" | "/2.0/records/showall.json", nickname?: string): Promise<any> => {
    const apiToken = getApiToken();
    if (!apiToken) {
      throw new Error("API 토큰이 없습니다.");
    }
    let url = `https://api.chunirec.net${endpoint}?token=${apiToken}&region=jp2`;
    if (endpoint === "/2.0/records/showall.json" && nickname) {
      url += `&user_name=${encodeURIComponent(nickname)}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API 오류 (${endpoint}, 상태: ${response.status}): ${errorData.error?.message || response.statusText}`);
    }
    return response.json();
  };

  const handleLoadTitlesAndGlobalMusic = async () => {
    setNew20Debug(prev => ({ ...prev, loadingStep: "step1", error: null, step1Output: "1단계 실행 중..." }));
    try {
      const titlesFromVerse = NewSongsData.titles?.verse || [];
      const processedTitles = Array.isArray(titlesFromVerse) ? titlesFromVerse.map(t => t.trim().toLowerCase()) : [];
      const titleLoadSummary = `NewSongs.json ('verse')에서 ${processedTitles.length}개의 제목 로드 완료.\n샘플: ${processedTitles.slice(0,3).join(', ')}`;
      console.log(`[N20_DEBUG_STEP_1.1] Loaded titles from NewSongs.json:`, processedTitles);

      toast({ title: "N20 디버그 (1.2단계)", description: "전체 악곡 목록 (music/showall) 로드 중..." });
      const globalMusicApiResponse = await fetchApiForDebug("/2.0/music/showall.json");
      const globalMusicRecords = (globalMusicApiResponse.records || []).filter((e: any): e is AppShowallApiSongEntry =>
        e && e.id && e.diff && e.title && (e.release || typeof e.release === 'string') && (e.const !== undefined) && e.level !== undefined
      );
      const globalMusicSummary = `전체 악곡 목록 (music/showall) ${globalMusicRecords.length}개 로드 완료.\n샘플 ID: ${globalMusicRecords.slice(0,1).map(s => s.id).join(', ')}`;
      console.log(`[N20_DEBUG_STEP_1.2] Loaded global music records:`, globalMusicRecords.length);

      setNew20Debug(prev => ({
        ...prev,
        step1NewSongTitlesRaw: processedTitles,
        globalMusicDataForN20: globalMusicRecords,
        step1Output: `${titleLoadSummary}\n${globalMusicSummary}`,
        loadingStep: null,
      }));
      toast({ title: "N20 디버그 (1단계) 성공", description: "NewSongs.json 제목 및 전체 악곡 목록을 로드했습니다." });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "알 수 없는 오류";
      setNew20Debug(prev => ({ ...prev, error: `1단계 오류: ${errorMsg}`, loadingStep: null, step1Output: `오류: ${errorMsg}` }));
      toast({ title: "N20 디버그 (1단계) 실패", description: errorMsg, variant: "destructive" });
    }
  };

  const handleDefineNewSongPoolFromGlobalMusic = () => {
    setNew20Debug(prev => ({ ...prev, loadingStep: "step2", error: null, step2Output: "2단계 실행 중..." }));
    if (!new20Debug.globalMusicDataForN20 || new20Debug.step1NewSongTitlesRaw.length === 0) {
        const errorMsg = "1단계 데이터(전체 악곡 목록 또는 NewSongs.json 제목)가 로드되지 않았습니다. 먼저 1단계를 실행하세요.";
        setNew20Debug(prev => ({ ...prev, error: errorMsg, loadingStep: null, step2Output: `오류: ${errorMsg}` }));
        toast({ title: "N20 디버그 (2단계) 실패", description: errorMsg, variant: "destructive" });
        return;
    }

    try {
        const definedPool = new20Debug.globalMusicDataForN20.filter(globalSong => {
            if (globalSong.title) {
                const apiTitleTrimmedLower = globalSong.title.trim().toLowerCase();
                return new20Debug.step1NewSongTitlesRaw.includes(apiTitleTrimmedLower);
            }
            return false;
        });

        const summary = `정의된 신곡 풀 생성 완료. ${definedPool.length}개의 악곡(모든 난이도 포함) 발견.\n샘플: ${definedPool.slice(0, 2).map(s => `${s.title} (ID: ${s.id}, Diff: ${s.diff})`).join('; ')}`;
        console.log(`[N20_DEBUG_STEP_2] Defined new song pool:`, definedPool.length, definedPool.slice(0,3));

        setNew20Debug(prev => ({
            ...prev,
            step2DefinedSongPoolRaw: definedPool,
            step2Output: summary,
            loadingStep: null,
        }));
        toast({ title: "N20 디버그 (2단계) 성공", description: "정의된 신곡 풀을 생성했습니다." });

    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "알 수 없는 오류";
        setNew20Debug(prev => ({ ...prev, error: `2단계 오류: ${errorMsg}`, loadingStep: null, step2Output: `오류: ${errorMsg}` }));
        toast({ title: "N20 디버그 (2단계) 실패", description: errorMsg, variant: "destructive" });
    }
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

    const displayResult = state.data ? displayFilteredData(state.data, state.searchTerm, endpoint) : { content: "" };

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
              <Label>응답 데이터 {displayResult.summary && `(검색어: "${state.searchTerm}")`}:</Label>
              {displayResult.summary && (
                 <p className="text-sm text-muted-foreground mb-1 italic">{displayResult.summary}</p>
              )}
              <Textarea
                readOnly
                value={displayResult.content}
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
    const { nickname, loadingStep, error, step1Output, step2Output, globalMusicDataForN20, step2DefinedSongPoolRaw } = new20Debug;

    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-headline">New 20 상세 분석 도구</CardTitle>
          <CardDescription>New 20 곡 목록 생성 과정을 단계별로 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1">
            <Label htmlFor="n20-debug-nickname">사용자 닉네임 (user_name) - 3단계부터 사용</Label>
            <Input
              id="n20-debug-nickname"
              value={nickname}
              onChange={(e) => setNew20Debug(prev => ({ ...prev, nickname: e.target.value }))}
              placeholder="예: cocoa"
            />
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              <p className="font-semibold">오류:</p>
              <pre className="whitespace-pre-wrap break-all">{error}</pre>
            </div>
          )}

          {/* Step 1: Load Titles from NewSongs.json AND Global Music Data */}
          <div className="space-y-2 p-4 border rounded-md shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-lg flex items-center"><FileJson className="mr-2 h-5 w-5 text-primary" />1단계: NewSongs.json 제목 &amp; 전체 악곡 목록 로드</h3>
              <Button onClick={handleLoadTitlesAndGlobalMusic} disabled={loadingStep === "step1"} size="sm">
                {loadingStep === "step1" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                실행 (1단계)
              </Button>
            </div>
            <Textarea
              readOnly
              value={step1Output}
              className="h-32 font-mono text-xs bg-muted/30"
              rows={4}
              placeholder="1단계 결과 요약 (NewSongs.json 제목 로드, 전체 악곡 목록 로드)"
            />
            {globalMusicDataForN20 && (
                <details className="mt-2">
                    <summary className="text-sm cursor-pointer hover:underline">로드된 전체 악곡 목록 데이터 보기 (처음 5개)</summary>
                    <Textarea readOnly value={displayFilteredData(globalMusicDataForN20.slice(0,5), undefined, "N20_DEBUG_GLOBAL").content} className="h-40 font-mono text-xs mt-1" />
                </details>
            )}
          </div>

          {/* Step 2: Define New Song Pool from Global Music Data */}
          <div className="space-y-2 p-4 border rounded-md shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-lg flex items-center"><Server className="mr-2 h-5 w-5 text-primary" />2단계: 전체 악곡 목록에서 신곡 정의</h3>
              <Button onClick={handleDefineNewSongPoolFromGlobalMusic} disabled={loadingStep === "step2" || !globalMusicDataForN20 || new20Debug.step1NewSongTitlesRaw.length === 0} size="sm">
                {loadingStep === "step2" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                실행 (2단계)
              </Button>
            </div>
            <Textarea
              readOnly
              value={step2Output}
              className="h-32 font-mono text-xs bg-muted/30"
              rows={4}
              placeholder="2단계 결과 요약 (NewSongs.json 제목과 일치하는 전체 악곡 목록 필터링)"
            />
             {step2DefinedSongPoolRaw && (
                <details className="mt-2">
                    <summary className="text-sm cursor-pointer hover:underline">정의된 신곡 풀 데이터 보기 (처음 5개)</summary>
                    <Textarea readOnly value={displayFilteredData(step2DefinedSongPoolRaw.slice(0,5), undefined, "N20_DEBUG_POOL").content} className="h-40 font-mono text-xs mt-1" />
                </details>
            )}
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
          {isDeveloperMode && renderNew20DebugSection()}
        </div>
      </div>
    </main>
  );
}

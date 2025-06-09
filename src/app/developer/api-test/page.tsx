
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
import { ArrowLeft, Loader2, AlertTriangle, Send, Search as SearchIcon, ListChecks, PlaySquare, Filter, Star } from "lucide-react";
import { LOCAL_STORAGE_PREFIX } from "@/lib/cache";
import type { ShowallApiSongEntry, Song as AppSongType } from "@/app/result/page"; // For N20 debug
import NewSongsData from '@/data/NewSongs.json'; // For N20 debug

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

// N20 Debug State
interface New20DebugState {
  nickname: string;
  loadingStep: string | null; // e.g., "step1", "step2"
  error: string | null;
  
  step1NewSongTitlesRaw: string[]; // Titles from NewSongs.json
  step1Output: string; // Summary of loaded titles

  // Store data for subsequent steps (will be added later)
  // globalMusicDataForN20: ShowallApiSongEntry[] | null;
  // userRecordsForN20: ShowallApiSongEntry[] | null;
  // definedNewSongPoolForN20: ShowallApiSongEntry[] | null;
  // playedNewSongsForN20: AppSongType[] | null;
  // top20NewSongsForN20: AppSongType[] | null;

  // step2Output: string; // For global music data
  // step3Output: string; // For user records data
  // step4Output: string; // For defined new song pool
  // step5Output: string; // For played new songs
  // step6Output: string; // For top 20 new songs
}

const initialNew20DebugState: New20DebugState = {
  nickname: "cocoa",
  loadingStep: null,
  error: null,
  step1NewSongTitlesRaw: [],
  step1Output: "아직 실행되지 않음.",
  // globalMusicDataForN20: null,
  // userRecordsForN20: null,
  // definedNewSongPoolForN20: null,
  // playedNewSongsForN20: null,
  // top20NewSongsForN20: null,
  // step2Output: "아직 실행되지 않음.",
  // step3Output: "아직 실행되지 않음.",
  // step4Output: "아직 실행되지 않음.",
  // step5Output: "아직 실행되지 않음.",
  // step6Output: "아직 실행되지 않음.",
};


// Helper for smallest enclosing block
const findSmallestEnclosingBlockHelper = (jsonDataStr: string, term: string): string | null => {
    const lowerTerm = term.toLowerCase();
    
    let matchIndices: number[] = [];
    let i = -1;
    while ((i = jsonDataStr.toLowerCase().indexOf(lowerTerm, i + 1)) !== -1) {
        matchIndices.push(i);
    }

    if (matchIndices.length === 0) return null;

    let smallestValidBlock: string | null = null;

    for (const matchIndex of matchIndices) {
        for (let startIdx = matchIndex; startIdx >= 0; startIdx--) {
            if (jsonDataStr[startIdx] === '{' || jsonDataStr[startIdx] === '[') {
                const startChar = jsonDataStr[startIdx];
                const endChar = startChar === '{' ? '}' : ']';
                let balance = 0;
                for (let endIdx = startIdx; endIdx < jsonDataStr.length; endIdx++) {
                    if (jsonDataStr[endIdx] === startChar) balance++;
                    else if (jsonDataStr[endIdx] === endChar) balance--;

                    if (balance === 0) { 
                        const currentBlock = jsonDataStr.substring(startIdx, endIdx + 1);
                        if (currentBlock.toLowerCase().includes(lowerTerm)) {
                            try {
                                JSON.parse(currentBlock); 
                                if (!smallestValidBlock || currentBlock.length < smallestValidBlock.length) {
                                    smallestValidBlock = currentBlock;
                                }
                            } catch (e) { /* ignore */ }
                        }
                        break; 
                    }
                }
            }
        }
    }
    return smallestValidBlock;
};


const displayFilteredData = (
    data: any, 
    searchTerm: string | undefined, 
    endpoint: ApiEndpoint | "N20_DEBUG" // Added N20_DEBUG type
): { content: string; summary?: string } => {
  if (data === null || data === undefined) return { content: "" };
  
  const lowerSearchTerm = searchTerm?.toLowerCase().trim();
  // Ensure data is stringified for N20_DEBUG as well if it's not already a string.
  // For other endpoints, it's typically an object/array.
  const originalStringifiedData = typeof data === 'string' && endpoint === "N20_DEBUG" ? data : JSON.stringify(data, null, 2);


  if (endpoint === "/2.0/records/rating_data.json" || endpoint === "/2.0/records/showall.json") {
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

  if (endpoint === "/2.0/music/showall.json") {
    if (!lowerSearchTerm || lowerSearchTerm === "") {
        return { content: originalStringifiedData };
    }

    let searchResultContent: string;
    const dataToSearch = typeof data === 'string' ? JSON.parse(data) : data; // Parse if string

    if (Array.isArray(dataToSearch)) {
        const matchedResults: string[] = [];
        dataToSearch.forEach(item => {
            const itemStr = JSON.stringify(item, null, 2);
            if (itemStr.toLowerCase().includes(lowerSearchTerm)) {
                const smallestBlock = findSmallestEnclosingBlockHelper(itemStr, lowerSearchTerm);
                matchedResults.push(smallestBlock || itemStr); 
            }
        });
        searchResultContent = matchedResults.length > 0 ? matchedResults.map(r => JSON.stringify(JSON.parse(r), null, 2)).join('\n\n---\n\n') : `"${searchTerm}" not found.`;

    } else if (typeof dataToSearch === 'object' && dataToSearch !== null) { 
        const stringifiedObject = JSON.stringify(dataToSearch, null, 2);
        if (stringifiedObject.toLowerCase().includes(lowerSearchTerm)) {
            const smallest = findSmallestEnclosingBlockHelper(stringifiedObject, lowerSearchTerm);
            searchResultContent = smallest ? JSON.stringify(JSON.parse(smallest),null,2) : stringifiedObject;
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


  // --- N20 Debug Functions ---
  const handleLoadTitlesFromNewSongsJson = () => {
    setNew20Debug(prev => ({ ...prev, loadingStep: "step1", error: null }));
    try {
      const titlesFromVerse = NewSongsData.titles?.verse || [];
      const processedTitles = titlesFromVerse.map(t => t.trim().toLowerCase());
      
      const outputSummary = `NewSongs.json ('verse')에서 ${processedTitles.length}개의 제목 로드 완료.\n샘플: ${processedTitles.slice(0,5).join(', ')}`;
      console.log(`[N20_DEBUG_STEP_1] Loaded titles from NewSongs.json:`, processedTitles);

      setNew20Debug(prev => ({
        ...prev,
        step1NewSongTitlesRaw: processedTitles,
        step1Output: outputSummary,
        loadingStep: null,
      }));
      toast({ title: "N20 디버그 (1단계) 성공", description: "NewSongs.json에서 제목을 로드했습니다." });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "알 수 없는 오류";
      setNew20Debug(prev => ({ ...prev, error: `1단계 오류: ${errorMsg}`, loadingStep: null }));
      toast({ title: "N20 디버그 (1단계) 실패", description: errorMsg, variant: "destructive" });
    }
  };
  // --- End N20 Debug Functions ---


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
              <Label>응답 데이터 {state.searchTerm && `(검색어: "${state.searchTerm}")`}:</Label>
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
    const { nickname, loadingStep, error, step1Output } = new20Debug;
    // const step2Result = displayFilteredData(new20Debug.step2Output, undefined, "N20_DEBUG");
    // Add more displayResult calls for other steps as they get implemented

    return (
      <Card>
        <CardHeader>
          <CardTitle>New 20 상세 분석 도구</CardTitle>
          <CardDescription>New 20 곡 목록 생성 과정을 단계별로 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1">
            <Label htmlFor="n20-debug-nickname">사용자 닉네임 (user_name)</Label>
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

          {/* Step 1: Load Titles from NewSongs.json */}
          <div className="space-y-2 p-3 border rounded-md">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold flex items-center"><ListChecks className="mr-2 h-5 w-5 text-primary" />1단계: NewSongs.json 제목 로드</h3>
              <Button onClick={handleLoadTitlesFromNewSongsJson} disabled={loadingStep === "step1"} size="sm">
                {loadingStep === "step1" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                실행
              </Button>
            </div>
            <Textarea
              readOnly
              value={step1Output}
              className="h-24 font-mono text-xs"
              rows={3}
              placeholder="1단계 결과가 여기에 표시됩니다."
            />
          </div>
          
          {/* Future steps will be added here */}
          {/* Example for a future step (placeholder) */}
          {/*
          <div className="space-y-2 p-3 border rounded-md">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold flex items-center"><ListChecks className="mr-2 h-5 w-5 text-primary" />2단계: 전역 악곡 목록 로드</h3>
              <Button onClick={() => {}} disabled={loadingStep === "step2"} size="sm">
                {loadingStep === "step2" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                실행
              </Button>
            </div>
            <Textarea readOnly value={"아직 구현되지 않음"} className="h-24 font-mono text-xs" />
          </div>
          */}

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


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
import { ArrowLeft, Loader2, AlertTriangle, Send, Search as SearchIcon, ListChecks, PlaySquare, Filter, Star, DatabaseZap, FileJson, Server, CalendarDays, FilterIcon, FileSearch } from "lucide-react";
import { LOCAL_STORAGE_PREFIX } from "@/lib/cache";
import type { ShowallApiSongEntry as AppShowallApiSongEntry, Song as AppSongType } from "@/app/result/page"; 
import NewSongsData from '@/data/NewSongs.json';
import { 
    findSmallestEnclosingBlockHelper, 
    displayFilteredData, 
    fetchApiForDebug,
    type ApiEndpointString as ApiHelperEndpointString, // Renamed to avoid conflict if ApiEndpoint is also defined here
    type DisplayFilteredDataEndpointType 
} from "@/lib/api-test-helpers";


const DEVELOPER_MODE_KEY = `${LOCAL_STORAGE_PREFIX}isDeveloperMode`;

// This type is used by the handleFetch function, specific to this page's main API test sections
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
  step1Output: "1-1단계: NewSongs.json 제목 로드 실행 대기 중.\n1-2단계: 전체 악곡 목록 로드 실행 대기 중.",
  globalMusicDataForN20: null,
  step2DefinedSongPoolRaw: null,
  step2Output: "2단계: 전체 악곡 목록에서 신곡 정의 실행 대기 중. (1-1, 1-2단계 선행 필요)",
};

interface ReleaseFilterTestState {
    loading: boolean;
    error: string | null;
    rawData: AppShowallApiSongEntry[] | null;
    filteredData: AppShowallApiSongEntry[] | null;
    summary: string;
}

const initialReleaseFilterTestState: ReleaseFilterTestState = {
    loading: false,
    error: null,
    rawData: null,
    filteredData: null,
    summary: "전체 악곡 목록 로드 및 필터링 실행 대기 중.",
};

interface SongByIdFetcherState {
    songIdToFetch: string;
    fetchedSongData: AppShowallApiSongEntry | null; 
    rawMusicShowallRecords: AppShowallApiSongEntry[] | string | null; // Can be array or string (for malformed response)
    loading: boolean;
    error: string | null;
    outputSummary: string;
}

const initialSongByIdFetcherState: SongByIdFetcherState = {
    songIdToFetch: "",
    fetchedSongData: null,
    rawMusicShowallRecords: null,
    loading: false,
    error: null,
    outputSummary: "조회할 악곡 ID를 입력하세요.",
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
  const [releaseFilterTest, setReleaseFilterTest] = useState<ReleaseFilterTestState>({...initialReleaseFilterTestState});
  const [songByIdFetcher, setSongByIdFetcher] = useState<SongByIdFetcherState>({...initialSongByIdFetcherState});


  useEffect(() => {
    setClientHasMounted(true);
    if (typeof window !== 'undefined') {
      const devMode = localStorage.getItem(DEVELOPER_MODE_KEY);
      setIsDeveloperMode(devMode === 'true');
    }
  }, []);


  const handleFetch = async (
    endpoint: ApiEndpoint, // Uses the page-specific ApiEndpoint type
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
      const errorMessage = String(err);
      setState(prev => ({ ...prev, loading: false, error: errorMessage, data: null, rateLimitLimit: null, rateLimitRemaining: null, rateLimitReset: null }));
      toast({ title: `${endpoint} 호출 실패`, description: errorMessage, variant: "destructive" });
    }
  };


  const handleLoadTitlesFromNewSongsJson = () => {
    setNew20Debug(prev => ({ 
      ...initialNew20DebugState, 
      nickname: prev.nickname, 
      loadingStep: "step1a", 
      error: null, 
      step1Output: "1-1단계 실행 중...", 
      globalMusicDataForN20: null, // Reset subsequent step data
      step2DefinedSongPoolRaw: null,
      step2Output: initialNew20DebugState.step2Output
    }));
    try {
        const titlesFromVerse = NewSongsData.titles?.verse || [];
        const processedTitles = Array.isArray(titlesFromVerse) ? titlesFromVerse.map(t => t.trim().toLowerCase()) : [];
        const titleLoadSummary = `1-1단계: NewSongs.json ('verse')에서 ${processedTitles.length}개의 제목 로드 완료.\n샘플: ${processedTitles.slice(0,3).join(', ')}`;
        console.log(`[N20_DEBUG_STEP_1.1] Loaded titles from NewSongs.json:`, processedTitles);

        setNew20Debug(prev => ({
            ...prev,
            step1NewSongTitlesRaw: processedTitles,
            step1Output: titleLoadSummary + "\n" + (initialNew20DebugState.step1Output.split('\n').slice(1).join('\n')), 
            loadingStep: null,
        }));
        toast({ title: "N20 디버그 (1-1단계) 성공", description: "NewSongs.json 제목을 로드했습니다." });
    } catch (e) {
        const errorMsg = String(e);
        setNew20Debug(prev => ({ ...prev, error: `1-1단계 오류: ${errorMsg}`, loadingStep: null, step1Output: `1-1단계 오류: ${errorMsg}` }));
        toast({ title: "N20 디버그 (1-1단계) 실패", description: errorMsg, variant: "destructive" });
    }
  };

  const handleLoadGlobalMusicForN20 = async () => {
    setNew20Debug(prev => ({ 
        ...prev, 
        loadingStep: "step1b", 
        error: null, 
        step1Output: (prev.step1Output.split('\n')[0] || "1-1단계 결과 없음.") + "\n1-2단계: 전체 악곡 목록 로드 중...",
        globalMusicDataForN20: null, 
        step2DefinedSongPoolRaw: null, 
        step2Output: initialNew20DebugState.step2Output 
    }));

    try {
        toast({ title: "N20 디버그 (1-2단계)", description: "전체 악곡 목록 (music/showall) 로드 중..." });
        const globalMusicApiResponse = await fetchApiForDebug("/2.0/music/showall.json");
        
        console.log("[N20_DEBUG_STEP_1.2_RAW_RESPONSE] Raw API response for music/showall:", globalMusicApiResponse);

        let rawApiRecords: any[] = []; // This will hold the array of {meta, data} objects
        let responseIssueMessage = "";

        if (Array.isArray(globalMusicApiResponse)) {
            rawApiRecords = globalMusicApiResponse;
            console.log(`[N20_DEBUG_STEP_1.2_INFO] API response is a direct array. Count: ${rawApiRecords.length}.`);
        } else if (globalMusicApiResponse && typeof globalMusicApiResponse === 'object' && globalMusicApiResponse.records !== undefined) {
            // This case might not be hit if the API truly sends a direct array, but kept for robustness
            if (Array.isArray(globalMusicApiResponse.records)) {
                rawApiRecords = globalMusicApiResponse.records;
                console.log(`[N20_DEBUG_STEP_1.2_INFO] API response is an object with a 'records' array. Count: ${rawApiRecords.length}.`);
            } else {
                responseIssueMessage = "API 응답에 'records' 필드가 있지만 배열이 아닙니다. 콘솔에서 '[N20_DEBUG_STEP_1.2_RAW_RESPONSE]' 로그를 확인하세요.";
                console.warn(`[N20_DEBUG_STEP_1.2_WARN] 'globalMusicApiResponse.records' is not an array. Type: ${typeof globalMusicApiResponse.records}`);
            }
        } else {
            responseIssueMessage = "API 응답이 없거나, 객체 형식이 아니거나, 'records' 필드를 포함하지 않습니다 (또는 직접 배열이 아님). 콘솔에서 '[N20_DEBUG_STEP_1.2_RAW_RESPONSE]' 로그를 확인하세요.";
            console.warn(`[N20_DEBUG_STEP_1.2_WARN] 'globalMusicApiResponse' is not a direct array or an object with a 'records' array. Response:`, globalMusicApiResponse);
        }
        
        console.log(`[N20_DEBUG_STEP_1.2_RAW_RECORDS_FROM_API] Extracted records from API response. Count: ${rawApiRecords.length}. Sample:`, rawApiRecords.slice(0, 2));

        // --- Transformation (Flattening) Step ---
        const flattenedMusicEntries: AppShowallApiSongEntry[] = [];
        if (Array.isArray(rawApiRecords)) {
            rawApiRecords.forEach(rawEntry => {
                if (rawEntry && rawEntry.meta && rawEntry.data && typeof rawEntry.data === 'object') {
                    const meta = rawEntry.meta;
                    const difficulties = rawEntry.data;
                    for (const diffKey in difficulties) {
                        if (Object.prototype.hasOwnProperty.call(difficulties, diffKey)) {
                            const diffData = difficulties[diffKey];
                            if (diffData && meta.id && meta.title) { // Ensure basic meta fields exist
                                flattenedMusicEntries.push({
                                    id: String(meta.id),
                                    title: String(meta.title),
                                    genre: String(meta.genre || "N/A"),
                                    release: String(meta.release || ""),
                                    diff: diffKey.toUpperCase(), // BAS, MAS, EXP etc.
                                    level: String(diffData.level || "N/A"),
                                    const: (typeof diffData.const === 'number' || diffData.const === null) ? diffData.const : parseFloat(String(diffData.const)), // Attempt to parse if not number/null
                                    // Add other AppShowallApiSongEntry fields if available in diffData or meta
                                    score: undefined, // Not available in music/showall directly for user plays
                                    rating: undefined,
                                    is_played: undefined,
                                    is_const_unknown: diffData.is_const_unknown === true,
                                });
                            }
                        }
                    }
                }
            });
        }
        console.log(`[N20_DEBUG_STEP_1.2_FLATTENED] Flattened music entries. Count: ${flattenedMusicEntries.length}. Sample:`, flattenedMusicEntries.slice(0,2));
        // --- End of Transformation ---


        const globalMusicRecords = flattenedMusicEntries.filter((e: AppShowallApiSongEntry, index: number): e is AppShowallApiSongEntry => {
            const isValid = e && 
                            typeof e.id === 'string' && e.id.trim() !== '' &&
                            typeof e.diff === 'string' && e.diff.trim() !== '' &&
                            typeof e.title === 'string' && e.title.trim() !== '' &&
                            (typeof e.release === 'string') && // release can be empty string from flattening
                            (e.const !== undefined) && // const can be number or null
                            e.level !== undefined && String(e.level).trim() !== '';
            if (!isValid && flattenedMusicEntries.length > 0 && index < 5) { // Log issues for first 5 *flattened* entries
                console.log(`[N20_DEBUG_FILTER_ISSUE_ON_FLATTENED] Record at index ${index} from flattenedMusicEntries filtered out. Details:`, {
                    hasE: !!e,
                    isIdStringAndNotEmpty: typeof e?.id === 'string' && e.id.trim() !== '',
                    isDiffStringAndNotEmpty: typeof e?.diff === 'string' && e.diff.trim() !== '',
                    isTitleStringAndNotEmpty: typeof e?.title === 'string' && e.title.trim() !== '',
                    releaseIsString: typeof e?.release === 'string',
                    constExists: e?.const !== undefined,
                    levelExistsAndNotEmpty: e?.level !== undefined && String(e.level).trim() !== '',
                    record: e
                });
            }
            return isValid;
        });
        console.log(`[N20_DEBUG_STEP_1.2_FILTERED_RECORDS] Filtered global music records (after flattening & filtering). Count: ${globalMusicRecords.length}. Sample:`, globalMusicRecords.slice(0,2));
        
        let globalMusicSummary = `API에서 ${rawApiRecords.length}개 원본 레코드 수신. ${flattenedMusicEntries.length}개로 평탄화. 필터링 후 ${globalMusicRecords.length}개 유효.`;
        if (responseIssueMessage) {
            globalMusicSummary = responseIssueMessage + ` (API에서 ${rawApiRecords.length}개 수신, ${flattenedMusicEntries.length}개로 평탄화, 필터링 후 ${globalMusicRecords.length}개 유효.)`;
        } else if (rawApiRecords.length > 0 && globalMusicRecords.length === 0) {
            globalMusicSummary += " [주의] API에서 레코드를 수신하고 평탄화했으나, 필터 조건에 맞는 유효한 악곡 데이터가 없습니다. 콘솔에서 '[N20_DEBUG_FILTER_ISSUE_ON_FLATTENED]' 로그를 확인하세요.";
        }
        
        const firstSongSample = globalMusicRecords.length > 0 ? `ID: ${globalMusicRecords[0].id}, 제목: ${globalMusicRecords[0].title}, 난이도: ${globalMusicRecords[0].diff}, 출시: ${globalMusicRecords[0].release}` : "유효한 데이터 없음";
        globalMusicSummary += `\n샘플 악곡 (필터링된 첫 번째): ${firstSongSample}`;

        setNew20Debug(prev => ({
            ...prev,
            globalMusicDataForN20: globalMusicRecords,
            step1Output: (prev.step1Output.split('\n')[0] || "1-1단계 결과 없음.") + `\n1-2단계: ${globalMusicSummary}`,
            loadingStep: null,
        }));
        toast({ title: "N20 디버그 (1-2단계) 완료", description: `전체 악곡 목록 처리: ${globalMusicSummary.split('\n')[0]}` });

    } catch (e) {
        const errorMsg = String(e); 
        console.error("[N20_DEBUG_STEP_1.2_ERROR] Error in handleLoadGlobalMusicForN20:", e);
        setNew20Debug(prev => ({ ...prev, error: `1-2단계 오류: ${errorMsg}`, loadingStep: null, step1Output: (prev.step1Output.split('\n')[0] || "1-1단계 결과 없음.") + `\n1-2단계 오류: ${errorMsg}` }));
        toast({ title: "N20 디버그 (1-2단계) 실패", description: errorMsg, variant: "destructive" });
    }
  };


  const handleDefineNewSongPoolFromGlobalMusic = () => {
    setNew20Debug(prev => ({ ...prev, loadingStep: "step2", error: null, step2Output: "2단계 실행 중..." }));
    if (!new20Debug.globalMusicDataForN20 || new20Debug.step1NewSongTitlesRaw.length === 0) {
        const errorMsg = "1-1단계 (NewSongs.json 제목) 또는 1-2단계 (전체 악곡 목록) 데이터가 로드되지 않았습니다. 먼저 해당 단계를 실행하세요.";
        setNew20Debug(prev => ({ ...prev, error: errorMsg, loadingStep: null, step2Output: `오류: ${errorMsg}` }));
        toast({ title: "N20 디버그 (2단계) 실패", description: errorMsg, variant: "destructive" });
        return;
    }

    try {
        console.log("[N20_DEBUG_STEP_2_INPUT] Titles to match (from NewSongs.json):", new20Debug.step1NewSongTitlesRaw.length, new20Debug.step1NewSongTitlesRaw.slice(0,3));
        console.log("[N20_DEBUG_STEP_2_INPUT] Global music data to filter from (flattened & filtered):", new20Debug.globalMusicDataForN20.length, new20Debug.globalMusicDataForN20.slice(0,1).map(s => s.title));

        const definedPool = new20Debug.globalMusicDataForN20.filter(globalSong => {
            if (globalSong.title) {
                const apiTitleTrimmedLower = globalSong.title.trim().toLowerCase();
                const isIncluded = new20Debug.step1NewSongTitlesRaw.includes(apiTitleTrimmedLower);
                return isIncluded;
            }
            return false;
        });

        const summary = `정의된 신곡 풀 생성 완료. ${definedPool.length}개의 악곡(모든 난이도 포함) 발견.\n샘플: ${definedPool.slice(0, 2).map(s => `${s.title} (ID: ${s.id}, Diff: ${s.diff})`).join('; ')}`;
        console.log(`[N20_DEBUG_STEP_2_RESULT] Defined new song pool. Count: ${definedPool.length}. Sample:`, definedPool.slice(0,3).map(s => ({id:s.id, title:s.title, diff:s.diff})));

        setNew20Debug(prev => ({
            ...prev,
            step2DefinedSongPoolRaw: definedPool,
            step2Output: summary,
            loadingStep: null,
        }));
        toast({ title: "N20 디버그 (2단계) 성공", description: "정의된 신곡 풀을 생성했습니다." });

    } catch (e) {
        const errorMsg = String(e);
        console.error("[N20_DEBUG_STEP_2_ERROR] Error in handleDefineNewSongPoolFromGlobalMusic:", e);
        setNew20Debug(prev => ({ ...prev, error: `2단계 오류: ${errorMsg}`, loadingStep: null, step2Output: `오류: ${errorMsg}` }));
        toast({ title: "N20 디버그 (2단계) 실패", description: errorMsg, variant: "destructive" });
    }
  };

  const handleFetchAndFilterByReleaseDate = async () => {
    setReleaseFilterTest(prev => ({ ...prev, loading: true, error: null, summary: "전체 악곡 목록 로드 중..." }));
    try {
      const globalMusicApiResponse = await fetchApiForDebug("/2.0/music/showall.json"); 
      
      let rawApiRecords: any[] = [];
      if (Array.isArray(globalMusicApiResponse)) {
        rawApiRecords = globalMusicApiResponse;
      } else if (globalMusicApiResponse && Array.isArray(globalMusicApiResponse.records)) {
        rawApiRecords = globalMusicApiResponse.records; // Fallback, though direct array is expected now
      } else {
        console.warn("[ReleaseFilter] music/showall.json did not return a direct array or an object with a 'records' array. Response:", globalMusicApiResponse);
      }

      const flattenedMusicEntries: AppShowallApiSongEntry[] = [];
      rawApiRecords.forEach(rawEntry => {
          if (rawEntry && rawEntry.meta && rawEntry.data && typeof rawEntry.data === 'object') {
              const meta = rawEntry.meta;
              const difficulties = rawEntry.data;
              for (const diffKey in difficulties) {
                  if (Object.prototype.hasOwnProperty.call(difficulties, diffKey)) {
                      const diffData = difficulties[diffKey];
                      if (diffData && meta.id && meta.title) {
                          flattenedMusicEntries.push({
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
      
      const allMusicRecords = flattenedMusicEntries.filter((e: AppShowallApiSongEntry): e is AppShowallApiSongEntry =>
        e && 
        typeof e.id === 'string' && e.id.trim() !== '' &&
        typeof e.diff === 'string' && e.diff.trim() !== '' &&
        typeof e.title === 'string' && e.title.trim() !== '' &&
        typeof e.release === 'string' && e.release.match(/^\d{4}-\d{2}-\d{2}$/) && // Ensure release is valid date format
        (e.const !== undefined) && 
        e.level !== undefined && String(e.level).trim() !== ''
      );
      setReleaseFilterTest(prev => ({ ...prev, rawData: allMusicRecords, summary: `${allMusicRecords.length}개의 전체 악곡 로드 완료 (평탄화 및 필터링 후). 출시일 필터링 중...` }));
      
      console.log(`[ReleaseFilter] Total records after flattening and initial validation: ${allMusicRecords.length}`);

      const targetDateStr = '2024-12-12';
      const targetDate = new Date(targetDateStr);
      targetDate.setHours(0,0,0,0); 

      const filteredSongs = allMusicRecords.filter(song => {
        if (!song.release) return false; // Should be caught by above filter, but defensive
        try {
          const releaseDate = new Date(song.release);
          releaseDate.setHours(0,0,0,0); 
          const isAfter = releaseDate.getTime() >= targetDate.getTime();
          return isAfter;
        } catch (dateError) {
          console.warn(`[ReleaseFilter] Could not parse release date for song ${song.id} (${song.title}): ${song.release}`, dateError);
          return false;
        }
      });
      console.log(`[ReleaseFilter] Filtered songs (after ${targetDateStr}): ${filteredSongs.length}`);

      const resultSummary = `총 ${allMusicRecords.length}개 악곡 (평탄화 및 유효성 검사 후) 중 "${targetDateStr}" 이후 출시된 악곡 ${filteredSongs.length}개 발견.`;
      setReleaseFilterTest(prev => ({
        ...prev,
        loading: false,
        filteredData: filteredSongs,
        summary: resultSummary,
      }));
      toast({title: "릴리즈 날짜 필터링 성공", description: resultSummary});

    } catch (e) {
      const errorMsg = String(e); 
      setReleaseFilterTest(prev => ({ ...prev, loading: false, error: errorMsg, summary: `오류: ${errorMsg}`}));
      toast({title: "릴리즈 날짜 필터링 실패", description: errorMsg, variant: "destructive"});
    }
  };

 const handleFetchSongById = async () => {
    const trimmedSongIdToFetch = songByIdFetcher.songIdToFetch.trim();
    if (!trimmedSongIdToFetch) {
        toast({ title: "ID 필요", description: "조회할 악곡의 ID를 입력해주세요.", variant: "destructive" });
        setSongByIdFetcher(prev => ({ ...prev, error: "ID를 입력해주세요.", outputSummary: "ID를 입력해주세요."}));
        return;
    }
    setSongByIdFetcher(prev => ({ ...prev, loading: true, error: null, fetchedSongData: null, rawMusicShowallRecords: null, outputSummary: "전체 악곡 목록 로드 중..."}));
    
    try {
        const globalMusicApiResponse = await fetchApiForDebug("/2.0/music/showall.json");

        let rawApiRecords: any[] = [];
        let apiFullResponseForDisplay: string | AppShowallApiSongEntry[] = "API 응답 없음";


        if (Array.isArray(globalMusicApiResponse)) {
            rawApiRecords = globalMusicApiResponse;
            // For display, we will show the raw {meta, data} structure
            apiFullResponseForDisplay = globalMusicApiResponse; 
            console.log("[SongByID] API response is a direct array.");
        } else if (globalMusicApiResponse && typeof globalMusicApiResponse === 'object' && globalMusicApiResponse.records !== undefined) {
            // This case may not be hit often if API sends direct array
            if (Array.isArray(globalMusicApiResponse.records)) {
                rawApiRecords = globalMusicApiResponse.records;
                apiFullResponseForDisplay = globalMusicApiResponse.records;
                console.log("[SongByID] API response is an object with a 'records' array.");
            } else {
                const errorDetail = "API 응답에 'records' 필드가 있지만 배열이 아닙니다 (music/showall.json).";
                console.error("[SongByID] API response '.records' field is not an array:", globalMusicApiResponse.records);
                apiFullResponseForDisplay = JSON.stringify(globalMusicApiResponse, null, 2);
                setSongByIdFetcher(prev => ({ 
                    ...prev, 
                    loading: false, 
                    error: errorDetail, 
                    fetchedSongData: null, 
                    rawMusicShowallRecords: apiFullResponseForDisplay, 
                    outputSummary: `오류: ${errorDetail} 전체 API 응답을 확인하세요.`
                }));
                toast({title: "API 데이터 형식 오류", description: errorDetail, variant: "destructive"});
                return;
            }
        } else {
             const errorDetail = "API 응답이 없거나 유효한 객체 또는 배열 형식이 아닙니다 (music/showall.json).";
            console.error("[SongByID] Invalid API response structure:", globalMusicApiResponse);
            if (typeof globalMusicApiResponse === 'string') {
                 apiFullResponseForDisplay = globalMusicApiResponse;
            } else if (globalMusicApiResponse !== null && globalMusicApiResponse !== undefined) {
                apiFullResponseForDisplay = JSON.stringify(globalMusicApiResponse, null, 2);
            }

            setSongByIdFetcher(prev => ({ 
                ...prev, 
                loading: false, 
                error: errorDetail, 
                fetchedSongData: null, 
                rawMusicShowallRecords: apiFullResponseForDisplay, 
                outputSummary: `오류: ${errorDetail}`
            }));
            toast({title: "API 응답 오류", description: errorDetail, variant: "destructive"});
            return; 
        }
        
        setSongByIdFetcher(prev => ({ ...prev, rawMusicShowallRecords: apiFullResponseForDisplay, outputSummary: "전체 악곡 목록 로드 완료. 평탄화 및 ID 검색 중..." }));
        console.log(`[SongByID] Raw records from API for search count: ${rawApiRecords.length}`);
        if (rawApiRecords.length > 0) {
            console.log("[SongByID] Sample raw records from API (first 2):", rawApiRecords.slice(0, 2));
        }
        
        const flattenedMusicEntries: AppShowallApiSongEntry[] = [];
        rawApiRecords.forEach(rawEntry => {
            if (rawEntry && rawEntry.meta && rawEntry.data && typeof rawEntry.data === 'object') {
                const meta = rawEntry.meta;
                const difficulties = rawEntry.data;
                for (const diffKey in difficulties) {
                    if (Object.prototype.hasOwnProperty.call(difficulties, diffKey)) {
                        const diffData = difficulties[diffKey];
                         if (diffData && meta.id && meta.title) { // Basic check
                            flattenedMusicEntries.push({
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
        console.log(`[SongByID] Flattened entries count for search: ${flattenedMusicEntries.length}`);
        if (flattenedMusicEntries.length > 0) {
            console.log("[SongByID] Sample flattened entries for search (first 2):", flattenedMusicEntries.slice(0, 2));
        }


        // Filter the flattened entries for validity (this ensures we only search valid structures)
        const allMusicRecordsFiltered = flattenedMusicEntries.filter((e: AppShowallApiSongEntry, index: number): e is AppShowallApiSongEntry => {
            const isValid = e && 
                            typeof e.id === 'string' && e.id.trim() !== '' &&
                            typeof e.diff === 'string' && e.diff.trim() !== '' &&
                            typeof e.title === 'string' && e.title.trim() !== '' &&
                            (typeof e.release === 'string') &&
                            (e.const !== undefined) && 
                            e.level !== undefined && String(e.level).trim() !== '';
            
            if (!isValid && index < 5 && flattenedMusicEntries.length > 0) { 
                console.log(`[SongByID_FilterDebug_On_Flattened] Record at index ${index} from flattenedMusicEntries filtered out. Details:`, {
                    hasE: !!e,
                    isIdStringAndNotEmpty: typeof e?.id === 'string' && e.id.trim() !== '',
                    isDiffStringAndNotEmpty: typeof e?.diff === 'string' && e.diff.trim() !== '',
                    isTitleStringAndNotEmpty: typeof e?.title === 'string' && e.title.trim() !== '',
                    releaseIsString: typeof e?.release === 'string',
                    constExists: e?.const !== undefined,
                    levelExistsAndNotEmpty: e?.level !== undefined && String(e.level).trim() !== '',
                    record: e
                });
            }
            return isValid;
        });
        
        console.log(`[SongByID] Filtered allMusicRecords count for search (after flattening & filtering): ${allMusicRecordsFiltered.length}`);
        
        // Find the song by ID from the *flattened and filtered* list
        const foundSong = allMusicRecordsFiltered.find(song => song.id === trimmedSongIdToFetch);

        if (foundSong) {
            setSongByIdFetcher(prev => ({
                ...prev,
                loading: false,
                fetchedSongData: foundSong, 
                error: null,
                outputSummary: `전체 악곡 목록 로드 및 평탄화 완료. ID '${trimmedSongIdToFetch}' 악곡 발견: ${foundSong.title} (${foundSong.diff})`,
            }));
            toast({ title: "악곡 발견", description: `ID ${trimmedSongIdToFetch}에 해당하는 악곡 '${foundSong.title} (${foundSong.diff})'을(를) 전체 목록 내에서 찾았습니다.`});
        } else {
            console.error(`[SongByID] ID search failed.
            Input ID (trimmed): "${trimmedSongIdToFetch}" (type: ${typeof trimmedSongIdToFetch})
            Total records searched (after flattening and filtering): ${allMusicRecordsFiltered.length}`);
            
            let finalSummary = "";
            const baseSummary = rawApiRecords && Array.isArray(rawApiRecords) && rawApiRecords.length > 0
                ? `전체 music/showall.json 원본 레코드(${rawApiRecords.length}개)가 아래에 표시됩니다.`
                : `전체 악곡 목록(music/showall.json)에 원본 레코드가 없거나 API 응답에 문제가 있어 표시할 전체 목록이 없습니다.`;

            if (allMusicRecordsFiltered.length > 0) {
                 finalSummary = `${baseSummary} ID '${trimmedSongIdToFetch}' 악곡을 평탄화 및 필터링된 목록에서 찾지 못했습니다.`;
            } else if (flattenedMusicEntries.length > 0) {
                 console.log("[SongByID] No records remained after filtering the flattened entries. Check filter logic and SongByID_FilterDebug_On_Flattened logs.");
                 finalSummary = `${baseSummary} 유효한 형식의 악곡이 없어 ID '${trimmedSongIdToFetch}' 악곡을 검색할 수 없었습니다. (콘솔 FilterDebug_On_Flattened 로그 확인)`;
            } else if (rawApiRecords.length > 0) {
                 console.log("[SongByID] Flattening process resulted in zero entries, though raw API response had records. Check flattening logic.");
                 finalSummary = `${baseSummary} 원본 데이터를 평탄화하는 과정에서 유효한 악곡 항목을 생성하지 못했습니다. ID '${trimmedSongIdToFetch}' 검색 불가.`;
            } else {
                console.log("[SongByID] No records found in raw API response. Flattening and search not possible.");
                finalSummary = `${baseSummary} ID '${trimmedSongIdToFetch}' 악곡을 찾지 못했습니다.`;
            }

            setSongByIdFetcher(prev => ({
                ...prev,
                loading: false,
                fetchedSongData: null,
                error: `ID '${trimmedSongIdToFetch}' (으)로 music/showall.json 에서 특정 곡을 찾지 못했습니다. (브라우저 콘솔 로그를 확인하세요)`,
                outputSummary: finalSummary,
            }));
            toast({ title: "악곡 없음", description: `ID '${trimmedSongIdToFetch}'에 해당하는 악곡을 찾을 수 없습니다. (콘솔 로그를 확인하세요)`, variant: "destructive"});
        }

    } catch (e) {
        const errorMsg = String(e);
        console.error("[SongByID_ERROR] Error in handleFetchSongById:", e);
        setSongByIdFetcher(prev => ({ ...prev, loading: false, error: errorMsg, fetchedSongData: null, rawMusicShowallRecords: null, outputSummary: `오류: ${errorMsg}`}));
        toast({title: "ID로 악곡 조회 실패", description: errorMsg, variant: "destructive"});
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
    endpoint: ApiEndpoint, // Uses page-specific ApiEndpoint
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

    // Ensure `displayFilteredData` is called with the correct endpoint type from the helper file
    const displayResult = state.data ? displayFilteredData(state.data, state.searchTerm, endpoint as DisplayFilteredDataEndpointType) : { content: "" };

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
    const { nickname, loadingStep, error, step1NewSongTitlesRaw, step1Output, globalMusicDataForN20, step2Output, step2DefinedSongPoolRaw } = new20Debug;

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

          <div className="space-y-2 p-4 border rounded-md shadow-sm">
             <h3 className="font-semibold text-lg flex items-center"><FileJson className="mr-2 h-5 w-5 text-primary" />1단계: 데이터 로드</h3>
            <div className="flex flex-col sm:flex-row gap-2 mb-2">
                <Button onClick={handleLoadTitlesFromNewSongsJson} disabled={loadingStep === "step1a"} size="sm" className="flex-1">
                    {loadingStep === "step1a" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    1-1단계: NewSongs.json 제목 로드
                </Button>
                <Button onClick={handleLoadGlobalMusicForN20} disabled={loadingStep === "step1b"} size="sm" className="flex-1">
                    {loadingStep === "step1b" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    1-2단계: 전체 악곡 목록 로드 및 평탄화/필터링
                </Button>
            </div>
            <Textarea
              readOnly
              value={step1Output}
              className="h-32 font-mono text-xs bg-muted/30"
              rows={4}
              placeholder="1-1, 1-2단계 결과 요약"
            />
            {globalMusicDataForN20 && (
                <details className="mt-2">
                    <summary className="text-sm cursor-pointer hover:underline">로드된 전체 악곡 목록 데이터 보기 (평탄화 및 필터링 후, 처음 5개)</summary>
                    <Textarea readOnly value={displayFilteredData(globalMusicDataForN20.slice(0,5), undefined, "N20_DEBUG_GLOBAL").content} className="h-40 font-mono text-xs mt-1" />
                </details>
            )}
          </div>

          <div className="space-y-2 p-4 border rounded-md shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-lg flex items-center"><Server className="mr-2 h-5 w-5 text-primary" />2단계: 전체 악곡 목록에서 신곡 정의</h3>
              <Button onClick={handleDefineNewSongPoolFromGlobalMusic} disabled={loadingStep === "step2" || !globalMusicDataForN20 || step1NewSongTitlesRaw.length === 0} size="sm">
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
  
  const renderReleaseDateFilterTestSection = () => {
    const { loading, error, summary, rawData, filteredData } = releaseFilterTest;
    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center"><CalendarDays className="mr-2 h-5 w-5 text-blue-500" />"2024-12-12" 이후 출시 곡 필터링 테스트</CardTitle>
                <CardDescription>music/showall.json에서 특정 날짜 이후 출시된 곡을 필터링합니다. (데이터 평탄화 적용)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Button onClick={handleFetchAndFilterByReleaseDate} disabled={loading} className="w-full">
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilterIcon className="mr-2 h-4 w-4" />}
                    전체 악곡 로드, 평탄화 및 필터링 실행
                </Button>
                 {error && (
                    <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                        <p className="font-semibold">오류:</p>
                        <pre className="whitespace-pre-wrap break-all">{error}</pre>
                    </div>
                )}
                <Textarea
                    readOnly
                    value={summary}
                    className="h-24 font-mono text-xs bg-muted/30"
                    placeholder="필터링 결과 요약"
                />
                {filteredData && (
                    <details className="mt-2">
                        <summary className="text-sm cursor-pointer hover:underline">필터링된 악곡 목록 보기 ({filteredData.length}개, 최대 20개 표시)</summary>
                        <Textarea 
                            readOnly 
                            value={JSON.stringify(filteredData.slice(0,20).map(s => ({ id: s.id, title: s.title, diff: s.diff, release: s.release, const: s.const })), null, 2)} 
                            className="h-64 font-mono text-xs mt-1" 
                        />
                    </details>
                )}
                 {rawData && !filteredData && !error && !loading && ( 
                     <details className="mt-2">
                        <summary className="text-sm cursor-pointer hover:underline">로드된 전체 악곡 데이터 보기 (평탄화 및 필터링 전, 처음 5개)</summary>
                        <Textarea readOnly value={displayFilteredData(rawData.slice(0,5), undefined, "RELEASE_FILTER_RAW").content} className="h-40 font-mono text-xs mt-1" />
                    </details>
                 )}
            </CardContent>
        </Card>
    );
  };

  const renderSongByIdFetcherSection = () => {
    const { songIdToFetch, fetchedSongData, rawMusicShowallRecords, loading, error, outputSummary } = songByIdFetcher;
    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center"><FileSearch className="mr-2 h-5 w-5 text-indigo-500" />ID로 특정 곡 데이터 조회</CardTitle>
                <CardDescription>music/showall.json 원본을 표시하고, 데이터를 평탄화한 후 특정 악곡 ID로 데이터를 검색 및 추출합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-1">
                    <Label htmlFor="song-id-fetch">조회할 악곡 ID</Label>
                    <div className="flex space-x-2">
                        <Input
                            id="song-id-fetch"
                            value={songIdToFetch}
                            onChange={(e) => setSongByIdFetcher(prev => ({ ...prev, songIdToFetch: e.target.value }))}
                            placeholder="예: music0001"
                        />
                        <Button onClick={handleFetchSongById} disabled={loading} className="px-3">
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SearchIcon className="mr-2 h-4 w-4" />}
                            조회
                        </Button>
                    </div>
                </div>
                {error && (
                    <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                        <p className="font-semibold">오류:</p>
                        <pre className="whitespace-pre-wrap break-all">{error}</pre>
                    </div>
                )}
                <Textarea
                    readOnly
                    value={outputSummary}
                    className="h-20 font-mono text-xs bg-muted/30"
                    placeholder="조회 결과 요약"
                />
                {rawMusicShowallRecords !== null && ( 
                    <div>
                        <Label>전체 music/showall.json 원본 레코드 (API 응답):</Label>
                        <Textarea
                            readOnly
                            value={displayFilteredData(rawMusicShowallRecords, undefined, "SONG_BY_ID_RAW").content}
                            className="h-96 font-mono text-xs mt-1"
                            rows={20}
                        />
                    </div>
                )}
                {fetchedSongData && (
                    <div className="mt-4">
                        <Label>찾은 특정 곡 데이터 (ID: {songIdToFetch}, 난이도: {fetchedSongData.diff}):</Label>
                        <Textarea 
                            readOnly 
                            value={displayFilteredData(fetchedSongData, undefined, "SONG_BY_ID_RESULT").content} 
                            className="h-64 font-mono text-xs mt-1" 
                            rows={10}
                        />
                    </div>
                )}
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
          {isDeveloperMode && renderReleaseDateFilterTestSection()}
          {isDeveloperMode && renderSongByIdFetcherSection()}
        </div>
      </div>
    </main>
  );
}



"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { setCachedData, getCachedData, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS } from "@/lib/cache";
import { KeyRound, Trash2, CloudDownload, UserCircle, DatabaseZap } from "lucide-react";

// Assuming these types are available or defined elsewhere if needed for strong typing of fetched data
type ShowallApiSongEntry = any; // Replace with actual type if available
type GlobalMusicApiResponse = { records?: ShowallApiSongEntry[] };
type UserShowallApiResponse = { records?: ShowallApiSongEntry[] };


export default function AdvancedSettings() {
  const [localApiToken, setLocalApiToken] = useState("");
  const [cacheNickname, setCacheNickname] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedToken = localStorage.getItem('chuniCalcData_userApiToken');
      if (storedToken) {
        setLocalApiToken(storedToken);
      }
    }
  }, []);

  const handleSaveLocalApiToken = () => {
    if (typeof window !== 'undefined') {
      if (localApiToken.trim() === "") {
        localStorage.removeItem('chuniCalcData_userApiToken');
        toast({ title: "로컬 API 키 제거됨", description: "로컬 API 키가 비어있어 저장소에서 제거되었습니다." });
      } else {
        localStorage.setItem('chuniCalcData_userApiToken', localApiToken.trim());
        toast({ title: "로컬 API 키 저장됨", description: "입력한 API 키가 로컬 저장소에 저장되었습니다." });
      }
    }
  };

  const handleClearAllLocalData = () => {
    if (typeof window !== 'undefined') {
      let clearedCount = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(LOCAL_STORAGE_PREFIX)) {
          localStorage.removeItem(key);
          // To correctly remove all, re-check length and current key
          i--; 
          clearedCount++;
        }
      }
      // Re-fetch current local API token to display after clearing, if it was also cleared
      const storedToken = localStorage.getItem('chuniCalcData_userApiToken');
      setLocalApiToken(storedToken || "");

      toast({ title: "로컬 데이터 삭제 완료", description: `${clearedCount}개의 앱 관련 로컬 캐시 데이터가 삭제되었습니다.` });
    }
  };

  const handleCacheGlobalMusic = async () => {
    const apiToken = getApiToken();
    if (!apiToken) {
      toast({ title: "API 토큰 없음", description: "전역 음악 목록을 캐시하려면 API 토큰이 필요합니다.", variant: "destructive" });
      return;
    }
    toast({ title: "캐싱 시작", description: "전역 음악 목록(music/showall)을 가져오고 있습니다..." });
    try {
      const response = await fetch(`https://api.chunirec.net/2.0/music/showall.json?token=${apiToken}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API 오류 (상태: ${response.status}): ${errorData.error?.message || response.statusText}`);
      }
      const data = await response.json();
      setCachedData<GlobalMusicApiResponse>(`${LOCAL_STORAGE_PREFIX}globalMusicData`, data);
      toast({ title: "캐싱 성공", description: "전역 음악 목록이 로컬 저장소에 캐시되었습니다." });
    } catch (error) {
      console.error("Error caching global music data:", error);
      toast({ title: "캐싱 실패", description: error instanceof Error ? error.message : "전역 음악 목록 캐싱 중 오류 발생.", variant: "destructive" });
    }
  };

  const handleCacheUserRecords = async () => {
    if (!cacheNickname.trim()) {
      toast({ title: "닉네임 필요", description: "사용자 기록을 캐시하려면 닉네임을 입력해주세요.", variant: "destructive" });
      return;
    }
    const apiToken = getApiToken();
    if (!apiToken) {
      toast({ title: "API 토큰 없음", description: "사용자 기록을 캐시하려면 API 토큰이 필요합니다.", variant: "destructive" });
      return;
    }
    toast({ title: "캐싱 시작", description: `${cacheNickname}님의 기록(records/showall)을 가져오고 있습니다...` });
    try {
      const response = await fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2&user_name=${encodeURIComponent(cacheNickname.trim())}&token=${apiToken}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API 오류 (상태: ${response.status}): ${errorData.error?.message || response.statusText}`);
      }
      const data = await response.json();
      setCachedData<UserShowallApiResponse>(`${LOCAL_STORAGE_PREFIX}showall_${cacheNickname.trim()}`, data);
      toast({ title: "캐싱 성공", description: `${cacheNickname}님의 사용자 기록이 로컬 저장소에 캐시되었습니다.` });
    } catch (error) {
      console.error("Error caching user records:", error);
      toast({ title: "캐싱 실패", description: error instanceof Error ? error.message : "사용자 기록 캐싱 중 오류 발생.", variant: "destructive" });
    }
  };


  return (
    <Card className="w-full max-w-md mt-12 mb-8 shadow-lg border-2 border-primary/20">
      <CardHeader>
        <CardTitle className="font-headline text-2xl flex items-center">
          <DatabaseZap className="mr-2 h-6 w-6 text-primary" />
          고급 설정 및 데이터 관리
        </CardTitle>
        <CardDescription>
          로컬 API 키 설정, 캐시 데이터 관리 등 고급 기능을 사용합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="localApiToken" className="flex items-center font-medium">
            <KeyRound className="mr-2 h-5 w-5 text-primary" /> 로컬 API 키 설정
          </Label>
          <Input
            id="localApiToken"
            type="text"
            placeholder="개인 Chunirec API 토큰 입력"
            value={localApiToken}
            onChange={(e) => setLocalApiToken(e.target.value)}
          />
          <Button onClick={handleSaveLocalApiToken} className="w-full mt-1">로컬 API 키 저장/업데이트</Button>
          <p className="text-xs text-muted-foreground mt-1">
            여기에 개인 Chunirec API 토큰을 입력하면, 앱 실행 시 우선적으로 이 키를 사용합니다. 비워두고 저장하면 제거됩니다.
          </p>
        </div>

        <hr/>

        <div className="space-y-3">
            <h3 className="font-medium flex items-center"><CloudDownload className="mr-2 h-5 w-5 text-primary" />수동 데이터 캐싱</h3>
            <div>
                <Button onClick={handleCacheGlobalMusic} variant="outline" className="w-full">
                    전역 음악 목록 캐시 (music/showall)
                </Button>
            </div>
            <div>
                <Label htmlFor="cacheNickname" className="text-sm">캐시할 사용자 닉네임</Label>
                 <Input
                    id="cacheNickname"
                    type="text"
                    placeholder="Chunirec 닉네임"
                    value={cacheNickname}
                    onChange={(e) => setCacheNickname(e.target.value)}
                    className="mt-1"
                />
                <Button onClick={handleCacheUserRecords} variant="outline" className="w-full mt-1" disabled={!cacheNickname.trim()}>
                    <UserCircle className="mr-2 h-4 w-4"/> 해당 사용자 기록 캐시 (records/showall)
                </Button>
            </div>
        </div>
        
        <hr/>

        <div>
          <Button onClick={handleClearAllLocalData} variant="destructive" className="w-full">
            <Trash2 className="mr-2 h-4 w-4" /> 모든 로컬 캐시 데이터 삭제
          </Button>
          <p className="text-xs text-muted-foreground mt-1">
            앱이 로컬 저장소에 저장한 모든 캐시 데이터 (API 응답, 사용자 설정 토큰 제외)를 삭제합니다.
          </p>
        </div>
        
        <hr/>
        
        <div className="text-sm">
            <h3 className="font-medium mb-1">문의 및 정보</h3>
            <p className="text-muted-foreground">버그 리포트 및 기타 문의: <a href="mailto:your-email@example.com" className="text-primary hover:underline">your-email@example.com</a></p>
            <p className="text-xs text-muted-foreground mt-1">ChuniCalc v{process.env.npm_package_version || "1.0.0"}</p>
        </div>

      </CardContent>
    </Card>
  );
}

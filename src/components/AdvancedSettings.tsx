
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getApiToken } from "@/lib/get-api-token";
import { setCachedData, getCachedData, LOCAL_STORAGE_PREFIX } from "@/lib/cache";
import { KeyRound, Trash2, CloudDownload, UserCircle, DatabaseZap, Settings, FlaskConical, ShieldAlert } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { getTranslation } from "@/lib/translations";

type GlobalMusicApiResponse = { records?: any[] };
type UserShowallApiResponse = { records?: any[] };

const DEVELOPER_MODE_KEY = `${LOCAL_STORAGE_PREFIX}isDeveloperMode`;
const ADMIN_PANEL_VISIBLE_KEY = `${LOCAL_STORAGE_PREFIX}isAdminPanelVisible`; // For persisting toggle state

export default function AdvancedSettings() {
  const [localApiToken, setLocalApiToken] = useState("");
  const [cacheNickname, setCacheNickname] = useState("");
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);
  const [isAdminPanelVisible, setIsAdminPanelVisible] = useState(false);
  const [clientHasMounted, setClientHasMounted] = useState(false);
  const { toast } = useToast();
  const { locale } = useLanguage();

  useEffect(() => {
    setClientHasMounted(true);
    if (typeof window !== 'undefined') {
      const storedToken = localStorage.getItem('chuniCalcData_userApiToken');
      if (storedToken) {
        setLocalApiToken(storedToken);
      }
      const devMode = localStorage.getItem(DEVELOPER_MODE_KEY);
      setIsDeveloperMode(devMode === 'true');
      const adminPanelVisible = localStorage.getItem(ADMIN_PANEL_VISIBLE_KEY);
      setIsAdminPanelVisible(adminPanelVisible === 'true');
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
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(LOCAL_STORAGE_PREFIX)) {
          // Keep developer mode and admin panel visibility settings
          if (key !== DEVELOPER_MODE_KEY && key !== ADMIN_PANEL_VISIBLE_KEY) { 
            keysToRemove.push(key);
          }
        }
      }
      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        clearedCount++;
      });

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

  const toggleDeveloperMode = (checked: boolean) => {
    setIsDeveloperMode(checked);
    if (typeof window !== 'undefined') {
      localStorage.setItem(DEVELOPER_MODE_KEY, String(checked));
    }
    toast({ title: "개발자 모드 " + (checked ? "활성화됨" : "비활성화됨") });
  };

  const toggleAdminPanel = () => {
    const newVisibility = !isAdminPanelVisible;
    setIsAdminPanelVisible(newVisibility);
    if (typeof window !== 'undefined') {
        localStorage.setItem(ADMIN_PANEL_VISIBLE_KEY, String(newVisibility));
    }
    toast({ title: "관리자 패널 " + (newVisibility ? "표시됨" : "숨겨짐") });
  };


  return (
    <Card className="w-full max-w-md mt-12 mb-8 shadow-lg border-2 border-primary/20">
      <CardHeader>
        <CardTitle className="font-headline text-2xl flex items-center">
          <Settings className="mr-2 h-6 w-6 text-primary" />
          {getTranslation(locale, 'advancedSettingsTitle')}
        </CardTitle>
        <CardDescription>
          {getTranslation(locale, 'advancedSettingsDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="localApiToken" className="flex items-center font-medium">
            <KeyRound className="mr-2 h-5 w-5 text-primary" /> {getTranslation(locale, 'localApiKeyLabel')}
          </Label>
          <Input
            id="localApiToken"
            type="text"
            placeholder={getTranslation(locale, 'localApiKeyPlaceholder')}
            value={localApiToken}
            onChange={(e) => setLocalApiToken(e.target.value)}
          />
          <Button onClick={handleSaveLocalApiToken} className="w-full mt-1">{getTranslation(locale, 'saveApiKeyButton')}</Button>
          <p className="text-xs text-muted-foreground mt-1">
            {getTranslation(locale, 'localApiKeyHelp')}
          </p>
        </div>
        
        {isAdminPanelVisible && clientHasMounted && (
          <>
            <hr/>
            <div className="flex items-center space-x-2">
              <Switch
                id="developer-mode"
                checked={isDeveloperMode}
                onCheckedChange={toggleDeveloperMode}
                disabled={!clientHasMounted}
              />
              <Label htmlFor="developer-mode" className="flex items-center font-medium">
                <FlaskConical className="mr-2 h-5 w-5 text-purple-500" /> {getTranslation(locale, 'developerModeLabel')}
              </Label>
            </div>
            {isDeveloperMode && (
              <Button asChild variant="outline" className="w-full">
                <Link href="/developer/api-test">
                  <DatabaseZap className="mr-2 h-4 w-4"/> {getTranslation(locale, 'goToApiTestPageButton')}
                </Link>
              </Button>
            )}

            <hr/>
            <div className="space-y-3">
                <h3 className="font-medium flex items-center"><CloudDownload className="mr-2 h-5 w-5 text-primary" />{getTranslation(locale, 'manualCachingLabel')}</h3>
                <div>
                    <Button onClick={handleCacheGlobalMusic} variant="outline" className="w-full">
                        {getTranslation(locale, 'cacheGlobalMusicButton')}
                    </Button>
                </div>
                <div>
                    <Label htmlFor="cacheNickname" className="text-sm">{getTranslation(locale, 'cacheUserNicknameLabel')}</Label>
                     <Input
                        id="cacheNickname"
                        type="text"
                        placeholder={getTranslation(locale, 'cacheUserNicknamePlaceholder')}
                        value={cacheNickname}
                        onChange={(e) => setCacheNickname(e.target.value)}
                        className="mt-1"
                    />
                    <Button onClick={handleCacheUserRecords} variant="outline" className="w-full mt-1" disabled={!cacheNickname.trim()}>
                        <UserCircle className="mr-2 h-4 w-4"/> {getTranslation(locale, 'cacheUserRecordsButton')}
                    </Button>
                </div>
            </div>
            
            <hr/>
            <div>
              <Button onClick={handleClearAllLocalData} variant="destructive" className="w-full">
                <Trash2 className="mr-2 h-4 w-4" /> {getTranslation(locale, 'clearLocalDataButton')}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">
                {getTranslation(locale, 'clearLocalDataHelp')}
              </p>
            </div>
          </>
        )}
        
        <hr/>
        
        <div className="text-sm">
            <h3 className="font-medium mb-1">{getTranslation(locale, 'contactInfoLabel')}</h3>
            <p className="text-muted-foreground">{getTranslation(locale, 'contactInfoBugReport')} <a href="mailto:your-email@example.com" className="text-primary hover:underline">your-email@example.com</a></p>
            {clientHasMounted && (
              <p className="text-xs text-muted-foreground mt-1">{getTranslation(locale, 'appVersion')}</p>
            )}
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={toggleAdminPanel} variant="outline" className="w-full">
            <ShieldAlert className="mr-2 h-4 w-4" /> 
            {isAdminPanelVisible ? getTranslation(locale, 'adminPanelToggleHide') : getTranslation(locale, 'adminPanelToggleShow')}
        </Button>
      </CardFooter>
    </Card>
  );
}

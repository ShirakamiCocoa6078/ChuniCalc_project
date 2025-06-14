
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
import { KeyRound, Trash2, CloudDownload, UserCircle, DatabaseZap, Settings, FlaskConical, ShieldAlert, Brain } from "lucide-react"; 
import { useLanguage } from "@/contexts/LanguageContext";
import { getTranslation } from "@/lib/translations";

type GlobalMusicApiResponse = { records?: any[] };
type UserShowallApiResponse = { records?: any[] };

const DEVELOPER_MODE_KEY = `${LOCAL_STORAGE_PREFIX}isDeveloperMode`;
const ADMIN_PANEL_VISIBLE_KEY = `${LOCAL_STORAGE_PREFIX}isAdminPanelVisible`;

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
        toast({
            title: getTranslation(locale, 'toastSuccessLocalApiKeyRemoved'),
            description: getTranslation(locale, 'toastSuccessLocalApiKeyRemovedDesc')
        });
      } else {
        localStorage.setItem('chuniCalcData_userApiToken', localApiToken.trim());
        toast({
            title: getTranslation(locale, 'toastSuccessLocalApiKeySaved'),
            description: getTranslation(locale, 'toastSuccessLocalApiKeySavedDesc')
        });
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
          if (key !== DEVELOPER_MODE_KEY && key !== ADMIN_PANEL_VISIBLE_KEY) {
            keysToRemove.push(key);
          }
        }
      }
      // Also clear the non-prefixed API token key
      if (localStorage.getItem('chuniCalcData_userApiToken')) {
          keysToRemove.push('chuniCalcData_userApiToken');
      }

      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        clearedCount++;
      });

      const storedToken = localStorage.getItem('chuniCalcData_userApiToken'); // Re-check after potential removal
      setLocalApiToken(storedToken || "");

      toast({
          title: getTranslation(locale, 'toastSuccessLocalDataCleared'),
          description: getTranslation(locale, 'toastSuccessLocalDataClearedDesc', clearedCount)
      });
    }
  };

  const handleCacheGlobalMusic = async () => {
    const apiToken = getApiToken();
    if (!apiToken) {
      toast({
          title: getTranslation(locale, 'toastErrorApiKeyMissing'),
          description: getTranslation(locale, 'toastErrorGlobalMusicCacheFailed', getTranslation(locale, 'toastErrorApiKeyMissingDesc')),
          variant: "destructive"
      });
      return;
    }
    toast({
        title: getTranslation(locale, 'toastInfoCachingStarted'),
        description: getTranslation(locale, 'toastInfoCachingStartedDesc', getTranslation(locale, 'cacheGlobalMusicButton'))
    });
    try {
      const response = await fetch(`https://api.chunirec.net/2.0/music/showall.json?region=jp2&token=${apiToken}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(getTranslation(locale, 'toastErrorApiRequestFailedDesc', response.status, errorData.error?.message));
      }
      const data = await response.json();
      setCachedData<GlobalMusicApiResponse>(`${LOCAL_STORAGE_PREFIX}globalMusicData`, data);
      toast({
          title: getTranslation(locale, 'toastSuccessGlobalMusicCached'),
          description: getTranslation(locale, 'toastSuccessGlobalMusicCachedDesc')
      });
    } catch (error) {
      console.error("Error caching global music data:", error);
      toast({
          title: getTranslation(locale, 'toastErrorGlobalMusicCacheFailed'),
          description: getTranslation(locale, 'toastErrorGlobalMusicCacheFailedDesc', error instanceof Error ? error.message : undefined),
          variant: "destructive"
      });
    }
  };

  const handleCacheUserRecords = async () => {
    if (!cacheNickname.trim()) {
      toast({
          title: getTranslation(locale, 'toastErrorNicknameNeeded'),
          description: getTranslation(locale, 'toastErrorUserRecordsCacheFailed', getTranslation(locale, 'toastErrorNicknameNeededDesc')),
          variant: "destructive"
      });
      return;
    }
    const apiToken = getApiToken();
    if (!apiToken) {
      toast({
          title: getTranslation(locale, 'toastErrorApiKeyMissing'),
          description: getTranslation(locale, 'toastErrorUserRecordsCacheFailed', getTranslation(locale, 'toastErrorApiKeyMissingDesc')),
          variant: "destructive"
      });
      return;
    }
    toast({
        title: getTranslation(locale, 'toastInfoCachingStarted'),
        description: getTranslation(locale, 'toastInfoCachingStartedDesc', `${cacheNickname.trim()}'s records`)
    });
    try {
      const response = await fetch(`https://api.chunirec.net/2.0/records/showall.json?region=jp2&user_name=${encodeURIComponent(cacheNickname.trim())}&token=${apiToken}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(getTranslation(locale, 'toastErrorApiRequestFailedDesc', response.status, errorData.error?.message));
      }
      const data = await response.json();
      setCachedData<UserShowallApiResponse>(`${LOCAL_STORAGE_PREFIX}showall_${cacheNickname.trim()}`, data);
      toast({
          title: getTranslation(locale, 'toastSuccessUserRecordsCached'),
          description: getTranslation(locale, 'toastSuccessUserRecordsCachedDesc', cacheNickname.trim())
      });
    } catch (error) {
      console.error("Error caching user records:", error);
      toast({
          title: getTranslation(locale, 'toastErrorUserRecordsCacheFailed'),
          description: getTranslation(locale, 'toastErrorUserRecordsCacheFailedDesc', error instanceof Error ? error.message : undefined),
          variant: "destructive"
      });
    }
  };

  const toggleDeveloperMode = (checked: boolean) => {
    setIsDeveloperMode(checked);
    if (typeof window !== 'undefined') {
      localStorage.setItem(DEVELOPER_MODE_KEY, String(checked));
    }
    toast({ title: checked ? getTranslation(locale, 'toastInfoDevModeEnabled') : getTranslation(locale, 'toastInfoDevModeDisabled') });
  };

  const toggleAdminPanel = () => {
    const newVisibility = !isAdminPanelVisible;
    setIsAdminPanelVisible(newVisibility);
    if (typeof window !== 'undefined') {
        localStorage.setItem(ADMIN_PANEL_VISIBLE_KEY, String(newVisibility));
    }
    toast({ title: newVisibility ? getTranslation(locale, 'toastInfoAdminPanelShown') : getTranslation(locale, 'toastInfoAdminPanelHidden') });
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
              <div className="space-y-2">
                <Button asChild variant="outline" className="w-full">
                  <Link href="/developer/api-test">
                    <DatabaseZap className="mr-2 h-4 w-4"/> {getTranslation(locale, 'goToApiTestPageButton')}
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/developer/simulation-test">
                    <Brain className="mr-2 h-4 w-4"/> {getTranslation(locale, 'goToSimulationTestPageButton')}
                  </Link>
                </Button>
              </div>
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


"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
// import { getApiToken } from "@/lib/get-api-token"; // No longer needed for proxied caching
import { setCachedData, getCachedData, LOCAL_STORAGE_PREFIX } from "@/lib/cache";
import { KeyRound, Trash2, CloudDownload, UserCircle, DatabaseZap, Settings, FlaskConical, ShieldAlert, Brain, Loader2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { getTranslation } from "@/lib/translations";

const DEVELOPER_MODE_KEY = `${LOCAL_STORAGE_PREFIX}isDeveloperMode`;
const ADMIN_PANEL_VISIBLE_KEY = `${LOCAL_STORAGE_PREFIX}isAdminPanelVisible`;

export default function AdvancedSettings() {
  const [localApiTokenInput, setLocalApiTokenInput] = useState(""); // For the input field only
  const [cacheNickname, setCacheNickname] = useState("");
  const [isDeveloperModeActive, setIsDeveloperModeActive] = useState(false);
  const [isAdminPanelContentVisible, setIsAdminPanelContentVisible] = useState(false);
  const [clientHasMounted, setClientHasMounted] = useState(false);
  const [isCachingGlobal, setIsCachingGlobal] = useState(false);
  const [isCachingUser, setIsCachingUser] = useState(false);
  const { toast } = useToast();
  const { locale } = useLanguage();

  useEffect(() => {
    setClientHasMounted(true);
    if (typeof window !== 'undefined') {
      const storedToken = localStorage.getItem('chuniCalcData_userApiToken'); // Keep for display if user had one
      if (storedToken) {
        setLocalApiTokenInput(storedToken);
      }
      const devMode = localStorage.getItem(DEVELOPER_MODE_KEY);
      setIsDeveloperModeActive(devMode === 'true');

      // Admin panel content visibility also depends on its own toggle state
      const adminPanelVisibleSetting = localStorage.getItem(ADMIN_PANEL_VISIBLE_KEY);
      setIsAdminPanelContentVisible(adminPanelVisibleSetting === 'true');
    }
  }, []);

  const handleSaveLocalApiToken = () => {
    if (typeof window !== 'undefined') {
      if (localApiTokenInput.trim() === "") {
        localStorage.removeItem('chuniCalcData_userApiToken');
        toast({
            title: getTranslation(locale, 'toastSuccessLocalApiKeyRemoved'),
            description: getTranslation(locale, 'toastSuccessLocalApiKeyRemovedDesc')
        });
      } else {
        // Note: This token is saved locally but NOT used for API calls anymore by main app.
        // It's just for user's reference or if they have other tools using it.
        localStorage.setItem('chuniCalcData_userApiToken', localApiTokenInput.trim());
        toast({
            title: getTranslation(locale, 'toastSuccessLocalApiKeySaved'),
            description: getTranslation(locale, 'toastSuccessLocalApiKeySavedDesc') + " (Note: App now uses a server-side key for API calls)"
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
        // Keep developer mode and admin panel visibility settings
        if (key && key.startsWith(LOCAL_STORAGE_PREFIX) && key !== DEVELOPER_MODE_KEY && key !== ADMIN_PANEL_VISIBLE_KEY) {
            keysToRemove.push(key);
        }
      }
      if (localStorage.getItem('chuniCalcData_userApiToken')) {
          keysToRemove.push('chuniCalcData_userApiToken');
      }

      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        clearedCount++;
      });

      setLocalApiTokenInput(localStorage.getItem('chuniCalcData_userApiToken') || "");


      toast({
          title: getTranslation(locale, 'toastSuccessLocalDataCleared'),
          description: getTranslation(locale, 'toastSuccessLocalDataClearedDesc', clearedCount)
      });
    }
  };

  const handleCacheGlobalMusic = async () => {
    setIsCachingGlobal(true);
    toast({
        title: getTranslation(locale, 'toastInfoCachingStarted'),
        description: getTranslation(locale, 'toastInfoCachingStartedDesc', getTranslation(locale, 'cacheGlobalMusicButton'))
    });
    try {
      const response = await fetch(`/api/chunirecApiProxy?proxyEndpoint=music/showall.json&region=jp2`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(getTranslation(locale, 'toastErrorApiRequestFailedDesc', response.status, errorData.error?.message || response.statusText));
      }
      const data = await response.json();
      // The proxy returns the direct data, not {records: ...} for music/showall
      setCachedData<any[]>(`${LOCAL_STORAGE_PREFIX}globalMusicData`, Array.isArray(data) ? data : (data?.records || []), GLOBAL_MUSIC_CACHE_EXPIRY_MS);
      toast({
          title: getTranslation(locale, 'toastSuccessGlobalMusicCached'),
          description: getTranslation(locale, 'toastSuccessGlobalMusicCachedDesc')
      });
    } catch (error) {
      console.error("Error caching global music data:", error);
      toast({
          title: getTranslation(locale, 'toastErrorGlobalMusicCacheFailed'),
          description: getTranslation(locale, 'toastErrorGlobalMusicCacheFailedDesc', error instanceof Error ? error.message : String(error)),
          variant: "destructive"
      });
    } finally {
      setIsCachingGlobal(false);
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
    setIsCachingUser(true);
    toast({
        title: getTranslation(locale, 'toastInfoCachingStarted'),
        description: getTranslation(locale, 'toastInfoCachingStartedDesc', `${cacheNickname.trim()}'s records`)
    });
    try {
      const response = await fetch(`/api/chunirecApiProxy?proxyEndpoint=records/showall.json&region=jp2&user_name=${encodeURIComponent(cacheNickname.trim())}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(getTranslation(locale, 'toastErrorApiRequestFailedDesc', response.status, errorData.error?.message || response.statusText));
      }
      const data = await response.json(); // records/showall returns {records: [...]}
      setCachedData<any>(`${LOCAL_STORAGE_PREFIX}showall_${cacheNickname.trim()}`, data);
      toast({
          title: getTranslation(locale, 'toastSuccessUserRecordsCached'),
          description: getTranslation(locale, 'toastSuccessUserRecordsCachedDesc', cacheNickname.trim())
      });
    } catch (error) {
      console.error("Error caching user records:", error);
      toast({
          title: getTranslation(locale, 'toastErrorUserRecordsCacheFailed'),
          description: getTranslation(locale, 'toastErrorUserRecordsCacheFailedDesc', error instanceof Error ? error.message : String(error)),
          variant: "destructive"
      });
    } finally {
      setIsCachingUser(false);
    }
  };

  const toggleDeveloperModeSetting = (checked: boolean) => {
    setIsDeveloperModeActive(checked);
    if (typeof window !== 'undefined') {
      localStorage.setItem(DEVELOPER_MODE_KEY, String(checked));
      if (!checked) { // If turning off dev mode, also hide admin panel content
        setIsAdminPanelContentVisible(false);
        localStorage.setItem(ADMIN_PANEL_VISIBLE_KEY, String(false));
      }
    }
    toast({ title: checked ? getTranslation(locale, 'toastInfoDevModeEnabled') : getTranslation(locale, 'toastInfoDevModeDisabled') });
  };

  const toggleAdminPanelContent = () => {
    const newVisibility = !isAdminPanelContentVisible;
    setIsAdminPanelContentVisible(newVisibility);
    if (typeof window !== 'undefined') {
        localStorage.setItem(ADMIN_PANEL_VISIBLE_KEY, String(newVisibility));
    }
    // toast({ title: newVisibility ? getTranslation(locale, 'toastInfoAdminPanelShown') : getTranslation(locale, 'toastInfoAdminPanelHidden') });
  };

  if (!clientHasMounted) {
    return (
      <Card className="w-full max-w-md mt-12 mb-8 shadow-lg border-2 border-primary/20">
        <CardHeader>
          <CardTitle className="font-headline text-2xl flex items-center">
            <Settings className="mr-2 h-6 w-6 text-primary" />
            {getTranslation(locale, 'advancedSettingsTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mt-12 mb-8 shadow-lg border-2 border-primary/20">
      <CardHeader>
        <CardTitle className="font-headline text-2xl flex items-center">
          <Settings className="mr-2 h-6 w-6 text-primary" />
          {getTranslation(locale, 'advancedSettingsTitle')}
        </CardTitle>
        {isDeveloperModeActive ? (
          <CardDescription>
            {getTranslation(locale, 'advancedSettingsDescription')}
          </CardDescription>
        ) : (
          <CardDescription>
            {getTranslation(locale, 'developerModeTurnOnPrompt')}
          </CardDescription>
        )}
      </CardHeader>
      
      {/* Always show Developer Mode Toggle */}
      <CardContent className="pt-2 pb-2 border-b">
        <div className="flex items-center space-x-2 justify-between">
          <Label htmlFor="developer-mode-main-toggle" className="flex items-center font-medium text-base">
            <FlaskConical className="mr-2 h-5 w-5 text-purple-500" /> {getTranslation(locale, 'developerModeLabel')}
          </Label>
          <Switch
            id="developer-mode-main-toggle"
            checked={isDeveloperModeActive}
            onCheckedChange={toggleDeveloperModeSetting}
            disabled={!clientHasMounted}
          />
        </div>
      </CardContent>

      {isDeveloperModeActive && (
        <>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-2">
              <Label htmlFor="localApiTokenInput" className="flex items-center font-medium">
                <KeyRound className="mr-2 h-5 w-5 text-primary" /> {getTranslation(locale, 'localApiKeyLabel')} (Not Used by App)
              </Label>
              <Input
                id="localApiTokenInput"
                type="text"
                placeholder={getTranslation(locale, 'localApiKeyPlaceholder')}
                value={localApiTokenInput}
                onChange={(e) => setLocalApiTokenInput(e.target.value)}
              />
              <Button onClick={handleSaveLocalApiToken} className="w-full mt-1">{getTranslation(locale, 'saveApiKeyButton')}</Button>
              <p className="text-xs text-muted-foreground mt-1">
                {getTranslation(locale, 'localApiKeyHelp')} {getTranslation(locale, 'localApiKeyNoLongerUsed')}
              </p>
            </div>

            {/* Admin Panel Content - visibility controlled by isAdminPanelContentVisible */}
            {isAdminPanelContentVisible && (
              <>
                <hr/>
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

                <hr/>
                <div className="space-y-3">
                    <h3 className="font-medium flex items-center"><CloudDownload className="mr-2 h-5 w-5 text-primary" />{getTranslation(locale, 'manualCachingLabel')}</h3>
                    <div>
                        <Button onClick={handleCacheGlobalMusic} variant="outline" className="w-full" disabled={isCachingGlobal}>
                            {isCachingGlobal && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
                        <Button onClick={handleCacheUserRecords} variant="outline" className="w-full mt-1" disabled={!cacheNickname.trim() || isCachingUser}>
                            {isCachingUser && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
                <p className="text-muted-foreground">{getTranslation(locale, 'contactInfoBugReport')} <a href="https://x.com/Shirakami_cocoa" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">@Shirakami_cocoa</a></p>
                {clientHasMounted && (
                  <p className="text-xs text-muted-foreground mt-1">{getTranslation(locale, 'appVersion')}</p>
                )}
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={toggleAdminPanelContent} variant="outline" className="w-full">
                <ShieldAlert className="mr-2 h-4 w-4" />
                {isAdminPanelContentVisible ? getTranslation(locale, 'adminPanelToggleHide') : getTranslation(locale, 'adminPanelToggleShow')}
            </Button>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
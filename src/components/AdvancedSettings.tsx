
"use client";

import { useState, useEffect, type ChangeEvent } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { setCachedData, LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_CACHE_EXPIRY_MS } from "@/lib/cache";
import { KeyRound, Trash2, CloudDownload, UserCircle, DatabaseZap, Settings, FlaskConical, ShieldAlert, Brain, Loader2, LogIn } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { getTranslation } from "@/lib/translations";

export default function AdvancedSettings() {
  const [localApiTokenInput, setLocalApiTokenInput] = useState("");
  const [cacheNickname, setCacheNickname] = useState("");
  const [isCachingGlobal, setIsCachingGlobal] = useState(false);
  const [isCachingUser, setIsCachingUser] = useState(false);
  const [clientHasMounted, setClientHasMounted] = useState(false);

  const [nameInput, setNameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [isDeveloperAuthenticated, setIsDeveloperAuthenticated] = useState(false);
  const [showDeveloperToolsDetails, setShowDeveloperToolsDetails] = useState(false);

  const { toast } = useToast();
  const { locale } = useLanguage();

  useEffect(() => {
    setClientHasMounted(true);
    if (typeof window !== 'undefined') {
      const storedToken = localStorage.getItem('chuniCalcData_userApiToken');
      if (storedToken) {
        setLocalApiTokenInput(storedToken);
      }
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
        localStorage.setItem('chuniCalcData_userApiToken', localApiTokenInput.trim());
        toast({
            title: getTranslation(locale, 'toastSuccessLocalApiKeySaved'),
            description: getTranslation(locale, 'toastSuccessLocalApiKeyActuallySavedDesc') // Changed translation key
        });
      }
    }
  };

  const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPasswordInput(e.target.value);
  };

  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setNameInput(e.target.value);
  };

  const handleAuthenticate = () => {
    const adminName = process.env.NEXT_PUBLIC_ADMIN_NAME1;
    const adminPassword = process.env.NEXT_PUBLIC_ADMIN_PASSWORD;

    if (adminName && nameInput === adminName && adminPassword && passwordInput === adminPassword) {
      setIsDeveloperAuthenticated(true);
      setNameInput(""); 
      setPasswordInput(""); 
      toast({ title: getTranslation(locale, 'authenticationSuccessToast') });
    } else {
      toast({
        title: getTranslation(locale, 'authenticationFailedToast'), 
        variant: "destructive"
      });
      setNameInput(""); 
      setPasswordInput(""); 
    }
  };

  const toggleShowDeveloperToolsDetails = () => {
    setShowDeveloperToolsDetails(prev => !prev);
  };

  const handleClearAllLocalData = () => {
    if (typeof window !== 'undefined') {
      let clearedCount = 0;
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(LOCAL_STORAGE_PREFIX) && key !== 'chuniCalcData_userApiToken') {
            keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        clearedCount++;
      });
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
      const data = await response.json();
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
        <CardDescription>
          {getTranslation(locale, 'advancedSettingsDesc')}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6 pt-6">
        <div className="space-y-2">
          <Label htmlFor="localApiTokenInput" className="flex items-center font-medium">
            <KeyRound className="mr-2 h-5 w-5 text-primary" /> {getTranslation(locale, 'localApiKeyLabel')}
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
            {getTranslation(locale, 'localApiKeyHelpUpdated')}
          </p>
        </div>

        <hr/>

        <div className="text-sm">
            <h3 className="font-medium mb-1">{getTranslation(locale, 'contactInfoLabel')}</h3>
            <p className="text-muted-foreground">{getTranslation(locale, 'contactInfoBugReport')} <a href="https://x.com/Shirakami_cocoa" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">@Shirakami_cocoa</a></p>
            {clientHasMounted && (
              <p className="text-xs text-muted-foreground mt-1">{getTranslation(locale, 'appVersion')}</p>
            )}
        </div>
      </CardContent>

      {!isDeveloperAuthenticated ? (
        <CardFooter className="border-t pt-6 flex-col space-y-3">
          <div className="w-full space-y-1">
            <Label htmlFor="adminNameInput" className="flex items-center font-medium">
              <UserCircle className="mr-2 h-5 w-5 text-orange-500" /> 
              {getTranslation(locale, 'adminNameLabel', "Admin Name")} 
            </Label>
            <Input
              id="adminNameInput"
              type="text"
              placeholder={getTranslation(locale, 'adminNamePlaceholder', "Enter admin name")}
              value={nameInput}
              onChange={handleNameChange}
              onKeyDown={(e) => e.key === 'Enter' && handleAuthenticate()}
            />
          </div>
          <div className="w-full space-y-1 mt-2">
            <Label htmlFor="adminPasswordInput" className="flex items-center font-medium">
              <ShieldAlert className="mr-2 h-5 w-5 text-orange-500" /> 
              {getTranslation(locale, 'adminPasswordLabel')}
            </Label>
            <Input
              id="adminPasswordInput"
              type="password"
              placeholder={getTranslation(locale, 'adminPasswordPlaceholder')}
              value={passwordInput}
              onChange={handlePasswordChange}
              onKeyDown={(e) => e.key === 'Enter' && handleAuthenticate()}
            />
          </div>
          <Button onClick={handleAuthenticate} className="w-full mt-2">
            <LogIn className="mr-2 h-4 w-4" /> {getTranslation(locale, 'authenticateButton')}
          </Button>
        </CardFooter>
      ) : (
        <>
          <CardHeader className="border-t pt-6">
            <CardTitle className="font-headline text-xl flex items-center">
              <FlaskConical className="mr-2 h-5 w-5 text-purple-500" />
              {getTranslation(locale, 'developerSectionTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <Button onClick={toggleShowDeveloperToolsDetails} variant="outline" className="w-full">
              <Settings className="mr-2 h-4 w-4"/>
              {showDeveloperToolsDetails ? getTranslation(locale, 'developerToolsToggleHide') : getTranslation(locale, 'developerToolsToggleShow')}
            </Button>

            {showDeveloperToolsDetails && (
              <div className="space-y-4 pt-3 border-t mt-3">
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
                        <Label htmlFor="cacheNicknameDev" className="text-sm">{getTranslation(locale, 'cacheUserNicknameLabel')}</Label>
                         <Input
                            id="cacheNicknameDev"
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
              </div>
            )}
          </CardContent>
          <CardFooter className="border-t pt-3 pb-3">
            <p className="text-xs text-muted-foreground text-center w-full">
              {getTranslation(locale, 'developerModeActiveMessage')}
            </p>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
    

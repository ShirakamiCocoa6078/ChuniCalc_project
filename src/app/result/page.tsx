
"use client";

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import SongCard from "@/components/SongCard";
import { User, Gauge, Target as TargetIconLucide, ArrowLeft, Loader2, AlertTriangle, BarChart3, TrendingUp, TrendingDown, RefreshCw, Info, Settings2, Activity, Zap, Replace, Rocket, Telescope, CheckCircle2, XCircle, Brain, PlaySquare, ListChecks, FilterIcon, DatabaseZap, FileJson, Server, CalendarDays, BarChartHorizontalBig, FileSearch, Shuffle, Hourglass, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslation } from '@/lib/translations';
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useChuniResultData } from "@/hooks/useChuniResultData"; 
import type { CalculationStrategy } from "@/types/result-page"; 
import { getApiToken } from '@/lib/get-api-token';
import { LOCAL_STORAGE_PREFIX, GLOBAL_MUSIC_DATA_KEY } from '@/lib/cache';
import { useToast } from "@/hooks/use-toast";


function ResultContent() {
  const searchParams = useSearchParams();
  const { locale } = useLanguage();
  const { toast } = useToast();
  
  const initialUserName = searchParams.get("nickname");
  const initialCurrentRating = searchParams.get("current");
  const initialTargetRating = searchParams.get("target");

  const [userNameForApi, setUserNameForApi] = useState<string | null>(null);
  const [currentRatingDisplay, setCurrentRatingDisplay] = useState<string | null>(null);
  const [targetRatingDisplay, setTargetRatingDisplay] = useState<string | null>(null);

  const [calculationStrategy, setCalculationStrategy] = useState<CalculationStrategy | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [clientHasMounted, setClientHasMounted] = useState(false);

  useEffect(() => {
    setClientHasMounted(true);
    setUserNameForApi(initialUserName || getTranslation(locale, 'resultPageDefaultPlayerName'));
    setCurrentRatingDisplay(initialCurrentRating || getTranslation(locale, 'resultPageNotAvailable'));
    setTargetRatingDisplay(initialTargetRating || getTranslation(locale, 'resultPageNotAvailable'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUserName, initialCurrentRating, initialTargetRating, locale]);

  const {
    apiPlayerName,
    best30SongsData, 
    new20SongsData,
    combinedTopSongs,
    isLoadingSongs,
    errorLoadingSongs,
    lastRefreshed,
    phaseTransitionPoint,
    currentPhase,
    simulatedAverageB30Rating,
    simulatedAverageNew20Rating,
    finalOverallSimulatedRating,
    simulationLog,
  } = useChuniResultData({
    userNameForApi,
    currentRatingDisplay,
    targetRatingDisplay,
    locale,
    refreshNonce,
    clientHasMounted,
    calculationStrategy,
  });

  const handleRefreshData = useCallback(() => {
    const defaultPlayerName = getTranslation(locale, 'resultPageDefaultPlayerName');
    if (typeof window !== 'undefined' && userNameForApi && userNameForApi !== defaultPlayerName) {
        const profileKey = `${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`;
        const ratingDataKey = `${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`;
        const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`;
        
        localStorage.removeItem(profileKey);
        localStorage.removeItem(ratingDataKey);
        localStorage.removeItem(userShowallKey);
        // Global music data is not user-specific, but might be good to clear if forcing a full refresh
        localStorage.removeItem(GLOBAL_MUSIC_DATA_KEY);

        console.log(`[CACHE_CLEAR_ON_REFRESH] User-specific (${userNameForApi}) data and global music cleared for refresh trigger.`);
        toast({ title: getTranslation(locale, 'resultPageToastRefreshingDataTitle'), description: getTranslation(locale, 'resultPageToastRefreshingDataDesc')});
    } else {
        localStorage.removeItem(GLOBAL_MUSIC_DATA_KEY);
        console.log(`[CACHE_CLEAR_ON_REFRESH] Global music cache cleared (no specific user or default user).`);
        toast({ title: getTranslation(locale, 'resultPageToastRefreshingDataTitle'), description: "글로벌 음악 목록 캐시를 삭제하고 새로고침을 시도합니다."});
    }
    setCalculationStrategy(null); 
    setRefreshNonce(prev => prev + 1);
  }, [userNameForApi, locale, toast]);


  const best30GridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

  const renderSimulationStatus = () => {
    let statusText = "";
    let bgColor = "bg-blue-100 dark:bg-blue-900";
    let textColor = "text-blue-700 dark:text-blue-300";
    let IconComponent: React.ElementType = Info;
    let iconShouldSpin = false;
    
    const b30AvgStr = (typeof simulatedAverageB30Rating === 'number' && !isNaN(simulatedAverageB30Rating)) 
        ? simulatedAverageB30Rating.toFixed(4) 
        : 'N/A';
    const n20AvgStr = (typeof simulatedAverageNew20Rating === 'number' && !isNaN(simulatedAverageNew20Rating)) 
        ? simulatedAverageNew20Rating.toFixed(4) 
        : 'N/A';
    const overallRatingStr = (typeof finalOverallSimulatedRating === 'number' && !isNaN(finalOverallSimulatedRating))
        ? finalOverallSimulatedRating.toFixed(4)
        : 'N/A';


    if (errorLoadingSongs) {
        statusText = getTranslation(locale, 'resultPageErrorLoadingTitle') + `: ${errorLoadingSongs}`;
        bgColor = "bg-red-100 dark:bg-red-900"; textColor = "text-red-700 dark:text-red-300"; IconComponent = AlertTriangle;
    } else if (isLoadingSongs) {
      statusText = getTranslation(locale, 'resultPageLoadingSongsTitle');
      IconComponent = Loader2; iconShouldSpin = true;
    } else if (!calculationStrategy) {
        statusText = getTranslation(locale, 'resultPageStrategyTitle') + "에서 계산 기준을 선택하여 시뮬레이션을 시작하세요.";
        bgColor = "bg-yellow-100 dark:bg-yellow-900"; textColor = "text-yellow-700 dark:text-yellow-300"; IconComponent = Brain;
    } else {
        switch (currentPhase) {
          case 'idle':
            if (currentRatingDisplay && targetRatingDisplay && parseFloat(currentRatingDisplay) >= parseFloat(targetRatingDisplay)) {
                statusText = "현재 레이팅이 목표 레이팅과 같거나 높습니다. 시뮬레이션이 필요하지 않습니다.";
                bgColor = "bg-green-100 dark:bg-green-900"; textColor = "text-green-700 dark:text-green-300"; IconComponent = CheckCircle2;
            } else if (typeof simulatedAverageB30Rating === 'number' && !isNaN(simulatedAverageB30Rating) && targetRatingDisplay && simulatedAverageB30Rating >= parseFloat(targetRatingDisplay) ){
                 statusText = `목표 달성! 최종 시뮬레이션 평균 B30 레이팅: ${b30AvgStr}`;
                 bgColor = "bg-green-100 dark:bg-green-900"; textColor = "text-green-700 dark:text-green-300"; IconComponent = TargetIconLucide;
            } else {
                 statusText = "시뮬레이션 대기 중. 조건 충족 시 자동으로 시작됩니다.";
                 IconComponent = PlaySquare;
            }
            break;
          case 'simulating':
             statusText = "시뮬레이션 실행 중... (로직 수행 중)";
             IconComponent = Activity; iconShouldSpin = true;
             break;
          case 'target_reached':
            statusText = `목표 달성! 최종 전체 레이팅: ${overallRatingStr} (B30: ${b30AvgStr}, N20: ${n20AvgStr})`;
            bgColor = "bg-green-100 dark:bg-green-900"; textColor = "text-green-700 dark:text-green-300"; IconComponent = TargetIconLucide;
            break;
          case 'stuck_b30_no_improvement':
            statusText = "B30 개선 불가. N20 시뮬레이션으로 전환 또는 완료. 현재 전체: " + overallRatingStr;
            bgColor = "bg-yellow-100 dark:bg-yellow-900"; textColor = "text-yellow-700 dark:text-yellow-300"; IconComponent = Replace;
            break;
          case 'stuck_n20_no_improvement':
            statusText = "N20 개선 불가. B30 시뮬레이션으로 전환 또는 완료. 현재 전체: " + overallRatingStr;
            bgColor = "bg-yellow-100 dark:bg-yellow-900"; textColor = "text-yellow-700 dark:text-yellow-300"; IconComponent = Replace;
            break;
          case 'stuck_both_no_improvement':
            statusText = "B30 및 N20 모두에서 더 이상 개선할 수 없습니다. 최종 전체: " + overallRatingStr;
            bgColor = "bg-orange-100 dark:bg-orange-900"; textColor = "text-orange-700 dark:text-orange-300"; IconComponent = XCircle;
            break;
          case 'error_data_fetch': // This phase is from the hook if initial data fails
            statusText = `데이터 로딩 오류: ${errorLoadingSongs || '알 수 없는 오류'}`;
            bgColor = "bg-red-100 dark:bg-red-900"; textColor = "text-red-700 dark:text-red-300"; IconComponent = AlertTriangle;
            break;
          case 'error_simulation_logic': // This phase is from the hook if pure function returns error
            statusText = `시뮬레이션 로직 오류: ${simulationLog.find(log => log.toLowerCase().includes("error")) || '알 수 없는 시뮬레이션 오류'}`;
            bgColor = "bg-red-100 dark:bg-red-900"; textColor = "text-red-700 dark:text-red-300"; IconComponent = AlertTriangle;
            break;
          default:
            statusText = `알 수 없는 페이즈: ${currentPhase || 'N/A'}. 전체: ${overallRatingStr}`;
            IconComponent = AlertTriangle;
        }
    }

    // Append averages and PTP only if not an error/loading state and if strategy is selected
    if (calculationStrategy && !isLoadingSongs && !errorLoadingSongs && currentPhase !== 'error_data_fetch' && currentPhase !== 'error_simulation_logic') {
        if (currentPhase !== 'idle' && currentPhase !== 'target_reached') { // Don't show intermediate averages if already target_reached or idle (unless idle shows final)
            let detailString = "";
            if (typeof simulatedAverageB30Rating === 'number' && !isNaN(simulatedAverageB30Rating)) {
                detailString += ` (B30 평균: ${simulatedAverageB30Rating.toFixed(4)}`;
                if (typeof simulatedAverageNew20Rating === 'number' && !isNaN(simulatedAverageNew20Rating) && new20SongsData.length > 0) {
                    detailString += `, N20 평균: ${simulatedAverageNew20Rating.toFixed(4)}`;
                }
                detailString += ")";
            }
             if (statusText.includes("...")) { // If it's a "simulating" type message.
                statusText = statusText.replace("...", detailString + "...");
             } else if (currentPhase !== 'target_reached') { // Avoid appending if target already displayed its own full message
                statusText += detailString;
             }
        }

        if (typeof phaseTransitionPoint === 'number' && !isNaN(phaseTransitionPoint) && currentPhase !== 'target_reached') {
            statusText += ` (미세조정 전환점: ${phaseTransitionPoint.toFixed(4)})`;
        }
    }
    

    return (
      <div className={cn("p-3 my-4 rounded-md text-sm flex items-center shadow-md", bgColor, textColor)}>
        <IconComponent className={cn("w-5 h-5 mr-3 shrink-0", iconShouldSpin && "animate-spin")} />
        <p>{statusText}</p>
      </div>
    );
  };


  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 p-4 bg-card border border-border rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex items-center gap-3">
            <User className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold font-headline">{apiPlayerName || userNameForApi || getTranslation(locale, 'resultPageDefaultPlayerName')}</h1>
              <Link href="/" className="text-sm text-primary hover:underline flex items-center">
                <ArrowLeft className="w-4 h-4 mr-1" /> {getTranslation(locale, 'resultPageButtonBackToCalc')}
              </Link>
            </div>
          </div>
          <div className="flex flex-col sm:items-end items-stretch gap-2">
            <div className="flex items-center justify-end gap-2 text-sm sm:text-base w-full">
              <div className="flex items-center p-2 bg-secondary rounded-md">
                <Gauge className="w-5 h-5 mr-2 text-primary" />
                <span>{getTranslation(locale, 'resultPageHeaderCurrent')} <span className="font-semibold">{currentRatingDisplay}</span></span>
              </div>
              <div className="flex items-center p-2 bg-secondary rounded-md">
                <TargetIconLucide className="w-5 h-5 mr-2 text-primary" />
                <span>{getTranslation(locale, 'resultPageHeaderTarget')} <span className="font-semibold">{targetRatingDisplay}</span></span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 w-full">
                <LanguageToggle />
                <ThemeToggle /> 
            </div>
          </div>
        </header>

        <div className="mb-4 flex flex-col sm:flex-row justify-between items-center gap-2">
            <p className="text-xs text-muted-foreground">
                {clientHasMounted && lastRefreshed
                    ? lastRefreshed
                    : getTranslation(locale, 'resultPageSyncStatusChecking')}
            </p>
            <Button 
                onClick={handleRefreshData} 
                variant="outline" 
                size="sm" 
                disabled={isLoadingSongs || !userNameForApi || userNameForApi === getTranslation(locale, 'resultPageDefaultPlayerName') || !getApiToken()}
            >
                <RefreshCw className={cn("w-4 h-4 mr-2", isLoadingSongs && "animate-spin")} />
                {getTranslation(locale, 'resultPageRefreshButton')}
            </Button>
        </div>

        <Card className="mb-6 shadow-md">
          <CardHeader>
            <CardTitle className="font-headline text-xl">{getTranslation(locale, 'resultPageStrategyTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={calculationStrategy || "none"} 
              onValueChange={(value) => {
                if (value === "none") {
                  setCalculationStrategy(null);
                } else {
                  setCalculationStrategy(value as CalculationStrategy);
                }
              }}
              className="grid grid-cols-1 sm:grid-cols-3 gap-2" 
            >
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors flex-1">
                <RadioGroupItem value="floor" id="r-floor" />
                <Label htmlFor="r-floor" className="flex items-center cursor-pointer w-full text-xs sm:text-sm">
                  <TrendingDown className="w-4 h-4 mr-1 sm:mr-2 text-green-600" /> {getTranslation(locale, 'resultPageStrategyFloor')}
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors flex-1">
                <RadioGroupItem value="peak" id="r-peak" />
                <Label htmlFor="r-peak" className="flex items-center cursor-pointer w-full text-xs sm:text-sm">
                  <TrendingUp className="w-4 h-4 mr-1 sm:mr-2 text-destructive" /> {getTranslation(locale, 'resultPageStrategyPeak')}
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors flex-1">
                <RadioGroupItem value="none" id="r-none" />
                <Label htmlFor="r-none" className="flex items-center cursor-pointer w-full text-xs sm:text-sm">
                  <X className="w-4 h-4 mr-1 sm:mr-2 text-muted-foreground" /> {getTranslation(locale, 'resultPageStrategyNone')}
                </Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        {renderSimulationStatus()}

        <Tabs defaultValue="best30" className="w-full">
          <TabsList className="grid w-full grid-cols-3 gap-1 mb-6 bg-muted p-1 rounded-lg shadow-inner">
            <TabsTrigger value="best30" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">{getTranslation(locale, 'resultPageTabBest30')}</TabsTrigger>
            <TabsTrigger value="new20" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">{getTranslation(locale, 'resultPageTabNew20')}</TabsTrigger>
            <TabsTrigger value="combined" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">{getTranslation(locale, 'resultPageTabCombined')}</TabsTrigger>
          </TabsList>

          {(isLoadingSongs && !calculationStrategy && currentPhase !== 'error_data_fetch' && currentPhase !== 'error_simulation_logic') ? ( 
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-xl text-muted-foreground">{getTranslation(locale, 'resultPageLoadingSongsTitle')}</p>
              <p className="text-sm text-muted-foreground">
                { clientHasMounted && userNameForApi && userNameForApi !== getTranslation(locale, 'resultPageDefaultPlayerName')
                  ? ( (localStorage.getItem(`${LOCAL_STORAGE_PREFIX}profile_${userNameForApi}`) || localStorage.getItem(`${LOCAL_STORAGE_PREFIX}rating_data_${userNameForApi}`)) 
                    ? getTranslation(locale, 'resultPageLoadingCacheCheck')
                    : getTranslation(locale, 'resultPageLoadingApiFetch'))
                  : getTranslation(locale, 'resultPageLoadingDataStateCheck')
                }
              </p>
            </div>
          ) : errorLoadingSongs ? (
             <Card className="border-destructive/50 shadow-lg">
                <CardHeader className="flex flex-row items-center space-x-2">
                    <AlertTriangle className="w-6 h-6 text-destructive" />
                    <CardTitle className="font-headline text-xl text-destructive">{getTranslation(locale, 'resultPageErrorLoadingTitle')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>{errorLoadingSongs}</p>
                    <p className="text-sm text-muted-foreground mt-2">{getTranslation(locale, 'resultPageErrorLoadingDesc')}</p>
                </CardContent>
            </Card>
          ) : !isLoadingSongs && best30SongsData.length === 0 && new20SongsData.length === 0 && calculationStrategy && currentPhase === 'idle' ? ( 
             <Card className="border-orange-500/50 shadow-lg">
                <CardHeader className="flex flex-row items-center space-x-2">
                    <Info className="w-6 h-6 text-orange-500" />
                    <CardTitle className="font-headline text-xl text-orange-600">{getTranslation(locale, 'resultPageNoBest30Data')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>{getTranslation(locale, 'resultPageErrorLoadingDesc')}</p>
                     <p className="text-sm mt-1">API 응답에 유효한 Best 30 또는 New 20 곡 데이터가 없습니다. Chunirec 데이터를 확인하거나 새로고침 해보세요.</p>
                </CardContent>
            </Card>
          ) : (
            <>
              <TabsContent value="best30">
                <Card className="shadow-md">
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">{getTranslation(locale, 'resultPageCardTitleBest30')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {best30SongsData.length > 0 ? (
                      <div className={cn("grid grid-cols-1 gap-4", best30GridCols)}>
                        {best30SongsData.map((song) => (
                          <SongCard key={`best30-${song.id}-${song.diff}`} song={song} calculationStrategy={calculationStrategy} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">{getTranslation(locale, 'resultPageNoBest30Data')}</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="new20">
                <Card className="shadow-md">
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">{getTranslation(locale, 'resultPageCardTitleNew20')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                       {new20SongsData.length > 0 ? (
                         <div className={cn("grid grid-cols-1 gap-4", best30GridCols )}>
                           {new20SongsData.map((song) => (
                             <SongCard key={`new20-${song.id}-${song.diff}`} song={song} calculationStrategy={calculationStrategy} />
                           ))}
                         </div>
                       ) : (
                         <p className="text-muted-foreground">{getTranslation(locale, 'resultPageNoNew20Data')}</p>
                       )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="combined">
                <Card className="shadow-md">
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">{getTranslation(locale, 'resultPageCardTitleCombined')}</CardTitle>
                  </CardHeader>
                  <CardContent> 
                    {combinedTopSongs.length > 0 ? (
                      <div className={cn("grid grid-cols-1 gap-4", best30GridCols)}>
                        {combinedTopSongs.map((song) => (
                          <SongCard key={`combined-${song.id}-${song.diff}`} song={song} calculationStrategy={calculationStrategy} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">{getTranslation(locale, 'resultPageNoCombinedData')}</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </>
          )
        }
        </Tabs>
      </div>
    </main>
  );
}

export default function ResultPage() {
  const { locale } = useLanguage();
  return (
    <Suspense fallback={<div className="flex min-h-screen flex-col items-center justify-center text-xl"><Loader2 className="w-10 h-10 animate-spin mr-2" /> {getTranslation(locale, 'resultPageSuspenseFallback')}</div>}>
      <ResultContent />
    </Suspense>
  );
}


    

    
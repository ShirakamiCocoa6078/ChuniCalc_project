
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
import { User, Gauge, Target as TargetIconLucide, ArrowLeft, Loader2, AlertTriangle, BarChart3, TrendingUp, TrendingDown, RefreshCw, Info, Settings2, Activity, Zap, Replace } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslation } from '@/lib/translations';
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useChuniResultData } from "@/hooks/useChuniResultData"; 
import type { CalculationStrategy } from "@/types/result-page"; 
import { getApiToken } from '@/lib/get-api-token';
import { LOCAL_STORAGE_PREFIX } from '@/lib/cache';


function ResultContent() {
  const searchParams = useSearchParams();
  const { locale } = useLanguage();
  
  const initialUserName = searchParams.get("nickname");
  const initialCurrentRating = searchParams.get("current");
  const initialTargetRating = searchParams.get("target");

  const [userNameForApi, setUserNameForApi] = useState<string | null>(null);
  const [currentRatingDisplay, setCurrentRatingDisplay] = useState<string | null>(null);
  const [targetRatingDisplay, setTargetRatingDisplay] = useState<string | null>(null);

  const [calculationStrategy, setCalculationStrategy] = useState<CalculationStrategy>("average");
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
    isScoreLimitReleased, // 0-2
    phaseTransitionPoint, // 0-4
    currentPhase, // 시뮬레이션 페이즈
    simulatedAverageB30Rating, // 시뮬레이션된 B30 평균
    // updatableForLeapPhase, // 1-1 (디버깅용으로 필요시 추가)
    // leapTargetGroup, // 1-1 (디버깅용으로 필요시 추가)
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
        const userShowallKey = `${LOCAL_STORAGE_PREFIX}showall_${userNameForApi}`; // If used
        const combinedDataKey = `${LOCAL_STORAGE_PREFIX}combined_b30_n20_${userNameForApi}`; // If used
        const globalMusicKey = GLOBAL_MUSIC_DATA_KEY; // If used
        
        localStorage.removeItem(profileKey);
        localStorage.removeItem(ratingDataKey);
        localStorage.removeItem(userShowallKey);
        localStorage.removeItem(combinedDataKey);
        localStorage.removeItem(globalMusicKey); // Global music is shared but can be refreshed
        console.log(`User-specific and global music cache (if applicable) cleared for refresh trigger related to user: ${userNameForApi}`);
        toast({ title: getTranslation(locale, 'resultPageToastRefreshingDataTitle'), description: getTranslation(locale, 'resultPageToastRefreshingDataDesc')});
    }
    setRefreshNonce(prev => prev + 1);
  }, [userNameForApi, locale, toast]);


  const best30GridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

  const renderSimulationStatus = () => {
    if (isLoadingSongs && currentPhase === 'idle') return null; // 데이터 로드 중일 때는 다른 로딩 메시지가 표시됨
    
    let statusText = "";
    let bgColor = "bg-blue-100 dark:bg-blue-900";
    let textColor = "text-blue-700 dark:text-blue-300";
    let IconComponent: React.ElementType = Info;

    switch (currentPhase) {
      case 'idle':
        statusText = "시뮬레이션 대기 중. 계산 기준을 선택하고 데이터가 로드되면 시작됩니다.";
        if (parseFloat(currentRatingDisplay || "0") >= parseFloat(targetRatingDisplay || "0")) {
            statusText = "현재 레이팅이 목표 레이팅과 같거나 높습니다. 시뮬레이션이 필요하지 않습니다.";
            bgColor = "bg-green-100 dark:bg-green-900"; textColor = "text-green-700 dark:text-green-300";
        }
        break;
      case 'initializing_leap_phase':
        statusText = "도약 페이즈 초기화 중: 대상 그룹을 결정하고 있습니다...";
        IconComponent = Settings2;
        break;
      case 'analyzing_leap_efficiency':
        statusText = "도약 페이즈: 곡별 효율성 분석 중...";
        IconComponent = Activity;
        break;
      case 'performing_leap_jump':
        statusText = "도약 페이즈: 최적 대상 곡 점수 상승 실행 중...";
        IconComponent = Zap;
        break;
      case 'evaluating_leap_result':
        statusText = "도약 페이즈: 결과 확인 및 다음 단계 판단 중...";
        IconComponent = BarChart3;
        break;
      case 'transitioning_to_fine_tuning':
        statusText = "페이즈 전환: 미세 조정 페이즈로 이동합니다...";
        break;
      case 'initializing_fine_tuning_phase':
        statusText = "미세 조정 페이즈 초기화 중: 대상 그룹 결정 중...";
        IconComponent = Settings2;
        break;
      case 'performing_fine_tuning':
        statusText = "미세 조정 페이즈: 점수 미세 조정 실행 중...";
        IconComponent = TrendingUp;
        break;
      case 'evaluating_fine_tuning_result':
        statusText = "미세 조정 페이즈: 결과 확인 중...";
        IconComponent = BarChart3;
        break;
      case 'target_reached':
        statusText = `목표 달성! 최종 시뮬레이션 평균 B30 레이팅: ${simulatedAverageB30Rating?.toFixed(4) || 'N/A'}`;
        bgColor = "bg-green-100 dark:bg-green-900"; textColor = "text-green-700 dark:text-green-300";
        IconComponent = TargetIconLucide;
        break;
      case 'stuck_awaiting_replacement':
        statusText = "현재 페이즈에서 더 이상 점수 상승이 불가능합니다. 곡 교체 로직을 준비합니다...";
        bgColor = "bg-yellow-100 dark:bg-yellow-900"; textColor = "text-yellow-700 dark:text-yellow-300";
        IconComponent = Replace;
        break;
      case 'error':
        statusText = "시뮬레이션 중 오류가 발생했습니다. 콘솔을 확인해주세요.";
        bgColor = "bg-red-100 dark:bg-red-900"; textColor = "text-red-700 dark:text-red-300";
        IconComponent = AlertTriangle;
        break;
      default:
        statusText = `알 수 없는 페이즈: ${currentPhase}`;
    }

    if (simulatedAverageB30Rating !== null && currentPhase !== 'target_reached' && currentPhase !== 'idle') {
      statusText += ` (현재 시뮬레이션 B30 평균: ${simulatedAverageB30Rating.toFixed(4)})`;
    }
    if (phaseTransitionPoint !== null && (currentPhase.includes('leap') || currentPhase.includes('fine_tuning') || currentPhase === 'idle')) {
      statusText += ` (페이즈 전환점: ${phaseTransitionPoint.toFixed(4)})`;
    }
     if (isScoreLimitReleased) {
      statusText += ` (점수 상한 한계 해제됨)`;
    }


    return (
      <div className={cn("p-3 my-4 rounded-md text-sm flex items-center shadow", bgColor, textColor)}>
        <IconComponent className="w-5 h-5 mr-3 shrink-0" />
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

        {/* 0-3단계: 사용자 선택 기능 UI */}
        <Card className="mb-6 shadow-md">
          <CardHeader>
            <CardTitle className="font-headline text-xl">{getTranslation(locale, 'resultPageStrategyTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={calculationStrategy} 
              onValueChange={(value) => {
                setCalculationStrategy(value as CalculationStrategy);
                // setCurrentPhase('idle'); // 전략 변경 시 시뮬레이션 상태 초기화 (필요시)
              }}
              className="flex flex-col sm:flex-row gap-4"
            >
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors flex-1">
                <RadioGroupItem value="average" id="r-average" />
                <Label htmlFor="r-average" className="flex items-center cursor-pointer w-full">
                  <BarChart3 className="w-5 h-5 mr-2 text-primary" /> {getTranslation(locale, 'resultPageStrategyAverage')}
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors flex-1">
                <RadioGroupItem value="floor" id="r-floor" />
                <Label htmlFor="r-floor" className="flex items-center cursor-pointer w-full">
                  <TrendingDown className="w-5 h-5 mr-2 text-green-600" /> {getTranslation(locale, 'resultPageStrategyFloor')}
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors flex-1">
                <RadioGroupItem value="peak" id="r-peak" />
                <Label htmlFor="r-peak" className="flex items-center cursor-pointer w-full">
                  <TrendingUp className="w-5 h-5 mr-2 text-destructive" /> {getTranslation(locale, 'resultPageStrategyPeak')}
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

          {isLoadingSongs && currentPhase === 'idle' ? ( 
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
             <Card className="border-destructive shadow-lg">
              <CardHeader className="flex flex-row items-center space-x-2">
                <AlertTriangle className="w-6 h-6 text-destructive" />
                <CardTitle className="font-headline text-xl text-destructive">{getTranslation(locale, 'resultPageErrorLoadingTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-destructive">{errorLoadingSongs}</p>
                <p className="text-sm text-muted-foreground mt-2">{getTranslation(locale, 'resultPageErrorLoadingDesc')}</p>
                <Button asChild variant="outline" className="mt-4">
                  <Link href="/">{getTranslation(locale, 'resultPageButtonBackToCalc')}</Link>
                </Button>
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
          )}
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

    
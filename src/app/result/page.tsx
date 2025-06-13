
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
import { User, Gauge, Target as TargetIconLucide, ArrowLeft, Loader2, AlertTriangle, BarChart3, TrendingUp, TrendingDown, RefreshCw, Info, Settings2, Activity, Zap, Replace, Rocket, Telescope, CheckCircle2, XCircle, Brain, PlaySquare, ListChecks, FilterIcon, DatabaseZap, FileJson, Server, CalendarDays, BarChartHorizontalBig, FileSearch, Shuffle } from "lucide-react";
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
    // isScoreLimitReleased,
    phaseTransitionPoint,
    currentPhase,
    simulatedAverageB30Rating,
    // updatableForLeapPhase, 
    // leapTargetGroup, 
    // songsWithLeapEfficiency,
    // songToReplace,
    // optimalCandidateSong,
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
        localStorage.removeItem(GLOBAL_MUSIC_DATA_KEY);
        console.log(`User-specific (${userNameForApi}) and global music cache cleared for refresh trigger.`);
        toast({ title: getTranslation(locale, 'resultPageToastRefreshingDataTitle'), description: getTranslation(locale, 'resultPageToastRefreshingDataDesc')});
    } else {
        localStorage.removeItem(GLOBAL_MUSIC_DATA_KEY);
        console.log(`Global music cache cleared for refresh trigger (no specific user).`);
        toast({ title: getTranslation(locale, 'resultPageToastRefreshingDataTitle'), description: "글로벌 음악 목록 캐시를 삭제하고 새로고침을 시도합니다."});
    }
    setRefreshNonce(prev => prev + 1);
  }, [userNameForApi, locale, toast]);


  const best30GridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

  const renderSimulationStatus = () => {
    let statusText = "";
    let bgColor = "bg-blue-100 dark:bg-blue-900";
    let textColor = "text-blue-700 dark:text-blue-300";
    let IconComponent: React.ElementType = Info;
    let iconShouldSpin = false;

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
            } else {
                 statusText = "시뮬레이션 대기 중. 조건 충족 시 자동으로 시작됩니다.";
                 IconComponent = PlaySquare;
            }
            break;
          case 'initializing_leap_phase':
            statusText = "도약 페이즈(1-1): 대상 그룹 결정 중...";
            IconComponent = ListChecks; iconShouldSpin = true;
            break;
          case 'analyzing_leap_efficiency':
            statusText = "도약 페이즈(1-2): 곡별 다음 등급 도약 효율성 분석 중...";
            IconComponent = Telescope; iconShouldSpin = true;
            break;
          case 'performing_leap_jump':
            statusText = "도약 페이즈(1-3): 최적 대상 곡 점수 상승 실행 중...";
            IconComponent = Rocket; iconShouldSpin = true;
            break;
          case 'evaluating_leap_result':
            statusText = "도약 페이즈(1-4): 결과 확인 및 다음 페이즈 판단 중...";
            IconComponent = BarChart3; iconShouldSpin = true;
            break;
          case 'transitioning_to_fine_tuning':
            statusText = "페이즈 전환: '미세 조정 페이즈'(과제 2)로 이동 준비 중...";
            IconComponent = Shuffle; iconShouldSpin = true;
            break;
          case 'initializing_fine_tuning_phase':
            statusText = "미세 조정 페이즈(2-1): 대상 그룹 결정 중...";
            IconComponent = FilterIcon; iconShouldSpin = true;
            break;
          case 'performing_fine_tuning':
            statusText = "미세 조정 페이즈(2-2): 점수 미세 조정 실행 중...";
            IconComponent = TrendingUp; iconShouldSpin = true;
            break;
          case 'evaluating_fine_tuning_result':
            statusText = "미세 조정 페이즈(2-3): 결과 확인 중...";
            IconComponent = Activity; iconShouldSpin = true;
            break;
          case 'target_reached':
            statusText = `목표 달성! 최종 시뮬레이션 평균 B30 레이팅: ${simulatedAverageB30Rating?.toFixed(4) || 'N/A'}`;
            bgColor = "bg-green-100 dark:bg-green-900"; textColor = "text-green-700 dark:text-green-300"; IconComponent = TargetIconLucide;
            break;
          case 'stuck_awaiting_replacement':
            statusText = "현재 페이즈에서 더 이상 점수 상승이 불가능합니다. B30 곡 교체 로직(과제3)으로 전환 대기 중...";
            bgColor = "bg-yellow-100 dark:bg-yellow-900"; textColor = "text-yellow-700 dark:text-yellow-300"; IconComponent = Replace;
            break;
          case 'awaiting_external_data_for_replacement':
            statusText = "곡 교체(3-1): 외부 데이터(전체 곡 목록/사용자 기록) 로딩 대기 중...";
            IconComponent = DatabaseZap; iconShouldSpin = true;
            break;
          case 'identifying_candidates':
            statusText = "곡 교체(3-2): B30 외부에서 교체 후보 곡 탐색 중...";
            IconComponent = FileSearch; iconShouldSpin = true;
            break;
          case 'candidates_identified':
            statusText = "곡 교체(3-2): 후보 곡 탐색 완료. 최적 후보 선정 준비 중...";
            IconComponent = CheckCircle2;
            break;
          case 'selecting_optimal_candidate':
            statusText = "곡 교체(3-2): 최적 교체 후보 선정 중...";
            IconComponent = Brain; iconShouldSpin = true;
            break;
          case 'optimal_candidate_selected':
            statusText = "곡 교체(3-2): 최적 교체 후보 선정 완료. B30 리스트 업데이트 준비 중...";
            IconComponent = CheckCircle2;
            break;
          case 'replacing_song':
             statusText = "곡 교체(3-2): B30 리스트 업데이트 및 평균 레이팅 재계산 중...";
             IconComponent = Replace; iconShouldSpin = true;
             break;
          case 'error':
            statusText = "시뮬레이션 중 오류가 발생했습니다. 콘솔을 확인해주세요.";
            bgColor = "bg-red-100 dark:bg-red-900"; textColor = "text-red-700 dark:text-red-300"; IconComponent = XCircle;
            break;
          default:
            statusText = `알 수 없는 페이즈: ${currentPhase || 'N/A'}`;
            IconComponent = AlertTriangle;
        }
    }

    if (simulatedAverageB30Rating !== null && currentPhase !== 'target_reached' && currentPhase !== 'idle' && !isLoadingSongs && !errorLoadingSongs) {
      statusText += ` (현재 B30 평균: ${simulatedAverageB30Rating.toFixed(4)})`;
    }
    if (phaseTransitionPoint !== null && currentPhase !== 'target_reached' && !isLoadingSongs && !errorLoadingSongs &&
        (currentPhase.includes('leap') || currentPhase.includes('fine_tuning') || currentPhase === 'idle' || currentPhase === 'evaluating_leap_result' || currentPhase === 'evaluating_fine_tuning_result')
    ) {
      statusText += ` (미세조정 전환점: ${phaseTransitionPoint.toFixed(4)})`;
    }
    //  if (isScoreLimitReleased && !isLoadingSongs && !errorLoadingSongs && currentPhase !== 'idle' && currentPhase !== 'target_reached') {
    //   statusText += ` (점수 상한 한계 해제됨)`;
    // }

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
              value={calculationStrategy || ""} 
              onValueChange={(value) => {
                setCalculationStrategy(value as CalculationStrategy);
                // setCurrentPhase('idle'); 
              }}
              className="flex flex-col sm:flex-row gap-4"
            >
              <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors flex-1">
                <RadioGroupItem value="average" id="r-average" />
                <Label htmlFor="r-average" className="flex items-center cursor-pointer w-full">
                  <BarChartHorizontalBig className="w-5 h-5 mr-2 text-primary" /> {getTranslation(locale, 'resultPageStrategyAverage')}
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
            {calculationStrategy && <p className="text-xs text-muted-foreground mt-3">{getTranslation(locale, 'resultPageStrategyDisclaimer')}</p>}
          </CardContent>
        </Card>

        {renderSimulationStatus()}

        <Tabs defaultValue="best30" className="w-full">
          <TabsList className="grid w-full grid-cols-3 gap-1 mb-6 bg-muted p-1 rounded-lg shadow-inner">
            <TabsTrigger value="best30" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">{getTranslation(locale, 'resultPageTabBest30')}</TabsTrigger>
            <TabsTrigger value="new20" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">{getTranslation(locale, 'resultPageTabNew20')}</TabsTrigger>
            <TabsTrigger value="combined" className="px-2 py-2 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">{getTranslation(locale, 'resultPageTabCombined')}</TabsTrigger>
          </TabsList>

          {(isLoadingSongs && currentPhase === 'idle' && !errorLoadingSongs) ? ( 
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
             <Card className="border-red-500/50 shadow-lg">
                <CardHeader className="flex flex-row items-center space-x-2">
                    <AlertTriangle className="w-6 h-6 text-red-500" />
                    <CardTitle className="font-headline text-xl text-red-600">{getTranslation(locale, 'resultPageErrorLoadingTitle')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>{errorLoadingSongs}</p>
                    <p className="text-sm text-muted-foreground mt-2">{getTranslation(locale, 'resultPageErrorLoadingDesc')}</p>
                </CardContent>
            </Card>
          ) : best30SongsData.length === 0 && new20SongsData.length === 0 && currentPhase === 'idle' ? ( 
             <Card className="border-orange-500/50 shadow-lg">
                <CardHeader className="flex flex-row items-center space-x-2">
                    <Info className="w-6 h-6 text-orange-500" />
                    <CardTitle className="font-headline text-xl text-orange-600">{getTranslation(locale, 'resultPageErrorLoadingTitle')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>{getTranslation(locale, 'resultPageNoBest30Data')}</p>
                    <p className="text-sm text-muted-foreground mt-2">{getTranslation(locale, 'resultPageErrorLoadingDesc')}</p>
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


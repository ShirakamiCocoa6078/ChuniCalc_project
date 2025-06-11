
"use client";

import { useState, ChangeEvent, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Gauge, Target, User, Search, ArrowRight, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getApiToken } from "@/lib/get-api-token";
import { setCachedData, LOCAL_STORAGE_PREFIX } from "@/lib/cache";
import { useLanguage } from "@/contexts/LanguageContext"; // Added
import { getTranslation } from "@/lib/translations"; // Added

// Define ProfileData type, assuming structure from API
type ProfileData = {
  player_name: string;
  rating?: number | string;
  // Add other fields from profile.json if needed for caching
};


export default function ChuniCalcForm() {
  const [nickname, setNickname] = useState<string>("");
  const [currentRatingStr, setCurrentRatingStr] = useState<string>("");
  const [targetRatingStr, setTargetRatingStr] = useState<string>("");
  const [isFetchingRating, setIsFetchingRating] = useState<boolean>(false);
  const [isClient, setIsClient] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const { locale } = useLanguage(); // Added

  useEffect(() => {
    setIsClient(true);
    const token = getApiToken();
    if (!token) {
      console.error("Chunirec API Token is not configured. Please set it in Advanced Settings or environment variables.");
      toast({
        title: "API 설정 오류",
        description: "Chunirec API 토큰이 설정되지 않았습니다. 고급 설정에서 로컬 토큰을 입력하거나 환경 변수를 확인해주세요.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleNicknameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setNickname(e.target.value);
    setCurrentRatingStr(""); // Clear current rating when nickname changes
    setTargetRatingStr(""); // Clear target rating
  };

  const handleFetchRating = async () => {
    if (!nickname) {
      toast({
        title: getTranslation(locale, 'nicknameLabel').split(' (')[0] + " 필요", // Dynamically get "닉네임 필요" or "ニックネーム必要"
        description: getTranslation(locale, 'nicknameHelp'),
        variant: "destructive",
      });
      return;
    }
    const apiToken = getApiToken();
    if (!apiToken) {
      toast({
        title: "API 토큰 없음",
        description: "API 토큰이 설정되지 않아 레이팅을 조회할 수 없습니다. 고급 설정에서 로컬 토큰을 입력하거나 환경 변수를 확인해주세요.",
        variant: "destructive",
      });
      return;
    }

    setIsFetchingRating(true);
    setCurrentRatingStr("");
    setTargetRatingStr("");


    try {
      const response = await fetch(
        `https://api.chunirec.net/2.0/records/profile.json?user_name=${encodeURIComponent(nickname)}&region=jp2&token=${apiToken}`
      );

      const data: ProfileData & { error?: { message?: string; code?: number } } = await response.json();
      console.log("Chunirec profile.json API Response:", data);

      if (response.status === 404) {
        toast({
          title: "사용자 없음",
          description: data.error?.message || `닉네임 '${nickname}'에 해당하는 사용자를 찾을 수 없거나 플레이 데이터가 없습니다.`,
          variant: "destructive",
        });
        setIsFetchingRating(false);
        return;
      }
      if (response.status === 403) {
        let message = data.error?.message || "비공개 사용자이거나 친구가 아니어서 접근할 수 없습니다.";
        if (data.error?.code === 403) {
            message = `사용자 '${nickname}'의 데이터에 접근할 권한이 없습니다. (오류 코드: ${data.error.code})`;
        }
        toast({
          title: "접근 금지",
          description: message,
          variant: "destructive",
        });
        setIsFetchingRating(false);
        return;
      }
      if (!response.ok) {
        let errorMessage = `API 요청 실패 (상태: ${response.status})`;
        if (data.error && data.error.message) {
            errorMessage += `: ${data.error.message}`;
        }
        throw new Error(errorMessage);
      }

      setCachedData<ProfileData>(`${LOCAL_STORAGE_PREFIX}profile_${nickname}`, data);

      let ratingValue: number | null = null;
      if (data && typeof data.rating === 'number') {
        ratingValue = data.rating;
      } else if (data && typeof data.rating === 'string') {
        const parsedRating = parseFloat(data.rating);
        if (!isNaN(parsedRating)) {
          ratingValue = parsedRating;
        }
      }

      if (ratingValue !== null) {
        setCurrentRatingStr(ratingValue.toFixed(2));
        const newTargetRating = Math.min(ratingValue + 0.01, 17.50);
        setTargetRatingStr(newTargetRating.toFixed(2));
        toast({
          title: "레이팅 조회 성공!",
          description: `'${data.player_name || nickname}'님의 현재 레이팅: ${ratingValue.toFixed(2)}`,
        });
      } else {
         setCurrentRatingStr("");
         setTargetRatingStr("");
        toast({
          title: "데이터 오류",
          description: "레이팅 정보를 가져왔으나 형식이 올바르지 않거나, 플레이 데이터가 없습니다.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error fetching rating:", error);
      setCurrentRatingStr("");
      setTargetRatingStr("");
      toast({
        title: "조회 실패",
        description: error instanceof Error ? error.message : "레이팅을 가져오는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsFetchingRating(false);
    }
  };

  const handleCalculateAndNavigate = (e: FormEvent) => {
    e.preventDefault();

    const current = parseFloat(currentRatingStr);
    const target = parseFloat(targetRatingStr);

    if (currentRatingStr === "" || targetRatingStr === "") {
        toast({
            title: "정보 부족",
            description: "현재 레이팅(조회 필요)과 목표 레이팅을 모두 입력해주세요.",
            variant: "destructive",
        });
        return;
    }

    if (isNaN(current) || isNaN(target)) {
      toast({
        title: "잘못된 입력",
        description: "레이팅은 숫자로 입력해야 합니다.",
        variant: "destructive",
      });
      return;
    }

    if (current < 0 || current > 18 || target < 0 || target > 17.50) { // Target max updated
        toast({
          title: "잘못된 레이팅 범위",
          description: "현재 레이팅은 0.00-18.00, 목표 레이팅은 0.00-17.50 사이여야 합니다.",
          variant: "destructive",
        });
        return;
    }

    if (target <= current) {
      toast({
        title: "목표 레이팅 오류",
        description: "목표 레이팅은 현재 레이팅보다 높아야 합니다.",
        variant: "destructive",
      });
      return;
    }

    router.push(`/result?nickname=${encodeURIComponent(nickname)}&current=${currentRatingStr}&target=${targetRatingStr}`);
  };

  if (!isClient) {
    return (
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="font-headline text-4xl tracking-tight">{getTranslation(locale, 'formTitle')}</CardTitle>
          <CardDescription className="font-body text-md">
            {getTranslation(locale, 'formDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="h-10 bg-muted rounded-md animate-pulse"></div>
            <div className="h-10 bg-muted rounded-md animate-pulse"></div>
            <div className="h-10 bg-muted rounded-md animate-pulse"></div>
            <div className="h-12 bg-muted rounded-md animate-pulse"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md shadow-2xl">
      <CardHeader className="text-center">
        <CardTitle className="font-headline text-4xl tracking-tight">{getTranslation(locale, 'formTitle')}</CardTitle>
        <CardDescription className="font-body text-md">
         {getTranslation(locale, 'formDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCalculateAndNavigate} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="nickname" className="flex items-center text-lg font-medium">
              <User className="mr-2 h-5 w-5 text-primary" /> {getTranslation(locale, 'nicknameLabel')}
            </Label>
            <div className="flex space-x-2">
              <Input
                id="nickname"
                type="text"
                placeholder={getTranslation(locale, 'nicknamePlaceholder')}
                value={nickname}
                onChange={handleNicknameChange}
                className="text-lg"
                aria-describedby="nicknameHelp"
              />
              <Button type="button" onClick={handleFetchRating} className="px-3" disabled={isFetchingRating || !getApiToken()}>
                {isFetchingRating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                <span className="ml-2">{getTranslation(locale, 'fetchRatingButton')}</span>
              </Button>
            </div>
            <p id="nicknameHelp" className="text-sm text-muted-foreground">{getTranslation(locale, 'nicknameHelp')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="currentRating" className="flex items-center text-lg font-medium">
              <Gauge className="mr-2 h-5 w-5 text-primary" /> {getTranslation(locale, 'currentRatingLabel')}
            </Label>
            <Input
              id="currentRating"
              type="number"
              step="0.01"
              min="0"
              max="18.00"
              placeholder={getTranslation(locale, 'currentRatingPlaceholder')}
              value={currentRatingStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentRatingStr(e.target.value)}
              className="text-lg bg-muted/50" 
              aria-describedby="currentRatingHelp"
              disabled 
            />
            <p id="currentRatingHelp" className="text-sm text-muted-foreground">
              {getTranslation(locale, 'currentRatingHelp')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="targetRating" className="flex items-center text-lg font-medium">
              <Target className="mr-2 h-5 w-5 text-primary" /> {getTranslation(locale, 'targetRatingLabel')}
            </Label>
            <Input
              id="targetRating"
              type="number"
              step="0.01"
              min="0"
              max="17.50" 
              placeholder={getTranslation(locale, 'targetRatingPlaceholder')}
              value={targetRatingStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTargetRatingStr(e.target.value)}
              className="text-lg"
              aria-describedby="targetRatingHelp"
            />
             <p id="targetRatingHelp" className="text-sm text-muted-foreground">{getTranslation(locale, 'targetRatingHelp')}</p>
          </div>

          <Button type="submit" className="w-full text-lg py-6 bg-primary hover:bg-primary/90">
            {getTranslation(locale, 'calculateButton')} <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

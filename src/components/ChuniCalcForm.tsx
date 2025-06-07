
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

const API_TOKEN = process.env.CHUNIREC_API_TOKEN;

export default function ChuniCalcForm() {
  const [nickname, setNickname] = useState<string>("");
  const [currentRatingStr, setCurrentRatingStr] = useState<string>("");
  const [targetRatingStr, setTargetRatingStr] = useState<string>("");
  const [isFetchingRating, setIsFetchingRating] = useState<boolean>(false);
  const [isCurrentRatingLocked, setIsCurrentRatingLocked] = useState<boolean>(false);
  const [isClient, setIsClient] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setIsClient(true);
    if (!API_TOKEN) {
      console.error("Chunirec API Token is not configured. Please set CHUNIREC_API_TOKEN in your .env.local file or environment variables.");
      toast({
        title: "API 설정 오류",
        description: "Chunirec API 토큰이 설정되지 않았습니다. 기능이 제한될 수 있습니다.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleNicknameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setNickname(e.target.value);
    setCurrentRatingStr(""); 
    setIsCurrentRatingLocked(false); 
  };

  const handleFetchRating = async () => {
    if (!nickname) {
      toast({
        title: "닉네임 필요",
        description: "레이팅을 조회할 닉네임을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (!API_TOKEN) {
      toast({
        title: "API 토큰 없음",
        description: "API 토큰이 설정되지 않아 레이팅을 조회할 수 없습니다.",
        variant: "destructive",
      });
      return;
    }

    setIsFetchingRating(true);
    setIsCurrentRatingLocked(false); 
    setCurrentRatingStr(""); 

    try {
      const response = await fetch(
        `https://api.chunirec.net/2.0/records/profile.json?user_name=${encodeURIComponent(nickname)}&region=jp2&token=${API_TOKEN}`
      );

      if (response.status === 404) {
        toast({
          title: "사용자 없음",
          description: `닉네임 '${nickname}'에 해당하는 사용자를 찾을 수 없거나 플레이 데이터가 없습니다.`,
          variant: "destructive",
        });
        setIsFetchingRating(false);
        return;
      }
      if (response.status === 403) {
        const errorData = await response.json().catch(() => ({}));
        let message = "비공개 사용자이거나 친구가 아니어서 접근할 수 없습니다.";
        if (errorData.error?.code === 403) { // Assuming specific error code for this case
            message = `사용자 '${nickname}'의 데이터에 접근할 권한이 없습니다. (오류 코드: ${errorData.error.code})`;
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
        const errorData = await response.json().catch(() => ({})); 
        let errorMessage = `API 요청 실패 (상태: ${response.status})`;
        if (errorData.error && errorData.error.message) {
            errorMessage += `: ${errorData.error.message}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (data && typeof data.rating === 'number') {
        setCurrentRatingStr(data.rating.toFixed(2));
        setIsCurrentRatingLocked(true); 
        toast({
          title: "레이팅 조회 성공!",
          description: `'${nickname}'님의 현재 레이팅: ${data.rating.toFixed(2)}`,
        });
      } else {
        toast({
          title: "데이터 오류",
          description: "레이팅 정보를 가져왔으나 형식이 올바르지 않습니다.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error fetching rating:", error);
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
            description: "현재 레이팅과 목표 레이팅을 모두 입력해주세요.",
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
    
    if (current < 0 || current > 18 || target < 0 || target > 18) {
        toast({
          title: "잘못된 레이팅 범위",
          description: "레이팅은 0.00 에서 18.00 사이여야 합니다.",
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
          <CardTitle className="font-headline text-4xl tracking-tight">ChuniCalc</CardTitle>
          <CardDescription className="font-body text-md">
            츄니즘 레이팅 진행 상황을 추적하세요.
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
        <CardTitle className="font-headline text-4xl tracking-tight">ChuniCalc</CardTitle>
        <CardDescription className="font-body text-md">
          츄니즘 레이팅 진행 상황을 추적하세요. 닉네임으로 레이팅을 조회하거나 직접 입력하세요.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCalculateAndNavigate} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="nickname" className="flex items-center text-lg font-medium">
              <User className="mr-2 h-5 w-5 text-primary" /> 닉네임
            </Label>
            <div className="flex space-x-2">
              <Input
                id="nickname"
                type="text"
                placeholder="예: chunirec"
                value={nickname}
                onChange={handleNicknameChange}
                className="text-lg"
                aria-describedby="nicknameHelp"
              />
              <Button type="button" onClick={handleFetchRating} className="px-3" disabled={isFetchingRating || !API_TOKEN}>
                {isFetchingRating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                <span className="ml-2">조회</span>
              </Button>
            </div>
            <p id="nicknameHelp" className="text-sm text-muted-foreground">Chunirec 닉네임을 입력하여 현재 레이팅을 조회합니다.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="currentRating" className="flex items-center text-lg font-medium">
              <Gauge className="mr-2 h-5 w-5 text-primary" /> 현재 레이팅
            </Label>
            <Input
              id="currentRating"
              type="number"
              step="0.01"
              min="0"
              max="18.00"
              placeholder="예: 15.75"
              value={currentRatingStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentRatingStr(e.target.value)}
              className="text-lg"
              aria-describedby="currentRatingHelp"
              disabled={isCurrentRatingLocked}
            />
            <p id="currentRatingHelp" className="text-sm text-muted-foreground">
              {isCurrentRatingLocked 
                ? "API에서 조회된 레이팅입니다. 닉네임 변경 시 다시 입력 가능합니다." 
                : "현재 레이팅을 입력하세요 (0.00 - 18.00)."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="targetRating" className="flex items-center text-lg font-medium">
              <Target className="mr-2 h-5 w-5 text-primary" /> 목표 레이팅
            </Label>
            <Input
              id="targetRating"
              type="number"
              step="0.01"
              min="0"
              max="18.00"
              placeholder="예: 16.00"
              value={targetRatingStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTargetRatingStr(e.target.value)}
              className="text-lg"
              aria-describedby="targetRatingHelp"
            />
             <p id="targetRatingHelp" className="text-sm text-muted-foreground">목표 레이팅을 입력하세요 (0.00 - 18.00).</p>
          </div>

          <Button type="submit" className="w-full text-lg py-6 bg-primary hover:bg-primary/90">
            계산 및 결과 보기 <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

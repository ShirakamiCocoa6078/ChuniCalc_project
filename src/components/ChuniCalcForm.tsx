
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
import { getLocalReferenceApiToken } from "@/lib/get-api-token";
import { setCachedData, LOCAL_STORAGE_PREFIX } from "@/lib/cache";
import { useLanguage } from "@/contexts/LanguageContext"; 
import { getTranslation } from "@/lib/translations"; 

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
  const { locale } = useLanguage(); 

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleNicknameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setNickname(e.target.value);
    setCurrentRatingStr(""); 
    setTargetRatingStr(""); 
  };

  const handleFetchRating = async () => {
    if (!nickname) {
      toast({
        title: getTranslation(locale, 'toastErrorNicknameNeeded'), 
        description: getTranslation(locale, 'toastErrorNicknameNeededDesc'),
        variant: "destructive",
      });
      return;
    }

    const localRefToken = getLocalReferenceApiToken();
    if (!localRefToken) {
      toast({
        title: getTranslation(locale, 'toastInfoLocalApiKeyRefMissingTitle'),
        description: getTranslation(locale, 'toastInfoLocalApiKeyRefMissingDesc'),
        variant: "default", // Informational, not destructive
      });
      // Removed setIsFetchingRating(false) here to allow the loading state to be set if the call proceeds.
      // If we decide to prevent the call, then setIsFetchingRating(false) should be added before return.
      // For now, let's prevent the call as it's a strong hint of misconfiguration.
      setIsFetchingRating(false);
      return;
    }
    
    setIsFetchingRating(true);
    setCurrentRatingStr("");
    setTargetRatingStr("");

    try {
      const response = await fetch(
        `/api/chunirecApiProxy?proxyEndpoint=records/profile.json&user_name=${encodeURIComponent(nickname)}&region=jp2`
      );

      const data: ProfileData & { error?: { message?: string; code?: number } } = await response.json();
      console.log("Chunirec profile.json API Response (via Proxy):", data);

      if (response.status === 404) {
        toast({
          title: getTranslation(locale, 'toastErrorUserNotFound'),
          description: getTranslation(locale, 'toastErrorUserNotFoundDesc', nickname),
          variant: "destructive",
        });
        setIsFetchingRating(false);
        return;
      }
      if (response.status === 403 && data.error?.code === 40301) { 
        toast({
          title: getTranslation(locale, 'toastErrorAccessDenied'),
          description: getTranslation(locale, 'toastErrorAccessDeniedDesc', nickname, data.error?.code),
          variant: "destructive",
        });
        setIsFetchingRating(false);
        return;
      }
      if (!response.ok) {
        // The proxy should return a structured error, but handle cases where it might not.
        const errorMessage = data.error?.message || response.statusText || getTranslation(locale, 'toastErrorApiRequestFailedDesc', response.status, "Unknown error from proxy");
        throw new Error(getTranslation(locale, 'toastErrorApiRequestFailedDesc', response.status, errorMessage));
      }
      
      if (data.error) { 
         toast({
          title: getTranslation(locale, 'toastErrorApiLogicalError'),
          description: getTranslation(locale, 'toastErrorApiLogicalErrorDesc', data.error.message || "Unknown error from API."),
          variant: "destructive",
        });
        setIsFetchingRating(false);
        return;
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
          title: getTranslation(locale, 'toastSuccessRatingFetched'),
          description: getTranslation(locale, 'toastSuccessRatingFetchedDesc', data.player_name || nickname, ratingValue.toFixed(2)),
        });
      } else {
         setCurrentRatingStr("");
         setTargetRatingStr("");
        toast({
          title: getTranslation(locale, 'toastErrorInvalidRatingData'),
          description: getTranslation(locale, 'toastErrorInvalidRatingDataDesc'),
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error fetching rating via proxy:", error);
      setCurrentRatingStr("");
      setTargetRatingStr("");
      toast({
        title: getTranslation(locale, 'toastErrorRatingFetchFailed'),
        description: getTranslation(locale, 'toastErrorRatingFetchFailedDesc', error instanceof Error ? error.message : String(error)),
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
            title: getTranslation(locale, 'toastErrorMissingInfo'),
            description: getTranslation(locale, 'toastErrorMissingInfoDesc'),
            variant: "destructive",
        });
        return;
    }

    if (isNaN(current) || isNaN(target)) {
      toast({
        title: getTranslation(locale, 'toastErrorInvalidInput'),
        description: getTranslation(locale, 'toastErrorInvalidInputDesc'),
        variant: "destructive",
      });
      return;
    }

    if (current >= 17.50) {
      toast({
        title: getTranslation(locale, 'toastErrorCurrentRatingTooHigh'),
        description: getTranslation(locale, 'toastErrorCurrentRatingTooHighDesc'),
        variant: "destructive",
      });
      return;
    }

    if (current < 0 || current >= 17.50 || target < 0 || target > 17.50) { 
        toast({
          title: getTranslation(locale, 'toastErrorInvalidRatingRange'),
          description: getTranslation(locale, 'toastErrorInvalidRatingRangeDesc'),
          variant: "destructive",
        });
        return;
    }

    if (target <= current) {
      toast({
        title: getTranslation(locale, 'toastErrorTargetRating'),
        description: getTranslation(locale, 'toastErrorTargetRatingDesc'),
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
              <Button type="button" onClick={handleFetchRating} className="px-3" disabled={isFetchingRating}>
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
              max="17.49" 
              placeholder={getTranslation(locale, 'currentRatingPlaceholder')}
              value={currentRatingStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentRatingStr(e.target.value)}
              className="text-lg bg-muted/50" 
              disabled 
            />
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

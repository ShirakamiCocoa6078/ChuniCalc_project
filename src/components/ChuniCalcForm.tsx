
"use client";

import { useState, ChangeEvent, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Gauge, Target, User, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function ChuniCalcForm() {
  const [nickname, setNickname] = useState<string>("");
  const [currentRatingStr, setCurrentRatingStr] = useState<string>("");
  const [targetRatingStr, setTargetRatingStr] = useState<string>("");
  const [isClient, setIsClient] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleFetchRating = async () => {
    if (nickname.toLowerCase() === "asdf") {
      setCurrentRatingStr("17.25");
      toast({
        title: "Rating Fetched!",
        description: "Current rating for 'asdf' has been loaded.",
      });
    } else {
      toast({
        title: "User Not Found",
        description: `Could not find rating for nickname: ${nickname}`,
        variant: "destructive",
      });
      setCurrentRatingStr(""); // Clear if not found
    }
  };

  const handleCalculateRedirect = (e: FormEvent) => {
    e.preventDefault();

    const current = parseFloat(currentRatingStr);
    const target = parseFloat(targetRatingStr);

    if (currentRatingStr === "" || targetRatingStr === "") {
        toast({
            title: "Missing Information",
            description: "Please enter both current and target ratings.",
            variant: "destructive",
        });
        return;
    }


    if (isNaN(current) || isNaN(target)) {
      toast({
        title: "Invalid Input",
        description: "Please enter valid numbers for both ratings.",
        variant: "destructive",
      });
      return;
    }
    
    if (current < 0 || current > 18 || target < 0 || target > 18) {
        toast({
          title: "Invalid Rating Range",
          description: "Ratings should be between 0.00 and 18.00.",
          variant: "destructive",
        });
        return;
    }
    
    // Redirect to an external site
    window.location.href = 'https://chunirec.net';
  };

  if (!isClient) {
    return (
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="font-headline text-4xl tracking-tight">ChuniCalc</CardTitle>
          <CardDescription className="font-body text-md">
            Track your Chunithm rating progress.
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
          Track your Chunithm rating progress. Fetch your rating or enter manually.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCalculateRedirect} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="nickname" className="flex items-center text-lg font-medium">
              <User className="mr-2 h-5 w-5 text-primary" /> Nickname
            </Label>
            <div className="flex space-x-2">
              <Input
                id="nickname"
                type="text"
                placeholder="e.g., asdf"
                value={nickname}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNickname(e.target.value)}
                className="text-lg"
                aria-describedby="nicknameHelp"
              />
              <Button type="button" onClick={handleFetchRating} className="px-3">
                <Search className="h-5 w-5" />
                <span className="sr-only sm:not-sr-only sm:ml-2">Fetch</span>
              </Button>
            </div>
            <p id="nicknameHelp" className="text-sm text-muted-foreground">Enter your nickname to try and fetch current rating (use 'asdf' for demo).</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="currentRating" className="flex items-center text-lg font-medium">
              <Gauge className="mr-2 h-5 w-5 text-primary" /> Current Rating
            </Label>
            <Input
              id="currentRating"
              type="number"
              step="0.01"
              min="0"
              max="18.00"
              placeholder="e.g., 15.75"
              value={currentRatingStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentRatingStr(e.target.value)}
              className="text-lg"
              aria-describedby="currentRatingHelp"
            />
            <p id="currentRatingHelp" className="text-sm text-muted-foreground">Enter your current rating (0.00 - 18.00).</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="targetRating" className="flex items-center text-lg font-medium">
              <Target className="mr-2 h-5 w-5 text-primary" /> Target Rating
            </Label>
            <Input
              id="targetRating"
              type="number"
              step="0.01"
              min="0"
              max="18.00"
              placeholder="e.g., 16.00"
              value={targetRatingStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTargetRatingStr(e.target.value)}
              className="text-lg"
              aria-describedby="targetRatingHelp"
            />
             <p id="targetRatingHelp" className="text-sm text-muted-foreground">Enter your desired rating (0.00 - 18.00).</p>
          </div>

          <Button type="submit" className="w-full text-lg py-6 bg-primary hover:bg-primary/90">
            Proceed to Chunirec.net
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

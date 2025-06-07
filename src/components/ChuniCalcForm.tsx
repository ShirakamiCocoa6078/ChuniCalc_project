"use client";

import { useState, ChangeEvent, FormEvent, useEffect } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Gauge, Target, Sparkles, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ChuniCalcForm() {
  const [currentRatingStr, setCurrentRatingStr] = useState<string>("");
  const [targetRatingStr, setTargetRatingStr] = useState<string>("");
  const [difference, setDifference] = useState<number | null>(null);
  const [message, setMessage] = useState<string>("");
  const [showCelebration, setShowCelebration] = useState<boolean>(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);


  const handleCalculate = (e: FormEvent) => {
    e.preventDefault();
    setShowCelebration(false);

    const current = parseFloat(currentRatingStr);
    const target = parseFloat(targetRatingStr);

    if (isNaN(current) || isNaN(target)) {
      setMessage("Please enter valid numbers for both ratings.");
      setDifference(null);
      return;
    }
    
    // Max rating typically around 17.xx, allow up to e.g. 20 for future proofing / other games
    // Min rating is 0
    if (current < 0 || current > 20 || target < 0 || target > 20) {
        setMessage("Ratings should be between 0 and 20.");
        setDifference(null);
        return;
    }


    const diffValue = target - current;
    setDifference(diffValue);

    if (current >= target) {
      setShowCelebration(true);
      if (current === target) {
        setMessage(`Congratulations! You've reached your target rating of ${target.toFixed(2)}!`);
      } else {
        setMessage(`Amazing! You've surpassed your target rating by ${Math.abs(diffValue).toFixed(2)} points! Current: ${current.toFixed(2)}`);
      }
    } else {
      setMessage(`You need ${diffValue.toFixed(2)} more points to reach your target of ${target.toFixed(2)}.`);
    }
  };

  if (!isClient) {
    return null; // Or a loading skeleton
  }

  return (
    <Card className="w-full max-w-md shadow-2xl">
      <CardHeader className="text-center">
        <CardTitle className="font-headline text-4xl tracking-tight">ChuniCalc</CardTitle>
        <CardDescription className="font-body text-md">
          Track your Chunithm rating progress.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCalculate} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="currentRating" className="flex items-center text-lg font-medium">
              <Gauge className="mr-2 h-5 w-5 text-primary" /> Current Rating
            </Label>
            <Input
              id="currentRating"
              type="number"
              step="0.01"
              placeholder="e.g., 15.75"
              value={currentRatingStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentRatingStr(e.target.value)}
              className="text-lg"
              aria-describedby="currentRatingHelp"
            />
            <p id="currentRatingHelp" className="text-sm text-muted-foreground">Enter your current rating (0.00 - 20.00).</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="targetRating" className="flex items-center text-lg font-medium">
              <Target className="mr-2 h-5 w-5 text-primary" /> Target Rating
            </Label>
            <Input
              id="targetRating"
              type="number"
              step="0.01"
              placeholder="e.g., 16.00"
              value={targetRatingStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTargetRatingStr(e.target.value)}
              className="text-lg"
              aria-describedby="targetRatingHelp"
            />
             <p id="targetRatingHelp" className="text-sm text-muted-foreground">Enter your desired rating (0.00 - 20.00).</p>
          </div>
          <Button type="submit" className="w-full text-lg py-6 bg-primary hover:bg-primary/90">
            Calculate Difference
          </Button>
        </form>
      </CardContent>
      {message && (
        <CardFooter className="flex flex-col items-center justify-center pt-6 space-y-3">
            {difference !== null && (
                 <div className={cn(
                    "text-2xl font-bold font-headline p-4 rounded-lg text-center",
                    showCelebration ? "text-accent-foreground bg-accent/20 animate-celebrate-scale" : "text-foreground",
                    difference > 0 ? "text-primary" : "text-accent"
                 )}>
                    { difference > 0 && <TrendingUp className="inline-block mr-2 h-7 w-7" /> }
                    { difference <= 0 && !showCelebration && <TrendingDown className="inline-block mr-2 h-7 w-7" /> }
                    { difference <= 0 && showCelebration && <Sparkles className="inline-block mr-2 h-7 w-7 text-accent" /> }
                    {difference.toFixed(2)} points
                 </div>
            )}
          <p className={cn(
            "text-center text-lg",
            showCelebration ? "text-accent font-semibold" : "text-foreground"
          )}>
            {message}
          </p>
        </CardFooter>
      )}
    </Card>
  );
}

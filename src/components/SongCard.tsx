
"use client";

import type { CalculationStrategy, Song } from "@/types/result-page";
import { Card, CardContent } from "@/components/ui/card";
import { Music2, Star, Target as TargetIcon, ArrowUpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const difficultyColors: { [key: string]: string } = {
  ULT: "text-[#9F5D67]", // Darker Pink/Red
  MAS: "text-[#CE12CE]", // Purple
  EXP: "text-[#F10B0B]", // Red
  ADV: "text-[#EF9F00]", // Orange
  BAS: "text-[#40C540]", // Green
  UNKNOWN: "text-muted-foreground",
};

type SongCardProps = {
  song: Song;
  calculationStrategy: CalculationStrategy | null;
};

export default function SongCard({ song, calculationStrategy }: SongCardProps) {
  const inSimulationMode = !!calculationStrategy;

  const scoreDifference = song.targetScore - song.currentScore;
  // Use a small epsilon for floating point comparison of ratings for difference display
  const ratingDifferenceValue = song.targetRating - song.currentRating;
  const ratingActuallyChanged = Math.abs(ratingDifferenceValue) > 0.00005; // More precise check for actual change
  const scoreActuallyChanged = scoreDifference !== 0;

  const hasChanged = scoreActuallyChanged || ratingActuallyChanged;

  if (song.title.includes("MarbleBlue.") || song.title.includes("Random") || song.title.includes("Makear") || song.title.includes("VERSE")) {
    console.log(
      `[SongCard] ${song.title} (${song.diff}): currentS: ${song.currentScore}, targetS: ${song.targetScore}, currentR: ${song.currentRating.toFixed(4)}, targetR: ${song.targetRating.toFixed(4)}, inSim: ${inSimulationMode}, hasChanged: ${hasChanged}, scoreDiff: ${scoreDifference}, ratingDiff: ${ratingDifferenceValue.toFixed(4)}`
    );
  }

  const getDifficultyColorClass = (diff: string) => {
    const upperDiff = diff.toUpperCase();
    return difficultyColors[upperDiff] || difficultyColors.UNKNOWN;
  };

  let borderColorClass = "border-border"; // Default

  // Rule 1: Red for current score at exactly SSS+
  if (song.currentScore === 1009000) {
      borderColorClass = "border-red-500";
  }
  // Rule 3: Purple (only in sim, takes precedence over green for this case if current is not already SSS+)
  // This rule implies an upgrade *to* SSS+ or higher from a state below SSS+
  else if (inSimulationMode && song.currentScore <= 1008999 && song.targetScore >= 1009000) {
      borderColorClass = "border-purple-400";
  }
  // Rule 2: Green if current is below SSS+ AND target is also below SSS+
  else if (song.currentScore <= 1008999 && song.targetScore <= 1008999) {
      borderColorClass = "border-green-500";
  }
  // Other cases (e.g., currentScore > 1009000, or currentScore < 1009000 but targetScore makes it neither purple nor green)
  // will use the default "border-border".

  const displayTargetInfo = inSimulationMode && hasChanged;

  return (
    <Card className={cn(
        "overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 w-full border-2",
        borderColorClass
      )}
    >
      <CardContent className="p-0 flex h-full">
        <div className="w-1/3 relative h-full bg-muted flex items-center justify-center min-h-[70px]">
          {/* Jacket image placeholder or content */}
        </div>
        <div className="w-2/3 p-3 flex flex-col justify-between bg-card-foreground/5">
          <div>
            <h3 className={cn(
                "text-sm font-semibold font-headline truncate flex items-center",
                getDifficultyColorClass(song.diff)
              )}
            >
              <Music2 className="w-4 h-4 mr-1.5 text-primary shrink-0" />
              {song.title}
            </h3>
            <span className="text-xs font-bold ml-1 text-muted-foreground">
              {song.diff.toUpperCase()}
            </span>
          </div>

          <div className="space-y-0.5 text-xs mt-1 text-right">
            {/* 변화량 표시: displayTargetInfo가 true일 때 */}
            {displayTargetInfo && (
              <div className="flex items-center justify-end text-green-600 dark:text-green-400">
                <ArrowUpCircle className="w-3 h-3 mr-1" />
                <span>
                  {scoreDifference > 0 ? "+" : ""}{scoreDifference.toLocaleString()}
                  {' / '}
                  {ratingDifferenceValue > 0 ? "+" : ""}{ratingDifferenceValue.toFixed(2)}
                </span>
              </div>
            )}

            {/* 주요 점수/레이팅 표시 */}
            <div className="flex items-center justify-end text-muted-foreground">
              <span className="flex items-center mr-1">
                {displayTargetInfo ? (
                  <TargetIcon className="w-3 h-3 text-accent" />
                ) : (
                  <Star className="w-3 h-3 text-yellow-500" />
                )}
              </span>
              <span className="font-medium text-foreground">
                {displayTargetInfo ? (
                  <>
                    {song.targetScore.toLocaleString()}
                    {' / '}
                    {song.targetRating.toFixed(2)}
                  </>
                ) : (
                  <>
                    {(song.currentScore > 0 ? song.currentScore : 0).toLocaleString()}
                    {' / '}
                    {song.currentRating.toFixed(2)}
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

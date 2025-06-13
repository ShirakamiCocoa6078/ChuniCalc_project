
"use client";

import type { CalculationStrategy, Song } from "@/types/result-page";
import { Card, CardContent } from "@/components/ui/card";
import { Music2, Star, Target as TargetIcon, ArrowUpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type SongCardProps = {
  song: Song;
  calculationStrategy: CalculationStrategy | null;
};

const difficultyColors: { [key: string]: string } = {
  ULT: "text-[#9F5D67]",
  MAS: "text-[#CE12CE]",
  EXP: "text-[#F10B0B]",
  ADV: "text-[#EF9F00]",
  BAS: "text-[#40C540]",
  UNKNOWN: "text-muted-foreground",
};

export default function SongCard({ song, calculationStrategy }: SongCardProps) {
  const inSimulationMode = !!calculationStrategy;

  // Determine if the song's score or rating has been targeted for a change
  const hasChanged = song.currentScore !== song.targetScore || song.currentRating !== song.targetRating;

  const scoreDifference = song.targetScore - song.currentScore;
  const ratingDifference = song.targetRating - song.currentRating;
  // Use toFixed(4) for internal calculations if needed, but display is usually toFixed(2)
  const ratingDifferenceDisplay = parseFloat(ratingDifference.toFixed(2));


  // For debugging specific songs
  if (song.title.includes("MarbleBlue.") || song.title.includes("Random") || song.title.includes("Makear")) {
    console.log(
      `[SongCard] ${song.title} (${song.diff}): currentS: ${song.currentScore}, targetS: ${song.targetScore}, currentR: ${song.currentRating.toFixed(4)}, targetR: ${song.targetRating.toFixed(4)}, hasChanged: ${hasChanged}, inSimulationMode: ${inSimulationMode}`
    );
  }

  const getDifficultyColorClass = (diff: string) => {
    const upperDiff = diff.toUpperCase();
    return difficultyColors[upperDiff] || difficultyColors.UNKNOWN;
  };

  let borderColorClass = "border-border";
  const scoreForBorder = hasChanged ? song.targetScore : song.currentScore; // Use target score for border if changed

  if (scoreForBorder >= 1009000) { borderColorClass = "border-red-500"; }
  else if (scoreForBorder >= 1007500) { borderColorClass = "border-orange-400"; }
  else if (scoreForBorder >= 1005000) { borderColorClass = "border-yellow-400"; }
  else if (scoreForBorder >= 1000000) { borderColorClass = "border-purple-400"; }
  else if (scoreForBorder >= 975000) { borderColorClass = "border-green-500"; }


  return (
    <Card className={cn(
        "overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 w-full border-2",
        borderColorClass
      )}
      style={{ aspectRatio: '2 / 1' }}
    >
      <CardContent className="p-0 flex h-full">
        <div className="w-1/3 relative h-full bg-muted flex items-center justify-center">
          {/* Jacket image area - kept empty */}
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
              {song.diff}
            </span>
          </div>

          <div className="space-y-0.5 text-xs mt-1">
            {hasChanged && inSimulationMode && (
              <div className="flex items-center justify-end text-green-600 dark:text-green-400">
                <ArrowUpCircle className="w-3 h-3 mr-1" />
                <span>
                  {scoreDifference > 0 ? "+" : ""}{scoreDifference.toLocaleString()}
                  {' / '}
                  {ratingDifference > 0 ? "+" : ""}{ratingDifferenceDisplay.toFixed(2)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center">
                {hasChanged && inSimulationMode ? (
                  <TargetIcon className="w-3 h-3 mr-1 text-accent" />
                ) : (
                  <Star className="w-3 h-3 mr-1 text-yellow-500" />
                )}
              </span>
              <span className="font-medium text-foreground">
                {hasChanged && inSimulationMode ? (
                  <>
                    {song.targetScore > 0 ? song.targetScore.toLocaleString() : song.currentScore.toLocaleString()}
                    {' / '}
                    {song.targetScore > 0 ? song.targetRating.toFixed(2) : song.currentRating.toFixed(2)}
                  </>
                ) : (
                  <>
                    {song.currentScore.toLocaleString()}
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

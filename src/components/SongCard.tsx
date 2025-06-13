
"use client";

import type { CalculationStrategy, Song } from "@/types/result-page";
import { Card, CardContent } from "@/components/ui/card";
import { Music2, Star, Target as TargetIcon, ArrowUpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const difficultyColors: { [key: string]: string } = {
  ULT: "text-[#9F5D67]", 
  MAS: "text-[#CE12CE]", 
  EXP: "text-[#F10B0B]", 
  ADV: "text-[#EF9F00]", 
  BAS: "text-[#40C540]", 
  UNKNOWN: "text-muted-foreground",
};

type SongCardProps = {
  song: Song;
  calculationStrategy: CalculationStrategy | null;
};

export default function SongCard({ song, calculationStrategy }: SongCardProps) {
  const inSimulationMode = !!calculationStrategy;

  const scoreDifference = song.targetScore - song.currentScore;
  const ratingDifferenceValue = song.targetRating - song.currentRating;
  
  // Use a small epsilon for floating point comparison for ratings
  const ratingActuallyChanged = Math.abs(ratingDifferenceValue) > 0.00005; 
  const scoreActuallyChanged = song.targetScore !== song.currentScore;

  const isSimulatedAndChanged = inSimulationMode && (scoreActuallyChanged || ratingActuallyChanged);

  // For debugging specific songs
  if (song.title.includes("MarbleBlue.") || song.title.includes("Random") || song.title.includes("Makear") || song.title.includes("VERSE")) {
    console.log(
      `[SongCard] ${song.title} (${song.diff}): currentS: ${song.currentScore}, targetS: ${song.targetScore}, currentR: ${song.currentRating.toFixed(4)}, targetR: ${song.targetRating.toFixed(4)}, inSim: ${inSimulationMode}, isSimAndChanged: ${isSimulatedAndChanged}, scoreDiff: ${scoreDifference}, ratingDiffVal: ${ratingDifferenceValue.toFixed(4)}, scoreActuallyChanged: ${scoreActuallyChanged}, ratingActuallyChanged: ${ratingActuallyChanged}`
    );
  }

  const getDifficultyColorClass = (diff: string) => {
    const upperDiff = diff.toUpperCase();
    return difficultyColors[upperDiff] || difficultyColors.UNKNOWN;
  };

  let borderColorClass = "border-border"; 

  if (song.currentScore >= 1009000) {
    borderColorClass = "border-red-500"; 
  } else if (inSimulationMode && song.currentScore <= 1008999 && song.targetScore >= 1009000) {
    borderColorClass = "border-purple-400"; 
  } else if (song.currentScore <= 1008999 && song.targetScore <= 1008999) {
    borderColorClass = "border-green-500"; 
  }
  
  return (
    <Card className={cn(
        "overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 w-full border-2",
        borderColorClass
      )}
    >
      <CardContent className="p-0 flex h-full">
        {/* Consistent gray background for jacket placeholder */}
        <div className="w-1/3 relative h-full flex items-center justify-center min-h-[70px] bg-muted">
             {/* Intentionally empty or add a generic icon like <Music2 className="w-8 h-8 text-muted-foreground/50" /> */}
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
            {/* Display delta if in simulation and changed */}
            {isSimulatedAndChanged && (
              <div className="flex items-center justify-end text-green-600 dark:text-green-400">
                <ArrowUpCircle className="w-3 h-3 mr-1" />
                <span>
                  {scoreDifference !== 0 ? (scoreDifference > 0 ? "+" : "") + scoreDifference.toLocaleString() : "±0"}
                  {' / '}
                  {ratingActuallyChanged ? (ratingDifferenceValue > 0 ? "+" : "") + ratingDifferenceValue.toFixed(2) : "±0.00"}
                </span>
              </div>
            )}

            {/* Main score/rating line */}
            <div className="flex items-center justify-end text-muted-foreground">
              <span className="flex items-center mr-1">
                {isSimulatedAndChanged ? (
                  <TargetIcon className="w-3 h-3 text-accent" />
                ) : (
                  <Star className="w-3 h-3 text-yellow-500" />
                )}
              </span>
              <span className="font-medium text-foreground">
                {isSimulatedAndChanged ? (
                  <>
                    {(song.targetScore > 0 ? song.targetScore : song.currentScore).toLocaleString()}
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

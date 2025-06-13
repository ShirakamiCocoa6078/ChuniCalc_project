
"use client";

import type { CalculationStrategy, Song } from "@/types/result-page"; 
import { Card, CardContent } from "@/components/ui/card";
import { Music2, Star, Target as TargetIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type SongCardProps = {
  song: Song;
  calculationStrategy: CalculationStrategy | null; // Updated to allow null
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
  // If a calculation strategy is active, we are in simulation mode.
  // In this mode, targetScore and targetRating are the primary values to display.
  const inSimulationMode = !!calculationStrategy;

  // Calculate differences for potential display
  const scoreDifferenceValue = song.targetScore - song.currentScore;
  const ratingDifferenceValue = song.targetRating - song.currentRating; // Full precision for comparison
  const ratingDifferenceDisplay = parseFloat(ratingDifferenceValue.toFixed(2)); // For display

  // For debugging specific songs
  if (song.title.includes("MarbleBlue.") || song.title.includes("Makear") || song.title.includes("Random")) {
    console.log(
      `[SongCard DEBUG] ${song.title} (${song.diff}): currentS: ${song.currentScore}, targetS: ${song.targetScore}, currentR: ${song.currentRating.toFixed(4)}, targetR: ${song.targetRating.toFixed(4)}, inSimulationMode: ${inSimulationMode}`
    );
  }
  
  const getDifficultyColorClass = (diff: string) => {
    const upperDiff = diff.toUpperCase();
    return difficultyColors[upperDiff] || difficultyColors.UNKNOWN;
  };

  let borderColorClass = "border-border"; // Default border
  if (song.currentScore >= 1009000) { // SSS+
    borderColorClass = "border-red-500"; // Red for SSS+
  } else if (song.currentScore >= 1007500) { // SSS
    borderColorClass = "border-orange-400"; // Orange for SSS
  } else if (song.currentScore >= 1005000) { // SS+
    borderColorClass = "border-yellow-400"; // Yellow for SS+
  } else if (song.currentScore >= 1000000) { // SS
    borderColorClass = "border-purple-400"; // Purple for SS
  } else if (song.currentScore >= 975000) { // S
    borderColorClass = "border-green-500"; // Green for S
  }


  return (
    <Card className={cn(
        "overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 w-full border-2",
        borderColorClass
      )} 
      style={{ aspectRatio: '2 / 1' }}
    >
      <CardContent className="p-0 flex h-full">
        <div className="w-1/3 relative h-full bg-muted flex items-center justify-center">
          {/* Jacket image area - kept empty as per request */}
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
          <div className="space-y-1.5 text-xs mt-1">
            {inSimulationMode ? (
              // Simulation Mode: Show Target Score/Rating primarily
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="flex items-center"><TargetIcon className="w-3 h-3 mr-1 text-green-500" /></span>
                <span className="font-medium text-foreground">
                  {song.targetScore.toLocaleString()}
                  {' / '}
                  {song.targetRating.toFixed(2)}
                  {/* Show delta only if currentScore is meaningfully different from targetScore and positive */}
                  {(song.currentScore > 0 && (scoreDifferenceValue !== 0 || ratingDifferenceValue !== 0)) && (
                    <span className="text-green-600 dark:text-green-400 ml-1">
                      (ΔS: {scoreDifferenceValue > 0 ? "+" : ""}{scoreDifferenceValue.toLocaleString()}, ΔR: {ratingDifferenceValue > 0 ? "+" : ""}{ratingDifferenceDisplay})
                    </span>
                  )}
                </span>
              </div>
            ) : (
              // Not in Simulation Mode (or strategy not selected yet): Show Current Score/Rating
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="flex items-center"><Star className="w-3 h-3 mr-1 text-yellow-500" /></span>
                <span className="font-medium text-foreground">{song.currentScore.toLocaleString()} / {song.currentRating.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

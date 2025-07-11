
"use client";

import React from "react"; // Import React
import type { CalculationStrategy, Song } from "@/types/result-page";
import { Card, CardContent } from "@/components/ui/card";
import { Music2, Star, Target as TargetIcon, ArrowUpCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_SCORE_FOR_EXCLUDE_TOGGLE = 1009000 -1; 

const difficultyColors: { [key: string]: string } = {
  ULT: "text-[#9F5D67]", MAS: "text-[#CE12CE]", EXP: "text-[#F10B0B]", 
  ADV: "text-[#EF9F00]", BAS: "text-[#40C540]", UNKNOWN: "text-muted-foreground",
};

type SongCardProps = {
  song: Song;
  calculationStrategy: CalculationStrategy | null;
  isExcluded: boolean;
  onExcludeToggle: () => void;
};

function SongCard({ song, calculationStrategy, isExcluded, onExcludeToggle }: SongCardProps) {
  const inSimulationMode = !!calculationStrategy && calculationStrategy !== "none";

  const scoreDifference = song.targetScore - song.currentScore;
  const ratingDifferenceValue = song.targetRating - song.currentRating;
  
  const ratingActuallyChanged = Math.abs(ratingDifferenceValue) > 0.00005; 
  const scoreActuallyChanged = song.targetScore !== song.currentScore;

  const isSimulatedAndChanged = inSimulationMode && (scoreActuallyChanged || ratingActuallyChanged) && !isExcluded;

  const getDifficultyColorClass = (diff: string) => {
    const upperDiff = diff.toUpperCase();
    return difficultyColors[upperDiff] || difficultyColors.UNKNOWN;
  };

  let borderColorClass = "border-border"; 
  if (song.currentScore >= 1009000) borderColorClass = "border-red-500"; 
  else if (inSimulationMode && song.targetScore >= 1009000 && !isExcluded) borderColorClass = "border-purple-400"; 
  else if (isExcluded) borderColorClass = "border-gray-500";
  else borderColorClass = "border-green-500"; 
  
  const handleCardClick = () => {
    if (song.currentScore <= MAX_SCORE_FOR_EXCLUDE_TOGGLE && calculationStrategy !== "none") {
        onExcludeToggle();
    }
  };

  return (
    <Card 
      className={cn(
        "overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 w-full border-2 relative",
        borderColorClass,
        (song.currentScore <= MAX_SCORE_FOR_EXCLUDE_TOGGLE && calculationStrategy !== "none") ? "cursor-pointer" : "cursor-default"
      )}
      onClick={handleCardClick}
    >
      <CardContent className="p-3 flex flex-col justify-between h-full bg-card-foreground/5">
        <div>
          <div className="flex justify-between items-center">
              <h3 className={cn("text-sm font-semibold font-headline truncate flex items-center", getDifficultyColorClass(song.diff))}>
                  <Music2 className="w-4 h-4 mr-1.5 text-primary shrink-0" />
                  {song.title}
              </h3>
              <span className="text-xs font-mono text-muted-foreground ml-2 shrink-0">
                  {song.chartConstant ? song.chartConstant.toFixed(1) : 'N/A'}
              </span>
          </div>
          <div className="flex items-center">
              <span className="text-xs font-bold text-muted-foreground">
                  {song.diff.toUpperCase()}
              </span>
              {isExcluded && (
                  <XCircle className="w-3 h-3 ml-1 text-red-500 inline-block" title="Excluded from calculation"/>
              )}
          </div>
        </div>

        <div className="mt-2 text-right">
          {isSimulatedAndChanged && (
              <div className="flex items-center justify-end text-green-600 dark:text-green-400 text-xs">
                  <ArrowUpCircle className="w-3 h-3 mr-1" />
                  <span>
                      {scoreDifference !== 0 ? (scoreDifference > 0 ? "+" : "") + scoreDifference.toLocaleString() : "±0"}
                      {' / '}
                      {ratingActuallyChanged ? (ratingDifferenceValue > 0 ? "+" : "") + ratingDifferenceValue.toFixed(2) : "±0.00"}
                  </span>
              </div>
          )}

          <div className="flex items-center justify-end text-xs text-muted-foreground mt-0.5">
              <span className="flex items-center mr-1">
                  {isSimulatedAndChanged ? (
                      <TargetIcon className="w-3 h-3 text-accent" />
                  ) : (
                      <Star className="w-3 h-3 text-yellow-500" />
                  )}
              </span>
              <span className="font-medium text-foreground">
                  {isSimulatedAndChanged || isExcluded ? (
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
      </CardContent>
      {isExcluded && (
        <div className="absolute inset-0 bg-gray-800 bg-opacity-80 z-10 pointer-events-none">
          <div 
            className="absolute top-1/2 left-0 w-full h-[2px] bg-red-500 bg-opacity-70 transform -translate-y-1/2 origin-center z-20"
            style={{ transform: 'translateY(-50%) rotate(-30deg) scale(1.2)' }}
          />
        </div>
      )}
    </Card>
  );
}

export default React.memo(SongCard);

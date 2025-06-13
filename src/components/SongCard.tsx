
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
  // isScoreLimitReleased?: boolean; // Consider passing this if 1010000 cap is crucial for red/green
};

export default function SongCard({ song, calculationStrategy }: SongCardProps) {
  const inSimulationMode = !!calculationStrategy;

  // Check if the song's score or rating has been targeted for a change during simulation
  const hasChanged =
    inSimulationMode &&
    (song.currentScore !== song.targetScore ||
      Math.abs(song.currentRating - song.targetRating) > 0.00005); // Epsilon for float comparison

  const scoreDifference = song.targetScore - song.currentScore;
  const ratingDifference = song.targetRating - song.currentRating;
  const ratingDifferenceDisplay = parseFloat(ratingDifference.toFixed(2)); // For display

  if (song.title.includes("MarbleBlue.") || song.title.includes("Random") || song.title.includes("Makear") || song.title.includes("VERSE")) {
    console.log(
      `[SongCard] ${song.title} (${song.diff}): currentS: ${song.currentScore}, targetS: ${song.targetScore}, currentR: ${song.currentRating.toFixed(4)}, targetR: ${song.targetRating.toFixed(4)}, hasChanged: ${hasChanged}, inSim: ${inSimulationMode}, scoreDiff: ${scoreDifference}, ratingDiffDisplay: ${ratingDifferenceDisplay}`
    );
  }

  const getDifficultyColorClass = (diff: string) => {
    const upperDiff = diff.toUpperCase();
    return difficultyColors[upperDiff] || difficultyColors.UNKNOWN;
  };

  let borderColorClass = "border-border"; // Default border

  if (inSimulationMode) {
    // 1. 밝은 보라색: 목표 점수가 정확히 1,009,000점 (SSS+)
    if (song.targetScore === 1009000) {
      borderColorClass = "border-purple-400";
    }
    // 2. 초록색: 목표 점수가 1,009,000점 미만 (갱신 가능성이 있거나, 그 상태로 유지)
    else if (song.targetScore < 1009000) {
      borderColorClass = "border-green-500";
    }
    // 3. 빨간색: 목표 점수가 1,009,000점을 초과 (예: 한계 해제 시 1,010,000) 또는 이미 1009000 초과 상태에서 변경 없음
    // (song.targetScore > 1009000)
    else {
      borderColorClass = "border-red-500";
    }
  } else {
     // 시뮬레이션 모드가 아닐 때의 기본 테두리 또는 다른 점수 기반 색상 로직 (현재는 기본)
    borderColorClass = "border-border";
    // Optional: Add score-based border colors for non-simulation mode if desired, similar to old logic
    // const scoreForBorder = song.currentScore;
    // if (scoreForBorder >= 1009000) { borderColorClass = "border-red-500"; }
    // else if (scoreForBorder >= 1007500) { borderColorClass = "border-orange-400"; }
    // else if (scoreForBorder >= 1005000) { borderColorClass = "border-yellow-400"; }
    // else if (scoreForBorder >= 1000000) { borderColorClass = "border-purple-500"; } // Differentiating from sim purple
    // else if (scoreForBorder >= 975000) { borderColorClass = "border-green-500"; }
  }


  return (
    <Card className={cn(
        "overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 w-full border-2",
        borderColorClass
      )}
      // Removed fixed aspect ratio
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
            {/* Show delta only if changed AND in simulation mode */}
            {hasChanged && (scoreDifference !== 0 || Math.abs(ratingDifference) > 0.00005) && (
              <div className="flex items-center justify-end text-green-600 dark:text-green-400">
                <ArrowUpCircle className="w-3 h-3 mr-1" />
                <span>
                  {scoreDifference > 0 ? "+" : ""}{scoreDifference.toLocaleString()}
                  {' / '}
                  {ratingDifference > 0 ? "+" : ""}{ratingDifferenceDisplay.toFixed(2)}
                </span>
              </div>
            )}

            {/* Main score/rating line */}
            <div className="flex items-center justify-end text-muted-foreground">
              <span className="flex items-center mr-1">
                {hasChanged ? (
                  <TargetIcon className="w-3 h-3 text-accent" />
                ) : (
                  <Star className="w-3 h-3 text-yellow-500" />
                )}
              </span>
              <span className="font-medium text-foreground">
                {hasChanged ? (
                  <>
                    {song.targetScore.toLocaleString()}
                    {' / '}
                    {song.targetRating.toFixed(2)}
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


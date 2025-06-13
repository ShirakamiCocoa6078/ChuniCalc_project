
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

  const scoreDifference = song.targetScore - song.currentScore;
  const ratingDifference = song.targetRating - song.currentRating;
  // Use a small epsilon for floating point comparison of ratings
  const ratingActuallyChanged = Math.abs(ratingDifference) > 0.00005;
  const scoreActuallyChanged = scoreDifference !== 0;

  // This flag determines if the card should display the "changed" state
  const isSimulatedAndChanged = inSimulationMode && (scoreActuallyChanged || ratingActuallyChanged);
  
  // For debug logging specific songs
  if (song.title.includes("MarbleBlue.") || song.title.includes("Random") || song.title.includes("Makear") || song.title.includes("VERSE")) {
    console.log(
      `[SongCard] ${song.title} (${song.diff}): currentS: ${song.currentScore}, targetS: ${song.targetScore}, currentR: ${song.currentRating.toFixed(4)}, targetR: ${song.targetRating.toFixed(4)}, inSim: ${inSimulationMode}, scoreDiff: ${scoreDifference}, ratingDiff: ${ratingDifference.toFixed(4)}, isSimAndChanged: ${isSimulatedAndChanged}`
    );
  }

  const getDifficultyColorClass = (diff: string) => {
    const upperDiff = diff.toUpperCase();
    return difficultyColors[upperDiff] || difficultyColors.UNKNOWN;
  };

  let borderColorClass = "border-border"; // Default border

  if (inSimulationMode) {
    // 1. 빨간색: currentScore가 1,009,000점 이상이고, targetScore가 currentScore와 같거나 클 때 (이미 최고점 혹은 그 이상 유지/상승)
    if (song.currentScore >= 1009000 && song.targetScore >= song.currentScore) {
      borderColorClass = "border-red-500";
    }
    // 2. 밝은 보라색: targetScore가 정확히 1,009,000점이고, currentScore가 1,009,000점 미만일 때 (SSS+로 갱신)
    else if (song.targetScore === 1009000 && song.currentScore < 1009000) {
      borderColorClass = "border-purple-400";
    }
    // 3. 초록색: targetScore가 currentScore보다 크고, targetScore가 1,009,000점 미만일 때 (SSS+ 미만으로 갱신)
    else if (song.targetScore > song.currentScore && song.targetScore < 1009000) {
      borderColorClass = "border-green-500";
    }
    // 그 외 시뮬레이션 중 상황은 기본 테두리 (예: 점수 하락 시나리오가 있다면 여기, 또는 점수 변경 없을 때)
    else {
      borderColorClass = "border-border";
    }
  } else {
     // 시뮬레이션 모드가 아닐 때의 기본 테두리
    borderColorClass = "border-border";
  }


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
            {/* 변화량 표시: isSimulatedAndChanged가 true일 때 */}
            {isSimulatedAndChanged && (
              <div className="flex items-center justify-end text-green-600 dark:text-green-400">
                <ArrowUpCircle className="w-3 h-3 mr-1" />
                <span>
                  {scoreDifference > 0 ? "+" : ""}{scoreDifference.toLocaleString()}
                  {' / '}
                  {ratingDifference > 0 ? "+" : ""}{ratingDifference.toFixed(2)} 
                </span>
              </div>
            )}

            {/* 주요 점수/레이팅 표시 */}
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


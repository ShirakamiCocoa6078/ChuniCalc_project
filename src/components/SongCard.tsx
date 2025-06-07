
"use client";

import type { CalculationStrategy } from "@/app/result/page"; // CalculationStrategy 타입을 가져옵니다.
import { Card, CardContent } from "@/components/ui/card";
import { Music2, Star, Target as TargetIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Song = {
  id: string;
  diff: string; // ULT, MAS, EXP, ADV, BAS (original casing)
  title: string;
  chartConstant: number | null; // 보면 정수
  currentScore: number;
  currentRating: number;
  targetScore: number;
  targetRating: number;
};

type SongCardProps = {
  song: Song;
  calculationStrategy: CalculationStrategy; // 전략 prop 추가
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
  const scoreDifference = song.targetScore > 0 ? song.targetScore - song.currentScore : 0;
  const ratingDifference = song.targetRating > 0 ? parseFloat((song.targetRating - song.currentRating).toFixed(2)) : 0;

  const getDifficultyColorClass = (diff: string) => {
    const upperDiff = diff.toUpperCase();
    return difficultyColors[upperDiff] || difficultyColors.UNKNOWN;
  };

  // 갱신 가능 여부 테두리: 점수 1,009,000 이상이면 빨강, 아니면 초록
  const borderColorClass = song.currentScore >= 1009000 ? "border-red-500" : "border-green-500";

  return (
    <Card className={cn(
        "overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 w-full border-2",
        borderColorClass
      )} 
      style={{ aspectRatio: '2 / 1' }}
    >
      <CardContent className="p-0 flex h-full">
        <div className="w-1/3 relative h-full bg-muted flex items-center justify-center">
          {/* 자켓 이미지 영역 - 비워둠 */}
        </div>
        <div className="w-2/3 p-3 flex flex-col justify-between bg-card-foreground/5">
          <div>
            <h3 className={cn(
                "text-sm font-semibold font-headline truncate flex items-center",
                getDifficultyColorClass(song.diff) // 곡명에 난이도 색상 적용
              )}
            >
              <Music2 className="w-4 h-4 mr-1.5 text-primary shrink-0" />
              {song.title}
            </h3>
            <span className="text-xs font-bold ml-1 text-muted-foreground">
              {song.diff} {/* 난이도 텍스트 (대문자 변환 없이) */}
            </span>
          </div>
          <div className="space-y-1.5 text-xs mt-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center"><Star className="w-3 h-3 mr-1 text-yellow-500" /></span>
              <span className="font-medium text-foreground">{song.currentScore.toLocaleString()} / {song.currentRating.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center"><TargetIcon className="w-3 h-3 mr-1 text-green-500" /></span>
              <span className="font-medium text-foreground">
                {song.targetScore > 0 ? song.targetScore.toLocaleString() : '-'}
                {scoreDifference > 0 && <span className="text-green-600 dark:text-green-400 ml-1">(+{scoreDifference.toLocaleString()})</span>}
                {' / '}
                {song.targetRating > 0 ? song.targetRating.toFixed(2) : '-'}
                {ratingDifference > 0 && <span className="text-green-600 dark:text-green-400 ml-1">(+{ratingDifference.toFixed(2)})</span>}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

    
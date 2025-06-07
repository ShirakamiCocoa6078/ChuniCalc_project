
"use client";

import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Music2, Star, Target as TargetIcon } from "lucide-react";

export type Song = {
  id: number;
  title: string;
  jacketUrl: string;
  currentScore: number;
  currentRating: number;
  targetScore: number;
  targetRating: number;
};

type SongCardProps = {
  song: Song;
};

export default function SongCard({ song }: SongCardProps) {
  const scoreDifference = song.targetScore - song.currentScore;
  const ratingDifference = song.targetRating - song.currentRating;

  return (
    <Card className="overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 w-full" style={{ aspectRatio: '2 / 1' }}>
      <CardContent className="p-0 flex h-full">
        <div className="w-1/3 relative h-full">
          <Image
            src={song.jacketUrl}
            alt={`Jacket for ${song.title}`}
            layout="fill"
            objectFit="cover"
            className="bg-muted"
            data-ai-hint="album art"
          />
        </div>
        <div className="w-2/3 p-3 flex flex-col justify-between bg-card-foreground/5">
          <div>
            <h3 className="text-sm font-semibold font-headline truncate text-foreground flex items-center">
              <Music2 className="w-4 h-4 mr-1.5 text-primary shrink-0" /> 
              {song.title}
            </h3>
          </div>
          <div className="space-y-1.5 text-xs mt-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center"><Star className="w-3 h-3 mr-1 text-yellow-500" /></span>
              <span className="font-medium text-foreground">{song.currentScore.toLocaleString()} / {song.currentRating.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center"><TargetIcon className="w-3 h-3 mr-1 text-green-500" /></span>
              <span className="font-medium text-foreground">
                {song.targetScore.toLocaleString()}
                {scoreDifference >= 0 && <span className="text-green-600 dark:text-green-400 ml-1">(+{scoreDifference.toLocaleString()})</span>}
                {' / '}
                {song.targetRating.toFixed(2)}
                {ratingDifference >= 0 && <span className="text-green-600 dark:text-green-400 ml-1">(+{ratingDifference.toFixed(2)})</span>}
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70 pt-1">Max: 1,001,000 / 17.85</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

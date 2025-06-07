
"use client";

import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Music2, Star, Target as TargetIcon } from "lucide-react";

export type Song = {
  id: string; // music_id
  diff: string; // difficulty (e.g., "MAS", "EXP")
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
  const scoreDifference = song.targetScore > 0 ? song.targetScore - song.currentScore : 0;
  const ratingDifference = song.targetRating > 0 ? parseFloat((song.targetRating - song.currentRating).toFixed(2)) : 0;

  return (
    <Card className="overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 w-full" style={{ aspectRatio: '2 / 1' }}>
      <CardContent className="p-0 flex h-full">
        <div className="w-1/3 relative h-full bg-muted flex items-center justify-center">
          {song.jacketUrl && !song.jacketUrl.includes("placehold.co") && !song.jacketUrl.startsWith("/api/get-jacket-image") ? (
             <Image
              src={song.jacketUrl}
              alt={`Jacket for ${song.title} (${song.diff})`}
              layout="fill"
              objectFit="cover"
              data-ai-hint="album art"
              onError={(e) => {
                e.currentTarget.srcset = "https://placehold.co/120x120.png?text=Error";
                e.currentTarget.src = "https://placehold.co/120x120.png?text=Error";
              }}
            />
          ) : (
             <Image
              src={song.jacketUrl || "https://placehold.co/120x120.png?text=Jkt"}
              alt={`Jacket for ${song.title} (${song.diff})`}
              layout="fill"
              objectFit="cover"
              data-ai-hint="album art"
            />
          )}
        </div>
        <div className="w-2/3 p-3 flex flex-col justify-between bg-card-foreground/5">
          <div>
            <h3 className="text-sm font-semibold font-headline truncate text-foreground flex items-center">
              <Music2 className="w-4 h-4 mr-1.5 text-primary shrink-0" />
              {song.title} <span className="text-xs text-muted-foreground ml-1">({song.diff})</span>
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
                {song.targetScore > 0 ? song.targetScore.toLocaleString() : '-'}
                {scoreDifference > 0 && <span className="text-green-600 dark:text-green-400 ml-1">(+{scoreDifference.toLocaleString()})</span>}
                {' / '}
                {song.targetRating > 0 ? song.targetRating.toFixed(2) : '-'}
                {ratingDifference > 0 && <span className="text-green-600 dark:text-green-400 ml-1">(+{ratingDifference.toFixed(2)})</span>}
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70 pt-1">Max: 1,001,000 / 17.85</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

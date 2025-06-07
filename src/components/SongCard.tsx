
"use client";

import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Music2, Star, Target as TargetIcon, ImageOff } from "lucide-react";
// Removed useEffect, useState, Loader2 as jacket fetching is disabled

export type Song = {
  id: string;
  title: string;
  jacketUrl: string; // Will always be a placeholder
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

  // Jacket fetching is disabled, always use the placeholder from song.jacketUrl
  // or a generic "no image" indicator. For simplicity, we use song.jacketUrl.
  // If song.jacketUrl itself is a "no image" placeholder, that will be shown.

  return (
    <Card className="overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 w-full" style={{ aspectRatio: '2 / 1' }}>
      <CardContent className="p-0 flex h-full">
        <div className="w-1/3 relative h-full bg-muted flex items-center justify-center">
          {/* Always show placeholder or a generic "no image" icon if song.jacketUrl is for that */}
          {song.jacketUrl && !song.jacketUrl.includes("placehold.co") && !song.jacketUrl.startsWith("/api/get-jacket-image") ? (
             <Image
              src={song.jacketUrl} // This should be a placeholder URL
              alt={`Jacket for ${song.title}`}
              layout="fill"
              objectFit="cover"
              data-ai-hint="album art"
              onError={(e) => {
                // Fallback to a default placeholder if the provided song.jacketUrl also fails
                e.currentTarget.srcset = "https://placehold.co/120x120.png?text=Error";
                e.currentTarget.src = "https://placehold.co/120x120.png?text=Error";
              }}
            />
          ) : (
             <Image
              src={song.jacketUrl || "https://placehold.co/120x120.png?text=Jkt"} // Default placeholder
              alt={`Jacket for ${song.title}`}
              layout="fill"
              objectFit="cover"
              data-ai-hint="album art"
            />
          )}
          {/* Fallback for when jacketUrl is truly missing or explicitly for "no image" */}
          {/* This part can be simplified if song.jacketUrl is always a valid placeholder */}
          {/* For now, if jacketUrl is not a typical placeholder, it means it was an attempt for real image */}
          {/* Since we disabled fetching, we can show ImageOff or the placeholder. */}
          {/* Let's simplify and always rely on song.jacketUrl being a placeholder now. */}
          {/*
          <div className="flex flex-col items-center text-muted-foreground p-1">
            <ImageOff className="w-6 h-6" />
            <span className="text-xs mt-1 text-center">No Image</span>
          </div>
          */}
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

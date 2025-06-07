
"use client";

import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Music2, Star, Target as TargetIcon, ImageOff, Loader2 } from "lucide-react";
import { useEffect, useState } from 'react';

export type Song = {
  id: string; // Changed to string to match API response for music_id
  title: string;
  jacketUrl: string; // Initial placeholder URL
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

  const [actualJacketUrl, setActualJacketUrl] = useState<string>(song.jacketUrl); // Initialize with placeholder
  const [isLoadingJacket, setIsLoadingJacket] = useState<boolean>(true);
  const [jacketError, setJacketError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    if (song.id) {
      setIsLoadingJacket(true);
      setJacketError(false);
      fetch(`/api/get-jacket-image?musicId=${song.id}`)
        .then(res => {
          if (!res.ok) {
            return res.json().then(errData => { // Try to parse error message from API
              throw new Error(errData.error || `Failed to fetch jacket: ${res.status}`);
            });
          }
          return res.json();
        })
        .then(data => {
          if (isMounted) {
            if (data.imageUrl) {
              setActualJacketUrl(data.imageUrl);
            } else {
              console.warn(`No image URL found for song ${song.id}: ${data.error || 'Unknown error'}`);
              setJacketError(true); // Mark as error, placeholder will be shown
            }
          }
        })
        .catch(error => {
          if (isMounted) {
            console.error(`Error fetching jacket for song ${song.id}:`, error.message);
            setJacketError(true); // Mark as error
          }
        })
        .finally(() => {
          if (isMounted) {
            setIsLoadingJacket(false);
          }
        });
    } else {
      setIsLoadingJacket(false);
      setJacketError(true); // No ID, cannot fetch
    }
    return () => {
      isMounted = false;
    };
  }, [song.id]);

  const displayJacketUrl = jacketError ? song.jacketUrl : actualJacketUrl;

  return (
    <Card className="overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 w-full" style={{ aspectRatio: '2 / 1' }}>
      <CardContent className="p-0 flex h-full">
        <div className="w-1/3 relative h-full bg-muted flex items-center justify-center">
          {isLoadingJacket ? (
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          ) : jacketError ? (
            <div className="flex flex-col items-center text-muted-foreground p-1">
              <ImageOff className="w-6 h-6" />
              <span className="text-xs mt-1 text-center">No Image</span>
            </div>
          ) : (
            <Image
              src={displayJacketUrl}
              alt={`Jacket for ${song.title}`}
              layout="fill"
              objectFit="cover"
              onError={() => {
                if (!jacketError) setJacketError(true); // If fetched URL fails to load
              }}
              data-ai-hint="album art"
            />
          )}
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


"use client";

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SongCard, { type Song } from "@/components/SongCard";
import { User, Gauge, Target, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const generatePlaceholderSongs = (count: number): Song[] => {
  return Array.from({ length: count }, (_, i) => {
    const currentScore = Math.floor(Math.random() * 100000) + 850000; // 850,000 - 950,000
    const currentRating = parseFloat((Math.random() * 2 + 15.0).toFixed(2)); // 15.00 - 17.00
    
    // Ensure target is an improvement or same
    const targetScore = Math.max(currentScore, Math.min(1001000, currentScore + Math.floor(Math.random() * 100000))); 
    const targetRating = parseFloat(Math.max(currentRating, Math.min(17.85, currentRating + Math.random() * 0.8)).toFixed(2));

    return {
      id: i + 1,
      title: `Placeholder Song Title ${i + 1}`,
      jacketUrl: `https://placehold.co/120x120.png?text=S${i+1}`,
      currentScore,
      currentRating,
      targetScore,
      targetRating,
    };
  });
};

function ResultContent() {
  const searchParams = useSearchParams();
  const nickname = searchParams.get("nickname") || "Player";
  const currentRating = searchParams.get("current") || "N/A";
  const targetRating = searchParams.get("target") || "N/A";
  
  const [best30SongsData, setBest30SongsData] = useState<Song[]>([]);
  const [new20SongsData, setNew20SongsData] = useState<Song[]>([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(true);

  useEffect(() => {
    const rawBest30 = generatePlaceholderSongs(30);
    const rawNew20 = generatePlaceholderSongs(20);

    const sortSongs = (songs: Song[]): Song[] => {
      return [...songs].sort((a, b) => {
        // Primary sort: currentRating (descending)
        if (b.currentRating !== a.currentRating) {
          return b.currentRating - a.currentRating;
        }
        // Secondary sort: score difference (targetScore - currentScore) (descending)
        const scoreDiffA = a.targetScore - a.currentScore;
        const scoreDiffB = b.targetScore - b.currentScore;
        return scoreDiffB - scoreDiffA;
      });
    };

    setBest30SongsData(sortSongs(rawBest30));
    setNew20SongsData(sortSongs(rawNew20));
    setIsLoadingSongs(false);
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 p-4 bg-card border border-border rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex items-center gap-3">
            <User className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold font-headline">{nickname}</h1>
              <Link href="/" className="text-sm text-primary hover:underline flex items-center">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Calculator
              </Link>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-4 text-sm sm:text-base w-full sm:w-auto">
            <div className="flex items-center p-2 bg-secondary rounded-md">
              <Gauge className="w-5 h-5 mr-2 text-primary" />
              <span>Current: <span className="font-semibold">{currentRating}</span></span>
            </div>
            <div className="flex items-center p-2 bg-secondary rounded-md">
              <Target className="w-5 h-5 mr-2 text-primary" />
              <span>Target: <span className="font-semibold">{targetRating}</span></span>
            </div>
          </div>
        </header>

        <Tabs defaultValue="best30" className="w-full">
          <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3 mb-6 bg-muted p-1 rounded-lg">
            <TabsTrigger value="best30" className="py-2.5 text-sm sm:text-base">Best 30</TabsTrigger>
            <TabsTrigger value="new20" className="py-2.5 text-sm sm:text-base">New 20</TabsTrigger>
            <TabsTrigger value="best30new20" className="py-2.5 text-sm sm:text-base">Best30 + New20</TabsTrigger>
          </TabsList>

          {isLoadingSongs ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-xl text-muted-foreground">Loading song data...</p>
            </div>
          ) : (
            <>
              <TabsContent value="best30">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">Best 30 Songs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={cn(
                      "grid grid-cols-1 gap-4",
                      "sm:grid-cols-2",
                      "md:grid-cols-3",
                      "lg:grid-cols-4",
                      "xl:grid-cols-5" // Fixed medium size
                    )}>
                      {best30SongsData.map((song) => (
                        <SongCard key={`best30-${song.id}`} song={song} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="new20">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">New 20 Songs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={cn(
                      "grid grid-cols-1 gap-4",
                      "sm:grid-cols-2",
                      "md:grid-cols-3",
                      "lg:grid-cols-4", 
                      "xl:grid-cols-4" // Fixed medium size, slightly fewer columns for fewer items
                    )}>
                      {new20SongsData.map((song) => (
                        <SongCard key={`new20-${song.id}`} song={song} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="best30new20">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-headline text-2xl">Best 30 + New 20 Songs</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col lg:flex-row gap-6">
                    <div className="lg:w-3/5">
                      <h3 className="text-xl font-semibold mb-3 font-headline">Best 30</h3>
                      <div className={cn(
                        "grid grid-cols-1 gap-4",
                        "sm:grid-cols-2",
                        "md:grid-cols-2",
                        "lg:grid-cols-3",
                        "xl:grid-cols-3" // Adjusted for 3/5 width
                      )}>
                        {best30SongsData.map((song) => (
                          <SongCard key={`combo-best30-${song.id}`} song={song} />
                        ))}
                      </div>
                    </div>
                    <div className="lg:w-2/5">
                      <h3 className="text-xl font-semibold mb-3 font-headline">New 20</h3>
                      <div className={cn(
                        "grid grid-cols-1 gap-4",
                        "sm:grid-cols-1",
                        "md:grid-cols-2",
                        "lg:grid-cols-2",
                        "xl:grid-cols-2" // Adjusted for 2/5 width
                      )}>
                        {new20SongsData.map((song) => (
                          <SongCard key={`combo-new20-${song.id}`} song={song} />
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </main>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-xl">Loading results...</div>}>
      <ResultContent />
    </Suspense>
  );
}

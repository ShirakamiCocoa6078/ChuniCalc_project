
"use client";

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import SongCard, { type Song } from "@/components/SongCard";
import { User, Gauge, Target, ArrowLeft, Columns } from "lucide-react";
import { cn } from "@/lib/utils";

const generatePlaceholderSongs = (count: number): Song[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Placeholder Song Title ${i + 1} (Longer name to test truncation)`,
    jacketUrl: `https://placehold.co/120x120.png?text=S${i+1}`,
    currentScore: Math.floor(Math.random() * 200000) + 800000, // 800,000 - 1,000,000
    currentRating: parseFloat((Math.random() * 3 + 14.5).toFixed(2)), // 14.50 - 17.50
    targetScore: Math.floor(Math.random() * 1000) + 1000000, // 1,000,000 - 1,001,000
    targetRating: parseFloat((Math.random() * 0.35 + 17.5).toFixed(2)), // 17.50 - 17.85
  }));
};

function ResultContent() {
  const searchParams = useSearchParams();
  const nickname = searchParams.get("nickname") || "Player";
  const currentRating = searchParams.get("current") || "N/A";
  const targetRating = searchParams.get("target") || "N/A";
  
  // cardSizeSetting stores the slider's raw value (3 to 7)
  // 3 means smallest cards (most columns), 7 means largest cards (fewest columns)
  const [cardSizeSetting, setCardSizeSetting] = useState<number>(5); 

  const [best30SongsData, setBest30SongsData] = useState<Song[]>([]);
  const [new20SongsData, setNew20SongsData] = useState<Song[]>([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(true);

  useEffect(() => {
    setBest30SongsData(generatePlaceholderSongs(30));
    setNew20SongsData(generatePlaceholderSongs(20));
    setIsLoadingSongs(false);
  }, []);

  // Calculate the actual number of columns for XL screens based on cardSizeSetting
  // Slider min 3 (small cards) maps to 7 columns
  // Slider max 7 (large cards) maps to 3 columns
  const actualXlColumnCount = (3 + 7) - cardSizeSetting;

  const getResponsiveCols = (baseXlCols: number) => {
    return {
      sm: Math.max(1, baseXlCols - 3), 
      md: Math.max(2, baseXlCols - 2), 
      lg: Math.max(3, baseXlCols - 1), 
      xl: Math.max(3, baseXlCols)      
    };
  };
  
  const best30Cols = getResponsiveCols(actualXlColumnCount);
  const new20Cols = getResponsiveCols(Math.max(3, actualXlColumnCount -1)); 
  
  const comboBest30Cols = getResponsiveCols(Math.max(3, actualXlColumnCount -1)); 
  const comboNew20Cols = getResponsiveCols(Math.max(2, actualXlColumnCount -2)); // Allows for potentially fewer columns if base is small


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

        <div className="mb-6 p-4 bg-card border border-border rounded-lg shadow-sm">
          <Label htmlFor="cardSizeSlider" className="flex items-center text-md font-medium mb-2">
            <Columns className="w-5 h-5 mr-2 text-primary" /> Card Size
          </Label>
          <Slider
            id="cardSizeSlider"
            min={3} // Represents smallest card size setting (most columns)
            max={7} // Represents largest card size setting (fewest columns)
            step={1}
            value={[cardSizeSetting]}
            onValueChange={(value) => setCardSizeSetting(value[0])}
            className="w-full max-w-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Adjusts displayed card size. Lower values = smaller cards (more per row). Higher values = larger cards (fewer per row).
          </p>
        </div>

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
                      `sm:grid-cols-${best30Cols.sm}`,
                      `md:grid-cols-${best30Cols.md}`,
                      `lg:grid-cols-${best30Cols.lg}`,
                      `xl:grid-cols-${best30Cols.xl}`
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
                      `sm:grid-cols-${new20Cols.sm}`,
                      `md:grid-cols-${new20Cols.md}`,
                      `lg:grid-cols-${new20Cols.lg}`,
                      `xl:grid-cols-${new20Cols.xl}`
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
                        `sm:grid-cols-${comboBest30Cols.sm}`,
                        `md:grid-cols-${comboBest30Cols.md}`,
                        `lg:grid-cols-${comboBest30Cols.lg}`,
                        `xl:grid-cols-${comboBest30Cols.xl}`
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
                        `sm:grid-cols-${comboNew20Cols.sm}`,
                        `md:grid-cols-${comboNew20Cols.md}`,
                        `lg:grid-cols-${comboNew20Cols.lg}`,
                        `xl:grid-cols-${comboNew20Cols.xl}`
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


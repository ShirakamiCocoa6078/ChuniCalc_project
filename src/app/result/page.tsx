
"use client";

import { Suspense } from 'react';
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SongCard, { type Song } from "@/components/SongCard";
import { User, Gauge, Target, Home, ArrowLeft } from "lucide-react";

const generatePlaceholderSongs = (count: number): Song[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Placeholder Song Title ${i + 1} (Longer name to test truncation)`,
    jacketUrl: `https://placehold.co/100x100.png?text=Song${i+1}`,
    currentScore: Math.floor(Math.random() * 200000) + 800000, // 800,000 - 1,000,000
    currentRating: parseFloat((Math.random() * 3 + 14.5).toFixed(2)), // 14.50 - 17.50
    targetScore: Math.floor(Math.random() * 1000) + 1000000, // 1,000,000 - 1,001,000
    targetRating: parseFloat((Math.random() * 0.35 + 17.5).toFixed(2)), // 17.50 - 17.85
  }));
};

const best30SongsData = generatePlaceholderSongs(30);
const new20SongsData = generatePlaceholderSongs(20);

function ResultContent() {
  const searchParams = useSearchParams();
  const nickname = searchParams.get("nickname") || "Player";
  const currentRating = searchParams.get("current") || "N/A";
  const targetRating = searchParams.get("target") || "N/A";

  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 p-4 bg-card border border-border rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <User className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold font-headline">{nickname}</h1>
              <Link href="/" className="text-sm text-primary hover:underline flex items-center">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Calculator
              </Link>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-4 text-sm sm:text-base">
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

          <TabsContent value="best30">
            <Card>
              <CardHeader>
                <CardTitle className="font-headline text-2xl">Best 30 Songs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
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
                <div className="lg:w-3/5"> {/* Approx 60% for Best 30 */}
                  <h3 className="text-xl font-semibold mb-3 font-headline">Best 30</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 gap-4"> {/* Adjusted for combined view, can be 6 cols on very wide screens, but 3 is more practical */}
                    {best30SongsData.map((song) => (
                      <SongCard key={`combo-best30-${song.id}`} song={song} />
                    ))}
                  </div>
                </div>
                <div className="lg:w-2/5"> {/* Approx 40% for New 20 */}
                  <h3 className="text-xl font-semibold mb-3 font-headline">New 20</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-2 gap-4"> {/* Adjusted for combined view, can be 4 cols on very wide screens, but 2 is more practical */}
                    {new20SongsData.map((song) => (
                      <SongCard key={`combo-new20-${song.id}`} song={song} />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
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


"use client";

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import SongCard from "@/components/SongCard";
import { User, Gauge, Target as TargetIconLucide, ArrowLeft, Loader2, AlertTriangle, BarChart3, TrendingUp, TrendingDown, RefreshCw, Info, Settings2, Activity, Zap, Replace, Rocket, Telescope, CheckCircle2, XCircle, Brain, PlaySquare, ListChecks, FilterIcon, DatabaseZap, FileJson, Server, CalendarDays, BarChartHorizontalBig, FileSearch, Shuffle, Hourglass, X, Focus, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslation } from '@/lib/translations';
import { useChuniResultData } from '@/hooks/useChuniResultData';
import { type InitialData, type Song, type CalculationStrategy } from '@/types/result-page';
import { Input } from "@/components/ui/input";
import SimulationPlaylist from '@/components/SimulationPlaylist';
import { calculateChunithmSongRating } from '@/lib/rating-utils';

function ResultPageContent({ initialData }: { initialData: InitialData }) {
    const { locale } = useLanguage();
    const [isPlaylistModeOpen, setIsPlaylistModeOpen] = useState(false);

    const {
        apiPlayerName, best30SongsData, new20SongsData, combinedTopSongs,
        isLoadingSongs, errorLoadingSongs, strategy, setStrategy,
        playlistSongs, dispatch, allMusicData, excludedSongKeys, toggleExcludeSongKey,
        currentRating, targetRating, setTargetRating
    } = useChuniResultData(initialData);

    const [activeTab, setActiveTab] = useState('b30');

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        if (value === 'b30') setStrategy('b30_focus');
        else if (value === 'n20') setStrategy('n20_focus');
        else if (value === 'combined') setStrategy('hybrid_floor');
        else if (value === 'custom') setStrategy('playlist_custom');
    };

    const renderSongList = (songs: Song[], type: 'b30' | 'n20' | 'combined') => (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {songs.map((song, index) => {
          const songKey = `${song.id}_${song.diff}`;
          return <SongCard key={`${type}-${songKey}-${index}`} song={song} calculationStrategy={strategy} isExcluded={excludedSongKeys.has(songKey)} onExcludeToggle={() => toggleExcludeSongKey(songKey)} />;
        })}
      </div>
    );
    
    if (isLoadingSongs) return <div>Loading...</div>;
    if (errorLoadingSongs) return <div>Error: {errorLoadingSongs}</div>;

    return (
        <main className="min-h-screen p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
                <header className="mb-6 p-4 bg-card border rounded-lg flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold">{apiPlayerName}</h1>
                        <Link href="/" className="text-sm text-primary hover:underline">Back</Link>
                    </div>
                    <div className="flex items-center gap-2">
                        <span>Current: {currentRating.toFixed(4)}</span>
                        <Input type="number" value={targetRating} onChange={(e) => setTargetRating(parseFloat(e.target.value))} className="w-24" />
                    </div>
                </header>

                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="b30">Best 30</TabsTrigger>
                        <TabsTrigger value="n20">New 20</TabsTrigger>
                        <TabsTrigger value="combined">Combined</TabsTrigger>
                        <TabsTrigger value="custom">Custom</TabsTrigger>
                    </TabsList>
                    <TabsContent value="b30">{best30SongsData && renderSongList(best30SongsData, 'b30')}</TabsContent>
                    <TabsContent value="n20">{new20SongsData && renderSongList(new20SongsData, 'n20')}</TabsContent>
                    <TabsContent value="combined">
                        <div className="flex gap-2 my-4">
                            <Button onClick={() => setStrategy('hybrid_floor')} variant={strategy === 'hybrid_floor' ? 'default' : 'outline'}>Floor</Button>
                            <Button onClick={() => setStrategy('hybrid_peak')} variant={strategy === 'hybrid_peak' ? 'default' : 'outline'}>Peak</Button>
                        </div>
                        {combinedTopSongs && renderSongList(combinedTopSongs, 'combined')}
                    </TabsContent>
                    <TabsContent value="custom">
                        <Button onClick={() => setIsPlaylistModeOpen(true)} className="my-4">Edit Playlist</Button>
                        {/* Custom playlist results will be handled via the modal and subsequent state updates */}
                    </TabsContent>
                </Tabs>
            </div>
            {isPlaylistModeOpen && (
                 <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <Card className="w-full max-w-3xl h-[80vh] flex flex-col">
                        <CardHeader><CardTitle>Playlist</CardTitle><Button variant="ghost" size="icon" onClick={() => setIsPlaylistModeOpen(false)}><X/></Button></CardHeader>
                        <CardContent className="flex-1 overflow-y-auto">
                           <SimulationPlaylist
                                playlistSongs={playlistSongs}
                                allMusicData={allMusicData}
                                onAddSong={(song) => dispatch({ type: 'ADD_TO_PLAYLIST', payload: song })}
                                onRemoveSong={(song) => dispatch({ type: 'REMOVE_FROM_PLAYLIST', payload: { id: song.id, diff: song.diff }})}
                                onUpdateTarget={(song, newTargetScore) => {
                                    const newRating = calculateChunithmSongRating(newTargetScore, song.chartConstant);
                                    dispatch({ type: 'UPDATE_PLAYLIST_SONG_TARGET', payload: { id: song.id, diff: song.diff, targetScore: newTargetScore, targetRating: newRating }});
                                }}
                                onClose={() => setIsPlaylistModeOpen(false)}
                                onCalculate={() => { setStrategy('playlist_custom'); setIsPlaylistModeOpen(false); }}
                            />
                        </CardContent>
                    </Card>
                 </div>
            )}
        </main>
    );
}

export default function ResultPage() {
    const searchParams = useSearchParams();
    const { locale } = useLanguage();
    const initialData: InitialData = {
        userName: searchParams.get('nickname') ?? undefined,
        currentRating: parseFloat(searchParams.get('currentRating') ?? '0'),
        targetRating: parseFloat(searchParams.get('targetRating') ?? '0'),
        locale: locale,
    };

    return (
        <Suspense fallback={<div>Loading...</div>}>
            <ResultPageContent initialData={initialData} />
        </Suspense>
    );
}


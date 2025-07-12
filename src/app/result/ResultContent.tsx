"use client";

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, RefreshCw, PlusCircle, X } from "lucide-react";

import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslation, type Locale } from '@/lib/translations';
import { useChuniResultData } from '@/hooks/useChuniResultData';
import type { InitialData, Song, CalculationStrategy } from '@/types/result-page';
import SongCard from "@/components/SongCard";
import SimulationPlaylist from '@/components/SimulationPlaylist';
import { calculateChunithmSongRating } from '@/lib/rating-utils';

export default function ResultContent() {
    const searchParams = useSearchParams();
    const { locale } = useLanguage();
    const t = (key: any, ...args: any[]) => getTranslation(locale as Locale, key, ...args);

    const [clientHasMounted, setClientHasMounted] = useState(false);
    useEffect(() => setClientHasMounted(true), []);

    const [refreshNonce, setRefreshNonce] = useState(0);

    const initialData: InitialData = {
        userNameForApi: searchParams.get('nickname'),
        currentRatingDisplay: searchParams.get('playerRating'),
        targetRatingDisplay: searchParams.get('targetRating'),
        locale: locale as Locale,
        refreshNonce,
        clientHasMounted,
        calculationStrategy: 'none', // Initial strategy
    };

    const [isPlaylistModeOpen, setIsPlaylistModeOpen] = useState(false);
    const [activeStrategy, setActiveStrategy] = useState<CalculationStrategy>('none');
    
    const {
        apiPlayerName, best30SongsData, new20SongsData, combinedTopSongs,
        isLoadingSongs, errorLoadingSongs, lastRefreshed,
        playlistSongs, dispatch, allMusicData, excludedSongKeys, toggleExcludeSongKey,
        currentRating, targetRating, setTargetRating,
        runSimulation,
        simulationLog, finalOverallSimulatedRating,
    } = useChuniResultData({ ...initialData, calculationStrategy: activeStrategy });

    const handleStrategyChange = (value: string) => {
        const strategy = value as CalculationStrategy;
        setActiveStrategy(strategy);
        if (strategy !== 'playlist_custom') {
            runSimulation(strategy);
        }
    };
    
    const handleRefresh = () => {
        setRefreshNonce(prev => prev + 1);
    };

    const renderSongList = (songs: Song[]) => (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {songs.map((song) => {
          const songKey = `${song.id}_${song.diff}`;
          return <SongCard key={songKey} song={song} calculationStrategy={activeStrategy} isExcluded={excludedSongKeys.has(songKey)} onExcludeToggle={() => toggleExcludeSongKey(songKey)} />;
        })}
      </div>
    );
    
    if (isLoadingSongs && !best30SongsData.length && !new20SongsData.length) {
        return (
          <div className="flex min-h-screen flex-col items-center justify-center text-xl">
            <Loader2 className="w-10 h-10 animate-spin mr-2" />
            <p>{t("resultPageLoadingSongsTitle")}</p>
          </div>
        );
    }
    
    return (
        <main className="container mx-auto p-4 md:p-6 lg:p-8">
             <Card className="mb-6 bg-opacity-50 backdrop-blur-sm">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <Link href="/" passHref>
                            <Button variant="outline" size="sm">
                                <ArrowLeft className="w-4 h-4 mr-2" />
                                {t("resultPageButtonBackToCalc")}
                            </Button>
                        </Link>
                        <CardTitle className="text-3xl font-bold text-center flex-grow">
                            ChuniCalc Result
                        </CardTitle>
                        <Button onClick={handleRefresh} disabled={isLoadingSongs} size="sm">
                            <RefreshCw className={`w-4 h-4 mr-2 ${isLoadingSongs ? "animate-spin" : ""}`} />
                            {t("resultPageRefreshButton")}
                        </Button>
                    </div>
                    <CardDescription className="text-center mt-2">
                        {apiPlayerName} - {lastRefreshed}
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                    <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                        <p className="text-sm text-muted-foreground">{t("resultPageHeaderCurrent")}</p>
                        <p className="text-2xl font-bold">
                            {currentRating.toFixed(4)}
                        </p>
                    </div>
                    <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                        <p className="text-sm text-muted-foreground">Simulated Rating</p>
                        <p className="text-2xl font-bold">
                            {(finalOverallSimulatedRating || 0).toFixed(4)}
                        </p>
                    </div>
                    <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                        <Label htmlFor="targetRating" className="text-sm text-muted-foreground">
                            {t("resultPageHeaderTarget")}
                        </Label>
                        <Input
                            id="targetRating"
                            type="number"
                            value={targetRating}
                            onChange={(e) => setTargetRating(parseFloat(e.target.value))}
                            onBlur={() => runSimulation(activeStrategy)}
                            className="text-2xl font-bold text-center h-10 mt-1"
                            step="0.01"
                            style={{ backgroundColor: "transparent", border: "none" }}
                        />
                    </div>
                </CardContent>
            </Card>

            {errorLoadingSongs && (
                <Card className="mb-6 border-destructive">
                    <CardHeader>
                        <CardTitle className="text-destructive">{t('resultPageErrorLoadingTitle')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p>{t('resultPageErrorLoadingDesc')}</p>
                        <p className="mt-2 text-sm text-muted-foreground">{errorLoadingSongs}</p>
                    </CardContent>
                </Card>
            )}

            <Tabs value={activeStrategy} onValueChange={handleStrategyChange} className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="b30_focus">{t("resultPageStrategyB30Focus")}</TabsTrigger>
                    <TabsTrigger value="n20_focus">{t("resultPageStrategyN20Focus")}</TabsTrigger>
                    <TabsTrigger value="hybrid_floor">{t("resultPageStrategyCombinedFloor")}</TabsTrigger>
                    <TabsTrigger value="playlist_custom">{t("resultPageTabCustom")}</TabsTrigger>
                </TabsList>
                <TabsContent value="b30_focus">
                    <Card><CardHeader><CardTitle>{t('resultPageCardTitleBest30')}</CardTitle></CardHeader><CardContent>{renderSongList(best30SongsData)}</CardContent></Card>
                </TabsContent>
                <TabsContent value="n20_focus">
                    <Card><CardHeader><CardTitle>{t('resultPageCardTitleNew20')}</CardTitle></CardHeader><CardContent>{renderSongList(new20SongsData)}</CardContent></Card>
                </TabsContent>
                <TabsContent value="hybrid_floor">
                    <Card><CardHeader><CardTitle>{t('resultPageCardTitleCombined')}</CardTitle></CardHeader><CardContent>{renderSongList(combinedTopSongs)}</CardContent></Card>
                </TabsContent>
                <TabsContent value="playlist_custom">
                    <Card>
                        <CardHeader>
                            <div className="flex justify-between items-center">
                                <CardTitle>{t('playlistButtonText', playlistSongs.length)}</CardTitle>
                                <Button onClick={() => setIsPlaylistModeOpen(true)}>
                                    <PlusCircle className="mr-2 h-4 w-4" /> Edit Playlist
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                           {playlistSongs.length > 0 ? renderSongList(playlistSongs) : <p className="text-center text-muted-foreground">{t('playlistEmpty')}</p>}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
            
            {simulationLog.length > 0 && (
                <Card className="mt-6">
                    <CardHeader><CardTitle>Simulation Log</CardTitle></CardHeader>
                    <CardContent className="max-h-40 overflow-y-auto">
                        {simulationLog.map((log, i) => <p key={i} className="text-sm">{log}</p>)}
                    </CardContent>
                </Card>
            )}

            {isPlaylistModeOpen && (
                 <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <Card className="w-full max-w-4xl h-[90vh] flex flex-col">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Simulation Playlist</CardTitle>
                            <Button variant="ghost" size="icon" onClick={() => setIsPlaylistModeOpen(false)}><X/></Button>
                        </CardHeader>
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
                                onCalculate={() => { handleStrategyChange('playlist_custom'); setIsPlaylistModeOpen(false); }}
                            />
                        </CardContent>
                    </Card>
                 </div>
            )}
        </main>
    );
} 
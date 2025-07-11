"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { useChuniResultData } from "@/hooks/useChuniResultData";
import { useLanguage } from "@/contexts/LanguageContext";
import SongCard from "@/components/SongCard";
import { cn } from "@/lib/utils";
import type { CalculationStrategy } from "@/types/result-page";

function ApiTestContent() {
    const { locale } = useLanguage();
    const [userNameForApi, setUserNameForApi] = useState<string>("cocoa");
    const [currentRatingDisplay, setCurrentRatingDisplay] = useState<string>("16.50");
    const [targetRatingDisplay, setTargetRatingDisplay] = useState<string>("16.75");
    const [calculationStrategy, setCalculationStrategy] = useState<CalculationStrategy>("hybrid_peak");
    const [clientHasMounted, setClientHasMounted] = useState(false);

    useEffect(() => {
        setClientHasMounted(true);
    }, []);

    const {
        apiPlayerName,
        best30SongsData,
        new20SongsData,
        combinedTopSongs,
        isLoadingSongs,
        errorLoadingSongs,
        currentPhase,
        simulatedAverageB30Rating,
        simulatedAverageNew20Rating,
        finalOverallSimulatedRating,
    } = useChuniResultData({
        userNameForApi,
        currentRatingDisplay,
        targetRatingDisplay,
        locale,
        refreshNonce: 0, // No refresh functionality on this page
        clientHasMounted,
        calculationStrategy,
    });

    const gridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

    return (
        <div className="container mx-auto p-4 sm:p-6 lg:p-8">
            <header className="mb-6">
                <Button asChild variant="outline">
                    <Link href="/" className="flex items-center">
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Main Page
                    </Link>
                </Button>
                <h1 className="text-4xl font-bold font-headline mt-2">`useChuniResultData` Hook Test Page</h1>
                <p className="text-muted-foreground">
                    This page directly uses the `useChuniResultData` hook, the same core logic as the main `/result` page, to test its output.
                </p>
            </header>

            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>Test Inputs</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                        <Label htmlFor="nickname">Chunirec Nickname</Label>
                        <Input id="nickname" value={userNameForApi} onChange={(e) => setUserNameForApi(e.target.value)} />
                    </div>
                    <div>
                        <Label htmlFor="currentRating">Current Rating</Label>
                        <Input id="currentRating" type="number" step="0.01" value={currentRatingDisplay} onChange={(e) => setCurrentRatingDisplay(e.target.value)} />
                    </div>
                    <div>
                        <Label htmlFor="targetRating">Target Rating</Label>
                        <Input id="targetRating" type="number" step="0.01" value={targetRatingDisplay} onChange={(e) => setTargetRatingDisplay(e.target.value)} />
                    </div>
                </CardContent>
            </Card>

            {isLoadingSongs && (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="ml-4 text-lg">Loading Hook Data...</p>
                </div>
            )}

            {errorLoadingSongs && (
                 <Card className="border-destructive/50">
                    <CardHeader className="flex flex-row items-center space-x-2">
                        <AlertTriangle className="w-6 h-6 text-destructive" />
                        <CardTitle className="font-headline text-xl text-destructive">Hook Error</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="font-mono">{errorLoadingSongs}</p>
                    </CardContent>
                </Card>
            )}

            {!isLoadingSongs && !errorLoadingSongs && (
                 <>
                    <Card className="mb-6">
                        <CardHeader>
                            <CardTitle>Hook State & Simulation Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="font-mono text-sm space-y-1">
                            <p><strong>Player Name:</strong> {apiPlayerName}</p>
                            <p><strong>Current Phase:</strong> {currentPhase}</p>
                            <p><strong>Simulated B30 Avg:</strong> {simulatedAverageB30Rating?.toFixed(4) || 'N/A'}</p>
                            <p><strong>Simulated N20 Avg:</strong> {simulatedAverageNew20Rating?.toFixed(4) || 'N/A'}</p>
                            <p><strong>Final Overall Rating:</strong> {finalOverallSimulatedRating?.toFixed(4) || 'N/A'}</p>
                        </CardContent>
                    </Card>

                    <Tabs defaultValue="best30" className="w-full">
                        <TabsList>
                            <TabsTrigger value="best30">Best 30 ({best30SongsData.length})</TabsTrigger>
                            <TabsTrigger value="new20">New 20 ({new20SongsData.length})</TabsTrigger>
                            <TabsTrigger value="combined">Combined ({combinedTopSongs.length})</TabsTrigger>
                        </TabsList>
                        <TabsContent value="best30">
                            <div className={cn("grid grid-cols-1 gap-4 mt-4", gridCols)}>
                                {best30SongsData.map((song, index) => <SongCard key={`b30-${song.id}-${song.diff}-${index}`} song={song} isExcluded={false} onExcludeToggle={()=>{}} calculationStrategy={calculationStrategy}/>)}
                            </div>
                        </TabsContent>
                         <TabsContent value="new20">
                            <div className={cn("grid grid-cols-1 gap-4 mt-4", gridCols)}>
                                {new20SongsData.map((song, index) => <SongCard key={`n20-${song.id}-${song.diff}-${index}`} song={song} isExcluded={false} onExcludeToggle={()=>{}} calculationStrategy={calculationStrategy}/>)}
                            </div>
                        </TabsContent>
                        <TabsContent value="combined">
                            <div className={cn("grid grid-cols-1 gap-4 mt-4", gridCols)}>
                                {combinedTopSongs.map((song, index) => <SongCard key={`comb-${song.id}-${song.diff}-${index}`} song={song} isExcluded={false} onExcludeToggle={()=>{}} calculationStrategy={calculationStrategy}/>)}
                            </div>
                        </TabsContent>
                    </Tabs>
                </>
            )}
        </div>
    );
}

// Dummy Tabs components for structure, assuming they exist in the project UI library
const Tabs = ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>;
const TabsList = ({ children, ...props }: React.ComponentProps<'div'>) => <div className="flex border-b" {...props}>{children}</div>;
const TabsTrigger = ({ children, ...props }: React.ComponentProps<'button'>) => <button className="px-4 py-2 -mb-px border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:font-semibold" {...props}>{children}</button>;
const TabsContent = ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>;


export default function ApiTestPage() {
    return <ApiTestContent />;
}

    
    
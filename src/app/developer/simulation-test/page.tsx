
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Play, Brain } from "lucide-react";
import { getLocalReferenceApiToken } from "@/lib/get-api-token";
import { getCachedData, LOCAL_STORAGE_PREFIX, SIMULATION_CACHE_EXPIRY_MS as GLOBAL_MUSIC_CACHE_EXPIRY_MS } from "@/lib/cache";
import { mapApiSongToAppSong, sortSongsByRatingDesc } from "@/lib/rating-utils";
import { runFullSimulation } from "@/lib/simulation-logic";
import type {
  Song,
  CalculationStrategy,
  SimulationInput,
  SimulationOutput,
  ProfileData,
  RatingApiResponse,
  ShowallApiSongEntry,
  RatingApiSongEntry,
  UserShowallApiResponse,
  ConstOverride,
} from "@/types/result-page";
import NewSongsData from '@/data/NewSongs.json';
import constOverridesData from '@/data/const-overrides.json';
import SongCard from "@/components/SongCard"; 
import { cn } from "@/lib/utils"; 

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;
const GLOBAL_MUSIC_DATA_KEY = `${LOCAL_STORAGE_PREFIX}globalMusicData`;


const flattenGlobalMusicEntry = (rawEntry: any): ShowallApiSongEntry[] => {
    const flattenedEntries: ShowallApiSongEntry[] = [];
    if (rawEntry && rawEntry.meta && rawEntry.data && typeof rawEntry.data === 'object') {
        const meta = rawEntry.meta;
        const difficulties = rawEntry.data;
        for (const diffKey in difficulties) {
            if (Object.prototype.hasOwnProperty.call(difficulties, diffKey)) {
                const diffData = difficulties[diffKey];
                if (diffData && meta.id && meta.title) {
                    flattenedEntries.push({
                        id: String(meta.id),
                        title: String(meta.title),
                        genre: String(meta.genre || "N/A"),
                        release: String(meta.release || ""),
                        diff: diffKey.toUpperCase(),
                        level: String(diffData.level || "N/A"),
                        const: (typeof diffData.const === 'number' || diffData.const === null) ? diffData.const : parseFloat(String(diffData.const)),
                        is_const_unknown: diffData.is_const_unknown === true,
                    });
                }
            }
        }
    } else if (rawEntry && rawEntry.id && rawEntry.title && rawEntry.diff) {
        flattenedEntries.push(rawEntry as ShowallApiSongEntry);
    }
    return flattenedEntries;
};


export default function SimulationTestPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [simulationResult, setSimulationResult] = useState<SimulationOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [nickname, setNickname] = useState("cocoa");
  const [currentRatingStr, setCurrentRatingStr] = useState("17.28");
  const [targetRatingStr, setTargetRatingStr] = useState("17.29");
  const [uiStrategy, setUiStrategy] = useState<CalculationStrategy>("hybrid_floor");

  const [logDisplay, setLogDisplay] = useState<string>("");
  const [clientHasMounted, setClientHasMounted] = useState(false);

  useEffect(() => {
    setClientHasMounted(true);
  }, []);


  const handleRunSimulation = async () => {
    setIsLoading(true);
    setSimulationResult(null);
    setError(null);
    setLogDisplay("Starting simulation...\n");

    const currentRatingNum = parseFloat(currentRatingStr);
    const targetRatingNum = parseFloat(targetRatingStr);

    if (isNaN(currentRatingNum) || isNaN(targetRatingNum) || !nickname.trim() || !uiStrategy) {
      setError("Please fill in all fields correctly.");
      setIsLoading(false);
      setLogDisplay(prev => prev + "Error: Please fill in all fields correctly.\n");
      return;
    }
    
    const localRefToken = getLocalReferenceApiToken();
    if (!localRefToken) {
        appendLog("Warning: Local reference API token not found in Advanced Settings. API calls will rely solely on server-side key.");
    }
    
    appendLog("Fetching initial data via proxy...");

    try {
      const profileProxyEndpoint = `records/profile.json`;
      const profileDataResponse = await fetchApi<ProfileData>(profileProxyEndpoint, { region: 'jp2', user_name: nickname });

      const ratingProxyEndpoint = `records/rating_data.json`;
      const ratingDataResponse = await fetchApi<RatingApiResponse>(ratingProxyEndpoint, { region: 'jp2', user_name: nickname });
      
      let globalMusicRawResponse = getCachedData<any[]>(GLOBAL_MUSIC_DATA_KEY, GLOBAL_MUSIC_CACHE_EXPIRY_MS);
      if (!globalMusicRawResponse) {
        const globalMusicProxyEndpoint = `music/showall.json`;
        const apiGlobalMusic = await fetchApi<any[] | {records: any[]}>(globalMusicProxyEndpoint, { region: 'jp2' });
        globalMusicRawResponse = Array.isArray(apiGlobalMusic) ? apiGlobalMusic : apiGlobalMusic?.records || [];
      }
      
      const userShowallProxyEndpoint = `records/showall.json`;
      const userShowallDataResponse = await fetchApi<UserShowallApiResponse>(userShowallProxyEndpoint, { region: 'jp2', user_name: nickname }, "records");

      appendLog(`Profile: ${profileDataResponse?.player_name}, Rating Data entries: ${ratingDataResponse?.best?.entries?.length || 0}`);
      appendLog(`Global Music Raw entries: ${globalMusicRawResponse?.length || 0}`);
      appendLog(`User Showall entries: ${userShowallDataResponse?.length || 0}`);

      const initialB30ApiEntries = ratingDataResponse?.best?.entries?.filter((e: any): e is RatingApiSongEntry => e && e.id && e.diff && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && e.title) || [];
      const originalB30Songs = sortSongsByRatingDesc(initialB30ApiEntries.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
      appendLog(`Processed Original B30 Songs: ${originalB30Songs.length}`);

      const allMusicDataFlattened = globalMusicRawResponse.reduce((acc, entry) => acc.concat(flattenGlobalMusicEntry(entry)), [] as ShowallApiSongEntry[]);
      appendLog(`Flattened Global Music Data: ${allMusicDataFlattened.length}`);

      const userPlayHistoryRecords = userShowallDataResponse || [];
      
      const newSongTitlesRaw = NewSongsData.titles?.xverse || [];
      const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());

      const newSongDefinitions = allMusicDataFlattened.filter(globalSong =>
        globalSong.title && newSongTitlesToMatch.includes(globalSong.title.trim().toLowerCase())
      );

      const userPlayedMap = new Map<string, ShowallApiSongEntry>();
      userPlayHistoryRecords.forEach(usrSong => {
        if (usrSong.id && usrSong.diff) userPlayedMap.set(`${usrSong.id}_${usrSong.diff.toUpperCase()}`, usrSong);
      });

      const playedNewSongsApi = newSongDefinitions.reduce((acc, newSongDef) => {
        const userPlayRecord = userPlayedMap.get(`${newSongDef.id}_${newSongDef.diff.toUpperCase()}`);
        if (userPlayRecord && typeof userPlayRecord.score === 'number' && userPlayRecord.score >= 800000) {
          acc.push({ ...newSongDef, score: userPlayRecord.score, is_played: true });
        }
        return acc;
      }, [] as ShowallApiSongEntry[]);

      const allPlayedNewSongsPool = sortSongsByRatingDesc(playedNewSongsApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const)));
      const originalNew20Songs = allPlayedNewSongsPool.slice(0, NEW_20_COUNT);
      appendLog(`Processed Original New20 Songs: ${originalNew20Songs.length} (from pool of ${allPlayedNewSongsPool.length})`);

      const isScoreLimitReleased = (targetRatingNum - currentRatingNum) * 50 > 10; 
      const phaseTransitionPoint = currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95; 

      let simulationMode: SimulationInput['simulationMode'] = 'hybrid';
      let algorithmPreference: SimulationInput['algorithmPreference'] = 'floor';

      if (uiStrategy === 'b30_focus') {
        simulationMode = 'b30_only';
        algorithmPreference = 'floor';
      } else if (uiStrategy === 'n20_focus') {
        simulationMode = 'n20_only';
        algorithmPreference = 'floor';
      } else if (uiStrategy === 'hybrid_floor') {
        simulationMode = 'hybrid';
        algorithmPreference = 'floor';
      } else if (uiStrategy === 'hybrid_peak') {
        simulationMode = 'hybrid';
        algorithmPreference = 'peak';
      }
      
      const simulationInput: SimulationInput = {
        originalB30Songs,
        originalNew20Songs,
        allPlayedNewSongsPool,
        allMusicData: allMusicDataFlattened,
        userPlayHistory: userPlayHistoryRecords,
        currentRating: currentRatingNum,
        targetRating: targetRatingNum,
        simulationMode,
        algorithmPreference,
        isScoreLimitReleased,
        phaseTransitionPoint: parseFloat(phaseTransitionPoint.toFixed(4)),
        excludedSongKeys: new Set<string>(),
        newSongsDataTitlesVerse: NewSongsData.titles.xverse,
        constOverrides: constOverridesData as ConstOverride[],
      };

      appendLog("Running simulation function...");
      const result = runFullSimulation(simulationInput);
      setSimulationResult(result);
      appendLog("Simulation complete. Result received.");
      
      if (result.simulationLog && result.simulationLog.length > 0) {
        appendLog("\n--- Simulation Internal Log ---");
        result.simulationLog.forEach(logEntry => appendLog(logEntry));
      } else {
        appendLog("\n--- Simulation Internal Log Empty ---");
      }
      if(result.error) {
        setError(`Simulation ended with error: ${result.error}`);
        appendLog(`Simulation ended with error: ${result.error}`);
      }


    } catch (e: any) {
      setError(`Simulation setup failed: ${e.message || String(e)}`);
      appendLog(`Error during setup or API fetch: ${e.message || String(e)}`);
      console.error("Simulation Test Page Error:", e);
    } finally {
      setIsLoading(false);
    }
  };
  
  const appendLog = (message: string) => {
    setLogDisplay(prev => prev + message + "\n");
  };

  async function fetchApi<T>(proxyEndpointPath: string, params: Record<string, string> = {}, recordsField?: keyof UserShowallApiResponse): Promise<T | null> {
    const url = new URL(`/api/chunirecApiProxy`, window.location.origin);
    url.searchParams.append('proxyEndpoint', proxyEndpointPath);
    for (const key in params) {
        url.searchParams.append(key, params[key]);
    }
    
    appendLog(`Fetching: ${url.toString()}`);
    const response = await fetch(url.toString());
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: "Response not JSON" }}));
      throw new Error(`API fetch failed for ${proxyEndpointPath} (status: ${response.status}): ${errorData.error?.message || response.statusText}`);
    }
    const data = await response.json();
    return recordsField && data && typeof data === 'object' && recordsField in data ? data[recordsField] : data;
  }

  if (!clientHasMounted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">페이지 로딩 중...</p>
      </div>
    );
  }


  const songListGridCols = "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold font-headline flex items-center">
            <Brain className="mr-3 h-8 w-8 text-primary" />
            Simulation Logic Test
          </h1>
          <Button asChild variant="outline">
            <Link href="/developer/api-test"><ArrowLeft className="mr-2 h-4 w-4" />Back to API Test</Link>
          </Button>
        </header>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Simulation Parameters</CardTitle>
            <CardDescription>Set the inputs for the simulation logic.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="nickname">Nickname</Label>
                <Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g., cocoa" />
              </div>
              <div>
                <Label htmlFor="currentRating">Current Rating</Label>
                <Input id="currentRating" type="number" value={currentRatingStr} onChange={(e) => setCurrentRatingStr(e.target.value)} placeholder="e.g., 17.00" />
              </div>
            </div>
            <div>
              <Label htmlFor="targetRating">Target Rating</Label>
              <Input id="targetRating" type="number" value={targetRatingStr} onChange={(e) => setTargetRatingStr(e.target.value)} placeholder="e.g., 17.10" />
            </div>
            <div>
              <Label>Calculation Strategy (UI Choice)</Label>
              <RadioGroup value={uiStrategy} onValueChange={(v) => setUiStrategy(v as CalculationStrategy)} className="flex flex-wrap gap-x-4 gap-y-2 mt-1">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="b30_focus" id="strat-b30-focus" />
                  <Label htmlFor="strat-b30-focus">B30 Focus</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="n20_focus" id="strat-n20-focus" />
                  <Label htmlFor="strat-n20-focus">N20 Focus</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="hybrid_floor" id="strat-hybrid-floor" />
                  <Label htmlFor="strat-hybrid-floor">Hybrid (Floor)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="hybrid_peak" id="strat-hybrid-peak" />
                  <Label htmlFor="strat-hybrid-peak">Hybrid (Peak)</Label>
                </div>
              </RadioGroup>
            </div>
            <Button onClick={handleRunSimulation} disabled={isLoading} className="w-full">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run Simulation
            </Button>
          </CardContent>
        </Card>

        {error && (
          <Card className="mb-6 border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive">Error / Info</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm text-destructive whitespace-pre-wrap">{error}</pre>
            </CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Simulation Output & Log</CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="logOutput">Execution Log:</Label>
            <Textarea
              id="logOutput"
              readOnly
              value={logDisplay}
              className="h-64 font-mono text-xs mt-1 mb-4"
              placeholder="Simulation logs will appear here..."
            />
            {simulationResult && (
              <>
                <Label htmlFor="simulationJsonResult">Full Result Object (JSON):</Label>
                <Textarea
                  id="simulationJsonResult"
                  readOnly
                  value={JSON.stringify(simulationResult, null, 2)}
                  className="h-96 font-mono text-xs mt-1"
                />
              </>
            )}
          </CardContent>
        </Card>

        {simulationResult && simulationResult.simulatedB30Songs && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Simulated Best 30 Songs</CardTitle>
              <CardDescription>
                Final B30 Avg: {simulationResult.finalAverageB30Rating?.toFixed(4) || "N/A"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {simulationResult.simulatedB30Songs.length > 0 ? (
                <div className={cn("grid grid-cols-1 gap-4", songListGridCols)}>
                  {simulationResult.simulatedB30Songs.map((song, index) => (
                    <SongCard key={`sim-b30-${song.id}-${song.diff}-${index}`} song={song} calculationStrategy={uiStrategy} />
                  ))}
                </div>
              ) : (
                <p>No Best 30 songs in simulation result.</p>
              )}
            </CardContent>
          </Card>
        )}

        {simulationResult && simulationResult.simulatedNew20Songs && (
          <Card>
            <CardHeader>
              <CardTitle>Simulated New 20 Songs</CardTitle>
               <CardDescription>
                Final N20 Avg: {simulationResult.finalAverageNew20Rating?.toFixed(4) || "N/A"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {simulationResult.simulatedNew20Songs.length > 0 ? (
                <div className={cn("grid grid-cols-1 gap-4", songListGridCols)}>
                  {simulationResult.simulatedNew20Songs.map((song, index) => (
                    <SongCard key={`sim-n20-${song.id}-${song.diff}-${index}`} song={song} calculationStrategy={uiStrategy} />
                  ))}
                </div>
              ) : (
                <p>No New 20 songs in simulation result.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

    

// src/hooks/useChuniResultData.ts
"use client";

import { useState, useEffect, useCallback, useReducer, useRef, useMemo } from 'react'; // Ensure useMemo is imported
import { useToast } from "@/hooks/use-toast";
import NewSongsData from '@/data/NewSongs.json';
import constOverridesInternal from '@/data/const-overrides.json';
import { getTranslation, type Locale } from '@/lib/translations';
import { mapApiSongToAppSong, sortSongsByRatingDesc, calculateAverageAndOverallRating, calculateTheoreticalMaxRatingsForList, deduplicateAndPrioritizeSongs } from '@/lib/rating-utils';
import type {
  Song,
  ProfileData,
  RatingApiResponse,
  ShowallApiSongEntry,
  RatingApiSongEntry,
  CalculationStrategy,
  SimulationPhase,
  UserShowallApiResponse,
  SimulationInput,
  SimulationOutput,
  ConstOverride,
  ApiData,
  InitialData,
} from "@/types/result-page";
import { useProfileData, useUserRatingData, useUserShowallData, useGlobalMusicData } from './useApiData'; // SWR hooks

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;
const MAX_SCORE_ASSUMED_FOR_POTENTIAL = 1009000;

// --- State, Action, Reducer for useReducer ---
interface ChuniResultDataState {
  apiData: ApiData | null;
  simulationResult: SimulationOutput | null;
  simulationStatus: 'idle' | 'simulating' | 'error' | 'success';
  playlistSongs: Song[];
  // ... other internal states like excludedSongKeys
}

type ResultDataAction =
  | { type: 'SET_INITIAL_DATA_SUCCESS'; payload: { 
      profileName: string | null;
      originalB30: Song[]; 
      originalN20: Song[]; 
      allPlayedPool: Song[]; 
      allMusic: ShowallApiSongEntry[]; 
      userHistory: ShowallApiSongEntry[];
      timestamp: number;
    } }
  | { type: 'START_SIMULATION' }
  | { type: 'SIMULATION_SUCCESS'; payload: SimulationOutput }
  | { type: 'SIMULATION_ERROR'; payload: string }
  | { type: 'TOGGLE_EXCLUDE_SONG'; payload: string }
  | { type: 'ADD_TO_PLAYLIST'; payload: Song }
  | { type: 'REMOVE_FROM_PLAYLIST'; payload: { id: string; diff: string } }
  | { type: 'UPDATE_PLAYLIST_SONG_TARGET'; payload: { id: string; diff: string; targetScore: number; targetRating: number } }
  | { type: 'CLEAR_PLAYLIST' }
  | { type: 'RESET_SIMULATION_STATE_FOR_NEW_STRATEGY' }
  | { type: 'SET_PRECOMPUTATION_RESULT'; payload: ResultDataState['preComputationResult'] }
  | { type: 'SET_CURRENT_PHASE'; payload: SimulationPhase }
  | { type: 'SET_TARGET_RATING'; payload: number }
  | { type: 'SET_STRATEGY'; payload: CalculationStrategy };


const initialState: ChuniResultDataState = {
  apiData: null,
  simulationResult: null,
  simulationStatus: 'idle',
  playlistSongs: [],
  // ... other internal states like excludedSongKeys
};

function resultDataReducer(state: ChuniResultDataState, action: ResultDataAction): ChuniResultDataState {
  switch (action.type) {
    case 'SET_INITIAL_DATA_SUCCESS':
      return {
        ...state,
        apiData: {
          profileName: action.payload.profileName,
          originalB30: action.payload.originalB30,
          originalN20: action.payload.originalN20,
          allPlayedPool: action.payload.allPlayedPool,
          allMusic: action.payload.allMusic,
          userHistory: action.payload.userHistory,
          timestamp: action.payload.timestamp,
        },
      };
    case 'START_SIMULATION':
      return { ...state, simulationStatus: 'simulating' };
    case 'SIMULATION_SUCCESS':
      return {
        ...state,
        simulationResult: action.payload,
        simulationStatus: 'success',
      };
    case 'SIMULATION_ERROR':
      return { ...state, simulationStatus: 'error', simulationResult: null };
    case 'TOGGLE_EXCLUDE_SONG':
      const newExcludedKeys = new Set(state.excludedSongKeys);
      if (newExcludedKeys.has(action.payload)) newExcludedKeys.delete(action.payload);
      else newExcludedKeys.add(action.payload);
      return { ...state, excludedSongKeys: newExcludedKeys };
    case 'ADD_TO_PLAYLIST':
        // Avoid duplicates
        if (state.playlistSongs.some(song => song.id === action.payload.id && song.diff === action.payload.diff)) {
            return state;
        }
        return { ...state, playlistSongs: [...state.playlistSongs, action.payload] };
    case 'REMOVE_FROM_PLAYLIST':
        return { ...state, playlistSongs: state.playlistSongs.filter(song => !(song.id === action.payload.id && song.diff === action.payload.diff)) };
    case 'UPDATE_PLAYLIST_SONG_TARGET':
        return {
            ...state,
            playlistSongs: state.playlistSongs.map(song => 
                (song.id === action.payload.id && song.diff === action.payload.diff)
                ? { ...song, targetScore: action.payload.targetScore, targetRating: action.payload.targetRating }
                : song
            )
        };
    case 'CLEAR_PLAYLIST':
        return { ...state, playlistSongs: [] };
    case 'RESET_SIMULATION_STATE_FOR_NEW_STRATEGY':
      return {
        ...state,
        // Reset simulation-specific state when new initial data comes
        // This part needs to be handled by the parent component or re-fetched
        // For now, we'll just clear simulation results and status
        simulationResult: null,
        simulationStatus: 'idle',
      };
    case 'SET_PRECOMPUTATION_RESULT':
        return { ...state, preComputationResult: action.payload, isLoadingSimulation: false };
    case 'SET_CURRENT_PHASE':
        return { ...state, currentPhase: action.payload, isLoadingSimulation: false };
    case 'SET_TARGET_RATING':
        return { ...state, targetRating: action.payload };
    case 'SET_STRATEGY':
        return { ...state, strategy: action.payload };
    default:
      return state;
  }
}

const flattenGlobalMusicEntry = (rawEntry: any): ShowallApiSongEntry[] => {
    const flattenedEntries: ShowallApiSongEntry[] = [];
    if (rawEntry && rawEntry.meta && rawEntry.data && typeof rawEntry.data === 'object') {
        const meta = rawEntry.meta; const difficulties = rawEntry.data;
        for (const diffKey in difficulties) {
            if (Object.prototype.hasOwnProperty.call(difficulties, diffKey)) {
                const diffData = difficulties[diffKey];
                if (diffData && meta.id && meta.title) {
                    flattenedEntries.push({ id: String(meta.id), title: String(meta.title), genre: String(meta.genre || "N/A"), release: String(meta.release || ""), diff: diffKey.toUpperCase(), level: String(diffData.level || "N/A"), const: (typeof diffData.const === 'number' || diffData.const === null) ? diffData.const : parseFloat(String(diffData.const)), is_const_unknown: diffData.is_const_unknown === true, score: undefined, rating: undefined, is_played: undefined, });
                }
            }
        }
    } else if (rawEntry && rawEntry.id && rawEntry.title && rawEntry.diff) flattenedEntries.push(rawEntry as ShowallApiSongEntry);
    return flattenedEntries;
};


interface UseChuniResultDataProps {
  userNameForApi: string | null;
  currentRatingDisplay: string | null;
  targetRatingDisplay: string | null;
  locale: Locale;
  refreshNonce: number; // Keep for manual cache busting if SWR needs it.
  clientHasMounted: boolean;
  calculationStrategy: CalculationStrategy;
}

export function useChuniResultData(initialData: InitialData) {
  const { toast } = useToast();
  const [state, dispatch] = useReducer(resultDataReducer, initialState);
  const simulationWorkerRef = useRef<Worker | null>(null);

  const defaultPlayerName = getTranslation(initialData.locale, 'resultPageDefaultPlayerName');

  // SWR Data Hooks
  const { data: profileData, error: profileError, isLoading: isLoadingProfile, mutate: mutateProfile } = useProfileData(initialData.userNameForApi && initialData.userNameForApi !== defaultPlayerName ? initialData.userNameForApi : null);
  const { data: ratingData, error: ratingError, isLoading: isLoadingRating, mutate: mutateRating } = useUserRatingData(initialData.userNameForApi && initialData.userNameForApi !== defaultPlayerName ? initialData.userNameForApi : null);
  const { data: userShowallData, error: userShowallError, isLoading: isLoadingUserShowall, mutate: mutateUserShowall } = useUserShowallData(initialData.userNameForApi && initialData.userNameForApi !== defaultPlayerName ? initialData.userNameForApi : null);
  const { data: globalMusicRaw, error: globalMusicError, isLoading: isLoadingGlobalMusic, mutate: mutateGlobalMusic } = useGlobalMusicData();

  const isLoadingInitialApiData = isLoadingProfile || isLoadingRating || isLoadingUserShowall || isLoadingGlobalMusic;
  const initialApiError = profileError || ratingError || userShowallError || globalMusicError;

  // Initialize Web Worker
  useEffect(() => {
    simulationWorkerRef.current = new Worker(new URL('@/workers/simulation.worker.ts', import.meta.url));
    simulationWorkerRef.current.onmessage = (event: MessageEvent<SimulationOutput>) => {
      dispatch({ type: 'SIMULATION_SUCCESS', payload: event.data });
    };
    simulationWorkerRef.current.onerror = (error) => {
      console.error("Simulation Worker Error:", error);
      dispatch({ type: 'SIMULATION_ERROR', payload: error.message || 'Unknown worker error' });
    };
    return () => simulationWorkerRef.current?.terminate();
  }, []);

  // Process SWR data and dispatch to reducer
  useEffect(() => {
    if (!initialData.clientHasMounted || isLoadingInitialApiData || initialApiError || !initialData.userNameForApi || initialData.userNameForApi === defaultPlayerName) {
        if (initialApiError) {
            // Handle specific error messages here if needed, or just let SWR display them
            console.error("Error fetching initial data via SWR:", initialApiError);
        }
        return;
    }

    if (profileData && ratingData && globalMusicRaw && userShowallData) {
      const processedApiPlayerName = profileData.player_name || initialData.userNameForApi;
      
      let tempFlattenedGlobalMusicRecords: ShowallApiSongEntry[] = [];
      const globalMusicRecords = Array.isArray(globalMusicRaw) ? globalMusicRaw : (globalMusicRaw?.records || []);
      globalMusicRecords.forEach(rawEntry => {
          tempFlattenedGlobalMusicRecords.push(...flattenGlobalMusicEntry(rawEntry));
      });

      // Apply const overrides
      const overridesToApply = constOverridesInternal as ConstOverride[];
      if (overridesToApply.length > 0 && tempFlattenedGlobalMusicRecords.length > 0) {
        overridesToApply.forEach(override => {
          tempFlattenedGlobalMusicRecords.forEach(globalSong => {
            if (globalSong.title.trim().toLowerCase() === override.title.trim().toLowerCase() &&
                globalSong.diff.toUpperCase() === override.diff.toUpperCase()) {
              if (typeof override.const === 'number') globalSong.const = override.const;
            }
          });
        });
      }

      const processedUserPlayHistory = (userShowallData.records || []).filter((e: any): e is ShowallApiSongEntry => e && typeof e.id === 'string' && typeof e.diff === 'string');

      const initialB30ApiEntries = ratingData?.best?.entries?.filter((e: any): e is RatingApiSongEntry => e && e.id && e.diff && typeof e.score === 'number' && (typeof e.rating === 'number' || typeof e.const === 'number') && e.title) || [];
      const mappedOriginalB30 = initialB30ApiEntries.map((entry, index) => {
        const masterSongData = tempFlattenedGlobalMusicRecords.find(ms => ms.id === entry.id && ms.diff.toUpperCase() === entry.diff.toUpperCase());
        return mapApiSongToAppSong(entry, index, masterSongData?.const ?? entry.const);
      });
      const processedOriginalB30 = sortSongsByRatingDesc(deduplicateAndPrioritizeSongs(mappedOriginalB30));

      const newSongTitlesRaw = NewSongsData.titles?.verse || [];
      const newSongTitlesToMatch = newSongTitlesRaw.map(title => title.trim().toLowerCase());
      const newSongDefinitions = tempFlattenedGlobalMusicRecords.filter(globalSong => globalSong.title && newSongTitlesToMatch.includes(globalSong.title.trim().toLowerCase()));
      const userPlayedMap = new Map<string, ShowallApiSongEntry>();
      processedUserPlayHistory.forEach(usrSong => { if (usrSong.id && usrSong.diff) userPlayedMap.set(`${usrSong.id}_${usrSong.diff.toUpperCase()}`, usrSong); });
      const playedNewSongsApi = newSongDefinitions.reduce((acc, newSongDef) => {
        const userPlayRecord = userPlayedMap.get(`${newSongDef.id}_${newSongDef.diff.toUpperCase()}`);
        if (userPlayRecord && typeof userPlayRecord.score === 'number' && userPlayRecord.score >= 800000) {
          const globalDefinitionForConst = tempFlattenedGlobalMusicRecords.find(gs => gs.id === newSongDef.id && gs.diff === newSongDef.diff);
          acc.push({ ...newSongDef, score: userPlayRecord.score, is_played: true, rating: userPlayRecord.rating, const: globalDefinitionForConst?.const ?? newSongDef.const });
        }
        return acc;
      }, [] as ShowallApiSongEntry[]);
      const mappedPlayedNewSongs = playedNewSongsApi.map((entry, index) => mapApiSongToAppSong(entry, index, entry.const));
      const sortedAllPlayedNewSongsPool = sortSongsByRatingDesc(deduplicateAndPrioritizeSongs(mappedPlayedNewSongs));
      const processedOriginalNew20 = sortedAllPlayedNewSongsPool.slice(0, NEW_20_COUNT);

      dispatch({
        type: 'SET_INITIAL_DATA_SUCCESS',
        payload: {
          profileName: processedApiPlayerName,
          originalB30: processedOriginalB30,
          originalN20: processedOriginalNew20,
          allPlayedPool: sortedAllPlayedNewSongsPool,
          allMusic: tempFlattenedGlobalMusicRecords,
          userHistory: processedUserPlayHistory,
          timestamp: Date.now(), // SWR handles its own revalidation; this is for UI.
          currentRating: initialData.currentRating,
          targetRating: initialData.targetRating,
          strategy: initialData.calculationStrategy,
        }
      });
      toast({ title: getTranslation(initialData.locale, 'resultPageToastApiLoadSuccessTitle'), description: getTranslation(initialData.locale, 'resultPageToastCacheLoadSuccessDesc') }); // SWR acts as cache
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileData, ratingData, userShowallData, globalMusicRaw, isLoadingInitialApiData, initialApiError, initialData.clientHasMounted, initialData.userNameForApi, initialData.locale]);


  // Effect for manual refresh (cache busting for SWR)
  const handleFullRefresh = useCallback(() => {
    if (initialData.userNameForApi && initialData.userNameForApi !== defaultPlayerName) {
      mutateProfile(); // Revalidate profile
      mutateRating(); // Revalidate rating data
      mutateUserShowall(); // Revalidate user showall
    }
    mutateGlobalMusic(); // Revalidate global music
    toast({ title: getTranslation(initialData.locale, 'resultPageToastRefreshingDataTitle'), description: getTranslation(initialData.locale, 'resultPageToastRefreshingDataDesc') });
    dispatch({ type: 'RESET_SIMULATION_STATE_FOR_NEW_STRATEGY' }); // Reset simulation state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData.userNameForApi, defaultPlayerName, mutateProfile, mutateRating, mutateUserShowall, mutateGlobalMusic, initialData.locale, toast]);

  useEffect(() => {
    if (initialData.refreshNonce > 0) { // Triggered by user clicking refresh button
        handleFullRefresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData.refreshNonce]); // Removed handleFullRefresh from deps to avoid loop, nonce controls it

  // Simulation Logic Trigger
  useEffect(() => {
    if (isLoadingInitialApiData || !initialData.clientHasMounted || state.apiData?.originalB30SongsData.length === 0) return;

    const currentRatingNum = parseFloat(initialData.currentRatingDisplay || "0");
    const targetRatingNum = parseFloat(initialData.targetRatingDisplay || "0");

    if (isNaN(currentRatingNum) || isNaN(targetRatingNum)) {
      dispatch({ type: 'SIMULATION_ERROR', payload: getTranslation(initialData.locale, 'resultPageErrorInvalidRatingsInput')});
      return;
    }

    if (initialData.calculationStrategy === "none" || initialData.calculationStrategy === null) {
      dispatch({ type: 'RESET_SIMULATION_STATE_FOR_NEW_STRATEGY' });
      return;
    }
    
    dispatch({ type: 'RESET_SIMULATION_STATE_FOR_NEW_STRATEGY' });
    dispatch({ type: 'START_SIMULATION' });

    let simulationModeToUse: SimulationInput['simulationMode'];
    let algorithmPreferenceToUse: SimulationInput['algorithmPreference'];

    if (initialData.calculationStrategy === 'b30_focus') { simulationModeToUse = 'b30_only'; algorithmPreferenceToUse = 'floor'; }
    else if (initialData.calculationStrategy === 'n20_focus') { simulationModeToUse = 'n20_only'; algorithmPreferenceToUse = 'floor'; }
    else if (initialData.calculationStrategy === 'hybrid_floor') { simulationModeToUse = 'hybrid'; algorithmPreferenceToUse = 'floor'; }
    else if (initialData.calculationStrategy === 'hybrid_peak') { simulationModeToUse = 'hybrid'; algorithmPreferenceToUse = 'peak'; }
    else if (initialData.calculationStrategy === 'playlist_custom') { simulationModeToUse = 'playlist_custom'; algorithmPreferenceToUse = 'floor'; } // peak or floor doesn't matter here
    else {
        dispatch({ type: 'SIMULATION_ERROR', payload: 'Unknown calculation strategy' });
        return;
    }

    // Pre-computation check for b30/n20 focus modes
    if (simulationModeToUse === 'b30_only' || simulationModeToUse === 'n20_only') {
      let fixedListSongs: Song[] = [];
      let fixedListRatingSum = 0; let fixedListCount = 0;
      let variableListCandidatePool: (Song | ShowallApiSongEntry)[] = [];
      let variableListLimit = 0;
      let messageKey: keyof ReturnType<typeof getTranslation>['KR'] = 'resultPageErrorSimulationGeneric';

      const currentB30Avg = calculateAverageAndOverallRating(state.apiData?.originalB30SongsData || [], BEST_COUNT, 'currentRating').average;
      const currentN20Avg = calculateAverageAndOverallRating(state.apiData?.originalNew20SongsData || [], NEW_20_COUNT, 'currentRating').average;

      if (simulationModeToUse === 'b30_only') {
        messageKey = 'reachableRatingB30OnlyMessage';
        fixedListSongs = state.apiData?.originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })) || [];
        fixedListRatingSum = (currentN20Avg || 0) * Math.min(NEW_20_COUNT, state.apiData?.originalNew20SongsData.length || 0);
        fixedListCount = Math.min(NEW_20_COUNT, state.apiData?.originalNew20SongsData.length || 0);
        const b30PreCalcCandidates = state.apiData?.allMusicData.filter(ms => {
            const isNewSong = NewSongsData.titles.verse.some(title => title.trim().toLowerCase() === ms.title.trim().toLowerCase());
            const isInFixedN20 = state.apiData?.originalNew20SongsData.some(n20s => n20s.id === ms.id && n20s.diff.toUpperCase() === ms.diff.toUpperCase());
            return !isNewSong && !isInFixedN20;
        }) || [];
        variableListCandidatePool = [...state.apiData?.originalB30SongsData || [], ...b30PreCalcCandidates];
        variableListLimit = BEST_COUNT;
      } else { // n20_only
        messageKey = 'reachableRatingN20OnlyMessage';
        fixedListSongs = state.apiData?.originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })) || [];
        fixedListRatingSum = (currentB30Avg || 0) * Math.min(BEST_COUNT, state.apiData?.originalB30SongsData.length || 0);
        fixedListCount = Math.min(BEST_COUNT, state.apiData?.originalB30SongsData.length || 0);
        variableListCandidatePool = state.apiData?.allPlayedNewSongsPool.filter(pns => !state.apiData?.originalB30SongsData.some(b30s => b30s.id === pns.id && b30s.diff === pns.diff)) || [];
        variableListLimit = NEW_20_COUNT;
      }
      const { list: maxedVariableList, average: avgVariableAtMax, sum: sumVariableAtMax } = calculateTheoreticalMaxRatingsForList(variableListCandidatePool, variableListLimit, MAX_SCORE_ASSUMED_FOR_POTENTIAL, state.excludedSongKeys);
      const totalRatingSumAtMax = fixedListRatingSum + sumVariableAtMax;
      const totalEffectiveSongsAtMax = fixedListCount + maxedVariableList.length;
      const reachableRating = totalEffectiveSongsAtMax > 0 ? parseFloat((totalRatingSumAtMax / totalEffectiveSongsAtMax).toFixed(4)) : 0;

      if (targetRatingNum > reachableRating) {
        const precompResultPayload = { reachableRating, messageKey, theoreticalMaxSongsB30: simulationModeToUse === 'b30_only' ? maxedVariableList : fixedListSongs, theoreticalMaxSongsN20: simulationModeToUse === 'n20_only' ? maxedVariableList : fixedListSongs };
        dispatch({ type: 'SET_PRECOMPUTATION_RESULT', payload: precompResultPayload });
        dispatch({ type: 'SIMULATION_SUCCESS', payload: { // Dispatch success to update UI with these fixed lists
            simulatedB30Songs: precompResultPayload.theoreticalMaxSongsB30 || [],
            simulatedNew20Songs: precompResultPayload.theoreticalMaxSongsN20 || [],
            finalAverageB30Rating: simulationModeToUse === 'b30_only' ? avgVariableAtMax : currentB30Avg,
            finalAverageNew20Rating: simulationModeToUse === 'n20_only' ? avgVariableAtMax : currentN20Avg,
            finalOverallRating: reachableRating,
            finalPhase: 'target_unreachable_info',
            simulationLog: [getTranslation(initialData.locale, messageKey, reachableRating.toFixed(4))],
        }});
        return;
      }
    }

    const simulationInput: SimulationInput = {
      originalB30Songs: JSON.parse(JSON.stringify(state.apiData?.originalB30SongsData || [])),
      originalNew20Songs: JSON.parse(JSON.stringify(state.apiData?.originalNew20SongsData || [])),
      allPlayedNewSongsPool: JSON.parse(JSON.stringify(state.apiData?.allPlayedNewSongsPool || [])),
      allMusicData: JSON.parse(JSON.stringify(state.apiData?.allMusicData || [])),
      userPlayHistory: JSON.parse(JSON.stringify(state.apiData?.userPlayHistory || [])),
      playlistSongs: JSON.parse(JSON.stringify(state.playlistSongs)), // Pass playlist songs
      newSongsDataTitlesVerse: NewSongsData.titles.verse,
      constOverrides: constOverridesInternal as ConstOverride[],
      currentRating: currentRatingNum,
      targetRating: targetRatingNum,
      simulationMode: simulationModeToUse,
      algorithmPreference: algorithmPreferenceToUse,
      isScoreLimitReleased: (targetRatingNum - currentRatingNum) * 50 > 10,
      phaseTransitionPoint: parseFloat((currentRatingNum + (targetRatingNum - currentRatingNum) * 0.95).toFixed(4)),
      excludedSongKeys: new Set(state.excludedSongKeys),
    };
    simulationWorkerRef.current?.postMessage(simulationInput);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialData.calculationStrategy, isLoadingInitialApiData, initialData.clientHasMounted, initialData.locale,
    state.apiData?.originalB30SongsData, state.apiData?.originalNew20SongsData, state.apiData?.allPlayedNewSongsPool, state.apiData?.allMusicData, state.apiData?.userPlayHistory,
    initialData.currentRatingDisplay, initialData.targetRatingDisplay, state.excludedSongKeys, state.playlistSongs
  ]);


  // Update combined songs when simulation results change
  const combinedTopSongs = useMemo(() => {
    if (state.simulationStatus === 'simulating' && state.simulationResult?.finalPhase !== 'target_unreachable_info') return []; // Don't update if actively simulating unless unreachable info

    let baseB30: Song[];
    let baseN20: Song[];

    if (state.simulationResult?.theoreticalMaxSongsB30 && state.simulationResult?.theoreticalMaxSongsN20) {
        baseB30 = state.simulationResult.theoreticalMaxSongsB30;
        baseN20 = state.simulationResult.theoreticalMaxSongsN20;
    } else {
        baseB30 = state.apiData?.originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })) || [];
        baseN20 = state.apiData?.originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })) || [];
    }

    if (baseB30.length === 0 && baseN20.length === 0) return [];

    const songMap = new Map<string, Song & { displayRating: number }>();
    baseB30.forEach(song => songMap.set(`${song.id}_${song.diff}`, { ...song, displayRating: song.targetRating }));
    baseN20.forEach(song => {
      const key = `${song.id}_${song.diff}`;
      const existingEntry = songMap.get(key);
      if (!existingEntry || song.targetRating > existingEntry.displayRating) songMap.set(key, { ...song, displayRating: song.targetRating });
    });
    return Array.from(songMap.values()).sort((a, b) => b.displayRating - a.displayRating);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.simulationResult, state.apiData?.originalB30SongsData, state.apiData?.originalNew20SongsData]);
  
  const toggleExcludeSongKey = useCallback((songKey: string) => {
    dispatch({ type: 'TOGGLE_EXCLUDE_SONG', payload: songKey });
  }, []);

  const lastRefreshedDisplay = state.apiData?.timestamp 
    ? getTranslation(initialData.locale, 'resultPageSyncStatus', new Date(state.apiData.timestamp).toLocaleString(initialData.locale))
    : getTranslation(initialData.locale, 'resultPageSyncStatusNoCache');

  const setTargetRating = useCallback((newRating: number) => {
    dispatch({ type: 'SET_TARGET_RATING', payload: newRating });
  }, []);

  const setStrategy = useCallback((newStrategy: CalculationStrategy) => {
    dispatch({ type: 'SET_STRATEGY', payload: newStrategy });
  }, []);

  const runSimulation = useCallback((strategyToRun: CalculationStrategy) => {
    if (state.apiData) {
      dispatch({ type: 'START_SIMULATION' });
      let simulationModeToUse: SimulationInput['simulationMode'];
      let algorithmPreferenceToUse: SimulationInput['algorithmPreference'];

      if (strategyToRun === 'b30_focus') { simulationModeToUse = 'b30_only'; algorithmPreferenceToUse = 'floor'; }
      else if (strategyToRun === 'n20_focus') { simulationModeToUse = 'n20_only'; algorithmPreferenceToUse = 'floor'; }
      else if (strategyToRun === 'hybrid_floor') { simulationModeToUse = 'hybrid'; algorithmPreferenceToUse = 'floor'; }
      else if (strategyToRun === 'hybrid_peak') { simulationModeToUse = 'hybrid'; algorithmPreferenceToUse = 'peak'; }
      else if (strategyToRun === 'playlist_custom') { simulationModeToUse = 'playlist_custom'; algorithmPreferenceToUse = 'floor'; } // peak or floor doesn't matter here
      else {
          dispatch({ type: 'SIMULATION_ERROR', payload: 'Unknown calculation strategy' });
          return;
      }

      // Pre-computation check for b30/n20 focus modes
      if (simulationModeToUse === 'b30_only' || simulationModeToUse === 'n20_only') {
        let fixedListSongs: Song[] = [];
        let fixedListRatingSum = 0; let fixedListCount = 0;
        let variableListCandidatePool: (Song | ShowallApiSongEntry)[] = [];
        let variableListLimit = 0;
        let messageKey: keyof ReturnType<typeof getTranslation>['KR'] = 'resultPageErrorSimulationGeneric';

        const currentB30Avg = calculateAverageAndOverallRating(state.apiData?.originalB30SongsData || [], BEST_COUNT, 'currentRating').average;
        const currentN20Avg = calculateAverageAndOverallRating(state.apiData?.originalNew20SongsData || [], NEW_20_COUNT, 'currentRating').average;

        if (simulationModeToUse === 'b30_only') {
          messageKey = 'reachableRatingB30OnlyMessage';
          fixedListSongs = state.apiData?.originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })) || [];
          fixedListRatingSum = (currentN20Avg || 0) * Math.min(NEW_20_COUNT, state.apiData?.originalNew20SongsData.length || 0);
          fixedListCount = Math.min(NEW_20_COUNT, state.apiData?.originalNew20SongsData.length || 0);
          const b30PreCalcCandidates = state.apiData?.allMusicData.filter(ms => {
              const isNewSong = NewSongsData.titles.verse.some(title => title.trim().toLowerCase() === ms.title.trim().toLowerCase());
              const isInFixedN20 = state.apiData?.originalNew20SongsData.some(n20s => n20s.id === ms.id && n20s.diff.toUpperCase() === ms.diff.toUpperCase());
              return !isNewSong && !isInFixedN20;
          }) || [];
          variableListCandidatePool = [...state.apiData?.originalB30SongsData || [], ...b30PreCalcCandidates];
          variableListLimit = BEST_COUNT;
        } else { // n20_only
          messageKey = 'reachableRatingN20OnlyMessage';
          fixedListSongs = state.apiData?.originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })) || [];
          fixedListRatingSum = (currentB30Avg || 0) * Math.min(BEST_COUNT, state.apiData?.originalB30SongsData.length || 0);
          fixedListCount = Math.min(BEST_COUNT, state.apiData?.originalB30SongsData.length || 0);
          variableListCandidatePool = state.apiData?.allPlayedNewSongsPool.filter(pns => !state.apiData?.originalB30SongsData.some(b30s => b30s.id === pns.id && b30s.diff === pns.diff)) || [];
          variableListLimit = NEW_20_COUNT;
        }
        const { list: maxedVariableList, average: avgVariableAtMax, sum: sumVariableAtMax } = calculateTheoreticalMaxRatingsForList(variableListCandidatePool, variableListLimit, MAX_SCORE_ASSUMED_FOR_POTENTIAL, state.excludedSongKeys);
        const totalRatingSumAtMax = fixedListRatingSum + sumVariableAtMax;
        const totalEffectiveSongsAtMax = fixedListCount + maxedVariableList.length;
        const reachableRating = totalEffectiveSongsAtMax > 0 ? parseFloat((totalRatingSumAtMax / totalEffectiveSongsAtMax).toFixed(4)) : 0;

        if (state.apiData?.targetRating > reachableRating) {
          const precompResultPayload = { reachableRating, messageKey, theoreticalMaxSongsB30: simulationModeToUse === 'b30_only' ? maxedVariableList : fixedListSongs, theoreticalMaxSongsN20: simulationModeToUse === 'n20_only' ? maxedVariableList : fixedListSongs };
          dispatch({ type: 'SET_PRECOMPUTATION_RESULT', payload: precompResultPayload });
          dispatch({ type: 'SIMULATION_SUCCESS', payload: { // Dispatch success to update UI with these fixed lists
              simulatedB30Songs: precompResultPayload.theoreticalMaxSongsB30 || [],
              simulatedNew20Songs: precompResultPayload.theoreticalMaxSongsN20 || [],
              finalAverageB30Rating: simulationModeToUse === 'b30_only' ? avgVariableAtMax : currentB30Avg,
              finalAverageNew20Rating: simulationModeToUse === 'n20_only' ? avgVariableAtMax : currentN20Avg,
              finalOverallRating: reachableRating,
              finalPhase: 'target_unreachable_info',
              simulationLog: [getTranslation(initialData.locale, messageKey, reachableRating.toFixed(4))],
          }});
          return;
        }
      }

      const simulationInput: SimulationInput = {
        originalB30Songs: JSON.parse(JSON.stringify(state.apiData?.originalB30SongsData || [])),
        originalNew20Songs: JSON.parse(JSON.stringify(state.apiData?.originalNew20SongsData || [])),
        allPlayedNewSongsPool: JSON.parse(JSON.stringify(state.apiData?.allPlayedNewSongsPool || [])),
        allMusicData: JSON.parse(JSON.stringify(state.apiData?.allMusicData || [])),
        userPlayHistory: JSON.parse(JSON.stringify(state.apiData?.userPlayHistory || [])),
        playlistSongs: JSON.parse(JSON.stringify(state.playlistSongs)), // Pass playlist songs
        newSongsDataTitlesVerse: NewSongsData.titles.verse,
        constOverrides: constOverridesInternal as ConstOverride[],
        currentRating: state.apiData?.currentRating || 0,
        targetRating: state.apiData?.targetRating || 0,
        simulationMode: simulationModeToUse,
        algorithmPreference: algorithmPreferenceToUse,
        isScoreLimitReleased: (state.apiData?.targetRating || 0 - (state.apiData?.currentRating || 0)) * 50 > 10,
        phaseTransitionPoint: parseFloat(((state.apiData?.currentRating || 0) + ((state.apiData?.targetRating || 0) - (state.apiData?.currentRating || 0)) * 0.95).toFixed(4)),
        excludedSongKeys: new Set(state.excludedSongKeys),
      };
      simulationWorkerRef.current?.postMessage(simulationInput);
    }
  }, [state.apiData, state.excludedSongKeys, initialData.locale]);

  return {
    apiPlayerName: initialApiError ? (initialData.userNameForApi || defaultPlayerName) : (state.apiData?.profileName || (profileData?.player_name || initialData.userNameForApi || defaultPlayerName)),
    best30SongsData: state.apiData?.originalB30SongsData || [],
    new20SongsData: state.apiData?.originalNew20SongsData || [],
    combinedTopSongs,
    isLoadingSongs: isLoadingInitialApiData || state.simulationStatus === 'simulating',
    errorLoadingSongs: initialApiError ? (initialApiError.message || 'SWR Data fetching error') : state.simulationResult?.error || state.simulationStatus === 'error' ? 'Simulation failed' : null,
    lastRefreshed: lastRefreshedDisplay,
    currentPhase: state.simulationResult?.finalPhase || 'idle',
    simulatedAverageB30Rating: state.simulationResult?.finalAverageB30Rating || 0,
    simulatedAverageNew20Rating: state.simulationResult?.finalAverageNew20Rating || 0,
    finalOverallSimulatedRating: state.simulationResult?.finalOverallRating || 0,
    simulationLog: state.simulationResult?.simulationLog || [],
    preComputationResult: state.simulationResult?.theoreticalMaxSongsB30 || null,
    excludedSongKeys: state.excludedSongKeys,
    toggleExcludeSongKey,
    playlistSongs: state.playlistSongs,
    allMusicData: state.apiData?.allMusicData || [], // Expose all music data for search functionality
    currentRating: state.apiData?.currentRating || 0,
    targetRating: state.apiData?.targetRating || 0,
    strategy: state.apiData?.strategy || 'none',
    setTargetRating,
    setStrategy,
    runSimulation,
    dispatch, // Exposing dispatch to allow components to send actions
  };
}

// Small helper for useMemo, might not be needed if state structure is flat for combinedTopSongs calculation.
// Removed: const { useMemo } = React; // Now directly imported at the top

    
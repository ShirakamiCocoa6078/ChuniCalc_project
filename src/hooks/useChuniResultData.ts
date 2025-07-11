
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
} from "@/types/result-page";
import { useProfileData, useUserRatingData, useUserShowallData, useGlobalMusicData } from './useApiData'; // SWR hooks

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;
const MAX_SCORE_ASSUMED_FOR_POTENTIAL = 1009000;

// --- State, Action, Reducer for useReducer ---
interface ResultDataState {
  apiPlayerName: string | null;
  originalB30SongsData: Song[];
  originalNew20SongsData: Song[];
  allPlayedNewSongsPool: Song[];
  allMusicData: ShowallApiSongEntry[];
  userPlayHistory: ShowallApiSongEntry[];

  simulatedB30Songs: Song[];
  simulatedNew20Songs: Song[];
  simulatedAverageB30Rating: number | null;
  simulatedAverageNew20Rating: number | null;
  finalOverallSimulatedRating: number | null;
  simulationLog: string[];
  
  currentPhase: SimulationPhase;
  isLoadingSimulation: boolean;
  simulationError: string | null;
  
  preComputationResult: { reachableRating: number; messageKey: string; theoreticalMaxSongsB30?: Song[], theoreticalMaxSongsN20?: Song[] } | null;
  excludedSongKeys: Set<string>;
  lastRefreshedTimestamp: number | null; // For UI display of refresh time
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
  | { type: 'RESET_SIMULATION_STATE_FOR_NEW_STRATEGY' }
  | { type: 'SET_PRECOMPUTATION_RESULT'; payload: ResultDataState['preComputationResult'] }
  | { type: 'SET_CURRENT_PHASE'; payload: SimulationPhase };


const initialState: ResultDataState = {
  apiPlayerName: null,
  originalB30SongsData: [],
  originalNew20SongsData: [],
  allPlayedNewSongsPool: [],
  allMusicData: [],
  userPlayHistory: [],
  simulatedB30Songs: [],
  simulatedNew20Songs: [],
  simulatedAverageB30Rating: null,
  simulatedAverageNew20Rating: null,
  finalOverallSimulatedRating: null,
  simulationLog: [],
  currentPhase: 'idle',
  isLoadingSimulation: false,
  simulationError: null,
  preComputationResult: null,
  excludedSongKeys: new Set(),
  lastRefreshedTimestamp: null,
};

function resultDataReducer(state: ResultDataState, action: ResultDataAction): ResultDataState {
  switch (action.type) {
    case 'SET_INITIAL_DATA_SUCCESS':
      return {
        ...state,
        apiPlayerName: action.payload.profileName,
        originalB30SongsData: action.payload.originalB30,
        originalNew20SongsData: action.payload.originalN20,
        allPlayedNewSongsPool: action.payload.allPlayedPool,
        allMusicData: action.payload.allMusic,
        userPlayHistory: action.payload.userHistory,
        lastRefreshedTimestamp: action.payload.timestamp,
        // Reset simulation-specific state when new initial data comes
        simulatedB30Songs: action.payload.originalB30.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })),
        simulatedNew20Songs: action.payload.originalN20.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })),
        simulatedAverageB30Rating: calculateAverageAndOverallRating(action.payload.originalB30, BEST_COUNT, 'currentRating').average,
        simulatedAverageNew20Rating: calculateAverageAndOverallRating(action.payload.originalN20, NEW_20_COUNT, 'currentRating').average,
        finalOverallSimulatedRating: calculateAverageAndOverallRating([],0,'currentRating', calculateAverageAndOverallRating(action.payload.originalB30, BEST_COUNT, 'currentRating').average, calculateAverageAndOverallRating(action.payload.originalN20, NEW_20_COUNT, 'currentRating').average, action.payload.originalB30.length, action.payload.originalN20.length).overallAverage || 0,
        currentPhase: 'idle',
        simulationError: null,
        isLoadingSimulation: false,
        preComputationResult: null,
      };
    case 'START_SIMULATION':
      return { ...state, isLoadingSimulation: true, simulationError: null, currentPhase: 'simulating', simulationLog: [getTranslation('KR', 'resultPageLogSimulationStarting')] }; // Locale might need to be passed or fixed
    case 'SIMULATION_SUCCESS':
      return {
        ...state,
        isLoadingSimulation: false,
        simulatedB30Songs: action.payload.simulatedB30Songs,
        simulatedNew20Songs: action.payload.simulatedNew20Songs,
        simulatedAverageB30Rating: action.payload.finalAverageB30Rating,
        simulatedAverageNew20Rating: action.payload.finalAverageNew20Rating,
        finalOverallSimulatedRating: action.payload.finalOverallRating,
        currentPhase: action.payload.finalPhase,
        simulationLog: [...state.simulationLog, ...action.payload.simulationLog],
        simulationError: action.payload.error || null,
      };
    case 'SIMULATION_ERROR':
      return { ...state, isLoadingSimulation: false, simulationError: action.payload, currentPhase: 'error_simulation_logic' };
    case 'TOGGLE_EXCLUDE_SONG':
      const newExcludedKeys = new Set(state.excludedSongKeys);
      if (newExcludedKeys.has(action.payload)) newExcludedKeys.delete(action.payload);
      else newExcludedKeys.add(action.payload);
      return { ...state, excludedSongKeys: newExcludedKeys };
    case 'RESET_SIMULATION_STATE_FOR_NEW_STRATEGY':
      return {
        ...state,
        simulatedB30Songs: state.originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })),
        simulatedNew20Songs: state.originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating })),
        simulatedAverageB30Rating: calculateAverageAndOverallRating(state.originalB30SongsData, BEST_COUNT, 'currentRating').average,
        simulatedAverageNew20Rating: calculateAverageAndOverallRating(state.originalNew20SongsData, NEW_20_COUNT, 'currentRating').average,
        finalOverallSimulatedRating: calculateAverageAndOverallRating([],0,'currentRating', calculateAverageAndOverallRating(state.originalB30SongsData, BEST_COUNT, 'currentRating').average, calculateAverageAndOverallRating(state.originalNew20SongsData, NEW_20_COUNT, 'currentRating').average, state.originalB30SongsData.length, state.originalNew20SongsData.length).overallAverage || 0,
        currentPhase: 'idle',
        simulationError: null,
        isLoadingSimulation: false,
        preComputationResult: null,
        simulationLog: [],
      };
    case 'SET_PRECOMPUTATION_RESULT':
        return { ...state, preComputationResult: action.payload, isLoadingSimulation: false };
    case 'SET_CURRENT_PHASE':
        return { ...state, currentPhase: action.payload, isLoadingSimulation: false };
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

export function useChuniResultData({
  userNameForApi,
  currentRatingDisplay,
  targetRatingDisplay,
  locale,
  refreshNonce, // SWR's mutate can be used instead if fine-grained control is needed.
  clientHasMounted,
  calculationStrategy,
}: UseChuniResultDataProps) {
  const { toast } = useToast();
  const [state, dispatch] = useReducer(resultDataReducer, initialState);
  const simulationWorkerRef = useRef<Worker | null>(null);

  const defaultPlayerName = getTranslation(locale, 'resultPageDefaultPlayerName');

  // SWR Data Hooks
  const { data: profileData, error: profileError, isLoading: isLoadingProfile, mutate: mutateProfile } = useProfileData(userNameForApi && userNameForApi !== defaultPlayerName ? userNameForApi : null);
  const { data: ratingData, error: ratingError, isLoading: isLoadingRating, mutate: mutateRating } = useUserRatingData(userNameForApi && userNameForApi !== defaultPlayerName ? userNameForApi : null);
  const { data: userShowallData, error: userShowallError, isLoading: isLoadingUserShowall, mutate: mutateUserShowall } = useUserShowallData(userNameForApi && userNameForApi !== defaultPlayerName ? userNameForApi : null);
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
    if (!clientHasMounted || isLoadingInitialApiData || initialApiError || !userNameForApi || userNameForApi === defaultPlayerName) {
        if (initialApiError) {
            // Handle specific error messages here if needed, or just let SWR display them
            console.error("Error fetching initial data via SWR:", initialApiError);
        }
        return;
    }

    if (profileData && ratingData && globalMusicRaw && userShowallData) {
      const processedApiPlayerName = profileData.player_name || userNameForApi;
      
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
        }
      });
      toast({ title: getTranslation(locale, 'resultPageToastApiLoadSuccessTitle'), description: getTranslation(locale, 'resultPageToastCacheLoadSuccessDesc') }); // SWR acts as cache
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileData, ratingData, userShowallData, globalMusicRaw, isLoadingInitialApiData, initialApiError, clientHasMounted, userNameForApi, locale]);


  // Effect for manual refresh (cache busting for SWR)
  const handleFullRefresh = useCallback(() => {
    if (userNameForApi && userNameForApi !== defaultPlayerName) {
      mutateProfile(); // Revalidate profile
      mutateRating(); // Revalidate rating data
      mutateUserShowall(); // Revalidate user showall
    }
    mutateGlobalMusic(); // Revalidate global music
    toast({ title: getTranslation(locale, 'resultPageToastRefreshingDataTitle'), description: getTranslation(locale, 'resultPageToastRefreshingDataDesc') });
    dispatch({ type: 'RESET_SIMULATION_STATE_FOR_NEW_STRATEGY' }); // Reset simulation state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNameForApi, defaultPlayerName, mutateProfile, mutateRating, mutateUserShowall, mutateGlobalMusic, locale, toast]);

  useEffect(() => {
    if (refreshNonce > 0) { // Triggered by user clicking refresh button
        handleFullRefresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]); // Removed handleFullRefresh from deps to avoid loop, nonce controls it

  // Simulation Logic Trigger
  useEffect(() => {
    if (isLoadingInitialApiData || !clientHasMounted || state.originalB30SongsData.length === 0) return;

    const currentRatingNum = parseFloat(currentRatingDisplay || "0");
    const targetRatingNum = parseFloat(targetRatingDisplay || "0");

    if (isNaN(currentRatingNum) || isNaN(targetRatingNum)) {
      dispatch({ type: 'SIMULATION_ERROR', payload: getTranslation(locale, 'resultPageErrorInvalidRatingsInput')});
      return;
    }

    if (calculationStrategy === "none" || calculationStrategy === null) {
      dispatch({ type: 'RESET_SIMULATION_STATE_FOR_NEW_STRATEGY' });
      return;
    }
    
    dispatch({ type: 'RESET_SIMULATION_STATE_FOR_NEW_STRATEGY' }); // Reset before new sim
    dispatch({ type: 'START_SIMULATION' });

    let simulationModeToUse: SimulationInput['simulationMode'];
    let algorithmPreferenceToUse: SimulationInput['algorithmPreference'];

    if (calculationStrategy === 'b30_focus') { simulationModeToUse = 'b30_only'; algorithmPreferenceToUse = 'floor'; }
    else if (calculationStrategy === 'n20_focus') { simulationModeToUse = 'n20_only'; algorithmPreferenceToUse = 'floor'; }
    else if (calculationStrategy === 'hybrid_floor') { simulationModeToUse = 'hybrid'; algorithmPreferenceToUse = 'floor'; }
    else if (calculationStrategy === 'hybrid_peak') { simulationModeToUse = 'hybrid'; algorithmPreferenceToUse = 'peak'; }
    else {
        dispatch({ type: 'SIMULATION_ERROR', payload: 'Unknown calculation strategy' });
        return;
    }

    // Pre-computation check (simplified version, can be expanded)
    if (simulationModeToUse === 'b30_only' || simulationModeToUse === 'n20_only') {
      let fixedListSongs: Song[] = [];
      let fixedListRatingSum = 0; let fixedListCount = 0;
      let variableListCandidatePool: (Song | ShowallApiSongEntry)[] = [];
      let variableListLimit = 0;
      let messageKey: keyof ReturnType<typeof getTranslation>['KR'] = 'resultPageErrorSimulationGeneric';

      const currentB30Avg = calculateAverageAndOverallRating(state.originalB30SongsData, BEST_COUNT, 'currentRating').average;
      const currentN20Avg = calculateAverageAndOverallRating(state.originalNew20SongsData, NEW_20_COUNT, 'currentRating').average;

      if (simulationModeToUse === 'b30_only') {
        messageKey = 'reachableRatingB30OnlyMessage';
        fixedListSongs = state.originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
        fixedListRatingSum = (currentN20Avg || 0) * Math.min(NEW_20_COUNT, state.originalNew20SongsData.length);
        fixedListCount = Math.min(NEW_20_COUNT, state.originalNew20SongsData.length);
        const b30PreCalcCandidates = state.allMusicData.filter(ms => {
            const isNewSong = NewSongsData.titles.verse.some(title => title.trim().toLowerCase() === ms.title.trim().toLowerCase());
            const isInFixedN20 = state.originalNew20SongsData.some(n20s => n20s.id === ms.id && n20s.diff.toUpperCase() === ms.diff.toUpperCase());
            return !isNewSong && !isInFixedN20;
        });
        variableListCandidatePool = [...state.originalB30SongsData, ...b30PreCalcCandidates];
        variableListLimit = BEST_COUNT;
      } else { // n20_only
        messageKey = 'reachableRatingN20OnlyMessage';
        fixedListSongs = state.originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
        fixedListRatingSum = (currentB30Avg || 0) * Math.min(BEST_COUNT, state.originalB30SongsData.length);
        fixedListCount = Math.min(BEST_COUNT, state.originalB30SongsData.length);
        variableListCandidatePool = state.allPlayedNewSongsPool.filter(pns => !state.originalB30SongsData.some(b30s => b30s.id === pns.id && b30s.diff === pns.diff));
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
            simulationLog: [getTranslation(locale, messageKey, reachableRating.toFixed(4))],
        }});
        return;
      }
    }

    const simulationInput: SimulationInput = {
      originalB30Songs: JSON.parse(JSON.stringify(state.originalB30SongsData)),
      originalNew20Songs: JSON.parse(JSON.stringify(state.originalNew20SongsData)),
      allPlayedNewSongsPool: JSON.parse(JSON.stringify(state.allPlayedNewSongsPool)),
      allMusicData: JSON.parse(JSON.stringify(state.allMusicData)),
      userPlayHistory: JSON.parse(JSON.stringify(state.userPlayHistory)),
      newSongsDataTitlesVerse: NewSongsData.titles.verse, // Pass to worker
      constOverrides: constOverridesInternal as ConstOverride[], // Pass to worker
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
    calculationStrategy, isLoadingInitialApiData, clientHasMounted, locale,
    state.originalB30SongsData, state.originalNew20SongsData, state.allPlayedNewSongsPool, state.allMusicData, state.userPlayHistory,
    currentRatingDisplay, targetRatingDisplay, state.excludedSongKeys
  ]);


  // Update combined songs when simulation results change
  const combinedTopSongs = useMemo(() => {
    if (state.isLoadingSimulation && state.currentPhase !== 'target_unreachable_info') return []; // Don't update if actively simulating unless unreachable info

    let baseB30: Song[];
    let baseN20: Song[];

    if (state.preComputationResult && state.currentPhase === 'target_unreachable_info') {
        baseB30 = state.preComputationResult.theoreticalMaxSongsB30 || [];
        baseN20 = state.preComputationResult.theoreticalMaxSongsN20 || [];
    } else {
        baseB30 = state.simulatedB30Songs.length > 0 ? state.simulatedB30Songs : state.originalB30SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
        baseN20 = state.simulatedNew20Songs.length > 0 ? state.simulatedNew20Songs : state.originalNew20SongsData.map(s => ({ ...s, targetScore: s.currentScore, targetRating: s.currentRating }));
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
  }, [state.simulatedB30Songs, state.simulatedNew20Songs, state.originalB30SongsData, state.originalNew20SongsData, state.isLoadingSimulation, state.preComputationResult, state.currentPhase]);
  
  const toggleExcludeSongKey = useCallback((songKey: string) => {
    dispatch({ type: 'TOGGLE_EXCLUDE_SONG', payload: songKey });
  }, []);

  const lastRefreshedDisplay = state.lastRefreshedTimestamp 
    ? getTranslation(locale, 'resultPageSyncStatus', new Date(state.lastRefreshedTimestamp).toLocaleString(locale))
    : getTranslation(locale, 'resultPageSyncStatusNoCache');

  return {
    apiPlayerName: initialApiError ? (userNameForApi || defaultPlayerName) : (state.apiPlayerName || (profileData?.player_name || userNameForApi || defaultPlayerName)),
    best30SongsData: state.simulatedB30Songs,
    new20SongsData: state.simulatedNew20Songs,
    combinedTopSongs,
    isLoadingSongs: isLoadingInitialApiData || state.isLoadingSimulation,
    errorLoadingSongs: initialApiError ? (initialApiError.message || 'SWR Data fetching error') : state.simulationError,
    lastRefreshed: lastRefreshedDisplay,
    currentPhase: state.currentPhase,
    simulatedAverageB30Rating: state.simulatedAverageB30Rating,
    simulatedAverageNew20Rating: state.simulatedAverageNew20Rating,
    finalOverallSimulatedRating: state.finalOverallSimulatedRating,
    simulationLog: state.simulationLog,
    preComputationResult: state.preComputationResult,
    excludedSongKeys: state.excludedSongKeys,
    toggleExcludeSongKey,
  };
}

// Small helper for useMemo, might not be needed if state structure is flat for combinedTopSongs calculation.
// Removed: const { useMemo } = React; // Now directly imported at the top

    
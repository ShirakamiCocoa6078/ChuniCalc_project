
// src/types/result-page.ts

export type ProfileData = {
    player_name: string;
    rating?: number | string;
};

export type RatingApiSongEntry = {
  id: string;
  diff: string;
  title: string;
  score: number;
  rating: number;
  genre?: string;
  const?: number; // chartConstant in API, can be null or number
  updated_at?: string;
};

export type ShowallApiSongEntry = {
  id: string;
  diff: string;
  title: string;
  genre: string;
  const: number | null;
  level: number | string;
  release?: string;
  score?: number; // User's score if played
  rating?: number | null; // User's calculated rating for this song, or internal rating from API
  is_played?: boolean;
  updated_at?: string;
  is_clear?: boolean;
  is_fullcombo?: boolean;
  is_alljustice?: boolean;
  is_fullchain?: boolean;
  is_const_unknown?: boolean; // Important for const fallback
};

// Defines the strategy selected by the user in the UI
export type CalculationStrategy =
  | "b30_focus"         // Focus on B30, N20 fixed (uses floor-like algorithm internally for now)
  | "n20_focus"         // Focus on N20, B30 fixed (uses floor-like algorithm internally for now)
  | "hybrid_floor"      // Full simulation using floor-preference algorithm
  | "hybrid_peak"       // Full simulation using peak-preference algorithm
  | "none"              // No simulation, show current state
  | null;               // Initial state

export type Song = {
  id: string;
  diff: string;
  title: string;
  chartConstant: number | null;
  currentScore: number;
  currentRating: number;
  targetScore: number;
  targetRating: number;
  // Optional fields that might be useful from ShowallApiSongEntry or RatingApiSongEntry
  genre?: string;
  level?: number | string;
  release?: string;
  is_played?: boolean;
  is_clear?: boolean;
  is_fullcombo?: boolean;
  is_alljustice?: boolean;
  is_const_unknown?: boolean;
  // Fields for simulation tracking if needed outside the pure function
  sim_isNewInB30?: boolean;
  sim_originalB30Rating?: number;
  sim_timesImproved?: number;
};


export type GlobalMusicApiResponse = {
    records?: ShowallApiSongEntry[];
};

export type UserShowallApiResponse = {
    records?: ShowallApiSongEntry[];
};

export type RatingApiResponse = {
    best?: { entries?: RatingApiSongEntry[] };
};

export type SimulationPhase =
  | 'idle'
  | 'simulating'
  | 'target_reached'
  | 'stuck_b30_no_improvement'
  | 'stuck_n20_no_improvement'
  | 'stuck_both_no_improvement'
  | 'error_data_fetch'
  | 'error_simulation_logic'
  | 'target_unreachable_info'; // New phase for pre-calculation check

export type CachedSimulationResult = {
  timestamp: number;
  sourceDataTimestamp: number;
  simulatedB30Songs: Song[];
  simulatedAverageB30Rating: number | null;
  simulatedNew20Songs?: Song[];
  simulatedAverageNew20Rating?: number | null;
  finalPhase: SimulationPhase;
};


// Types for the pure simulation logic
export interface SimulationInput {
  originalB30Songs: Song[];
  originalNew20Songs: Song[];
  allPlayedNewSongsPool: Song[];
  allMusicData: ShowallApiSongEntry[];
  userPlayHistory: ShowallApiSongEntry[];
  currentRating: number;
  targetRating: number;
  // algorithmPreference tells the engine how to prioritize improvements (e.g., floor or peak logic)
  algorithmPreference: "floor" | "peak";
  // simulationMode tells the engine which lists are subject to change
  simulationMode: "b30_only" | "n20_only" | "hybrid";
  isScoreLimitReleased: boolean;
  phaseTransitionPoint: number | null;
}

export interface SimulationOutput {
  simulatedB30Songs: Song[];
  simulatedNew20Songs: Song[];
  finalAverageB30Rating: number | null;
  finalAverageNew20Rating: number | null;
  finalOverallRating: number;
  finalPhase: SimulationPhase;
  simulationLog: string[];
  error?: string;
}

// Type for pre-calculation result
export type TheoreticalMaxInfo = {
  reachableRating: number;
  message: string | null; // Message to display if target is unreachable
};

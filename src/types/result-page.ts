
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

export type CalculationStrategy = "peak" | "floor";

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
  // Fields for simulation tracking if needed outside the pure function (less likely now)
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

// This phase type might still be useful for the *output* of the pure function
export type SimulationPhase =
  | 'idle' // Or 'not_started'
  | 'simulating' // Generic state while pure function runs
  | 'target_reached'
  | 'stuck_b30_no_improvement'
  | 'stuck_n20_no_improvement'
  | 'stuck_both_no_improvement' // If B30 got stuck, then N20 also got stuck
  | 'error_data_fetch' // For initial data loading issues
  | 'error_simulation_logic' // If pure function itself throws an error
  // Detailed internal phases (for the pure function's log, not necessarily React state)
  | 'internal_b30_leap'
  | 'internal_b30_finetune'
  | 'internal_b30_replace'
  | 'internal_n20_leap'
  | 'internal_n20_finetune'
  | 'internal_n20_replace';

export type CachedSimulationResult = {
  timestamp: number;
  sourceDataTimestamp: number;
  simulatedB30Songs: Song[];
  simulatedAverageB30Rating: number | null;
  simulatedNew20Songs?: Song[]; // Added for N20 cache
  simulatedAverageNew20Rating?: number | null; // Added for N20 cache
  finalPhase: SimulationPhase; // Use the updated SimulationPhase
};


// Types for the new pure simulation logic
export interface SimulationInput {
  originalB30Songs: Song[];
  originalNew20Songs: Song[];
  allPlayedNewSongsPool: Song[]; // All songs from NewSongs.json that user has played (score >= 800k)
  allMusicData: ShowallApiSongEntry[]; // Flattened global music data
  userPlayHistory: ShowallApiSongEntry[]; // User's full play history (records/showall)
  currentRating: number;
  targetRating: number;
  calculationStrategy: CalculationStrategy;
  isScoreLimitReleased: boolean;
  phaseTransitionPoint: number | null; // Fine-tuning transition point for B30
  // userNameForApi: string | null; // Potentially for logging within pure function
  // locale: string; // For logging
}

export interface SimulationOutput {
  simulatedB30Songs: Song[];
  simulatedNew20Songs: Song[];
  finalAverageB30Rating: number | null;
  finalAverageNew20Rating: number | null;
  finalOverallRating: number;
  finalPhase: SimulationPhase; // e.g., 'target_reached', 'stuck_b30_no_improvement', etc.
  simulationLog: string[]; // For debugging on the test page
  error?: string; // If an error occurred within the simulation
}

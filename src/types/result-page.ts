
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
  const?: number; 
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
  score?: number; 
  rating?: number | null; 
  is_played?: boolean;
  updated_at?: string;
  is_clear?: boolean;
  is_fullcombo?: boolean;
  is_alljustice?: boolean;
  is_fullchain?: boolean;
  is_const_unknown?: boolean; 
};

export type CalculationStrategy = 
  | 'b30_focus' 
  | 'n20_focus' 
  | 'combined_floor' 
  | 'combined_peak'
  | 'hybrid_floor' // Re-add for compatibility
  | 'hybrid_peak'  // Re-add for compatibility
  | 'playlist_custom'
  | 'none';

export type Song = {
  id: string;
  diff: string;
  title: string;
  chartConstant: number | null;
  currentScore: number;
  currentRating: number;
  targetScore: number;
  targetRating: number;
  genre?: string;
  level?: number | string;
  release?: string;
  is_played?: boolean;
  is_clear?: boolean;
  is_fullcombo?: boolean;
  is_alljustice?: boolean;
  is_const_unknown?: boolean;
  isExcludedFromImprovement?: boolean;
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
  | 'target_unreachable_info';

export type CachedSimulationResult = {
  timestamp: number;
  sourceDataTimestamp: number;
  simulatedB30Songs: Song[];
  simulatedAverageB30Rating: number | null;
  simulatedNew20Songs?: Song[];
  simulatedAverageNew20Rating?: number | null;
  finalPhase: SimulationPhase;
};

export interface SimulationInput {
  originalB30Songs: Song[];
  originalNew20Songs: Song[];
  allPlayedNewSongsPool: Song[];
  allMusicData: ShowallApiSongEntry[];
  userPlayHistory: ShowallApiSongEntry[];
  newSongsDataTitlesVerse: string[]; // Added for worker
  constOverrides: ConstOverride[]; // Added for worker
  currentRating: number;
  targetRating: number;
  strategy: CalculationStrategy;
  currentB30: Song[];
  currentN20: Song[];
  algorithmPreference: "floor" | "peak";
  simulationMode: "b30_only" | "n20_only" | "hybrid" | "playlist_custom";
  isScoreLimitReleased: boolean;
  phaseTransitionPoint: number | null;
  excludedSongKeys: Set<string>;
  playlistSongs: Song[];
}

export interface ApiData {
    playerName: string;
    currentB30: Song[];
    currentN20: Song[];
    allMusicData: ShowallApiSongEntry[];
}

export interface InitialData {
    userNameForApi: string | null;
    currentRatingDisplay: string | null;
    targetRatingDisplay: string | null;
    locale: string;
    refreshNonce: number;
    clientHasMounted: boolean;
    calculationStrategy: CalculationStrategy;
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

export type TheoreticalMaxInfo = {
  reachableRating: number;
  message: string | null;
};

export type ConstOverride = {
  title: string;
  diff: string;
  const: number;
};

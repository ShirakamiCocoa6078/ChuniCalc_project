
// src/types/result-page.ts

// import type { Song as SongCardSongType } from "@/components/SongCard"; // Keep if SongCard defines it and it's identical

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
  | 'initializing_leap_phase'
  | 'analyzing_leap_efficiency'
  | 'performing_leap_jump'
  | 'evaluating_leap_result'
  | 'transitioning_to_fine_tuning'
  | 'initializing_fine_tuning_phase'
  | 'performing_fine_tuning'
  | 'evaluating_fine_tuning_result'
  | 'target_reached'
  | 'stuck_awaiting_replacement' 
  | 'awaiting_external_data_for_replacement'
  | 'identifying_candidates'
  | 'candidates_identified'
  | 'selecting_optimal_candidate'
  | 'optimal_candidate_selected'
  | 'replacing_song'
  | 'error';

export type CachedSimulationResult = {
  timestamp: number; // Timestamp of when this simulation result was cached
  sourceDataTimestamp: number; // Timestamp of the rating_data used for this simulation
  simulatedB30Songs: Song[];
  simulatedAverageB30Rating: number | null;
  finalPhase: SimulationPhase;
};


// src/types/result-page.ts

import type { Song as SongCardSongType } from "@/components/SongCard"; // Keep if SongCard defines it and it's identical

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

export type CalculationStrategy = "average" | "peak" | "floor";

// Re-defining Song type here if it's more central to result page logic
// or ensure SongCardSongType is sufficient and imported correctly.
// For this refactor, let's assume Song type from SongCard is the one to use,
// or we can define it here if it's more general.
// To avoid circular dependencies if SongCard needs types from here,
// it's better to define common types like Song here.
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
    records?: ShowallApiSongEntry[]; // Assuming music/showall.json returns ShowallApiSongEntry structure
};

export type UserShowallApiResponse = {
    records?: ShowallApiSongEntry[]; // Assuming records/showall.json returns ShowallApiSongEntry structure
};

export type RatingApiResponse = {
    best?: { entries?: RatingApiSongEntry[] };
    // other fields from rating_data.json if needed
};

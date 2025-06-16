
// src/lib/rating-utils.ts

import type { RatingApiSongEntry, ShowallApiSongEntry, Song } from "@/types/result-page";

export const difficultyOrder: { [key: string]: number } = {
  ULT: 5,
  MAS: 4,
  EXP: 3,
  ADV: 2,
  BAS: 1,
};

// 0-1단계: 계산식 및 보간 규칙
export const calculateChunithmSongRating = (score: number, chartConstant: number | undefined | null): number => {
  if (typeof chartConstant !== 'number' || chartConstant <= 0) {
    return 0;
  }

  let ratingValue = 0;

  if (score >= 1009000) {
    ratingValue = chartConstant + 2.15;
  } else if (score >= 1007500) {
    ratingValue = chartConstant + 2.00 + Math.floor(Math.max(0, score - 1007500) / 100) * 0.01;
    if (score >= 1009000) ratingValue = chartConstant + 2.15; // This condition seems redundant based on the outer if, but kept for safety from original logic
    else ratingValue = Math.min(chartConstant + 2.15, ratingValue);
  } else if (score >= 1005000) {
    ratingValue = chartConstant + 1.50 + Math.floor(Math.max(0, score - 1005000) / 50) * 0.01;
    ratingValue = Math.min(chartConstant + 2.00, ratingValue);
  } else if (score >= 1000000) {
    ratingValue = chartConstant + 1.00 + Math.floor(Math.max(0, score - 1000000) / 100) * 0.01;
    ratingValue = Math.min(chartConstant + 1.50, ratingValue);
  } else if (score >= 975000) { // From 975000 to 999999
    ratingValue = chartConstant + 0.00 + Math.floor(Math.max(0, score - 975000) / 250) * 0.01; // Max of +1.00 (25000 / 250 * 0.01 = 1.00)
    ratingValue = Math.min(chartConstant + 1.00, ratingValue);
  } else if (score >= 950000) {
    ratingValue = chartConstant - 1.50;
  } else if (score >= 925000) {
    ratingValue = chartConstant - 3.00;
  } else if (score >= 900000) {
    ratingValue = chartConstant - 5.00;
  } else if (score >= 800000) {
    ratingValue = (chartConstant - 5.00) / 2.0;
  } else {
    ratingValue = 0;
  }
  // Ensure final interpolated values don't exceed their segment caps due to floating point math or logic steps.
  if (score >= 1007500 && ratingValue > chartConstant + 2.15) { // Cap for 1007500+
      ratingValue = chartConstant + 2.15;
  }


  return Math.max(0, parseFloat(ratingValue.toFixed(4)));
};

export const mapApiSongToAppSong = (
    apiSong: RatingApiSongEntry | ShowallApiSongEntry,
    _index: number,
    chartConstantOverride?: number
): Song => {
  const score = typeof apiSong.score === 'number' ? apiSong.score : 0;

  let effectiveChartConstant: number | null = null;

  if (typeof chartConstantOverride === 'number' && chartConstantOverride > 0) {
    effectiveChartConstant = chartConstantOverride;
  } else {
    if (typeof apiSong.const === 'number' && apiSong.const > 0) {
      effectiveChartConstant = apiSong.const;
    }
    else if (apiSong.const === 0) { // Treat 0.0 const as "use level if integer or x.5"
      if ((typeof apiSong.level === 'string' || typeof apiSong.level === 'number') && String(apiSong.level).trim() !== "") {
        const parsedLevel = parseFloat(String(apiSong.level));
        if (!isNaN(parsedLevel) && parsedLevel > 0) {
          const isInteger = parsedLevel % 1 === 0;
          const isXpoint5 = Math.abs((parsedLevel * 10) % 10) === 5; // Check for .5

          if (isInteger || isXpoint5) {
            effectiveChartConstant = parsedLevel;
          }
        }
      }
    }
    // Fallback for is_const_unknown: use level if available and numeric
    else if (effectiveChartConstant === null && (apiSong as ShowallApiSongEntry).is_const_unknown &&
             (typeof apiSong.level === 'string' || typeof apiSong.level === 'number') &&
             String(apiSong.level).trim() !== "") {
      const parsedLevel = parseFloat(String(apiSong.level));
      if (!isNaN(parsedLevel) && parsedLevel > 0) {
        effectiveChartConstant = parsedLevel;
      }
    }
  }

  // Recalculate currentRating if we have an effectiveChartConstant and score
  // Otherwise, use the rating from API if available.
  let calculatedCurrentRating: number;
  if (typeof effectiveChartConstant === 'number' && effectiveChartConstant > 0 && score > 0) {
    calculatedCurrentRating = calculateChunithmSongRating(score, effectiveChartConstant);
  } else {
    // If no valid const, rely on API's rating if present, else 0.
    calculatedCurrentRating = typeof apiSong.rating === 'number' ? apiSong.rating : 0;
  }
  const currentRating = parseFloat(calculatedCurrentRating.toFixed(4)); // Standardize precision

  // Initial target is same as current
  const targetScore = score;
  const targetRating = currentRating;

  const baseSong: Song = {
    id: apiSong.id,
    diff: apiSong.diff,
    title: apiSong.title,
    chartConstant: effectiveChartConstant,
    currentScore: score,
    currentRating: currentRating,
    targetScore: targetScore,
    targetRating: targetRating,
    genre: apiSong.genre,
    level: apiSong.level,
  };

  // Optional fields from ShowallApiSongEntry
  if ('release' in apiSong) baseSong.release = apiSong.release;
  if ('is_played' in apiSong) baseSong.is_played = apiSong.is_played;
  if ('is_clear' in apiSong) baseSong.is_clear = apiSong.is_clear;
  if ('is_fullcombo' in apiSong) baseSong.is_fullcombo = apiSong.is_fullcombo;
  if ('is_alljustice' in apiSong) baseSong.is_alljustice = apiSong.is_alljustice;
  if ('is_const_unknown' in apiSong) baseSong.is_const_unknown = apiSong.is_const_unknown;


  return baseSong;
};

export const sortSongsByRatingDesc = (songs: Song[]): Song[] => {
  return [...songs].sort((a, b) => {
    if (b.currentRating !== a.currentRating) {
      return b.currentRating - a.currentRating;
    }
    if (b.currentScore !== a.currentScore) { // If ratings are same, higher score first
        return b.currentScore - a.currentScore;
    }
    // If scores also same, sort by difficulty then title
    const diffAOrder = difficultyOrder[a.diff.toUpperCase() as keyof typeof difficultyOrder] || 0;
    const diffBOrder = difficultyOrder[b.diff.toUpperCase() as keyof typeof difficultyOrder] || 0;
    return diffBOrder - diffAOrder;
  });
};


// Finds the minimum score required to achieve a target rating for a song.
export const findMinScoreForTargetRating = (
  currentSong: Song,
  absoluteTargetRating: number,
  isLimitReleasedLocal: boolean
): { score: number; rating: number; possible: boolean } => {
  if (typeof currentSong.chartConstant !== 'number' || currentSong.chartConstant <= 0) {
    // Cannot calculate if chartConstant is invalid
    return { score: currentSong.currentScore, rating: currentSong.currentRating, possible: false };
  }

  const maxScore = isLimitReleasedLocal ? 1010000 : 1009000; // SSS+ or AJC with full release

  // If current rating already meets or exceeds target, and it's a valid play
  if (currentSong.currentRating >= absoluteTargetRating && currentSong.currentScore > 0) {
      return { score: currentSong.currentScore, rating: currentSong.currentRating, possible: true };
  }

  // Start searching from current score + 1, or a baseline if no score
  const startingScore = currentSong.currentScore > 0 ? currentSong.currentScore + 1 : 1; // Start from 1 if no current score

  for (let scoreAttempt = startingScore; scoreAttempt <= maxScore; scoreAttempt += 1) { // Iterate by 1 for precision
    const calculatedRating = calculateChunithmSongRating(scoreAttempt, currentSong.chartConstant);
    if (calculatedRating >= absoluteTargetRating) {
      return { score: scoreAttempt, rating: parseFloat(calculatedRating.toFixed(4)), possible: true };
    }
  }

  // If loop finishes, it means target rating was not achieved even at maxScore
  const ratingAtMaxScore = calculateChunithmSongRating(maxScore, currentSong.chartConstant);
  return { score: maxScore, rating: parseFloat(ratingAtMaxScore.toFixed(4)), possible: ratingAtMaxScore >= absoluteTargetRating };
};


export const getNextGradeBoundaryScore = (currentScore: number): number | null => {
    if (currentScore >= 1009000) return null; // Already SSS+ or higher
    if (currentScore < 975000) return 975000;  // Target S
    if (currentScore < 1000000) return 1000000; // Target SS
    if (currentScore < 1005000) return 1005000; // Target SSS
    if (currentScore < 1007500) return 1007500; // Target SSS (high threshold)
    if (currentScore < 1009000) return 1009000; // Target SSS+
    return null; // Should not be reached if first check is correct
};


export function calculateAverageAndOverallRating(
  songs: Song[],
  listLimit: number,
  propertyToConsiderForRating: 'currentRating' | 'targetRating' = 'currentRating',
  fixedB30Avg?: number | null, // Optional: if B30 average is fixed (e.g., for N20-only sim)
  fixedN20Avg?: number | null, // Optional: if N20 average is fixed (e.g., for B30-only sim)
  actualB30Count?: number,    // Number of songs contributing to B30 avg (can be < listLimit)
  actualN20Count?: number     // Number of songs contributing to N20 avg (can be < listLimit)
): { list: Song[], sum: number, average: number | null, overallAverage?: number } {
  let overallAverage: number | undefined = undefined;

  // If fixed averages for B30 and N20 are provided, calculate overall rating
  if (fixedB30Avg !== undefined && fixedN20Avg !== undefined && actualB30Count !== undefined && actualN20Count !== undefined) {
    const B30_COUNT_FOR_AVG = Math.min(30, actualB30Count); // Use actual count up to the limit
    const N20_COUNT_FOR_AVG = Math.min(20, actualN20Count); // Use actual count up to the limit
    const totalEffectiveSongs = B30_COUNT_FOR_AVG + N20_COUNT_FOR_AVG;

    if (totalEffectiveSongs > 0) {
      const sumB30 = (fixedB30Avg || 0) * B30_COUNT_FOR_AVG;
      const sumN20 = (fixedN20Avg || 0) * N20_COUNT_FOR_AVG;
      overallAverage = parseFloat(((sumB30 + sumN20) / totalEffectiveSongs).toFixed(4));
    } else {
      overallAverage = 0; // Or null, depending on desired behavior for no songs
    }
  }

  // Calculate average for the primary list `songs` passed to the function
  const songsToConsider = songs.map(s_item => {
    const songToConsider = { ...s_item }; // Shallow copy to avoid mutating original objects
    const rating = songToConsider[propertyToConsiderForRating];
    return { ...songToConsider, ratingToUse: typeof rating === 'number' ? rating : 0 };
  });

  const sortedSongs = [...songsToConsider].sort((a, b) => b.ratingToUse - a.ratingToUse);
  const topSongs = sortedSongs.slice(0, listLimit);

  const sum = topSongs.reduce((acc, s_item) => acc + s_item.ratingToUse, 0);
  const average = topSongs.length > 0 ? parseFloat((sum / topSongs.length).toFixed(4)) : null;

  return { list: topSongs, sum, average, overallAverage };
}

export function calculateTheoreticalMaxRatingsForList(
  candidatePool: (Song | ShowallApiSongEntry)[],
  listLimit: number,
  scoreToAssume: number,
  excludedSongKeys?: Set<string> // Optional set of excluded song keys `${id}_${diff}`
): { list: Song[]; average: number | null; sum: number } {
  const maxedSongs: Song[] = candidatePool
    .map(s_item => {
      const songKey = `${s_item.id}_${s_item.diff.toUpperCase()}`;
      const isExcluded = excludedSongKeys ? excludedSongKeys.has(songKey) : false;

      const songToConsider = ('currentScore' in s_item)
        ? { ...s_item } as Song // Already a Song object
        : mapApiSongToAppSong(s_item as ShowallApiSongEntry, 0, (s_item as ShowallApiSongEntry).const);

      if (isExcluded) { // If excluded, fix to current state
        return {
          ...songToConsider,
          targetScore: songToConsider.currentScore,
          targetRating: songToConsider.currentRating,
        };
      }
      
      if (!songToConsider.chartConstant) { // If no const, can't calculate new rating
        return { ...songToConsider, targetScore: songToConsider.currentScore, targetRating: songToConsider.currentRating };
      }

      // If current score is already at or above the assumed score, use current values
      if (songToConsider.currentScore >= scoreToAssume) {
        return {
          ...songToConsider,
          targetScore: songToConsider.currentScore,
          targetRating: songToConsider.currentRating,
        };
      }

      // Otherwise, calculate rating at the assumed score
      const maxRating = calculateChunithmSongRating(scoreToAssume, songToConsider.chartConstant);
      return {
        ...songToConsider,
        targetScore: scoreToAssume,
        targetRating: parseFloat(maxRating.toFixed(4)),
      };
    })
    .filter(song => song.chartConstant !== null) // Ensure only songs with valid const are processed further
    .sort((a, b) => b.targetRating - a.targetRating); // Sort by the newly calculated targetRating

  const topSongs = maxedSongs.slice(0, listLimit);

  if (topSongs.length === 0) {
    return { list: [], average: null, sum: 0 };
  }

  const sum = topSongs.reduce((acc, s_item) => acc + s_item.targetRating, 0);
  const average = parseFloat((sum / topSongs.length).toFixed(4));
  return { list: topSongs, average, sum };
}

// Used for initial API data processing
export function deduplicateAndPrioritizeSongs(songs: Song[]): Song[] {
  const songMap = new Map<string, Song>();
  for (const song of songs) {
    const key = `${song.id}_${song.diff}`;
    const existingSong = songMap.get(key);
    if (
      !existingSong ||
      song.currentRating > existingSong.currentRating ||
      (song.currentRating === existingSong.currentRating && song.currentScore > existingSong.currentScore)
    ) {
      songMap.set(key, song);
    }
  }
  return Array.from(songMap.values());
}


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
    if (score >= 1009000) ratingValue = chartConstant + 2.15;
    else ratingValue = Math.min(chartConstant + 2.15, ratingValue);
  } else if (score >= 1005000) {
    ratingValue = chartConstant + 1.50 + Math.floor(Math.max(0, score - 1005000) / 50) * 0.01;
    ratingValue = Math.min(chartConstant + 2.00, ratingValue);
  } else if (score >= 1000000) {
    ratingValue = chartConstant + 1.00 + Math.floor(Math.max(0, score - 1000000) / 100) * 0.01;
    ratingValue = Math.min(chartConstant + 1.50, ratingValue);
  } else if (score >= 975000) {
    ratingValue = chartConstant + 0.00 + Math.floor(Math.max(0, score - 975000) / 250) * 0.01;
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
  if (score >= 1007500 && ratingValue > chartConstant + 2.15) {
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
    else if (apiSong.const === 0) {
      if ((typeof apiSong.level === 'string' || typeof apiSong.level === 'number') && String(apiSong.level).trim() !== "") {
        const parsedLevel = parseFloat(String(apiSong.level));
        if (!isNaN(parsedLevel) && parsedLevel > 0) {
          const isInteger = parsedLevel % 1 === 0;
          const isXpoint5 = Math.abs((parsedLevel * 10) % 10) === 5;

          if (isInteger || isXpoint5) {
            effectiveChartConstant = parsedLevel;
          }
        }
      }
    }
    else if (effectiveChartConstant === null && (apiSong as ShowallApiSongEntry).is_const_unknown &&
             (typeof apiSong.level === 'string' || typeof apiSong.level === 'number') &&
             String(apiSong.level).trim() !== "") {
      const parsedLevel = parseFloat(String(apiSong.level));
      if (!isNaN(parsedLevel) && parsedLevel > 0) {
        effectiveChartConstant = parsedLevel;
      }
    }
  }

  let calculatedCurrentRating: number;
  if (typeof effectiveChartConstant === 'number' && effectiveChartConstant > 0 && score > 0) {
    calculatedCurrentRating = calculateChunithmSongRating(score, effectiveChartConstant);
  } else {
    calculatedCurrentRating = typeof apiSong.rating === 'number' ? apiSong.rating : 0;
  }
  const currentRating = parseFloat(calculatedCurrentRating.toFixed(4));

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
    if (b.currentScore !== a.currentScore) {
        return b.currentScore - a.currentScore;
    }
    const diffAOrder = difficultyOrder[a.diff.toUpperCase() as keyof typeof difficultyOrder] || 0;
    const diffBOrder = difficultyOrder[b.diff.toUpperCase() as keyof typeof difficultyOrder] || 0;
    return diffBOrder - diffAOrder;
  });
};

export const findMinScoreForTargetRating = (
  currentSong: Song,
  absoluteTargetRating: number,
  isLimitReleasedLocal: boolean
): { score: number; rating: number; possible: boolean } => {
  if (typeof currentSong.chartConstant !== 'number' || currentSong.chartConstant <= 0) {
    return { score: currentSong.currentScore, rating: currentSong.currentRating, possible: false };
  }

  const maxScore = isLimitReleasedLocal ? 1010000 : 1009000;

  if (currentSong.currentRating >= absoluteTargetRating && currentSong.currentScore > 0) {
      return { score: currentSong.currentScore, rating: currentSong.currentRating, possible: true };
  }

  const startingScore = currentSong.currentScore > 0 ? currentSong.currentScore + 1 : 1;

  for (let scoreAttempt = startingScore; scoreAttempt <= maxScore; scoreAttempt += 1) {
    const calculatedRating = calculateChunithmSongRating(scoreAttempt, currentSong.chartConstant);
    if (calculatedRating >= absoluteTargetRating) {
      return { score: scoreAttempt, rating: parseFloat(calculatedRating.toFixed(4)), possible: true };
    }
  }

  const ratingAtMaxScore = calculateChunithmSongRating(maxScore, currentSong.chartConstant);
  return { score: maxScore, rating: parseFloat(ratingAtMaxScore.toFixed(4)), possible: ratingAtMaxScore >= absoluteTargetRating };
};

export const getNextGradeBoundaryScore = (currentScore: number): number | null => {
    if (currentScore >= 1009000) return null;
    if (currentScore < 975000) return 975000;
    if (currentScore < 1000000) return 1000000;
    if (currentScore < 1005000) return 1005000;
    if (currentScore < 1007500) return 1007500;
    if (currentScore < 1009000) return 1009000;
    return null;
};

// Renamed function: Calculates average of an existing list and can compute overall rating based on fixed B30/N20 averages
export function calculateAverageAndOverallRating(
  songs: Song[],
  listLimit: number,
  propertyToConsiderForRating: 'currentRating' | 'targetRating' = 'currentRating',
  fixedB30Avg?: number | null,
  fixedN20Avg?: number | null,
  actualB30Count?: number,
  actualN20Count?: number
): { list: Song[], sum: number, average: number | null, overallAverage?: number } {
  let overallAverage: number | undefined = undefined;

  if (fixedB30Avg !== undefined && fixedN20Avg !== undefined && actualB30Count !== undefined && actualN20Count !== undefined) {
    const B30_COUNT_FOR_AVG = Math.min(30, actualB30Count);
    const N20_COUNT_FOR_AVG = Math.min(20, actualN20Count);
    const totalEffectiveSongs = B30_COUNT_FOR_AVG + N20_COUNT_FOR_AVG;

    if (totalEffectiveSongs > 0) {
      const sumB30 = (fixedB30Avg || 0) * B30_COUNT_FOR_AVG;
      const sumN20 = (fixedN20Avg || 0) * N20_COUNT_FOR_AVG;
      overallAverage = parseFloat(((sumB30 + sumN20) / totalEffectiveSongs).toFixed(4));
    } else {
      overallAverage = 0;
    }
  }

  const songsToConsider = songs.map(s => {
    const songToConsider = { ...s }; // Shallow copy
    const rating = songToConsider[propertyToConsiderForRating];
    return { ...songToConsider, ratingToUse: typeof rating === 'number' ? rating : 0 };
  });

  const sortedSongs = [...songsToConsider].sort((a, b) => b.ratingToUse - a.ratingToUse);
  const topSongs = sortedSongs.slice(0, listLimit);

  const sum = topSongs.reduce((acc, s_item) => acc + s_item.ratingToUse, 0);
  const average = topSongs.length > 0 ? parseFloat((sum / topSongs.length).toFixed(4)) : null;

  return { list: topSongs, sum, average, overallAverage };
}


// New function: Calculates theoretical max ratings for a list of candidates
export function calculateTheoreticalMaxRatingsForList(
  candidatePool: (Song | ShowallApiSongEntry)[],
  listLimit: number,
  scoreToAssume: number
): { list: Song[]; average: number | null; sum: number } {
  const maxedSongs: Song[] = candidatePool
    .map(s_item => {
      const songToConsider = ('currentScore' in s_item)
        ? { ...s_item } as Song // It's already a Song, create a shallow copy
        : mapApiSongToAppSong(s_item as ShowallApiSongEntry, 0, (s_item as ShowallApiSongEntry).const);

      if (!songToConsider.chartConstant) {
        return { ...songToConsider, targetRating: 0, targetScore: 0 }; // Keep original currentScore/Rating
      }
      const maxRating = calculateChunithmSongRating(scoreToAssume, songToConsider.chartConstant);
      return {
        ...songToConsider,
        targetScore: scoreToAssume,
        targetRating: parseFloat(maxRating.toFixed(4)),
      };
    })
    .filter(song => song.chartConstant !== null) // Ensure only songs with chartConstant are processed
    .sort((a, b) => b.targetRating - a.targetRating); // Sort by the new targetRating

  const topSongs = maxedSongs.slice(0, listLimit);

  if (topSongs.length === 0) {
    return { list: [], average: null, sum: 0 };
  }

  const sum = topSongs.reduce((acc, s_item) => acc + s_item.targetRating, 0);
  const average = parseFloat((sum / topSongs.length).toFixed(4));
  return { list: topSongs, average, sum };
}

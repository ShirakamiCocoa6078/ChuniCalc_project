
// src/lib/rating-utils.ts

import type { RatingApiSongEntry, ShowallApiSongEntry, Song } from "@/types/result-page";

export const difficultyOrder: { [key: string]: number } = {
  ULT: 5,
  MAS: 4,
  EXP: 3,
  ADV: 2,
  BAS: 1,
};

export const calculateChunithmSongRating = (score: number, chartConstant: number | undefined | null): number => {
  if (typeof chartConstant !== 'number' || chartConstant <= 0) {
    return 0;
  }

  let ratingValue = 0;

  if (score >= 1009000) { // SSS+
    ratingValue = chartConstant + 2.15;
  } else if (score >= 1007500) { // SSS
    ratingValue = chartConstant + 2.00 + Math.min(0.14, Math.floor(Math.max(0, score - 1007500) / 100) * 0.01);
  } else if (score >= 1005000) { // SS+
    ratingValue = chartConstant + 1.50 + Math.min(0.49, Math.floor(Math.max(0, score - 1005000) / 50) * 0.01);
  } else if (score >= 1000000) { // SS
    ratingValue = chartConstant + 1.00 + Math.min(0.49, Math.floor(Math.max(0, score - 1000000) / 100) * 0.01);
  } else if (score >= 990000) { // S+
    ratingValue = chartConstant + 0.60 + Math.min(0.39, Math.floor(Math.max(0, score - 990000) / 250) * 0.01);
  } else if (score >= 975000) { // S
    ratingValue = chartConstant + 0.00 + Math.min(0.59, Math.floor(Math.max(0, score - 975000) / 250) * 0.01);
  } else if (score >= 950000) { // AAA
    ratingValue = chartConstant - 1.50;
  } else if (score >= 925000) { // AA
    ratingValue = chartConstant - 3.00;
  } else if (score >= 900000) { // A
    ratingValue = chartConstant - 5.00;
  } else if (score >= 800000) { // BBB
    ratingValue = (chartConstant - 5.00) / 2.0;
  } else { // C and below
    ratingValue = 0;
  }

  return Math.max(0, parseFloat(ratingValue.toFixed(2)));
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
  const currentRating = calculatedCurrentRating;
  
  const targetScoreImprovementFactor = (1001000 - score > 0 && score > 0) ? (1001000 - score) / 10 : 10000;
  const targetScore = Math.max(score, Math.min(1001000, score + Math.floor(Math.random() * targetScoreImprovementFactor)));

  let targetRating: number;
  if (typeof effectiveChartConstant === 'number' && effectiveChartConstant > 0) {
    targetRating = calculateChunithmSongRating(targetScore, effectiveChartConstant);
  } else {
     targetRating = parseFloat(Math.max(currentRating, Math.min(17.85, currentRating + Math.random() * 0.2)).toFixed(2));
  }
  
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

// Helper function to find the minimum score to achieve a target rating
export const findMinScoreForTargetRating = (
  currentSong: Song,
  absoluteTargetRating: number,
  isLimitReleasedLocal: boolean
): { score: number; rating: number; possible: boolean } => {
  if (typeof currentSong.chartConstant !== 'number' || currentSong.chartConstant <= 0) {
    return { score: currentSong.currentScore, rating: currentSong.currentRating, possible: false };
  }

  const maxScore = isLimitReleasedLocal ? 1010000 : 1009000;
  
  // If current rating already meets target, score is current score
  if (currentSong.currentRating >= absoluteTargetRating && currentSong.currentScore > 0) { // Ensure score > 0 for played songs
      return { score: currentSong.currentScore, rating: currentSong.currentRating, possible: true };
  }

  // Iterate from current score + 1 (or 1 if current is 0) up to maxScore
  // If currentScore is 0, start checking from score 1.
  // Otherwise, start from currentScore + 1 (or smallest increment possible, e.g. 1 point)
  const startingScore = currentSong.currentScore > 0 ? currentSong.currentScore + 1 : 1;

  for (let scoreAttempt = startingScore; scoreAttempt <= maxScore; scoreAttempt += 1) { // Increment by 1 for fine-grained check
    const calculatedRating = calculateChunithmSongRating(scoreAttempt, currentSong.chartConstant);
    if (calculatedRating >= absoluteTargetRating) {
      return { score: scoreAttempt, rating: parseFloat(calculatedRating.toFixed(2)), possible: true };
    }
  }
  
  // If loop finishes, it means target rating wasn't reached even at maxScore
  const ratingAtMaxScore = calculateChunithmSongRating(maxScore, currentSong.chartConstant);
  return { score: maxScore, rating: parseFloat(ratingAtMaxScore.toFixed(2)), possible: ratingAtMaxScore >= absoluteTargetRating };
};

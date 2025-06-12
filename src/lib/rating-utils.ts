
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
    // 1007500 to 1008999: const + 2.00 to const + 2.14 (100점당 0.01, 총 1500점 = 0.15)
    // SSS (1,007,500점): 보면 정수 + 2.0
    // SSS (1,007,500) ~ SSS+ (1,009,000): 100점마다 레이팅 값 +0.01 (총 1500점 / 100점 = 15단계 * 0.01 = +0.15)
    ratingValue = chartConstant + 2.00 + Math.min(0.14, Math.floor(Math.max(0, score - 1007500) / 100) * 0.01);
  } else if (score >= 1005000) { // SS+
    // 1005000 to 1007499: const + 1.50 to const + 1.99 (50점당 0.01, 총 2500점 = 0.50)
    // SS+ (1,005,000점): 보면 정수 + 1.5
    // SS+ (1,005,000) ~ SSS (1,007,500): 50점마다 레이팅 값 +0.01 (총 2500점 / 50점 = 50단계 * 0.01 = +0.50)
    ratingValue = chartConstant + 1.50 + Math.min(0.49, Math.floor(Math.max(0, score - 1005000) / 50) * 0.01);
  } else if (score >= 1000000) { // SS
    // 1000000 to 1004999: const + 1.00 to const + 1.49 (100점당 0.01, 총 5000점 = 0.50)
    // SS (1,000,000점): 보면 정수 + 1.0
    // SS (1,000,000) ~ SS+ (1,005,000): 100점마다 레이팅 값 +0.01 (총 5000점 / 100점 = 50단계 * 0.01 = +0.50)
    ratingValue = chartConstant + 1.00 + Math.min(0.49, Math.floor(Math.max(0, score - 1000000) / 100) * 0.01);
  } else if (score >= 990000) { // S+
    // 990000 to 999999: const + 0.60 to const + 0.99 (250점당 0.01, 총 10000점 = 0.40)
    // S+ (990,000점): 보면 정수 + 0.6
    // S+ (990,000) ~ SS (1,000,000): 250점마다 레이팅 값 +0.01 (총 10000점 / 250점 = 40단계 * 0.01 = +0.40)
    ratingValue = chartConstant + 0.60 + Math.min(0.39, Math.floor(Math.max(0, score - 990000) / 250) * 0.01);
  } else if (score >= 975000) { // S
    // 975000 to 989999: const + 0.00 to const + 0.59 (250점당 0.01, 총 15000점 = 0.60)
    // S (975,000점): 보면 정수 + 0.0
    // S (975,000) ~ S+ (990,000): 250점마다 레이팅 값 +0.01 (총 15000점 / 250점 = 60단계 * 0.01 = +0.60)
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
    _index: number, // index might not be needed if not used for unique key generation here
    chartConstantOverride?: number // This override is primarily for rating_data.json best30 entries
): Song => {
  const score = typeof apiSong.score === 'number' ? apiSong.score : 0;

  let effectiveChartConstant: number | null = null;

  // Priority 1: chartConstantOverride if provided and valid
  if (typeof chartConstantOverride === 'number' && chartConstantOverride > 0) {
    effectiveChartConstant = chartConstantOverride;
  } else {
    // Priority 2: apiSong.const if it's a positive number
    if (typeof apiSong.const === 'number' && apiSong.const > 0) {
      effectiveChartConstant = apiSong.const;
    } 
    // Priority 3: apiSong.const is 0, use apiSong.level if it's an integer or x.5
    else if (apiSong.const === 0) {
      if ((typeof apiSong.level === 'string' || typeof apiSong.level === 'number') && String(apiSong.level).trim() !== "") {
        const parsedLevel = parseFloat(String(apiSong.level));
        if (!isNaN(parsedLevel) && parsedLevel > 0) {
          const isInteger = parsedLevel % 1 === 0;
          const isXpoint5 = Math.abs((parsedLevel * 10) % 10) === 5; // handles x.5

          if (isInteger || isXpoint5) {
            effectiveChartConstant = parsedLevel;
          }
        }
      }
    } 
    // Priority 4: Fallback for is_const_unknown (if const was not positive or 0, i.e., likely null or undefined)
    // This applies if effectiveChartConstant is still null at this point.
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
    // Fallback if no valid chart constant determined, use API's rating if available
    calculatedCurrentRating = typeof apiSong.rating === 'number' ? apiSong.rating : 0;
  }
  const currentRating = calculatedCurrentRating;

  // Placeholder target score/rating logic (from original code)
  // This will be replaced by the more detailed calculation logic later.
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
    targetScore: targetScore, // Placeholder, to be refined by specific calculation strategies
    targetRating: targetRating, // Placeholder
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

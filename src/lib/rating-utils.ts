
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

  if (score >= 1009000) { // SSS+
    ratingValue = chartConstant + 2.15;
  } else if (score >= 1007500) { // SSS
    // SSS (1007500) = 정수+2.0. SSS+ 직전 (1008999)까지 100점당 0.01 (최대 0.14)
    // (1008999 - 1007500) / 100 = 14.99 -> 14 increments of 0.01
    ratingValue = chartConstant + 2.00 + Math.min(0.14, Math.floor(Math.max(0, score - 1007500) / 100) * 0.01);
  } else if (score >= 1005000) { // SS+
    // SS+ (1005000) = 정수+1.5. SSS 직전 (1007499)까지 50점당 0.01 (최대 0.49)
    // (1007499 - 1005000) / 50 = 49.98 -> 49 increments of 0.01
    ratingValue = chartConstant + 1.50 + Math.min(0.49, Math.floor(Math.max(0, score - 1005000) / 50) * 0.01);
  } else if (score >= 1000000) { // SS
    // SS (1000000) = 정수+1.0. SS+ 직전 (1004999)까지 100점당 0.01 (최대 0.49)
    // (1004999 - 1000000) / 100 = 49.99 -> 49 increments of 0.01
    ratingValue = chartConstant + 1.00 + Math.min(0.49, Math.floor(Math.max(0, score - 1000000) / 100) * 0.01);
  } else if (score >= 975000) { // S
    // S (975000) = 정수+0.0. SS 직전 (999999)까지 250점당 0.01 (최대 0.59 -> S에서 SS까지 1.0이므로, 이 구간은 1.0/ ( (1000000-975000)/250 ) = 1.0/100 = 0.01이 아님.
    // S~SS 구간의 레이팅 증가폭은 1.0. 점수 구간은 25000점. 25000/250 = 100개의 스텝. 각 스텝당 +0.01. 총 +1.00.
    // SSS (2.0) - SS+(1.5) = 0.5, SS+(1.5)-SS(1.0)=0.5, SS(1.0)-S(0.0)=1.0
    // SSS+ (2.15)
    // SSS (1,007,500) 정수 + 2.00. SSS+까지 1499점. 1400점까지 100점당 0.01 -> 0.14. 즉 2.14
    // 1009000점일 때 +2.15 이므로, SSS->SSS+ 구간은 0.15 상승.
    // 1,007,500 ~ 1,008,999: 100점당 +0.01 (최대 +0.15까지 가능해야 함). 1499점. 14개 스텝. 0.14.
    // 1,008,900 ~ 1,008,999 에서 2.14, 1,009,000에서 2.15. 이 마지막 100점 구간에서 0.01이 추가됨.
    // 수정: SSS (1,007,500) ~ SSS+ (1,009,000점 미만) : 100점당 +0.01. 총 1500점차. 15스텝. 최대 +0.15. (2.00 ~ 2.15)
    // 수정: SS+ (1,005,000) ~ SSS (1,007,500점 미만) : 50점당 +0.01. 총 2500점차. 50스텝. 최대 +0.50. (1.50 ~ 2.00)
    // 수정: SS (1,000,000) ~ SS+ (1,005,000점 미만) : 100점당 +0.01. 총 5000점차. 50스텝. 최대 +0.50. (1.00 ~ 1.50)
    // 수정: S (975,000) ~ SS (1,000,000점 미만) : 250점당 +0.01. 총 25000점차. 100스텝. 최대 +1.00. (0.00 ~ 1.00)

    // 새로운 보간 규칙 적용
    if (score >= 1007500) { // SSS to SSS+
        ratingValue = chartConstant + 2.00 + Math.floor(Math.max(0, score - 1007500) / 100) * 0.01;
         if (score >= 1009000) ratingValue = chartConstant + 2.15; // Cap at SSS+
         else ratingValue = Math.min(chartConstant + 2.15, ratingValue);
    } else if (score >= 1005000) { // SS+ to SSS
        ratingValue = chartConstant + 1.50 + Math.floor(Math.max(0, score - 1005000) / 50) * 0.01;
        ratingValue = Math.min(chartConstant + 2.00, ratingValue); // Cap at SSS
    } else if (score >= 1000000) { // SS to SS+
        ratingValue = chartConstant + 1.00 + Math.floor(Math.max(0, score - 1000000) / 100) * 0.01;
        ratingValue = Math.min(chartConstant + 1.50, ratingValue); // Cap at SS+
    } else if (score >= 975000) { // S to SS
        ratingValue = chartConstant + 0.00 + Math.floor(Math.max(0, score - 975000) / 250) * 0.01;
        ratingValue = Math.min(chartConstant + 1.00, ratingValue); // Cap at SS
    }

  // 기존 AAA 이하 구간은 유지
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
  // 최종적으로 SSS+ 값을 넘지 않도록 한 번 더 확인 (보간 중 +2.15를 초과하는 경우 방지)
  if (score >= 1007500 && ratingValue > chartConstant + 2.15) {
    ratingValue = chartConstant + 2.15;
  }


  return Math.max(0, parseFloat(ratingValue.toFixed(4))); // 소수점 4자리까지 정밀도 유지
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
  const currentRating = parseFloat(calculatedCurrentRating.toFixed(4)); // 소수점 4자리
  
  // 초기 targetScore, targetRating은 current와 동일하게 설정. 시뮬레이션 과정에서 변경됨.
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

// 다음 등급 경계 점수를 찾는 함수 (과제 1-2용)
export const getNextGradeBoundaryScore = (currentScore: number): number | null => {
    if (currentScore >= 1009000) return null; // 이미 최고 등급이거나 그 이상
    if (currentScore < 975000) return 975000;  // S
    if (currentScore < 1000000) return 1000000; // SS
    if (currentScore < 1005000) return 1005000; // SS+
    if (currentScore < 1007500) return 1007500; // SSS
    if (currentScore < 1009000) return 1009000; // SSS+
    return null;
};

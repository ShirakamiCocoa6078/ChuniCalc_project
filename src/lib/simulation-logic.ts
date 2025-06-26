// src/lib/simulation-logic.ts

import type {
  Song,
  ShowallApiSongEntry,
  SimulationInput,
  SimulationOutput,
  SimulationPhase,
  ConstOverride,
} from '@/types/result-page';

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;
const MAX_SCORE_NORMAL = 1009000; // SSS+
const MAX_ITERATIONS_PER_LIST = 200;
const MAX_ITERATIONS_HYBRID = 400;

const difficultyOrder: { [key: string]: number } = {
  ULT: 5, MAS: 4, EXP: 3, ADV: 2, BAS: 1,
};

const calculateChunithmSongRating = (score: number, chartConstant: number | undefined | null): number => {
  if (typeof chartConstant !== 'number' || chartConstant <= 0) return 0;
  let ratingValue = 0;
  if (score >= 1009000) ratingValue = chartConstant + 2.15;
  else if (score >= 1007500) {
    ratingValue = chartConstant + 2.00 + Math.floor(Math.max(0, score - 1007500) / 100) * 0.01;
    ratingValue = Math.min(chartConstant + 2.15, ratingValue);
  } else if (score >= 1005000) {
    ratingValue = chartConstant + 1.50 + Math.floor(Math.max(0, score - 1005000) / 50) * 0.01;
    ratingValue = Math.min(chartConstant + 2.00, ratingValue);
  } else if (score >= 1000000) {
    ratingValue = chartConstant + 1.00 + Math.floor(Math.max(0, score - 1000000) / 100) * 0.01;
    ratingValue = Math.min(chartConstant + 1.50, ratingValue);
  } else if (score >= 975000) {
    ratingValue = chartConstant + 0.00 + Math.floor(Math.max(0, score - 975000) / 250) * 0.01;
    ratingValue = Math.min(chartConstant + 1.00, ratingValue);
  } else if (score >= 950000) ratingValue = chartConstant - 1.50;
  else if (score >= 925000) ratingValue = chartConstant - 3.00;
  else if (score >= 900000) ratingValue = chartConstant - 5.00;
  else if (score >= 800000) ratingValue = (chartConstant - 5.00) / 2.0;
  else ratingValue = 0;
  if (score >= 1007500 && ratingValue > chartConstant + 2.15) ratingValue = chartConstant + 2.15;
  return Math.max(0, parseFloat(ratingValue.toFixed(4)));
};

const mapApiSongToAppSong = (apiSong: ShowallApiSongEntry, _index: number, chartConstantOverride?: number): Song => {
  const score = typeof apiSong.score === 'number' ? apiSong.score : 0;
  let effectiveChartConstant: number | null = null;
  if (typeof chartConstantOverride === 'number' && chartConstantOverride > 0) effectiveChartConstant = chartConstantOverride;
  else {
    if (typeof apiSong.const === 'number' && apiSong.const > 0) effectiveChartConstant = apiSong.const;
    else if (apiSong.const === 0) {
      if ((typeof apiSong.level === 'string' || typeof apiSong.level === 'number') && String(apiSong.level).trim() !== "") {
        const parsedLevel = parseFloat(String(apiSong.level));
        if (!isNaN(parsedLevel) && parsedLevel > 0) {
          const isInteger = parsedLevel % 1 === 0;
          const isXpoint5 = Math.abs((parsedLevel * 10) % 10) === 5;
          if (isInteger || isXpoint5) effectiveChartConstant = parsedLevel;
        }
      }
    } else if (effectiveChartConstant === null && apiSong.is_const_unknown &&
             (typeof apiSong.level === 'string' || typeof apiSong.level === 'number') && String(apiSong.level).trim() !== "") {
      const parsedLevel = parseFloat(String(apiSong.level));
      if (!isNaN(parsedLevel) && parsedLevel > 0) effectiveChartConstant = parsedLevel;
    }
  }
  let calculatedCurrentRating: number;
  if (typeof effectiveChartConstant === 'number' && effectiveChartConstant > 0 && score > 0) calculatedCurrentRating = calculateChunithmSongRating(score, effectiveChartConstant);
  else calculatedCurrentRating = typeof apiSong.rating === 'number' ? apiSong.rating : 0;
  const currentRating = parseFloat(calculatedCurrentRating.toFixed(4));
  const baseSong: Song = {
    id: apiSong.id, diff: apiSong.diff, title: apiSong.title, chartConstant: effectiveChartConstant,
    currentScore: score, currentRating: currentRating, targetScore: score, targetRating: currentRating,
    genre: apiSong.genre, level: apiSong.level,
  };
  if ('release' in apiSong) baseSong.release = apiSong.release;
  if ('is_played' in apiSong) baseSong.is_played = apiSong.is_played;
  if ('is_clear' in apiSong) baseSong.is_clear = apiSong.is_clear;
  if ('is_fullcombo' in apiSong) baseSong.is_fullcombo = apiSong.is_fullcombo;
  if ('is_alljustice' in apiSong) baseSong.is_alljustice = apiSong.is_alljustice;
  if ('is_const_unknown' in apiSong) baseSong.is_const_unknown = apiSong.is_const_unknown;
  return baseSong;
};

const findMinScoreForTargetRating = (currentSong: Song, absoluteTargetRating: number, isLimitReleasedLocal: boolean): { score: number; rating: number; possible: boolean } => {
  if (typeof currentSong.chartConstant !== 'number' || currentSong.chartConstant <= 0) return { score: currentSong.currentScore, rating: currentSong.currentRating, possible: false };
  const maxScore = isLimitReleasedLocal ? 1010000 : MAX_SCORE_NORMAL;
  if (currentSong.currentRating >= absoluteTargetRating && currentSong.currentScore > 0) return { score: currentSong.currentScore, rating: currentSong.currentRating, possible: true };
  const startingScore = currentSong.currentScore > 0 ? currentSong.currentScore + 1 : 1;
  for (let scoreAttempt = startingScore; scoreAttempt <= maxScore; scoreAttempt += 1) {
    const calculatedRating = calculateChunithmSongRating(scoreAttempt, currentSong.chartConstant);
    if (calculatedRating >= absoluteTargetRating) return { score: scoreAttempt, rating: parseFloat(calculatedRating.toFixed(4)), possible: true };
  }
  const ratingAtMaxScore = calculateChunithmSongRating(maxScore, currentSong.chartConstant);
  return { score: maxScore, rating: parseFloat(ratingAtMaxScore.toFixed(4)), possible: ratingAtMaxScore >= absoluteTargetRating };
};

const getNextGradeBoundaryScore = (currentScore: number): number | null => {
    if (currentScore >= 1009000) return null;
    if (currentScore < 975000) return 975000;
    if (currentScore < 1000000) return 1000000;
    if (currentScore < 1005000) return 1005000;
    if (currentScore < 1007500) return 1007500;
    if (currentScore < 1009000) return 1009000;
    return null;
};

const isSongHighConstantForFloor = (song: Song, currentOverallAverageRatingForList: number | null): boolean => {
  if (!song.chartConstant || currentOverallAverageRatingForList === null) return false;
  const thresholdBase = currentOverallAverageRatingForList - 1.8;
  const threshold = Math.floor(thresholdBase * 10) / 10;
  return song.chartConstant > threshold;
};

function deduplicateSongList(songs: Song[]): Song[] {
  const songMap = new Map<string, Song>();
  for (const song of songs) {
    const key = `${song.id}_${song.diff}`;
    const existingSong = songMap.get(key);
    if (
      !existingSong ||
      song.targetRating > existingSong.targetRating ||
      (song.targetRating === existingSong.targetRating && song.targetScore > existingSong.targetScore)
    ) {
      songMap.set(key, song);
    }
  }
  return Array.from(songMap.values());
}

function sortAndSlice(songs: Song[], limit: number): Song[] {
    const songsToSort = songs.map(s => ({ ...s }));
    songsToSort.sort((a, b) => {
        if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating;
        if (b.targetScore !== a.targetScore) return b.targetScore - a.targetScore;
        const diffAOrderVal = difficultyOrder[String(a.diff || '').toUpperCase() as keyof typeof difficultyOrder] || 0;
        const diffBOrderVal = difficultyOrder[String(b.diff || '').toUpperCase() as keyof typeof difficultyOrder] || 0;
        if (diffBOrderVal !== diffAOrderVal) return diffBOrderVal - diffAOrderVal;
        return (a.title || '').localeCompare(b.title || '');
    });
    return songsToSort.slice(0, limit);
}

function calculateAverageRating(songs: Song[], count: number, isSimulatingThisList: boolean): number | null {
  if (!songs || songs.length === 0) return null;
  const songsForAverage = songs.map(s => ({
      ...s,
      ratingToConsider: isSimulatingThisList ? s.targetRating : s.currentRating
  }));
  const topSongs = [...songsForAverage].sort((a, b) => b.ratingToConsider - a.ratingToConsider).slice(0, count);
  if (topSongs.length === 0) return 0;
  const sum = topSongs.reduce((acc, s) => acc + s.ratingToConsider, 0);
  return parseFloat((sum / topSongs.length).toFixed(4));
}

function calculateOverallRating(avgB30: number | null, avgN20: number | null, actualB30Count: number, actualN20Count: number): number {
  const effectiveB30Count = Math.min(actualB30Count, BEST_COUNT);
  const b30Sum = (avgB30 ?? 0) * effectiveB30Count;
  const effectiveN20Count = Math.min(actualN20Count, NEW_20_COUNT);
  const n20Sum = (avgN20 ?? 0) * effectiveN20Count;
  const totalEffectiveSongs = effectiveB30Count + effectiveN20Count;
  if (totalEffectiveSongs === 0) return 0;
  return parseFloat(((b30Sum + n20Sum) / totalEffectiveSongs).toFixed(4));
}

function _performListSimulationPhase(
  currentSongsInput: Song[],
  input: SimulationInput,
  log: string[],
  listType: 'b30' | 'n20',
  currentAverageForList: number | null,
  otherListSongs: Song[] = [],
  isHybridReplaceContext: boolean = false
): { updatedSongs: Song[]; songsChangedCount: number; stuck: boolean } {
  let updatedSongs = JSON.parse(JSON.stringify(currentSongsInput)) as Song[];
  let songsChangedCount = 0;
  let phaseIsStuck = true;

  const listName = listType === 'b30' ? "B30" : "N20";
  const listLimit = listType === 'b30' ? BEST_COUNT : NEW_20_COUNT;
  const scoreCap = input.isScoreLimitReleased ? 1010000 : MAX_SCORE_NORMAL;

  let updatableSongsForLeap = updatedSongs.filter(song => !song.isExcludedFromImprovement && song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);
  if (input.algorithmPreference === 'floor') {
    updatableSongsForLeap.sort((a, b) => {
      const aIsHighConst = isSongHighConstantForFloor(a, currentAverageForList);
      const bIsHighConst = isSongHighConstantForFloor(b, currentAverageForList);
      if (aIsHighConst !== bIsHighConst) return aIsHighConst ? 1 : -1;
      const constA = a.chartConstant ?? Infinity; const constB = b.chartConstant ?? Infinity;
      if (constA !== constB) return constA - constB;
      if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating;
      return a.targetScore - b.targetScore;
    });
  } else {
    updatableSongsForLeap.sort((a, b) => {
      if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating;
      return b.targetScore - b.targetScore;
    });
  }

  if (updatableSongsForLeap.length > 0) {
    const songToAttemptLeap = updatableSongsForLeap[0];
    const nextGradeScore = getNextGradeBoundaryScore(songToAttemptLeap.targetScore);
    if (nextGradeScore && songToAttemptLeap.chartConstant && songToAttemptLeap.targetScore < nextGradeScore && nextGradeScore <= scoreCap) {
      const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, songToAttemptLeap.chartConstant);
      if (potentialRatingAtNextGrade > songToAttemptLeap.targetRating + 0.00005) {
        const songIndex = updatedSongs.findIndex(s => s.id === songToAttemptLeap.id && s.diff === songToAttemptLeap.diff);
        if (songIndex !== -1) {
          updatedSongs[songIndex] = { ...songToAttemptLeap, targetScore: nextGradeScore, targetRating: parseFloat(potentialRatingAtNextGrade.toFixed(4)) };
          songsChangedCount++; phaseIsStuck = false;
          return { updatedSongs: sortAndSlice(deduplicateSongList(updatedSongs), listLimit), songsChangedCount, stuck: phaseIsStuck };
        }
      }
    }
  }

  let updatableSongsForFineTune = updatedSongs.filter(song => !song.isExcludedFromImprovement && song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);
    if (input.algorithmPreference === 'floor') {
        updatableSongsForFineTune.sort((a, b) => {
            const aIsHighConst = isSongHighConstantForFloor(a, currentAverageForList);
            const bIsHighConst = isSongHighConstantForFloor(b, currentAverageForList);
            if (aIsHighConst !== bIsHighConst) return aIsHighConst ? 1 : -1;
            const constA = a.chartConstant ?? Infinity; const constB = b.chartConstant ?? Infinity;
            if (constA !== constB) return constA - constB;
            if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating;
            return a.targetScore - b.targetScore;
        });
    } else {
        updatableSongsForFineTune.sort((a, b) => {
            if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating;
            return b.targetScore - b.targetScore;
        });
    }

  if (updatableSongsForFineTune.length > 0) {
    for (const candidateSong of updatableSongsForFineTune) {
        const songIndex = updatedSongs.findIndex(s => s.id === candidateSong.id && s.diff === candidateSong.diff);
        if (songIndex === -1) continue;
        let currentSongInSim = updatedSongs[songIndex];
        if (currentSongInSim.targetScore < scoreCap && currentSongInSim.chartConstant) {
            const targetMicroTuneRating = currentSongInSim.targetRating + 0.0001;
            const minScoreInfo = findMinScoreForTargetRating(currentSongInSim, targetMicroTuneRating, input.isScoreLimitReleased);
            if (minScoreInfo.possible && minScoreInfo.score > currentSongInSim.targetScore && minScoreInfo.score <= scoreCap) {
                updatedSongs[songIndex] = { ...currentSongInSim, targetScore: minScoreInfo.score, targetRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
                songsChangedCount++; phaseIsStuck = false;
                return { updatedSongs: sortAndSlice(deduplicateSongList(updatedSongs), listLimit), songsChangedCount, stuck: phaseIsStuck };
            }
        }
    }
  }

  let songToReplace: Song | undefined = undefined;
  if (updatedSongs.length >= listLimit) {
      songToReplace = [...updatedSongs].sort((a, b) => a.targetRating - b.targetRating)[0];
  } else if (listType === 'n20' && updatedSongs.length < listLimit) {
      const currentN20IdsAndDiffs = new Set(updatedSongs.map(s => `${s.id}_${s.diff}`));
      const potentialAdditions = input.allPlayedNewSongsPool
          .filter(poolSong => {
            const songKey = `${poolSong.id}_${poolSong.diff.toUpperCase()}`;
            return !currentN20IdsAndDiffs.has(songKey) && 
                   !otherListSongs.some(ols => ols.id === poolSong.id && ols.diff.toUpperCase() === poolSong.diff.toUpperCase()) &&
                   !input.excludedSongKeys.has(songKey);
          })
          .sort((a,b) => b.currentRating - a.currentRating);
      if (potentialAdditions.length > 0) {
          const songToAdd = potentialAdditions[0];
          if (!songToReplace || songToAdd.currentRating > songToReplace.targetRating) {
            updatedSongs.push({...songToAdd, targetScore: songToAdd.currentScore, targetRating: songToAdd.currentRating, isExcludedFromImprovement: false });
            songsChangedCount++; phaseIsStuck = false;
            return { updatedSongs: sortAndSlice(deduplicateSongList(updatedSongs), listLimit), songsChangedCount, stuck: phaseIsStuck };
          }
      }
  }

  if (!songToReplace) {
      return { updatedSongs: sortAndSlice(deduplicateSongList(updatedSongs), listLimit), songsChangedCount, stuck: phaseIsStuck };
  }

  let replacementSourcePool: (Song | ShowallApiSongEntry)[] = [];
  const currentSimulatedIdsAndDiffs = new Set(updatedSongs.map(s => `${s.id}_${s.diff.toUpperCase()}`));
  const otherListIdsAndDiffs = new Set(otherListSongs.map(s => `${s.id}_${s.diff.toUpperCase()}`));

  if (listType === 'b30') {
    replacementSourcePool = input.allMusicData
      .filter(globalSong => {
        if (!globalSong.id || !globalSong.diff || !globalSong.title) return false;
        const globalSongKey = `${globalSong.id}_${globalSong.diff.toUpperCase()}`;
        if (input.excludedSongKeys.has(globalSongKey)) return false;
        if (currentSimulatedIdsAndDiffs.has(globalSongKey)) return false;
        if (isHybridReplaceContext && otherListIdsAndDiffs.has(globalSongKey)) return false;
        const isNewSongByName = input.newSongsDataTitlesVerse.some(title => title.trim().toLowerCase() === globalSong.title.trim().toLowerCase());
        if (isNewSongByName) return false;
        const tempSongObj = mapApiSongToAppSong(globalSong, 0, globalSong.const);
        if (!tempSongObj.chartConstant) return false;
        const potentialMaxRating = calculateChunithmSongRating(scoreCap, tempSongObj.chartConstant);
        return potentialMaxRating > songToReplace!.targetRating + 0.00005;
      })
      .map(apiEntry => {
        const playedVersion = input.userPlayHistory.find(p => p.id === apiEntry.id && p.diff.toUpperCase() === apiEntry.diff.toUpperCase());
        return mapApiSongToAppSong(playedVersion || { ...apiEntry, score: 0, rating: 0 }, 0, apiEntry.const);
      })
      .filter(song => song.chartConstant !== null);
  } else { // listType === 'n20'
    replacementSourcePool = input.allPlayedNewSongsPool
      .filter(poolSong => {
          const poolSongKey = `${poolSong.id}_${poolSong.diff.toUpperCase()}`;
          if (input.excludedSongKeys.has(poolSongKey)) return false;
          if (currentSimulatedIdsAndDiffs.has(poolSongKey)) return false;
          if (isHybridReplaceContext && otherListIdsAndDiffs.has(poolSongKey)) return false;
          if (!poolSong.chartConstant) return false;
          const potentialMaxRating = calculateChunithmSongRating(scoreCap, poolSong.chartConstant);
          return Math.max(poolSong.currentRating, potentialMaxRating) > songToReplace!.targetRating + 0.00005;
      });
  }

  let bestCandidateForReplacement: (Song & { neededScore: number; resultingRating: number }) | null = null;
  let minEffort = Infinity;

  for (const candidate of replacementSourcePool) {
    if (!candidate.chartConstant) continue;
    const targetRatingForCandidate = songToReplace.targetRating + 0.0001;
    const minScoreInfo = findMinScoreForTargetRating(candidate, targetRatingForCandidate, input.isScoreLimitReleased);
    if (minScoreInfo.possible && minScoreInfo.score <= scoreCap) {
      const effort = candidate.currentScore > 0 ? (minScoreInfo.score - candidate.currentScore) : (minScoreInfo.score + 1000000);
      let updateBestCandidate = false;
      if (bestCandidateForReplacement === null || effort < minEffort) {
        updateBestCandidate = true;
      } else if (effort === minEffort) {
        if (input.algorithmPreference === 'floor') {
          if ((candidate.chartConstant ?? Infinity) < (bestCandidateForReplacement.chartConstant ?? Infinity)) updateBestCandidate = true;
        } else {
          if (minScoreInfo.rating > bestCandidateForReplacement.resultingRating) updateBestCandidate = true;
        }
      }
      if (updateBestCandidate) {
        minEffort = effort;
        bestCandidateForReplacement = { ...candidate, neededScore: minScoreInfo.score, resultingRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
      }
    }
  }

  if (bestCandidateForReplacement) {
    updatedSongs = updatedSongs.filter(s => !(s.id === songToReplace!.id && s.diff === songToReplace!.diff));
    updatedSongs.push({
      ...bestCandidateForReplacement,
      targetScore: bestCandidateForReplacement.neededScore,
      targetRating: bestCandidateForReplacement.resultingRating,
      isExcludedFromImprovement: false,
    });
    songsChangedCount++; phaseIsStuck = false;
    return { updatedSongs: sortAndSlice(deduplicateSongList(updatedSongs), listLimit), songsChangedCount, stuck: phaseIsStuck };
  }

  return { updatedSongs: sortAndSlice(deduplicateSongList(updatedSongs), listLimit), songsChangedCount, stuck: phaseIsStuck };
}

export function runFullSimulation(input: SimulationInput): SimulationOutput {
  const log: string[] = [];
  log.push(`[WORKER_RUN_SIMULATION_START] Target: ${input.targetRating.toFixed(4)}, Mode: ${input.simulationMode}, Preference: ${input.algorithmPreference}, Current Rating: ${input.currentRating.toFixed(4)}, Excluded: ${input.excludedSongKeys.size}`);

  let currentSimulatedB30Songs: Song[];
  let currentSimulatedNew20Songs: Song[];
  const scoreCap = input.isScoreLimitReleased ? 1010000 : MAX_SCORE_NORMAL;

  const initializeSongList = (songs: Song[], listName: string): Song[] => {
    return JSON.parse(JSON.stringify(songs)).map((s: Song) => {
      const songKey = `${s.id}_${s.diff}`;
      if (input.excludedSongKeys.has(songKey)) {
        log.push(`[WORKER_INIT_EXCLUDE] Song ${s.title} (${s.diff}) in ${listName} is excluded. Fixing score to ${s.currentScore}.`);
        return { ...s, targetScore: s.currentScore, targetRating: s.currentRating, isExcludedFromImprovement: true, };
      }
      return { ...s, isExcludedFromImprovement: false };
    });
  };

  if (input.simulationMode === "b30_only") {
    currentSimulatedB30Songs = initializeSongList(input.originalB30Songs, "B30");
    currentSimulatedNew20Songs = initializeSongList(input.originalNew20Songs.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating })), "N20 (fixed)");
  } else if (input.simulationMode === "n20_only") {
    currentSimulatedB30Songs = initializeSongList(input.originalB30Songs.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating })), "B30 (fixed)");
    currentSimulatedNew20Songs = initializeSongList(input.originalNew20Songs, "N20");
  } else { // hybrid mode
    currentSimulatedB30Songs = initializeSongList(input.originalB30Songs, "B30");
    currentSimulatedNew20Songs = initializeSongList(input.originalNew20Songs, "N20");
  }

  let currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, input.simulationMode !== "n20_only");
  let currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, input.simulationMode !== "b30_only");
  let currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
  log.push(`[WORKER_INITIAL_STATE] B30 Avg: ${currentAverageB30Rating?.toFixed(4) || 'N/A'}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4) || 'N/A'}, Overall: ${currentOverallRating.toFixed(4)}`);
  let finalOutcomePhase: SimulationPhase = 'simulating';

  if (input.simulationMode === "b30_only") {
    let b30Stuck = false; let b30Iterations = 0;
    while (currentOverallRating < input.targetRating && !b30Stuck && b30Iterations < MAX_ITERATIONS_PER_LIST) {
      b30Iterations++; const previousOverallRatingForCycle = currentOverallRating;
      const result = _performListSimulationPhase(currentSimulatedB30Songs, input, log, 'b30', currentAverageB30Rating, currentSimulatedNew20Songs);
      currentSimulatedB30Songs = result.updatedSongs; b30Stuck = result.stuck;
      currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
      if (b30Stuck || Math.abs(currentOverallRating - previousOverallRatingForCycle) < 0.00001) { b30Stuck = true; }
    }
    if (b30Iterations >= MAX_ITERATIONS_PER_LIST && currentOverallRating < input.targetRating) b30Stuck = true;
    if (finalOutcomePhase !== 'target_reached') finalOutcomePhase = b30Stuck ? 'stuck_b30_no_improvement' : 'simulating';
  }
  else if (input.simulationMode === "n20_only") {
    let n20Stuck = false; let n20Iterations = 0;
    while (currentOverallRating < input.targetRating && !n20Stuck && n20Iterations < MAX_ITERATIONS_PER_LIST) {
      n20Iterations++; const previousOverallRatingForCycle = currentOverallRating;
      const result = _performListSimulationPhase(currentSimulatedNew20Songs, input, log, 'n20', currentAverageNew20Rating, currentSimulatedB30Songs);
      currentSimulatedNew20Songs = result.updatedSongs; n20Stuck = result.stuck;
      currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
      if (n20Stuck || Math.abs(currentOverallRating - previousOverallRatingForCycle) < 0.00001) { n20Stuck = true; }
    }
    if (n20Iterations >= MAX_ITERATIONS_PER_LIST && currentOverallRating < input.targetRating) n20Stuck = true;
    if (finalOutcomePhase !== 'target_reached') finalOutcomePhase = n20Stuck ? 'stuck_n20_no_improvement' : 'simulating';
  }
  else if (input.simulationMode === "hybrid" && finalOutcomePhase !== 'target_reached' && currentOverallRating < input.targetRating) {
    let hybridIterations = 0; let hybridStuck = false;
    while (currentOverallRating < input.targetRating && !hybridStuck && hybridIterations < MAX_ITERATIONS_HYBRID) {
        hybridIterations++; const previousOverallRatingForHybridCycle = currentOverallRating;
        let songsChangedThisIteration = false;
        let globalCandidates: (Song & { listOrigin: 'b30' | 'n20' })[] = [];
        currentSimulatedB30Songs.forEach(s => { if (s.targetScore < scoreCap && s.chartConstant && s.chartConstant > 0 && !s.isExcludedFromImprovement) globalCandidates.push({ ...JSON.parse(JSON.stringify(s)), listOrigin: 'b30' }); });
        currentSimulatedNew20Songs.forEach(s => { if (s.targetScore < scoreCap && s.chartConstant && s.chartConstant > 0 && !s.isExcludedFromImprovement) globalCandidates.push({ ...JSON.parse(JSON.stringify(s)), listOrigin: 'n20' }); });
        globalCandidates = globalCandidates.filter(c => {
            const nextPossibleScore = getNextGradeBoundaryScore(c.targetScore);
            if (nextPossibleScore && c.chartConstant && nextPossibleScore <= scoreCap) { const potentialRating = calculateChunithmSongRating(nextPossibleScore, c.chartConstant); if (potentialRating > c.targetRating + 0.00005) return true; }
            const fineTunePotential = findMinScoreForTargetRating(c, c.targetRating + 0.0001, input.isScoreLimitReleased);
            if (fineTunePotential.possible && fineTunePotential.score > c.targetScore && fineTunePotential.score <= scoreCap) return true;
            return false;
        });
        if (globalCandidates.length > 0) {
            if (input.algorithmPreference === 'floor') globalCandidates.sort((a, b) => { const aIsHigh = isSongHighConstantForFloor(a, a.listOrigin === 'b30' ? currentAverageB30Rating : currentAverageNew20Rating); const bIsHigh = isSongHighConstantForFloor(b, b.listOrigin === 'b30' ? currentAverageB30Rating : currentAverageNew20Rating); if (aIsHigh !== bIsHigh) return aIsHigh ? 1 : -1; const constA = a.chartConstant ?? Infinity; const constB = b.chartConstant ?? Infinity; if (constA !== constB) return constA - constB; if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating; return a.targetScore - b.targetScore; });
            else globalCandidates.sort((a, b) => { if (b.targetRating !== a.targetRating) return b.targetRating - b.targetRating; if (b.targetScore !== a.targetScore) return b.targetScore - a.targetScore; const constA = a.chartConstant ?? 0; const constB = b.chartConstant ?? 0; return constB - constA; });
            const topCandidate = globalCandidates[0];
            if (topCandidate) {
                const nextGradeScore = getNextGradeBoundaryScore(topCandidate.targetScore);
                if (nextGradeScore && topCandidate.chartConstant && topCandidate.targetScore < nextGradeScore && nextGradeScore <= scoreCap) {
                    const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, topCandidate.chartConstant);
                    if (potentialRatingAtNextGrade > topCandidate.targetRating + 0.00005) {
                        if (topCandidate.listOrigin === 'b30') { const songIndex = currentSimulatedB30Songs.findIndex(s => s.id === topCandidate.id && s.diff === topCandidate.diff); if (songIndex !== -1) { currentSimulatedB30Songs[songIndex].targetScore = nextGradeScore; currentSimulatedB30Songs[songIndex].targetRating = parseFloat(potentialRatingAtNextGrade.toFixed(4)); songsChangedThisIteration = true; }}
                        else { const songIndex = currentSimulatedNew20Songs.findIndex(s => s.id === topCandidate.id && s.diff === topCandidate.diff); if (songIndex !== -1) { currentSimulatedNew20Songs[songIndex].targetScore = nextGradeScore; currentSimulatedNew20Songs[songIndex].targetRating = parseFloat(potentialRatingAtNextGrade.toFixed(4)); songsChangedThisIteration = true; }}
                    }
                }
            }
        }
        if (!songsChangedThisIteration && globalCandidates.length > 0) {
            const candidateForFineTune = globalCandidates[0];
            if (candidateForFineTune.targetScore < scoreCap && candidateForFineTune.chartConstant) {
                const targetMicroTuneRating = candidateForFineTune.targetRating + 0.0001;
                const minScoreInfo = findMinScoreForTargetRating(candidateForFineTune, targetMicroTuneRating, input.isScoreLimitReleased);
                if (minScoreInfo.possible && minScoreInfo.score > candidateForFineTune.targetScore && minScoreInfo.score <= scoreCap) {
                    if (candidateForFineTune.listOrigin === 'b30') { const songIndex = currentSimulatedB30Songs.findIndex(s => s.id === candidateForFineTune.id && s.diff === candidateForFineTune.diff); if (songIndex !== -1) { currentSimulatedB30Songs[songIndex].targetScore = minScoreInfo.score; currentSimulatedB30Songs[songIndex].targetRating = parseFloat(minScoreInfo.rating.toFixed(4)); songsChangedThisIteration = true; }}
                    else { const songIndex = currentSimulatedNew20Songs.findIndex(s => s.id === candidateForFineTune.id && s.diff === candidateForFineTune.diff); if (songIndex !== -1) { currentSimulatedNew20Songs[songIndex].targetScore = minScoreInfo.score; currentSimulatedNew20Songs[songIndex].targetRating = parseFloat(minScoreInfo.rating.toFixed(4)); songsChangedThisIteration = true; }}
                }
            }
        }
        currentSimulatedB30Songs = sortAndSlice(deduplicateSongList(currentSimulatedB30Songs), BEST_COUNT);
        currentSimulatedNew20Songs = sortAndSlice(deduplicateSongList(currentSimulatedNew20Songs), NEW_20_COUNT);
        currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
        currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
        currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
        if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
        if (!songsChangedThisIteration || Math.abs(currentOverallRating - previousOverallRatingForHybridCycle) < 0.00001) {
            let replacedInB30 = false; let replacedInN20 = false;
            const b30ReplaceResult = _performListSimulationPhase(currentSimulatedB30Songs, input, log, 'b30', currentAverageB30Rating, currentSimulatedNew20Songs, true);
            if (b30ReplaceResult.songsChangedCount > 0) { currentSimulatedB30Songs = b30ReplaceResult.updatedSongs; replacedInB30 = true; songsChangedThisIteration = true; }
            const n20ReplaceResult = _performListSimulationPhase(currentSimulatedNew20Songs, input, log, 'n20', currentAverageNew20Rating, currentSimulatedB30Songs, true);
            if (n20ReplaceResult.songsChangedCount > 0) { currentSimulatedNew20Songs = n20ReplaceResult.updatedSongs; replacedInN20 = true; songsChangedThisIteration = true; }
            currentSimulatedB30Songs = sortAndSlice(deduplicateSongList(currentSimulatedB30Songs), BEST_COUNT);
            currentSimulatedNew20Songs = sortAndSlice(deduplicateSongList(currentSimulatedNew20Songs), NEW_20_COUNT);
            currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
            currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
            currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
            if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
            if (!replacedInB30 && !replacedInN20) hybridStuck = true;
        }
        if (Math.abs(currentOverallRating - previousOverallRatingForHybridCycle) < 0.00001 && !songsChangedThisIteration) hybridStuck = true;
    }
    if (hybridIterations >= MAX_ITERATIONS_HYBRID && currentOverallRating < input.targetRating) hybridStuck = true;
    if (finalOutcomePhase !== 'target_reached') { if (hybridStuck) finalOutcomePhase = 'stuck_both_no_improvement'; else if (currentOverallRating < input.targetRating) finalOutcomePhase = 'stuck_both_no_improvement'; }
  }

  if (finalOutcomePhase === 'simulating' || (finalOutcomePhase !== 'target_reached' && finalOutcomePhase !== 'stuck_b30_no_improvement' && finalOutcomePhase !== 'stuck_n20_no_improvement' && finalOutcomePhase !== 'stuck_both_no_improvement' )) {
    if (input.simulationMode === 'b30_only' && currentOverallRating < input.targetRating) finalOutcomePhase = 'stuck_b30_no_improvement';
    else if (input.simulationMode === 'n20_only' && currentOverallRating < input.targetRating) finalOutcomePhase = 'stuck_n20_no_improvement';
    else if (input.simulationMode === 'hybrid' && currentOverallRating < input.targetRating) finalOutcomePhase = 'stuck_both_no_improvement';
    else if (currentOverallRating >= input.targetRating) finalOutcomePhase = 'target_reached';
    else finalOutcomePhase = input.simulationMode === 'hybrid' ? 'stuck_both_no_improvement' : (input.simulationMode === 'b30_only' ? 'stuck_b30_no_improvement' : 'stuck_n20_no_improvement');
  }
  log.push(`[WORKER_RUN_SIMULATION_END] Final Phase: ${finalOutcomePhase}. Overall Rating: ${currentOverallRating.toFixed(4)}.`);
  currentSimulatedB30Songs = deduplicateSongList(currentSimulatedB30Songs);
  currentSimulatedNew20Songs = deduplicateSongList(currentSimulatedNew20Songs);
  return {
    simulatedB30Songs: currentSimulatedB30Songs,
    simulatedNew20Songs: currentSimulatedNew20Songs,
    finalAverageB30Rating: currentAverageB30Rating,
    finalAverageNew20Rating: currentAverageNew20Rating,
    finalOverallRating: currentOverallRating,
    finalPhase: finalOutcomePhase,
    simulationLog: log,
  };
}

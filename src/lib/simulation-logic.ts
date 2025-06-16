// src/lib/simulation-logic.ts
import type {
  Song,
  ShowallApiSongEntry,
  SimulationInput,
  SimulationOutput,
  SimulationPhase,
} from '@/types/result-page';
import {
  calculateChunithmSongRating,
  findMinScoreForTargetRating,
  getNextGradeBoundaryScore,
  mapApiSongToAppSong,
  sortSongsByRatingDesc,
  difficultyOrder, // Added import
} from './rating-utils';
import NewSongsData from '@/data/NewSongs.json';

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;
const MAX_SCORE_NORMAL = 1009000; // SSS+
const MAX_ITERATIONS_PER_LIST = 200;
const MAX_ITERATIONS_HYBRID = 400;

// Helper: Identify high constant songs for "floor" strategy
const isSongHighConstantForFloor = (song: Song, currentOverallAverageRatingForList: number | null): boolean => {
  if (!song.chartConstant || currentOverallAverageRatingForList === null) return false;
  const thresholdBase = currentOverallAverageRatingForList - 1.8;
  const threshold = Math.floor(thresholdBase * 10) / 10;
  return song.chartConstant > threshold;
};

// Main orchestrator function
export function runFullSimulation(input: SimulationInput): SimulationOutput {
  const log: string[] = [];
  log.push(`[RUN_SIMULATION_START] Target: ${input.targetRating.toFixed(4)}, Mode: ${input.simulationMode}, Preference: ${input.algorithmPreference}, Current Rating: ${input.currentRating.toFixed(4)}`);

  let currentSimulatedB30Songs: Song[];
  let currentSimulatedNew20Songs: Song[];
  const scoreCap = input.isScoreLimitReleased ? 1010000 : MAX_SCORE_NORMAL;

  if (input.simulationMode === "b30_only") {
    currentSimulatedB30Songs = JSON.parse(JSON.stringify(input.originalB30Songs));
    currentSimulatedNew20Songs = JSON.parse(JSON.stringify(input.originalNew20Songs.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating }))));
    log.push(`[INIT] B30_ONLY mode. Original B30 count: ${currentSimulatedB30Songs.length}, Fixed N20 count: ${currentSimulatedNew20Songs.length}`);
  } else if (input.simulationMode === "n20_only") {
    currentSimulatedB30Songs = JSON.parse(JSON.stringify(input.originalB30Songs.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating }))));
    currentSimulatedNew20Songs = JSON.parse(JSON.stringify(input.originalNew20Songs));
    log.push(`[INIT] N20_ONLY mode. Fixed B30 count: ${currentSimulatedB30Songs.length}, Original N20 count: ${currentSimulatedNew20Songs.length}`);
  } else { // hybrid mode
    currentSimulatedB30Songs = JSON.parse(JSON.stringify(input.originalB30Songs));
    currentSimulatedNew20Songs = JSON.parse(JSON.stringify(input.originalNew20Songs));
    log.push(`[INIT] HYBRID mode. Original B30 count: ${currentSimulatedB30Songs.length}, Original N20 count: ${currentSimulatedNew20Songs.length}`);
  }

  let currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, input.simulationMode !== "n20_only");
  let currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, input.simulationMode !== "b30_only");
  let currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);

  log.push(`[INITIAL_STATE] B30 Avg: ${currentAverageB30Rating?.toFixed(4) || 'N/A'}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4) || 'N/A'}, Overall: ${currentOverallRating.toFixed(4)}`);

  let finalOutcomePhase: SimulationPhase = 'simulating';

  if (input.simulationMode === "b30_only") {
    let b30Stuck = false;
    let b30Iterations = 0;
    log.push("--- Starting B30_ONLY Simulation Cycle ---");
    while (currentOverallRating < input.targetRating && !b30Stuck && b30Iterations < MAX_ITERATIONS_PER_LIST) {
      b30Iterations++;
      const previousOverallRatingForCycle = currentOverallRating;
      log.push(`[B30_ITERATION ${b30Iterations}/${MAX_ITERATIONS_PER_LIST}] Current Overall: ${currentOverallRating.toFixed(4)}`);

      const result = _performListSimulationPhase(currentSimulatedB30Songs, input, log, 'b30', currentAverageB30Rating, currentSimulatedNew20Songs);
      currentSimulatedB30Songs = result.updatedSongs;
      b30Stuck = result.stuck;

      currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      log.push(`[B30_ITER ${b30Iterations} POST_PHASE] Overall: ${currentOverallRating.toFixed(4)}, Stuck: ${b30Stuck}`);

      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
      if (b30Stuck || Math.abs(currentOverallRating - previousOverallRatingForCycle) < 0.00001) {
        log.push(`[B30_STUCK] B30 simulation cycle cannot make further progress. Stuck: ${b30Stuck}, Delta: ${(currentOverallRating - previousOverallRatingForCycle).toFixed(6)}`);
        b30Stuck = true;
      }
    }
    if (b30Iterations >= MAX_ITERATIONS_PER_LIST && currentOverallRating < input.targetRating) {
      log.push(`[B30_MAX_ITER] Reached max B30 iterations. Current Overall: ${currentOverallRating.toFixed(4)}`);
      b30Stuck = true;
    }
    if (finalOutcomePhase !== 'target_reached') finalOutcomePhase = b30Stuck ? 'stuck_b30_no_improvement' : 'simulating';
    log.push(`[B30_ONLY_CYCLE_END] Phase: ${finalOutcomePhase}. Overall: ${currentOverallRating.toFixed(4)}`);
  }
  else if (input.simulationMode === "n20_only") {
    let n20Stuck = false;
    let n20Iterations = 0;
    log.push("--- Starting N20_ONLY Simulation Cycle ---");
    while (currentOverallRating < input.targetRating && !n20Stuck && n20Iterations < MAX_ITERATIONS_PER_LIST) {
      n20Iterations++;
      const previousOverallRatingForCycle = currentOverallRating;
      log.push(`[N20_ITERATION ${n20Iterations}/${MAX_ITERATIONS_PER_LIST}] Current Overall: ${currentOverallRating.toFixed(4)}`);

      const result = _performListSimulationPhase(currentSimulatedNew20Songs, input, log, 'n20', currentAverageNew20Rating, currentSimulatedB30Songs);
      currentSimulatedNew20Songs = result.updatedSongs;
      n20Stuck = result.stuck;

      currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      log.push(`[N20_ITER ${n20Iterations} POST_PHASE] Overall: ${currentOverallRating.toFixed(4)}, Stuck: ${n20Stuck}`);

      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
      if (n20Stuck || Math.abs(currentOverallRating - previousOverallRatingForCycle) < 0.00001) {
        log.push(`[N20_STUCK] N20 simulation cycle cannot make further progress. Stuck: ${n20Stuck}, Delta: ${(currentOverallRating - previousOverallRatingForCycle).toFixed(6)}`);
        n20Stuck = true;
      }
    }
    if (n20Iterations >= MAX_ITERATIONS_PER_LIST && currentOverallRating < input.targetRating) {
      log.push(`[N20_MAX_ITER] Reached max N20 iterations. Current Overall: ${currentOverallRating.toFixed(4)}`);
      n20Stuck = true;
    }
    if (finalOutcomePhase !== 'target_reached') finalOutcomePhase = n20Stuck ? 'stuck_n20_no_improvement' : 'simulating';
    log.push(`[N20_ONLY_CYCLE_END] Phase: ${finalOutcomePhase}. Overall: ${currentOverallRating.toFixed(4)}`);
  }
  else if (input.simulationMode === "hybrid" && finalOutcomePhase !== 'target_reached' && currentOverallRating < input.targetRating) {
    log.push("--- Starting HYBRID Simulation Cycle ---");
    let hybridIterations = 0;
    let hybridStuck = false;

    while (currentOverallRating < input.targetRating && !hybridStuck && hybridIterations < MAX_ITERATIONS_HYBRID) {
        hybridIterations++;
        const previousOverallRatingForHybridCycle = currentOverallRating;
        log.push(`[HYBRID_ITER ${hybridIterations}/${MAX_ITERATIONS_HYBRID}] Overall: ${currentOverallRating.toFixed(4)}, B30 Avg: ${currentAverageB30Rating?.toFixed(4) || 'N/A'}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4) || 'N/A'}`);

        let songsChangedThisIteration = false;

        // 1. Aggregate and sort global candidates for leap/fine-tune
        let globalCandidates: (Song & { listOrigin: 'b30' | 'n20' })[] = [];
        currentSimulatedB30Songs.forEach(s => {
            if (s.targetScore < scoreCap && s.chartConstant && s.chartConstant > 0) {
                globalCandidates.push({ ...JSON.parse(JSON.stringify(s)), listOrigin: 'b30' });
            }
        });
        currentSimulatedNew20Songs.forEach(s => {
            if (s.targetScore < scoreCap && s.chartConstant && s.chartConstant > 0) {
                globalCandidates.push({ ...JSON.parse(JSON.stringify(s)), listOrigin: 'n20' });
            }
        });
        log.push(`[HYBRID_ITER ${hybridIterations}] Found ${globalCandidates.length} total improvable songs.`);

        if (globalCandidates.length > 0) {
            if (input.algorithmPreference === 'floor') {
                globalCandidates.sort((a, b) => {
                    const aIsHigh = isSongHighConstantForFloor(a, a.listOrigin === 'b30' ? currentAverageB30Rating : currentAverageNew20Rating);
                    const bIsHigh = isSongHighConstantForFloor(b, b.listOrigin === 'b30' ? currentAverageB30Rating : currentAverageNew20Rating);
                    if (aIsHigh !== bIsHigh) return aIsHigh ? 1 : -1; // Prefer non-high constant for floor
                    const constA = a.chartConstant ?? Infinity;
                    const constB = b.chartConstant ?? Infinity;
                    if (constA !== constB) return constA - constB; // Then lower constant
                    if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating; // Then lower current rating
                    return a.targetScore - b.targetScore; // Then lower current score
                });
            } else { // peak
                globalCandidates.sort((a, b) => {
                    if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating; // Higher current rating
                    if (b.targetScore !== a.targetScore) return b.targetScore - a.targetScore; // Then higher current score
                    const constA = a.chartConstant ?? 0;
                    const constB = b.chartConstant ?? 0;
                    return constB - constA; // Then higher constant
                });
            }
            log.push(`[HYBRID_ITER ${hybridIterations}] Top global candidate: ${globalCandidates[0].title} (${globalCandidates[0].listOrigin}), Const: ${globalCandidates[0].chartConstant}, TgtRating: ${globalCandidates[0].targetRating.toFixed(4)}`);

            // 2. Attempt LEAP on the top global candidate
            const topCandidate = globalCandidates[0];
            const nextGradeScore = getNextGradeBoundaryScore(topCandidate.targetScore);
            if (nextGradeScore && topCandidate.chartConstant && topCandidate.targetScore < nextGradeScore && nextGradeScore <= scoreCap) {
                const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, topCandidate.chartConstant);
                if (potentialRatingAtNextGrade > topCandidate.targetRating + 0.00005) {
                    if (topCandidate.listOrigin === 'b30') {
                        const songIndex = currentSimulatedB30Songs.findIndex(s => s.id === topCandidate.id && s.diff === topCandidate.diff);
                        if (songIndex !== -1) {
                            currentSimulatedB30Songs[songIndex].targetScore = nextGradeScore;
                            currentSimulatedB30Songs[songIndex].targetRating = parseFloat(potentialRatingAtNextGrade.toFixed(4));
                            songsChangedThisIteration = true;
                            log.push(`[HYBRID_LEAP_B30] Leaped ${topCandidate.title} to score ${nextGradeScore}, new target rating ${potentialRatingAtNextGrade.toFixed(4)}`);
                        }
                    } else { // n20
                        const songIndex = currentSimulatedNew20Songs.findIndex(s => s.id === topCandidate.id && s.diff === topCandidate.diff);
                        if (songIndex !== -1) {
                            currentSimulatedNew20Songs[songIndex].targetScore = nextGradeScore;
                            currentSimulatedNew20Songs[songIndex].targetRating = parseFloat(potentialRatingAtNextGrade.toFixed(4));
                            songsChangedThisIteration = true;
                            log.push(`[HYBRID_LEAP_N20] Leaped ${topCandidate.title} to score ${nextGradeScore}, new target rating ${potentialRatingAtNextGrade.toFixed(4)}`);
                        }
                    }
                }
            }
        }

        // 3. Attempt FINE_TUNE if leap didn't change anything (or on a new top candidate)
        if (!songsChangedThisIteration && globalCandidates.length > 0) {
            const candidateForFineTune = globalCandidates[0];
            log.push(`[HYBRID_FINETUNE] Attempting fine-tune for: ${candidateForFineTune.title} (${candidateForFineTune.listOrigin})`);
            if (candidateForFineTune.targetScore < scoreCap && candidateForFineTune.chartConstant) {
                const targetMicroTuneRating = candidateForFineTune.targetRating + 0.0001;
                const minScoreInfo = findMinScoreForTargetRating(candidateForFineTune, targetMicroTuneRating, input.isScoreLimitReleased);
                if (minScoreInfo.possible && minScoreInfo.score > candidateForFineTune.targetScore && minScoreInfo.score <= scoreCap) {
                    if (candidateForFineTune.listOrigin === 'b30') {
                        const songIndex = currentSimulatedB30Songs.findIndex(s => s.id === candidateForFineTune.id && s.diff === candidateForFineTune.diff);
                        if (songIndex !== -1) {
                            currentSimulatedB30Songs[songIndex].targetScore = minScoreInfo.score;
                            currentSimulatedB30Songs[songIndex].targetRating = parseFloat(minScoreInfo.rating.toFixed(4));
                            songsChangedThisIteration = true;
                            log.push(`[HYBRID_FINETUNE_B30] Tuned ${candidateForFineTune.title} to score ${minScoreInfo.score}, rating ${minScoreInfo.rating.toFixed(4)}`);
                        }
                    } else { // n20
                        const songIndex = currentSimulatedNew20Songs.findIndex(s => s.id === candidateForFineTune.id && s.diff === candidateForFineTune.diff);
                        if (songIndex !== -1) {
                            currentSimulatedNew20Songs[songIndex].targetScore = minScoreInfo.score;
                            currentSimulatedNew20Songs[songIndex].targetRating = parseFloat(minScoreInfo.rating.toFixed(4));
                            songsChangedThisIteration = true;
                            log.push(`[HYBRID_FINETUNE_N20] Tuned ${candidateForFineTune.title} to score ${minScoreInfo.score}, rating ${minScoreInfo.rating.toFixed(4)}`);
                        }
                    }
                }
            }
        }

        currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
        currentSimulatedB30Songs = sortAndSlice(currentSimulatedB30Songs, BEST_COUNT); // Sorts by targetRating
        currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
        currentSimulatedNew20Songs = sortAndSlice(currentSimulatedNew20Songs, NEW_20_COUNT); // Sorts by targetRating
        currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);

        log.push(`[HYBRID_ITER ${hybridIterations} POST_LEAP_FINETUNE] Overall: ${currentOverallRating.toFixed(4)}, Changed: ${songsChangedThisIteration}`);
        if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

        // 4. Attempt REPLACE if no progress from leap/fine-tune in this iteration
        if (!songsChangedThisIteration || Math.abs(currentOverallRating - previousOverallRatingForHybridCycle) < 0.00001) {
            log.push(`[HYBRID_ITER ${hybridIterations}] No change from leap/finetune or no overall rating progress. Attempting replacement.`);
            let replacedInB30 = false;
            let replacedInN20 = false;

            const b30ReplaceResult = _performListSimulationPhase(currentSimulatedB30Songs, input, log, 'b30', currentAverageB30Rating, currentSimulatedNew20Songs, true);
            if (b30ReplaceResult.songsChangedCount > 0) {
                currentSimulatedB30Songs = b30ReplaceResult.updatedSongs;
                replacedInB30 = true;
                songsChangedThisIteration = true;
                log.push(`[HYBRID_REPLACE_B30_ATTEMPT] B30 replacement phase changed songs.`);
            }

            const n20ReplaceResult = _performListSimulationPhase(currentSimulatedNew20Songs, input, log, 'n20', currentAverageNew20Rating, currentSimulatedB30Songs, true);
            if (n20ReplaceResult.songsChangedCount > 0) {
                currentSimulatedNew20Songs = n20ReplaceResult.updatedSongs;
                replacedInN20 = true;
                songsChangedThisIteration = true;
                log.push(`[HYBRID_REPLACE_N20_ATTEMPT] N20 replacement phase changed songs.`);
            }

            currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
            currentSimulatedB30Songs = sortAndSlice(currentSimulatedB30Songs, BEST_COUNT);
            currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
            currentSimulatedNew20Songs = sortAndSlice(currentSimulatedNew20Songs, NEW_20_COUNT);
            currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
            log.push(`[HYBRID_ITER ${hybridIterations} POST_REPLACE] Overall: ${currentOverallRating.toFixed(4)}, B30 Replaced: ${replacedInB30}, N20 Replaced: ${replacedInN20}`);

            if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

            if (!replacedInB30 && !replacedInN20) {
                log.push(`[HYBRID_STUCK] Hybrid replacement did not yield improvement.`);
                hybridStuck = true;
            }
        }
        if (Math.abs(currentOverallRating - previousOverallRatingForHybridCycle) < 0.00001 && !songsChangedThisIteration) {
             log.push(`[HYBRID_STUCK] Hybrid simulation made no overall rating progress and no songs changed. Delta: ${(currentOverallRating - previousOverallRatingForHybridCycle).toFixed(6)}`);
             hybridStuck = true;
        }
    }

    if (hybridIterations >= MAX_ITERATIONS_HYBRID && currentOverallRating < input.targetRating) {
        log.push(`[HYBRID_MAX_ITER] Reached max hybrid iterations. Overall: ${currentOverallRating.toFixed(4)}`);
        hybridStuck = true;
    }
    if (finalOutcomePhase !== 'target_reached') {
         log.push(`[HYBRID_CYCLE_END] Hybrid cycle finished. Stuck: ${hybridStuck}. Overall: ${currentOverallRating.toFixed(4)}`);
         if (hybridStuck) {
             finalOutcomePhase = 'stuck_both_no_improvement';
         } else if (currentOverallRating < input.targetRating) {
             finalOutcomePhase = 'stuck_both_no_improvement';
         }
    }
  }


  if (finalOutcomePhase === 'simulating' || (finalOutcomePhase !== 'target_reached' && finalOutcomePhase !== 'stuck_b30_no_improvement' && finalOutcomePhase !== 'stuck_n20_no_improvement' && finalOutcomePhase !== 'stuck_both_no_improvement' )) {
    if (input.simulationMode === 'b30_only' && currentOverallRating < input.targetRating) {
        finalOutcomePhase = 'stuck_b30_no_improvement';
    } else if (input.simulationMode === 'n20_only' && currentOverallRating < input.targetRating) {
        finalOutcomePhase = 'stuck_n20_no_improvement';
    } else if (input.simulationMode === 'hybrid' && currentOverallRating < input.targetRating) {
        finalOutcomePhase = 'stuck_both_no_improvement';
    } else if (currentOverallRating >= input.targetRating) {
        finalOutcomePhase = 'target_reached';
    } else {
        finalOutcomePhase = input.simulationMode === 'hybrid' ? 'stuck_both_no_improvement' : (input.simulationMode === 'b30_only' ? 'stuck_b30_no_improvement' : 'stuck_n20_no_improvement');
    }
  }

  log.push(`[RUN_SIMULATION_END] Final Phase: ${finalOutcomePhase}. Overall Rating: ${currentOverallRating.toFixed(4)}. B30 Avg: ${currentAverageB30Rating?.toFixed(4) || 'N/A'}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4) || 'N/A'}`);

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

function calculateOverallRating(
  avgB30: number | null,
  avgN20: number | null,
  actualB30Count: number,
  actualN20Count: number
): number {
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

  log.push(`[${listName}_PHASE_MANAGEMENT_START] Mode: ${input.simulationMode}, Algo: ${input.algorithmPreference}, Songs in list: ${updatedSongs.length}, Avg: ${currentAverageForList?.toFixed(4) || 'N/A'}`);

  let updatableSongsForLeap = updatedSongs.filter(song => song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);
  if (input.algorithmPreference === 'floor') {
    updatableSongsForLeap.sort((a, b) => {
      const aIsHighConst = isSongHighConstantForFloor(a, currentAverageForList);
      const bIsHighConst = isSongHighConstantForFloor(b, currentAverageForList);
      if (aIsHighConst !== bIsHighConst) return aIsHighConst ? 1 : -1;
      const constA = a.chartConstant ?? Infinity;
      const constB = b.chartConstant ?? Infinity;
      if (constA !== constB) return constA - constB;
      if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating;
      return a.targetScore - b.targetScore;
    });
  } else {
    updatableSongsForLeap.sort((a, b) => {
      if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating;
      return b.targetScore - a.targetScore;
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
          log.push(`[${listName}_LEAP_SUCCESS] Leaped ${songToAttemptLeap.title} to score ${nextGradeScore}, new target rating ${potentialRatingAtNextGrade.toFixed(4)}`);
          return { updatedSongs: sortAndSlice(updatedSongs, listLimit), songsChangedCount, stuck: phaseIsStuck };
        }
      }
    }
  }

  let updatableSongsForFineTune = updatedSongs.filter(song => song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);
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
      return b.targetScore - a.targetScore;
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
          log.push(`[${listName}_FINETUNE_SUCCESS] Tuned ${currentSongInSim.title} to score ${minScoreInfo.score}, rating ${minScoreInfo.rating.toFixed(4)}`);
          return { updatedSongs: sortAndSlice(updatedSongs, listLimit), songsChangedCount, stuck: phaseIsStuck };
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
          .filter(poolSong => !currentN20IdsAndDiffs.has(`${poolSong.id}_${poolSong.diff}`))
          .sort((a,b) => b.currentRating - a.currentRating);
      if (potentialAdditions.length > 0) {
          const songToAdd = potentialAdditions[0];
          updatedSongs.push({...songToAdd, targetScore: songToAdd.currentScore, targetRating: songToAdd.currentRating });
          songsChangedCount++; phaseIsStuck = false;
          log.push(`[${listName}_REPLACE_ADD_SUCCESS] Added ${songToAdd.title}. New ${listName} count: ${updatedSongs.length}`);
          return { updatedSongs: sortAndSlice(updatedSongs, listLimit), songsChangedCount, stuck: phaseIsStuck };
      }
  }

  if (!songToReplace) {
      log.push(`[${listName}_REPLACE_NO_TARGET] No song to replace or add for ${listName}.`);
      return { updatedSongs, songsChangedCount, stuck: true };
  }
  log.push(`[${listName}_REPLACE_SEARCH] For ${songToReplace.title} (TgtRating: ${songToReplace.targetRating.toFixed(4)})`);

  let replacementSourcePool: (Song | ShowallApiSongEntry)[] = [];
  const currentSimulatedIdsAndDiffs = new Set(updatedSongs.map(s => `${s.id}_${s.diff}`));
  const otherListIdsAndDiffs = new Set(otherListSongs.map(s => `${s.id}_${s.diff}`));

  if (listType === 'b30') {
    replacementSourcePool = input.allMusicData
      .filter(globalSong => {
        if (!globalSong.id || !globalSong.diff || !globalSong.title) return false;
        const globalSongKey = `${globalSong.id}_${globalSong.diff.toUpperCase()}`;
        if (currentSimulatedIdsAndDiffs.has(globalSongKey)) return false;
        if (isHybridReplaceContext && otherListIdsAndDiffs.has(globalSongKey)) return false;

        const isNewSongByName = NewSongsData.titles.verse.some(title => title.trim().toLowerCase() === globalSong.title.trim().toLowerCase());
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
  } else {
    replacementSourcePool = input.allPlayedNewSongsPool
      .filter(poolSong => {
          const poolSongKey = `${poolSong.id}_${poolSong.diff.toUpperCase()}`;
          if (currentSimulatedIdsAndDiffs.has(poolSongKey)) return false;
          if (isHybridReplaceContext && otherListIdsAndDiffs.has(poolSongKey)) return false;
          if (!poolSong.chartConstant) return false;
          const potentialMaxRating = calculateChunithmSongRating(scoreCap, poolSong.chartConstant);
          return potentialMaxRating > songToReplace!.targetRating + 0.00005;
      });
  }
  log.push(`[${listName}_REPLACE_CANDIDATES] Found ${replacementSourcePool.length} candidates.`);

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
    });
    songsChangedCount++; phaseIsStuck = false;
    log.push(`[${listName}_REPLACE_SUCCESS] Replaced ${songToReplace!.title} with ${bestCandidateForReplacement.title}.`);
    return { updatedSongs: sortAndSlice(updatedSongs, listLimit), songsChangedCount, stuck: phaseIsStuck };
  }

  log.push(`[${listName}_PHASE_MANAGEMENT_END] No changes in this pass. Stuck: ${phaseIsStuck}`);
  return { updatedSongs, songsChangedCount, stuck: phaseIsStuck };
}

function sortAndSlice(songs: Song[], limit: number): Song[] {
    // Create a shallow copy of each song to ensure original currentRating/currentScore are preserved
    // for display, while targetRating/targetScore are used for sorting and represent the simulated state.
    const songsToSort = songs.map(s => ({ ...s }));

    songsToSort.sort((a, b) => {
        if (b.targetRating !== a.targetRating) {
            return b.targetRating - a.targetRating;
        }
        if (b.targetScore !== a.targetScore) {
            return b.targetScore - a.targetScore;
        }
        const diffAOrderVal = difficultyOrder[a.diff.toUpperCase() as keyof typeof difficultyOrder] || 0;
        const diffBOrderVal = difficultyOrder[b.diff.toUpperCase() as keyof typeof difficultyOrder] || 0;
        if (diffBOrderVal !== diffAOrderVal) {
            return diffBOrderVal - diffAOrderVal;
        }
        return a.title.localeCompare(b.title); // Fallback to title sort
    });
    return songsToSort.slice(0, limit);
}


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
  // sortSongsByRatingDesc, // No longer used directly here, sortAndSlice handles specific sorting
  difficultyOrder,
} from './rating-utils';
import NewSongsData from '@/data/NewSongs.json';

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;
const MAX_SCORE_NORMAL = 1009000; // SSS+
const MAX_ITERATIONS_PER_LIST = 200; // For b30_only or n20_only modes
const MAX_ITERATIONS_HYBRID = 400; // For hybrid mode

// Helper: Identify high constant songs for "floor" strategy
const isSongHighConstantForFloor = (song: Song, currentOverallAverageRatingForList: number | null): boolean => {
  if (!song.chartConstant || currentOverallAverageRatingForList === null) return false;
  const thresholdBase = currentOverallAverageRatingForList - 1.8;
  const threshold = Math.floor(thresholdBase * 10) / 10; // e.g. if avg is 15.5, thresholdBase is 13.7, threshold is 13.7
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
      songMap.set(key, song); // Keep the one with better target rating/score
    }
  }
  return Array.from(songMap.values());
}

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
    log.push(`--- Starting HYBRID Simulation Cycle (Preference: ${input.algorithmPreference}) ---`);
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
        log.push(`[HYBRID_ITER ${hybridIterations}] Found ${globalCandidates.length} total improvable songs (before filtering for target rating).`);

        // Filter candidates that can actually improve towards target (or at all)
        globalCandidates = globalCandidates.filter(c => {
            const nextPossibleScore = getNextGradeBoundaryScore(c.targetScore);
            if (nextPossibleScore && c.chartConstant && nextPossibleScore <= scoreCap) {
                 const potentialRating = calculateChunithmSongRating(nextPossibleScore, c.chartConstant);
                 if (potentialRating > c.targetRating + 0.00005) return true;
            }
            const fineTunePotential = findMinScoreForTargetRating(c, c.targetRating + 0.0001, input.isScoreLimitReleased);
            if (fineTunePotential.possible && fineTunePotential.score > c.targetScore && fineTunePotential.score <= scoreCap) return true;
            return false;
        });
         log.push(`[HYBRID_ITER ${hybridIterations}] Found ${globalCandidates.length} actually improvable songs.`);


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
                globalCandidates.sort((a, b) => { // Higher rating first
                    if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating;
                    if (b.targetScore !== a.targetScore) return b.targetScore - a.targetScore; // Then higher score
                    const constA = a.chartConstant ?? 0; // Higher constant is better for peak if ratings are same
                    const constB = b.chartConstant ?? 0;
                    return constB - constA;
                });
            }
            if (globalCandidates.length > 0) {
                log.push(`[HYBRID_ITER ${hybridIterations}] Top global candidate: ${globalCandidates[0].title} (${globalCandidates[0].listOrigin}), Const: ${globalCandidates[0].chartConstant}, TgtRating: ${globalCandidates[0].targetRating.toFixed(4)}`);
            }


            // 2. Attempt LEAP on the top global candidate
            const topCandidate = globalCandidates[0];
            if (topCandidate) {
                const nextGradeScore = getNextGradeBoundaryScore(topCandidate.targetScore);
                if (nextGradeScore && topCandidate.chartConstant && topCandidate.targetScore < nextGradeScore && nextGradeScore <= scoreCap) {
                    const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, topCandidate.chartConstant);
                    if (potentialRatingAtNextGrade > topCandidate.targetRating + 0.00005) { // Ensure meaningful improvement
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
        }

        // 3. Attempt FINE_TUNE if leap didn't change anything (or on a new top candidate if leap was not possible for the first)
        if (!songsChangedThisIteration && globalCandidates.length > 0) {
            const candidateForFineTune = globalCandidates[0]; // Still use the top sorted candidate
            log.push(`[HYBRID_FINETUNE_ATTEMPT] Attempting fine-tune for: ${candidateForFineTune.title} (${candidateForFineTune.listOrigin}), Current TgtScore: ${candidateForFineTune.targetScore}, TgtRating: ${candidateForFineTune.targetRating.toFixed(4)}`);
            if (candidateForFineTune.targetScore < scoreCap && candidateForFineTune.chartConstant) {
                const targetMicroTuneRating = candidateForFineTune.targetRating + 0.0001; // Minimal increase
                const minScoreInfo = findMinScoreForTargetRating(candidateForFineTune, targetMicroTuneRating, input.isScoreLimitReleased);

                if (minScoreInfo.possible && minScoreInfo.score > candidateForFineTune.targetScore && minScoreInfo.score <= scoreCap) {
                    log.push(`[HYBRID_FINETUNE_POTENTIAL] For ${candidateForFineTune.title}: Possible to reach ${minScoreInfo.rating.toFixed(4)} with score ${minScoreInfo.score}`);
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
                } else {
                    log.push(`[HYBRID_FINETUNE_NOPOSSIBLE] For ${candidateForFineTune.title}: No improvement possible or score already maxed/too high for micro-tune.`);
                }
            } else {
                 log.push(`[HYBRID_FINETUNE_SKIP] For ${candidateForFineTune.title}: Already at score cap or no chart constant.`);
            }
        }


        currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
        currentSimulatedB30Songs = sortAndSlice(currentSimulatedB30Songs, BEST_COUNT);
        currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
        currentSimulatedNew20Songs = sortAndSlice(currentSimulatedNew20Songs, NEW_20_COUNT);
        currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);

        log.push(`[HYBRID_ITER ${hybridIterations} POST_LEAP_FINETUNE] Overall: ${currentOverallRating.toFixed(4)}, Changed: ${songsChangedThisIteration}`);
        if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

        // 4. Attempt REPLACE if no progress from leap/fine-tune in this iteration OR if the overall rating did not improve
        if (!songsChangedThisIteration || Math.abs(currentOverallRating - previousOverallRatingForHybridCycle) < 0.00001) {
            log.push(`[HYBRID_ITER ${hybridIterations}] No change from leap/finetune or no overall rating progress. Attempting replacement.`);
            let replacedInB30 = false;
            let replacedInN20 = false;

            // Try replacing in B30
            const b30ReplaceResult = _performListSimulationPhase(currentSimulatedB30Songs, input, log, 'b30', currentAverageB30Rating, currentSimulatedNew20Songs, true);
            if (b30ReplaceResult.songsChangedCount > 0) {
                currentSimulatedB30Songs = b30ReplaceResult.updatedSongs;
                replacedInB30 = true;
                songsChangedThisIteration = true; // Mark that a change occurred in the broader hybrid iteration
                log.push(`[HYBRID_REPLACE_B30_ATTEMPT] B30 replacement phase changed songs. New B30 Avg: ${calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true)?.toFixed(4)}`);
            }

            // Try replacing in N20
            const n20ReplaceResult = _performListSimulationPhase(currentSimulatedNew20Songs, input, log, 'n20', currentAverageNew20Rating, currentSimulatedB30Songs, true);
            if (n20ReplaceResult.songsChangedCount > 0) {
                currentSimulatedNew20Songs = n20ReplaceResult.updatedSongs;
                replacedInN20 = true;
                songsChangedThisIteration = true; // Mark that a change occurred
                log.push(`[HYBRID_REPLACE_N20_ATTEMPT] N20 replacement phase changed songs. New N20 Avg: ${calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true)?.toFixed(4)}`);
            }

            // Recalculate averages and overall after replacements
            currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
            currentSimulatedB30Songs = sortAndSlice(currentSimulatedB30Songs, BEST_COUNT);
            currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
            currentSimulatedNew20Songs = sortAndSlice(currentSimulatedNew20Songs, NEW_20_COUNT);
            currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
            log.push(`[HYBRID_ITER ${hybridIterations} POST_REPLACE] Overall: ${currentOverallRating.toFixed(4)}, B30 Replaced: ${replacedInB30}, N20 Replaced: ${replacedInN20}`);

            if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

            if (!replacedInB30 && !replacedInN20) { // If neither replacement phase made changes
                log.push(`[HYBRID_STUCK] Hybrid replacement did not yield improvement in either list.`);
                hybridStuck = true; // No improvement from replacements means stuck for hybrid
            }
        }
         // Check if stuck even if songsChangedThisIteration is true but overall rating didn't improve
        if (Math.abs(currentOverallRating - previousOverallRatingForHybridCycle) < 0.00001 && !songsChangedThisIteration) { // Re-check if stuck even if songs changed but overall rating didn't
             log.push(`[HYBRID_STUCK] Hybrid simulation made no overall rating progress despite potential song changes. Delta: ${(currentOverallRating - previousOverallRatingForHybridCycle).toFixed(6)}`);
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
             // If not stuck but target not reached (e.g. max iterations), consider it stuck
             finalOutcomePhase = 'stuck_both_no_improvement';
         }
    }
  }


  // Final phase determination if not already target_reached
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
        // Fallback if somehow still in 'simulating' but target not reached and not stuck explicitly by mode
        finalOutcomePhase = input.simulationMode === 'hybrid' ? 'stuck_both_no_improvement' : (input.simulationMode === 'b30_only' ? 'stuck_b30_no_improvement' : 'stuck_n20_no_improvement');
    }
  }

  log.push(`[RUN_SIMULATION_END] Final Phase: ${finalOutcomePhase}. Overall Rating: ${currentOverallRating.toFixed(4)}. B30 Avg: ${currentAverageB30Rating?.toFixed(4) || 'N/A'}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4) || 'N/A'}`);

  // Deduplicate lists before returning
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

// Helper function to calculate average rating for a list of songs
function calculateAverageRating(songs: Song[], count: number, isSimulatingThisList: boolean): number | null {
  if (!songs || songs.length === 0) return null;

  // Use targetRating if this list is being actively simulated, otherwise currentRating
  const songsForAverage = songs.map(s => ({
      ...s,
      ratingToConsider: isSimulatingThisList ? s.targetRating : s.currentRating
  }));

  const topSongs = [...songsForAverage].sort((a, b) => b.ratingToConsider - a.ratingToConsider).slice(0, count);

  if (topSongs.length === 0) return 0; // Or null if preferred for "no songs"
  const sum = topSongs.reduce((acc, s) => acc + s.ratingToConsider, 0);
  return parseFloat((sum / topSongs.length).toFixed(4));
}

// Helper function to calculate overall rating from B30 and N20 averages
function calculateOverallRating(
  avgB30: number | null,
  avgN20: number | null,
  actualB30Count: number, // Number of songs actually in the B30 list (could be < 30)
  actualN20Count: number  // Number of songs actually in the N20 list (could be < 20)
): number {
  const effectiveB30Count = Math.min(actualB30Count, BEST_COUNT);
  const b30Sum = (avgB30 ?? 0) * effectiveB30Count;

  const effectiveN20Count = Math.min(actualN20Count, NEW_20_COUNT);
  const n20Sum = (avgN20 ?? 0) * effectiveN20Count;

  const totalEffectiveSongs = effectiveB30Count + effectiveN20Count;

  if (totalEffectiveSongs === 0) return 0;
  return parseFloat(((b30Sum + n20Sum) / totalEffectiveSongs).toFixed(4));
}


// Internal helper for simulation phases on a single list (B30 or N20)
function _performListSimulationPhase(
  currentSongsInput: Song[],
  input: SimulationInput,
  log: string[],
  listType: 'b30' | 'n20',
  currentAverageForList: number | null,
  otherListSongs: Song[] = [], // Used in hybrid mode to avoid picking songs already in the other list for replacement
  isHybridReplaceContext: boolean = false // Flag to slightly alter behavior if called for replacement within hybrid
): { updatedSongs: Song[]; songsChangedCount: number; stuck: boolean } {
  let updatedSongs = JSON.parse(JSON.stringify(currentSongsInput)) as Song[];
  let songsChangedCount = 0;
  let phaseIsStuck = true; // Assume stuck until a change is made

  const listName = listType === 'b30' ? "B30" : "N20";
  const listLimit = listType === 'b30' ? BEST_COUNT : NEW_20_COUNT;
  const scoreCap = input.isScoreLimitReleased ? 1010000 : MAX_SCORE_NORMAL;

  log.push(`[${listName}_PHASE_MGMT_START] SimMode: ${input.simulationMode}, AlgoPref: ${input.algorithmPreference}, SongsInList: ${updatedSongs.length}, ListAvg: ${currentAverageForList?.toFixed(4) || 'N/A'}, HybridContext: ${isHybridReplaceContext}`);

  // 1. Attempt LEAP (Score jump to next grade boundary)
  // Filter for songs that can be improved and are not at score cap
  let updatableSongsForLeap = updatedSongs.filter(song => song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);

  // Sort based on algorithm preference
  if (input.algorithmPreference === 'floor') {
    updatableSongsForLeap.sort((a, b) => {
      const aIsHighConst = isSongHighConstantForFloor(a, currentAverageForList);
      const bIsHighConst = isSongHighConstantForFloor(b, currentAverageForList);
      if (aIsHighConst !== bIsHighConst) return aIsHighConst ? 1 : -1; // Non-high constant first
      const constA = a.chartConstant ?? Infinity; const constB = b.chartConstant ?? Infinity;
      if (constA !== constB) return constA - constB; // Then lower constant
      if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating; // Then lower current rating
      return a.targetScore - b.targetScore; // Then lower current score
    });
  } else { // peak
    updatableSongsForLeap.sort((a, b) => {
      if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating; // Higher rating first
      return b.targetScore - a.targetScore; // Then higher score
    });
  }

  if (updatableSongsForLeap.length > 0) {
    const songToAttemptLeap = updatableSongsForLeap[0];
    const nextGradeScore = getNextGradeBoundaryScore(songToAttemptLeap.targetScore);

    if (nextGradeScore && songToAttemptLeap.chartConstant && songToAttemptLeap.targetScore < nextGradeScore && nextGradeScore <= scoreCap) {
      const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, songToAttemptLeap.chartConstant);
      if (potentialRatingAtNextGrade > songToAttemptLeap.targetRating + 0.00005) { // Ensure meaningful improvement
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
  log.push(`[${listName}_LEAP_NO_CHANGE] No leap improvement found or applied.`);

  // 2. Attempt FINE_TUNE (Smallest score increase for +0.0001 rating)
  let updatableSongsForFineTune = updatedSongs.filter(song => song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);
  // Sort again for fine-tuning, same logic as leap
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
    } else { // peak
        updatableSongsForFineTune.sort((a, b) => {
            if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating;
            return b.targetScore - a.targetScore;
        });
    }

  if (updatableSongsForFineTune.length > 0) {
    for (const candidateSong of updatableSongsForFineTune) { // Iterate if first choice doesn't work
        const songIndex = updatedSongs.findIndex(s => s.id === candidateSong.id && s.diff === candidateSong.diff);
        if (songIndex === -1) continue; // Should not happen if list is consistent

        let currentSongInSim = updatedSongs[songIndex]; // Get the current state from the simulation list

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
  log.push(`[${listName}_FINETUNE_NO_CHANGE] No fine-tune improvement found or applied.`);


  // 3. Attempt REPLACE (Swap out weakest song if list is full, or add if not full for N20)
  let songToReplace: Song | undefined = undefined;
  if (updatedSongs.length >= listLimit) {
      // Sort by targetRating ascending to find the weakest song currently in the list
      songToReplace = [...updatedSongs].sort((a, b) => a.targetRating - b.targetRating)[0];
  } else if (listType === 'n20' && updatedSongs.length < listLimit) {
      // N20 list is not full, try to add a new song from the pool
      const currentN20IdsAndDiffs = new Set(updatedSongs.map(s => `${s.id}_${s.diff}`));
      const potentialAdditions = input.allPlayedNewSongsPool
          .filter(poolSong => !currentN20IdsAndDiffs.has(`${poolSong.id}_${poolSong.diff.toUpperCase()}`)) // Ensure poolSong.diff is also uppercase for comparison
          .filter(poolSong => !otherListSongs.some(ols => ols.id === poolSong.id && ols.diff.toUpperCase() === poolSong.diff.toUpperCase())) // Don't add if in other list (for hybrid context)
          .sort((a,b) => b.currentRating - a.currentRating); // Add best available from pool

      if (potentialAdditions.length > 0) {
          const songToAdd = potentialAdditions[0];
           // Ensure we are not adding a song that would be immediately replaced by itself due to lower currentRating
          if (!songToReplace || songToAdd.currentRating > songToReplace.targetRating) {
            updatedSongs.push({...songToAdd, targetScore: songToAdd.currentScore, targetRating: songToAdd.currentRating });
            songsChangedCount++; phaseIsStuck = false;
            log.push(`[${listName}_REPLACE_ADD_SUCCESS] Added ${songToAdd.title} (Rating: ${songToAdd.currentRating.toFixed(4)}). New ${listName} count: ${updatedSongs.length}`);
            return { updatedSongs: sortAndSlice(updatedSongs, listLimit), songsChangedCount, stuck: phaseIsStuck };
          }
      }
  }

  if (!songToReplace) {
      log.push(`[${listName}_REPLACE_NO_TARGET] No song to replace or add for ${listName}. Phase might be stuck.`);
      // If we reached here without changing songs, and no songToReplace (e.g. N20 not full but no candidates to add)
      // then phaseIsStuck remains true (its initial value if no changes made).
      return { updatedSongs, songsChangedCount, stuck: phaseIsStuck };
  }
  log.push(`[${listName}_REPLACE_SEARCH] Attempting to replace ${songToReplace.title} (TgtRating: ${songToReplace.targetRating.toFixed(4)}) in ${listName}`);

  let replacementSourcePool: (Song | ShowallApiSongEntry)[] = [];
  const currentSimulatedIdsAndDiffs = new Set(updatedSongs.map(s => `${s.id}_${s.diff.toUpperCase()}`));
  const otherListIdsAndDiffs = new Set(otherListSongs.map(s => `${s.id}_${s.diff.toUpperCase()}`));


  if (listType === 'b30') {
    replacementSourcePool = input.allMusicData
      .filter(globalSong => {
        if (!globalSong.id || !globalSong.diff || !globalSong.title) return false;
        const globalSongKey = `${globalSong.id}_${globalSong.diff.toUpperCase()}`;

        if (currentSimulatedIdsAndDiffs.has(globalSongKey)) return false; // Already in current list
        if (isHybridReplaceContext && otherListIdsAndDiffs.has(globalSongKey)) return false; // Already in other list (for hybrid context)

        const isNewSongByName = NewSongsData.titles.verse.some(title => title.trim().toLowerCase() === globalSong.title.trim().toLowerCase());
        if (isNewSongByName) return false; // B30 cannot contain new songs by definition

        const tempSongObj = mapApiSongToAppSong(globalSong, 0, globalSong.const); // Use global const
        if (!tempSongObj.chartConstant) return false; // No const, cannot calculate potential
        const potentialMaxRating = calculateChunithmSongRating(scoreCap, tempSongObj.chartConstant);
        // Candidate must be better than the song it's replacing
        return potentialMaxRating > songToReplace!.targetRating + 0.00005;
      })
      .map(apiEntry => { // Map to Song type, consider if user played it for currentScore
        const playedVersion = input.userPlayHistory.find(p => p.id === apiEntry.id && p.diff.toUpperCase() === apiEntry.diff.toUpperCase());
        // Use globalSong's const for theoretical calculation, but user's score if played
        return mapApiSongToAppSong(playedVersion || { ...apiEntry, score: 0, rating: 0 }, 0, apiEntry.const);
      })
      .filter(song => song.chartConstant !== null); // Ensure const exists after mapping
  } else { // listType === 'n20'
    replacementSourcePool = input.allPlayedNewSongsPool // N20 replacements must come from the pre-filtered new song pool
      .filter(poolSong => {
          const poolSongKey = `${poolSong.id}_${poolSong.diff.toUpperCase()}`;
          if (currentSimulatedIdsAndDiffs.has(poolSongKey)) return false; // Already in N20
          if (isHybridReplaceContext && otherListIdsAndDiffs.has(poolSongKey)) return false; // Already in B30 (for hybrid context)

          if (!poolSong.chartConstant) return false; // No const, cannot calculate potential
          // Candidate's current rating (as it's from played pool) or potential max must be better
          const potentialMaxRating = calculateChunithmSongRating(scoreCap, poolSong.chartConstant);
          return Math.max(poolSong.currentRating, potentialMaxRating) > songToReplace!.targetRating + 0.00005;
      });
  }
  log.push(`[${listName}_REPLACE_CANDIDATES] Found ${replacementSourcePool.length} potential replacement candidates for ${songToReplace.title}.`);

  let bestCandidateForReplacement: (Song & { neededScore: number; resultingRating: number }) | null = null;
  let minEffort = Infinity;

  for (const candidate of replacementSourcePool) {
    if (!candidate.chartConstant) continue;

    // Target rating for the candidate should be slightly better than the song being replaced
    const targetRatingForCandidate = songToReplace.targetRating + 0.0001;
    const minScoreInfo = findMinScoreForTargetRating(candidate, targetRatingForCandidate, input.isScoreLimitReleased);

    if (minScoreInfo.possible && minScoreInfo.score <= scoreCap) {
      // Effort: score increase needed. If not played (currentScore 0), make it higher effort.
      const effort = candidate.currentScore > 0 ? (minScoreInfo.score - candidate.currentScore) : (minScoreInfo.score + 1000000); // Penalize unplayed

      let updateBestCandidate = false;
      if (bestCandidateForReplacement === null || effort < minEffort) {
        updateBestCandidate = true;
      } else if (effort === minEffort) { // Tie-breaking for same effort
        if (input.algorithmPreference === 'floor') { // Floor: prefer lower constant
          if ((candidate.chartConstant ?? Infinity) < (bestCandidateForReplacement.chartConstant ?? Infinity)) updateBestCandidate = true;
        } else { // Peak: prefer higher resulting rating (already handled by minScoreInfo if effort is same)
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
    updatedSongs = updatedSongs.filter(s => !(s.id === songToReplace!.id && s.diff === songToReplace!.diff)); // Remove old song
    updatedSongs.push({ // Add new song with its target score/rating
      ...bestCandidateForReplacement, // This includes original currentScore/currentRating
      targetScore: bestCandidateForReplacement.neededScore,
      targetRating: bestCandidateForReplacement.resultingRating,
    });
    songsChangedCount++; phaseIsStuck = false;
    log.push(`[${listName}_REPLACE_SUCCESS] Replaced ${songToReplace!.title} (Rating ${songToReplace!.targetRating.toFixed(4)}) with ${bestCandidateForReplacement.title} (Target Rating ${bestCandidateForReplacement.resultingRating.toFixed(4)} at score ${bestCandidateForReplacement.neededScore}).`);
    return { updatedSongs: sortAndSlice(updatedSongs, listLimit), songsChangedCount, stuck: phaseIsStuck };
  }

  log.push(`[${listName}_PHASE_MGMT_END] No changes in this pass. Stuck: ${phaseIsStuck}`);
  return { updatedSongs, songsChangedCount, stuck: phaseIsStuck };
}


function sortAndSlice(songs: Song[], limit: number): Song[] {
    const songsToSort = songs.map(s => ({ ...s }));

    songsToSort.sort((a, b) => {
        if (b.targetRating !== a.targetRating) {
            return b.targetRating - a.targetRating;
        }
        if (b.targetScore !== a.targetScore) {
            return b.targetScore - a.targetScore;
        }
        // Ensure diff is a string before calling toUpperCase
        const diffAOrderVal = difficultyOrder[String(a.diff || '').toUpperCase() as keyof typeof difficultyOrder] || 0;
        const diffBOrderVal = difficultyOrder[String(b.diff || '').toUpperCase() as keyof typeof difficultyOrder] || 0;
        if (diffBOrderVal !== diffAOrderVal) {
            return diffBOrderVal - diffAOrderVal;
        }
        return (a.title || '').localeCompare(b.title || '');
    });
    return songsToSort.slice(0, limit);
}


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
} from './rating-utils';
import NewSongsData from '@/data/NewSongs.json';

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;
const MAX_SCORE_NORMAL = 1009000; // SSS+

// Helper: Identify high constant songs for "floor" strategy
const isSongHighConstantForFloor = (song: Song, currentOverallAverageRatingForList: number | null): boolean => {
  if (!song.chartConstant || currentOverallAverageRatingForList === null) return false;
  // This threshold logic might need adjustment based on how currentOverallAverageRatingForList behaves
  // If it represents the average of targetRatings, it might be higher than expected.
  const thresholdBase = currentOverallAverageRatingForList - 1.8; // Example: if avg is 17.0, threshold is 15.2.
  const threshold = Math.floor(thresholdBase * 10) / 10; // e.g., 15.2
  return song.chartConstant > threshold;
};

// Main orchestrator function
export function runFullSimulation(input: SimulationInput): SimulationOutput {
  const log: string[] = [];
  log.push(`[RUN_SIMULATION] Started. Target: ${input.targetRating.toFixed(4)}, Mode: ${input.simulationMode}, Algo: ${input.algorithmPreference}`);

  let currentSimulatedB30Songs: Song[];
  let currentSimulatedNew20Songs: Song[];

  // Initialize lists based on simulation mode
  if (input.simulationMode === "b30_only") {
    currentSimulatedB30Songs = JSON.parse(JSON.stringify(input.originalB30Songs));
    currentSimulatedNew20Songs = JSON.parse(JSON.stringify(input.originalNew20Songs.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating })))); // N20 is fixed
    log.push(`[INIT] B30_ONLY mode. Original B30 count: ${currentSimulatedB30Songs.length}, Fixed N20 count: ${currentSimulatedNew20Songs.length}`);
  } else if (input.simulationMode === "n20_only") {
    currentSimulatedB30Songs = JSON.parse(JSON.stringify(input.originalB30Songs.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating })))); // B30 is fixed
    currentSimulatedNew20Songs = JSON.parse(JSON.stringify(input.originalNew20Songs));
    log.push(`[INIT] N20_ONLY mode. Fixed B30 count: ${currentSimulatedB30Songs.length}, Original N20 count: ${currentSimulatedNew20Songs.length}`);
  } else { // hybrid mode
    currentSimulatedB30Songs = JSON.parse(JSON.stringify(input.originalB30Songs));
    currentSimulatedNew20Songs = JSON.parse(JSON.stringify(input.originalNew20Songs));
    log.push(`[INIT] HYBRID mode. Original B30 count: ${currentSimulatedB30Songs.length}, Original N20 count: ${currentSimulatedNew20Songs.length}`);
  }

  let currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, input.simulationMode === "b30_only" || input.simulationMode === "hybrid");
  let currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, input.simulationMode === "n20_only" || input.simulationMode === "hybrid");
  let currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);

  log.push(`[INITIAL_STATE] B30 Avg: ${currentAverageB30Rating?.toFixed(4) || 'N/A'}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4) || 'N/A'}, Overall: ${currentOverallRating.toFixed(4)}`);

  let finalOutcomePhase: SimulationPhase = 'simulating';
  const MAX_ITERATIONS_PER_LIST = 1000; // Safety break

  // --- B30 Simulation Cycle (if applicable) ---
  let b30Stuck = input.simulationMode === "n20_only"; // If n20_only, b30 is considered "stuck" from the start
  let b30Iterations = 0;

  if (input.simulationMode === "b30_only" || input.simulationMode === "hybrid") {
    log.push("--- Starting B30 Simulation Cycle ---");
    while (currentOverallRating < input.targetRating && !b30Stuck && b30Iterations < MAX_ITERATIONS_PER_LIST) {
      b30Iterations++;
      const previousOverallRatingForB30Cycle = currentOverallRating;
      log.push(`[B30_ITERATION ${b30Iterations}] Current B30 Avg: ${currentAverageB30Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}`);

      const leapResultB30 = _performListSimulationPhase(currentSimulatedB30Songs, 'leap', input, log, 'b30', currentAverageB30Rating);
      currentSimulatedB30Songs = leapResultB30.updatedSongs;
      currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      log.push(`[B30_LEAP_RESULT] New B30 Avg: ${currentAverageB30Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${leapResultB30.songsChangedCount > 0}`);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

      const fineTuneResultB30 = _performListSimulationPhase(currentSimulatedB30Songs, 'fine_tune', input, log, 'b30', currentAverageB30Rating);
      currentSimulatedB30Songs = fineTuneResultB30.updatedSongs;
      currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      log.push(`[B30_FINETUNE_RESULT] New B30 Avg: ${currentAverageB30Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${fineTuneResultB30.songsChangedCount > 0}`);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

      if (Math.abs(currentOverallRating - previousOverallRatingForB30Cycle) < 0.00001 && leapResultB30.stuck && fineTuneResultB30.stuck) {
        log.push(`[B30_REPLACEMENT_CHECK] B30 stuck after leap & fine-tune. Attempting replacement.`);
        const replacementResultB30 = _performListSimulationPhase(currentSimulatedB30Songs, 'replace', input, log, 'b30', currentAverageB30Rating);
        currentSimulatedB30Songs = replacementResultB30.updatedSongs;
        currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
        currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
        log.push(`[B30_REPLACEMENT_RESULT] New B30 Avg: ${currentAverageB30Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${replacementResultB30.songsChangedCount > 0}`);
        if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
        if (replacementResultB30.stuck || replacementResultB30.songsChangedCount === 0) {
          log.push(`[B30_STUCK] B30 simulation cycle could not make further progress via replacement.`);
          b30Stuck = true;
        }
      } else if (Math.abs(currentOverallRating - previousOverallRatingForB30Cycle) < 0.00001) {
          log.push(`[B30_STUCK] B30 simulation cycle made no progress in overall rating.`);
          b30Stuck = true;
      }
    }
    if (b30Iterations >= MAX_ITERATIONS_PER_LIST) log.push(`[B30_INFO] Reached max B30 iterations.`);
    if (finalOutcomePhase !== 'target_reached' && b30Stuck) log.push(`[B30_INFO] B30 cycle finished or stuck. Overall: ${currentOverallRating.toFixed(4)}`);
  }


  // --- N20 Simulation Cycle (if applicable and target not met) ---
  let n20Stuck = input.simulationMode === "b30_only"; // If b30_only, n20 is considered "stuck"
  let n20Iterations = 0;

  if ((input.simulationMode === "n20_only" || input.simulationMode === "hybrid") && finalOutcomePhase !== 'target_reached') {
    log.push("--- Starting N20 Simulation Cycle ---");
    while (currentOverallRating < input.targetRating && !n20Stuck && n20Iterations < MAX_ITERATIONS_PER_LIST) {
      n20Iterations++;
      const previousOverallRatingForN20Cycle = currentOverallRating;
      log.push(`[N20_ITERATION ${n20Iterations}] Current N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}`);

      const leapResultN20 = _performListSimulationPhase(currentSimulatedNew20Songs, 'leap', input, log, 'n20', currentAverageNew20Rating);
      currentSimulatedNew20Songs = leapResultN20.updatedSongs;
      currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      log.push(`[N20_LEAP_RESULT] New N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${leapResultN20.songsChangedCount > 0}`);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

      const fineTuneResultN20 = _performListSimulationPhase(currentSimulatedNew20Songs, 'fine_tune', input, log, 'n20', currentAverageNew20Rating);
      currentSimulatedNew20Songs = fineTuneResultN20.updatedSongs;
      currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      log.push(`[N20_FINETUNE_RESULT] New N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${fineTuneResultN20.songsChangedCount > 0}`);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

      if (Math.abs(currentOverallRating - previousOverallRatingForN20Cycle) < 0.00001 && leapResultN20.stuck && fineTuneResultN20.stuck) {
        log.push(`[N20_REPLACEMENT_CHECK] N20 stuck after leap & fine-tune. Attempting replacement.`);
        const replacementResultN20 = _performListSimulationPhase(currentSimulatedNew20Songs, 'replace', input, log, 'n20', currentAverageNew20Rating);
        currentSimulatedNew20Songs = replacementResultN20.updatedSongs;
        currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
        currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
        log.push(`[N20_REPLACEMENT_RESULT] New N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${replacementResultN20.songsChangedCount > 0}`);
        if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
        if (replacementResultN20.stuck || replacementResultN20.songsChangedCount === 0) {
          log.push(`[N20_STUCK] N20 simulation cycle could not make further progress via replacement.`);
          n20Stuck = true;
        }
      } else if (Math.abs(currentOverallRating - previousOverallRatingForN20Cycle) < 0.00001) {
          log.push(`[N20_STUCK] N20 simulation cycle made no progress in overall rating.`);
          n20Stuck = true;
      }
    }
    if (n20Iterations >= MAX_ITERATIONS_PER_LIST) log.push(`[N20_INFO] Reached max N20 iterations.`);
    if (finalOutcomePhase !== 'target_reached' && n20Stuck) log.push(`[N20_INFO] N20 cycle finished or stuck. Overall: ${currentOverallRating.toFixed(4)}`);
  }


  // Determine final phase based on overall simulation outcome
  if (finalOutcomePhase !== 'target_reached') {
    if (b30Stuck && n20Stuck) { // Both cycles ran (or were meant to run for hybrid) and got stuck
      finalOutcomePhase = 'stuck_both_no_improvement';
    } else if (b30Stuck && input.simulationMode === "b30_only") { // Only B30 ran and got stuck
      finalOutcomePhase = 'stuck_b30_no_improvement';
    } else if (n20Stuck && input.simulationMode === "n20_only") { // Only N20 ran and got stuck
      finalOutcomePhase = 'stuck_n20_no_improvement';
    } else if (b30Stuck && input.simulationMode === "hybrid") { // Hybrid mode, B30 stuck, N20 might have improved
      finalOutcomePhase = 'stuck_b30_no_improvement'; // Or a more nuanced phase like 'b30_stuck_n20_active'
    } else if (n20Stuck && input.simulationMode === "hybrid") { // Hybrid mode, N20 stuck
      finalOutcomePhase = 'stuck_n20_no_improvement';
    } else { // Default if target not reached and not explicitly stuck (e.g. max iterations)
      finalOutcomePhase = 'simulating'; // Or a new 'max_iterations_reached' phase
    }
  }
  log.push(`[RUN_SIMULATION] Finished. Final Phase: ${finalOutcomePhase}. Overall Rating: ${currentOverallRating.toFixed(4)}`);

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

// Helper to calculate average rating for a list
// isSimulatingThisList: boolean to indicate if we should use targetRating (true) or currentRating (false, for fixed lists)
function calculateAverageRating(songs: Song[], count: number, isSimulatingThisList: boolean): number | null {
  if (!songs || songs.length === 0) return null;

  const songsForAverage = songs.map(s => ({
      ...s,
      // Use targetRating if this list is being actively simulated, otherwise use currentRating (as it's fixed)
      ratingToConsider: isSimulatingThisList ? s.targetRating : s.currentRating
  }));

  const topSongs = [...songsForAverage].sort((a, b) => b.ratingToConsider - a.ratingToConsider).slice(0, count);

  if (topSongs.length === 0) return 0;
  const sum = topSongs.reduce((acc, s) => acc + s.ratingToConsider, 0);
  return parseFloat((sum / topSongs.length).toFixed(4));
}

// Helper to calculate overall rating
function calculateOverallRating(
  avgB30: number | null,
  avgN20: number | null,
  actualB30Count: number,
  actualN20Count: number
): number {
  if (avgB30 === null || actualB30Count === 0) return 0;

  const effectiveB30Count = Math.min(actualB30Count, BEST_COUNT);
  const effectiveN20Count = Math.min(actualN20Count, NEW_20_COUNT);

  if (avgN20 !== null && effectiveN20Count > 0 && effectiveB30Count > 0) {
     const totalRatingSum = (avgB30 * effectiveB30Count) + (avgN20 * effectiveN20Count);
     const totalSongCount = effectiveB30Count + effectiveN20Count;
     if (totalSongCount === 0) return 0;
     return parseFloat((totalRatingSum / totalSongCount).toFixed(4));
  }
  // If N20 is not applicable or empty, or B30 is not full, overall rating might just be B30 avg.
  // Or, if B30 is not full, it might be just that sum / actualB30Count
  if (effectiveB30Count > 0) {
    return avgB30; // This assumes avgB30 is calculated based on effectiveB30Count if not full
  }
  return 0;
}


// Internal helper to run a specific phase (leap, fine_tune, replace) for a given list
function _performListSimulationPhase(
  currentSongsInput: Song[], // This is the list to be modified (either B30 or N20)
  phaseType: 'leap' | 'fine_tune' | 'replace',
  input: SimulationInput, // Contains all original data and parameters
  log: string[],
  listType: 'b30' | 'n20',
  currentAverageForList: number | null // Average of targetRatings for the list being simulated
): { updatedSongs: Song[]; songsChangedCount: number; stuck: boolean } {
  let updatedSongs = JSON.parse(JSON.stringify(currentSongsInput)) as Song[];
  let songsChangedCount = 0;
  let phaseIsStuck = true;

  const listName = listType === 'b30' ? "B30" : "N20";
  log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}] Starting. Current avg for list: ${currentAverageForList?.toFixed(4)}. Algo: ${input.algorithmPreference}`);

  const scoreCap = input.isScoreLimitReleased ? 1010000 : MAX_SCORE_NORMAL;

  const updatableSongs = updatedSongs.filter(song => song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);

  if (updatableSongs.length === 0 && phaseType !== 'replace') {
    log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}] No updatable songs.`);
    return { updatedSongs, songsChangedCount, stuck: true };
  }

  let sortedCandidates: Song[] = [];
  if (input.algorithmPreference === 'floor') {
    sortedCandidates = [...updatableSongs].sort((a, b) => {
      const aIsHighConst = isSongHighConstantForFloor(a, currentAverageForList);
      const bIsHighConst = isSongHighConstantForFloor(b, currentAverageForList);
      if (aIsHighConst !== bIsHighConst) return aIsHighConst ? 1 : -1;
      const constA = a.chartConstant ?? Infinity;
      const constB = b.chartConstant ?? Infinity;
      if (constA !== constB) return constA - constB; // Lower const first
      if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating; // Lower rating first
      return a.targetScore - b.targetScore; // Lower score first
    });
  } else { // peak strategy
    sortedCandidates = [...updatableSongs].sort((a, b) => {
      if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating; // Higher rating first
      return b.targetScore - a.targetScore; // Higher score first
    });
  }
  if (updatableSongs.length > 0) {
      log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}] Sorted ${sortedCandidates.length} candidates. Top candidate (for improvement): ${sortedCandidates[0]?.title || 'N/A'} (Rating: ${sortedCandidates[0]?.targetRating.toFixed(4)})`);
  }


  if (phaseType === 'leap') {
    if (sortedCandidates.length > 0) {
      const songToAttemptLeap = sortedCandidates[0];
      const nextGradeScore = getNextGradeBoundaryScore(songToAttemptLeap.targetScore);
      if (nextGradeScore && songToAttemptLeap.chartConstant && songToAttemptLeap.targetScore < nextGradeScore && nextGradeScore <= scoreCap) {
        const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, songToAttemptLeap.chartConstant);
        if (potentialRatingAtNextGrade > songToAttemptLeap.targetRating + 0.00005) {
          const songIndex = updatedSongs.findIndex(s => s.id === songToAttemptLeap.id && s.diff === songToAttemptLeap.diff);
          if (songIndex !== -1) {
            updatedSongs[songIndex] = { ...songToAttemptLeap, targetScore: nextGradeScore, targetRating: parseFloat(potentialRatingAtNextGrade.toFixed(4)) };
            songsChangedCount++; phaseIsStuck = false;
            log.push(`[${listName}_LEAP] Leaped ${songToAttemptLeap.title} to score ${nextGradeScore}, new rating ${potentialRatingAtNextGrade.toFixed(4)}`);
          }
        } else { log.push(`[${listName}_LEAP] Leap for ${songToAttemptLeap.title} not efficient.`); }
      } else { log.push(`[${listName}_LEAP] ${songToAttemptLeap.title} cannot leap or no const.`); }
    } else { log.push(`[${listName}_LEAP] No candidates for leap.`); }
  }
  else if (phaseType === 'fine_tune') {
    for (const candidateSong of sortedCandidates) { // Iterate based on floor/peak preference
      const songIndex = updatedSongs.findIndex(s => s.id === candidateSong.id && s.diff === candidateSong.diff);
      if (songIndex === -1) continue;
      let currentSongInSim = updatedSongs[songIndex];
      if (currentSongInSim.targetScore < scoreCap && currentSongInSim.chartConstant) {
        const targetMicroTuneRating = currentSongInSim.targetRating + 0.0001;
        const minScoreInfo = findMinScoreForTargetRating(currentSongInSim, targetMicroTuneRating, input.isScoreLimitReleased);
        if (minScoreInfo.possible && minScoreInfo.score > currentSongInSim.targetScore && minScoreInfo.score <= scoreCap) {
          updatedSongs[songIndex] = { ...currentSongInSim, targetScore: minScoreInfo.score, targetRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
          songsChangedCount++; phaseIsStuck = false;
          log.push(`[${listName}_FINETUNE] Tuned ${currentSongInSim.title} to score ${minScoreInfo.score}, new rating ${minScoreInfo.rating.toFixed(4)}`);
          break;
        }
      }
    }
    if (songsChangedCount === 0) log.push(`[${listName}_FINETUNE] No songs were fine-tuned.`);
  }
  else if (phaseType === 'replace') {
    const listLimit = listType === 'b30' ? BEST_COUNT : NEW_20_COUNT;
    let songToReplace: Song | undefined = undefined;

    if (updatedSongs.length >= listLimit) { // Only replace if list is full
        songToReplace = [...updatedSongs].sort((a, b) => a.targetRating - b.targetRating)[0]; // Replace lowest targetRating
    } else if (updatedSongs.length < listLimit && listType === 'n20') {
        // N20 list is not full, try to add from allPlayedNewSongsPool first
        const currentN20IdsAndDiffs = new Set(updatedSongs.map(s => `${s.id}_${s.diff}`));
        const potentialAdditions = input.allPlayedNewSongsPool
            .filter(poolSong => !currentN20IdsAndDiffs.has(`${poolSong.id}_${poolSong.diff}`))
            .sort((a,b) => b.currentRating - a.currentRating); // Add highest current rating first

        if (potentialAdditions.length > 0) {
            const songToAdd = potentialAdditions[0];
            // Add with its current score/rating as target, simulation will improve it later
            updatedSongs.push({...songToAdd, targetScore: songToAdd.currentScore, targetRating: songToAdd.currentRating });
            updatedSongs = sortSongsByRatingDesc(updatedSongs.map(s_1 => ({...s_1, currentRating: s_1.targetRating}))).slice(0, listLimit);
            songsChangedCount++; phaseIsStuck = false;
            log.push(`[${listName}_REPLACE_ADD] Added ${songToAdd.title} to fill ${listName}. New count: ${updatedSongs.length}`);
            // Skip actual replacement if a song was added
            return { updatedSongs, songsChangedCount, stuck: phaseIsStuck };
        } else {
            log.push(`[${listName}_REPLACE_ADD] ${listName} not full, but no more unique songs in pool to add.`);
            // Proceed to check if replacement is possible if list is full (though it shouldn't be if we are in this block)
            // Or, if it IS full after an add that didn't happen, then songToReplace logic below will trigger
            if (updatedSongs.length >= listLimit) {
                 songToReplace = [...updatedSongs].sort((a, b) => a.targetRating - b.targetRating)[0];
            }
        }
    }


    if (!songToReplace && updatedSongs.length >= listLimit) { // Should have been set if list was full
        log.push(`[${listName}_REPLACE] List is full but failed to identify song to replace. This is unexpected.`);
        return { updatedSongs, songsChangedCount, stuck: true };
    }
    if (!songToReplace) { // List is not full (for B30, or N20 after trying to add) and no song to replace
        log.push(`[${listName}_REPLACE] No song to replace (list might not be full or no suitable candidate).`);
        return { updatedSongs, songsChangedCount, stuck: true }; // Stuck if no add and no replace
    }

    log.push(`[${listName}_REPLACE] Attempting to replace ${songToReplace.title} (Rating: ${songToReplace.targetRating.toFixed(4)})`);
    let replacementSource: Song[] = [];
    const currentSimulatedIdsAndDiffs = new Set(updatedSongs.map(s => `${s.id}_${s.diff}`));

    if (listType === 'b30') {
      const fixedN20Ids = input.simulationMode === "b30_only" ? new Set(input.originalNew20Songs.map(s => `${s.id}_${s.diff}`)) : new Set<string>();
      replacementSource = input.allMusicData
        .filter(globalSong => {
          if (!globalSong.id || !globalSong.diff || !globalSong.title) return false;
          const globalSongKey = `${globalSong.id}_${globalSong.diff.toUpperCase()}`;
          if (currentSimulatedIdsAndDiffs.has(globalSongKey)) return false;
          if (input.simulationMode === "b30_only" && fixedN20Ids.has(globalSongKey)) return false; // Exclude fixed N20 songs

          const tempSongObj = mapApiSongToAppSong(globalSong, 0, globalSong.const);
          if (!tempSongObj.chartConstant) return false;
          const potentialMaxRating = calculateChunithmSongRating(scoreCap, tempSongObj.chartConstant);
          return potentialMaxRating > songToReplace!.targetRating; // songToReplace is defined here
        })
        .map(apiEntry => {
          const playedVersion = input.userPlayHistory.find(p => p.id === apiEntry.id && p.diff.toUpperCase() === apiEntry.diff.toUpperCase());
          return mapApiSongToAppSong(playedVersion || { ...apiEntry, score: 0, rating: 0 }, 0, apiEntry.const);
        })
        .filter(song => song.chartConstant !== null);
    } else { // N20 replacement
      replacementSource = input.allPlayedNewSongsPool
        .filter(poolSong => {
            if (currentSimulatedIdsAndDiffs.has(`${poolSong.id}_${poolSong.diff}`)) return false;
            if (!poolSong.chartConstant) return false;
            const potentialMaxRating = calculateChunithmSongRating(scoreCap, poolSong.chartConstant);
            return potentialMaxRating > songToReplace!.targetRating; // songToReplace is defined here
        });
    }
    log.push(`[${listName}_REPLACE] Found ${replacementSource.length} potential candidates from source.`);

    let bestCandidateForReplacement: (Song & { neededScore: number; resultingRating: number }) | null = null;
    let minEffort = Infinity;

    for (const candidate of replacementSource) {
      if (!candidate.chartConstant) continue;
      const targetRatingForCandidate = songToReplace.targetRating + 0.0001;
      const minScoreInfo = findMinScoreForTargetRating(candidate, targetRatingForCandidate, input.isScoreLimitReleased);
      if (minScoreInfo.possible && minScoreInfo.score <= scoreCap) {
        const effort = candidate.currentScore > 0 ? (minScoreInfo.score - candidate.currentScore) : minScoreInfo.score + 1000000;
        if (effort < minEffort) {
          minEffort = effort;
          bestCandidateForReplacement = { ...candidate, neededScore: minScoreInfo.score, resultingRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
        } else if (effort === minEffort && bestCandidateForReplacement && minScoreInfo.rating > bestCandidateForReplacement.resultingRating) {
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
      updatedSongs = sortSongsByRatingDesc(updatedSongs.map(s_2 => ({...s_2, currentRating: s_2.targetRating}))).slice(0, listLimit);
      songsChangedCount++; phaseIsStuck = false;
      log.push(`[${listName}_REPLACE] Replaced ${songToReplace!.title} with ${bestCandidateForReplacement.title}. New score: ${bestCandidateForReplacement.neededScore}, new rating: ${bestCandidateForReplacement.resultingRating.toFixed(4)}`);
    } else {
      log.push(`[${listName}_REPLACE] No suitable replacement found for ${songToReplace!.title}.`);
    }
  }

  log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}] Ended. Songs changed: ${songsChangedCount}. Stuck: ${phaseIsStuck}`);
  return { updatedSongs, songsChangedCount, stuck: phaseIsStuck };
}

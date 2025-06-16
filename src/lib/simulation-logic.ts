
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
const MAX_ITERATIONS_PER_LIST = 200;

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
  log.push(`[RUN_SIMULATION_START] Target: ${input.targetRating.toFixed(4)}, Scope: ${input.simulationScope}, Method: ${input.improvementMethod}, Current Rating: ${input.currentRating.toFixed(4)}`);

  let currentSimulatedB30Songs: Song[];
  let currentSimulatedNew20Songs: Song[];

  if (input.simulationScope === "b30_only") {
    currentSimulatedB30Songs = JSON.parse(JSON.stringify(input.originalB30Songs));
    currentSimulatedNew20Songs = JSON.parse(JSON.stringify(input.originalNew20Songs.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating }))));
    log.push(`[INIT] B30_ONLY mode. Original B30 count: ${currentSimulatedB30Songs.length}, Fixed N20 count: ${currentSimulatedNew20Songs.length}`);
  } else if (input.simulationScope === "n20_only") {
    currentSimulatedB30Songs = JSON.parse(JSON.stringify(input.originalB30Songs.map(s => ({...s, targetScore: s.currentScore, targetRating: s.currentRating }))));
    currentSimulatedNew20Songs = JSON.parse(JSON.stringify(input.originalNew20Songs));
    log.push(`[INIT] N20_ONLY mode. Fixed B30 count: ${currentSimulatedB30Songs.length}, Original N20 count: ${currentSimulatedNew20Songs.length}`);
  } else { // hybrid mode
    currentSimulatedB30Songs = JSON.parse(JSON.stringify(input.originalB30Songs));
    currentSimulatedNew20Songs = JSON.parse(JSON.stringify(input.originalNew20Songs));
    log.push(`[INIT] HYBRID mode. Original B30 count: ${currentSimulatedB30Songs.length}, Original N20 count: ${currentSimulatedNew20Songs.length}`);
  }

  let currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, input.simulationScope === "b30_only" || input.simulationScope === "hybrid");
  let currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, input.simulationScope === "n20_only" || input.simulationScope === "hybrid");
  let currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);

  log.push(`[INITIAL_STATE] B30 Avg: ${currentAverageB30Rating?.toFixed(4) || 'N/A'}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4) || 'N/A'}, Overall: ${currentOverallRating.toFixed(4)}`);

  let finalOutcomePhase: SimulationPhase = 'simulating';
  
  let b30Stuck = input.simulationScope === "n20_only"; 
  let b30Iterations = 0;

  if ((input.simulationScope === "b30_only" || input.simulationScope === "hybrid") && currentOverallRating < input.targetRating) {
    log.push("--- Starting B30 Simulation Cycle ---");
    while (currentOverallRating < input.targetRating && !b30Stuck && b30Iterations < MAX_ITERATIONS_PER_LIST) {
      b30Iterations++;
      const previousOverallRatingForB30Cycle = currentOverallRating;
      log.push(`[B30_ITERATION ${b30Iterations}/${MAX_ITERATIONS_PER_LIST}] Current Overall: ${currentOverallRating.toFixed(4)}, B30 Avg: ${currentAverageB30Rating?.toFixed(4)}`);

      log.push(`[B30_ITER ${b30Iterations}] === PRE-LEAP === Overall: ${currentOverallRating.toFixed(4)}, B30 Avg: ${currentAverageB30Rating?.toFixed(4)}`);
      const leapResultB30 = _performListSimulationPhase(currentSimulatedB30Songs, 'leap', input, log, 'b30', currentAverageB30Rating);
      currentSimulatedB30Songs = leapResultB30.updatedSongs;
      currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      log.push(`[B30_ITER ${b30Iterations}] === POST-LEAP === Overall: ${currentOverallRating.toFixed(4)}, B30 Avg: ${currentAverageB30Rating?.toFixed(4)}. Changed: ${leapResultB30.songsChangedCount > 0}, Stuck: ${leapResultB30.stuck}`);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

      log.push(`[B30_ITER ${b30Iterations}] === PRE-FINETUNE === Overall: ${currentOverallRating.toFixed(4)}, B30 Avg: ${currentAverageB30Rating?.toFixed(4)}`);
      const fineTuneResultB30 = _performListSimulationPhase(currentSimulatedB30Songs, 'fine_tune', input, log, 'b30', currentAverageB30Rating);
      currentSimulatedB30Songs = fineTuneResultB30.updatedSongs;
      currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      log.push(`[B30_ITER ${b30Iterations}] === POST-FINETUNE === Overall: ${currentOverallRating.toFixed(4)}, B30 Avg: ${currentAverageB30Rating?.toFixed(4)}. Changed: ${fineTuneResultB30.songsChangedCount > 0}, Stuck: ${fineTuneResultB30.stuck}`);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

      if (Math.abs(currentOverallRating - previousOverallRatingForB30Cycle) < 0.00001 && leapResultB30.stuck && fineTuneResultB30.stuck) {
        log.push(`[B30_ITER ${b30Iterations}] B30 stuck (Leap & FineTune). Attempting replacement. Overall: ${currentOverallRating.toFixed(4)}`);
        log.push(`[B30_ITER ${b30Iterations}] === PRE-REPLACE === Overall: ${currentOverallRating.toFixed(4)}, B30 Avg: ${currentAverageB30Rating?.toFixed(4)}`);
        const replacementResultB30 = _performListSimulationPhase(currentSimulatedB30Songs, 'replace', input, log, 'b30', currentAverageB30Rating);
        currentSimulatedB30Songs = replacementResultB30.updatedSongs;
        currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT, true);
        currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
        log.push(`[B30_ITER ${b30Iterations}] === POST-REPLACE === Overall: ${currentOverallRating.toFixed(4)}, B30 Avg: ${currentAverageB30Rating?.toFixed(4)}. Changed: ${replacementResultB30.songsChangedCount > 0}, Stuck: ${replacementResultB30.stuck}`);
        if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
        if (replacementResultB30.stuck || replacementResultB30.songsChangedCount === 0) {
          log.push(`[B30_STUCK] B30 simulation cycle could not make further progress via replacement.`);
          b30Stuck = true;
        }
      } else if (Math.abs(currentOverallRating - previousOverallRatingForB30Cycle) < 0.00001) {
          log.push(`[B30_STUCK] B30 simulation cycle made no progress on overall rating. Delta: ${(currentOverallRating - previousOverallRatingForB30Cycle).toFixed(6)}`);
          b30Stuck = true;
      }
    }
    if (b30Iterations >= MAX_ITERATIONS_PER_LIST && currentOverallRating < input.targetRating) {
      log.push(`[B30_MAX_ITER] Reached max B30 iterations (${MAX_ITERATIONS_PER_LIST}). Current Overall: ${currentOverallRating.toFixed(4)}`);
      b30Stuck = true;
    }
    if (finalOutcomePhase !== 'target_reached') {
        log.push(`[B30_CYCLE_END] B30 cycle finished. Stuck: ${b30Stuck}. Overall: ${currentOverallRating.toFixed(4)}`);
    }
  }

  let n20Stuck = input.simulationScope === "b30_only"; 
  let n20Iterations = 0;

  if ((input.simulationScope === "n20_only" || input.simulationScope === "hybrid") && finalOutcomePhase !== 'target_reached' && currentOverallRating < input.targetRating) {
    log.push("--- Starting N20 Simulation Cycle ---");
    while (currentOverallRating < input.targetRating && !n20Stuck && n20Iterations < MAX_ITERATIONS_PER_LIST) {
      n20Iterations++;
      const previousOverallRatingForN20Cycle = currentOverallRating;
      log.push(`[N20_ITERATION ${n20Iterations}/${MAX_ITERATIONS_PER_LIST}] Current Overall: ${currentOverallRating.toFixed(4)}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}`);

      log.push(`[N20_ITER ${n20Iterations}] === PRE-LEAP === Overall: ${currentOverallRating.toFixed(4)}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}`);
      const leapResultN20 = _performListSimulationPhase(currentSimulatedNew20Songs, 'leap', input, log, 'n20', currentAverageNew20Rating);
      currentSimulatedNew20Songs = leapResultN20.updatedSongs;
      currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      log.push(`[N20_ITER ${n20Iterations}] === POST-LEAP === Overall: ${currentOverallRating.toFixed(4)}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}. Changed: ${leapResultN20.songsChangedCount > 0}, Stuck: ${leapResultN20.stuck}`);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

      log.push(`[N20_ITER ${n20Iterations}] === PRE-FINETUNE === Overall: ${currentOverallRating.toFixed(4)}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}`);
      const fineTuneResultN20 = _performListSimulationPhase(currentSimulatedNew20Songs, 'fine_tune', input, log, 'n20', currentAverageNew20Rating);
      currentSimulatedNew20Songs = fineTuneResultN20.updatedSongs;
      currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
      log.push(`[N20_ITER ${n20Iterations}] === POST-FINETUNE === Overall: ${currentOverallRating.toFixed(4)}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}. Changed: ${fineTuneResultN20.songsChangedCount > 0}, Stuck: ${fineTuneResultN20.stuck}`);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

      if (Math.abs(currentOverallRating - previousOverallRatingForN20Cycle) < 0.00001 && leapResultN20.stuck && fineTuneResultN20.stuck) {
        log.push(`[N20_ITER ${n20Iterations}] N20 stuck (Leap & FineTune). Attempting replacement. Overall: ${currentOverallRating.toFixed(4)}`);
        log.push(`[N20_ITER ${n20Iterations}] === PRE-REPLACE === Overall: ${currentOverallRating.toFixed(4)}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}`);
        const replacementResultN20 = _performListSimulationPhase(currentSimulatedNew20Songs, 'replace', input, log, 'n20', currentAverageNew20Rating);
        currentSimulatedNew20Songs = replacementResultN20.updatedSongs;
        currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT, true);
        currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, currentSimulatedB30Songs.length, currentSimulatedNew20Songs.length);
        log.push(`[N20_ITER ${n20Iterations}] === POST-REPLACE === Overall: ${currentOverallRating.toFixed(4)}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}. Changed: ${replacementResultN20.songsChangedCount > 0}, Stuck: ${replacementResultN20.stuck}`);
        if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
        if (replacementResultN20.stuck || replacementResultN20.songsChangedCount === 0) {
          log.push(`[N20_STUCK] N20 simulation cycle could not make further progress via replacement.`);
          n20Stuck = true;
        }
      } else if (Math.abs(currentOverallRating - previousOverallRatingForN20Cycle) < 0.00001) {
          log.push(`[N20_STUCK] N20 simulation cycle made no progress on overall rating. Delta: ${(currentOverallRating - previousOverallRatingForN20Cycle).toFixed(6)}`);
          n20Stuck = true;
      }
    }
    if (n20Iterations >= MAX_ITERATIONS_PER_LIST && currentOverallRating < input.targetRating) {
      log.push(`[N20_MAX_ITER] Reached max N20 iterations (${MAX_ITERATIONS_PER_LIST}). Current Overall: ${currentOverallRating.toFixed(4)}`);
      n20Stuck = true;
    }
     if (finalOutcomePhase !== 'target_reached') {
        log.push(`[N20_CYCLE_END] N20 cycle finished. Stuck: ${n20Stuck}. Overall: ${currentOverallRating.toFixed(4)}`);
    }
  }

  if (finalOutcomePhase !== 'target_reached') {
    if (b30Stuck && (input.simulationScope === 'b30_only' || (input.simulationScope === 'hybrid' && (n20Stuck || input.simulationScope !== 'n20_only')))) {
      finalOutcomePhase = 'stuck_b30_no_improvement';
    }
    if (n20Stuck && (input.simulationScope === 'n20_only' || (input.simulationScope === 'hybrid' && (b30Stuck || input.simulationScope !== 'b30_only')))) {
       finalOutcomePhase = (finalOutcomePhase === 'stuck_b30_no_improvement') ? 'stuck_both_no_improvement' : 'stuck_n20_no_improvement';
    }
     if (finalOutcomePhase === 'simulating' && b30Stuck && n20Stuck && input.simulationScope === 'hybrid') {
      finalOutcomePhase = 'stuck_both_no_improvement';
    }
  }
  
  log.push(`[RUN_SIMULATION_END] Final Phase: ${finalOutcomePhase}. Overall Rating: ${currentOverallRating.toFixed(4)}. B30 Avg: ${currentAverageB30Rating?.toFixed(4)}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}`);

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
function calculateAverageRating(songs: Song[], count: number, isSimulatingThisList: boolean): number | null {
  if (!songs || songs.length === 0) return null;

  const songsForAverage = songs.map(s => ({
      ...s,
      ratingToConsider: isSimulatingThisList ? s.targetRating : s.currentRating
  }));

  const topSongs = [...songsForAverage].sort((a, b) => b.ratingToConsider - a.ratingToConsider).slice(0, count);

  if (topSongs.length === 0) return 0; // Return 0 if no songs to average (e.g. count is 0 or list is empty)
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
  const effectiveB30Count = Math.min(actualB30Count, BEST_COUNT);
  const b30Sum = (avgB30 ?? 0) * effectiveB30Count;

  const effectiveN20Count = Math.min(actualN20Count, NEW_20_COUNT);
  const n20Sum = (avgN20 ?? 0) * effectiveN20Count;
  
  const totalEffectiveSongs = effectiveB30Count + effectiveN20Count;

  if (totalEffectiveSongs === 0) return 0;
  return parseFloat(((b30Sum + n20Sum) / totalEffectiveSongs).toFixed(4));
}


// Internal helper to run a specific phase (leap, fine_tune, replace) for a given list
function _performListSimulationPhase(
  currentSongsInput: Song[], 
  phaseType: 'leap' | 'fine_tune' | 'replace',
  input: SimulationInput, 
  log: string[],
  listType: 'b30' | 'n20',
  currentAverageForList: number | null 
): { updatedSongs: Song[]; songsChangedCount: number; stuck: boolean } {
  let updatedSongs = JSON.parse(JSON.stringify(currentSongsInput)) as Song[];
  let songsChangedCount = 0;
  let phaseIsStuck = true;

  const listName = listType === 'b30' ? "B30" : "N20";
  const listLimit = listType === 'b30' ? BEST_COUNT : NEW_20_COUNT;
  log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}_START] Current avg for list: ${currentAverageForList?.toFixed(4) || 'N/A'}. Algo: ${input.improvementMethod}. Songs in list: ${updatedSongs.length}`);

  const scoreCap = input.isScoreLimitReleased ? 1010000 : MAX_SCORE_NORMAL;

  const updatableSongs = updatedSongs.filter(song => song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);
  log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}] Found ${updatableSongs.length} updatable songs (targetScore < ${scoreCap} & has const).`);

  if (updatableSongs.length === 0 && phaseType !== 'replace') {
    log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}] No updatable songs for leap/fine_tune.`);
    return { updatedSongs, songsChangedCount, stuck: true };
  }

  let sortedCandidates: Song[] = [];
  if (input.improvementMethod === 'floor') {
    sortedCandidates = [...updatableSongs].sort((a, b) => {
      const aIsHighConst = isSongHighConstantForFloor(a, currentAverageForList);
      const bIsHighConst = isSongHighConstantForFloor(b, currentAverageForList);
      if (aIsHighConst !== bIsHighConst) return aIsHighConst ? 1 : -1; // Songs that are NOT high const first
      const constA = a.chartConstant ?? Infinity;
      const constB = b.chartConstant ?? Infinity;
      if (constA !== constB) return constA - constB; 
      if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating; 
      return a.targetScore - b.targetScore; 
    });
  } else { // peak strategy
    sortedCandidates = [...updatableSongs].sort((a, b) => {
      if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating; // Higher rating first
      return b.targetScore - a.targetScore; // Higher score first
    });
  }
  if (sortedCandidates.length > 0) {
      log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}] Sorted ${sortedCandidates.length} candidates. Top: ${sortedCandidates[0]?.title} (TgtRating: ${sortedCandidates[0]?.targetRating.toFixed(4)}, TgtScore: ${sortedCandidates[0]?.targetScore}, Const: ${sortedCandidates[0]?.chartConstant})`);
  }


  if (phaseType === 'leap') {
    if (sortedCandidates.length > 0) {
      const songToAttemptLeap = sortedCandidates[0];
      log.push(`[${listName}_LEAP] Attempting leap for: ${songToAttemptLeap.title} (Current TgtScore: ${songToAttemptLeap.targetScore})`);
      const nextGradeScore = getNextGradeBoundaryScore(songToAttemptLeap.targetScore);
      if (nextGradeScore && songToAttemptLeap.chartConstant && songToAttemptLeap.targetScore < nextGradeScore && nextGradeScore <= scoreCap) {
        const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, songToAttemptLeap.chartConstant);
        if (potentialRatingAtNextGrade > songToAttemptLeap.targetRating + 0.00005) { // Ensure meaningful increase
          const songIndex = updatedSongs.findIndex(s => s.id === songToAttemptLeap.id && s.diff === songToAttemptLeap.diff);
          if (songIndex !== -1) {
            updatedSongs[songIndex] = { ...songToAttemptLeap, targetScore: nextGradeScore, targetRating: parseFloat(potentialRatingAtNextGrade.toFixed(4)) };
            songsChangedCount++; phaseIsStuck = false;
            log.push(`[${listName}_LEAP_SUCCESS] Leaped ${songToAttemptLeap.title} to score ${nextGradeScore}, new target rating ${potentialRatingAtNextGrade.toFixed(4)}`);
          }
        } else { log.push(`[${listName}_LEAP_INEFFICIENT] Leap for ${songToAttemptLeap.title} to ${nextGradeScore} not efficient (Rating ${potentialRatingAtNextGrade.toFixed(4)} vs current target ${songToAttemptLeap.targetRating.toFixed(4)}).`); }
      } else { log.push(`[${listName}_LEAP_NO_LEAP] ${songToAttemptLeap.title} cannot leap (Next grade: ${nextGradeScore}, Const: ${songToAttemptLeap.chartConstant}, Score cap: ${scoreCap}).`); }
    } else { log.push(`[${listName}_LEAP_NO_CANDIDATES] No candidates for leap.`); }
  }
  else if (phaseType === 'fine_tune') {
    let fineTuneAttempts = 0;
    for (const candidateSong of sortedCandidates) { 
      fineTuneAttempts++;
      const songIndex = updatedSongs.findIndex(s => s.id === candidateSong.id && s.diff === candidateSong.diff);
      if (songIndex === -1) continue;
      let currentSongInSim = updatedSongs[songIndex];
      if (currentSongInSim.targetScore < scoreCap && currentSongInSim.chartConstant) {
        const targetMicroTuneRating = currentSongInSim.targetRating + 0.0001;
        const minScoreInfo = findMinScoreForTargetRating(currentSongInSim, targetMicroTuneRating, input.isScoreLimitReleased);
        if (minScoreInfo.possible && minScoreInfo.score > currentSongInSim.targetScore && minScoreInfo.score <= scoreCap) {
          updatedSongs[songIndex] = { ...currentSongInSim, targetScore: minScoreInfo.score, targetRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
          songsChangedCount++; phaseIsStuck = false;
          log.push(`[${listName}_FINETUNE_SUCCESS] Tuned ${currentSongInSim.title} (attempt ${fineTuneAttempts}/${sortedCandidates.length}) to score ${minScoreInfo.score}, new target rating ${minScoreInfo.rating.toFixed(4)}`);
          break; // Found one song to fine-tune, exit loop for this phase pass
        }
      }
    }
    if (songsChangedCount === 0) log.push(`[${listName}_FINETUNE_NO_CHANGE] No songs were fine-tuned after ${fineTuneAttempts} attempts.`);
  }
  else if (phaseType === 'replace') {
    let songToReplace: Song | undefined = undefined;

    if (updatedSongs.length >= listLimit) { 
        songToReplace = [...updatedSongs].sort((a, b) => a.targetRating - b.targetRating)[0]; 
        log.push(`[${listName}_REPLACE_INFO] List full. Weakest song for potential replacement: ${songToReplace.title} (TgtRating: ${songToReplace.targetRating.toFixed(4)})`);
    } else if (updatedSongs.length < listLimit && listType === 'n20') { // Specific logic for N20 to add if not full
        const currentN20IdsAndDiffs = new Set(updatedSongs.map(s => `${s.id}_${s.diff}`));
        const potentialAdditions = input.allPlayedNewSongsPool
            .filter(poolSong => !currentN20IdsAndDiffs.has(`${poolSong.id}_${poolSong.diff}`))
            .sort((a,b) => b.currentRating - a.currentRating); 

        if (potentialAdditions.length > 0) {
            const songToAdd = potentialAdditions[0];
            log.push(`[${listName}_REPLACE_ADD] N20 list not full (${updatedSongs.length}/${listLimit}). Adding ${songToAdd.title} (CurrentRating: ${songToAdd.currentRating.toFixed(4)})`);
            updatedSongs.push({...songToAdd, targetScore: songToAdd.currentScore, targetRating: songToAdd.currentRating });
            // Re-sort based on targetRating and slice to ensure listLimit is maintained
            updatedSongs = sortSongsByRatingDesc(updatedSongs.map(s_1 => ({...s_1, currentRating: s_1.targetRating /* Use targetRating for sorting */ }))).slice(0, listLimit);
            songsChangedCount++; phaseIsStuck = false;
            log.push(`[${listName}_REPLACE_ADD_SUCCESS] Added ${songToAdd.title}. New N20 count: ${updatedSongs.length}`);
            return { updatedSongs, songsChangedCount, stuck: phaseIsStuck }; // Added song, so phase is done
        } else {
            log.push(`[${listName}_REPLACE_ADD_FAIL] N20 not full, but no more unique songs in allPlayedNewSongsPool to add.`);
            // If still not full, there's nothing to replace from outside.
            // If it became full due to other operations, songToReplace might be set below.
             if (updatedSongs.length >= listLimit) { // Check if list became full by some other means
                songToReplace = [...updatedSongs].sort((a, b) => a.targetRating - b.targetRating)[0];
                log.push(`[${listName}_REPLACE_INFO] List now full after checks. Weakest song: ${songToReplace.title} (TgtRating ${songToReplace.targetRating.toFixed(4)})`);
            }
        }
    }


    if (!songToReplace) { 
        log.push(`[${listName}_REPLACE_NO_TARGET] No song to replace (list might not be full for B30, or no suitable N20 addition and N20 not full). Cannot proceed with replacement search.`);
        return { updatedSongs, songsChangedCount, stuck: true }; 
    }
    
    log.push(`[${listName}_REPLACE_SEARCH] Attempting to find replacement for ${songToReplace.title} (TgtRating: ${songToReplace.targetRating.toFixed(4)})`);
    let replacementSource: Song[] = [];
    const currentSimulatedIdsAndDiffs = new Set(updatedSongs.map(s => `${s.id}_${s.diff}`));

    if (listType === 'b30') {
      const fixedN20Ids = input.simulationScope === "b30_only" ? new Set(input.originalNew20Songs.map(s => `${s.id}_${s.diff}`)) : new Set<string>();
      replacementSource = input.allMusicData
        .filter(globalSong => {
          if (!globalSong.id || !globalSong.diff || !globalSong.title) return false;
          const globalSongKey = `${globalSong.id}_${globalSong.diff.toUpperCase()}`;
          if (currentSimulatedIdsAndDiffs.has(globalSongKey)) return false; // Already in B30
          if (input.simulationScope === "b30_only" && fixedN20Ids.has(globalSongKey)) return false; // In fixed N20 for B30_only mode

          const tempSongObj = mapApiSongToAppSong(globalSong, 0, globalSong.const);
          if (!tempSongObj.chartConstant) return false; // Must have a constant
          const potentialMaxRating = calculateChunithmSongRating(scoreCap, tempSongObj.chartConstant);
          return potentialMaxRating > songToReplace!.targetRating; // Must be able to beat the song to replace
        })
        .map(apiEntry => {
          const playedVersion = input.userPlayHistory.find(p => p.id === apiEntry.id && p.diff.toUpperCase() === apiEntry.diff.toUpperCase());
          return mapApiSongToAppSong(playedVersion || { ...apiEntry, score: 0, rating: 0 }, 0, apiEntry.const);
        })
        .filter(song => song.chartConstant !== null); // Double ensure constant is present
    } else { // N20 replacement
      replacementSource = input.allPlayedNewSongsPool
        .filter(poolSong => {
            if (currentSimulatedIdsAndDiffs.has(`${poolSong.id}_${poolSong.diff}`)) return false; // Already in N20
            if (!poolSong.chartConstant) return false; // Must have a constant
            const potentialMaxRating = calculateChunithmSongRating(scoreCap, poolSong.chartConstant);
            return potentialMaxRating > songToReplace!.targetRating; // Must be able to beat the song to replace
        });
    }
    log.push(`[${listName}_REPLACE_CANDIDATES] Found ${replacementSource.length} potential replacement candidates from source.`);

    let bestCandidateForReplacement: (Song & { neededScore: number; resultingRating: number }) | null = null;
    let minEffort = Infinity;
    let replacementCandidateIterations = 0;

    for (const candidate of replacementSource) {
      replacementCandidateIterations++;
      if (!candidate.chartConstant) continue;
      const targetRatingForCandidate = songToReplace.targetRating + 0.0001; // Must be slightly better
      const minScoreInfo = findMinScoreForTargetRating(candidate, targetRatingForCandidate, input.isScoreLimitReleased);
      if (minScoreInfo.possible && minScoreInfo.score <= scoreCap) {
        // Effort: lower is better. Prioritize songs already played (lower currentScore).
        // For unplayed songs, add a large penalty to their "effort" to prefer played songs first.
        const effort = candidate.currentScore > 0 ? (minScoreInfo.score - candidate.currentScore) : (minScoreInfo.score + 1000000); 
        
        if (effort < minEffort) {
          minEffort = effort;
          bestCandidateForReplacement = { ...candidate, neededScore: minScoreInfo.score, resultingRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
        } else if (effort === minEffort && bestCandidateForReplacement && minScoreInfo.rating > bestCandidateForReplacement.resultingRating) {
          // If effort is the same, pick the one that results in a higher rating
          bestCandidateForReplacement = { ...candidate, neededScore: minScoreInfo.score, resultingRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
        }
      }
    }
    log.push(`[${listName}_REPLACE_SEARCH_DETAIL] Iterated through ${replacementCandidateIterations} replacement candidates.`);

    if (bestCandidateForReplacement) {
      log.push(`[${listName}_REPLACE_FOUND] Best candidate to replace ${songToReplace!.title}: ${bestCandidateForReplacement.title} (Needs score: ${bestCandidateForReplacement.neededScore}, Potential Rating: ${bestCandidateForReplacement.resultingRating.toFixed(4)})`);
      updatedSongs = updatedSongs.filter(s => !(s.id === songToReplace!.id && s.diff === songToReplace!.diff));
      updatedSongs.push({
        ...bestCandidateForReplacement,
        targetScore: bestCandidateForReplacement.neededScore,
        targetRating: bestCandidateForReplacement.resultingRating,
      });
      // Re-sort based on targetRating and slice to ensure listLimit
      updatedSongs = sortSongsByRatingDesc(updatedSongs.map(s_2 => ({...s_2, currentRating: s_2.targetRating /* Use targetRating for sorting */ }))).slice(0, listLimit);
      songsChangedCount++; phaseIsStuck = false;
      log.push(`[${listName}_REPLACE_SUCCESS] Replaced ${songToReplace!.title} with ${bestCandidateForReplacement.title}. New list size: ${updatedSongs.length}`);
    } else {
      log.push(`[${listName}_REPLACE_FAIL] No suitable replacement found for ${songToReplace!.title}.`);
    }
  }

  log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}_END] Songs changed: ${songsChangedCount}. Stuck: ${phaseIsStuck}`);
  return { updatedSongs, songsChangedCount, stuck: phaseIsStuck };
}


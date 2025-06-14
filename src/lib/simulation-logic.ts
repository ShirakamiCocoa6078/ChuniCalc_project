
// src/lib/simulation-logic.ts
import type {
  Song,
  ShowallApiSongEntry,
  CalculationStrategy,
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
} from './rating-utils'; // Assuming rating-utils is also pure
import NewSongsData from '@/data/NewSongs.json';

const BEST_COUNT = 30;
const NEW_20_COUNT = 20;

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
  log.push(`[RUN_SIMULATION] Started. Target: ${input.targetRating.toFixed(4)}, Strategy: ${input.calculationStrategy}`);

  let currentSimulatedB30Songs = JSON.parse(JSON.stringify(input.originalB30Songs)) as Song[];
  let currentSimulatedNew20Songs = JSON.parse(JSON.stringify(input.originalNew20Songs)) as Song[];
  
  let currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT);
  let currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT);
  let currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, input.originalB30Songs.length, input.originalNew20Songs.length);
  
  log.push(`[INITIAL_STATE] B30 Avg: ${currentAverageB30Rating?.toFixed(4) || 'N/A'}, N20 Avg: ${currentAverageNew20Rating?.toFixed(4) || 'N/A'}, Overall: ${currentOverallRating.toFixed(4)}`);

  let finalOutcomePhase: SimulationPhase = 'simulating';

  // --- B30 Simulation Cycle ---
  log.push("--- Starting B30 Simulation Cycle ---");
  let b30Stuck = false;
  let b30Iterations = 0;
  const MAX_ITERATIONS_PER_LIST = 1000; // Safety break

  while (currentOverallRating < input.targetRating && !b30Stuck && b30Iterations < MAX_ITERATIONS_PER_LIST) {
    b30Iterations++;
    const previousB30Avg = currentAverageB30Rating;
    log.push(`[B30_ITERATION ${b30Iterations}] Current B30 Avg: ${previousB30Avg?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}`);

    // 1. B30 Leap Phase
    const leapResultB30 =_performListSimulationPhase(
      currentSimulatedB30Songs,
      'leap',
      input,
      log,
      'b30',
      currentAverageB30Rating
    );
    currentSimulatedB30Songs = leapResultB30.updatedSongs;
    currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT);
    currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, input.originalB30Songs.length, input.originalNew20Songs.length);
    log.push(`[B30_LEAP_RESULT] New B30 Avg: ${currentAverageB30Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${leapResultB30.songsChangedCount > 0}`);
    if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
    if (leapResultB30.stuck && previousB30Avg !== null && currentAverageB30Rating !== null && Math.abs(currentAverageB30Rating - previousB30Avg) < 0.00001) {
        // No change after leap, try fine-tuning or replacement if leap itself said it's stuck
    }

    // 2. B30 Fine-tuning Phase
    const fineTuneResultB30 = _performListSimulationPhase(
      currentSimulatedB30Songs,
      'fine_tune',
      input,
      log,
      'b30',
      currentAverageB30Rating
    );
    currentSimulatedB30Songs = fineTuneResultB30.updatedSongs;
    currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT);
    currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, input.originalB30Songs.length, input.originalNew20Songs.length);
    log.push(`[B30_FINETUNE_RESULT] New B30 Avg: ${currentAverageB30Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${fineTuneResultB30.songsChangedCount > 0}`);
    if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }


    // 3. B30 Replacement Phase (if needed)
    // Only attempt replacement if both leap and fine-tuning made no rating progress or reported stuck
    if (leapResultB30.stuck && fineTuneResultB30.stuck && previousB30Avg !== null && currentAverageB30Rating !== null && Math.abs(currentAverageB30Rating - previousB30Avg) < 0.00001 ) {
      log.push(`[B30_REPLACEMENT_CHECK] B30 stuck after leap & fine-tune. Attempting replacement.`);
      const replacementResultB30 = _performListSimulationPhase(
        currentSimulatedB30Songs,
        'replace',
        input,
        log,
        'b30',
        currentAverageB30Rating
      );
      currentSimulatedB30Songs = replacementResultB30.updatedSongs;
      currentAverageB30Rating = calculateAverageRating(currentSimulatedB30Songs, BEST_COUNT);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, input.originalB30Songs.length, input.originalNew20Songs.length);
      log.push(`[B30_REPLACEMENT_RESULT] New B30 Avg: ${currentAverageB30Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${replacementResultB30.songsChangedCount > 0}`);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
      if (replacementResultB30.stuck || replacementResultB30.songsChangedCount === 0) {
        log.push(`[B30_STUCK] B30 simulation cycle could not make further progress.`);
        b30Stuck = true;
      }
    } else if (fineTuneResultB30.songsChangedCount === 0 && leapResultB30.songsChangedCount === 0 && previousB30Avg !== null && currentAverageB30Rating !== null && Math.abs(currentAverageB30Rating - previousB30Avg) < 0.00001) {
        log.push(`[B30_STUCK] B30 simulation cycle made no progress in rating.`);
        b30Stuck = true; // No change in rating after full pass
    }
  }
  if (b30Iterations >= MAX_ITERATIONS_PER_LIST) log.push(`[B30_INFO] Reached max B30 iterations.`);

  // --- N20 Simulation Cycle (only if target not met and B30 is stuck or finished) ---
  let n20Stuck = false;
  let n20Iterations = 0;
  if (finalOutcomePhase !== 'target_reached' && input.originalNew20Songs.length > 0) {
    log.push("--- Starting N20 Simulation Cycle ---");
    while (currentOverallRating < input.targetRating && !n20Stuck && n20Iterations < MAX_ITERATIONS_PER_LIST) {
      n20Iterations++;
      const previousN20Avg = currentAverageNew20Rating;
      const previousOverallRating = currentOverallRating;
      log.push(`[N20_ITERATION ${n20Iterations}] Current N20 Avg: ${previousN20Avg?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}`);

      const leapResultN20 = _performListSimulationPhase(currentSimulatedNew20Songs, 'leap', input, log, 'n20', currentAverageNew20Rating);
      currentSimulatedNew20Songs = leapResultN20.updatedSongs;
      currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, input.originalB30Songs.length, input.originalNew20Songs.length);
      log.push(`[N20_LEAP_RESULT] New N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${leapResultN20.songsChangedCount > 0}`);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

      const fineTuneResultN20 = _performListSimulationPhase(currentSimulatedNew20Songs, 'fine_tune', input, log, 'n20', currentAverageNew20Rating);
      currentSimulatedNew20Songs = fineTuneResultN20.updatedSongs;
      currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT);
      currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, input.originalB30Songs.length, input.originalNew20Songs.length);
      log.push(`[N20_FINETUNE_RESULT] New N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${fineTuneResultN20.songsChangedCount > 0}`);
      if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }

      if (leapResultN20.stuck && fineTuneResultN20.stuck && Math.abs(currentOverallRating - previousOverallRating) < 0.00001) {
        log.push(`[N20_REPLACEMENT_CHECK] N20 stuck after leap & fine-tune. Attempting replacement.`);
        const replacementResultN20 = _performListSimulationPhase(currentSimulatedNew20Songs, 'replace', input, log, 'n20', currentAverageNew20Rating);
        currentSimulatedNew20Songs = replacementResultN20.updatedSongs;
        currentAverageNew20Rating = calculateAverageRating(currentSimulatedNew20Songs, NEW_20_COUNT);
        currentOverallRating = calculateOverallRating(currentAverageB30Rating, currentAverageNew20Rating, input.originalB30Songs.length, input.originalNew20Songs.length);
        log.push(`[N20_REPLACEMENT_RESULT] New N20 Avg: ${currentAverageNew20Rating?.toFixed(4)}, Overall: ${currentOverallRating.toFixed(4)}. Songs changed: ${replacementResultN20.songsChangedCount > 0}`);
        if (currentOverallRating >= input.targetRating) { finalOutcomePhase = 'target_reached'; break; }
        if (replacementResultN20.stuck || replacementResultN20.songsChangedCount === 0) {
          log.push(`[N20_STUCK] N20 simulation cycle could not make further progress.`);
          n20Stuck = true;
        }
      } else if (fineTuneResultN20.songsChangedCount === 0 && leapResultN20.songsChangedCount === 0 && Math.abs(currentOverallRating - previousOverallRating) < 0.00001) {
        log.push(`[N20_STUCK] N20 simulation cycle made no progress in rating.`);
        n20Stuck = true;
      }
    }
    if (n20Iterations >= MAX_ITERATIONS_PER_LIST) log.push(`[N20_INFO] Reached max N20 iterations.`);
  }


  // Determine final phase
  if (finalOutcomePhase !== 'target_reached') {
    if (b30Stuck && (n20Stuck || input.originalNew20Songs.length === 0)) {
      finalOutcomePhase = 'stuck_both_no_improvement';
    } else if (b30Stuck) {
      finalOutcomePhase = 'stuck_b30_no_improvement'; // N20 might have improved overall, but B30 itself is stuck
    } else if (n20Stuck) {
      finalOutcomePhase = 'stuck_n20_no_improvement';
    } else {
      // If neither explicitly stuck but target not reached (e.g. max iterations)
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
function calculateAverageRating(songs: Song[], count: number): number | null {
  if (songs.length === 0) return null;
  const topSongs = sortSongsByRatingDesc([...songs].map(s => ({ ...s, currentRating: s.targetRating }))).slice(0, count);
  if (topSongs.length === 0) return 0; // Should not happen if songs.length > 0
  const sum = topSongs.reduce((acc, s) => acc + s.targetRating, 0);
  return parseFloat((sum / topSongs.length).toFixed(4));
}

// Helper to calculate overall rating
function calculateOverallRating(
  avgB30: number | null,
  avgN20: number | null,
  originalB30Count: number,
  originalN20Count: number
): number {
  if (avgB30 === null) return 0; // B30 is mandatory

  const actualN20Count = Math.min(originalN20Count, NEW_20_COUNT);

  if (avgN20 !== null && actualN20Count > 0 && originalB30Count >= BEST_COUNT) {
    return parseFloat(
      (((avgB30 * BEST_COUNT) + (avgN20 * actualN20Count)) / (BEST_COUNT + actualN20Count)).toFixed(4)
    );
  }
  return avgB30; // Default to B30 average if N20 is not applicable or B30 isn't full
}


// Internal helper to run a specific phase (leap, fine_tune, replace) for a given list
function _performListSimulationPhase(
  currentSongs: Song[],
  phaseType: 'leap' | 'fine_tune' | 'replace',
  input: SimulationInput,
  log: string[],
  listType: 'b30' | 'n20',
  currentAverageForList: number | null
): { updatedSongs: Song[]; songsChangedCount: number; stuck: boolean } {
  let updatedSongs = JSON.parse(JSON.stringify(currentSongs)) as Song[];
  let songsChangedCount = 0;
  let phaseIsStuck = true; // Assume stuck until a change is made

  const listName = listType === 'b30' ? "B30" : "N20";
  log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}] Starting. Current avg for list: ${currentAverageForList?.toFixed(4)}`);

  const scoreCap = input.isScoreLimitReleased ? 1010000 : 1009000;
  
  // Filter out songs already at score cap or with no chart constant
  const updatableSongs = updatedSongs.filter(song => song.targetScore < scoreCap && song.chartConstant !== null && song.chartConstant > 0);

  if (updatableSongs.length === 0 && phaseType !== 'replace') { // Replacement can still run if list is full but no one can improve
    log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}] No updatable songs.`);
    return { updatedSongs, songsChangedCount, stuck: true };
  }

  // --- Sort candidates based on strategy ---
  let sortedCandidates: Song[] = [];
  if (input.calculationStrategy === 'floor') {
    sortedCandidates = [...updatableSongs].sort((a, b) => {
      // Rule: isSongHighConstantForFloor (false comes first)
      const aIsHighConst = isSongHighConstantForFloor(a, currentAverageForList);
      const bIsHighConst = isSongHighConstantForFloor(b, currentAverageForList);
      if (aIsHighConst !== bIsHighConst) return aIsHighConst ? 1 : -1;

      const constA = a.chartConstant ?? Infinity;
      const constB = b.chartConstant ?? Infinity;
      if (constA !== constB) return constA - constB;
      if (a.targetRating !== b.targetRating) return a.targetRating - b.targetRating;
      return a.targetScore - b.targetScore;
    });
  } else { // peak strategy
    sortedCandidates = [...updatableSongs].sort((a, b) => {
      if (b.targetRating !== a.targetRating) return b.targetRating - a.targetRating;
      return b.targetScore - a.targetScore;
    });
  }
  
  log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}] Sorted ${sortedCandidates.length} candidates. Top: ${sortedCandidates[0]?.title || 'N/A'}`);


  // --- Perform Phase-Specific Logic ---
  if (phaseType === 'leap') {
    if (sortedCandidates.length > 0) {
      const songToAttemptLeap = sortedCandidates[0]; // For floor, this is the highest priority. For peak, we'd ideally check all for efficiency.
                                                      // Simplified: floor takes first, peak takes first (which is highest rating)
      const nextGradeScore = getNextGradeBoundaryScore(songToAttemptLeap.targetScore);
      if (nextGradeScore && songToAttemptLeap.chartConstant && songToAttemptLeap.targetScore < nextGradeScore) {
        const potentialRatingAtNextGrade = calculateChunithmSongRating(nextGradeScore, songToAttemptLeap.chartConstant);
        if (potentialRatingAtNextGrade > songToAttemptLeap.targetRating + 0.00005) { // Ensure meaningful increase
          const songIndex = updatedSongs.findIndex(s => s.id === songToAttemptLeap.id && s.diff === songToAttemptLeap.diff);
          if (songIndex !== -1) {
            updatedSongs[songIndex] = { ...songToAttemptLeap, targetScore: nextGradeScore, targetRating: parseFloat(potentialRatingAtNextGrade.toFixed(4)) };
            songsChangedCount++;
            phaseIsStuck = false;
            log.push(`[${listName}_LEAP] Leaped ${songToAttemptLeap.title} to score ${nextGradeScore}, new rating ${potentialRatingAtNextGrade.toFixed(4)}`);
          }
        } else {
            log.push(`[${listName}_LEAP] Leap for ${songToAttemptLeap.title} not efficient enough or no rating gain.`);
        }
      } else {
        log.push(`[${listName}_LEAP] ${songToAttemptLeap.title} cannot leap further or no const.`);
      }
    } else {
      log.push(`[${listName}_LEAP] No candidates for leap.`);
    }
  } 
  else if (phaseType === 'fine_tune') {
    for (const candidateSong of sortedCandidates) {
      const songIndex = updatedSongs.findIndex(s => s.id === candidateSong.id && s.diff === candidateSong.diff);
      if (songIndex === -1) continue;

      let currentSongInSim = updatedSongs[songIndex];
      if (currentSongInSim.targetScore < scoreCap && currentSongInSim.chartConstant) {
        const targetMicroTuneRating = currentSongInSim.targetRating + 0.0001; // Minimal increase
        const minScoreInfo = findMinScoreForTargetRating(currentSongInSim, targetMicroTuneRating, input.isScoreLimitReleased);

        if (minScoreInfo.possible && minScoreInfo.score > currentSongInSim.targetScore && minScoreInfo.score <= scoreCap) {
          updatedSongs[songIndex] = { ...currentSongInSim, targetScore: minScoreInfo.score, targetRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
          songsChangedCount++;
          phaseIsStuck = false;
          log.push(`[${listName}_FINETUNE] Tuned ${currentSongInSim.title} to score ${minScoreInfo.score}, new rating ${minScoreInfo.rating.toFixed(4)}`);
          break; // Only one fine-tune per pass
        }
      }
    }
    if (songsChangedCount === 0) log.push(`[${listName}_FINETUNE] No songs were fine-tuned in this pass.`);
  }
  else if (phaseType === 'replace') {
    if (updatedSongs.length < (listType === 'b30' ? BEST_COUNT : NEW_20_COUNT) && listType === 'n20') {
        // For N20, if the list isn't full, we try to add songs from the pool before replacing.
        const currentN20IdsAndDiffs = new Set(updatedSongs.map(s => `${s.id}_${s.diff}`));
        const potentialAdditions = input.allPlayedNewSongsPool
            .filter(poolSong => !currentN20IdsAndDiffs.has(`${poolSong.id}_${poolSong.diff}`))
            .sort((a,b) => b.currentRating - a.currentRating); // Add highest rating first

        if (potentialAdditions.length > 0) {
            const songToAdd = potentialAdditions[0];
            updatedSongs.push({...songToAdd, targetScore: songToAdd.currentScore, targetRating: songToAdd.currentRating });
            updatedSongs = sortSongsByRatingDesc(updatedSongs.map(s => ({...s, currentRating: s.targetRating}))).slice(0, NEW_20_COUNT);
            songsChangedCount++;
            phaseIsStuck = false;
            log.push(`[${listName}_REPLACE_ADD] Added ${songToAdd.title} to fill N20 list. New N20 count: ${updatedSongs.length}`);
        } else {
             log.push(`[${listName}_REPLACE_ADD] N20 list not full, but no more songs in pool to add.`);
             // No change, phaseIsStuck remains true if no replacement happens below
        }
    }


    // If still stuck or it's B30 (which always replaces if list is full)
    if (phaseIsStuck || listType === 'b30') {
        const songToReplace = [...updatedSongs].sort((a, b) => a.targetRating - b.targetRating)[0];
        if (!songToReplace) {
          log.push(`[${listName}_REPLACE] No song to replace (list might be empty).`);
          return { updatedSongs, songsChangedCount, stuck: true };
        }
        log.push(`[${listName}_REPLACE] Attempting to replace ${songToReplace.title} (Rating: ${songToReplace.targetRating.toFixed(4)})`);

        let replacementSource: Song[] = [];
        const currentSimulatedIdsAndDiffs = new Set(updatedSongs.map(s => `${s.id}_${s.diff}`));

        if (listType === 'b30') {
          const newSongsTitlesLower = (NewSongsData.titles?.verse || []).map(t => t.trim().toLowerCase());
          replacementSource = input.allMusicData
            .filter(globalSong => {
              if (!globalSong.id || !globalSong.diff || !globalSong.title) return false;
              if (currentSimulatedIdsAndDiffs.has(`${globalSong.id}_${globalSong.diff.toUpperCase()}`)) return false;
              if (newSongsTitlesLower.includes(globalSong.title.trim().toLowerCase())) return false; // Exclude NewSongs from B30 replacement
              const tempSongObj = mapApiSongToAppSong(globalSong, 0, globalSong.const);
              if (!tempSongObj.chartConstant) return false;
              const potentialMaxRating = calculateChunithmSongRating(scoreCap, tempSongObj.chartConstant);
              return potentialMaxRating > songToReplace.targetRating;
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
                return potentialMaxRating > songToReplace.targetRating;
            });
        }
        log.push(`[${listName}_REPLACE] Found ${replacementSource.length} potential candidates from source.`);

        let bestCandidateForReplacement: (Song & { neededScore: number; resultingRating: number }) | null = null;
        let minEffort = Infinity;

        for (const candidate of replacementSource) {
          if (!candidate.chartConstant) continue;
          const targetRatingForCandidate = songToReplace.targetRating + 0.0001;
          const minScoreInfo = findMinScoreForTargetRating(candidate, targetRatingForCandidate, input.isScoreLimitReleased);
          if (minScoreInfo.possible) {
            const effort = candidate.currentScore > 0 ? (minScoreInfo.score - candidate.currentScore) : minScoreInfo.score + 1000000; // Penalize unplayed songs
            if (effort < minEffort) {
              minEffort = effort;
              bestCandidateForReplacement = { ...candidate, neededScore: minScoreInfo.score, resultingRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
            } else if (effort === minEffort && bestCandidateForReplacement && minScoreInfo.rating > bestCandidateForReplacement.resultingRating) {
              bestCandidateForReplacement = { ...candidate, neededScore: minScoreInfo.score, resultingRating: parseFloat(minScoreInfo.rating.toFixed(4)) };
            }
          }
        }

        if (bestCandidateForReplacement) {
          updatedSongs = updatedSongs.filter(s => !(s.id === songToReplace.id && s.diff === songToReplace.diff));
          updatedSongs.push({
            ...bestCandidateForReplacement,
            targetScore: bestCandidateForReplacement.neededScore,
            targetRating: bestCandidateForReplacement.resultingRating,
          });
          // Ensure list is sorted and trimmed
          const listLimit = listType === 'b30' ? BEST_COUNT : NEW_20_COUNT;
          updatedSongs = sortSongsByRatingDesc(updatedSongs.map(s => ({...s, currentRating: s.targetRating}))).slice(0, listLimit);

          songsChangedCount++;
          phaseIsStuck = false;
          log.push(`[${listName}_REPLACE] Replaced ${songToReplace.title} with ${bestCandidateForReplacement.title}. New score: ${bestCandidateForReplacement.neededScore}, new rating: ${bestCandidateForReplacement.resultingRating.toFixed(4)}`);
        } else {
          log.push(`[${listName}_REPLACE] No suitable replacement candidate found for ${songToReplace.title}.`);
          // phaseIsStuck remains true
        }
    }
  }


  log.push(`[${listName}_PHASE_${phaseType.toUpperCase()}] Ended. Songs changed: ${songsChangedCount}. Stuck: ${phaseIsStuck}`);
  return { updatedSongs, songsChangedCount, stuck: phaseIsStuck };
}

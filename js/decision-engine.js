/**
 * Decision Engine for '數獨人'
 * Manages trial-and-error state, hint counts, candidate exclusions,
 * and recommends optimal actions to achieve a unique solution.
 */
class DecisionEngine {
  constructor(solver) {
    this.solver = solver;
    this.reset();
  }

  reset() {
    this.originalGrid = new Array(81).fill(0);
    this.grid = new Array(81).fill(0);
    this.excludedCandidates = Array.from({ length: 81 }, () => []);
    
    this.errorsCount = 0;
    this.errorsMax = 3;
    
    this.hintsCount = 0;
    this.hintsMax = 2;

    this.trialCell = null; // Current active trial cell: { index, value }
    this.analysis = null;  // Output of solveSudoku
  }

  setGrid(newGrid) {
    this.originalGrid = [...newGrid];
    this.grid = [...newGrid];
    this.excludedCandidates = Array.from({ length: 81 }, () => []);
    this.errorsCount = 0;
    this.hintsCount = 0;
    this.trialCell = null;
    this.analyze();
  }

  /**
   * Run solver and determine next actions.
   */
  analyze() {
    console.log('Analyzing grid:', this.grid);
    this.analysis = this.solver.solveSudoku(this.grid, this.excludedCandidates);
    console.log('Analysis result:', this.analysis);
    console.log('Analysis status:', this.analysis.status);
    
    // Clear old trial recommendation
    this.trialCell = null;

    if (this.analysis.status === "unsolvable") {
      console.log('Board is unsolvable');
      return;
    }

    // If it's not unique (or requires guessing to determine uniqueness)
    // and we still have trial opportunities, suggest a trial cell.
    if (this.analysis.status === "multiple" || (this.analysis.solutions.length === 1 && this.analysis.branchPoints.length > 0)) {
      if (this.analysis.branchPoints.length > 0 && this.errorsCount < this.errorsMax) {
        // Find the first branch point that is not a pre-filled cell
        for (const bp of this.analysis.branchPoints) {
          if (!this.isOriginalCell(bp.index)) {
            // Suggest the first valid candidate at that branch point
            const suggestedVal = bp.candidates.find(val => !this.excludedCandidates[bp.index].includes(val));
            
            if (suggestedVal !== undefined) {
              this.trialCell = {
                index: bp.index,
                value: suggestedVal
              };
              break;
            }
          }
        }
      }
    }
  }

  /**
   * Check if a cell was pre-filled in the original image.
   * @param {number} index - cell index (0-80)
   * @returns {boolean} true if the cell was pre-filled
   */
  isOriginalCell(index) {
    return this.originalGrid[index] !== 0;
  }

  /**
   * Handles user feedback on a trial guess.
   * @param {number} index - cell index (0-80)
   * @param {number} value - guessed number
   * @param {boolean} isCorrect - whether the guess was correct in the game
   */
  submitTrialResult(index, value, isCorrect) {
    // Prevent modifying pre-filled cells
    if (this.isOriginalCell(index)) {
      return false;
    }

    if (isCorrect) {
      // Cell value is now confirmed
      this.grid[index] = value;
    } else {
      // Exclude this candidate and record error
      if (!this.excludedCandidates[index].includes(value)) {
        this.excludedCandidates[index].push(value);
      }
      this.errorsCount++;
    }
    this.analyze();
    return true;
  }

  /**
   * Record a manual hint.
   * @param {number} index - cell index
   * @param {number} value - correct value obtained from game hint
   */
  applyHint(index, value) {
    // Prevent modifying pre-filled cells
    if (this.isOriginalCell(index)) {
      return false;
    }

    if (this.hintsCount < this.hintsMax) {
      this.grid[index] = value;
      this.hintsCount++;
      // Clear exclusions for this cell since it is now solved
      this.excludedCandidates[index] = [];
      this.analyze();
      return true;
    }
    return false;
  }

  /**
   * Determines if the board is fully solved.
   */
  isSolved() {
    return this.analysis && this.analysis.status === "unique" && this.analysis.solutions.length > 0 && this.analysis.branchPoints.length === 0;
  }
}

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DecisionEngine;
} else {
  window.DecisionEngine = DecisionEngine;
}

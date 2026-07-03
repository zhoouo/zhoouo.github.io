/**
 * Sudoku Solver Core
 * Implementation of Constraint Propagation, Candidate Elimination, and Backtracking.
 */
class SudokuSolver {
  constructor() {
    // Cache peers for each of the 81 cells
    this.peers = Array.from({ length: 81 }, (_, i) => this.calculatePeers(i));
  }

  calculatePeers(index) {
    const r = Math.floor(index / 9);
    const c = index % 9;
    const boxRow = Math.floor(r / 3) * 3;
    const boxCol = Math.floor(c / 3) * 3;
    const peerSet = new Set();

    // Row & Column peers
    for (let i = 0; i < 9; i++) {
      peerSet.add(r * 9 + i);
      peerSet.add(i * 9 + c);
    }
    // 3x3 Box peers
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        peerSet.add((boxRow + br) * 9 + (boxCol + bc));
      }
    }
    peerSet.delete(index);
    return Array.from(peerSet);
  }

  /**
   * Performs constraint propagation to eliminate candidates.
   * Returns a candidate map if valid, or null if a contradiction is found.
   */
  getInitialCandidates(grid, excludedCandidates) {
    const candidates = Array.from({ length: 81 }, (_, i) => {
      if (grid[i] !== 0) {
        return [grid[i]];
      }
      const base = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      if (excludedCandidates && excludedCandidates[i]) {
        return base.filter(v => !excludedCandidates[i].includes(v));
      }
      return base;
    });

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < 81; i++) {
        if (candidates[i].length === 1) {
          const val = candidates[i][0];
          const peers = this.peers[i];
          for (const peer of peers) {
            const idx = candidates[peer].indexOf(val);
            if (idx !== -1) {
              candidates[peer].splice(idx, 1);
              if (candidates[peer].length === 0) {
                return null; // Contradiction
              }
              changed = true;
            }
          }
        }
      }
      
      // Hidden singles: if a number is only possible in one cell of a row/col/box, set it
      for (let groupType = 0; groupType < 3; groupType++) {
        for (let groupIdx = 0; groupIdx < 9; groupIdx++) {
          const cells = this.getGroupCells(groupType, groupIdx);
          for (let val = 1; val <= 9; val++) {
            const possibleCells = cells.filter(idx => candidates[idx].includes(val) && candidates[idx].length > 1);
            const alreadyPlaced = cells.some(idx => candidates[idx].length === 1 && candidates[idx][0] === val);
            
            if (!alreadyPlaced && possibleCells.length === 1) {
              const targetIdx = possibleCells[0];
              candidates[targetIdx] = [val];
              changed = true;
            }
          }
        }
      }
    }

    return candidates;
  }

  getGroupCells(type, idx) {
    const cells = [];
    if (type === 0) { // Row
      for (let i = 0; i < 9; i++) cells.push(idx * 9 + i);
    } else if (type === 1) { // Col
      for (let i = 0; i < 9; i++) cells.push(i * 9 + idx);
    } else { // Box
      const br = Math.floor(idx / 3) * 3;
      const bc = (idx % 3) * 3;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          cells.push((br + r) * 9 + (bc + c));
        }
      }
    }
    return cells;
  }

  /**
   * Check if a board grid is valid (no rule violations for filled numbers)
   */
  isValidBoard(grid) {
    for (let i = 0; i < 81; i++) {
      if (grid[i] !== 0) {
        const val = grid[i];
        for (const peer of this.peers[i]) {
          if (grid[peer] === val) return false;
        }
      }
    }
    return true;
  }

  /**
   * Main solving method. Finds the number of solutions and returns metadata:
   * - status: "unsolvable", "unique", "multiple"
   * - solutions: list of solved grids (up to 2 for uniqueness checking)
   * - branchPoints: cells where the solver had to make a guess (MRV heuristic order)
   */
  solveSudoku(grid, excludedCandidates) {
    if (!this.isValidBoard(grid)) {
      return { status: "unsolvable", solutions: [], branchPoints: [] };
    }

    const solutions = [];
    const branchPoints = [];
    
    const candidates = this.getInitialCandidates(grid, excludedCandidates);
    if (!candidates) {
      return { status: "unsolvable", solutions: [], branchPoints: [] };
    }

    // Convert candidates back to a flat board for propagation progress
    const propGrid = candidates.map(c => c.length === 1 ? c[0] : 0);

    const search = (currentCandidates) => {
      if (solutions.length >= 2) return;

      // Find unassigned cell with minimum candidates (MRV)
      let minIdx = -1;
      let minLen = 10;
      for (let i = 0; i < 81; i++) {
        const len = currentCandidates[i].length;
        if (len > 1 && len < minLen) {
          minLen = len;
          minIdx = i;
        }
      }

      if (minIdx === -1) {
        // Solved state found
        const solved = currentCandidates.map(c => c[0]);
        solutions.push(solved);
        return;
      }

      // Record branching point if not already recorded
      if (!branchPoints.some(bp => bp.index === minIdx)) {
        branchPoints.push({
          index: minIdx,
          candidates: [...currentCandidates[minIdx]]
        });
      }

      const choices = currentCandidates[minIdx];
      for (const val of choices) {
        // Deep copy candidates for next branch
        const nextCandidates = currentCandidates.map(c => [...c]);
        nextCandidates[minIdx] = [val];

        // Propagate changes for the choice
        if (this.propagateSingleCandidate(nextCandidates, minIdx, val)) {
          search(nextCandidates);
        }
      }
    };

    search(candidates);

    let status = "unsolvable";
    if (solutions.length === 1) status = "unique";
    else if (solutions.length > 1) status = "multiple";

    return {
      status,
      solutions,
      branchPoints,
      propGrid // This grid contains numbers solved by logic alone
    };
  }

  propagateSingleCandidate(candidates, cellIdx, val) {
    const queue = [cellIdx];
    while (queue.length > 0) {
      const curr = queue.shift();
      const currVal = candidates[curr][0];
      const peers = this.peers[curr];
      for (const peer of peers) {
        const idx = candidates[peer].indexOf(currVal);
        if (idx !== -1) {
          candidates[peer].splice(idx, 1);
          const newLen = candidates[peer].length;
          if (newLen === 0) return false; // Contradiction
          if (newLen === 1) {
            queue.push(peer);
          }
        }
      }
    }
    return true;
  }
}

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SudokuSolver;
} else {
  window.SudokuSolver = SudokuSolver;
}

/**
 * Image Processor for '數獨人'
 * Handles yellow board detection, grid segmentation, digit binarization,
 * and template matching digit recognition using HTML Canvas.
 *
 * FIX (2026-07): Templates and scanned cells were being normalized using
 * two DIFFERENT procedures — templates kept their natural glyph proportions
 * inside the 20x30 canvas, while scanned cells were bounding-box-cropped
 * and stretched to completely fill the 20x30 canvas. This mismatch meant
 * the two binary images were never really comparable, causing near-random
 * digit recognition. Both now go through the same extractAndNormalize()
 * pipeline so they're on equal footing.
 */
class ImageProcessor {
  constructor() {
    this.templates = {};
    this.generateDigitTemplates();
  }

  /**
   * Generates templates for digits 1-9 using several fonts commonly found
   * on Android/iOS/desktop, normalized with the SAME bounding-box-stretch
   * procedure used on scanned cells (see extractAndNormalize).
   */
  generateDigitTemplates() {
    // Render at a larger size than the final 20x30 target so the bounding
    // box extraction has enough resolution to be precise, then it gets
    // downsampled into the standard 20x30 grid by extractAndNormalize.
    const RENDER_W = 80;
    const RENDER_H = 120; // keep the 20:30 (2:3) aspect ratio

    const canvas = document.createElement("canvas");
    canvas.width = RENDER_W;
    canvas.height = RENDER_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    // Common digit fonts across platforms/apps. Fonts that aren't
    // installed on the device silently fall back to the browser default,
    // so listing extras is harmless — extractAndNormalize() just skips
    // any render that doesn't produce a valid glyph.
    const fonts = [
      "bold 76px sans-serif",
      "bold 76px Arial",
      "bold 76px Helvetica",
      "bold 76px Roboto",
      "bold 76px -apple-system",
      "bold 76px 'Noto Sans TC'",
      "bold 76px 'PingFang TC'",
      "bold 76px 'Microsoft JhengHei'",
    ];

    for (let digit = 1; digit <= 9; digit++) {
      this.templates[digit] = [];

      for (const font of fonts) {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, RENDER_W, RENDER_H);
        ctx.fillStyle = "#000000";
        ctx.font = font;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(digit.toString(), RENDER_W / 2, RENDER_H / 2);

        const imgData = ctx.getImageData(0, 0, RENDER_W, RENDER_H);
        const normalized = this.extractAndNormalize(imgData, RENDER_W, RENDER_H);

        // Skip fonts that failed to render a usable glyph (e.g. not
        // installed and fell back to something illegible at this size).
        if (!normalized) continue;

        this.templates[digit].push(normalized);
      }
    }
  }

  /**
   * Shared normalization pipeline used by BOTH template generation and
   * live cell scanning. Converts to grayscale, binarizes, finds the tight
   * bounding box of dark (digit) pixels, then stretches that box into a
   * fixed 20x30 binary grid. Because both sides of the comparison go
   * through this exact same process, their coordinate systems match and
   * IoU-style scoring is meaningful.
   *
   * Returns { binary: Uint8Array(20*30), templatePixels } or null if the
   * image doesn't contain a plausible digit (empty/low-contrast/too small).
   */
  extractAndNormalize(imgData, w, h) {
    const data = imgData.data;
    const gray = new Uint8Array(w * h);
    let minVal = 255;
    let maxVal = 0;

    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const val = Math.floor(0.299 * r + 0.587 * g + 0.114 * b);
      gray[i] = val;
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
    }

    // Low contrast means no digit present (empty cell, or a font that
    // failed to render).
    if (maxVal - minVal < 45) {
      return null;
    }

    const thresh = minVal + (maxVal - minVal) * 0.5;
    const binary = new Uint8Array(w * h);

    let left = w, right = 0, top = h, bottom = 0;
    let darkPixelCount = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        binary[idx] = gray[idx] < thresh ? 1 : 0;

        if (binary[idx] === 1) {
          darkPixelCount++;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }

    const digitW = right - left + 1;
    const digitH = bottom - top + 1;

    if (digitW < 3 || digitH < 6 || darkPixelCount < 10) {
      return null;
    }

    // Stretch the tight digit bounding box into the standard 20x30 grid.
    const norm = new Uint8Array(20 * 30);
    for (let ny = 0; ny < 30; ny++) {
      for (let nx = 0; nx < 20; nx++) {
        const ox = Math.floor(left + (nx / 20) * digitW);
        const oy = Math.floor(top + (ny / 30) * digitH);
        if (ox >= 0 && ox < w && oy >= 0 && oy < h) {
          norm[ny * 20 + nx] = binary[oy * w + ox];
        }
      }
    }

    let normPixels = 0;
    for (let i = 0; i < 20 * 30; i++) {
      if (norm[i] === 1) normPixels++;
    }

    return { binary: norm, templatePixels: normPixels };
  }

  /**
   * Detects the yellow grid bounding box in the source image canvas.
   * Returns { x, y, width, height } or null.
   */
  detectYellowBoard(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const W = canvas.width;
    const H = canvas.height;
    const imgData = ctx.getImageData(0, 0, W, H);
    const data = imgData.data;

    const colCounts = new Int32Array(W);
    const rowCounts = new Int32Array(H);

    // Restrict vertical scanning to 15%-85% height to bypass top coins/timers and bottom ad bars
    const startY = Math.floor(H * 0.15);
    const endY = Math.floor(H * 0.85);

    // Scan every pixel (step = 1) to ensure thin yellow grid lines are not missed
    for (let y = startY; y < endY; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Flexible yellow color matching
        if (r > 150 && g > 130 && b < 150 && Math.abs(r - g) < 50 && (r - b) > 50 && (g - b) > 30) {
          colCounts[x]++;
          rowCounts[y]++;
        }
      }
    }

    // Find max column and row counts to filter noise relatively
    let maxCol = 0;
    for (let x = 0; x < W; x++) {
      if (colCounts[x] > maxCol) maxCol = colCounts[x];
    }
    let maxRow = 0;
    for (let y = startY; y < endY; y++) {
      if (rowCounts[y] > maxRow) maxRow = rowCounts[y];
    }

    // If there's barely any yellow, fallback
    if (maxCol < 20 || maxRow < 20) {
      const size = W * 0.92;
      return {
        x: Math.floor((W - size) / 2),
        y: Math.floor(H * 0.21),
        width: Math.floor(size),
        height: Math.floor(size),
        fallback: true
      };
    }

    // Filter noise: only count lines that have at least 15% of the max intensity
    const thresholdCol = maxCol * 0.15;
    const thresholdRow = maxRow * 0.15;

    let left = 0;
    while (left < W && colCounts[left] < thresholdCol) left++;
    let right = W - 1;
    while (right > left && colCounts[right] < thresholdCol) right--;

    let top = startY;
    while (top < endY && rowCounts[top] < thresholdRow) top++;
    let bottom = endY - 1;
    while (bottom > top && rowCounts[bottom] < thresholdRow) bottom--;

    const width = right - left;
    const height = bottom - top;

    // Check if the board is valid (should be roughly square, aspect ratio close to 1.0)
    if (width < 100 || height < 100) {
      const size = W * 0.92;
      return {
        x: Math.floor((W - size) / 2),
        y: Math.floor(H * 0.21),
        width: Math.floor(size),
        height: Math.floor(size),
        fallback: true
      };
    }

    const aspectRatio = width / height;
    if (aspectRatio < 0.85 || aspectRatio > 1.15) {
      const size = W * 0.92;
      return {
        x: Math.floor((W - size) / 2),
        y: Math.floor(H * 0.21),
        width: Math.floor(size),
        height: Math.floor(size),
        fallback: true
      };
    }

    return { x: left, y: top, width, height, fallback: false };
  }

  /**
   * Recognizes digits in each of the 81 cells of the detected board area.
   * Returns an array of 81 numbers (0 for empty, 1-9 for digits).
   */
  recognizeBoard(canvas, boardRect) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const grid = new Array(81).fill(0);

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        // Calculate cell boundaries using integers to avoid float scaling errors
        const cellX = Math.floor(boardRect.x + c * (boardRect.width / 9));
        const cellY = Math.floor(boardRect.y + r * (boardRect.height / 9));
        const nextCellX = Math.floor(boardRect.x + (c + 1) * (boardRect.width / 9));
        const nextCellY = Math.floor(boardRect.y + (r + 1) * (boardRect.height / 9));
        const cellW = nextCellX - cellX;
        const cellH = nextCellY - cellY;

        // Crop cell with 15% inner padding to avoid yellow cell borders
        const padX = Math.floor(cellW * 0.15);
        const padY = Math.floor(cellH * 0.15);
        const cropW = cellW - 2 * padX;
        const cropH = cellH - 2 * padY;

        const cellData = ctx.getImageData(cellX + padX, cellY + padY, cropW, cropH);
        const digit = this.processCell(cellData, cropW, cropH);
        grid[r * 9 + c] = digit;
      }
    }
    return grid;
  }

  /**
   * Processes a single cropped cell image data.
   * Normalizes it (same pipeline as templates) and matches it against
   * the digit templates.
   */
  processCell(imgData, w, h) {
    const normalized = this.extractAndNormalize(imgData, w, h);
    if (!normalized) {
      return 0; // Empty cell / no plausible digit
    }

    const { binary: norm, templatePixels: normPixels } = normalized;

    // Translation-Invariant Template Matching
    let bestDigit = 0;
    let maxMatchScore = -1;

    for (let d = 1; d <= 9; d++) {
      const fontTemplates = this.templates[d];
      for (const { binary: template, templatePixels } of fontTemplates) {
        // Shift templates relative to normalized digit to find best alignment
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            let matches = 0;

            for (let y = 0; y < 30; y++) {
              const ty = y + dy;
              if (ty < 0 || ty >= 30) continue;

              const rowOffsetNorm = y * 20;
              const rowOffsetTemp = ty * 20;

              for (let x = 0; x < 20; x++) {
                if (norm[rowOffsetNorm + x] === 1) {
                  const tx = x + dx;
                  if (tx >= 0 && tx < 20) {
                    if (template[rowOffsetTemp + tx] === 1) {
                      matches++;
                    }
                  }
                }
              }
            }

            const union = normPixels + templatePixels - matches;
            const score = union > 0 ? (matches / union) : 0;
            if (score > maxMatchScore) {
              maxMatchScore = score;
              bestDigit = d;
            }
          }
        }
      }
    }

    // If matching score is poor, classify as empty/noise
    if (maxMatchScore < 0.35) {
      return 0;
    }

    console.log(`Cell recognized as ${bestDigit} with score ${maxMatchScore.toFixed(3)}`);
    return bestDigit;
  }
}

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ImageProcessor;
} else {
  window.ImageProcessor = ImageProcessor;
}
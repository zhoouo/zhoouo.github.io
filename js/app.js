/**
 * Main Application Logic for '數獨人'
 */
document.addEventListener("DOMContentLoaded", () => {
  // Instances
  const solver = new SudokuSolver();
  const processor = new ImageProcessor();
  const decisionEngine = new DecisionEngine(solver);
  const pip = new PipController();

  // State
  let loadedImage = null; // HTMLImageElement
  let boardRect = null;   // { x, y, width, height }
  let selectedCellIndex = null;
  let isInputtingHint = false;

  // DOM Elements
  const srcCanvas = document.getElementById("srcCanvas");
  const ctx = srcCanvas.getContext("2d", { willReadFrequently: true });
  const gridOverlay = document.getElementById("gridOverlay");
  const uploadPrompt = document.getElementById("uploadPrompt");
  const fileInput = document.getElementById("fileInput");
  
  // Buttons & Controls
  const btnPaste = document.getElementById("btnPaste");
  const btnUpload = document.getElementById("btnUpload");
  const btnAutoSolve = document.getElementById("btnAutoSolve");
  const btnReset = document.getElementById("btnReset");
  const opacitySlider = document.getElementById("opacitySlider");
  
  // Indicators
  const errorStatusEl = document.getElementById("errorStatus");
  const hintStatusEl = document.getElementById("hintStatus");
  const solutionStatusEl = document.getElementById("solutionStatus");

  // Modals
  const trialModal = document.getElementById("trialModal");
  const numPadModal = document.getElementById("numPadModal");
  const hintModal = document.getElementById("hintModal");
  const toast = document.getElementById("toast");

  // Initialize UI Grid Buttons
  createGridOverlayButtons();

  // --- 1. Image loading and processing ---

  // Trigger file input
  uploadPrompt.addEventListener("click", () => fileInput.click());
  btnUpload.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      loadImageFromFile(e.target.files[0]);
    }
  });

  // Global paste event
  window.addEventListener("paste", (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        loadImageFromFile(file);
        showToast("已從剪貼簿貼上圖片");
        return;
      }
    }
  });

  // Manual Paste Button
  btnPaste.addEventListener("click", async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        showToast("您的瀏覽器不支援讀取剪貼簿，請使用手動上傳或直接 Ctrl+V");
        return;
      }
      
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            loadImageFromFile(blob);
            showToast("已貼上最新截圖");
            return;
          }
        }
      }
      showToast("剪貼簿中沒有偵測到圖片");
    } catch (err) {
      console.error(err);
      showToast("無法存取剪貼簿，請手動上傳圖片");
    }
  });

  function loadImageFromFile(fileOrBlob) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        loadedImage = img;
        uploadPrompt.style.display = "none";
        
        // Setup canvas size
        srcCanvas.width = img.naturalWidth;
        srcCanvas.height = img.naturalHeight;
        
        // Detect board
        ctx.drawImage(img, 0, 0);
        boardRect = processor.detectYellowBoard(srcCanvas);
        
        if (boardRect) {
          if (boardRect.fallback) {
            showToast("未偵測到黃色棋盤，已套用預設中央範圍");
          } else {
            showToast("成功定位黃色棋盤！");
          }
          
          // Recognize digits
          const recognizedGrid = processor.recognizeBoard(srcCanvas, boardRect);
          console.log('Recognized grid:', recognizedGrid);
          console.log('Grid as 9x9:');
          for (let r = 0; r < 9; r++) {
            console.log(recognizedGrid.slice(r * 9, (r + 1) * 9).join(' '));
          }
          decisionEngine.setGrid(recognizedGrid);

          // Auto-solve immediately if unique and no trials required
          if (decisionEngine.analysis && decisionEngine.analysis.status === "unique" && decisionEngine.analysis.branchPoints.length === 0) {
            showToast("分析完成，已自動求解！");
          } else if (decisionEngine.analysis && decisionEngine.analysis.branchPoints.length > 0) {
            showToast("已標示建議試錯或提示的格子");
          } else {
            showToast("分析完成");
          }

          updateStatusBar();
          renderAppCanvas();
          updateGridOverlayPosition();
        } else {
          showToast("影像辨識失敗，請上傳清晰的 LINE 數獨截圖");
          // Clear
          loadedImage = null;
          uploadPrompt.style.display = "flex";
          ctx.clearRect(0, 0, srcCanvas.width, srcCanvas.height);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(fileOrBlob);
  }

  // --- 2. Grid Overlay Controls ---

  function createGridOverlayButtons() {
    gridOverlay.innerHTML = "";
    for (let i = 0; i < 81; i++) {
      const btn = document.createElement("button");
      btn.className = "grid-cell-btn";
      btn.dataset.index = i;
      btn.addEventListener("click", () => handleCellClick(i));
      gridOverlay.appendChild(btn);
    }
  }

  function updateGridOverlayPosition() {
    if (!boardRect || !loadedImage) return;

    // Calculate canvas size as displayed in CSS
    const displayW = srcCanvas.offsetWidth;
    const displayH = srcCanvas.offsetHeight;

    // Find scaling factor from natural size to displayed size
    const scaleX = displayW / srcCanvas.width;
    const scaleY = displayH / srcCanvas.height;

    // Position overlay matching the detected yellow board, taking centered offsets into account
    gridOverlay.style.left = `${srcCanvas.offsetLeft + boardRect.x * scaleX}px`;
    gridOverlay.style.top = `${srcCanvas.offsetTop + boardRect.y * scaleY}px`;
    gridOverlay.style.width = `${boardRect.width * scaleX}px`;
    gridOverlay.style.height = `${boardRect.height * scaleY}px`;
  }

  // Handle resizing to keep HTML overlay aligned with canvas
  window.addEventListener("resize", updateGridOverlayPosition);

  // --- 3. Interaction Mechanics (Trials, Hints, Manual Input) ---

  function handleCellClick(index) {
    // Check if it's the trial cell
    if (decisionEngine.trialCell && decisionEngine.trialCell.index === index) {
      openTrialModal(index, decisionEngine.trialCell.value);
      return;
    }

    // Prevent editing pre-filled cells from original image
    if (decisionEngine.isOriginalCell(index)) {
      showToast("此格為原始題目給予的答案，無法修改");
      return;
    }

    // Standard manual input override (allow correcting digit recognition)
    selectedCellIndex = index;
    isInputtingHint = false;
    openNumPadModal(`編輯數字 (${Math.floor(index/9)+1}行, ${(index%9)+1}列)`);
  }

  // Trial Modal Handling
  function openTrialModal(index, value) {
    trialModal.querySelector(".modal-body").innerHTML = `
      系統建議試錯此格：<br>
      <b>[ 第 ${Math.floor(index/9)+1} 行, 第 ${(index%9)+1} 列 ]</b><br><br>
      請在遊戲中填入數字 <b style="color:var(--blue-guess);font-size:24px;">${value}</b>。<br>
      遊戲反饋結果為何？
    `;
    trialModal.dataset.index = index;
    trialModal.dataset.value = value;
    trialModal.classList.add("active");
  }

  window.submitTrial = (isCorrect) => {
    trialModal.classList.remove("active");
    const idx = parseInt(trialModal.dataset.index);
    const val = parseInt(trialModal.dataset.value);
    
    decisionEngine.submitTrialResult(idx, val, isCorrect);
    
    if (isCorrect) {
      showToast("試錯正確！已填入數字");
    } else {
      showToast(`試錯錯誤！扣除一次機會 (剩 ${decisionEngine.errorsMax - decisionEngine.errorsCount} 次)`);
    }

    updateStatusBar();
    renderAppCanvas();
  };

  window.closeTrialModal = () => {
    trialModal.classList.remove("active");
  };

  // NumPad Modal (for manual edit & hints)
  function openNumPadModal(title) {
    numPadModal.querySelector(".modal-title").innerText = title;
    numPadModal.classList.add("active");
  }

  window.closeNumPad = () => {
    numPadModal.classList.remove("active");
    selectedCellIndex = null;
  };

  window.inputNum = (num) => {
    if (selectedCellIndex === null) return;
    
    // Prevent editing pre-filled cells
    if (decisionEngine.isOriginalCell(selectedCellIndex)) {
      showToast("此格為原始題目給予的答案，無法修改");
      closeNumPad();
      return;
    }
    
    if (isInputtingHint) {
      // Input hint
      const success = decisionEngine.applyHint(selectedCellIndex, num);
      if (success) {
        showToast("提示套用成功！");
      } else {
        showToast("無法套用提示到此格");
      }
      isInputtingHint = false;
    } else {
      // Direct edit
      decisionEngine.grid[selectedCellIndex] = num;
      decisionEngine.analyze();
    }
    
    closeNumPad();
    updateStatusBar();
    renderAppCanvas();
  };

  window.inputDirectlyFromTrial = () => {
    const idx = parseInt(trialModal.dataset.index);
    closeTrialModal();
    selectedCellIndex = idx;
    isInputtingHint = true;
    openNumPadModal(`輸入提示格答案 (${Math.floor(idx/9)+1}行, ${(idx%9)+1}列)`);
  };

  // Auto Solve Toggle
  btnAutoSolve.addEventListener("click", () => {
    if (!loadedImage) return;
    
    // Directly run analysis and solve what we can
    decisionEngine.analyze();
    
    if (decisionEngine.analysis && decisionEngine.analysis.solutions.length > 0) {
      // Overlay complete solution
      renderAppCanvas(true);
      showToast("已自動求解全盤！");
    } else {
      showToast("當前盤面無解，請確認數字是否正確");
    }
  });

  // Reset Button
  btnReset.addEventListener("click", () => {
    if (!loadedImage) return;
    if (confirm("確定要重設所有試錯與提示狀態嗎？")) {
      decisionEngine.reset();
      decisionEngine.setGrid(processor.recognizeBoard(srcCanvas, boardRect));
      updateStatusBar();
      renderAppCanvas();
    }
  });

  // Opacity Slider
  opacitySlider.addEventListener("input", () => {
    renderAppCanvas();
  });

  // Auto Picture-in-Picture on Visibility Change (when user switches tabs/goes home)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (loadedImage && !pip.isActive) {
        pip.start(srcCanvas).catch(err => console.log("Auto PiP error:", err));
      }
    } else if (document.visibilityState === "visible") {
      if (pip.isActive) {
        pip.stop().catch(err => console.log("Stop PiP error:", err));
      }
    }
  });

  // --- 4. Rendering logic ---

  // Color mapping for each digit (1-9)
  const digitColors = {
    1: '#FF6B6B',  // Red
    2: '#4ECDC4',  // Teal
    3: '#45B7D1',  // Blue
    4: '#96CEB4',  // Green
    5: '#e7b922',  // Yellow
    6: '#DDA0DD',  // Plum
    7: '#FF8C00',  // Dark Orange
    8: '#9B59B6',  // Purple
    9: '#3498DB'   // Bright Blue
  };

  function renderAppCanvas(forceFullSolve = false) {
    if (!loadedImage) return;

    // Draw background original image
    ctx.drawImage(loadedImage, 0, 0);

    if (!boardRect) return;

    const cellW = boardRect.width / 9;
    const cellH = boardRect.height / 9;
    const opacity = parseFloat(opacitySlider.value);

    // Update HTML overlay status on buttons
    const buttons = gridOverlay.querySelectorAll(".grid-cell-btn");
    buttons.forEach((btn, idx) => {
      btn.classList.remove("trial", "selected");
      // Render selection or highlights
      if (decisionEngine.trialCell && decisionEngine.trialCell.index === idx) {
        btn.classList.add("trial");
      }
    });

    // Drawing transparent cover box for empty/editable boxes
    // "如需取得先在原圖覆蓋渲染無答案在內的每格方框，並將每格設為可輸入的格子"
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cx = boardRect.x + c * cellW;
        const cy = boardRect.y + r * cellH;
        ctx.strokeRect(cx, cy, cellW, cellH);
      }
    }

    // Determine what numbers to overlay
    // Use the solved values from solver
    let overlayGrid = new Array(81).fill(0);
    const solvedSuccessfully = decisionEngine.isSolved() || forceFullSolve;

    if (solvedSuccessfully && decisionEngine.analysis.solutions.length > 0) {
      overlayGrid = decisionEngine.analysis.solutions[0];
    } else if (decisionEngine.analysis && decisionEngine.analysis.propGrid) {
      // Show logical deduction steps so far
      overlayGrid = decisionEngine.analysis.propGrid;
    }

    // Draw overlay texts
    ctx.save();
    // Use a standard web-safe font stack that works on all browsers and sizes correctly on natural canvas
    ctx.font = `bold ${Math.floor(cellW * 0.65)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i / 9);
      const c = i % 9;
      const cx = boardRect.x + c * cellW + cellW / 2;
      const cy = boardRect.y + r * cellH + cellH / 2;

      // Draw trial cell overlay in blue
      if (decisionEngine.trialCell && decisionEngine.trialCell.index === i) {
        const trialVal = decisionEngine.trialCell.value;
        
        // Draw blue trial border overlay
        ctx.strokeStyle = "#00A2FF";
        ctx.lineWidth = Math.max(3, Math.floor(cellW * 0.08));
        ctx.strokeRect(boardRect.x + c * cellW + 2, boardRect.y + r * cellH + 2, cellW - 4, cellH - 4);
        
        // Draw white text stroke outline first for maximum legibility on original grid
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = Math.max(4, Math.floor(cellW * 0.08));
        ctx.strokeText(trialVal.toString(), cx, cy);
        
        // Draw trial digit in blue
        ctx.fillStyle = "#00A2FF";
        ctx.fillText(trialVal.toString(), cx, cy);
        continue;
      }



      // Check if this number is already preset in the original grid
      if (decisionEngine.originalGrid[i] !== 0) {
        // Preset number, skip overlaying to avoid covering the original screenshot digit
        continue; 
      }

      // Render determined numbers
      const curVal = decisionEngine.grid[i];
      const solvedVal = overlayGrid[i];

      if (curVal !== 0) {
        // Confirmed user inputs / hints (draw in green)
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = Math.max(4, Math.floor(cellW * 0.08));
        ctx.strokeText(curVal.toString(), cx, cy);
        
        ctx.fillStyle = "#2ECC71";
        ctx.fillText(curVal.toString(), cx, cy);
      } else if (solvedVal !== 0 && solvedVal !== undefined) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.lineWidth = Math.max(4, Math.floor(cellW * 0.08));
        ctx.strokeText(solvedVal.toString(), cx, cy);
        
        // Use digit-specific color
        const digitColor = digitColors[solvedVal] || 'rgba(245, 166, 35, 1)';
        ctx.fillStyle = digitColor;
        ctx.fillText(solvedVal.toString(), cx, cy);
      }
    }
    ctx.restore();
  }

  // --- 5. Status indicators ---

  function updateStatusBar() {
    // Errors status
    const remErrors = decisionEngine.errorsMax - decisionEngine.errorsCount;
    errorStatusEl.innerText = `剩餘試錯: ${remErrors}次`;

    // Hints status
    const remHints = decisionEngine.hintsMax - decisionEngine.hintsCount;
    hintStatusEl.innerText = `提示: ${remHints}次`;

    // Solve status text
    if (!decisionEngine.analysis) {
      solutionStatusEl.innerText = "等待分析";
      solutionStatusEl.className = "status-dot";
      return;
    }

    const dot = solutionStatusEl.previousElementSibling;
    dot.className = "status-dot";

    switch (decisionEngine.analysis.status) {
      case "unique":
        if (decisionEngine.isSolved()) {
          solutionStatusEl.innerText = "全盤解開！";
          dot.className = "status-dot active";
        } else {
          solutionStatusEl.innerText = "有唯一解 (需要試錯)";
        }
        break;
      case "multiple":
        solutionStatusEl.innerText = "多重解";
        break;
      case "unsolvable":
        solutionStatusEl.innerText = "無解 (請確認數字)";
        break;
    }
  }

  // --- 6. Helper utilities ---

  function showToast(message) {
    toast.innerText = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 3000);
  }

  // Register PWA Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .then(() => console.log("Service Worker Registered"))
      .catch((err) => console.error("SW Register Failed", err));
  }
});

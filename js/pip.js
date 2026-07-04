/**
 * Picture-in-Picture (PiP) Controller for '數獨人'
 * Converts a Canvas element into a video stream to display it in a native
 * Picture-in-Picture floating window on mobile devices.
 */
class PipController {
  constructor() {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    // 注意：故意不設定 "autoplay" 屬性。
    // 如果設定了 autoplay，瀏覽器會在 srcObject 被指定的瞬間，
    // 自動觸發一次「隱性」的 play()。這個隱性 play() 會跟下面
    // 我們手動呼叫的 play() 互相競爭，導致其中一個被瀏覽器判定
    // 「被新的 load 請求中斷」而丟出 AbortError。
    // 手動全權控制 play() 的呼叫時機，就能避免這個 race condition。
    this.video.setAttribute("playsinline", "");
    
    // Style it off-screen
    this.video.style.position = "fixed";
    this.video.style.top = "-9999px";
    this.video.style.width = "1px";
    this.video.style.height = "1px";
    this.video.style.opacity = "0";
    
    document.body.appendChild(this.video);
    
    this.stream = null;
    this.isActive = false;
    this._starting = false; // 避免 start() 被重疊呼叫
    this._stateChangeCallback = null;

    // Listen to Picture-in-Picture events
    this.video.addEventListener("enterpictureinpicture", () => {
      this.isActive = true;
      if (this._stateChangeCallback) this._stateChangeCallback(true);
    });

    this.video.addEventListener("leavepictureinpicture", () => {
      this.isActive = false;
      this.stop();
      if (this._stateChangeCallback) this._stateChangeCallback(false);
    });
  }

  /**
   * Check if Picture-in-Picture is supported by the browser.
   */
  isSupported() {
    return (
      "pictureInPictureEnabled" in document &&
      document.pictureInPictureEnabled &&
      typeof HTMLCanvasElement.prototype.captureStream === "function"
    );
  }

  /**
   * Start displaying the canvas in Picture-in-Picture mode.
   * Must be called from a user interaction handler.
   */
  async start(canvas) {
    if (!this.isSupported()) {
      throw new Error("您的瀏覽器不支援子母畫面 (PiP) 功能。");
    }

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error("目前沒有可顯示的畫面內容，請先載入數獨圖片。");
    }

    if (
      document.pictureInPictureElement !== this.video &&
      typeof navigator !== "undefined" &&
      navigator.userActivation &&
      !navigator.userActivation.isActive
    ) {
      throw new Error("子母畫面必須由按鈕點擊直接觸發，無法在切到背景時自動開啟。");
    }

    // 避免快速連續呼叫（例如使用者連點按鈕，或切換分頁時
    // visibilitychange 又剛好觸發一次）造成多個 start() 互相打架
    if (this._starting) return;
    this._starting = true;

    try {
      // Exit PiP if already active (without stopping stream yet)
      if (document.pictureInPictureElement === this.video) {
        await document.exitPictureInPicture();
      }

      // Stop existing tracks if any
      if (this.video.srcObject) {
        const tracks = this.video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        this.video.srcObject = null;
      }

      // Capture canvas stream at 1 frame per second (enough for static text overlay)
      this.stream = canvas.captureStream(1);
      this.video.srcObject = this.stream;

      // 等待 video 真正吃到 metadata 後再播放，
      // 避免在瀏覽器仍在處理 srcObject 指定（load）時就呼叫 play()
      await new Promise((resolve, reject) => {
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        const onError = (e) => {
          cleanup();
          reject(e);
        };
        const cleanup = () => {
          this.video.removeEventListener("loadedmetadata", onLoaded);
          this.video.removeEventListener("error", onError);
        };
        // 有些瀏覽器對 MediaStream 可能已經是 ready 狀態，做個保險判斷
        if (this.video.readyState >= 1) {
          resolve();
          return;
        }
        this.video.addEventListener("loadedmetadata", onLoaded, { once: true });
        this.video.addEventListener("error", onError, { once: true });
      });

      // Play the video stream with proper promise handling
      try {
        const playPromise = this.video.play();
        if (playPromise !== undefined) {
          await playPromise;
        }
      } catch (playErr) {
        // 拿掉 autoplay 屬性後這裡理論上不會再出現 AbortError，
        // 但仍保留防呆：AbortError 通常是良性的（例如剛好被
        // 另一次 load 打斷），不需要整個流程中止
        if (playErr.name !== "AbortError") {
          throw playErr;
        }
      }
      
      // Request PiP window
      await this.video.requestPictureInPicture();
    } catch (err) {
      console.error("PiP Start Error:", err);
      await this.stop();
      if (err && err.name === "NotAllowedError") {
        throw new Error("瀏覽器阻擋了子母畫面，請用按鈕手動開啟後再試一次。");
      }
      if (err && err.name === "NotSupportedError") {
        throw new Error("目前裝置或瀏覽器不支援子母畫面。");
      }
      if (err && err.name === "InvalidStateError") {
        throw new Error("影片尚未準備完成，請稍候再試一次子母畫面。");
      }
      throw err;
    } finally {
      this._starting = false;
    }
  }

  /**
   * Stop Picture-in-Picture mode.
   */
  async stop() {
    try {
      if (document.pictureInPictureElement === this.video) {
        await document.exitPictureInPicture();
      }
    } catch (err) {
      console.error("PiP Exit Error:", err);
    } finally {
      if (this.video.srcObject) {
        // Stop all tracks in the media stream
        const tracks = this.video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        this.video.srcObject = null;
      }
      this.stream = null;
      this.isActive = false;
      if (this._stateChangeCallback) this._stateChangeCallback(false);
    }
  }

  /**
   * Toggle PiP mode on/off.
   */
  async toggle(canvas) {
    if (this.isActive) {
      await this.stop();
    } else {
      await this.start(canvas);
    }
  }

  /**
   * Register state change callback.
   */
  setOnStateChange(callback) {
    this._stateChangeCallback = callback;
  }
}

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PipController;
} else {
  window.PipController = PipController;
}

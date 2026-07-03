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
    this.video.setAttribute("autoplay", "");
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

    // Listen to Picture-in-Picture events
    this.video.addEventListener("enterpictureinpicture", () => {
      this.isActive = true;
      if (this.onStateChange) this.onStateChange(true);
    });

    this.video.addEventListener("leavepictureinpicture", () => {
      this.isActive = false;
      this.stop();
      if (this.onStateChange) this.onStateChange(false);
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

      // Play the video stream with proper promise handling
      const playPromise = this.video.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
      
      // Request PiP window
      await this.video.requestPictureInPicture();
    } catch (err) {
      console.error("PiP Start Error:", err);
      this.stop();
      throw err;
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
      if (this.onStateChange) this.onStateChange(false);
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
  onStateChange(callback) {
    this.onStateChange = callback;
  }
}

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PipController;
} else {
  window.PipController = PipController;
}

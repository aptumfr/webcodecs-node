/**
 * FrameLoop - High-performance frame generation with backpressure
 *
 * Manages frame generation with:
 * - Backpressure via maxQueueSize (default: 8)
 * - Automatic canvas reset before each frame
 * - Proper VideoFrame lifecycle management
 * - Async pipelining for optimal throughput
 *
 * Best practices implemented:
 * 1. Memory lifecycle: Explicit frame closing with try...finally
 * 2. Canvas state: ctx.reset() or clearRect at start of every frame
 * 3. Color formats: RGBA output, even dimensions for YUV420
 * 4. Pipeline optimization: Async pipelining with backpressure
 * 5. Raw buffer export: Always uses toBuffer('raw')
 */

import { Canvas } from 'skia-canvas';
import { VideoFrame } from '../core/VideoFrame.js';
import { createLogger } from '../utils/logger.js';
import { createCanvas, ensureEvenDimensions } from './gpu-context.js';
import { getRawPixels, resetCanvas, bufferToUint8Array } from './canvas-utils.js';
import type {
  FrameLoopConfig,
  FrameTiming,
  FrameLoopState,
} from './types.js';

const logger = createLogger('FrameLoop');

const DEFAULT_MAX_QUEUE_SIZE = 8;

// Use any for skia-canvas context since its types differ from DOM
type SkiaContext = any;

/**
 * FrameLoop class for generating video frames with backpressure control
 */
export class FrameLoop {
  private canvas: Canvas;
  private ctx: SkiaContext;
  private config: Required<FrameLoopConfig>;
  private state: FrameLoopState = 'idle';
  private frameIndex = 0;
  private queueSize = 0;
  private pendingFrames: VideoFrame[] = [];
  private resolveWaitForDrain: (() => void) | null = null;

  // Frame timing
  private startTime: number = 0;
  private frameDurationUs: number;

  constructor(config: FrameLoopConfig) {
    // Ensure even dimensions for YUV420 compatibility
    const dims = ensureEvenDimensions(config.width, config.height);

    this.config = {
      width: dims.width,
      height: dims.height,
      frameRate: config.frameRate,
      maxQueueSize: config.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
      gpu: config.gpu ?? true,
      onFrame: config.onFrame,
      onComplete: config.onComplete ?? (() => {}),
      onError: config.onError ?? (() => {}),
    };

    // Frame duration in microseconds
    this.frameDurationUs = Math.round(1_000_000 / this.config.frameRate);

    // Create GPU-accelerated canvas
    this.canvas = createCanvas({
      width: dims.width,
      height: dims.height,
      gpu: config.gpu,
    });

    this.ctx = this.canvas.getContext('2d');

    // Log creation info (engine property may not be available until first render)
    const engineInfo = (this.canvas as any).engine;
    logger.info(
      `FrameLoop created: ${dims.width}x${dims.height} @ ${config.frameRate}fps` +
        (engineInfo ? `, GPU: ${engineInfo.renderer}` : '')
    );
  }

  /**
   * Get current state
   */
  getState(): FrameLoopState {
    return this.state;
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queueSize;
  }

  /**
   * Get canvas width
   */
  getWidth(): number {
    return this.config.width;
  }

  /**
   * Get canvas height
   */
  getHeight(): number {
    return this.config.height;
  }

  /**
   * Get the underlying canvas for direct access
   */
  getCanvas(): Canvas {
    return this.canvas;
  }

  /**
   * Get the 2D context for direct access
   */
  getContext(): SkiaContext {
    return this.ctx;
  }

  /**
   * Start frame generation
   *
   * @param totalFrames - Total number of frames to generate (Infinity for continuous)
   */
  async start(totalFrames: number = Infinity): Promise<void> {
    if (this.state === 'running') {
      throw new Error('FrameLoop is already running');
    }

    this.state = 'running';
    this.startTime = performance.now();
    this.frameIndex = 0;

    try {
      while (this.state === 'running' && this.frameIndex < totalFrames) {
        // Backpressure: wait if queue is full
        if (this.queueSize >= this.config.maxQueueSize) {
          logger.debug(`Backpressure: waiting (queue: ${this.queueSize})`);
          await this.waitForDrain();
          if (this.state !== 'running') break;
        }

        // Generate frame
        await this.generateFrame();
        this.frameIndex++;
      }

      // Wait for all pending frames to be consumed
      while (this.pendingFrames.length > 0 && this.getState() !== 'stopped') {
        await this.waitForDrain();
      }

      if (this.getState() !== 'stopped') {
        this.state = 'stopped';
        this.config.onComplete();
      }
    } catch (error) {
      this.state = 'stopped';
      const err = error instanceof Error ? error : new Error(String(error));
      this.config.onError(err);
      throw err;
    }
  }

  /**
   * Stop frame generation immediately
   */
  stop(): void {
    this.state = 'stopped';

    // Close any pending frames
    for (const frame of this.pendingFrames) {
      try {
        frame.close();
      } catch {
        // Ignore close errors
      }
    }
    this.pendingFrames = [];
    this.queueSize = 0;

    // Unblock any waiting drain
    if (this.resolveWaitForDrain) {
      this.resolveWaitForDrain();
      this.resolveWaitForDrain = null;
    }
  }

  /**
   * Pause frame generation
   */
  pause(): void {
    if (this.state === 'running') {
      this.state = 'paused';
    }
  }

  /**
   * Resume frame generation
   */
  resume(): void {
    if (this.state === 'paused') {
      this.state = 'running';
      // Unblock any waiting drain
      if (this.resolveWaitForDrain) {
        this.resolveWaitForDrain();
        this.resolveWaitForDrain = null;
      }
    }
  }

  /**
   * Get the next frame from the loop
   *
   * Called by the encoder to consume frames. The caller takes ownership
   * of the frame and MUST call frame.close() when done.
   *
   * @returns The next VideoFrame, or null if none available
   */
  takeFrame(): VideoFrame | null {
    const frame = this.pendingFrames.shift();
    if (frame) {
      this.queueSize--;
      // Notify that there's room for more frames
      if (
        this.resolveWaitForDrain &&
        this.queueSize < this.config.maxQueueSize
      ) {
        this.resolveWaitForDrain();
        this.resolveWaitForDrain = null;
      }
    }
    return frame ?? null;
  }

  /**
   * Signal that a frame has been consumed externally
   *
   * Use this when frames are consumed outside of takeFrame(),
   * to maintain correct backpressure accounting.
   */
  frameConsumed(): void {
    this.queueSize = Math.max(0, this.queueSize - 1);
    if (
      this.resolveWaitForDrain &&
      this.queueSize < this.config.maxQueueSize
    ) {
      this.resolveWaitForDrain();
      this.resolveWaitForDrain = null;
    }
  }

  /**
   * Check if there are frames available
   */
  hasFrames(): boolean {
    return this.pendingFrames.length > 0;
  }

  /**
   * Get the current frame index
   */
  getCurrentFrameIndex(): number {
    return this.frameIndex;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────────

  private async generateFrame(): Promise<void> {
    const timing: FrameTiming = {
      frameIndex: this.frameIndex,
      timestamp: this.frameIndex * this.frameDurationUs,
      duration: this.frameDurationUs,
      presentationTime: performance.now() - this.startTime,
    };

    // Best practice: Reset canvas at start of every frame
    // This prevents Skia command history buildup
    resetCanvas(this.ctx);

    // Call user's frame rendering function
    await this.config.onFrame(this.ctx, timing);

    // Get raw RGBA pixels (never PNG!)
    const pixels = getRawPixels(this.canvas);
    const pixelArray = bufferToUint8Array(pixels);

    // Create VideoFrame with proper lifecycle
    let frame: VideoFrame | null = null;
    try {
      frame = new VideoFrame(new Uint8Array(pixelArray), {
        format: 'RGBA',
        codedWidth: this.config.width,
        codedHeight: this.config.height,
        timestamp: timing.timestamp,
        duration: timing.duration,
      });

      this.pendingFrames.push(frame);
      this.queueSize++;
    } catch (error) {
      // Best practice: Close frame on error
      if (frame) {
        try {
          frame.close();
        } catch {
          // Ignore close errors
        }
      }
      throw error;
    }
  }

  private waitForDrain(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resolveWaitForDrain = resolve;
    });
  }
}

/**
 * Create a FrameLoop with the given configuration
 *
 * @param config - FrameLoop configuration
 * @returns A new FrameLoop instance
 */
export function createFrameLoop(config: FrameLoopConfig): FrameLoop {
  return new FrameLoop(config);
}

/**
 * Canvas Module Types
 *
 * TypeScript interfaces for skia-canvas integration with WebCodecs
 */

/**
 * GPU rendering engine information from skia-canvas
 */
export interface GpuEngineInfo {
  renderer: 'CPU' | 'GPU';
  api?: 'Metal' | 'Vulkan' | 'D3D';
  device?: string;
  driver?: string;
  threads?: number;
  error?: string;
}

/**
 * Canvas configuration options
 */
export interface CanvasConfig {
  width: number;
  height: number;
  /** Enable GPU acceleration (default: auto-detect) */
  gpu?: boolean;
}

/**
 * Frame timing information for the FrameLoop
 */
export interface FrameTiming {
  /** Current frame index (0-based) */
  frameIndex: number;
  /** Timestamp in microseconds, for VideoFrame */
  timestamp: number;
  /** Duration in microseconds */
  duration?: number;
  /** High-resolution presentation time (performance.now() offset) */
  presentationTime: number;
}

/**
 * Callback for rendering a frame
 * The ctx parameter is a skia-canvas CanvasRenderingContext2D
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FrameCallback = (
  ctx: any,
  timing: FrameTiming
) => void | Promise<void>;

/**
 * FrameLoop configuration
 */
export interface FrameLoopConfig {
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Target frame rate (frames per second) */
  frameRate: number;
  /** Maximum frames in queue before backpressure (default: 8) */
  maxQueueSize?: number;
  /** Enable GPU acceleration (default: auto-detect) */
  gpu?: boolean;
  /** Called for each frame to render content */
  onFrame: FrameCallback;
  /** Called when all frames have been generated and consumed */
  onComplete?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
}

/**
 * FrameLoop state machine
 */
export type FrameLoopState = 'idle' | 'running' | 'paused' | 'stopped';

/**
 * Raw buffer format options for toBuffer
 */
export interface RawBufferOptions {
  /** Color type for raw buffer (default: 'rgba') */
  colorType?: 'rgba' | 'bgra';
}

/**
 * skia-canvas engine info interface
 */
export interface SkiaEngineInfo {
  renderer: string;
  api?: string;
  device?: string;
  driver?: string;
  threads?: number;
  error?: string;
}

/**
 * skia-canvas Canvas interface for type checking
 */
export interface SkiaCanvas {
  width: number;
  height: number;
  gpu: boolean;
  readonly engine: SkiaEngineInfo;
  // Use any for context since skia-canvas has different types than DOM
  getContext(type: '2d'): any;
  toBuffer(format: 'raw', options?: RawBufferOptions): Promise<Buffer>;
  toBufferSync(format: 'raw', options?: RawBufferOptions): Buffer;
  saveAs(filename: string, options?: unknown): Promise<void>;
  saveAsSync(filename: string, options?: unknown): void;
}

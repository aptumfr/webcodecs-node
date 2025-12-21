/**
 * Tests for Canvas Module (skia-canvas integration)
 */

import { Canvas } from 'skia-canvas';
import {
  detectGpuAcceleration,
  isGpuAvailable,
  getGpuApi,
  createCanvas,
  ensureEvenDimensions,
  validateEvenDimensions,
  resetGpuCache,
} from '../canvas/gpu-context.js';
import {
  createPixelBuffer,
  createPixelBufferWithColor,
  getRawPixels,
  getRawPixelsAsync,
  resetCanvas,
  pixelsToImageData,
  drawPixelsToCanvas,
  bufferToUint8Array,
  resizePixels,
} from '../canvas/canvas-utils.js';
import {
  OffscreenCanvasPolyfill,
  ImageDataPolyfill,
} from '../polyfills/OffscreenCanvas.js';
import { FrameLoop, createFrameLoop } from '../canvas/frame-loop.js';
import {
  isSkiaCanvas,
  isCanvasLike,
  extractCanvasPixels,
} from '../utils/type-guards.js';
import { VideoFrame } from '../core/VideoFrame.js';

describe('Canvas Module', () => {
  describe('GPU Context', () => {
    beforeEach(() => {
      // Reset GPU cache before each test
      resetGpuCache();
    });

    describe('detectGpuAcceleration', () => {
      it('should return GPU engine info', () => {
        const info = detectGpuAcceleration();

        expect(info).toBeDefined();
        expect(info.renderer).toMatch(/^(CPU|GPU)$/);
        // api is optional (only present when GPU is available)
        if (info.renderer === 'GPU') {
          expect(['Metal', 'Vulkan', 'D3D', undefined]).toContain(info.api);
        }
      });

      it('should cache GPU detection results', () => {
        const info1 = detectGpuAcceleration();
        const info2 = detectGpuAcceleration();

        expect(info1).toBe(info2); // Same object reference (cached)
      });

      it('should return fresh result after resetGpuCache', () => {
        const info1 = detectGpuAcceleration();
        resetGpuCache();
        const info2 = detectGpuAcceleration();

        // Results should be equal but not same object
        expect(info2.renderer).toBe(info1.renderer);
      });
    });

    describe('isGpuAvailable', () => {
      it('should return a boolean', () => {
        const result = isGpuAvailable();
        expect(typeof result).toBe('boolean');
      });
    });

    describe('getGpuApi', () => {
      it('should return null or a valid API name', () => {
        const api = getGpuApi();
        expect([null, 'Metal', 'Vulkan', 'D3D']).toContain(api);
      });
    });

    describe('createCanvas', () => {
      it('should create a canvas with specified dimensions', () => {
        const canvas = createCanvas({ width: 100, height: 50 });

        expect(canvas.width).toBe(100);
        expect(canvas.height).toBe(50);
      });

      it('should respect gpu option when explicitly set', () => {
        const canvas = createCanvas({ width: 10, height: 10, gpu: false });

        expect(canvas.width).toBe(10);
        expect(canvas.height).toBe(10);
      });
    });

    describe('ensureEvenDimensions', () => {
      it('should keep even dimensions unchanged', () => {
        const result = ensureEvenDimensions(1920, 1080);

        expect(result.width).toBe(1920);
        expect(result.height).toBe(1080);
      });

      it('should round up odd width', () => {
        const result = ensureEvenDimensions(1921, 1080);

        expect(result.width).toBe(1922);
        expect(result.height).toBe(1080);
      });

      it('should round up odd height', () => {
        const result = ensureEvenDimensions(1920, 1081);

        expect(result.width).toBe(1920);
        expect(result.height).toBe(1082);
      });

      it('should round up both odd dimensions', () => {
        const result = ensureEvenDimensions(1921, 1081);

        expect(result.width).toBe(1922);
        expect(result.height).toBe(1082);
      });
    });

    describe('validateEvenDimensions', () => {
      it('should not throw for even dimensions', () => {
        expect(() => validateEvenDimensions(1920, 1080)).not.toThrow();
        expect(() => validateEvenDimensions(640, 480)).not.toThrow();
        expect(() => validateEvenDimensions(2, 2)).not.toThrow();
      });

      it('should throw for odd width', () => {
        expect(() => validateEvenDimensions(1921, 1080)).toThrow(/width.*must be even/);
      });

      it('should throw for odd height', () => {
        expect(() => validateEvenDimensions(1920, 1081)).toThrow(/height.*must be even/);
      });

      it('should throw for both odd dimensions with helpful message', () => {
        expect(() => validateEvenDimensions(1921, 1081)).toThrow(/width.*height.*must be even/);
        expect(() => validateEvenDimensions(1921, 1081)).toThrow(/ensureEvenDimensions/);
      });
    });
  });

  describe('Canvas Utilities', () => {
    describe('createPixelBuffer', () => {
      it('should create Uint8ClampedArray of correct size', () => {
        const buffer = createPixelBuffer(10, 20);

        expect(buffer).toBeInstanceOf(Uint8ClampedArray);
        expect(buffer.length).toBe(10 * 20 * 4);
      });

      it('should auto-clamp values to 0-255', () => {
        const buffer = createPixelBuffer(1, 1);

        buffer[0] = 300;  // Overflow
        buffer[1] = -50;  // Underflow

        expect(buffer[0]).toBe(255); // Clamped to max
        expect(buffer[1]).toBe(0);   // Clamped to min
      });
    });

    describe('createPixelBufferWithColor', () => {
      it('should create buffer filled with solid color', () => {
        const buffer = createPixelBufferWithColor(2, 2, 255, 128, 64);

        expect(buffer.length).toBe(2 * 2 * 4);

        // Check all pixels
        for (let i = 0; i < buffer.length; i += 4) {
          expect(buffer[i]).toBe(255);     // R
          expect(buffer[i + 1]).toBe(128); // G
          expect(buffer[i + 2]).toBe(64);  // B
          expect(buffer[i + 3]).toBe(255); // A (default)
        }
      });

      it('should support custom alpha', () => {
        const buffer = createPixelBufferWithColor(1, 1, 100, 100, 100, 128);

        expect(buffer[3]).toBe(128); // Custom alpha
      });
    });

    describe('getRawPixels', () => {
      it('should return raw RGBA buffer from canvas', () => {
        const canvas = new Canvas(4, 4);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'red';
        ctx.fillRect(0, 0, 4, 4);

        const pixels = getRawPixels(canvas);

        expect(pixels).toBeInstanceOf(Buffer);
        expect(pixels.length).toBe(4 * 4 * 4); // 4x4 pixels, 4 bytes each (RGBA)
      });

      it('should return RGBA data with correct format', () => {
        const canvas = new Canvas(2, 2);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FF0000'; // Red
        ctx.fillRect(0, 0, 2, 2);

        const pixels = getRawPixels(canvas);

        // First pixel should be red (R=255, G=0, B=0, A=255)
        expect(pixels[0]).toBe(255); // R
        expect(pixels[1]).toBe(0);   // G
        expect(pixels[2]).toBe(0);   // B
        expect(pixels[3]).toBe(255); // A
      });
    });

    describe('getRawPixelsAsync', () => {
      it('should return raw RGBA buffer asynchronously', async () => {
        const canvas = new Canvas(4, 4);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'blue';
        ctx.fillRect(0, 0, 4, 4);

        const pixels = await getRawPixelsAsync(canvas);

        expect(pixels).toBeInstanceOf(Buffer);
        expect(pixels.length).toBe(4 * 4 * 4);
      });
    });

    describe('resetCanvas', () => {
      it('should clear canvas content', () => {
        const canvas = new Canvas(4, 4);
        const ctx = canvas.getContext('2d');

        // Fill with red
        ctx.fillStyle = 'red';
        ctx.fillRect(0, 0, 4, 4);

        // Reset
        resetCanvas(ctx);

        // Get pixels - should be transparent (or cleared)
        const pixels = getRawPixels(canvas);
        // After reset, pixels should be 0 (transparent black)
        expect(pixels[0]).toBe(0);
        expect(pixels[3]).toBe(0); // Alpha should be 0
      });
    });

    describe('pixelsToImageData', () => {
      it('should convert buffer to ImageData-like object', () => {
        const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
        const imageData = pixelsToImageData(data, 2, 1);

        expect(imageData.width).toBe(2);
        expect(imageData.height).toBe(1);
        expect(imageData.data).toBeInstanceOf(Uint8ClampedArray);
        expect(imageData.data.length).toBe(8);
      });
    });

    describe('drawPixelsToCanvas', () => {
      it('should draw pixel data to canvas', () => {
        const canvas = new Canvas(2, 2);

        // Create red pixel data
        const data = new Uint8Array(2 * 2 * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 255;     // R
          data[i + 1] = 0;   // G
          data[i + 2] = 0;   // B
          data[i + 3] = 255; // A
        }

        drawPixelsToCanvas(canvas, data, 2, 2);

        const pixels = getRawPixels(canvas);
        expect(pixels[0]).toBe(255); // R
        expect(pixels[1]).toBe(0);   // G
        expect(pixels[2]).toBe(0);   // B
      });
    });

    describe('bufferToUint8Array', () => {
      it('should convert Buffer to Uint8Array', () => {
        const buffer = Buffer.from([1, 2, 3, 4]);
        const array = bufferToUint8Array(buffer);

        expect(array).toBeInstanceOf(Uint8Array);
        expect(array.length).toBe(4);
        expect(array[0]).toBe(1);
        expect(array[3]).toBe(4);
      });
    });

    describe('resizePixels', () => {
      it('should resize pixel data to new dimensions', () => {
        // Create 4x4 red image
        const srcData = new Uint8Array(4 * 4 * 4);
        for (let i = 0; i < srcData.length; i += 4) {
          srcData[i] = 255;     // R
          srcData[i + 1] = 0;   // G
          srcData[i + 2] = 0;   // B
          srcData[i + 3] = 255; // A
        }

        // Resize to 2x2
        const resized = resizePixels(srcData, 4, 4, 2, 2);

        expect(resized).toBeInstanceOf(Buffer);
        expect(resized.length).toBe(2 * 2 * 4);
        // Color should still be red-ish
        expect(resized[0]).toBeGreaterThan(200); // R
      });
    });
  });

  describe('Type Guards', () => {
    describe('isSkiaCanvas', () => {
      it('should return true for skia-canvas Canvas', () => {
        const canvas = new Canvas(10, 10);
        expect(isSkiaCanvas(canvas)).toBe(true);
      });

      it('should return false for plain object', () => {
        const obj = { width: 10, height: 10 };
        expect(isSkiaCanvas(obj)).toBe(false);
      });

      it('should return false for null/undefined', () => {
        expect(isSkiaCanvas(null)).toBe(false);
        expect(isSkiaCanvas(undefined)).toBe(false);
      });
    });

    describe('isCanvasLike', () => {
      it('should return true for skia-canvas Canvas', () => {
        const canvas = new Canvas(10, 10);
        expect(isCanvasLike(canvas)).toBe(true);
      });

      it('should return true for mock canvas with getContext', () => {
        const mockCanvas = {
          width: 10,
          height: 10,
          getContext: () => null,
        };
        expect(isCanvasLike(mockCanvas)).toBe(true);
      });

      it('should return false for object without getContext', () => {
        const obj = { width: 10, height: 10 };
        expect(isCanvasLike(obj)).toBe(false);
      });
    });

    describe('extractCanvasPixels', () => {
      it('should extract pixels from skia-canvas', () => {
        const canvas = new Canvas(4, 4);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'green';
        ctx.fillRect(0, 0, 4, 4);

        const pixels = extractCanvasPixels(canvas);

        expect(pixels).toBeInstanceOf(Uint8Array);
        expect(pixels.length).toBe(4 * 4 * 4);
        // Green pixel: R=0, G=128, B=0
        expect(pixels[1]).toBeGreaterThan(100); // G channel
      });
    });
  });

  describe('FrameLoop', () => {
    describe('constructor', () => {
      it('should create FrameLoop with specified config', () => {
        const loop = new FrameLoop({
          width: 640,
          height: 480,
          frameRate: 30,
          onFrame: () => {},
        });

        expect(loop.getState()).toBe('idle');
        expect(loop.getWidth()).toBe(640);
        expect(loop.getHeight()).toBe(480);
        expect(loop.getQueueSize()).toBe(0);
      });

      it('should enforce even dimensions', () => {
        const loop = new FrameLoop({
          width: 641,  // Odd
          height: 481, // Odd
          frameRate: 30,
          onFrame: () => {},
        });

        expect(loop.getWidth()).toBe(642);  // Rounded up
        expect(loop.getHeight()).toBe(482); // Rounded up
      });
    });

    describe('createFrameLoop', () => {
      it('should be a factory function for FrameLoop', () => {
        const loop = createFrameLoop({
          width: 320,
          height: 240,
          frameRate: 24,
          onFrame: () => {},
        });

        expect(loop).toBeInstanceOf(FrameLoop);
        expect(loop.getState()).toBe('idle');
      });
    });

    describe('frame generation', () => {
      it('should generate frames and call onFrame callback', async () => {
        const framesCaptured: number[] = [];

        const loop = createFrameLoop({
          width: 64,
          height: 64,
          frameRate: 30,
          maxQueueSize: 5,
          onFrame: (ctx, timing) => {
            framesCaptured.push(timing.frameIndex);
            ctx.fillStyle = 'blue';
            ctx.fillRect(0, 0, 64, 64);
          },
        });

        // Start generating 3 frames in background
        const startPromise = loop.start(3);

        // Consume frames
        await new Promise(resolve => setTimeout(resolve, 100));
        while (loop.hasFrames()) {
          const frame = loop.takeFrame();
          if (frame) {
            frame.close();
          }
        }

        await startPromise;

        expect(loop.getState()).toBe('stopped');
        expect(framesCaptured).toEqual([0, 1, 2]);
      });

      it('should produce VideoFrames with correct properties', async () => {
        const loop = createFrameLoop({
          width: 128,
          height: 96,
          frameRate: 25,
          onFrame: (ctx) => {
            ctx.fillStyle = 'red';
            ctx.fillRect(0, 0, 128, 96);
          },
        });

        // Start and get one frame
        const startPromise = loop.start(1);
        await new Promise(resolve => setTimeout(resolve, 50));

        const frame = loop.takeFrame();
        expect(frame).not.toBeNull();
        expect(frame!.format).toBe('RGBA');
        expect(frame!.codedWidth).toBe(128);
        expect(frame!.codedHeight).toBe(96);
        expect(frame!.timestamp).toBe(0);
        expect(frame!.duration).toBe(40000); // 1000000 / 25 fps

        frame!.close();
        await startPromise;
      });

      it('should apply backpressure when queue is full', async () => {
        let framesGenerated = 0;

        const loop = createFrameLoop({
          width: 32,
          height: 32,
          frameRate: 60,
          maxQueueSize: 2,
          onFrame: () => {
            framesGenerated++;
          },
        });

        // Start generating many frames
        const startPromise = loop.start(10);

        // Wait a bit - should hit backpressure
        await new Promise(resolve => setTimeout(resolve, 50));

        // Queue should be at max
        expect(loop.getQueueSize()).toBeLessThanOrEqual(2);

        // Now consume all frames
        while (loop.getState() !== 'stopped' || loop.hasFrames()) {
          const frame = loop.takeFrame();
          if (frame) {
            frame.close();
          }
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        await startPromise;
        expect(framesGenerated).toBe(10);
      });
    });

    describe('stop', () => {
      it('should stop frame generation and close pending frames', async () => {
        const loop = createFrameLoop({
          width: 32,
          height: 32,
          frameRate: 30,
          onFrame: () => {},
        });

        // Start generating infinite frames
        loop.start(Infinity);

        // Wait for some frames
        await new Promise(resolve => setTimeout(resolve, 50));

        // Stop
        loop.stop();

        expect(loop.getState()).toBe('stopped');
        expect(loop.getQueueSize()).toBe(0);
        expect(loop.hasFrames()).toBe(false);
      });
    });

    describe('pause/resume', () => {
      it('should pause and resume frame generation', async () => {
        let framesGenerated = 0;

        const loop = createFrameLoop({
          width: 32,
          height: 32,
          frameRate: 30,
          onFrame: () => {
            framesGenerated++;
          },
        });

        // Start
        loop.start(Infinity);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Pause
        loop.pause();
        expect(loop.getState()).toBe('paused');

        const countAtPause = framesGenerated;
        await new Promise(resolve => setTimeout(resolve, 50));

        // Should not have generated more while paused (approximately)
        expect(framesGenerated).toBeLessThanOrEqual(countAtPause + 1);

        // Resume and stop
        loop.resume();
        expect(loop.getState()).toBe('running');

        await new Promise(resolve => setTimeout(resolve, 30));
        loop.stop();
      });
    });
  });

  describe('VideoFrame with skia-canvas', () => {
    it('should create VideoFrame from skia-canvas', () => {
      const canvas = new Canvas(64, 48);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#00FF00';
      ctx.fillRect(0, 0, 64, 48);

      const frame = new VideoFrame(canvas, {
        timestamp: 1000000,
      });

      expect(frame.format).toBe('RGBA');
      expect(frame.codedWidth).toBe(64);
      expect(frame.codedHeight).toBe(48);
      expect(frame.timestamp).toBe(1000000);

      frame.close();
    });

    it('should extract correct pixel data from skia-canvas', async () => {
      const canvas = new Canvas(2, 2);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FF0000'; // Red
      ctx.fillRect(0, 0, 2, 2);

      const frame = new VideoFrame(canvas, {
        timestamp: 0,
      });

      const buffer = new Uint8Array(frame.allocationSize());
      await frame.copyTo(buffer);

      // First pixel should be red
      expect(buffer[0]).toBe(255); // R
      expect(buffer[1]).toBe(0);   // G
      expect(buffer[2]).toBe(0);   // B
      expect(buffer[3]).toBe(255); // A

      frame.close();
    });
  });

  describe('OffscreenCanvasPolyfill', () => {
    describe('constructor', () => {
      it('should create canvas with specified dimensions', () => {
        const canvas = new OffscreenCanvasPolyfill(800, 600);

        expect(canvas.width).toBe(800);
        expect(canvas.height).toBe(600);
      });
    });

    describe('width/height setters', () => {
      it('should resize canvas when width is set', () => {
        const canvas = new OffscreenCanvasPolyfill(100, 100);
        canvas.width = 200;

        expect(canvas.width).toBe(200);
        expect(canvas.height).toBe(100);
      });

      it('should resize canvas when height is set', () => {
        const canvas = new OffscreenCanvasPolyfill(100, 100);
        canvas.height = 200;

        expect(canvas.width).toBe(100);
        expect(canvas.height).toBe(200);
      });
    });

    describe('getContext', () => {
      it('should return 2D context for "2d"', () => {
        const canvas = new OffscreenCanvasPolyfill(100, 100);
        const ctx = canvas.getContext('2d');

        expect(ctx).not.toBeNull();
        expect(typeof ctx.fillRect).toBe('function');
        expect(typeof ctx.clearRect).toBe('function');
      });

      it('should return same context on multiple calls', () => {
        const canvas = new OffscreenCanvasPolyfill(100, 100);
        const ctx1 = canvas.getContext('2d');
        const ctx2 = canvas.getContext('2d');

        expect(ctx1).toBe(ctx2);
      });

      it('should return null for unsupported context types', () => {
        const canvas = new OffscreenCanvasPolyfill(100, 100);
        const ctx = canvas.getContext('webgl');

        expect(ctx).toBeNull();
      });
    });

    describe('drawing', () => {
      it('should support basic drawing operations', () => {
        const canvas = new OffscreenCanvasPolyfill(4, 4);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#FF0000';
        ctx.fillRect(0, 0, 4, 4);

        const pixels = canvas._getImageData();
        expect(pixels[0]).toBe(255); // R
        expect(pixels[1]).toBe(0);   // G
        expect(pixels[2]).toBe(0);   // B
      });
    });

    describe('convertToBlob', () => {
      it('should convert to PNG blob by default', async () => {
        const canvas = new OffscreenCanvasPolyfill(10, 10);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'blue';
        ctx.fillRect(0, 0, 10, 10);

        const blob = await canvas.convertToBlob();

        expect(blob.type).toBe('image/png');
        expect(blob.size).toBeGreaterThan(0);
      });

      it('should support JPEG format', async () => {
        const canvas = new OffscreenCanvasPolyfill(10, 10);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'red';
        ctx.fillRect(0, 0, 10, 10);

        const blob = await canvas.convertToBlob({ type: 'image/jpeg' });

        expect(blob.type).toBe('image/jpeg');
      });

      it('should support WebP format', async () => {
        const canvas = new OffscreenCanvasPolyfill(10, 10);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'green';
        ctx.fillRect(0, 0, 10, 10);

        const blob = await canvas.convertToBlob({ type: 'image/webp' });

        expect(blob.type).toBe('image/webp');
      });
    });

    describe('transferToImageBitmap', () => {
      it('should return ImageBitmap-like object', () => {
        const canvas = new OffscreenCanvasPolyfill(32, 24);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'purple';
        ctx.fillRect(0, 0, 32, 24);

        const bitmap = canvas.transferToImageBitmap();

        expect(bitmap.width).toBe(32);
        expect(bitmap.height).toBe(24);
        expect(bitmap._data).toBeInstanceOf(Uint8ClampedArray);
        expect(typeof bitmap.close).toBe('function');
      });
    });

    describe('_getImageData', () => {
      it('should return raw RGBA pixel data', () => {
        const canvas = new OffscreenCanvasPolyfill(2, 2);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#00FF00'; // Green
        ctx.fillRect(0, 0, 2, 2);

        const pixels = canvas._getImageData();

        expect(pixels).toBeInstanceOf(Uint8ClampedArray);
        expect(pixels.length).toBe(2 * 2 * 4);
        expect(pixels[1]).toBeGreaterThan(200); // G channel
      });
    });

    describe('gpu property', () => {
      it('should allow getting/setting GPU acceleration', () => {
        const canvas = new OffscreenCanvasPolyfill(100, 100);

        // Get current value
        const initialGpu = canvas.gpu;
        expect(typeof initialGpu).toBe('boolean');

        // Set value
        canvas.gpu = false;
        expect(canvas.gpu).toBe(false);
      });
    });

    describe('VideoFrame integration', () => {
      it('should work with VideoFrame constructor', () => {
        const canvas = new OffscreenCanvasPolyfill(64, 48);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0000FF';
        ctx.fillRect(0, 0, 64, 48);

        const frame = new VideoFrame(canvas, {
          timestamp: 5000,
        });

        expect(frame.format).toBe('RGBA');
        expect(frame.codedWidth).toBe(64);
        expect(frame.codedHeight).toBe(48);
        expect(frame.timestamp).toBe(5000);

        frame.close();
      });
    });
  });

  describe('ImageDataPolyfill', () => {
    it('should create empty ImageData with dimensions', () => {
      const imageData = new ImageDataPolyfill(10, 20);

      expect(imageData.width).toBe(10);
      expect(imageData.height).toBe(20);
      expect(imageData.data.length).toBe(10 * 20 * 4);
      expect(imageData.colorSpace).toBe('srgb');
    });

    it('should create ImageData from existing data', () => {
      const data = new Uint8ClampedArray(16);
      data[0] = 255;

      const imageData = new ImageDataPolyfill(data, 2, 2);

      expect(imageData.width).toBe(2);
      expect(imageData.height).toBe(2);
      expect(imageData.data[0]).toBe(255);
    });

    it('should have colorType property for skia-canvas compatibility', () => {
      const imageData = new ImageDataPolyfill(10, 10);

      expect(imageData.colorType).toBe('rgba');
    });
  });
});

/**
 * OffscreenCanvas Example
 *
 * Demonstrates using the OffscreenCanvas polyfill for browser-compatible
 * canvas code in Node.js. This makes porting browser code trivial.
 *
 * Features shown:
 * - OffscreenCanvasPolyfill (browser API compatible)
 * - ImageDataPolyfill with Uint8ClampedArray
 * - createPixelBuffer utilities
 * - convertToBlob for image export
 * - VideoFrame integration
 *
 * Run: npx tsx examples/offscreen-canvas.ts
 */

import {
  VideoEncoder,
  VideoFrame,
  EncodedVideoChunk,
} from '../src/index.js';

import {
  OffscreenCanvasPolyfill,
  ImageDataPolyfill,
  installOffscreenCanvasPolyfill,
} from '../src/polyfills/OffscreenCanvas.js';

import {
  createPixelBuffer,
  createPixelBufferWithColor,
  ensureEvenDimensions,
  validateEvenDimensions,
} from '../src/canvas/index.js';

import { writeFileSync } from 'fs';

async function main() {
  console.log('=== OffscreenCanvas Polyfill Demo ===\n');

  // ============================================
  // 1. Install Polyfill Globally (Optional)
  // ============================================
  // This makes OffscreenCanvas available globally like in browsers
  installOffscreenCanvasPolyfill();
  console.log('Polyfill installed globally');
  console.log(`  globalThis.OffscreenCanvas: ${typeof (globalThis as any).OffscreenCanvas}`);
  console.log(`  globalThis.ImageData: ${typeof (globalThis as any).ImageData}`);
  console.log(`  globalThis.VideoFrame: ${typeof (globalThis as any).VideoFrame}`);

  // ============================================
  // 2. Create OffscreenCanvas (Browser-Style)
  // ============================================
  console.log('\n=== Creating OffscreenCanvas ===\n');

  const { width, height } = ensureEvenDimensions(640, 480);
  const canvas = new OffscreenCanvasPolyfill(width, height);

  console.log(`Canvas created: ${canvas.width}x${canvas.height}`);
  console.log(`GPU enabled: ${canvas.gpu}`);

  // Get 2D context (just like in browser)
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context');
  }

  // ============================================
  // 3. Draw on Canvas
  // ============================================
  console.log('\n=== Drawing ===\n');

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, width, height);

  // Gradient rectangle
  const gradient = ctx.createLinearGradient(50, 50, 250, 250);
  gradient.addColorStop(0, '#e94560');
  gradient.addColorStop(1, '#0f3460');
  ctx.fillStyle = gradient;
  ctx.fillRect(50, 50, 200, 200);

  // Circle
  ctx.beginPath();
  ctx.arc(450, 200, 100, 0, Math.PI * 2);
  ctx.fillStyle = '#16213e';
  ctx.fill();
  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Text
  ctx.fillStyle = 'white';
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('OffscreenCanvas', width / 2, height - 80);

  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#888';
  ctx.fillText('Node.js + skia-canvas', width / 2, height - 50);

  console.log('Drawing complete');

  // ============================================
  // 4. Export to Blob (PNG, JPEG, WebP)
  // ============================================
  console.log('\n=== Export to Blob ===\n');

  // PNG export
  const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
  console.log(`PNG: ${pngBlob.size} bytes, type: ${pngBlob.type}`);

  // JPEG export with quality
  const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  console.log(`JPEG: ${jpegBlob.size} bytes, type: ${jpegBlob.type}`);

  // WebP export
  const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
  console.log(`WebP: ${webpBlob.size} bytes, type: ${webpBlob.type}`);

  // ============================================
  // 5. ImageData Operations
  // ============================================
  console.log('\n=== ImageData Operations ===\n');

  // Create empty ImageData
  const imageData = new ImageDataPolyfill(100, 100);
  console.log(`Empty ImageData: ${imageData.width}x${imageData.height}`);
  console.log(`Data type: ${imageData.data.constructor.name}`);
  console.log(`Data length: ${imageData.data.length} bytes`);
  console.log(`Color type: ${imageData.colorType} (for skia-canvas)`);

  // Fill with gradient using direct pixel manipulation
  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      const idx = (y * imageData.width + x) * 4;
      imageData.data[idx] = (x * 255) / imageData.width; // R
      imageData.data[idx + 1] = (y * 255) / imageData.height; // G
      imageData.data[idx + 2] = 128; // B
      imageData.data[idx + 3] = 255; // A
    }
  }

  // Draw ImageData to canvas
  ctx.putImageData(imageData as any, 270, 280);
  console.log('ImageData drawn to canvas');

  // ============================================
  // 6. Pixel Buffer Utilities
  // ============================================
  console.log('\n=== Pixel Buffer Utilities ===\n');

  // Create empty buffer
  const emptyBuffer = createPixelBuffer(64, 64);
  console.log(`createPixelBuffer(64, 64): ${emptyBuffer.length} bytes`);
  console.log(`Type: ${emptyBuffer.constructor.name}`);

  // Create solid color buffer
  const redBuffer = createPixelBufferWithColor(64, 64, 255, 0, 0);
  console.log(`createPixelBufferWithColor (red): first pixel = [${redBuffer[0]}, ${redBuffer[1]}, ${redBuffer[2]}, ${redBuffer[3]}]`);

  // Demonstrate Uint8ClampedArray auto-clamping
  const testBuffer = createPixelBuffer(1, 1);
  testBuffer[0] = 300; // Will be clamped to 255
  testBuffer[1] = -50; // Will be clamped to 0
  console.log(`Auto-clamping: 300 -> ${testBuffer[0]}, -50 -> ${testBuffer[1]}`);

  // ============================================
  // 7. Dimension Validation
  // ============================================
  console.log('\n=== Dimension Validation ===\n');

  // ensureEvenDimensions rounds up
  const dims = ensureEvenDimensions(1279, 719);
  console.log(`ensureEvenDimensions(1279, 719) = ${dims.width}x${dims.height}`);

  // validateEvenDimensions throws for odd dimensions
  try {
    validateEvenDimensions(1279, 720);
  } catch (err: any) {
    console.log(`validateEvenDimensions(1279, 720) threw: "${err.message.split('.')[0]}..."`);
  }

  // ============================================
  // 8. VideoFrame Integration
  // ============================================
  console.log('\n=== VideoFrame Integration ===\n');

  // Create VideoFrame directly from OffscreenCanvas
  const frame = new VideoFrame(canvas as any, {
    timestamp: 0,
  });

  console.log(`VideoFrame from OffscreenCanvas:`);
  console.log(`  Size: ${frame.displayWidth}x${frame.displayHeight}`);
  console.log(`  Format: ${frame.format}`);
  console.log(`  Timestamp: ${frame.timestamp}`);

  // Use with encoder
  const chunks: EncodedVideoChunk[] = [];
  const encoder = new VideoEncoder({
    output: (chunk) => chunks.push(chunk),
    error: console.error,
  });

  encoder.configure({
    codec: 'avc1.42001f',
    width,
    height,
    bitrate: 2_000_000,
    framerate: 30,
  });

  encoder.encode(frame, { keyFrame: true });
  frame.close();

  await encoder.flush();
  encoder.close();

  console.log(`Encoded to ${chunks.length} chunk(s), ${chunks[0].byteLength} bytes`);

  // ============================================
  // 9. Save Sample Output
  // ============================================
  console.log('\n=== Done ===\n');
  console.log('OffscreenCanvas polyfill provides full browser API compatibility!');
}

main().catch(console.error);

/**
 * Canvas Encoding Example
 *
 * Demonstrates GPU-accelerated canvas rendering with skia-canvas
 * and encoding to H.264 video using the FrameLoop helper.
 *
 * Features shown:
 * - GPU acceleration detection (Metal/Vulkan/D3D)
 * - Creating GPU-accelerated canvas
 * - FrameLoop with backpressure for smooth encoding
 * - Animated canvas drawing
 * - Proper memory lifecycle (frame closing)
 *
 * Run: npx tsx examples/canvas-encoding.ts
 */

import {
  VideoEncoder,
  EncodedVideoChunk,
  createCanvas,
  createFrameLoop,
  detectGpuAcceleration,
  isGpuAvailable,
  getGpuApi,
  ensureEvenDimensions,
} from '../src/index.js';

async function main() {
  // ============================================
  // 1. Detect GPU Acceleration
  // ============================================
  console.log('=== GPU Detection ===\n');

  const gpuInfo = detectGpuAcceleration();
  console.log(`Renderer: ${gpuInfo.renderer}`);
  console.log(`GPU Available: ${isGpuAvailable()}`);

  const gpuApi = getGpuApi();
  if (gpuApi) {
    console.log(`GPU API: ${gpuApi}`);
    if (gpuInfo.device) {
      console.log(`Device: ${gpuInfo.device}`);
    }
  } else {
    console.log('GPU API: None (CPU fallback)');
  }

  // ============================================
  // 2. Setup Video Parameters
  // ============================================
  console.log('\n=== Video Setup ===\n');

  // Ensure even dimensions for YUV420 compatibility
  const { width, height } = ensureEvenDimensions(1280, 720);
  const frameRate = 30;
  const totalFrames = 90; // 3 seconds
  const maxQueueSize = 8; // Backpressure limit

  console.log(`Resolution: ${width}x${height}`);
  console.log(`Frame Rate: ${frameRate} fps`);
  console.log(`Total Frames: ${totalFrames}`);
  console.log(`Duration: ${(totalFrames / frameRate).toFixed(1)}s`);

  // ============================================
  // 3. Create Encoder
  // ============================================
  const chunks: EncodedVideoChunk[] = [];
  let encodedCount = 0;

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      chunks.push(chunk);
      encodedCount++;

      if (metadata?.decoderConfig) {
        console.log('\nDecoder config received');
      }
    },
    error: (err) => {
      console.error('Encoding error:', err);
    },
  });

  encoder.configure({
    codec: 'avc1.42001f', // H.264 Baseline Level 3.1
    width,
    height,
    bitrate: 5_000_000, // 5 Mbps
    framerate: frameRate,
    bitrateMode: 'variable',
  });

  // ============================================
  // 4. Create FrameLoop with Canvas Drawing
  // ============================================
  console.log('\n=== Encoding ===\n');

  const startTime = Date.now();

  const loop = createFrameLoop({
    width,
    height,
    frameRate,
    maxQueueSize,
    gpu: isGpuAvailable(), // Use GPU if available

    // This callback draws each frame
    onFrame: (ctx, timing) => {
      const { frameIndex, timestamp } = timing;
      const t = frameIndex / totalFrames; // Progress 0-1

      // Background gradient that shifts over time
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, `hsl(${(frameIndex * 3) % 360}, 70%, 20%)`);
      gradient.addColorStop(1, `hsl(${(frameIndex * 3 + 180) % 360}, 70%, 40%)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Animated circles
      const numCircles = 5;
      for (let i = 0; i < numCircles; i++) {
        const phase = (i / numCircles) * Math.PI * 2;
        const x = width / 2 + Math.cos(frameIndex * 0.05 + phase) * 200;
        const y = height / 2 + Math.sin(frameIndex * 0.07 + phase) * 150;
        const radius = 30 + Math.sin(frameIndex * 0.1 + i) * 20;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${(i * 72 + frameIndex * 2) % 360}, 80%, 60%, 0.7)`;
        ctx.fill();
      }

      // Central pulsing circle
      const pulseRadius = 80 + Math.sin(frameIndex * 0.15) * 30;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, pulseRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fill();

      // Frame counter text
      ctx.fillStyle = 'white';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`Frame: ${frameIndex + 1}/${totalFrames}`, 20, 20);

      // Timestamp
      ctx.font = '18px sans-serif';
      ctx.fillText(`Time: ${(timestamp / 1_000_000).toFixed(3)}s`, 20, 50);

      // GPU status
      ctx.textAlign = 'right';
      ctx.fillText(`GPU: ${gpuApi || 'CPU'}`, width - 20, 20);
    },
  });

  // ============================================
  // 5. Generate and Encode Frames
  // ============================================

  // Start frame generation
  loop.start(totalFrames);

  // Process frames as they become available
  let processedCount = 0;

  while (loop.getState() !== 'stopped' || loop.getQueueSize() > 0) {
    const frame = loop.takeFrame();

    if (frame) {
      try {
        // Request keyframe every second
        const keyFrame = processedCount % frameRate === 0;
        encoder.encode(frame, { keyFrame });
        processedCount++;

        // Progress indicator
        if (processedCount % 10 === 0 || processedCount === totalFrames) {
          process.stdout.write(`\rProcessed: ${processedCount}/${totalFrames} frames`);
        }
      } finally {
        // Always close the frame to free memory
        frame.close();
      }
    } else {
      // No frame available, wait briefly
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  console.log('\n');

  // ============================================
  // 6. Flush and Close
  // ============================================
  await encoder.flush();
  encoder.close();

  const endTime = Date.now();
  const elapsed = (endTime - startTime) / 1000;

  // ============================================
  // 7. Results
  // ============================================
  console.log('=== Results ===\n');

  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const keyFrames = chunks.filter((c) => c.type === 'key').length;
  const deltaFrames = chunks.filter((c) => c.type === 'delta').length;
  const actualBitrate = (totalBytes * 8) / (totalFrames / frameRate);

  console.log(`Total chunks: ${chunks.length}`);
  console.log(`Key frames: ${keyFrames}`);
  console.log(`Delta frames: ${deltaFrames}`);
  console.log(`Total size: ${(totalBytes / 1024).toFixed(2)} KB`);
  console.log(`Actual bitrate: ${(actualBitrate / 1000).toFixed(0)} kbps`);
  console.log(`Encoding time: ${elapsed.toFixed(2)}s`);
  console.log(`Speed: ${(totalFrames / elapsed).toFixed(1)} fps`);
  console.log(`Realtime: ${((totalFrames / frameRate) / elapsed).toFixed(2)}x`);
}

main().catch(console.error);

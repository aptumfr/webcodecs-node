/**
 * Demo: Matrix Rain
 *
 * Classic "Matrix" falling code effect with:
 * - Columns of falling Japanese/Latin characters
 * - Bright leading character with fading trail
 * - Variable speeds and random character changes
 * - Glow effects for that authentic cyberpunk feel
 */

import * as fs from 'fs';
import * as path from 'path';

import { createCanvas, getRawPixels } from '../canvas/index.js';
import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { VideoFrame } from '../core/VideoFrame.js';
import type { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import { muxChunks } from '../containers/index.js';

const WIDTH = 1280;
const HEIGHT = 720;
const DURATION_SECONDS = 15;
const FRAME_RATE = 30;
const FRAME_COUNT = DURATION_SECONDS * FRAME_RATE;
const FRAME_DURATION_US = Math.round(1_000_000 / FRAME_RATE);

const OUTPUT_DIR = path.resolve('media', 'matrix-demo');
const OUTPUT_VIDEO = path.join(OUTPUT_DIR, 'matrix-rain.mp4');

// Matrix character set: Katakana + Latin + Numbers + Symbols
const KATAKANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()+-=[]{}|;:,.<>?';
const CHARS = KATAKANA + LATIN + NUMBERS + SYMBOLS;

// Visual settings
const FONT_SIZE = 18;
const CHAR_HEIGHT = FONT_SIZE + 2;
const COLUMNS = Math.floor(WIDTH / (FONT_SIZE * 0.6));

// Colors
const COLORS = {
  background: '#000000',
  bright: '#ffffff',      // Leading character
  head: '#aaffaa',        // Near the head
  body: '#00ff00',        // Main green
  tail: '#008800',        // Darker tail
  dim: '#004400',         // Very dim trail
};

interface Column {
  x: number;              // X position
  y: number;              // Current Y position (head of the stream)
  speed: number;          // Fall speed (pixels per frame)
  length: number;         // Trail length
  chars: string[];        // Characters in the column
  changeRate: number;     // How often characters change (0-1)
}

function randomChar(): string {
  return CHARS[Math.floor(Math.random() * CHARS.length)];
}

function createColumn(x: number): Column {
  const length = 5 + Math.floor(Math.random() * 25);
  return {
    x,
    y: -Math.random() * HEIGHT * 2, // Start above screen at random height
    speed: 2 + Math.random() * 6,
    length,
    chars: Array(length).fill(0).map(() => randomChar()),
    changeRate: 0.02 + Math.random() * 0.08,
  };
}

function updateColumn(col: Column): void {
  col.y += col.speed;

  // Reset when fully off screen
  if (col.y - col.length * CHAR_HEIGHT > HEIGHT) {
    col.y = -Math.random() * HEIGHT * 0.5;
    col.speed = 2 + Math.random() * 6;
    col.length = 5 + Math.floor(Math.random() * 25);
    col.chars = Array(col.length).fill(0).map(() => randomChar());
  }

  // Randomly change characters
  for (let i = 0; i < col.chars.length; i++) {
    if (Math.random() < col.changeRate) {
      col.chars[i] = randomChar();
    }
  }
}

function drawMatrix(
  ctx: any,
  columns: Column[],
  time: number
): void {
  // Clear canvas completely each frame for consistent performance
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Set up text rendering once
  ctx.font = `bold ${FONT_SIZE}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Pre-calculated colors for trail gradient
  const trailColors = [
    '#ffffff', // 0 - head (white)
    '#ccffcc', // 1 - just behind
    '#88ff88', // 2
    '#66ff66', // 3
    '#44ff44', // 4
    '#00ff00', // 5 - main green
    '#00ee00', // 6
    '#00dd00', // 7
    '#00cc00', // 8
    '#00bb00', // 9
    '#00aa00', // 10
    '#009900', // 11
    '#008800', // 12
    '#007700', // 13
    '#006600', // 14
    '#005500', // 15 - dim
    '#004400', // 16+
  ];

  // Draw each column
  for (const col of columns) {
    const headY = Math.floor(col.y);

    for (let i = 0; i < col.chars.length; i++) {
      const charY = headY - i * CHAR_HEIGHT;

      // Skip if off screen
      if (charY < -CHAR_HEIGHT || charY > HEIGHT) continue;

      // Color based on position in trail
      const colorIndex = Math.min(i, trailColors.length - 1);
      ctx.fillStyle = trailColors[colorIndex];
      ctx.fillText(col.chars[i], col.x, charY);
    }
  }
}

function drawOverlay(ctx: any, time: number, fps: number): void {
  // Title text (no shadow for performance)
  ctx.fillStyle = '#00ff00';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('MATRIX RAIN', 20, 30);

  // Stats
  ctx.fillStyle = '#008800';
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${time.toFixed(1)}s | ${fps.toFixed(0)} fps`, WIDTH - 20, 30);
}

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    Matrix Rain Demo                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Initialize columns
  const columns: Column[] = [];
  const colWidth = WIDTH / COLUMNS;
  for (let i = 0; i < COLUMNS; i++) {
    columns.push(createColumn(colWidth * i + colWidth / 2));
  }

  // Create canvas
  const canvas = createCanvas({ width: WIDTH, height: HEIGHT });
  const ctx = canvas.getContext('2d');

  // Fill with black initially
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Collect encoded chunks
  const videoChunks: EncodedVideoChunk[] = [];
  let videoDescription: Uint8Array | undefined;

  // Video encoder
  const videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => {
      videoChunks.push(chunk);
      if (!videoDescription && metadata?.decoderConfig?.description) {
        const desc = metadata.decoderConfig.description;
        videoDescription = desc instanceof Uint8Array ? desc : new Uint8Array(desc as ArrayBuffer);
      }
    },
    error: (err) => console.error('Video encoder error:', err),
  });

  videoEncoder.configure({
    codec: 'avc1.640028', // H.264 High Profile Level 4.0
    width: WIDTH,
    height: HEIGHT,
    framerate: FRAME_RATE,
    bitrate: 8_000_000,
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-hardware',
    format: 'mp4',
  });

  console.log(`  Resolution: ${WIDTH}x${HEIGHT}`);
  console.log(`  Duration: ${DURATION_SECONDS}s`);
  console.log(`  Columns: ${COLUMNS}`);
  console.log(`  Characters: ${CHARS.length} unique`);
  console.log(`  Encoding...\n`);

  const startTime = Date.now();

  for (let i = 0; i < FRAME_COUNT; i++) {
    // Backpressure
    while (videoEncoder.encodeQueueSize >= 30) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const time = i / FRAME_RATE;
    const timestamp = i * FRAME_DURATION_US;

    // Update all columns
    for (const col of columns) {
      updateColumn(col);
    }

    // Draw frame
    drawMatrix(ctx, columns, time);

    // Calculate actual FPS
    const elapsed = (Date.now() - startTime) / 1000;
    const fps = elapsed > 0 ? (i + 1) / elapsed : 0;

    // Draw overlay (title, stats)
    drawOverlay(ctx, time, fps);

    // Get pixels and encode
    const pixels = getRawPixels(canvas);
    const frame = new VideoFrame(pixels, {
      format: 'RGBA',
      codedWidth: WIDTH,
      codedHeight: HEIGHT,
      timestamp,
      duration: FRAME_DURATION_US,
    });

    const isKeyFrame = i % FRAME_RATE === 0;
    videoEncoder.encode(frame, { keyFrame: isKeyFrame });
    frame.close();

    // Progress update
    if ((i + 1) % 30 === 0 || i === FRAME_COUNT - 1) {
      const progress = ((i + 1) / FRAME_COUNT * 100).toFixed(1);
      const eta = elapsed > 0 ? ((FRAME_COUNT - i - 1) / fps).toFixed(1) : '?';
      process.stdout.write(`\r  Frame ${i + 1}/${FRAME_COUNT} (${progress}%) | ${fps.toFixed(1)} fps | ETA: ${eta}s    `);
    }
  }

  console.log('\n\n  Flushing encoder...');
  await videoEncoder.flush();

  console.log(`  Encoded ${videoChunks.length} video chunks`);
  console.log(`  Muxing to MP4...\n`);

  // Mux to MP4
  await muxChunks({
    path: OUTPUT_VIDEO,
    video: {
      config: {
        codec: 'avc1.640028',
        codedWidth: WIDTH,
        codedHeight: HEIGHT,
        framerate: FRAME_RATE,
        bitrate: 8_000_000,
        description: videoDescription,
      },
      chunks: videoChunks,
    },
    forceBackend: 'node-av',
  });

  const totalTime = (Date.now() - startTime) / 1000;
  const fileSize = fs.statSync(OUTPUT_VIDEO).size;

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                        Complete!                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  console.log(`  Output: ${OUTPUT_VIDEO}`);
  console.log(`  Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Time: ${totalTime.toFixed(2)}s`);
  console.log(`  Avg FPS: ${(FRAME_COUNT / totalTime).toFixed(1)}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

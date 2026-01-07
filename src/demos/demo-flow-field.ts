/**
 * Demo: Flow Field
 *
 * Perlin noise-driven particle trails creating organic patterns:
 * - 2D Perlin noise generates flow vectors
 * - Thousands of particles follow the flow field
 * - Trails fade over time creating beautiful organic patterns
 * - Noise evolves slowly for dynamic animation
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
const DURATION_SECONDS = 10;
const FRAME_RATE = 30;
const FRAME_COUNT = DURATION_SECONDS * FRAME_RATE;
const FRAME_DURATION_US = Math.round(1_000_000 / FRAME_RATE);

const OUTPUT_DIR = path.resolve('media', 'flowfield-demo');
const OUTPUT_VIDEO = path.join(OUTPUT_DIR, 'flow-field.mp4');

// Flow field settings
const NOISE_SCALE = 0.003;      // How zoomed in the noise is
const NOISE_SPEED = 0.008;      // How fast the noise evolves
const PARTICLE_COUNT = 1500;    // Particles with short trails
const PARTICLE_SPEED = 2.5;     // Base particle speed
const TRAIL_LENGTH = 12;        // Short trail for visual effect

// Color palette - vibrant gradient
const COLORS = [
  [255, 0, 128],    // Pink
  [128, 0, 255],    // Purple
  [0, 128, 255],    // Blue
  [0, 255, 128],    // Cyan-green
  [128, 255, 0],    // Yellow-green
  [255, 128, 0],    // Orange
];

// ============================================================================
// Perlin Noise Implementation
// ============================================================================

class PerlinNoise {
  private permutation: number[];
  private p: number[];

  constructor(seed: number = 0) {
    this.permutation = [];
    for (let i = 0; i < 256; i++) {
      this.permutation[i] = i;
    }

    // Shuffle with seed
    let n = seed;
    for (let i = 255; i > 0; i--) {
      n = (n * 1103515245 + 12345) & 0x7fffffff;
      const j = n % (i + 1);
      [this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]];
    }

    // Duplicate permutation array
    this.p = [...this.permutation, ...this.permutation];
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise3D(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = this.fade(x);
    const v = this.fade(y);
    const w = this.fade(z);

    const A = this.p[X] + Y;
    const AA = this.p[A] + Z;
    const AB = this.p[A + 1] + Z;
    const B = this.p[X + 1] + Y;
    const BA = this.p[B] + Z;
    const BB = this.p[B + 1] + Z;

    return this.lerp(
      this.lerp(
        this.lerp(this.grad(this.p[AA], x, y, z), this.grad(this.p[BA], x - 1, y, z), u),
        this.lerp(this.grad(this.p[AB], x, y - 1, z), this.grad(this.p[BB], x - 1, y - 1, z), u),
        v
      ),
      this.lerp(
        this.lerp(this.grad(this.p[AA + 1], x, y, z - 1), this.grad(this.p[BA + 1], x - 1, y, z - 1), u),
        this.lerp(this.grad(this.p[AB + 1], x, y - 1, z - 1), this.grad(this.p[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }
}

// ============================================================================
// Particle System
// ============================================================================

interface Particle {
  trail: Array<{ x: number; y: number }>;
  colorIndex: number;
  speed: number;
}

function createParticle(): Particle {
  const x = Math.random() * WIDTH;
  const y = Math.random() * HEIGHT;
  return {
    trail: [{ x, y }],
    colorIndex: Math.floor(Math.random() * COLORS.length),
    speed: PARTICLE_SPEED * (0.5 + Math.random() * 0.5),
  };
}

function updateParticle(p: Particle, noise: PerlinNoise, time: number): void {
  const head = p.trail[0];

  // Get flow angle from noise
  const noiseVal = noise.noise3D(
    head.x * NOISE_SCALE,
    head.y * NOISE_SCALE,
    time * NOISE_SPEED
  );

  // Convert noise to angle
  const angle = noiseVal * Math.PI * 4;

  // Calculate new position
  let newX = head.x + Math.cos(angle) * p.speed;
  let newY = head.y + Math.sin(angle) * p.speed;

  // Wrap around edges - reset trail on wrap to avoid long lines
  let wrapped = false;
  if (newX < 0) { newX += WIDTH; wrapped = true; }
  if (newX >= WIDTH) { newX -= WIDTH; wrapped = true; }
  if (newY < 0) { newY += HEIGHT; wrapped = true; }
  if (newY >= HEIGHT) { newY -= HEIGHT; wrapped = true; }

  if (wrapped) {
    p.trail = [{ x: newX, y: newY }];
  } else {
    p.trail.unshift({ x: newX, y: newY });
    if (p.trail.length > TRAIL_LENGTH) p.trail.pop();
  }
}

function getColor(colorIndex: number, alpha: number): string {
  const c = COLORS[colorIndex];
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

// ============================================================================
// Rendering
// ============================================================================

function drawFlowField(
  ctx: any,
  particles: Particle[]
): void {
  // Clear canvas completely each frame - consistent performance
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Batch particles by color - critical for performance
  const batches: Particle[][] = COLORS.map(() => []);
  for (const p of particles) {
    batches[p.colorIndex].push(p);
  }

  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  // Draw each color batch - all trails in single path per color
  for (let c = 0; c < COLORS.length; c++) {
    const batch = batches[c];
    if (batch.length === 0) continue;

    ctx.strokeStyle = `rgb(${COLORS[c][0]}, ${COLORS[c][1]}, ${COLORS[c][2]})`;
    ctx.beginPath();

    for (const p of batch) {
      if (p.trail.length < 2) continue;
      ctx.moveTo(p.trail[0].x, p.trail[0].y);
      for (let i = 1; i < p.trail.length; i++) {
        ctx.lineTo(p.trail[i].x, p.trail[i].y);
      }
    }

    ctx.stroke();
  }
}

function drawOverlay(ctx: any, time: number, fps: number, particleCount: number): void {
  // Title
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('FLOW FIELD', 20, 30);

  // Stats
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${particleCount} particles | ${time.toFixed(1)}s | ${fps.toFixed(0)} fps`, WIDTH - 20, 30);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    Flow Field Demo                            ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Initialize
  const noise = new PerlinNoise(42);
  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(createParticle());
  }

  // Create canvas
  const canvas = createCanvas({ width: WIDTH, height: HEIGHT });
  const ctx = canvas.getContext('2d');

  // Fill with dark background initially
  ctx.fillStyle = '#0a0a14';
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
    codec: 'avc1.640028',
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
  console.log(`  Particles: ${PARTICLE_COUNT}`);
  console.log(`  Noise Scale: ${NOISE_SCALE}`);
  console.log(`  Encoding...\n`);

  const startTime = Date.now();

  for (let i = 0; i < FRAME_COUNT; i++) {
    // Backpressure
    while (videoEncoder.encodeQueueSize >= 30) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const time = i / FRAME_RATE;
    const timestamp = i * FRAME_DURATION_US;

    // Update all particles
    for (const p of particles) {
      updateParticle(p, noise, time);
    }

    // Draw frame
    drawFlowField(ctx, particles);

    // Calculate actual FPS
    const elapsed = (Date.now() - startTime) / 1000;
    const fps = elapsed > 0 ? (i + 1) / elapsed : 0;

    // Draw overlay
    drawOverlay(ctx, time, fps, PARTICLE_COUNT);

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

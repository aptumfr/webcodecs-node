/**
 * Demo: 1080p AVC to AVC Transcoding
 *
 * Demonstrates transcoding a 1080p video using our WebCodecs implementation.
 * Tests both software and hardware-accelerated encoding paths.
 */

import { transcode, getMediaInfo } from '../containers/index.js';
import { unlink, stat } from 'fs/promises';
import { existsSync } from 'fs';

const INPUT_FILE = 'media/bbb_1080_30s.mp4';
const OUTPUT_SOFTWARE = 'output_1080p_software.mp4';
const OUTPUT_HARDWARE = 'output_1080p_hardware.mp4';

async function cleanup(file: string) {
  if (existsSync(file)) {
    await unlink(file);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       1080p AVC to AVC Transcoding Demo                    ║');
  console.log('║       WebCodecs Node.js Implementation                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Check if input file exists
  if (!existsSync(INPUT_FILE)) {
    console.error(`Error: Input file not found: ${INPUT_FILE}`);
    console.error('Please ensure the media file exists.');
    process.exit(1);
  }

  // Get input file info
  console.log('📂 Input File Information');
  console.log('─'.repeat(50));
  try {
    const inputInfo = await getMediaInfo(INPUT_FILE);
    const inputStat = await stat(INPUT_FILE);

    console.log(`   File: ${INPUT_FILE}`);
    console.log(`   Size: ${formatBytes(inputStat.size)}`);
    console.log(`   Format: ${inputInfo.format}`);
    console.log(`   Duration: ${inputInfo.duration.toFixed(2)}s`);

    if (inputInfo.video) {
      console.log(`   Video: ${inputInfo.video.codec}`);
      console.log(`   Resolution: ${inputInfo.video.width}x${inputInfo.video.height}`);
    }
    if (inputInfo.audio) {
      console.log(`   Audio: ${inputInfo.audio.codec}, ${inputInfo.audio.sampleRate}Hz, ${inputInfo.audio.channels}ch`);
    }
    console.log();
  } catch (err) {
    console.error('Failed to get input info:', err);
    process.exit(1);
  }

  // Test 1: Software transcoding
  console.log('🔄 Test 1: Software Transcoding (AVC → AVC)');
  console.log('─'.repeat(50));
  try {
    let lastProgress = 0;
    const startTime = Date.now();

    const result = await transcode(INPUT_FILE, OUTPUT_SOFTWARE, {
      videoCodec: 'h264',
      videoBitrate: 4_000_000, // 4 Mbps for 1080p
      audioCodec: 'aac',
      audioBitrate: 128_000,
      gopSize: 30,
      hardwareAcceleration: 'prefer-software',
      onProgress: (p) => {
        const progressPct = Math.floor((p.videoFrames / 900) * 100); // ~30fps * 30s
        if (progressPct > lastProgress && progressPct % 10 === 0) {
          lastProgress = progressPct;
          process.stdout.write(`\r   Progress: ${progressPct}% (${p.videoFrames} frames)`);
        }
      },
    });

    const elapsed = Date.now() - startTime;
    const fps = result.videoFrames / (elapsed / 1000);

    console.log(`\r   ✅ Completed!                                    `);
    console.log(`   Video frames: ${result.videoFrames}`);
    console.log(`   Audio frames: ${result.audioFrames}`);
    console.log(`   Output size: ${formatBytes(result.outputSize)}`);
    console.log(`   Time: ${formatDuration(elapsed)}`);
    console.log(`   Speed: ${fps.toFixed(1)} fps`);
    console.log(`   Realtime ratio: ${(fps / 30).toFixed(2)}x`);

    // Verify output
    const outputInfo = await getMediaInfo(OUTPUT_SOFTWARE);
    console.log(`   Output codec: ${outputInfo.video?.codec}`);
    console.log(`   Output resolution: ${outputInfo.video?.width}x${outputInfo.video?.height}`);
    console.log();

    await cleanup(OUTPUT_SOFTWARE);
  } catch (err) {
    console.error('\n   ❌ Software transcoding failed:', err);
    await cleanup(OUTPUT_SOFTWARE);
    console.log();
  }

  // Test 2: Hardware-accelerated transcoding
  console.log('🚀 Test 2: Hardware-Accelerated Transcoding (AVC → AVC)');
  console.log('─'.repeat(50));
  try {
    let lastProgress = 0;
    const startTime = Date.now();

    const result = await transcode(INPUT_FILE, OUTPUT_HARDWARE, {
      videoCodec: 'h264',
      videoBitrate: 4_000_000, // 4 Mbps for 1080p
      audioCodec: 'aac',
      audioBitrate: 128_000,
      gopSize: 30,
      hardwareAcceleration: 'prefer-hardware',
      onProgress: (p) => {
        const progressPct = Math.floor((p.videoFrames / 900) * 100);
        if (progressPct > lastProgress && progressPct % 10 === 0) {
          lastProgress = progressPct;
          process.stdout.write(`\r   Progress: ${progressPct}% (${p.videoFrames} frames)`);
        }
      },
    });

    const elapsed = Date.now() - startTime;
    const fps = result.videoFrames / (elapsed / 1000);

    console.log(`\r   ✅ Completed!                                    `);
    console.log(`   Video frames: ${result.videoFrames}`);
    console.log(`   Audio frames: ${result.audioFrames}`);
    console.log(`   Output size: ${formatBytes(result.outputSize)}`);
    console.log(`   Time: ${formatDuration(elapsed)}`);
    console.log(`   Speed: ${fps.toFixed(1)} fps`);
    console.log(`   Realtime ratio: ${(fps / 30).toFixed(2)}x`);

    // Verify output
    const outputInfo = await getMediaInfo(OUTPUT_HARDWARE);
    console.log(`   Output codec: ${outputInfo.video?.codec}`);
    console.log(`   Output resolution: ${outputInfo.video?.width}x${outputInfo.video?.height}`);
    console.log();

    await cleanup(OUTPUT_HARDWARE);
  } catch (err) {
    console.error('\n   ❌ Hardware transcoding failed:', err);
    console.log('   (This is expected if no hardware acceleration is available)');
    await cleanup(OUTPUT_HARDWARE);
    console.log();
  }

  // Test 3: Different bitrate comparison
  console.log('📊 Test 3: Bitrate Comparison (Software)');
  console.log('─'.repeat(50));

  const bitrates = [
    { name: 'Low (2 Mbps)', bitrate: 2_000_000 },
    { name: 'Medium (4 Mbps)', bitrate: 4_000_000 },
    { name: 'High (8 Mbps)', bitrate: 8_000_000 },
  ];

  for (const { name, bitrate } of bitrates) {
    const outputFile = `output_1080p_${bitrate}.mp4`;
    try {
      const startTime = Date.now();

      const result = await transcode(INPUT_FILE, outputFile, {
        videoCodec: 'h264',
        videoBitrate: bitrate,
        audioCodec: 'copy', // Copy audio to speed up test
        gopSize: 30,
        hardwareAcceleration: 'prefer-software',
      });

      const elapsed = Date.now() - startTime;
      const fps = result.videoFrames / (elapsed / 1000);

      console.log(`   ${name}:`);
      console.log(`     Size: ${formatBytes(result.outputSize)} | Time: ${formatDuration(elapsed)} | ${fps.toFixed(1)} fps`);

      await cleanup(outputFile);
    } catch (err) {
      console.error(`   ${name}: Failed - ${err}`);
      await cleanup(outputFile);
    }
  }

  console.log();
  console.log('═'.repeat(60));
  console.log('Demo Complete!');
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});

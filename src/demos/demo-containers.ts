/**
 * Demo: Container module functionality
 *
 * Tests the containers module for demuxing, remuxing, and transcoding.
 */

import { Demuxer, StreamCopier, getMediaInfo, transcode, remux } from '../containers/index.js';
import { unlink, stat } from 'fs/promises';
import { existsSync } from 'fs';

const INPUT_FILE = 'media/Big_Buck_Bunny_360_10s_1MB.mp4';

async function cleanup(file: string) {
  if (existsSync(file)) {
    await unlink(file);
  }
}

async function main() {
  console.log('=== Container Module Demo ===\n');

  // Test 1: Get media info
  console.log('1. Getting media info...');
  try {
    const info = await getMediaInfo(INPUT_FILE);
    console.log('   Format:', info.format);
    console.log('   Duration:', info.duration, 'seconds');
    if (info.video) {
      console.log('   Video:', info.video.codec, `${info.video.width}x${info.video.height}`);
    }
    if (info.audio) {
      console.log('   Audio:', info.audio.codec, `${info.audio.sampleRate}Hz`, `${info.audio.channels}ch`);
    }
    console.log('   OK\n');
  } catch (err) {
    console.error('   FAILED:', err);
  }

  // Test 2: Demux video chunks
  console.log('2. Demuxing video chunks...');
  try {
    const demuxer = new Demuxer({ path: INPUT_FILE });
    await demuxer.open();

    let videoChunkCount = 0;
    let keyFrameCount = 0;
    let totalBytes = 0;

    for await (const chunk of demuxer.videoChunks()) {
      videoChunkCount++;
      totalBytes += chunk.byteLength;
      if (chunk.type === 'key') keyFrameCount++;
    }

    await demuxer.close();

    console.log(`   Total: ${videoChunkCount} chunks (${keyFrameCount} keyframes), ${totalBytes} bytes`);
    console.log('   OK\n');
  } catch (err) {
    console.error('   FAILED:', err);
  }

  // Test 3: Remux (stream copy)
  console.log('3. Remuxing (stream copy)...');
  const remuxOutput = 'test-remux-output.mp4';
  try {
    await remux(INPUT_FILE, remuxOutput);

    const inputInfo = await getMediaInfo(INPUT_FILE);
    const outputInfo = await getMediaInfo(remuxOutput);

    console.log('   Input:', inputInfo.format, inputInfo.video?.codec);
    console.log('   Output:', outputInfo.format, outputInfo.video?.codec);
    console.log('   Duration matches:', Math.abs(inputInfo.duration - outputInfo.duration) < 0.1);
    console.log('   OK\n');

    await cleanup(remuxOutput);
  } catch (err) {
    console.error('   FAILED:', err);
    await cleanup(remuxOutput);
  }

  // Test 4: Transcode with same codec (re-encode)
  console.log('4. Transcoding (re-encode H.264)...');
  const transcodeOutput = 'test-transcode-output.mp4';
  try {
    const result = await transcode(INPUT_FILE, transcodeOutput, {
      videoCodec: 'h264',
      videoBitrate: 500_000,
      onProgress: (p) => {
        if (p.videoFrames % 100 === 0) {
          process.stdout.write(`\r   Processing: ${p.videoFrames} frames...`);
        }
      },
    });

    console.log(`\r   Transcoded: ${result.videoFrames} frames`);
    console.log('   Output size:', result.outputSize, 'bytes');

    // Verify output
    const outputInfo = await getMediaInfo(transcodeOutput);
    console.log('   Output video:', outputInfo.video?.width, 'x', outputInfo.video?.height);
    console.log('   OK\n');

    await cleanup(transcodeOutput);
  } catch (err) {
    console.error('   FAILED:', err);
    await cleanup(transcodeOutput);
  }

  // Test 5: Transcode to different codec (VP9)
  console.log('5. Transcoding to VP9 WebM...');
  const vp9Output = 'test-vp9-output.webm';
  try {
    const result = await transcode(INPUT_FILE, vp9Output, {
      videoCodec: 'vp9',
      videoBitrate: 500_000,
      format: 'webm',
    });

    console.log(`   Transcoded: ${result.videoFrames} frames`);
    console.log('   Output size:', result.outputSize, 'bytes');

    const outputInfo = await getMediaInfo(vp9Output);
    console.log('   Output format:', outputInfo.format);
    console.log('   OK\n');

    await cleanup(vp9Output);
  } catch (err) {
    console.error('   FAILED:', err);
    await cleanup(vp9Output);
  }

  // Test 6: Hardware-accelerated transcoding
  console.log('6. Hardware-accelerated transcoding (H.264)...');
  const hwOutput = 'test-hw-output.mp4';
  try {
    const startTime = Date.now();
    const result = await transcode(INPUT_FILE, hwOutput, {
      videoCodec: 'h264',
      videoBitrate: 1_000_000,
      hardwareAcceleration: 'prefer-hardware',
    });
    const elapsed = Date.now() - startTime;

    console.log(`   Transcoded: ${result.videoFrames} frames in ${elapsed}ms`);
    console.log('   Output size:', result.outputSize, 'bytes');
    console.log('   OK\n');

    await cleanup(hwOutput);
  } catch (err) {
    console.error('   FAILED:', err);
    await cleanup(hwOutput);
  }

  console.log('=== Demo Complete ===');
}

main().catch(console.error);

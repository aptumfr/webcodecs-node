/**
 * Demo: Test WebCodecs implementation with real sample files
 *
 * Tests VideoDecoder and AudioDecoder with downloaded sample files:
 * - Video: H.264, VP8, VP9
 * - Audio: Opus, MP3, AAC
 */

import * as fs from 'fs';
import * as path from 'path';
import { VideoDecoder } from '../decoders/VideoDecoder.js';
import { AudioDecoder } from '../decoders/AudioDecoder.js';
import type { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import type { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import { VideoFrame } from '../core/VideoFrame.js';
import { AudioData } from '../core/AudioData.js';
import { Demuxer } from '../containers/index.js';

const SAMPLES_DIR = '/tmp/webcodecs-test-samples';

interface VideoSample {
  file: string;
  codec: string;
  width: number;
  height: number;
}

interface AudioSample {
  file: string;
  codec: string;
  sampleRate: number;
  channels: number;
}

const VIDEO_SAMPLES: VideoSample[] = [
  { file: 'bbb_h264_360p.mp4', codec: 'avc1.42001E', width: 640, height: 360 },
  { file: 'bbb_vp8_360p.webm', codec: 'vp8', width: 640, height: 360 },
  { file: 'bbb_vp9_360p.webm', codec: 'vp09.00.10.08', width: 640, height: 360 },
];

const AUDIO_SAMPLES: AudioSample[] = [
  { file: 'sample_opus.opus', codec: 'opus', sampleRate: 48000, channels: 1 },
  { file: 'sample_mp3.mp3', codec: 'mp3', sampleRate: 44100, channels: 1 },
  { file: 'sample_aac.aac', codec: 'mp4a.40.2', sampleRate: 44100, channels: 1 },
];

/**
 * Test VideoDecoder with a sample file
 */
async function testVideoDecoder(sample: VideoSample): Promise<void> {
  const filePath = path.join(SAMPLES_DIR, sample.file);

  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ File not found: ${sample.file}`);
    return;
  }

  console.log(`  Testing ${sample.file} (${sample.codec})...`);

  try {
    const demuxer = new Demuxer({ path: filePath });
    await demuxer.open();

    const videoConfig = demuxer.videoConfig;
    if (!videoConfig) {
      await demuxer.close();
      console.log(`    ⚠ No video stream found`);
      return;
    }

    const chunks: EncodedVideoChunk[] = [];
    try {
      for await (const chunk of demuxer.videoChunks()) {
        chunks.push(chunk);
        if (chunks.length >= 30) break;
      }
    } finally {
      await demuxer.close();
    }

    console.log(`    Extracted ${chunks.length} chunks (${videoConfig.codec})`);

    if (chunks.length === 0) {
      console.log(`    ⚠ No chunks extracted`);
      return;
    }

    // Create decoder
    const frames: VideoFrame[] = [];
    const errors: Error[] = [];

    const decoder = new VideoDecoder({
      output: (frame) => {
        frames.push(frame);
      },
      error: (err) => {
        if (!errors.find(e => e.message === err.message)) {
          errors.push(err);
        }
      },
    });

    decoder.configure({
      codec: videoConfig.codec,
      codedWidth: videoConfig.codedWidth,
      codedHeight: videoConfig.codedHeight,
      description: videoConfig.description,
      outputFormat: 'I420',
    });

    for (const chunk of chunks) {
      try {
        decoder.decode(chunk);
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
        break;
      }
    }

    // Flush and wait
    try {
      await decoder.flush(60000);
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
    decoder.close();

    if (errors.length > 0) {
      console.log(`    ✗ Errors: ${errors.map(e => e.message).join(', ')}`);
    } else if (frames.length > 0) {
      console.log(`    ✓ Decoded ${frames.length} frames`);
      console.log(`      Format: ${frames[0].format}, Size: ${frames[0].codedWidth}x${frames[0].codedHeight}`);
    } else {
      console.log(`    ⚠ No frames decoded`);
    }

    // Clean up frames
    frames.forEach(f => f.close());

  } catch (err) {
    console.log(`    ✗ Error: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Test AudioDecoder with a sample file
 */
async function testAudioDecoder(sample: AudioSample): Promise<void> {
  const filePath = path.join(SAMPLES_DIR, sample.file);

  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ File not found: ${sample.file}`);
    return;
  }

  console.log(`  Testing ${sample.file} (${sample.codec})...`);

  try {
    const demuxer = new Demuxer({ path: filePath });
    await demuxer.open();

    const audioConfig = demuxer.audioConfig;
    if (!audioConfig) {
      await demuxer.close();
      console.log(`    ⚠ No audio stream found`);
      return;
    }

    const chunks: EncodedAudioChunk[] = [];
    try {
      for await (const chunk of demuxer.audioChunks()) {
        chunks.push(chunk);
        if (chunks.length >= 100) break;
      }
    } finally {
      await demuxer.close();
    }

    console.log(`    Extracted ${chunks.length} frames (${audioConfig.codec})`);

    if (chunks.length === 0) {
      console.log(`    ⚠ No frames extracted`);
      return;
    }

    // Create decoder
    const audioSamples: AudioData[] = [];
    const errors: Error[] = [];

    const decoder = new AudioDecoder({
      output: (data) => {
        audioSamples.push(data);
      },
      error: (err) => {
        errors.push(err);
      },
    });

    decoder.configure({
      codec: audioConfig.codec,
      sampleRate: audioConfig.sampleRate,
      numberOfChannels: audioConfig.numberOfChannels,
      description: audioConfig.description,
    });

    for (const chunk of chunks) {
      try {
        decoder.decode(chunk);
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
        break;
      }
    }

    // Flush and wait
    try {
      await decoder.flush();
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
    decoder.close();

    if (errors.length > 0) {
      console.log(`    ✗ Error: ${errors[0].message}`);
    } else if (audioSamples.length > 0) {
      const totalSamples = audioSamples.reduce((sum, d) => sum + d.numberOfFrames, 0);
      console.log(`    ✓ Decoded ${audioSamples.length} audio data objects`);
      console.log(`      Total samples: ${totalSamples}, Format: ${audioSamples[0].format}`);
      console.log(`      Sample rate: ${audioSamples[0].sampleRate}Hz, Channels: ${audioSamples[0].numberOfChannels}`);
    } else {
      console.log(`    ⚠ No audio data decoded`);
    }

    // Clean up
    audioSamples.forEach(d => d.close());

  } catch (err) {
    console.log(`    ✗ Error: ${err instanceof Error ? err.message : err}`);
  }
}

async function main(): Promise<void> {
  console.log('WebCodecs Sample File Tests');
  console.log('===========================\n');

  // Check if samples directory exists
  if (!fs.existsSync(SAMPLES_DIR)) {
    console.log(`Error: Samples directory not found: ${SAMPLES_DIR}`);
    console.log('Please download sample files first.');
    process.exit(1);
  }

  // List available files
  const files = fs.readdirSync(SAMPLES_DIR);
  console.log(`Found ${files.length} files in ${SAMPLES_DIR}:`);
  files.forEach(f => console.log(`  - ${f}`));
  console.log('');

  // Test video samples
  console.log('Video Decoder Tests:');
  console.log('--------------------');
  for (const sample of VIDEO_SAMPLES) {
    await testVideoDecoder(sample);
  }
  console.log('');

  // Test audio samples
  console.log('Audio Decoder Tests:');
  console.log('--------------------');
  for (const sample of AUDIO_SAMPLES) {
    await testAudioDecoder(sample);
  }

  console.log('\nDone!');
}

main().catch(console.error);

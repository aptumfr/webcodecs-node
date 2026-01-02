/**
 * Demo: composite four copies of a decoded video frame into a single output video.
 * Runs entirely in Node (no WebGPU), uses the WebCodecs-compatible VideoDecoder/Encoder.
 */

import * as fs from 'fs';
import * as path from 'path';

import { VideoDecoder } from '../decoders/VideoDecoder.js';
import { VideoEncoder } from '../encoders/VideoEncoder.js';
import type { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import { VideoFrame } from '../core/VideoFrame.js';
import { Demuxer, muxChunks } from '../containers/index.js';

const MEDIA_FILE = path.resolve('media/Big_Buck_Bunny_360_10s_1MB.mp4');
const OUTPUT_DIR = path.resolve('media', 'four-corners-demo');
const OUTPUT_VIDEO = path.join(OUTPUT_DIR, 'four-corners.mp4');
const FRAME_RATE = 30;
const FRAME_DURATION_US = Math.round(1_000_000 / FRAME_RATE);
const FRAMES_TO_RENDER = 90;

function compositeFourUp(src: VideoFrame, outWidth: number, outHeight: number): Uint8Array {
  const srcData = src._buffer;
  const srcStride = src.codedWidth * 4;
  const dst = new Uint8Array(outWidth * outHeight * 4);
  const quadWidth = outWidth / 2;
  const quadHeight = outHeight / 2;

  for (let y = 0; y < src.codedHeight; y++) {
    const srcRowStart = y * srcStride;
    const row = srcData.subarray(srcRowStart, srcRowStart + srcStride);

    // Top-left
    let dstOffset = y * outWidth * 4;
    dst.set(row, dstOffset);
    // Top-right
    dstOffset = y * outWidth * 4 + quadWidth * 4;
    dst.set(row, dstOffset);
    // Bottom-left
    dstOffset = (y + quadHeight) * outWidth * 4;
    dst.set(row, dstOffset);
    // Bottom-right
    dstOffset = (y + quadHeight) * outWidth * 4 + quadWidth * 4;
    dst.set(row, dstOffset);
  }

  return dst;
}

async function main() {
  if (!fs.existsSync(MEDIA_FILE)) {
    console.error('Media file not found:', MEDIA_FILE);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const decodedFrames: VideoFrame[] = [];
  const decoder = new VideoDecoder({
    output: (frame) => {
      if (decodedFrames.length < FRAMES_TO_RENDER) {
        decodedFrames.push(frame);
      } else {
        frame.close();
      }
    },
    error: (err) => console.error('Decoder error:', err),
  });

  const demuxer = new Demuxer({ path: MEDIA_FILE });
  await demuxer.open();

  const videoConfig = demuxer.videoConfig;
  if (!videoConfig) {
    await demuxer.close();
    console.error('No video stream found in input');
    process.exit(1);
  }

  decoder.configure({
    codec: videoConfig.codec,
    codedWidth: videoConfig.codedWidth,
    codedHeight: videoConfig.codedHeight,
    description: videoConfig.description,
    outputFormat: 'RGBA',
    hardwareAcceleration: 'prefer-hardware',
  });

  try {
    for await (const chunk of demuxer.videoChunks()) {
      if (decodedFrames.length >= FRAMES_TO_RENDER) break;

      while (decoder.decodeQueueSize >= 50) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      decoder.decode(chunk);
    }
  } finally {
    await demuxer.close();
  }

  await decoder.flush();
  decoder.close();

  if (decodedFrames.length === 0) {
    console.error('No frames decoded');
    process.exit(1);
  }

  const srcW = decodedFrames[0].codedWidth;
  const srcH = decodedFrames[0].codedHeight;
  const outWidth = srcW * 2;
  const outHeight = srcH * 2;

  const encodedChunks: EncodedVideoChunk[] = [];
  let videoDescription: Uint8Array | undefined;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      encodedChunks.push(chunk);
      if (!videoDescription && metadata?.decoderConfig?.description) {
        const desc = metadata.decoderConfig.description;
        videoDescription = desc instanceof Uint8Array ? desc : new Uint8Array(desc as ArrayBuffer);
      }
    },
    error: (err) => console.error('Encoder error:', err),
  });

  encoder.configure({
    codec: 'avc1.64001E',
    width: outWidth,
    height: outHeight,
    framerate: FRAME_RATE,
    bitrate: 4_000_000,
    latencyMode: 'realtime',
    hardwareAcceleration: 'prefer-hardware',
    format: 'mp4',
  });

  const framesToEncode = Math.min(decodedFrames.length, FRAMES_TO_RENDER);
  for (let i = 0; i < framesToEncode; i++) {
    while (encoder.encodeQueueSize >= 50) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const src = decodedFrames[i];
    const composite = compositeFourUp(src, outWidth, outHeight);

    const frame = new VideoFrame(composite, {
      format: 'RGBA',
      codedWidth: outWidth,
      codedHeight: outHeight,
      timestamp: i * FRAME_DURATION_US,
    });

    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
    src.close();
  }

  for (let i = framesToEncode; i < decodedFrames.length; i++) {
    decodedFrames[i].close();
  }

  await encoder.flush();
  encoder.close();

  await muxChunks({
    path: OUTPUT_VIDEO,
    video: {
      config: {
        codec: 'avc1.64001E',
        codedWidth: outWidth,
        codedHeight: outHeight,
        framerate: FRAME_RATE,
        bitrate: 4_000_000,
        description: videoDescription,
      },
      chunks: encodedChunks,
    },
    forceBackend: 'node-av',
  });

  console.log(`Four-corners demo rendered ${encodedChunks.length} chunks to ${OUTPUT_VIDEO}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

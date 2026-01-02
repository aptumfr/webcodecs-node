/**
 * Demo: Direct encoding/decoding pipeline
 *
 * This demo shows a more practical use case: piping frames through
 * an encode/decode cycle without storing intermediate chunks.
 */

import { VideoDecoder } from '../decoders/VideoDecoder.js';
import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { VideoFrame } from '../core/VideoFrame.js';

async function main() {
  console.log('WebCodecs Pipeline Demo');
  console.log('=======================\n');

  const width = 320;
  const height = 240;
  const frameCount = 30;
  const framerate = 30;
  const frameSize = width * height * 4; // RGBA
  const frameDuration = Math.round(1_000_000 / framerate);

  let decodedFrameCount = 0;

  const decoder = new VideoDecoder({
    output: (frame) => {
      decodedFrameCount++;
      console.log(`Decoded frame ${decodedFrameCount}: ${frame.codedWidth}x${frame.codedHeight}, timestamp=${frame.timestamp}µs`);
      frame.close();
    },
    error: (err) => console.error('Decoder error:', err),
  });

  decoder.configure({
    codec: 'avc1.42001E',
    codedWidth: width,
    codedHeight: height,
    outputFormat: 'RGBA',
  });

  const encoder = new VideoEncoder({
    output: (chunk) => {
      try {
        decoder.decode(chunk);
      } catch (err) {
        console.error('Decoder decode error:', err);
      }
    },
    error: (err) => console.error('Encoder error:', err),
  });

  encoder.configure({
    codec: 'avc1.42001E',
    width,
    height,
    framerate,
    bitrate: 1_000_000,
    latencyMode: 'realtime',
    format: 'annexb',
  });

  console.log(`Encoding ${frameCount} frames...`);

  for (let i = 0; i < frameCount; i++) {
    while (encoder.encodeQueueSize >= 50) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const frameData = new Uint8Array(frameSize);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        frameData[idx] = (x + i * 10) % 256;     // R
        frameData[idx + 1] = (y + i * 5) % 256;  // G
        frameData[idx + 2] = (i * 8) % 256;      // B
        frameData[idx + 3] = 255;                // A
      }
    }

    const frame = new VideoFrame(frameData, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: i * frameDuration,
    });

    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }

  await encoder.flush();
  encoder.close();

  await decoder.flush();
  decoder.close();

  console.log(`\n=== Results ===`);
  console.log(`Input frames:  ${frameCount}`);
  console.log(`Output frames: ${decodedFrameCount}`);
  console.log(`Match: ${frameCount === decodedFrameCount ? 'YES ✓' : 'NO ✗'}`);
}

main().catch(console.error);

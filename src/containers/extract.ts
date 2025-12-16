/**
 * Frame extraction utilities
 *
 * Provides functions to extract decoded frames from container files.
 */

import { Demuxer } from './Demuxer.js';
import { VideoDecoder } from '../decoders/VideoDecoder.js';
import { VideoFrame } from '../core/VideoFrame.js';

/**
 * Extract video frames from a container file as VideoFrame objects
 *
 * This function uses our WebCodecs VideoDecoder to decode frames,
 * providing WebCodecs-compatible VideoFrame objects.
 *
 * @example
 * ```typescript
 * import { extractVideoFrames } from 'webcodecs-node/containers';
 *
 * for await (const frame of extractVideoFrames('input.mp4')) {
 *   console.log(`Frame: ${frame.timestamp}us, ${frame.codedWidth}x${frame.codedHeight}`);
 *   // Process frame...
 *   frame.close();
 * }
 * ```
 */
export async function* extractVideoFrames(inputPath: string): AsyncGenerator<VideoFrame> {
  const demuxer = new Demuxer({ path: inputPath });
  await demuxer.open();

  const videoConfig = demuxer.videoConfig;
  if (!videoConfig) {
    await demuxer.close();
    return;
  }

  // Collect frames as they're decoded
  const frames: VideoFrame[] = [];

  const decoder = new VideoDecoder({
    output: (frame: VideoFrame) => {
      frames.push(frame);
    },
    error: (err) => console.error('Decode error:', err),
  });

  decoder.configure({
    codec: videoConfig.codec,
    codedWidth: videoConfig.codedWidth,
    codedHeight: videoConfig.codedHeight,
    description: videoConfig.description,
  });

  // Decode all video chunks
  for await (const chunk of demuxer.videoChunks()) {
    decoder.decode(chunk);

    // Yield any decoded frames
    while (frames.length > 0) {
      yield frames.shift()!;
    }
  }

  // Flush decoder to get remaining frames
  await decoder.flush();
  decoder.close();
  await demuxer.close();

  // Yield any remaining frames
  for (const frame of frames) {
    yield frame;
  }
}

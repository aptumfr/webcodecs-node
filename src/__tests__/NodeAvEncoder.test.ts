import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { VideoFrame } from '../core/VideoFrame.js';
import type { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';

/**
 * Helper function to create test frames
 */
function createTestFrame(width: number, height: number, frameIndex: number): VideoFrame {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 50 + frameIndex * 10;     // R
    data[i + 1] = 100;                   // G
    data[i + 2] = 150;                   // B
    data[i + 3] = 255;                   // A
  }

  return new VideoFrame(data, {
    format: 'RGBA',
    codedWidth: width,
    codedHeight: height,
    timestamp: frameIndex * 33333,
  });
}

/**
 * Helper function to encode test frames and return chunks
 */
async function encodeTestFrames(
  codec: string,
  width: number,
  height: number,
  numFrames: number,
  backend: 'node-av' | 'ffmpeg' = 'node-av'
): Promise<{ chunks: EncodedVideoChunk[]; error: Error | null }> {
  const chunks: EncodedVideoChunk[] = [];
  let err: Error | null = null;

  const encoder = new VideoEncoder({
    output: (chunk) => chunks.push(chunk),
    error: (e) => { err = e; },
  });

  encoder.configure({
    codec,
    width,
    height,
    framerate: 30,
    bitrate: 500_000,
    backend,
  });

  for (let f = 0; f < numFrames; f++) {
    const frame = createTestFrame(width, height, f);
    encoder.encode(frame, { keyFrame: f === 0 });
    frame.close();
  }

  await encoder.flush();
  encoder.close();

  return { chunks, error: err };
}

describe('NodeAV VideoEncoder backend', () => {
  const width = 64;
  const height = 64;
  const numFrames = 3;

  describe('H.264 (AVC) encoding', () => {
    it('encodes RGBA input via node-av backend', async () => {
      const { chunks, error } = await encodeTestFrames('avc1.42001E', width, height, numFrames);

      if (error) {
        throw error;
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('key');
    }, 20000);

    it('encodes YUV420P input via node-av backend', async () => {
      const chunks: EncodedVideoChunk[] = [];
      let err: Error | null = null;

      const encoder = new VideoEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (e) => { err = e; },
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width,
        height,
        framerate: 30,
        bitrate: 500_000,
        backend: 'node-av',
      });

      // Create I420 frames
      const ySize = width * height;
      const uvSize = (width / 2) * (height / 2);
      const frameSize = ySize + 2 * uvSize;

      for (let f = 0; f < numFrames; f++) {
        const data = new Uint8Array(frameSize);
        // Fill Y plane with varying luminance
        for (let i = 0; i < ySize; i++) {
          data[i] = 128 + f * 10;
        }
        // Fill U and V planes with neutral values
        for (let i = ySize; i < frameSize; i++) {
          data[i] = 128;
        }

        const frame = new VideoFrame(data, {
          format: 'I420',
          codedWidth: width,
          codedHeight: height,
          timestamp: f * 33333,
        });

        encoder.encode(frame, { keyFrame: f === 0 });
        frame.close();
      }

      await encoder.flush();
      encoder.close();

      if (err) {
        throw err;
      }

      expect(chunks.length).toBeGreaterThan(0);
    }, 20000);
  });

  describe('H.265 (HEVC) encoding', () => {
    it('encodes RGBA input via node-av backend', async () => {
      const { chunks, error } = await encodeTestFrames('hev1.1.6.L93.B0', width, height, numFrames);

      if (error) {
        throw error;
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('key');
    }, 30000);
  });

  describe('VP8 encoding', () => {
    it('encodes RGBA input via node-av backend', async () => {
      const { chunks, error } = await encodeTestFrames('vp8', width, height, numFrames);

      if (error) {
        throw error;
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('key');
    }, 20000);
  });

  describe('VP9 encoding', () => {
    it('encodes RGBA input via node-av backend', async () => {
      const { chunks, error } = await encodeTestFrames('vp09.00.10.08', width, height, numFrames);

      if (error) {
        throw error;
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('key');
    }, 30000);

    it('encodes with vp9 codec string', async () => {
      const { chunks, error } = await encodeTestFrames('vp9', width, height, numFrames);

      if (error) {
        throw error;
      }

      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('AV1 encoding', () => {
    it('encodes RGBA input via node-av backend', async () => {
      const { chunks, error } = await encodeTestFrames('av01.0.01M.08', width, height, numFrames);

      if (error) {
        throw error;
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('key');
    }, 60000); // AV1 encoding can be slow

    it('encodes with av1 codec string', async () => {
      const { chunks, error } = await encodeTestFrames('av1', width, height, numFrames);

      if (error) {
        throw error;
      }

      expect(chunks.length).toBeGreaterThan(0);
    }, 60000);
  });

  describe('Error handling', () => {
    it('handles invalid codec gracefully', async () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() => {
        encoder.configure({
          codec: 'invalid-codec',
          width: 64,
          height: 64,
          backend: 'node-av',
        });
      }).toThrow();

      encoder.close();
    });
  });
});

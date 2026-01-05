/**
 * Tests for VideoEncoder class
 */
import { jest } from '@jest/globals';
import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { VideoFrame } from '../core/VideoFrame.js';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';

describe('VideoEncoder', () => {
  describe('isConfigSupported', () => {
    it('should support H.264', async () => {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'avc1.42001E',
        width: 640,
        height: 480,
      });

      expect(support.supported).toBe(true);
    });

    it('should support VP8', async () => {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'vp8',
        width: 640,
        height: 480,
      });

      expect(support.supported).toBe(true);
    });

    it('should support VP9', async () => {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'vp09.00.10.08',
        width: 1920,
        height: 1080,
      });

      expect(support.supported).toBe(true);
    });

    // Capability checks for alpha support
    it('should not support alpha:keep with H.264', async () => {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'avc1.42001E',
        width: 640,
        height: 480,
        alpha: 'keep',
      });

      expect(support.supported).toBe(false);
    });

    it('should support alpha:keep with VP9 software', async () => {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'vp09.00.10.08',
        width: 640,
        height: 480,
        alpha: 'keep',
        hardwareAcceleration: 'prefer-software',
      });

      expect(support.supported).toBe(true);
    });

    it('should not support alpha:keep with VP9 hardware', async () => {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'vp09.00.10.08',
        width: 640,
        height: 480,
        alpha: 'keep',
        hardwareAcceleration: 'prefer-hardware',
      });

      expect(support.supported).toBe(false);
    });

    it('should not support alpha:keep with AV1', async () => {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'av01.0.04M.08',
        width: 640,
        height: 480,
        alpha: 'keep',
      });

      expect(support.supported).toBe(false);
    });

    // Capability checks for bitrateMode
    it('should not support quantizer bitrateMode with VP8', async () => {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'vp8',
        width: 640,
        height: 480,
        bitrateMode: 'quantizer',
      });

      expect(support.supported).toBe(false);
    });

    it('should support quantizer bitrateMode with H.264', async () => {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'avc1.42001E',
        width: 640,
        height: 480,
        bitrateMode: 'quantizer',
      });

      expect(support.supported).toBe(true);
    });
  });

  describe('constructor', () => {
    it('should create encoder with callbacks', () => {
      const output = jest.fn();
      const error = jest.fn();

      const encoder = new VideoEncoder({ output, error });

      expect(encoder.state).toBe('unconfigured');
      encoder.close();
    });

    it('should throw without output callback', () => {
      expect(() => new VideoEncoder({ output: null as any, error: () => {} })).toThrow();
    });
  });

  describe('configure', () => {
    it('should configure encoder', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width: 320,
        height: 240,
        bitrate: 1_000_000,
      });

      expect(encoder.state).toBe('configured');
      encoder.close();
    });

    it('should throw on closed encoder', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.close();

      expect(() =>
        encoder.configure({
          codec: 'avc1.42001E',
          width: 320,
          height: 240,
        })
      ).toThrow();
    });
  });

  describe('encode and flush', () => {
    it('should encode frames', async () => {
      const chunks: EncodedVideoChunk[] = [];

      const encoder = new VideoEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (err) => console.error(err),
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width: 64,
        height: 64,
        bitrate: 500_000,
        framerate: 30,
      });

      // Create test frames
      for (let i = 0; i < 5; i++) {
        const data = new Uint8Array(64 * 64 * 4);
        const frame = new VideoFrame(data, {
          format: 'RGBA',
          codedWidth: 64,
          codedHeight: 64,
          timestamp: i * 33333,
        });

        encoder.encode(frame, { keyFrame: i === 0 });
        frame.close();
      }

      await encoder.flush();
      encoder.close();

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('key');
    }, 30000);
  });

  describe('reset', () => {
    it('should reset encoder to unconfigured state', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.configure({
        codec: 'vp8',
        width: 320,
        height: 240,
      });

      expect(encoder.state).toBe('configured');

      encoder.reset();

      expect(encoder.state).toBe('unconfigured');
      encoder.close();
    });
  });

  describe('close', () => {
    it('should close encoder', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.close();

      expect(encoder.state).toBe('closed');
    });
  });

  describe('reconfigure', () => {
    it('should allow calling configure multiple times', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      // First configuration
      encoder.configure({
        codec: 'vp8',
        width: 640,
        height: 480,
      });
      expect(encoder.state).toBe('configured');

      // Reconfigure with different settings
      encoder.configure({
        codec: 'vp9',
        width: 1280,
        height: 720,
      });
      expect(encoder.state).toBe('configured');

      encoder.close();
    });

    it('should throw when reconfiguring after close', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.close();

      expect(() => {
        encoder.configure({
          codec: 'vp8',
          width: 640,
          height: 480,
        });
      }).toThrow('Encoder is closed');
    });
  });

  describe('configure validation', () => {
    it('should throw TypeError for missing config', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() => encoder.configure(null as any)).toThrow(TypeError);
      expect(() => encoder.configure(undefined as any)).toThrow(TypeError);
      encoder.close();
    });

    it('should throw TypeError for invalid codec', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: '',
          width: 640,
          height: 480,
        })
      ).toThrow(TypeError);

      expect(() =>
        encoder.configure({
          codec: 123 as any,
          width: 640,
          height: 480,
        })
      ).toThrow(TypeError);

      encoder.close();
    });

    it('should throw TypeError for invalid width', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: 'vp8',
          width: 0,
          height: 480,
        })
      ).toThrow(TypeError);

      expect(() =>
        encoder.configure({
          codec: 'vp8',
          width: -640,
          height: 480,
        })
      ).toThrow(TypeError);

      expect(() =>
        encoder.configure({
          codec: 'vp8',
          width: 640.5,
          height: 480,
        })
      ).toThrow(TypeError);

      encoder.close();
    });

    it('should throw TypeError for invalid height', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: 'vp8',
          width: 640,
          height: 0,
        })
      ).toThrow(TypeError);

      expect(() =>
        encoder.configure({
          codec: 'vp8',
          width: 640,
          height: -480,
        })
      ).toThrow(TypeError);

      encoder.close();
    });

    it('should throw NotSupportedError for unsupported codec', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: 'unsupported-codec',
          width: 640,
          height: 480,
        })
      ).toThrow("Codec 'unsupported-codec' is not supported");

      encoder.close();
    });

    it('should throw TypeError for invalid optional fields', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: 'vp8',
          width: 640,
          height: 480,
          bitrate: -1000,
        })
      ).toThrow(TypeError);

      expect(() =>
        encoder.configure({
          codec: 'vp8',
          width: 640,
          height: 480,
          framerate: 0,
        })
      ).toThrow(TypeError);

      encoder.close();
    });
  });

  describe('bitrateMode', () => {
    it('should accept constant bitrateMode', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width: 320,
        height: 240,
        bitrate: 1_000_000,
        bitrateMode: 'constant',
      });

      expect(encoder.state).toBe('configured');
      encoder.close();
    });

    it('should accept variable bitrateMode', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width: 320,
        height: 240,
        bitrate: 1_000_000,
        bitrateMode: 'variable',
      });

      expect(encoder.state).toBe('configured');
      encoder.close();
    });

    it('should accept quantizer bitrateMode', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width: 320,
        height: 240,
        bitrateMode: 'quantizer',
      });

      expect(encoder.state).toBe('configured');
      encoder.close();
    });

    it('should encode with constant bitrateMode', async () => {
      const chunks: EncodedVideoChunk[] = [];

      const encoder = new VideoEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (err) => console.error(err),
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width: 64,
        height: 64,
        bitrate: 500_000,
        bitrateMode: 'constant',
        framerate: 30,
      });

      // Create test frame
      const data = new Uint8Array(64 * 64 * 4);
      data.fill(128);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
      });

      encoder.encode(frame);
      frame.close();

      await encoder.flush();
      encoder.close();

      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);

    it('should encode with quantizer bitrateMode', async () => {
      const chunks: EncodedVideoChunk[] = [];

      const encoder = new VideoEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (err) => console.error(err),
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width: 64,
        height: 64,
        bitrateMode: 'quantizer',
        framerate: 30,
      });

      // Create test frame
      const data = new Uint8Array(64 * 64 * 4);
      data.fill(128);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
      });

      encoder.encode(frame);
      frame.close();

      await encoder.flush();
      encoder.close();

      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('alpha channel handling', () => {
    it('should accept alpha: discard config', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width: 320,
        height: 240,
        alpha: 'discard',
      });

      expect(encoder.state).toBe('configured');
      encoder.close();
    });

    it('should accept alpha: keep config', () => {
      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.configure({
        codec: 'vp9',
        width: 320,
        height: 240,
        alpha: 'keep',
      });

      expect(encoder.state).toBe('configured');
      encoder.close();
    });

    it('should encode with alpha: discard (strips alpha from RGBA)', async () => {
      const chunks: EncodedVideoChunk[] = [];

      const encoder = new VideoEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (err) => console.error(err),
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width: 64,
        height: 64,
        alpha: 'discard',
        framerate: 30,
      });

      // Create RGBA frame with semi-transparent pixels
      const data = new Uint8Array(64 * 64 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255;     // R
        data[i + 1] = 0;   // G
        data[i + 2] = 0;   // B
        data[i + 3] = 128; // A (semi-transparent)
      }

      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
      });

      encoder.encode(frame);
      frame.close();

      await encoder.flush();
      encoder.close();

      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);

    it('should encode VP9 with alpha: keep', async () => {
      const chunks: EncodedVideoChunk[] = [];

      const encoder = new VideoEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (err) => console.error(err),
      });

      encoder.configure({
        codec: 'vp9',
        width: 64,
        height: 64,
        alpha: 'keep',
        framerate: 30,
      });

      // Create RGBA frame with alpha
      const data = new Uint8Array(64 * 64 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0;       // R
        data[i + 1] = 255; // G
        data[i + 2] = 0;   // B
        data[i + 3] = 200; // A
      }

      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
      });

      encoder.encode(frame);
      frame.close();

      await encoder.flush();
      encoder.close();

      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('AV1 timestamp quantization', () => {
    it('should preserve durations with 24fps timestamps', async () => {
      // This test validates the R3 fix: AV1 uses framerate-based timebase
      // which quantizes timestamps. The fix uses Math.trunc (not Math.round)
      // to match FFmpeg's BigInt integer division.
      // At 24fps, frame duration is ~41666.67μs
      // Without the fix, timestamps could mismatch by 1μs causing duration loss.

      const chunks: EncodedVideoChunk[] = [];

      const encoder = new VideoEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (err) => { throw err; },
      });

      encoder.configure({
        codec: 'av01.0.04M.08',
        width: 64,
        height: 64,
        framerate: 24,
        bitrate: 100000,
      });

      // Create frames at exactly 24fps intervals with explicit durations
      const frameDurationUs = Math.round(1_000_000 / 24); // ~41667μs
      const frameCount = 5;

      for (let i = 0; i < frameCount; i++) {
        const data = new Uint8Array(64 * 64 * 4);
        // Fill with varying colors to prevent encoding optimization
        data.fill((i * 50) % 256);

        const frame = new VideoFrame(data, {
          format: 'RGBA',
          codedWidth: 64,
          codedHeight: 64,
          timestamp: i * frameDurationUs,
          duration: frameDurationUs,
        });

        encoder.encode(frame, { keyFrame: i === 0 });
        frame.close();
      }

      await encoder.flush();
      encoder.close();

      // Verify we got all frames
      expect(chunks.length).toBe(frameCount);

      // Verify durations are preserved (should be close to frameDurationUs)
      // Allow small tolerance for encoder quantization
      for (const chunk of chunks) {
        expect(chunk.duration).toBeDefined();
        if (chunk.duration !== null) {
          // Duration should be within 100μs of expected (allows for quantization)
          expect(Math.abs(chunk.duration - frameDurationUs)).toBeLessThan(100);
        }
      }
    }, 60000);

    it('should handle non-uniform timestamps without losing frames', async () => {
      // Test variable frame rate (VFR) with AV1
      const chunks: EncodedVideoChunk[] = [];

      const encoder = new VideoEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (err) => { throw err; },
      });

      encoder.configure({
        codec: 'av01.0.04M.08',
        width: 64,
        height: 64,
        framerate: 30, // hint, but timestamps vary
        bitrate: 100000,
      });

      // Non-uniform timestamps (simulating VFR content)
      const timestamps = [0, 33333, 66667, 133333, 166667]; // varying gaps
      const durations = [33333, 33334, 66666, 33334, 33333];

      for (let i = 0; i < timestamps.length; i++) {
        const data = new Uint8Array(64 * 64 * 4);
        data.fill((i * 60) % 256);

        const frame = new VideoFrame(data, {
          format: 'RGBA',
          codedWidth: 64,
          codedHeight: 64,
          timestamp: timestamps[i],
          duration: durations[i],
        });

        encoder.encode(frame, { keyFrame: i === 0 });
        frame.close();
      }

      await encoder.flush();
      encoder.close();

      // All frames should be encoded
      expect(chunks.length).toBe(timestamps.length);

      // All chunks should have durations
      for (const chunk of chunks) {
        expect(chunk.duration).toBeDefined();
        expect(chunk.duration).toBeGreaterThan(0);
      }
    }, 60000);
  });

  describe('decoderConfig.colorSpace defaults', () => {
    it('should provide default BT.709 colorSpace in decoderConfig', async () => {
      const chunks: EncodedVideoChunk[] = [];
      let receivedMetadata: any = null;

      const encoder = new VideoEncoder({
        output: (chunk, metadata) => {
          chunks.push(chunk);
          if (metadata?.decoderConfig) {
            receivedMetadata = metadata;
          }
        },
        error: (e) => { throw e; },
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width: 64,
        height: 64,
        // Note: no colorSpace specified
      });

      const frame = new VideoFrame(new Uint8Array(64 * 64 * 4), {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
      });

      encoder.encode(frame, { keyFrame: true });
      frame.close();

      await encoder.flush();
      encoder.close();

      // Should have received metadata with colorSpace
      expect(receivedMetadata).not.toBeNull();
      expect(receivedMetadata.decoderConfig.colorSpace).toBeDefined();
      expect(receivedMetadata.decoderConfig.colorSpace.primaries).toBe('bt709');
      expect(receivedMetadata.decoderConfig.colorSpace.transfer).toBe('bt709');
      expect(receivedMetadata.decoderConfig.colorSpace.matrix).toBe('bt709');
    }, 30000);

    it('should use user-provided colorSpace in decoderConfig', async () => {
      let receivedMetadata: any = null;

      const encoder = new VideoEncoder({
        output: (_chunk, metadata) => {
          if (metadata?.decoderConfig) {
            receivedMetadata = metadata;
          }
        },
        error: (e) => { throw e; },
      });

      encoder.configure({
        codec: 'avc1.42001E',
        width: 64,
        height: 64,
        colorSpace: {
          primaries: 'bt2020',
          transfer: 'pq',
          matrix: 'bt2020-ncl',
        },
      });

      const frame = new VideoFrame(new Uint8Array(64 * 64 * 4), {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
      });

      encoder.encode(frame, { keyFrame: true });
      frame.close();

      await encoder.flush();
      encoder.close();

      expect(receivedMetadata).not.toBeNull();
      expect(receivedMetadata.decoderConfig.colorSpace.primaries).toBe('bt2020');
      expect(receivedMetadata.decoderConfig.colorSpace.transfer).toBe('pq');
      expect(receivedMetadata.decoderConfig.colorSpace.matrix).toBe('bt2020-ncl');
    }, 30000);
  });

  describe('AV1 codec-specific config', () => {
    it('should accept av1 config with forceScreenContentTools', async () => {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'av01.0.04M.08',
        width: 640,
        height: 480,
        av1: {
          forceScreenContentTools: true,
        },
      });

      // Config should be valid (actual encoding may vary by system)
      expect(support.config).toBeDefined();
      expect(support.config.av1?.forceScreenContentTools).toBe(true);
    });
  });

  describe('frame rescaling (N8)', () => {
    it('should rescale input frames to match config dimensions', async () => {
      const chunks: EncodedVideoChunk[] = [];

      const encoder = new VideoEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (err) => console.error(err),
      });

      // Configure encoder for 32x32 output
      encoder.configure({
        codec: 'vp8',
        width: 32,
        height: 32,
      });

      // Create 64x64 input frame (larger than output)
      const data = new Uint8Array(64 * 64 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
      });

      encoder.encode(frame, { keyFrame: true });
      frame.close();

      await encoder.flush();
      encoder.close();

      // Should produce encoded output (rescaling handled by backend)
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('key');
    }, 30000);

    it('should reject frames with inconsistent dimensions', async () => {
      let receivedError: Error | null = null;

      const encoder = new VideoEncoder({
        output: () => {},
        error: (err) => { receivedError = err; },
      });

      encoder.configure({
        codec: 'vp8',
        width: 64,
        height: 64,
      });

      // First frame is 64x64
      const data1 = new Uint8Array(64 * 64 * 4);
      const frame1 = new VideoFrame(data1, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
      });

      encoder.encode(frame1, { keyFrame: true });
      frame1.close();

      // Second frame is 32x32 (different dimensions)
      const data2 = new Uint8Array(32 * 32 * 4);
      const frame2 = new VideoFrame(data2, {
        format: 'RGBA',
        codedWidth: 32,
        codedHeight: 32,
        timestamp: 33333,
      });

      encoder.encode(frame2);
      frame2.close();

      // Error should have been raised for dimension mismatch
      expect(receivedError).not.toBeNull();
      expect(receivedError!.name).toBe('DataError');
      expect(receivedError!.message).toContain('dimension mismatch');

      encoder.close();
    });

    it('should allow upscaling from small to large dimensions', async () => {
      const chunks: EncodedVideoChunk[] = [];

      const encoder = new VideoEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (err) => console.error(err),
      });

      // Configure encoder for 64x64 output
      encoder.configure({
        codec: 'vp8',
        width: 64,
        height: 64,
      });

      // Create 32x32 input frame (smaller than output - will be upscaled)
      const data = new Uint8Array(32 * 32 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 32,
        codedHeight: 32,
        timestamp: 0,
      });

      encoder.encode(frame, { keyFrame: true });
      frame.close();

      await encoder.flush();
      encoder.close();

      // Should produce encoded output (upscaling handled by backend)
      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('orientation metadata (N2)', () => {
    it('should include rotation in decoderConfig when frame has non-zero rotation', async () => {
      let receivedMetadata: any = null;

      const encoder = new VideoEncoder({
        output: (_chunk, metadata) => {
          if (metadata?.decoderConfig) {
            receivedMetadata = metadata;
          }
        },
        error: () => {},
      });

      encoder.configure({
        codec: 'vp8',
        width: 64,
        height: 64,
      });

      // Create frame with rotation
      const data = new Uint8Array(64 * 64 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
        rotation: 90,
      });

      encoder.encode(frame, { keyFrame: true });
      frame.close();

      await encoder.flush();
      encoder.close();

      expect(receivedMetadata).not.toBeNull();
      expect(receivedMetadata.decoderConfig.rotation).toBe(90);
    }, 30000);

    it('should include flip in decoderConfig when frame has flip=true', async () => {
      let receivedMetadata: any = null;

      const encoder = new VideoEncoder({
        output: (_chunk, metadata) => {
          if (metadata?.decoderConfig) {
            receivedMetadata = metadata;
          }
        },
        error: () => {},
      });

      encoder.configure({
        codec: 'vp8',
        width: 64,
        height: 64,
      });

      // Create frame with flip
      const data = new Uint8Array(64 * 64 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
        flip: true,
      });

      encoder.encode(frame, { keyFrame: true });
      frame.close();

      await encoder.flush();
      encoder.close();

      expect(receivedMetadata).not.toBeNull();
      expect(receivedMetadata.decoderConfig.flip).toBe(true);
    }, 30000);

    it('should not include rotation/flip when frame has default orientation', async () => {
      let receivedMetadata: any = null;

      const encoder = new VideoEncoder({
        output: (_chunk, metadata) => {
          if (metadata?.decoderConfig) {
            receivedMetadata = metadata;
          }
        },
        error: () => {},
      });

      encoder.configure({
        codec: 'vp8',
        width: 64,
        height: 64,
      });

      // Create frame with default orientation
      const data = new Uint8Array(64 * 64 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
      });

      encoder.encode(frame, { keyFrame: true });
      frame.close();

      await encoder.flush();
      encoder.close();

      expect(receivedMetadata).not.toBeNull();
      expect(receivedMetadata.decoderConfig.rotation).toBeUndefined();
      expect(receivedMetadata.decoderConfig.flip).toBeUndefined();
    }, 30000);

    it('should call error callback when frames have inconsistent rotation', async () => {
      let receivedError: Error | null = null;

      const encoder = new VideoEncoder({
        output: () => {},
        error: (err) => { receivedError = err; },
      });

      encoder.configure({
        codec: 'vp8',
        width: 64,
        height: 64,
      });

      // First frame with rotation=0
      const data1 = new Uint8Array(64 * 64 * 4);
      const frame1 = new VideoFrame(data1, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
        rotation: 0,
      });

      encoder.encode(frame1, { keyFrame: true });
      frame1.close();

      // Second frame with different rotation
      const data2 = new Uint8Array(64 * 64 * 4);
      const frame2 = new VideoFrame(data2, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 33333,
        rotation: 90,
      });

      encoder.encode(frame2);
      frame2.close();

      // Error should have been raised
      expect(receivedError).not.toBeNull();
      expect(receivedError!.name).toBe('DataError');
      expect(receivedError!.message).toContain('orientation mismatch');

      encoder.close();
    });

    it('should call error callback when frames have inconsistent flip', async () => {
      let receivedError: Error | null = null;

      const encoder = new VideoEncoder({
        output: () => {},
        error: (err) => { receivedError = err; },
      });

      encoder.configure({
        codec: 'vp8',
        width: 64,
        height: 64,
      });

      // First frame with flip=false
      const data1 = new Uint8Array(64 * 64 * 4);
      const frame1 = new VideoFrame(data1, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 0,
        flip: false,
      });

      encoder.encode(frame1, { keyFrame: true });
      frame1.close();

      // Second frame with different flip
      const data2 = new Uint8Array(64 * 64 * 4);
      const frame2 = new VideoFrame(data2, {
        format: 'RGBA',
        codedWidth: 64,
        codedHeight: 64,
        timestamp: 33333,
        flip: true,
      });

      encoder.encode(frame2);
      frame2.close();

      // Error should have been raised
      expect(receivedError).not.toBeNull();
      expect(receivedError!.name).toBe('DataError');
      expect(receivedError!.message).toContain('orientation mismatch');

      encoder.close();
    });

    it('should allow consistent orientation across multiple frames', async () => {
      const chunks: EncodedVideoChunk[] = [];
      let errorOccurred = false;

      const encoder = new VideoEncoder({
        output: (chunk) => chunks.push(chunk),
        error: () => { errorOccurred = true; },
      });

      encoder.configure({
        codec: 'vp8',
        width: 64,
        height: 64,
      });

      // Encode multiple frames with same rotation
      for (let i = 0; i < 3; i++) {
        const data = new Uint8Array(64 * 64 * 4);
        const frame = new VideoFrame(data, {
          format: 'RGBA',
          codedWidth: 64,
          codedHeight: 64,
          timestamp: i * 33333,
          rotation: 180,
          flip: true,
        });

        encoder.encode(frame, { keyFrame: i === 0 });
        frame.close();
      }

      await encoder.flush();
      encoder.close();

      expect(errorOccurred).toBe(false);
      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });
});

describe('VideoEncoder contentHint (P1.3)', () => {
  it('should accept contentHint: text in isConfigSupported', async () => {
    const support = await VideoEncoder.isConfigSupported({
      codec: 'vp09.00.10.08',
      width: 640,
      height: 480,
      contentHint: 'text',
    });

    expect(support.supported).toBe(true);
    expect(support.config.contentHint).toBe('text');
  });

  it('should accept contentHint: detail in isConfigSupported', async () => {
    const support = await VideoEncoder.isConfigSupported({
      codec: 'vp09.00.10.08',
      width: 640,
      height: 480,
      contentHint: 'detail',
    });

    expect(support.supported).toBe(true);
    expect(support.config.contentHint).toBe('detail');
  });

  it('should accept contentHint: motion in isConfigSupported', async () => {
    const support = await VideoEncoder.isConfigSupported({
      codec: 'vp09.00.10.08',
      width: 640,
      height: 480,
      contentHint: 'motion',
    });

    expect(support.supported).toBe(true);
    expect(support.config.contentHint).toBe('motion');
  });

  it('should clone config with contentHint in isConfigSupported', async () => {
    const originalConfig = {
      codec: 'vp09.00.10.08',
      width: 640,
      height: 480,
      contentHint: 'text' as const,
    };

    const support = await VideoEncoder.isConfigSupported(originalConfig);

    expect(support.supported).toBe(true);
    // Config should be cloned, not same reference
    expect(support.config).not.toBe(originalConfig);
    expect(support.config.contentHint).toBe('text');
  });

  it('should configure encoder with contentHint', () => {
    const encoder = new VideoEncoder({
      output: () => {},
      error: () => {},
    });

    // Should not throw
    expect(() => {
      encoder.configure({
        codec: 'vp09.00.10.08',
        width: 640,
        height: 480,
        contentHint: 'text',
      });
    }).not.toThrow();

    encoder.close();
  });

  it('should encode with contentHint: text (screen content)', async () => {
    const chunks: EncodedVideoChunk[] = [];

    const encoder = new VideoEncoder({
      output: (chunk) => chunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'vp09.00.10.08',
      width: 64,
      height: 64,
      bitrate: 500_000,
      contentHint: 'text',
    });

    // Create frame with text-like content (high contrast edges)
    const data = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const idx = (y * 64 + x) * 4;
        // Create checkerboard pattern (text-like)
        const isWhite = (x + y) % 2 === 0;
        data[idx] = isWhite ? 255 : 0;
        data[idx + 1] = isWhite ? 255 : 0;
        data[idx + 2] = isWhite ? 255 : 0;
        data[idx + 3] = 255;
      }
    }

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 64,
      codedHeight: 64,
      timestamp: 0,
    });

    encoder.encode(frame, { keyFrame: true });
    frame.close();

    await encoder.flush();
    encoder.close();

    expect(chunks.length).toBeGreaterThan(0);
  }, 30000);
});

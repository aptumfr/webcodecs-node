/**
 * Tests for VideoDecoder class
 */
import { jest } from '@jest/globals';
import { VideoDecoder } from '../decoders/VideoDecoder.js';
import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { VideoFrame } from '../core/VideoFrame.js';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';

describe('VideoDecoder', () => {
  describe('isConfigSupported', () => {
    it('should support H.264', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'avc1.42001E',
        codedWidth: 640,
        codedHeight: 480,
      });

      expect(support.supported).toBe(true);
    });

    it('should support VP8', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'vp8',
        codedWidth: 640,
        codedHeight: 480,
      });

      expect(support.supported).toBe(true);
    });

    it('should support VP9', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'vp09.00.10.08',
        codedWidth: 1920,
        codedHeight: 1080,
      });

      expect(support.supported).toBe(true);
    });

    it('should support HEVC', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'hev1.1.6.L93.B0',
        codedWidth: 1920,
        codedHeight: 1080,
      });

      expect(support.supported).toBe(true);
    });

    it('should support AV1', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'av01.0.01M.08',
        codedWidth: 1920,
        codedHeight: 1080,
      });

      expect(support.supported).toBe(true);
    });

    it('should not support unknown codec', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'unknown-codec',
        codedWidth: 640,
        codedHeight: 480,
      });

      expect(support.supported).toBe(false);
    });

    // Capability checks for outputFormat
    it('should not support 10-bit output format with H.264', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'avc1.42001E',
        codedWidth: 640,
        codedHeight: 480,
        outputFormat: 'I420P10',
      });

      expect(support.supported).toBe(false);
    });

    it('should not support 10-bit output format with VP8', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'vp8',
        codedWidth: 640,
        codedHeight: 480,
        outputFormat: 'I420P10',
      });

      expect(support.supported).toBe(false);
    });

    it('should support 10-bit output format with HEVC', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'hev1.1.6.L93.B0',
        codedWidth: 1920,
        codedHeight: 1080,
        outputFormat: 'I420P10',
      });

      expect(support.supported).toBe(true);
    });

    it('should support 10-bit output format with VP9', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'vp09.02.10.10',
        codedWidth: 1920,
        codedHeight: 1080,
        outputFormat: 'I420P10',
      });

      expect(support.supported).toBe(true);
    });

    it('should support 10-bit output format with AV1', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'av01.0.04M.10',
        codedWidth: 1920,
        codedHeight: 1080,
        outputFormat: 'I420P10',
      });

      expect(support.supported).toBe(true);
    });

    it('should not support unsupported output format', async () => {
      const support = await VideoDecoder.isConfigSupported({
        codec: 'avc1.42001E',
        codedWidth: 640,
        codedHeight: 480,
        outputFormat: 'INVALID_FORMAT' as any,
      });

      expect(support.supported).toBe(false);
    });
  });

  describe('constructor', () => {
    it('should create decoder with callbacks', () => {
      const output = jest.fn();
      const error = jest.fn();

      const decoder = new VideoDecoder({ output, error });

      expect(decoder.state).toBe('unconfigured');
      decoder.close();
    });

    it('should throw without output callback', () => {
      expect(() => new VideoDecoder({ output: null as any, error: () => {} })).toThrow();
    });

    it('should throw without error callback', () => {
      expect(() => new VideoDecoder({ output: () => {}, error: null as any })).toThrow();
    });
  });

  describe('configure', () => {
    it('should configure decoder', () => {
      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.configure({
        codec: 'avc1.42001E',
        codedWidth: 320,
        codedHeight: 240,
      });

      expect(decoder.state).toBe('configured');
      decoder.close();
    });

    it('should throw without codec', () => {
      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        decoder.configure({
          codec: '',
          codedWidth: 320,
          codedHeight: 240,
        })
      ).toThrow();

      decoder.close();
    });

    it('should throw on closed decoder', () => {
      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.close();

      expect(() =>
        decoder.configure({
          codec: 'avc1.42001E',
          codedWidth: 320,
          codedHeight: 240,
        })
      ).toThrow();
    });
  });

  describe('decode', () => {
    it('should throw when not configured', () => {
      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      const chunk = new EncodedVideoChunk({
        type: 'key',
        timestamp: 0,
        data: new Uint8Array(100),
      });

      expect(() => decoder.decode(chunk)).toThrow();
      decoder.close();
    });

    it('should throw with invalid chunk', () => {
      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.configure({
        codec: 'avc1.42001E',
        codedWidth: 64,
        codedHeight: 64,
      });

      expect(() => decoder.decode('invalid' as any)).toThrow();
      decoder.close();
    });
  });

  describe('reset', () => {
    it('should reset decoder to unconfigured state', () => {
      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.configure({
        codec: 'vp8',
        codedWidth: 320,
        codedHeight: 240,
      });

      expect(decoder.state).toBe('configured');

      decoder.reset();

      expect(decoder.state).toBe('unconfigured');
      decoder.close();
    });

    it('should throw on closed decoder', () => {
      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.close();

      expect(() => decoder.reset()).toThrow();
    });
  });

  describe('close', () => {
    it('should close decoder', () => {
      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.close();

      expect(decoder.state).toBe('closed');
    });

    it('should be idempotent', () => {
      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.close();
      decoder.close(); // Should not throw

      expect(decoder.state).toBe('closed');
    });
  });

  describe('flush', () => {
    it('should throw when not configured', async () => {
      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      await expect(decoder.flush()).rejects.toThrow();
      decoder.close();
    });
  });

  describe('decodeQueueSize', () => {
    it('should start at 0', () => {
      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      expect(decoder.decodeQueueSize).toBe(0);
      decoder.close();
    });
  });
});

describe('VideoDecoder encode-decode roundtrip', () => {
  it('should decode H.264 encoded frames', async () => {
    const width = 64;
    const height = 64;
    const frameCount = 3;

    // Step 1: Encode frames
    const encodedChunks: EncodedVideoChunk[] = [];
    let description: Uint8Array | undefined;

    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        encodedChunks.push(chunk);
        // Capture AVCC description for decoder
        if (metadata?.decoderConfig?.description) {
          description = metadata.decoderConfig.description;
        }
      },
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'avc1.42001E',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
    });

    // Create and encode test frames (red, green, blue)
    const colors = [
      [255, 0, 0, 255],   // Red
      [0, 255, 0, 255],   // Green
      [0, 0, 255, 255],   // Blue
    ];

    for (let i = 0; i < frameCount; i++) {
      const data = new Uint8Array(width * height * 4);
      const [r, g, b, a] = colors[i];
      for (let p = 0; p < width * height; p++) {
        data[p * 4] = r;
        data[p * 4 + 1] = g;
        data[p * 4 + 2] = b;
        data[p * 4 + 3] = a;
      }

      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: i * 33333,
      });

      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBeGreaterThan(0);

    // Step 2: Decode frames
    const decodedFrames: VideoFrame[] = [];

    const decoder = new VideoDecoder({
      output: (frame) => decodedFrames.push(frame),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'avc1.42001E',
      codedWidth: width,
      codedHeight: height,
      outputFormat: 'RGBA',
      description, // Pass AVCC config for H.264 decoding
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    // Verify decoded frames
    expect(decodedFrames.length).toBe(frameCount);

    for (const frame of decodedFrames) {
      expect(frame.codedWidth).toBe(width);
      expect(frame.codedHeight).toBe(height);
      expect(frame.format).toBe('RGBA');
      frame.close();
    }
  }, 30000);

  it('should decode VP9 encoded frames', async () => {
    const width = 64;
    const height = 64;
    const frameCount = 3;

    // Step 1: Encode frames
    const encodedChunks: EncodedVideoChunk[] = [];

    const encoder = new VideoEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
    });

    for (let i = 0; i < frameCount; i++) {
      const data = new Uint8Array(width * height * 4);
      // Fill with gradient (no alpha transparency issues with VP9)
      for (let p = 0; p < width * height; p++) {
        data[p * 4] = (i * 80) % 256;
        data[p * 4 + 1] = (p % width) * 4;
        data[p * 4 + 2] = Math.floor(p / width) * 4;
        data[p * 4 + 3] = 255;
      }

      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: i * 33333,
      });

      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBeGreaterThan(0);

    // Step 2: Decode frames
    const decodedFrames: VideoFrame[] = [];

    const decoder = new VideoDecoder({
      output: (frame) => decodedFrames.push(frame),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'vp09.00.10.08',
      codedWidth: width,
      codedHeight: height,
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    // Verify decoded frames
    expect(decodedFrames.length).toBe(frameCount);

    for (const frame of decodedFrames) {
      expect(frame.codedWidth).toBe(width);
      expect(frame.codedHeight).toBe(height);
      frame.close();
    }
  }, 30000);

  it('should pass chunk timestamps to decoded frames', async () => {
    const width = 64;
    const height = 64;
    const frameCount = 3;

    // Encode frames first
    const encodedChunks: EncodedVideoChunk[] = [];
    let description: Uint8Array | undefined;

    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        encodedChunks.push(chunk);
        // Capture AVCC description for decoder
        if (metadata?.decoderConfig?.description) {
          description = metadata.decoderConfig.description;
        }
      },
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'avc1.42001E',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
    });

    for (let i = 0; i < frameCount; i++) {
      const data = new Uint8Array(width * height * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: i * 33333,
      });

      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBe(frameCount);

    // Now decode - the decoder should pass timestamps from chunks to output frames
    const decodedFrames: VideoFrame[] = [];

    const decoder = new VideoDecoder({
      output: (frame) => decodedFrames.push(frame),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'avc1.42001E',
      codedWidth: width,
      codedHeight: height,
      description, // Pass AVCC config for H.264 decoding
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    // The decoder should output same number of frames as input chunks
    expect(decodedFrames.length).toBe(encodedChunks.length);

    // With B-frames, chunks arrive in decode order but frames output in display order.
    // The set of timestamps should match, but order may differ.
    const chunkTimestamps = encodedChunks.map(c => c.timestamp).sort((a, b) => a - b);
    const frameTimestamps = decodedFrames.map(f => f.timestamp).sort((a, b) => a - b);
    expect(frameTimestamps).toEqual(chunkTimestamps);

    // Frames should come out in display order (sorted by timestamp)
    for (let i = 1; i < decodedFrames.length; i++) {
      expect(decodedFrames[i].timestamp).toBeGreaterThan(decodedFrames[i - 1].timestamp);
    }

    for (const frame of decodedFrames) {
      frame.close();
    }
  }, 30000);

  it('should pass displayAspectWidth/Height to output VideoFrame', async () => {
    // Test the S1 fix: VideoDecoderConfig's displayAspectWidth/Height
    // should be passed to output VideoFrame as displayWidth/displayHeight
    const codedWidth = 64;
    const codedHeight = 48; // 4:3 coded aspect
    const displayAspectWidth = 64;
    const displayAspectHeight = 36; // 16:9 display aspect

    // Step 1: Encode a frame
    const encodedChunks: EncodedVideoChunk[] = [];
    let description: Uint8Array | undefined;

    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        encodedChunks.push(chunk);
        if (metadata?.decoderConfig?.description) {
          description = metadata.decoderConfig.description;
        }
      },
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'avc1.42001E',
      width: codedWidth,
      height: codedHeight,
      bitrate: 500_000,
      framerate: 30,
    });

    const data = new Uint8Array(codedWidth * codedHeight * 4);
    data.fill(128); // Gray

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth,
      codedHeight,
      timestamp: 0,
    });

    encoder.encode(frame, { keyFrame: true });
    frame.close();

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBe(1);

    // Step 2: Decode with display aspect dimensions
    const decodedFrames: VideoFrame[] = [];

    const decoder = new VideoDecoder({
      output: (frame) => decodedFrames.push(frame),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'avc1.42001E',
      codedWidth,
      codedHeight,
      displayAspectWidth,
      displayAspectHeight,
      outputFormat: 'RGBA',
      description,
    });

    decoder.decode(encodedChunks[0]);
    await decoder.flush();
    decoder.close();

    expect(decodedFrames.length).toBe(1);

    const decodedFrame = decodedFrames[0];
    // Coded dimensions should match
    expect(decodedFrame.codedWidth).toBe(codedWidth);
    expect(decodedFrame.codedHeight).toBe(codedHeight);
    // Display dimensions should be set from config
    expect(decodedFrame.displayWidth).toBe(displayAspectWidth);
    expect(decodedFrame.displayHeight).toBe(displayAspectHeight);

    decodedFrame.close();
  }, 30000);
});

describe('VideoDecoder output formats', () => {
  // Helper to create encoded chunks for testing
  async function createEncodedChunks(format: 'RGBA' | 'I420'): Promise<EncodedVideoChunk[]> {
    const width = 64;
    const height = 64;
    const encodedChunks: EncodedVideoChunk[] = [];

    const encoder = new VideoEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
    });

    // Create test frame in the specified format
    let data: Uint8Array;
    if (format === 'RGBA') {
      data = new Uint8Array(width * height * 4);
      for (let p = 0; p < width * height; p++) {
        data[p * 4] = 128;      // R
        data[p * 4 + 1] = 64;   // G
        data[p * 4 + 2] = 192;  // B
        data[p * 4 + 3] = 255;  // A
      }
    } else {
      // I420: Y + U + V planes
      const ySize = width * height;
      const uvSize = (width / 2) * (height / 2);
      data = new Uint8Array(ySize + 2 * uvSize);
      // Y plane (gray)
      for (let i = 0; i < ySize; i++) data[i] = 128;
      // U plane
      for (let i = 0; i < uvSize; i++) data[ySize + i] = 128;
      // V plane
      for (let i = 0; i < uvSize; i++) data[ySize + uvSize + i] = 128;
    }

    const frame = new VideoFrame(data, {
      format,
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    encoder.encode(frame, { keyFrame: true });
    frame.close();

    await encoder.flush();
    encoder.close();

    return encodedChunks;
  }

  it('should decode to I420 format (default)', async () => {
    const encodedChunks = await createEncodedChunks('RGBA');
    expect(encodedChunks.length).toBeGreaterThan(0);

    const decodedFrames: VideoFrame[] = [];
    const decoder = new VideoDecoder({
      output: (frame) => decodedFrames.push(frame),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'vp09.00.10.08',
      codedWidth: 64,
      codedHeight: 64,
      // outputFormat defaults to I420
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    expect(decodedFrames.length).toBeGreaterThan(0);
    for (const frame of decodedFrames) {
      expect(frame.format).toBe('I420');
      expect(frame.numberOfPlanes).toBe(3);
      // I420 frame size = Y + U + V = 64*64 + 32*32 + 32*32 = 4096 + 1024 + 1024 = 6144
      expect(frame.allocationSize()).toBe(6144);
      frame.close();
    }
  }, 30000);

  it('should decode to NV12 format', async () => {
    const encodedChunks = await createEncodedChunks('RGBA');
    expect(encodedChunks.length).toBeGreaterThan(0);

    const decodedFrames: VideoFrame[] = [];
    const decoder = new VideoDecoder({
      output: (frame) => decodedFrames.push(frame),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'vp09.00.10.08',
      codedWidth: 64,
      codedHeight: 64,
      outputFormat: 'NV12',
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    expect(decodedFrames.length).toBeGreaterThan(0);
    for (const frame of decodedFrames) {
      expect(frame.format).toBe('NV12');
      expect(frame.numberOfPlanes).toBe(2);
      // NV12 frame size = Y + UV = 64*64 + 64*32 = 4096 + 2048 = 6144
      expect(frame.allocationSize()).toBe(6144);
      frame.close();
    }
  }, 30000);

  it('should decode to BGRA format', async () => {
    const encodedChunks = await createEncodedChunks('RGBA');
    expect(encodedChunks.length).toBeGreaterThan(0);

    const decodedFrames: VideoFrame[] = [];
    const decoder = new VideoDecoder({
      output: (frame) => decodedFrames.push(frame),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'vp09.00.10.08',
      codedWidth: 64,
      codedHeight: 64,
      outputFormat: 'BGRA',
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    expect(decodedFrames.length).toBeGreaterThan(0);
    for (const frame of decodedFrames) {
      expect(frame.format).toBe('BGRA');
      expect(frame.numberOfPlanes).toBe(1);
      // BGRA frame size = 64*64*4 = 16384
      expect(frame.allocationSize()).toBe(16384);
      frame.close();
    }
  }, 30000);

  it('should throw with invalid outputFormat', () => {
    const decoder = new VideoDecoder({
      output: () => {},
      error: () => {},
    });

    expect(() => {
      decoder.configure({
        codec: 'vp09.00.10.08',
        codedWidth: 64,
        codedHeight: 64,
        outputFormat: 'INVALID' as any,
      });
    }).toThrow(TypeError);

    decoder.close();
  });
});

describe('VideoEncoder input formats', () => {
  it('should encode I420 input format', async () => {
    const width = 64;
    const height = 64;
    const encodedChunks: EncodedVideoChunk[] = [];

    const encoder = new VideoEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
    });

    // Create I420 frame
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);
    const data = new Uint8Array(ySize + 2 * uvSize);
    // Y plane
    for (let i = 0; i < ySize; i++) data[i] = 128;
    // U plane
    for (let i = 0; i < uvSize; i++) data[ySize + i] = 128;
    // V plane
    for (let i = 0; i < uvSize; i++) data[ySize + uvSize + i] = 128;

    const frame = new VideoFrame(data, {
      format: 'I420',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    encoder.encode(frame, { keyFrame: true });
    frame.close();

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBeGreaterThan(0);
    // Verify encoding succeeded - chunk type depends on FFmpeg keyframe detection
    expect(['key', 'delta']).toContain(encodedChunks[0].type);
  }, 30000);

  it('should encode NV12 input format', async () => {
    const width = 64;
    const height = 64;
    const encodedChunks: EncodedVideoChunk[] = [];

    const encoder = new VideoEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
    });

    // Create NV12 frame (Y + interleaved UV)
    const ySize = width * height;
    const uvSize = width * (height / 2);
    const data = new Uint8Array(ySize + uvSize);
    // Y plane
    for (let i = 0; i < ySize; i++) data[i] = 128;
    // UV interleaved
    for (let i = 0; i < uvSize; i++) data[ySize + i] = 128;

    const frame = new VideoFrame(data, {
      format: 'NV12',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    encoder.encode(frame, { keyFrame: true });
    frame.close();

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBeGreaterThan(0);
    // Verify encoding succeeded - chunk type depends on FFmpeg keyframe detection
    expect(['key', 'delta']).toContain(encodedChunks[0].type);
  }, 30000);

  it('should reject mixed input formats', async () => {
    const width = 64;
    const height = 64;
    let errorCalled = false;

    const encoder = new VideoEncoder({
      output: () => {},
      error: () => { errorCalled = true; },
    });

    encoder.configure({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
    });

    // First frame in RGBA
    const rgbaData = new Uint8Array(width * height * 4);
    const frame1 = new VideoFrame(rgbaData, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });
    encoder.encode(frame1, { keyFrame: true });
    frame1.close();

    // Second frame in I420 (different format)
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);
    const i420Data = new Uint8Array(ySize + 2 * uvSize);
    const frame2 = new VideoFrame(i420Data, {
      format: 'I420',
      codedWidth: width,
      codedHeight: height,
      timestamp: 33333,
    });
    encoder.encode(frame2);
    frame2.close();

    // Error callback should have been called due to format mismatch
    expect(errorCalled).toBe(true);

    encoder.close();
  }, 30000);
});

describe('VideoDecoder isConfigSupported validation (N12 fix)', () => {
  it('should throw TypeError for invalid codedWidth', async () => {
    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      codedWidth: 0,
      codedHeight: 480,
    })).rejects.toThrow(TypeError);

    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      codedWidth: -100,
      codedHeight: 480,
    })).rejects.toThrow(TypeError);

    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      codedWidth: 640.5, // non-integer
      codedHeight: 480,
    })).rejects.toThrow(TypeError);

    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      codedWidth: NaN,
      codedHeight: 480,
    })).rejects.toThrow(TypeError);
  });

  it('should throw TypeError for invalid codedHeight', async () => {
    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      codedWidth: 640,
      codedHeight: 0,
    })).rejects.toThrow(TypeError);

    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      codedWidth: 640,
      codedHeight: -100,
    })).rejects.toThrow(TypeError);

    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      codedWidth: 640,
      codedHeight: 480.5, // non-integer
    })).rejects.toThrow(TypeError);
  });

  it('should throw TypeError for invalid displayAspectWidth', async () => {
    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      displayAspectWidth: 0,
    })).rejects.toThrow(TypeError);

    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      displayAspectWidth: -16,
    })).rejects.toThrow(TypeError);

    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      displayAspectWidth: 16.5, // non-integer
    })).rejects.toThrow(TypeError);
  });

  it('should throw TypeError for invalid displayAspectHeight', async () => {
    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      displayAspectHeight: 0,
    })).rejects.toThrow(TypeError);

    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      displayAspectHeight: -9,
    })).rejects.toThrow(TypeError);

    await expect(VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      displayAspectHeight: 9.5, // non-integer
    })).rejects.toThrow(TypeError);
  });

  it('should accept valid codedWidth and codedHeight', async () => {
    const support = await VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      codedWidth: 1920,
      codedHeight: 1080,
    });

    expect(support.supported).toBe(true);
    expect(support.config.codedWidth).toBe(1920);
    expect(support.config.codedHeight).toBe(1080);
  });

  it('should accept valid displayAspectWidth and displayAspectHeight', async () => {
    const support = await VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      displayAspectWidth: 16,
      displayAspectHeight: 9,
    });

    expect(support.supported).toBe(true);
    expect(support.config.displayAspectWidth).toBe(16);
    expect(support.config.displayAspectHeight).toBe(9);
  });

  it('should clone config and strip unknown fields', async () => {
    const support = await VideoDecoder.isConfigSupported({
      codec: 'avc1.42001E',
      unknownField: 'should be stripped',
    } as any);

    expect(support.supported).toBe(true);
    expect((support.config as any).unknownField).toBeUndefined();
  });
});

describe('VideoDecoder orientation output (P0.2)', () => {
  it('should output frames with rotation from config', async () => {
    const width = 64;
    const height = 64;
    const encodedChunks: EncodedVideoChunk[] = [];

    const encoder = new VideoEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
    });

    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i++) data[i] = 128;

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    encoder.encode(frame, { keyFrame: true });
    frame.close();
    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBeGreaterThan(0);

    // Decode with rotation config
    const decodedFrames: VideoFrame[] = [];
    const decoder = new VideoDecoder({
      output: (f) => decodedFrames.push(f),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'vp09.00.10.08',
      codedWidth: width,
      codedHeight: height,
      rotation: 90,
    });

    decoder.decode(encodedChunks[0]);
    await decoder.flush();
    decoder.close();

    expect(decodedFrames.length).toBe(1);
    expect(decodedFrames[0].rotation).toBe(90);
    // Display dimensions should be swapped for 90 degree rotation
    expect(decodedFrames[0].displayWidth).toBe(height);
    expect(decodedFrames[0].displayHeight).toBe(width);

    decodedFrames[0].close();
  }, 30000);

  it('should output frames with flip from config', async () => {
    const width = 64;
    const height = 64;
    const encodedChunks: EncodedVideoChunk[] = [];

    const encoder = new VideoEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
    });

    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i++) data[i] = 128;

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    encoder.encode(frame, { keyFrame: true });
    frame.close();
    await encoder.flush();
    encoder.close();

    // Decode with flip config
    const decodedFrames: VideoFrame[] = [];
    const decoder = new VideoDecoder({
      output: (f) => decodedFrames.push(f),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'vp09.00.10.08',
      codedWidth: width,
      codedHeight: height,
      flip: true,
    });

    decoder.decode(encodedChunks[0]);
    await decoder.flush();
    decoder.close();

    expect(decodedFrames.length).toBe(1);
    expect(decodedFrames[0].flip).toBe(true);

    decodedFrames[0].close();
  }, 30000);

  it('should output frames with both rotation and flip from config', async () => {
    const width = 64;
    const height = 64;
    const encodedChunks: EncodedVideoChunk[] = [];

    const encoder = new VideoEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
    });

    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i++) data[i] = 128;

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    encoder.encode(frame, { keyFrame: true });
    frame.close();
    await encoder.flush();
    encoder.close();

    // Decode with rotation and flip config
    const decodedFrames: VideoFrame[] = [];
    const decoder = new VideoDecoder({
      output: (f) => decodedFrames.push(f),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'vp09.00.10.08',
      codedWidth: width,
      codedHeight: height,
      rotation: 180,
      flip: true,
    });

    decoder.decode(encodedChunks[0]);
    await decoder.flush();
    decoder.close();

    expect(decodedFrames.length).toBe(1);
    expect(decodedFrames[0].rotation).toBe(180);
    expect(decodedFrames[0].flip).toBe(true);

    decodedFrames[0].close();
  }, 30000);
});

describe('VideoDecoder bitstream colorSpace (P0.10)', () => {
  it('should report bitstream colorSpace when config colorSpace is not specified', async () => {
    const width = 64;
    const height = 64;
    const encodedChunks: EncodedVideoChunk[] = [];

    // Encode with specific colorSpace
    const encoder = new VideoEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
      // Use default BT.709 colorSpace
    });

    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i++) data[i] = 128;

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    encoder.encode(frame, { keyFrame: true });
    frame.close();
    await encoder.flush();
    encoder.close();

    // Decode WITHOUT specifying colorSpace in config
    const decodedFrames: VideoFrame[] = [];
    const decoder = new VideoDecoder({
      output: (f) => decodedFrames.push(f),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'vp09.00.10.08',
      codedWidth: width,
      codedHeight: height,
      // No colorSpace specified - should use bitstream colorSpace
    });

    decoder.decode(encodedChunks[0]);
    await decoder.flush();
    decoder.close();

    expect(decodedFrames.length).toBe(1);
    // Decoded frame should have colorSpace from bitstream
    // (VP9 typically signals BT.709 for SDR content)
    expect(decodedFrames[0].colorSpace).toBeDefined();

    decodedFrames[0].close();
  }, 30000);

  it('should use config colorSpace when provided (overrides bitstream)', async () => {
    const width = 64;
    const height = 64;
    const encodedChunks: EncodedVideoChunk[] = [];

    const encoder = new VideoEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 500_000,
      framerate: 30,
    });

    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i++) data[i] = 128;

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    encoder.encode(frame, { keyFrame: true });
    frame.close();
    await encoder.flush();
    encoder.close();

    // Decode with explicit colorSpace in config
    const decodedFrames: VideoFrame[] = [];
    const decoder = new VideoDecoder({
      output: (f) => decodedFrames.push(f),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'vp09.00.10.08',
      codedWidth: width,
      codedHeight: height,
      colorSpace: {
        primaries: 'bt2020',
        transfer: 'pq',
        matrix: 'bt2020-ncl',
        fullRange: false,
      },
    });

    decoder.decode(encodedChunks[0]);
    await decoder.flush();
    decoder.close();

    expect(decodedFrames.length).toBe(1);
    // Should use config colorSpace
    expect(decodedFrames[0].colorSpace.primaries).toBe('bt2020');
    expect(decodedFrames[0].colorSpace.transfer).toBe('pq');

    decodedFrames[0].close();
  }, 30000);
});

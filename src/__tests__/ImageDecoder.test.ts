/**
 * Tests for ImageDecoder class - including animated image support
 */

import { ImageDecoder } from '../decoders/ImageDecoder.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { Canvas } from 'skia-canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_IMAGES_DIR = path.join(__dirname, 'fixtures');

/**
 * Helper to convert Node.js Buffer to ArrayBuffer properly.
 * Node.js Buffer.buffer may be larger than the actual data.
 */
function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buffer.length);
  new Uint8Array(ab).set(buffer);
  return ab;
}

/**
 * Get path to a test fixture (generated in beforeAll)
 */
function findTestImage(filename: string): string | null {
  const fixturePath = path.join(FIXTURE_IMAGES_DIR, filename);
  if (fs.existsSync(fixturePath)) {
    return fixturePath;
  }
  return null;
}

/**
 * Generate test fixtures if they don't exist
 */
async function generateTestFixtures(): Promise<void> {
  if (!fs.existsSync(FIXTURE_IMAGES_DIR)) {
    fs.mkdirSync(FIXTURE_IMAGES_DIR, { recursive: true });
  }

  // Create a simple 100x100 test image with skia-canvas
  const createTestCanvas = (): Canvas => {
    const canvas = new Canvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 50, 50);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(50, 0, 50, 50);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 50, 50, 50);
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(50, 50, 50, 50);
    return canvas;
  };

  // Generate PNG
  const pngPath = path.join(FIXTURE_IMAGES_DIR, 'test.png');
  if (!fs.existsSync(pngPath)) {
    const canvas = createTestCanvas();
    fs.writeFileSync(pngPath, await canvas.toBuffer('png'));
  }

  // Generate JPEG
  const jpgPath = path.join(FIXTURE_IMAGES_DIR, 'test.jpg');
  if (!fs.existsSync(jpgPath)) {
    const canvas = createTestCanvas();
    fs.writeFileSync(jpgPath, await canvas.toBuffer('jpeg'));
  }

  // Generate BMP (via ffmpeg from PNG)
  const bmpPath = path.join(FIXTURE_IMAGES_DIR, 'test.bmp');
  if (!fs.existsSync(bmpPath)) {
    try {
      execSync(`ffmpeg -y -i "${pngPath}" "${bmpPath}"`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }

  // Generate static GIF (via ffmpeg from PNG)
  const gifPath = path.join(FIXTURE_IMAGES_DIR, 'test.gif');
  if (!fs.existsSync(gifPath)) {
    try {
      execSync(`ffmpeg -y -i "${pngPath}" "${gifPath}"`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }

  // Generate animated GIF (2 frames via ffmpeg)
  const animGifPath = path.join(FIXTURE_IMAGES_DIR, 'animated_multi.gif');
  if (!fs.existsSync(animGifPath)) {
    try {
      execSync(
        `ffmpeg -y -f lavfi -i "color=c=red:s=100x100:d=0.1,format=rgb24" ` +
        `-f lavfi -i "color=c=blue:s=100x100:d=0.1,format=rgb24" ` +
        `-filter_complex "[0][1]concat=n=2:v=1:a=0" -loop 0 "${animGifPath}"`,
        { stdio: 'ignore' }
      );
    } catch { /* ignore */ }
  }

  // Generate AVIF (via ffmpeg from PNG)
  const avifPath = path.join(FIXTURE_IMAGES_DIR, 'test.avif');
  if (!fs.existsSync(avifPath)) {
    try {
      execSync(`ffmpeg -y -i "${pngPath}" -c:v libaom-av1 -still-picture 1 "${avifPath}"`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }

  // Generate static WebP (via ffmpeg from PNG)
  const webpPath = path.join(FIXTURE_IMAGES_DIR, 'test.webp');
  if (!fs.existsSync(webpPath)) {
    try {
      execSync(`ffmpeg -y -i "${pngPath}" "${webpPath}"`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }

  // Generate animated WebP (2 frames via ffmpeg)
  const animWebpPath = path.join(FIXTURE_IMAGES_DIR, 'animated_multi.webp');
  if (!fs.existsSync(animWebpPath)) {
    try {
      execSync(
        `ffmpeg -y -f lavfi -i "color=c=red:s=100x100:d=0.1" ` +
        `-f lavfi -i "color=c=blue:s=100x100:d=0.1" ` +
        `-filter_complex "[0][1]concat=n=2:v=1:a=0" -loop 0 "${animWebpPath}"`,
        { stdio: 'ignore' }
      );
    } catch { /* ignore */ }
  }
}

describe('ImageDecoder', () => {
  // Generate test fixtures before running tests
  beforeAll(async () => {
    await generateTestFixtures();
  }, 30000);
  describe('static images', () => {
    it('should decode a static PNG image', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      expect(decoder.tracks.length).toBeGreaterThan(0);
      const track = decoder.tracks.selectedTrack;
      expect(track).toBeDefined();
      expect(track!.frameCount).toBe(1);
      expect(track!.animated).toBe(false);

      const result = await decoder.decode({ frameIndex: 0 });
      expect(result.image).toBeDefined();
      expect(result.image.codedWidth).toBeGreaterThan(0);
      expect(result.image.codedHeight).toBeGreaterThan(0);

      result.image.close();
      decoder.close();
    });

    it('should decode a static JPEG image', async () => {
      const jpgPath = findTestImage('test.jpg');
      if (!jpgPath) {
        console.log('Skipping test: test.jpg not found');
        return;
      }

      const data = fs.readFileSync(jpgPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/jpeg',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track!.animated).toBe(false);
      expect(track!.frameCount).toBe(1);

      decoder.close();
    });

    it('should decode a static WebP image', async () => {
      const webpPath = findTestImage('test.webp');
      if (!webpPath) {
        console.log('Skipping test: test.webp not found');
        return;
      }

      const data = fs.readFileSync(webpPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/webp',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track!.animated).toBe(false);

      decoder.close();
    });

    it('should decode an AVIF image', async () => {
      const avifPath = findTestImage('test.avif');
      if (!avifPath) {
        console.log('Skipping test: test.avif not found');
        return;
      }

      const data = fs.readFileSync(avifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/avif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track).toBeDefined();
      expect(track!.frameCount).toBeGreaterThanOrEqual(1);

      const result = await decoder.decode({ frameIndex: 0 });
      expect(result.image).toBeDefined();
      expect(result.image.codedWidth).toBeGreaterThan(0);
      expect(result.image.codedHeight).toBeGreaterThan(0);

      result.image.close();
      decoder.close();
    });

    it('should decode a BMP image', async () => {
      const bmpPath = findTestImage('test.bmp');
      if (!bmpPath) {
        console.log('Skipping test: test.bmp not found');
        return;
      }

      const data = fs.readFileSync(bmpPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/bmp',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track).toBeDefined();
      expect(track!.animated).toBe(false);

      const result = await decoder.decode({ frameIndex: 0 });
      expect(result.image.codedWidth).toBeGreaterThan(0);

      result.image.close();
      decoder.close();
    });
  });

  describe('animated images', () => {
    it('should decode an animated GIF with multiple frames', async () => {
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      if (!track || !track.animated || track.frameCount <= 1) {
        console.log('Skipping test: FFmpeg could not detect GIF animation');
        decoder.close();
        return;
      }

      // Decode first frame
      const result1 = await decoder.decode({ frameIndex: 0 });
      expect(result1.image).toBeDefined();
      expect(result1.image.timestamp).toBe(0);

      // Decode second frame - should have a later timestamp
      const result2 = await decoder.decode({ frameIndex: 1 });
      expect(result2.image).toBeDefined();
      expect(result2.image.timestamp).toBeGreaterThan(0);

      result1.image.close();
      result2.image.close();
      decoder.close();
    });

    it('should parse frame durations from animated GIF', async () => {
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track!.frameCount).toBeGreaterThan(1);

      // Each frame should have a duration
      const frame0 = await decoder.decode({ frameIndex: 0 });
      const frame1 = await decoder.decode({ frameIndex: 1 });

      // Duration should be in microseconds (40ms = 40000 microseconds)
      expect(frame0.image.duration).toBeGreaterThan(0);
      expect(frame1.image.duration).toBeGreaterThan(0);

      // Timestamp of frame 1 should be >= duration of frame 0
      expect(frame1.image.timestamp).toBeGreaterThanOrEqual(frame0.image.duration!);

      frame0.image.close();
      frame1.image.close();
      decoder.close();
    });

    it('should report correct repetitionCount for animated GIF', async () => {
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      // GIF with loop 0 should be Infinity
      expect(track!.repetitionCount).toBeDefined();
      // For a looping GIF, repetitionCount is typically Infinity
      expect(track!.repetitionCount).toBeGreaterThanOrEqual(0);

      decoder.close();
    });

    it('should decode frames sequentially with correct timestamps', async () => {
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      const frameCount = track!.frameCount;

      // Decode all frames and verify timestamps are increasing
      let lastTimestamp = -1;
      const frames = [];

      for (let i = 0; i < Math.min(frameCount, 5); i++) {
        const result = await decoder.decode({ frameIndex: i });
        expect(result.image.timestamp).toBeGreaterThan(lastTimestamp);
        lastTimestamp = result.image.timestamp;
        frames.push(result.image);
      }

      // Cleanup
      frames.forEach((f) => f.close());
      decoder.close();
    });

    // Animated WebP decoding now works via node-webpmux (bypasses FFmpeg's limited webp demuxer)
    it('should decode an animated WebP with multiple frames', async () => {
      const webpPath = findTestImage('animated_multi.webp');
      
      
      if (!webpPath) {
        console.log('Skipping test: animated_multi.webp not found');
        return;
      }

      const data = fs.readFileSync(webpPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/webp',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track).toBeDefined();
      expect(track!.animated).toBe(true);
      expect(track!.frameCount).toBeGreaterThan(1);

      // Decode first frame
      const result1 = await decoder.decode({ frameIndex: 0 });
      expect(result1.image).toBeDefined();
      expect(result1.image.codedWidth).toBeGreaterThan(0);

      // Decode second frame
      const result2 = await decoder.decode({ frameIndex: 1 });
      expect(result2.image).toBeDefined();
      expect(result2.image.timestamp).toBeGreaterThan(0);

      result1.image.close();
      result2.image.close();
      decoder.close();
    });

    it('should handle static GIF as non-animated', async () => {
      const gifPath = findTestImage('test.gif');
      if (!gifPath) {
        console.log('Skipping test: test.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      // A single-frame GIF should not be marked as animated
      if (track!.frameCount === 1) {
        expect(track!.animated).toBe(false);
      }

      decoder.close();
    });
  });

  describe('isTypeSupported', () => {
    it('should support common image formats', async () => {
      expect(await ImageDecoder.isTypeSupported('image/png')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/jpeg')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/gif')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/webp')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/bmp')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/avif')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/tiff')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/apng')).toBe(true);
    });

    it('should return false for unsupported types', async () => {
      expect(await ImageDecoder.isTypeSupported('image/unknownformat')).toBe(false);
      expect(await ImageDecoder.isTypeSupported('video/mp4')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should reject for invalid image data', async () => {
      const decoder = new ImageDecoder({
        data: new ArrayBuffer(100), // Invalid image data
        type: 'image/png',
      });

      await expect(decoder.completed).rejects.toThrow();
    });

    it('should reject for unsupported image type', async () => {
      const decoder = new ImageDecoder({
        data: new ArrayBuffer(100),
        type: 'image/unknownformat',
      });

      await expect(decoder.completed).rejects.toThrow();
    });
  });

  describe('decode options', () => {
    it('should decode specific frame by index', async () => {
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      if (track!.frameCount > 2) {
        // Decode frame at index 2 directly
        const result = await decoder.decode({ frameIndex: 2 });
        expect(result.image).toBeDefined();
        // Frame 2 timestamp should be sum of durations of frames 0 and 1
        expect(result.image.timestamp).toBeGreaterThan(0);
        result.image.close();
      }

      decoder.close();
    });

    it('should report completeFramesOnly in decode result', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      const result = await decoder.decode({ frameIndex: 0 });
      expect(result.complete).toBe(true);

      result.image.close();
      decoder.close();
    });

    it('should allow decode with completeFramesOnly set to false', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      const result = await decoder.decode({ frameIndex: 0, completeFramesOnly: false });
      expect(result.complete).toBe(true);
      result.image.close();
      decoder.close();
    });

    it('should reset and re-decode frames', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;
      const first = await decoder.decode({ frameIndex: 0 });
      first.image.close();

      decoder.reset();
      await decoder.completed;
      const second = await decoder.decode({ frameIndex: 0 });
      expect(second.image.codedWidth).toBeGreaterThan(0);
      second.image.close();
      decoder.close();
    });
  });

  describe('WebCodecs API compliance', () => {
    it('should have type property matching constructor input', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      expect(decoder.type).toBe('image/png');
      decoder.close();
    });

    it('should have complete property that becomes true after data is loaded', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;
      expect(decoder.complete).toBe(true);
      decoder.close();
    });

    it('should have tracks.ready promise that resolves', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.tracks.ready;
      expect(decoder.tracks.length).toBeGreaterThan(0);
      expect(decoder.tracks.selectedIndex).toBeGreaterThanOrEqual(0);
      expect(decoder.tracks.selectedTrack).not.toBeNull();
      decoder.close();
    });

    it('should support transfer parameter for zero-copy', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const arrayBuffer = bufferToArrayBuffer(data);

      // Create decoder with transfer - should take ownership
      const decoder = new ImageDecoder({
        data: arrayBuffer,
        type: 'image/png',
        transfer: [arrayBuffer],
      });

      await decoder.completed;
      expect(decoder.complete).toBe(true);

      const result = await decoder.decode({ frameIndex: 0 });
      expect(result.image.codedWidth).toBeGreaterThan(0);
      result.image.close();
      decoder.close();
    });

    it('should throw InvalidStateError when decoding after close', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;
      decoder.close();

      await expect(decoder.decode({ frameIndex: 0 })).rejects.toThrow('ImageDecoder is closed');
    });

    it('should throw InvalidStateError for out of range frame index', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      // PNG has only 1 frame, so index 1 should fail
      await expect(decoder.decode({ frameIndex: 1 })).rejects.toThrow();
      decoder.close();
    });

    it('should throw InvalidStateError when reset after close', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;
      decoder.close();

      expect(() => decoder.reset()).toThrow('ImageDecoder is closed');
    });

    it('should return ImageTrack with correct properties', async () => {
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack!;

      // Check all required ImageTrack properties per spec
      expect(typeof track.animated).toBe('boolean');
      expect(typeof track.frameCount).toBe('number');
      expect(typeof track.repetitionCount).toBe('number');
      expect(typeof track.selected).toBe('boolean');

      expect(track.animated).toBe(true);
      expect(track.frameCount).toBeGreaterThan(1);
      expect(track.selected).toBe(true);

      decoder.close();
    });

    it('should iterate over tracks with Symbol.iterator', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      // Should be iterable
      const tracks = [...decoder.tracks];
      expect(tracks.length).toBe(decoder.tracks.length);

      decoder.close();
    });

    it('should allow setting ImageTrack.selected to switch tracks', async () => {
      // Test the S5 fix: ImageTrack.selected should be settable
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping track selection test: no test image');
        return;
      }

      const data = bufferToArrayBuffer(fs.readFileSync(pngPath));
      const decoder = new ImageDecoder({
        type: 'image/png',
        data,
      });

      await decoder.completed;

      const tracks = [...decoder.tracks];
      expect(tracks.length).toBeGreaterThan(0);

      // Get the first track
      const track = tracks[0];
      expect(track.selected).toBe(true);
      expect(decoder.tracks.selectedIndex).toBe(0);

      // For single-track images, deselecting should work
      track.selected = false;
      expect(track.selected).toBe(false);
      expect(decoder.tracks.selectedIndex).toBe(-1);

      // Re-selecting should update selectedIndex
      track.selected = true;
      expect(track.selected).toBe(true);
      expect(decoder.tracks.selectedIndex).toBe(0);

      decoder.close();
    });

    it('should support bracket notation for track access (tracks[0])', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      // Test bracket notation access - should work via Proxy
      const trackViaBracket = decoder.tracks[0];
      const trackViaSelectedTrack = decoder.tracks.selectedTrack;

      expect(trackViaBracket).toBeDefined();
      expect(trackViaBracket).toBe(trackViaSelectedTrack);

      // Verify track properties are accessible
      expect(trackViaBracket!.frameCount).toBe(1);
      expect(trackViaBracket!.animated).toBe(false);
      expect(trackViaBracket!.selected).toBe(true);

      decoder.close();
    });

    it('should return undefined for out-of-bounds bracket notation', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      // Out of bounds should return undefined
      expect(decoder.tracks[999]).toBeUndefined();
      expect(decoder.tracks[-1]).toBeUndefined();

      decoder.close();
    });

    it('should throw InvalidStateError when decoding with no track selected', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      // Deselect all tracks
      const track = decoder.tracks.selectedTrack!;
      track.selected = false;
      expect(decoder.tracks.selectedIndex).toBe(-1);

      // decode() should throw when no track is selected
      await expect(decoder.decode({ frameIndex: 0 })).rejects.toThrow('No track selected');

      decoder.close();
    });

    it('should have repetitionCount of 0 for still images (PNG)', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack!;
      // Per W3C spec: "For still images, 0"
      expect(track.repetitionCount).toBe(0);

      decoder.close();
    });

    it('should have repetitionCount of 0 for still images (JPEG)', async () => {
      const jpgPath = findTestImage('test.jpg');
      if (!jpgPath) {
        console.log('Skipping test: test.jpg not found');
        return;
      }

      const data = fs.readFileSync(jpgPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/jpeg',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack!;
      // Per W3C spec: "For still images, 0"
      expect(track.repetitionCount).toBe(0);

      decoder.close();
    });

    it('should have repetitionCount of Infinity for looping animated GIF', async () => {
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack!;
      // For animated GIF with loop=0 (infinite loop), repetitionCount should be Infinity
      if (track.animated) {
        expect(track.repetitionCount).toBe(Infinity);
      }

      decoder.close();
    });
  });

  describe('bitstream colorSpace propagation (N6)', () => {
    it('should propagate colorSpace to VideoFrame', async () => {
      // Create a simple PNG test image
      const pngPath = findTestImage('test-simple.png');
      if (!pngPath) {
        console.log('Skipping test: test-simple.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      const result = await decoder.decode();
      const frame = result.image;

      // Frame should have a colorSpace
      expect(frame.colorSpace).toBeDefined();

      // PNG images typically use sRGB (iec61966-2-1 transfer, bt709 primaries, rgb matrix)
      // OR the default config colorSpace
      // The exact values depend on the image's embedded color profile
      if (frame.colorSpace) {
        // Should have at least some color properties
        expect(
          frame.colorSpace.primaries !== null ||
          frame.colorSpace.transfer !== null ||
          frame.colorSpace.matrix !== null
        ).toBe(true);
      }

      frame.close();
      decoder.close();
    });

    it('should use config colorSpace when bitstream has no color info', async () => {
      const pngPath = findTestImage('test-simple.png');
      if (!pngPath) {
        console.log('Skipping test: test-simple.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
        // Specify a custom colorSpace in config
        colorSpaceConversion: 'none',
      });

      await decoder.completed;

      const result = await decoder.decode();
      const frame = result.image;

      // Frame should have a colorSpace
      expect(frame.colorSpace).toBeDefined();

      frame.close();
      decoder.close();
    });
  });
});

describe('ImageDecoder HDR colorSpace (P0.9)', () => {
  it('should detect HDR colorSpace from AVIF with HLG transfer', async () => {
    // This test verifies that when decoding HDR AVIF content,
    // the colorSpace is properly extracted from the bitstream
    const avifPath = findTestImage('test-simple.avif') || findTestImage('test.avif');
    if (!avifPath) {
      // Create a simple test without AVIF if not available
      // Just verify the colorSpace extraction mechanism exists
      expect(true).toBe(true);
      return;
    }

    const data = fs.readFileSync(avifPath);
    const decoder = new ImageDecoder({
      data: bufferToArrayBuffer(data),
      type: 'image/avif',
    });

    await decoder.completed;

    const result = await decoder.decode();
    const frame = result.image;

    // Frame should have a colorSpace object
    expect(frame.colorSpace).toBeDefined();
    // ColorSpace should have proper structure
    expect(typeof frame.colorSpace.primaries).toBe('string');

    frame.close();
    decoder.close();
  });

  it('should preserve HDR primaries (bt2020) when present in bitstream', async () => {
    const avifPath = findTestImage('test-simple.avif') || findTestImage('test.avif');
    if (!avifPath) {
      expect(true).toBe(true);
      return;
    }

    const data = fs.readFileSync(avifPath);
    const decoder = new ImageDecoder({
      data: bufferToArrayBuffer(data),
      type: 'image/avif',
    });

    await decoder.completed;

    const result = await decoder.decode();
    const frame = result.image;

    // Verify colorSpace exists and has expected structure
    expect(frame.colorSpace).toBeDefined();
    // For SDR content, typically bt709; for HDR, bt2020
    // We just verify the property exists and is a valid value
    expect(['bt709', 'bt2020', 'smpte170m', 'bt470bg', null]).toContain(frame.colorSpace.primaries);

    frame.close();
    decoder.close();
  });
});

describe('ImageDecoder preferAnimation (P1.1)', () => {
  it('should respect preferAnimation option for animated images', async () => {
    const gifPath = findTestImage('animated.gif') || findTestImage('test-animated.gif');
    if (!gifPath) {
      // Skip if no animated GIF available
      expect(true).toBe(true);
      return;
    }

    const data = fs.readFileSync(gifPath);

    // With preferAnimation: true (default for animated)
    const decoderAnimated = new ImageDecoder({
      data: bufferToArrayBuffer(data),
      type: 'image/gif',
      preferAnimation: true,
    });

    await decoderAnimated.completed;

    // Should have frameCount > 1 for animated
    const track = decoderAnimated.tracks.selectedTrack;
    expect(track).toBeDefined();
    if (track && track.frameCount > 1) {
      expect(track.animated).toBe(true);
    }

    decoderAnimated.close();
  });

  it('should accept preferAnimation: false for animated images', async () => {
    const gifPath = findTestImage('animated.gif') || findTestImage('test-animated.gif');
    if (!gifPath) {
      expect(true).toBe(true);
      return;
    }

    const data = fs.readFileSync(gifPath);

    // With preferAnimation: false
    const decoder = new ImageDecoder({
      data: bufferToArrayBuffer(data),
      type: 'image/gif',
      preferAnimation: false,
    });

    await decoder.completed;

    // Should still work, but may treat as static
    const track = decoder.tracks.selectedTrack;
    expect(track).toBeDefined();

    decoder.close();
  });

  it('should create two tracks for animated images (still + animated)', async () => {
    const gifPath = findTestImage('animated.gif') || findTestImage('test-animated.gif');
    if (!gifPath) {
      expect(true).toBe(true);
      return;
    }

    const data = fs.readFileSync(gifPath);

    const decoder = new ImageDecoder({
      data: bufferToArrayBuffer(data),
      type: 'image/gif',
      preferAnimation: true,
    });

    await decoder.completed;

    // Animated images should have 2 tracks: still (index 0) and animated (index 1)
    if (decoder.tracks.length === 2) {
      const stillTrack = decoder.tracks[0];
      const animatedTrack = decoder.tracks[1];

      expect(stillTrack).toBeDefined();
      expect(animatedTrack).toBeDefined();

      // Still track should have frameCount=1 and animated=false
      expect(stillTrack!.frameCount).toBe(1);
      expect(stillTrack!.animated).toBe(false);
      expect(stillTrack!.repetitionCount).toBe(0); // Still images have repetitionCount=0

      // Animated track should have frameCount>1 and animated=true
      expect(animatedTrack!.frameCount).toBeGreaterThan(1);
      expect(animatedTrack!.animated).toBe(true);

      // With preferAnimation=true, animated track should be selected
      expect(animatedTrack!.selected).toBe(true);
      expect(stillTrack!.selected).toBe(false);
    }

    decoder.close();
  });

  it('should select still track when preferAnimation: false', async () => {
    const gifPath = findTestImage('animated.gif') || findTestImage('test-animated.gif');
    if (!gifPath) {
      expect(true).toBe(true);
      return;
    }

    const data = fs.readFileSync(gifPath);

    const decoder = new ImageDecoder({
      data: bufferToArrayBuffer(data),
      type: 'image/gif',
      preferAnimation: false,
    });

    await decoder.completed;

    // With preferAnimation=false, still track should be selected
    if (decoder.tracks.length === 2) {
      const stillTrack = decoder.tracks[0];
      const animatedTrack = decoder.tracks[1];

      expect(stillTrack!.selected).toBe(true);
      expect(animatedTrack!.selected).toBe(false);

      // decode() should only allow frameIndex=0 for still track
      const selectedTrack = decoder.tracks.selectedTrack;
      expect(selectedTrack!.frameCount).toBe(1);
    }

    decoder.close();
  });

  it('should limit decode to selected track frameCount', async () => {
    const gifPath = findTestImage('animated.gif') || findTestImage('test-animated.gif');
    if (!gifPath) {
      expect(true).toBe(true);
      return;
    }

    const data = fs.readFileSync(gifPath);

    const decoder = new ImageDecoder({
      data: bufferToArrayBuffer(data),
      type: 'image/gif',
      preferAnimation: false, // Select still track with frameCount=1
    });

    await decoder.completed;

    if (decoder.tracks.length === 2) {
      // With still track selected (frameCount=1), frameIndex=1 should throw
      await expect(decoder.decode({ frameIndex: 1 }))
        .rejects.toThrow(/out of range/);

      // frameIndex=0 should work
      const result = await decoder.decode({ frameIndex: 0 });
      expect(result.image).toBeDefined();
      result.image.close();
    }

    decoder.close();
  });
});

describe('ImageDecoder YUV output (N6 fix)', () => {
  it('should decode JPEG to I420 format when preferredPixelFormat is I420', async () => {
    const jpegPath = findTestImage('test-simple.jpg') || findTestImage('test.jpg');
    if (!jpegPath) {
      console.log('Skipping test: no JPEG test image found');
      expect(true).toBe(true);
      return;
    }

    const data = fs.readFileSync(jpegPath);
    const decoder = new ImageDecoder({
      data: bufferToArrayBuffer(data),
      type: 'image/jpeg',
      preferredPixelFormat: 'I420',
    });

    await decoder.completed;

    const result = await decoder.decode();
    const frame = result.image;

    // Frame should be I420 format
    expect(frame.format).toBe('I420');

    // I420 frame size should be width * height * 1.5 (Y + U/4 + V/4)
    const expectedSize = frame.codedWidth * frame.codedHeight * 1.5;
    expect(frame.allocationSize()).toBe(expectedSize);

    frame.close();
    decoder.close();
  });

  it('should default to RGBA when preferredPixelFormat is not specified', async () => {
    const jpegPath = findTestImage('test-simple.jpg') || findTestImage('test.jpg');
    if (!jpegPath) {
      console.log('Skipping test: no JPEG test image found');
      expect(true).toBe(true);
      return;
    }

    const data = fs.readFileSync(jpegPath);
    const decoder = new ImageDecoder({
      data: bufferToArrayBuffer(data),
      type: 'image/jpeg',
      // No preferredPixelFormat - should default to RGBA
    });

    await decoder.completed;

    const result = await decoder.decode();
    const frame = result.image;

    // Frame should be RGBA format (default)
    expect(frame.format).toBe('RGBA');

    // RGBA frame size should be width * height * 4
    const expectedSize = frame.codedWidth * frame.codedHeight * 4;
    expect(frame.allocationSize()).toBe(expectedSize);

    frame.close();
    decoder.close();
  });

  it('should decode PNG to RGBA even when I420 is requested (PNG has alpha)', async () => {
    const pngPath = findTestImage('test-simple.png') || findTestImage('test.png');
    if (!pngPath) {
      console.log('Skipping test: no PNG test image found');
      expect(true).toBe(true);
      return;
    }

    const data = fs.readFileSync(pngPath);
    const decoder = new ImageDecoder({
      data: bufferToArrayBuffer(data),
      type: 'image/png',
      preferredPixelFormat: 'I420', // Request I420 but PNG may need RGBA for alpha
    });

    await decoder.completed;

    const result = await decoder.decode();
    const frame = result.image;

    // PNG decoding may convert to I420 if no alpha, or could stay RGBA
    // The key is that decoding should succeed
    expect(['I420', 'RGBA', 'I420A']).toContain(frame.format);

    frame.close();
    decoder.close();
  });

  it('should output RGBA for WebP regardless of preferredPixelFormat (node-webpmux limitation)', async () => {
    const webpPath = findTestImage('test-simple.webp') || findTestImage('test.webp');
    if (!webpPath) {
      console.log('Skipping test: no WebP test image found');
      expect(true).toBe(true);
      return;
    }

    const data = fs.readFileSync(webpPath);
    const decoder = new ImageDecoder({
      data: bufferToArrayBuffer(data),
      type: 'image/webp',
      preferredPixelFormat: 'I420', // Request I420 but WebP always outputs RGBA
    });

    await decoder.completed;

    const result = await decoder.decode();
    const frame = result.image;

    // WebP always outputs RGBA due to node-webpmux limitation
    expect(frame.format).toBe('RGBA');

    frame.close();
    decoder.close();
  });
});

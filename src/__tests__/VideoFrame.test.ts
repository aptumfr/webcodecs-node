/**
 * Tests for VideoFrame class
 */

import { VideoFrame } from '../core/VideoFrame.js';
import { VideoColorSpace } from '../formats/color-space.js';
import { DOMRectReadOnly } from '../types/geometry.js';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import { AudioData } from '../core/AudioData.js';

describe('VideoFrame', () => {
  describe('constructor with BufferSource', () => {
    it('should create a VideoFrame from Uint8Array', () => {
      const width = 4;
      const height = 4;
      const data = new Uint8Array(width * height * 4); // RGBA

      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: 1000,
      });

      expect(frame.format).toBe('RGBA');
      expect(frame.codedWidth).toBe(width);
      expect(frame.codedHeight).toBe(height);
      expect(frame.timestamp).toBe(1000);
      expect(frame.displayWidth).toBe(width);
      expect(frame.displayHeight).toBe(height);

      frame.close();
    });

    it('should create a VideoFrame from ArrayBuffer', () => {
      const width = 4;
      const height = 4;
      const buffer = new ArrayBuffer(width * height * 4);

      const frame = new VideoFrame(buffer, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: 0,
      });

      expect(frame.format).toBe('RGBA');
      expect(frame.codedWidth).toBe(width);
      expect(frame.codedHeight).toBe(height);

      frame.close();
    });

    it('should set duration when provided', () => {
      const data = new Uint8Array(16 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        duration: 33333,
      });

      expect(frame.duration).toBe(33333);
      frame.close();
    });

    it('should set displayWidth and displayHeight when provided', () => {
      const data = new Uint8Array(16 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        displayWidth: 8,
        displayHeight: 8,
      });

      expect(frame.displayWidth).toBe(8);
      expect(frame.displayHeight).toBe(8);
      frame.close();
    });
  });

  describe('constructor with CanvasImageSource', () => {
    it('should create a VideoFrame from canvas-like object', () => {
      // Mock canvas-like object
      const mockCanvas = {
        width: 4,
        height: 4,
        getContext: () => ({
          getImageData: () => ({
            data: new Uint8ClampedArray(4 * 4 * 4),
          }),
        }),
      };

      const frame = new VideoFrame(mockCanvas, {
        timestamp: 1000,
      });

      expect(frame.format).toBe('RGBA');
      expect(frame.codedWidth).toBe(4);
      expect(frame.codedHeight).toBe(4);
      expect(frame.timestamp).toBe(1000);

      frame.close();
    });
  });

  describe('clone', () => {
    it('should create an independent copy', () => {
      const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 2,
        codedHeight: 2,
        timestamp: 1000,
        duration: 100,
      });

      const clone = frame.clone();

      expect(clone.format).toBe(frame.format);
      expect(clone.codedWidth).toBe(frame.codedWidth);
      expect(clone.codedHeight).toBe(frame.codedHeight);
      expect(clone.timestamp).toBe(frame.timestamp);
      expect(clone.duration).toBe(frame.duration);

      // Close original, clone should still work
      frame.close();
      expect(clone.allocationSize()).toBeGreaterThan(0);

      clone.close();
    });
  });

  describe('copyTo', () => {
    it('should copy frame data to destination buffer', async () => {
      const sourceData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      const frame = new VideoFrame(sourceData, {
        format: 'RGBA',
        codedWidth: 2,
        codedHeight: 2,
        timestamp: 0,
      });

      const dest = new Uint8Array(16);
      await frame.copyTo(dest);

      expect(Array.from(dest)).toEqual(Array.from(sourceData));
      frame.close();
    });
  });

  describe('allocationSize', () => {
    it('should return the correct buffer size', () => {
      const width = 8;
      const height = 8;
      const data = new Uint8Array(width * height * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: 0,
      });

      expect(frame.allocationSize()).toBe(width * height * 4);
      frame.close();
    });
  });

  describe('close', () => {
    it('should throw when accessing closed frame', () => {
      const data = new Uint8Array(16);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 2,
        codedHeight: 2,
        timestamp: 0,
      });

      frame.close();

      expect(() => frame.allocationSize()).toThrow('VideoFrame is closed');
    });
  });

  describe('codedRect and visibleRect', () => {
    it('should have correct rect values', () => {
      const data = new Uint8Array(64 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 8,
        codedHeight: 8,
        timestamp: 0,
      });

      expect(frame.codedRect!.x).toBe(0);
      expect(frame.codedRect!.y).toBe(0);
      expect(frame.codedRect!.width).toBe(8);
      expect(frame.codedRect!.height).toBe(8);

      expect(frame.visibleRect!.x).toBe(0);
      expect(frame.visibleRect!.y).toBe(0);
      expect(frame.visibleRect!.width).toBe(8);
      expect(frame.visibleRect!.height).toBe(8);

      frame.close();
    });

    it('should support custom visibleRect', () => {
      const data = new Uint8Array(64 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 8,
        codedHeight: 8,
        timestamp: 0,
        visibleRect: { x: 1, y: 1, width: 6, height: 6 },
      });

      expect(frame.visibleRect!.x).toBe(1);
      expect(frame.visibleRect!.y).toBe(1);
      expect(frame.visibleRect!.width).toBe(6);
      expect(frame.visibleRect!.height).toBe(6);

      frame.close();
    });
  });
});

describe('VideoColorSpace', () => {
  it('should create with default values', () => {
    const colorSpace = new VideoColorSpace();

    expect(colorSpace.primaries).toBeNull();
    expect(colorSpace.transfer).toBeNull();
    expect(colorSpace.matrix).toBeNull();
    expect(colorSpace.fullRange).toBeNull();
  });

  it('should create with provided values', () => {
    const colorSpace = new VideoColorSpace({
      primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'bt709',
      fullRange: true,
    });

    expect(colorSpace.primaries).toBe('bt709');
    expect(colorSpace.transfer).toBe('bt709');
    expect(colorSpace.matrix).toBe('bt709');
    expect(colorSpace.fullRange).toBe(true);
  });

  it('should serialize to JSON', () => {
    const colorSpace = new VideoColorSpace({
      primaries: 'bt709',
      fullRange: false,
    });

    const json = colorSpace.toJSON();

    expect(json.primaries).toBe('bt709');
    expect(json.fullRange).toBe(false);
  });
});

describe('DOMRectReadOnly', () => {
  it('should create with default values', () => {
    const rect = new DOMRectReadOnly();

    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
  });

  it('should create with provided values', () => {
    const rect = new DOMRectReadOnly(10, 20, 100, 200);

    expect(rect.x).toBe(10);
    expect(rect.y).toBe(20);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(200);
  });

  it('should compute derived properties', () => {
    const rect = new DOMRectReadOnly(10, 20, 100, 200);

    expect(rect.top).toBe(20);
    expect(rect.left).toBe(10);
    expect(rect.right).toBe(110);
    expect(rect.bottom).toBe(220);
  });
});

describe('VideoFrame metadata (rotation/flip)', () => {
  it('should return empty metadata by default', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
    });

    const metadata = frame.metadata();
    expect(metadata).toEqual({});
    frame.close();
  });

  it('should store and return rotation in metadata', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 90,
    });

    const metadata = frame.metadata();
    expect(metadata.rotation).toBe(90);
    frame.close();
  });

  it('should store and return flip in metadata', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      flip: true,
    });

    const metadata = frame.metadata();
    expect(metadata.flip).toBe(true);
    frame.close();
  });

  it('should store both rotation and flip', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 180,
      flip: true,
    });

    const metadata = frame.metadata();
    expect(metadata.rotation).toBe(180);
    expect(metadata.flip).toBe(true);
    frame.close();
  });

  it('should not include rotation:0 in metadata', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 0,
    });

    const metadata = frame.metadata();
    expect(metadata.rotation).toBeUndefined();
    frame.close();
  });

  it('should not include flip:false in metadata', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      flip: false,
    });

    const metadata = frame.metadata();
    expect(metadata.flip).toBeUndefined();
    frame.close();
  });

  it('should support all valid rotation values', () => {
    const rotations = [0, 90, 180, 270] as const;
    for (const rotation of rotations) {
      const data = new Uint8Array(16 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        rotation,
      });

      const metadata = frame.metadata();
      if (rotation === 0) {
        expect(metadata.rotation).toBeUndefined();
      } else {
        expect(metadata.rotation).toBe(rotation);
      }
      frame.close();
    }
  });

  it('should inherit rotation/flip when constructing from another VideoFrame', () => {
    const data = new Uint8Array(16 * 4);
    const sourceFrame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 270,
      flip: true,
    });

    const copiedFrame = new VideoFrame(sourceFrame, { timestamp: 1000 });

    const metadata = copiedFrame.metadata();
    expect(metadata.rotation).toBe(270);
    expect(metadata.flip).toBe(true);

    sourceFrame.close();
    copiedFrame.close();
  });

  it('should throw when calling metadata() on closed frame', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 90,
    });

    frame.close();
    expect(() => frame.metadata()).toThrow();
  });
});

describe('VideoFrame colorSpace on closed frames (N13 fix)', () => {
  it('should return colorSpace even after frame is closed', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      colorSpace: {
        primaries: 'bt709',
        transfer: 'bt709',
        matrix: 'rgb',
        fullRange: true,
      },
    });

    frame.close();

    // colorSpace should still be accessible after close (like timestamp/duration)
    expect(frame.colorSpace).toBeDefined();
    expect(frame.colorSpace!.primaries).toBe('bt709');
    expect(frame.colorSpace!.transfer).toBe('bt709');
  });

  it('should return default colorSpace after close for RGBA', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
    });

    frame.close();

    // Default sRGB colorSpace for RGBA should still be accessible
    expect(frame.colorSpace).toBeDefined();
    expect(frame.colorSpace!.primaries).toBe('bt709');
  });
});

describe('VideoFrame rotation/flip getters (N1 fix)', () => {
  it('should expose rotation getter', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 90,
    });

    expect(frame.rotation).toBe(90);
    frame.close();
  });

  it('should expose flip getter', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      flip: true,
    });

    expect(frame.flip).toBe(true);
    frame.close();
  });

  it('should preserve rotation after close', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 180,
    });

    frame.close();
    expect(frame.rotation).toBe(180);
  });

  it('should preserve flip after close', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      flip: true,
    });

    frame.close();
    expect(frame.flip).toBe(true);
  });

  it('should default rotation to 0', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
    });

    expect(frame.rotation).toBe(0);
    frame.close();
  });

  it('should default flip to false', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
    });

    expect(frame.flip).toBe(false);
    frame.close();
  });
});

describe('VideoFrame clone preserves rotation/flip (N1 fix)', () => {
  it('should preserve rotation when cloning', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 270,
    });

    const clone = frame.clone();
    expect(clone.rotation).toBe(270);

    frame.close();
    clone.close();
  });

  it('should preserve flip when cloning', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      flip: true,
    });

    const clone = frame.clone();
    expect(clone.flip).toBe(true);

    frame.close();
    clone.close();
  });

  it('should preserve both rotation and flip when cloning', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 90,
      flip: true,
    });

    const clone = frame.clone();
    expect(clone.rotation).toBe(90);
    expect(clone.flip).toBe(true);

    frame.close();
    clone.close();
  });
});

describe('VideoFrame displayWidth/Height swap for 90/270 rotation (N1 fix)', () => {
  it('should swap displayWidth/Height for 90 degree rotation', () => {
    const data = new Uint8Array(8 * 4 * 4); // 8x4 RGBA
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 8,
      codedHeight: 4,
      timestamp: 0,
      rotation: 90,
    });

    // For 90 degree rotation, display dimensions should be swapped
    expect(frame.displayWidth).toBe(4); // was height
    expect(frame.displayHeight).toBe(8); // was width

    frame.close();
  });

  it('should swap displayWidth/Height for 270 degree rotation', () => {
    const data = new Uint8Array(8 * 4 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 8,
      codedHeight: 4,
      timestamp: 0,
      rotation: 270,
    });

    expect(frame.displayWidth).toBe(4);
    expect(frame.displayHeight).toBe(8);

    frame.close();
  });

  it('should not swap displayWidth/Height for 0 degree rotation', () => {
    const data = new Uint8Array(8 * 4 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 8,
      codedHeight: 4,
      timestamp: 0,
      rotation: 0,
    });

    expect(frame.displayWidth).toBe(8);
    expect(frame.displayHeight).toBe(4);

    frame.close();
  });

  it('should not swap displayWidth/Height for 180 degree rotation', () => {
    const data = new Uint8Array(8 * 4 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 8,
      codedHeight: 4,
      timestamp: 0,
      rotation: 180,
    });

    expect(frame.displayWidth).toBe(8);
    expect(frame.displayHeight).toBe(4);

    frame.close();
  });

  it('should use explicit displayWidth/Height over defaults', () => {
    const data = new Uint8Array(8 * 4 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 8,
      codedHeight: 4,
      timestamp: 0,
      rotation: 90,
      displayWidth: 16,
      displayHeight: 8,
    });

    // Explicit values should override the swap
    expect(frame.displayWidth).toBe(16);
    expect(frame.displayHeight).toBe(8);

    frame.close();
  });
});

describe('VideoFrame validation (N3 fix)', () => {
  it('should reject unknown pixel format', () => {
    const data = new Uint8Array(16 * 4);
    expect(() => {
      new VideoFrame(data, {
        format: 'UNKNOWN' as any,
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
      });
    }).toThrow('Unknown pixel format');
  });

  it('should reject non-finite codedWidth', () => {
    const data = new Uint8Array(16 * 4);
    expect(() => {
      new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: Infinity,
        codedHeight: 4,
        timestamp: 0,
      });
    }).toThrow('codedWidth must be a finite positive number');
  });

  it('should reject NaN codedHeight', () => {
    const data = new Uint8Array(16 * 4);
    expect(() => {
      new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: NaN,
        timestamp: 0,
      });
    }).toThrow('codedHeight must be a finite positive number');
  });

  it('should reject non-finite timestamp', () => {
    const data = new Uint8Array(16 * 4);
    expect(() => {
      new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: Infinity,
      });
    }).toThrow('timestamp must be a finite number');
  });

  it('should reject odd dimensions for I420 format', () => {
    const data = new Uint8Array(5 * 5 * 1.5); // I420 needs 1.5 bytes per pixel
    expect(() => {
      new VideoFrame(data, {
        format: 'I420',
        codedWidth: 5,
        codedHeight: 5,
        timestamp: 0,
      });
    }).toThrow('I420 format requires even dimensions');
  });

  it('should reject odd width for I422 format', () => {
    const data = new Uint8Array(5 * 4 * 2); // I422 needs 2 bytes per pixel
    expect(() => {
      new VideoFrame(data, {
        format: 'I422',
        codedWidth: 5,
        codedHeight: 4,
        timestamp: 0,
      });
    }).toThrow('I422 format requires even width');
  });

  it('should accept even dimensions for I420 format', () => {
    // I420: Y plane = 4*4, U plane = 2*2, V plane = 2*2 = 16+4+4 = 24 bytes
    const data = new Uint8Array(24);
    const frame = new VideoFrame(data, {
      format: 'I420',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
    });

    expect(frame.format).toBe('I420');
    frame.close();
  });

  it('should reject visibleRect that exceeds coded dimensions', () => {
    const data = new Uint8Array(16 * 4);
    expect(() => {
      new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        visibleRect: { x: 0, y: 0, width: 8, height: 4 },
      });
    }).toThrow('visibleRect');
  });

  it('should reject visibleRect with negative origin', () => {
    const data = new Uint8Array(16 * 4);
    expect(() => {
      new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        visibleRect: { x: -1, y: 0, width: 4, height: 4 },
      });
    }).toThrow('visibleRect');
  });

  it('should reject non-finite displayWidth', () => {
    const data = new Uint8Array(16 * 4);
    expect(() => {
      new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        displayWidth: NaN,
      });
    }).toThrow('displayWidth must be a finite positive number');
  });
});

describe('12-bit pixel formats (N5 fix)', () => {
  it('should accept I420P12 format', () => {
    // I420P12: 2 bytes per sample, same layout as I420P10
    // Y plane = 4*4*2 = 32, U = 2*2*2 = 8, V = 2*2*2 = 8, total = 48
    const data = new Uint8Array(48);
    const frame = new VideoFrame(data, {
      format: 'I420P12',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
    });

    expect(frame.format).toBe('I420P12');
    frame.close();
  });

  it('should accept I422P12 format', () => {
    // I422P12: Y = 4*4*2 = 32, U = 2*4*2 = 16, V = 2*4*2 = 16, total = 64
    const data = new Uint8Array(64);
    const frame = new VideoFrame(data, {
      format: 'I422P12',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
    });

    expect(frame.format).toBe('I422P12');
    frame.close();
  });

  it('should accept I444P12 format', () => {
    // I444P12: Y = 4*4*2, U = 4*4*2, V = 4*4*2, total = 96
    const data = new Uint8Array(96);
    const frame = new VideoFrame(data, {
      format: 'I444P12',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
    });

    expect(frame.format).toBe('I444P12');
    frame.close();
  });

  it('should reject odd dimensions for I420P12', () => {
    const data = new Uint8Array(100);
    expect(() => {
      new VideoFrame(data, {
        format: 'I420P12',
        codedWidth: 5,
        codedHeight: 5,
        timestamp: 0,
      });
    }).toThrow('I420P12 format requires even dimensions');
  });
});

describe('copyTo colorSpace option (N14 fix)', () => {
  it('should accept colorSpace option in copyTo', async () => {
    // Create I420 frame (YUV)
    const width = 4;
    const height = 4;
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);
    const data = new Uint8Array(ySize + uvSize * 2);
    // Fill with gray (Y=128, U=128, V=128)
    data.fill(128, 0, ySize);
    data.fill(128, ySize, ySize + uvSize * 2);

    const frame = new VideoFrame(data, {
      format: 'I420',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
      colorSpace: { matrix: 'bt709' },
    });

    // Copy to RGBA with explicit bt709 colorSpace
    const dest = new Uint8Array(width * height * 4);
    await frame.copyTo(dest, {
      format: 'RGBA',
      colorSpace: { matrix: 'bt709' },
    });

    // Should produce gray pixels (approximately 128 for R, G, B)
    expect(dest[0]).toBeGreaterThan(100);
    expect(dest[0]).toBeLessThan(160);

    frame.close();
  });

  it('should use frame colorSpace when options.colorSpace not provided', async () => {
    const width = 4;
    const height = 4;
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);
    const data = new Uint8Array(ySize + uvSize * 2);
    data.fill(128, 0, ySize);
    data.fill(128, ySize, ySize + uvSize * 2);

    const frame = new VideoFrame(data, {
      format: 'I420',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
      colorSpace: { matrix: 'bt601' },
    });

    // Copy to RGBA without explicit colorSpace - should use frame's bt601
    const dest = new Uint8Array(width * height * 4);
    await frame.copyTo(dest, { format: 'RGBA' });

    // Should still produce valid gray pixels
    expect(dest[0]).toBeGreaterThan(100);
    expect(dest[0]).toBeLessThan(160);

    frame.close();
  });

  it('should use different color matrices for conversion', async () => {
    // Create I420 frame with colored Y, U, V values
    const width = 4;
    const height = 4;
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);
    const data = new Uint8Array(ySize + uvSize * 2);
    // Set Y=200 (bright), U=80 (shift towards blue), V=170 (shift towards red)
    data.fill(200, 0, ySize);
    data.fill(80, ySize, ySize + uvSize);
    data.fill(170, ySize + uvSize, ySize + uvSize * 2);

    const frameBt709 = new VideoFrame(data, {
      format: 'I420',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
      colorSpace: { matrix: 'bt709' },
    });

    const frameBt601 = new VideoFrame(data.slice(), {
      format: 'I420',
      codedWidth: width,
      codedHeight: height,
      timestamp: 1000,
      colorSpace: { matrix: 'bt601' },
    });

    const dest709 = new Uint8Array(width * height * 4);
    const dest601 = new Uint8Array(width * height * 4);

    await frameBt709.copyTo(dest709, { format: 'RGBA' });
    await frameBt601.copyTo(dest601, { format: 'RGBA' });

    // BT.709 and BT.601 have different conversion coefficients
    // so the RGB values should differ (at least slightly for non-gray colors)
    // The differences are more pronounced for saturated colors
    const hasAnyDifference =
      dest709[0] !== dest601[0] || // R
      dest709[1] !== dest601[1] || // G
      dest709[2] !== dest601[2];   // B

    expect(hasAnyDifference).toBe(true);

    frameBt709.close();
    frameBt601.close();
  });

  it('should override frame colorSpace with options colorSpace', async () => {
    const width = 4;
    const height = 4;
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);
    const data = new Uint8Array(ySize + uvSize * 2);
    data.fill(200, 0, ySize);
    data.fill(80, ySize, ySize + uvSize);
    data.fill(170, ySize + uvSize, ySize + uvSize * 2);

    // Frame has bt709
    const frame = new VideoFrame(data, {
      format: 'I420',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
      colorSpace: { matrix: 'bt709' },
    });

    // Copy with frame's bt709
    const destFrameCs = new Uint8Array(width * height * 4);
    await frame.copyTo(destFrameCs, { format: 'RGBA' });

    // Copy with overridden bt601
    const destOverride = new Uint8Array(width * height * 4);
    await frame.copyTo(destOverride, {
      format: 'RGBA',
      colorSpace: { matrix: 'bt601' },
    });

    // Override should produce different values
    const hasAnyDifference =
      destFrameCs[0] !== destOverride[0] ||
      destFrameCs[1] !== destOverride[1] ||
      destFrameCs[2] !== destOverride[2];

    expect(hasAnyDifference).toBe(true);

    frame.close();
  });
});

describe('VideoFrame orientation composition (N1 fix)', () => {
  it('should compose rotations when wrapping a VideoFrame', () => {
    const data = new Uint8Array(16 * 4);
    const source = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 90,
    });

    // Wrap with additional 90 degree rotation
    const wrapped = new VideoFrame(source, {
      timestamp: 0,
      rotation: 90,
    });

    // 90 + 90 = 180
    expect(wrapped.rotation).toBe(180);
    expect(wrapped.flip).toBe(false);

    source.close();
    wrapped.close();
  });

  it('should compose rotations with wrap-around (270 + 180 = 90)', () => {
    const data = new Uint8Array(16 * 4);
    const source = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 270,
    });

    const wrapped = new VideoFrame(source, {
      timestamp: 0,
      rotation: 180,
    });

    // (270 + 180) % 360 = 90
    expect(wrapped.rotation).toBe(90);

    source.close();
    wrapped.close();
  });

  it('should compose flips (flip XOR flip = no flip)', () => {
    const data = new Uint8Array(16 * 4);
    const source = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      flip: true,
    });

    const wrapped = new VideoFrame(source, {
      timestamp: 0,
      flip: true,
    });

    // flip XOR flip = false
    expect(wrapped.flip).toBe(false);

    source.close();
    wrapped.close();
  });

  it('should compose rotation with flip (flip negates rotation direction)', () => {
    const data = new Uint8Array(16 * 4);
    const source = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 90,
      flip: true,
    });

    // When source has flip, additional rotation is subtracted
    const wrapped = new VideoFrame(source, {
      timestamp: 0,
      rotation: 90,
    });

    // 90 - 90 = 0 (flip negates rotation direction)
    expect(wrapped.rotation).toBe(0);
    expect(wrapped.flip).toBe(true);

    source.close();
    wrapped.close();
  });

  it('should inherit source orientation when init has none', () => {
    const data = new Uint8Array(16 * 4);
    const source = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      rotation: 180,
      flip: true,
    });

    const wrapped = new VideoFrame(source, {
      timestamp: 0,
    });

    expect(wrapped.rotation).toBe(180);
    expect(wrapped.flip).toBe(true);

    source.close();
    wrapped.close();
  });
});

describe('VideoFrame duration and rotation validation (N3 fix)', () => {
  it('should reject non-finite duration', () => {
    const data = new Uint8Array(16 * 4);
    expect(() => {
      new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        duration: Infinity,
      });
    }).toThrow('duration must be a finite non-negative number');
  });

  it('should reject negative duration', () => {
    const data = new Uint8Array(16 * 4);
    expect(() => {
      new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        duration: -100,
      });
    }).toThrow('duration must be a finite non-negative number');
  });

  it('should reject invalid rotation value', () => {
    const data = new Uint8Array(16 * 4);
    expect(() => {
      new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        rotation: 45 as any,
      });
    }).toThrow('rotation must be 0, 90, 180, or 270');
  });

  it('should accept valid rotation values', () => {
    const data = new Uint8Array(16 * 4);

    for (const rotation of [0, 90, 180, 270] as const) {
      const frame = new VideoFrame(data.slice(), {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        rotation,
      });
      expect(frame.rotation).toBe(rotation);
      frame.close();
    }
  });

  it('should accept zero duration', () => {
    const data = new Uint8Array(16 * 4);
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      duration: 0,
    });
    expect(frame.duration).toBe(0);
    frame.close();
  });
});

describe('VideoFrame transfer semantics (N4 fix)', () => {
  it('should accept transfer option', () => {
    const buffer = new ArrayBuffer(16 * 4);
    const data = new Uint8Array(buffer);

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      transfer: [buffer],
    });

    expect(frame.format).toBe('RGBA');
    // Buffer should be detached after transfer (if supported by runtime)
    // In Node.js 22+ with ArrayBuffer.transfer, byteLength becomes 0
    if (typeof (ArrayBuffer.prototype as any).transfer === 'function' ||
        typeof structuredClone === 'function') {
      expect(buffer.byteLength).toBe(0);
    }

    frame.close();
  });

  it('should reject already detached buffer in transfer list', () => {
    const buffer = new ArrayBuffer(16 * 4);

    // Detach the buffer first using structuredClone
    if (typeof structuredClone === 'function') {
      try {
        structuredClone(buffer, { transfer: [buffer] });
      } catch {
        // If structuredClone transfer fails, skip this test
        return;
      }

      const data = new Uint8Array(16 * 4); // Use a different buffer for data
      expect(() => {
        new VideoFrame(data, {
          format: 'RGBA',
          codedWidth: 4,
          codedHeight: 4,
          timestamp: 0,
          transfer: [buffer],
        });
      }).toThrow('Cannot transfer a detached ArrayBuffer');
    }
  });

  it('should reject non-ArrayBuffer in transfer list', () => {
    const data = new Uint8Array(16 * 4);
    expect(() => {
      new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        transfer: [data as any], // Uint8Array, not ArrayBuffer
      });
    }).toThrow('transfer list must only contain ArrayBuffer objects');
  });

  it('should copy data before detaching transfer buffers', () => {
    const buffer = new ArrayBuffer(16 * 4);
    const data = new Uint8Array(buffer);
    // Fill with recognizable pattern
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 4,
      codedHeight: 4,
      timestamp: 0,
      transfer: [buffer],
    });

    // Frame should have copied the data before transfer
    const output = new Uint8Array(16 * 4);
    frame.copyTo(output);

    // Verify the pattern was preserved
    for (let i = 0; i < output.length; i++) {
      expect(output[i]).toBe(i % 256);
    }

    frame.close();
  });
});

describe('EncodedVideoChunk transfer semantics (P0.3)', () => {
  it('should accept transfer option', () => {
    const buffer = new ArrayBuffer(100);
    const data = new Uint8Array(buffer);
    for (let i = 0; i < data.length; i++) data[i] = i;

    const chunk = new EncodedVideoChunk({
      type: 'key',
      timestamp: 0,
      data,
      transfer: [buffer],
    });

    expect(chunk.byteLength).toBe(100);
    // Buffer should be detached
    if (typeof structuredClone === 'function') {
      expect(buffer.byteLength).toBe(0);
    }
  });

  it('should reject already detached buffer in transfer list', () => {
    const buffer = new ArrayBuffer(100);

    if (typeof structuredClone === 'function') {
      try {
        structuredClone(buffer, { transfer: [buffer] });
      } catch {
        return; // Skip if transfer not supported
      }

      const data = new Uint8Array(100);
      expect(() => {
        new EncodedVideoChunk({
          type: 'key',
          timestamp: 0,
          data,
          transfer: [buffer],
        });
      }).toThrow('Cannot transfer a detached ArrayBuffer');
    }
  });

  it('should copy data before detaching transfer buffers', () => {
    const buffer = new ArrayBuffer(100);
    const data = new Uint8Array(buffer);
    for (let i = 0; i < data.length; i++) data[i] = i;

    const chunk = new EncodedVideoChunk({
      type: 'key',
      timestamp: 0,
      data,
      transfer: [buffer],
    });

    // Verify data was copied
    const output = new Uint8Array(100);
    chunk.copyTo(output);
    for (let i = 0; i < output.length; i++) {
      expect(output[i]).toBe(i);
    }
  });

  it('should reject duplicate buffers in transfer list with DataCloneError', () => {
    const buffer = new ArrayBuffer(100);
    const data = new Uint8Array(buffer);

    expect(() => {
      new EncodedVideoChunk({
        type: 'key',
        timestamp: 0,
        data,
        transfer: [buffer, buffer], // Same buffer twice
      });
    }).toThrow('Duplicate ArrayBuffer in transfer list');
  });
});

describe('EncodedAudioChunk transfer semantics (P0.3)', () => {
  it('should accept transfer option', () => {
    const buffer = new ArrayBuffer(100);
    const data = new Uint8Array(buffer);
    for (let i = 0; i < data.length; i++) data[i] = i;

    const chunk = new EncodedAudioChunk({
      type: 'key',
      timestamp: 0,
      data,
      transfer: [buffer],
    });

    expect(chunk.byteLength).toBe(100);
  });

  it('should copy data before transfer', () => {
    const buffer = new ArrayBuffer(100);
    const data = new Uint8Array(buffer);
    for (let i = 0; i < data.length; i++) data[i] = i;

    const chunk = new EncodedAudioChunk({
      type: 'key',
      timestamp: 0,
      data,
      transfer: [buffer],
    });

    const output = new Uint8Array(100);
    chunk.copyTo(output);
    for (let i = 0; i < output.length; i++) {
      expect(output[i]).toBe(i);
    }
  });

  it('should reject duplicate buffers in transfer list with DataCloneError', () => {
    const buffer = new ArrayBuffer(100);
    const data = new Uint8Array(buffer);

    expect(() => {
      new EncodedAudioChunk({
        type: 'key',
        timestamp: 0,
        data,
        transfer: [buffer, buffer], // Same buffer twice
      });
    }).toThrow('Duplicate ArrayBuffer in transfer list');
  });

  it('should reject detached buffer in transfer list', () => {
    const buffer = new ArrayBuffer(100);
    const data = new Uint8Array(100); // Different buffer for data

    if (typeof structuredClone === 'function') {
      try {
        structuredClone(buffer, { transfer: [buffer] });
      } catch {
        return; // Skip if transfer not supported
      }

      expect(() => {
        new EncodedAudioChunk({
          type: 'key',
          timestamp: 0,
          data,
          transfer: [buffer],
        });
      }).toThrow('Cannot transfer a detached ArrayBuffer');
    }
  });
});

describe('AudioData transfer semantics (P0.3)', () => {
  it('should accept transfer option', () => {
    const buffer = new ArrayBuffer(960 * 4); // 960 samples * 4 bytes
    const data = new Float32Array(buffer);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.1);

    const audio = new AudioData({
      format: 'f32',
      sampleRate: 48000,
      numberOfChannels: 1,
      numberOfFrames: 960,
      timestamp: 0,
      data,
      transfer: [buffer],
    });

    expect(audio.numberOfFrames).toBe(960);
    audio.close();
  });

  it('should copy data before transfer', () => {
    const buffer = new ArrayBuffer(960 * 4);
    const data = new Float32Array(buffer);
    for (let i = 0; i < data.length; i++) data[i] = 0.5;

    const audio = new AudioData({
      format: 'f32',
      sampleRate: 48000,
      numberOfChannels: 1,
      numberOfFrames: 960,
      timestamp: 0,
      data,
      transfer: [buffer],
    });

    // Verify data was copied by reading it back
    const output = new Float32Array(960);
    audio.copyTo(output, { planeIndex: 0 });
    expect(output[0]).toBeCloseTo(0.5, 5);

    audio.close();
  });

  it('should reject duplicate buffers in transfer list with DataCloneError', () => {
    const buffer = new ArrayBuffer(960 * 4);
    const data = new Float32Array(buffer);

    expect(() => {
      new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfChannels: 1,
        numberOfFrames: 960,
        timestamp: 0,
        data,
        transfer: [buffer, buffer], // Same buffer twice
      });
    }).toThrow('Duplicate ArrayBuffer in transfer list');
  });

  it('should reject detached buffer in transfer list', () => {
    const buffer = new ArrayBuffer(960 * 4);
    const data = new Float32Array(960); // Different buffer

    if (typeof structuredClone === 'function') {
      try {
        structuredClone(buffer, { transfer: [buffer] });
      } catch {
        return; // Skip if transfer not supported
      }

      expect(() => {
        new AudioData({
          format: 'f32',
          sampleRate: 48000,
          numberOfChannels: 1,
          numberOfFrames: 960,
          timestamp: 0,
          data,
          transfer: [buffer],
        });
      }).toThrow('Cannot transfer a detached ArrayBuffer');
    }
  });
});

describe('VideoFrame alpha formats (P1.4)', () => {
  it('should construct I420A frame with alpha channel', () => {
    const width = 4;
    const height = 4;
    // I420A: Y (16) + U (4) + V (4) + A (16) = 40 bytes
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);
    const data = new Uint8Array(ySize + uvSize * 2 + ySize);

    // Y plane (brightness)
    for (let i = 0; i < ySize; i++) data[i] = 128;
    // U plane
    for (let i = 0; i < uvSize; i++) data[ySize + i] = 128;
    // V plane
    for (let i = 0; i < uvSize; i++) data[ySize + uvSize + i] = 128;
    // A plane (alpha)
    for (let i = 0; i < ySize; i++) data[ySize + uvSize * 2 + i] = 255;

    const frame = new VideoFrame(data, {
      format: 'I420A',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.format).toBe('I420A');
    expect(frame.codedWidth).toBe(width);
    expect(frame.codedHeight).toBe(height);
    expect(frame.numberOfPlanes).toBe(4); // Y, U, V, A

    frame.close();
  });

  it('should have correct allocation size for I420A', () => {
    const width = 4;
    const height = 4;
    // I420A: Y (16) + U (4) + V (4) + A (16) = 40 bytes
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);
    const expectedSize = ySize + uvSize * 2 + ySize;
    const data = new Uint8Array(expectedSize);

    const frame = new VideoFrame(data, {
      format: 'I420A',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.allocationSize()).toBe(expectedSize);

    frame.close();
  });

  it('should copyTo with I420A format preserving alpha', async () => {
    const width = 4;
    const height = 4;
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);
    const data = new Uint8Array(ySize + uvSize * 2 + ySize);

    // Fill with recognizable values
    for (let i = 0; i < ySize; i++) data[i] = 100;           // Y
    for (let i = 0; i < uvSize; i++) data[ySize + i] = 50;   // U
    for (let i = 0; i < uvSize; i++) data[ySize + uvSize + i] = 200; // V
    for (let i = 0; i < ySize; i++) data[ySize + uvSize * 2 + i] = 128; // A

    const frame = new VideoFrame(data, {
      format: 'I420A',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    const output = new Uint8Array(ySize + uvSize * 2 + ySize);
    await frame.copyTo(output);

    // Verify Y plane
    expect(output[0]).toBe(100);
    // Verify U plane
    expect(output[ySize]).toBe(50);
    // Verify V plane
    expect(output[ySize + uvSize]).toBe(200);
    // Verify A plane
    expect(output[ySize + uvSize * 2]).toBe(128);

    frame.close();
  });

  it('should reject I420A with odd dimensions (subsampling)', () => {
    const data = new Uint8Array(100);
    expect(() => {
      new VideoFrame(data, {
        format: 'I420A',
        codedWidth: 5, // Odd width
        codedHeight: 4,
        timestamp: 0,
      });
    }).toThrow(); // Should throw due to subsampling alignment
  });
});

describe('VideoFrame 10-bit/12-bit formats (P1.4)', () => {
  it('should construct I420P10 frame (10-bit)', () => {
    const width = 4;
    const height = 4;
    // I420P10: 2 bytes per sample
    // Y: 4*4*2 = 32, U: 2*2*2 = 8, V: 2*2*2 = 8, total = 48
    const data = new Uint8Array(48);

    const frame = new VideoFrame(data, {
      format: 'I420P10',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.format).toBe('I420P10');
    expect(frame.numberOfPlanes).toBe(3);

    frame.close();
  });

  it('should construct I422P10 frame (10-bit 4:2:2)', () => {
    const width = 4;
    const height = 4;
    // I422P10: Y: 4*4*2 = 32, U: 2*4*2 = 16, V: 2*4*2 = 16, total = 64
    const data = new Uint8Array(64);

    const frame = new VideoFrame(data, {
      format: 'I422P10',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.format).toBe('I422P10');
    expect(frame.numberOfPlanes).toBe(3);

    frame.close();
  });

  it('should construct I444P10 frame (10-bit 4:4:4)', () => {
    const width = 4;
    const height = 4;
    // I444P10: Y: 4*4*2 = 32, U: 4*4*2 = 32, V: 4*4*2 = 32, total = 96
    const data = new Uint8Array(96);

    const frame = new VideoFrame(data, {
      format: 'I444P10',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.format).toBe('I444P10');
    expect(frame.numberOfPlanes).toBe(3);

    frame.close();
  });

  it('should construct P010 frame (10-bit NV12-like)', () => {
    const width = 4;
    const height = 4;
    // P010: Y: 4*4*2 = 32, UV: 4*2*2 = 16, total = 48
    const data = new Uint8Array(48);

    const frame = new VideoFrame(data, {
      format: 'P010',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.format).toBe('P010');
    expect(frame.numberOfPlanes).toBe(2);

    frame.close();
  });

  it('should clone 10-bit frame correctly', () => {
    const width = 4;
    const height = 4;
    const data = new Uint8Array(48);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;

    const frame = new VideoFrame(data, {
      format: 'I420P10',
      codedWidth: width,
      codedHeight: height,
      timestamp: 1000,
    });

    const cloned = frame.clone();

    expect(cloned.format).toBe('I420P10');
    expect(cloned.codedWidth).toBe(width);
    expect(cloned.codedHeight).toBe(height);
    expect(cloned.timestamp).toBe(1000);

    frame.close();
    cloned.close();
  });
});

describe('VideoFrame high-bit-depth alpha formats', () => {
  it('should construct I420AP10 frame (10-bit with alpha)', () => {
    const width = 4;
    const height = 4;
    // I420AP10: 2 bytes per sample, 4 planes (Y, U, V, A)
    // Y: 4*4*2 = 32, U: 2*2*2 = 8, V: 2*2*2 = 8, A: 4*4*2 = 32, total = 80
    const ySize = width * height * 2;
    const uvSize = (width / 2) * (height / 2) * 2;
    const aSize = width * height * 2;
    const data = new Uint8Array(ySize + uvSize * 2 + aSize);

    const frame = new VideoFrame(data, {
      format: 'I420AP10',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.format).toBe('I420AP10');
    expect(frame.numberOfPlanes).toBe(4); // Y, U, V, A

    frame.close();
  });

  it('should construct I420AP12 frame (12-bit with alpha)', () => {
    const width = 4;
    const height = 4;
    // I420AP12: same size as I420AP10 (16-bit container)
    const ySize = width * height * 2;
    const uvSize = (width / 2) * (height / 2) * 2;
    const aSize = width * height * 2;
    const data = new Uint8Array(ySize + uvSize * 2 + aSize);

    const frame = new VideoFrame(data, {
      format: 'I420AP12',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.format).toBe('I420AP12');
    expect(frame.numberOfPlanes).toBe(4);

    frame.close();
  });

  it('should construct I422A frame (8-bit 4:2:2 with alpha)', () => {
    const width = 4;
    const height = 4;
    // I422A: Y: 4*4 = 16, U: 2*4 = 8, V: 2*4 = 8, A: 4*4 = 16, total = 48
    const ySize = width * height;
    const uvSize = (width / 2) * height;
    const aSize = width * height;
    const data = new Uint8Array(ySize + uvSize * 2 + aSize);

    const frame = new VideoFrame(data, {
      format: 'I422A',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.format).toBe('I422A');
    expect(frame.numberOfPlanes).toBe(4);

    frame.close();
  });

  it('should construct I444A frame (8-bit 4:4:4 with alpha)', () => {
    const width = 4;
    const height = 4;
    // I444A: Y: 16, U: 16, V: 16, A: 16, total = 64
    const planeSize = width * height;
    const data = new Uint8Array(planeSize * 4);

    const frame = new VideoFrame(data, {
      format: 'I444A',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.format).toBe('I444A');
    expect(frame.numberOfPlanes).toBe(4);

    frame.close();
  });

  it('should construct I422AP10 frame (10-bit 4:2:2 with alpha)', () => {
    const width = 4;
    const height = 4;
    // I422AP10: 2 bytes per sample
    // Y: 4*4*2 = 32, U: 2*4*2 = 16, V: 2*4*2 = 16, A: 4*4*2 = 32, total = 96
    const ySize = width * height * 2;
    const uvSize = (width / 2) * height * 2;
    const aSize = width * height * 2;
    const data = new Uint8Array(ySize + uvSize * 2 + aSize);

    const frame = new VideoFrame(data, {
      format: 'I422AP10',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.format).toBe('I422AP10');
    expect(frame.numberOfPlanes).toBe(4);

    frame.close();
  });

  it('should construct I444AP10 frame (10-bit 4:4:4 with alpha)', () => {
    const width = 4;
    const height = 4;
    // I444AP10: 2 bytes per sample, 4 planes all full size
    // Y: 32, U: 32, V: 32, A: 32, total = 128
    const planeSize = width * height * 2;
    const data = new Uint8Array(planeSize * 4);

    const frame = new VideoFrame(data, {
      format: 'I444AP10',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });

    expect(frame.format).toBe('I444AP10');
    expect(frame.numberOfPlanes).toBe(4);

    frame.close();
  });

  it('should correctly calculate allocation size for alpha 10-bit formats', () => {
    const width = 4;
    const height = 4;

    // I420AP10: (16 + 4 + 4 + 16) * 2 = 80
    const i420a10Size = (width * height * 2 + 2 * (width / 2) * (height / 2)) * 2;
    const i420a10Data = new Uint8Array(i420a10Size);
    const i420a10Frame = new VideoFrame(i420a10Data, {
      format: 'I420AP10',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });
    expect(i420a10Frame.allocationSize()).toBe(i420a10Size);
    i420a10Frame.close();

    // I444AP10: 4 planes all full size at 2 bytes = 4*4*4*2 = 128
    const i444a10Size = width * height * 4 * 2;
    const i444a10Data = new Uint8Array(i444a10Size);
    const i444a10Frame = new VideoFrame(i444a10Data, {
      format: 'I444AP10',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
    });
    expect(i444a10Frame.allocationSize()).toBe(i444a10Size);
    i444a10Frame.close();
  });
});

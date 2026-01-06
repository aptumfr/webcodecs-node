/**
 * VideoFrame plane layout utilities
 */

import type { PlaneLayout } from '../../types/index.js';
import type { VideoPixelFormat } from '../../types/video.js';

/**
 * Get plane layout for a given frame size and format
 */
export function getPlaneLayoutForSize(
  width: number,
  height: number,
  format: VideoPixelFormat
): PlaneLayout[] {
  const chromaW = Math.ceil(width / 2);
  const chromaH = Math.ceil(height / 2);

  switch (format) {
    case 'I420': {
      const ySize = width * height;
      const uvSize = chromaW * chromaH;
      return [
        { offset: 0, stride: width },
        { offset: ySize, stride: chromaW },
        { offset: ySize + uvSize, stride: chromaW },
      ];
    }
    case 'I420A': {
      const ySize = width * height;
      const uvSize = chromaW * chromaH;
      return [
        { offset: 0, stride: width },
        { offset: ySize, stride: chromaW },
        { offset: ySize + uvSize, stride: chromaW },
        { offset: ySize + 2 * uvSize, stride: width },
      ];
    }
    case 'I422': {
      const ySize = width * height;
      const uvSize = chromaW * height;
      return [
        { offset: 0, stride: width },
        { offset: ySize, stride: chromaW },
        { offset: ySize + uvSize, stride: chromaW },
      ];
    }
    case 'I444': {
      const planeSize = width * height;
      return [
        { offset: 0, stride: width },
        { offset: planeSize, stride: width },
        { offset: 2 * planeSize, stride: width },
      ];
    }
    case 'NV12': {
      const ySize = width * height;
      return [
        { offset: 0, stride: width },
        { offset: ySize, stride: width },
      ];
    }
    // 10-bit formats: 2 bytes per sample
    case 'I420P10': {
      const ySize = width * height * 2;
      const uvSize = chromaW * chromaH * 2;
      return [
        { offset: 0, stride: width * 2 },
        { offset: ySize, stride: chromaW * 2 },
        { offset: ySize + uvSize, stride: chromaW * 2 },
      ];
    }
    case 'I422P10': {
      const ySize = width * height * 2;
      const uvSize = chromaW * height * 2;
      return [
        { offset: 0, stride: width * 2 },
        { offset: ySize, stride: chromaW * 2 },
        { offset: ySize + uvSize, stride: chromaW * 2 },
      ];
    }
    case 'I444P10': {
      const planeSize = width * height * 2;
      return [
        { offset: 0, stride: width * 2 },
        { offset: planeSize, stride: width * 2 },
        { offset: 2 * planeSize, stride: width * 2 },
      ];
    }
    case 'P010': {
      const ySize = width * height * 2;
      return [
        { offset: 0, stride: width * 2 },
        { offset: ySize, stride: width * 2 },
      ];
    }
    case 'RGBA':
    case 'RGBX':
    case 'BGRA':
    case 'BGRX':
      return [{ offset: 0, stride: width * 4 }];
    default:
      return [{ offset: 0, stride: width * 4 }];
  }
}

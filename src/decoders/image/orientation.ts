/**
 * EXIF orientation parsing and image transformation
 */

/**
 * Parse EXIF orientation from JPEG data
 */
export function parseExifOrientation(data: Uint8Array): number | null {
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) {
    return null;
  }

  const readUint16 = (buffer: Uint8Array, offset: number, littleEndian: boolean): number => {
    if (littleEndian) {
      return buffer[offset] | (buffer[offset + 1] << 8);
    }
    return (buffer[offset] << 8) | buffer[offset + 1];
  };

  const readUint32 = (buffer: Uint8Array, offset: number, littleEndian: boolean): number => {
    if (littleEndian) {
      return (
        buffer[offset] |
        (buffer[offset + 1] << 8) |
        (buffer[offset + 2] << 16) |
        (buffer[offset + 3] << 24)
      );
    }
    return (
      (buffer[offset] << 24) |
      (buffer[offset + 1] << 16) |
      (buffer[offset + 2] << 8) |
      buffer[offset + 3]
    );
  };

  let offset = 2;

  while (offset + 4 < data.length) {
    if (data[offset] !== 0xFF) {
      break;
    }
    const marker = data[offset + 1];
    offset += 2;

    if (marker === 0xD9 || marker === 0xDA) {
      break;
    }

    if (offset + 2 > data.length) {
      break;
    }

    const segmentLength = (data[offset] << 8) | data[offset + 1];
    if (segmentLength < 2) {
      break;
    }

    const segmentStart = offset + 2;
    const segmentEnd = segmentStart + segmentLength - 2;

    if (segmentEnd > data.length) {
      break;
    }

    if (marker === 0xE1 && segmentLength >= 8) {
      const hasExifHeader =
        data[segmentStart] === 0x45 && // E
        data[segmentStart + 1] === 0x78 && // x
        data[segmentStart + 2] === 0x69 && // i
        data[segmentStart + 3] === 0x66 && // f
        data[segmentStart + 4] === 0x00 &&
        data[segmentStart + 5] === 0x00;

      if (hasExifHeader) {
        const tiffStart = segmentStart + 6;
        if (tiffStart + 8 > data.length) {
          return null;
        }

        const byteOrder = String.fromCharCode(data[tiffStart], data[tiffStart + 1]);
        const littleEndian = byteOrder === 'II';
        const bigEndian = byteOrder === 'MM';
        if (!littleEndian && !bigEndian) {
          return null;
        }
        const isLittleEndian = littleEndian;

        const firstIFDOffset = readUint32(data, tiffStart + 4, isLittleEndian);
        let ifdOffset = tiffStart + firstIFDOffset;

        if (ifdOffset < tiffStart || ifdOffset + 2 > data.length) {
          return null;
        }

        let entryCount = readUint16(data, ifdOffset, isLittleEndian);
        const entrySize = 12;
        const maxEntries = Math.floor((data.length - (ifdOffset + 2)) / entrySize);
        if (entryCount > maxEntries) {
          entryCount = maxEntries;
        }

        for (let i = 0; i < entryCount; i++) {
          const entryOffset = ifdOffset + 2 + i * entrySize;
          if (entryOffset + entrySize > data.length) {
            break;
          }

          const tag = readUint16(data, entryOffset, isLittleEndian);
          if (tag !== 0x0112) {
            continue;
          }

          const type = readUint16(data, entryOffset + 2, isLittleEndian);
          const count = readUint32(data, entryOffset + 4, isLittleEndian);
          if (type !== 3 || count < 1) {
            return null;
          }

          const valueOffset = entryOffset + 8;
          if (valueOffset + 2 > data.length) {
            return null;
          }

          const orientation = readUint16(data, valueOffset, isLittleEndian);
          return orientation;
        }
      }
    }

    offset = segmentEnd;
  }

  return null;
}

/**
 * Apply EXIF orientation transformation to image data
 */
export function applyOrientation(
  data: Uint8Array,
  width: number,
  height: number,
  orientation: number
): { data: Uint8Array; width: number; height: number } {
  if (orientation === 1 || orientation < 1 || orientation > 8) {
    return { data, width, height };
  }

  const shouldSwapDimensions = orientation >= 5 && orientation <= 8;
  const newWidth = shouldSwapDimensions ? height : width;
  const newHeight = shouldSwapDimensions ? width : height;
  const transformed = new Uint8Array(newWidth * newHeight * 4);

  const copyPixel = (destX: number, destY: number, srcIndex: number): void => {
    const destIndex = (destY * newWidth + destX) * 4;
    transformed[destIndex] = data[srcIndex];
    transformed[destIndex + 1] = data[srcIndex + 1];
    transformed[destIndex + 2] = data[srcIndex + 2];
    transformed[destIndex + 3] = data[srcIndex + 3];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIndex = (y * width + x) * 4;
      let destX = x;
      let destY = y;

      switch (orientation) {
        case 2:
          destX = width - 1 - x;
          destY = y;
          break;
        case 3:
          destX = width - 1 - x;
          destY = height - 1 - y;
          break;
        case 4:
          destX = x;
          destY = height - 1 - y;
          break;
        case 5:
          destX = y;
          destY = x;
          break;
        case 6:
          destX = height - 1 - y;
          destY = x;
          break;
        case 7:
          destX = height - 1 - y;
          destY = width - 1 - x;
          break;
        case 8:
          destX = y;
          destY = width - 1 - x;
          break;
        default:
          destX = x;
          destY = y;
          break;
      }

      copyPixel(destX, destY, srcIndex);
    }
  }

  return { data: transformed, width: newWidth, height: newHeight };
}

/**
 * VideoFrame orientation utilities
 */

/**
 * Compose two orientations (rotation + flip).
 * Per WebCodecs spec, when wrapping a VideoFrame with new orientation:
 * - Rotations add (modulo 360)
 * - Flips XOR (flip twice cancels out)
 * - When flip is involved, rotation composition requires special handling
 */
export function composeOrientations(
  srcRotation: 0 | 90 | 180 | 270,
  srcFlip: boolean,
  initRotation: 0 | 90 | 180 | 270,
  initFlip: boolean
): { rotation: 0 | 90 | 180 | 270; flip: boolean } {
  // If source has no orientation, just use init orientation
  if (srcRotation === 0 && !srcFlip) {
    return { rotation: initRotation, flip: initFlip };
  }
  // If init has no orientation, just use source orientation
  if (initRotation === 0 && !initFlip) {
    return { rotation: srcRotation, flip: srcFlip };
  }

  let resultRotation: number;
  let resultFlip: boolean;

  // When source has a flip, the init rotation is applied in mirrored space
  // which effectively negates the rotation direction
  if (srcFlip) {
    // Flip negates rotation direction, so subtract instead of add
    resultRotation = (srcRotation - initRotation + 360) % 360;
  } else {
    // No flip, rotations simply add
    resultRotation = (srcRotation + initRotation) % 360;
  }

  // Flips XOR together
  resultFlip = srcFlip !== initFlip;

  return {
    rotation: resultRotation as 0 | 90 | 180 | 270,
    flip: resultFlip,
  };
}

/**
 * Compute default display dimensions based on visible rect and rotation.
 * Per WebCodecs spec, for 90/270 rotation, display dimensions are swapped.
 */
export function computeDefaultDisplayDimensions(
  visibleWidth: number,
  visibleHeight: number,
  rotation: 0 | 90 | 180 | 270
): { displayWidth: number; displayHeight: number } {
  if (rotation === 90 || rotation === 270) {
    return { displayWidth: visibleHeight, displayHeight: visibleWidth };
  }
  return { displayWidth: visibleWidth, displayHeight: visibleHeight };
}

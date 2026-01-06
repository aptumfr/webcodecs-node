/**
 * VideoFrame metadata types
 */

/**
 * VideoFrameMetadata interface per W3C WebCodecs spec
 * https://w3c.github.io/webcodecs/video_frame_metadata_registry.html
 */
export interface VideoFrameMetadata {
  /** Frame rotation in degrees (0, 90, 180, 270) */
  rotation?: 0 | 90 | 180 | 270;
  /** Whether to flip the frame horizontally */
  flip?: boolean;
}

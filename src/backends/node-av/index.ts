/**
 * Node-av backend module
 *
 * Provides FFmpeg-based implementations of WebCodecs interfaces using node-av.
 */

// Audio
export { NodeAvAudioDecoder, NodeAvAudioEncoder } from './audio/index.js';

// Video
export { NodeAvVideoDecoder, NodeAvVideoEncoder } from './video/index.js';

// Image
export { NodeAvImageDecoder, WebPImageDecoder } from './image/index.js';

// Hardware pipeline utilities
export {
  selectBestFilterChain,
  getNextFilterChain,
  describePipeline,
  markFilterChainFailed,
  clearPipelineCache,
  getPipelineCacheStatus,
  type HardwareType,
} from './HardwarePipeline.js';

# webcodecs-node

WebCodecs API implementation for Node.js using node-av.

This package provides a Node.js-compatible implementation of the [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), enabling video and audio encoding/decoding in server-side JavaScript applications.

## Features

- **VideoEncoder / VideoDecoder** - H.264, HEVC, VP8, VP9, AV1
- **AudioEncoder / AudioDecoder** - AAC, Opus, MP3, FLAC, Vorbis
- **ImageDecoder** - PNG, JPEG, WebP, GIF, AVIF, BMP, TIFF (including animated with frame timing)
- **VideoFrame / AudioData** - Frame-level data manipulation
- **MediaCapabilities** - Query codec support, smooth playback, and power efficiency
- **Hardware Acceleration** - VAAPI, NVENC, QSV support
- **Streaming Support** - Real-time frame-by-frame encoding/decoding
- **Latency Modes** - Configure for real-time streaming vs maximum compression
- **Bitrate Modes** - Constant, variable, and quantizer (CRF) encoding modes
- **Alpha Channel** - Preserve transparency with VP9 and AV1 codecs
- **Container Support** - MP4, WebM demuxing/muxing utilities

## Documentation

- [API Reference](./docs/api.md) - Detailed API documentation for all classes
- [Codec Support](./docs/codecs.md) - Supported video, audio, and image codecs
- [Configuration Guide](./docs/configuration.md) - bitrateMode, alpha, latencyMode, and more
- [Examples](./examples/) - Practical usage examples

## Requirements

- Node.js 18+
- The `node-av` package (automatically installed as a dependency)

```bash
# node-av provides native FFmpeg bindings - no separate FFmpeg installation required
npm install webcodecs-node
```

## Installation

```bash
npm install webcodecs-node
```

## Quick Start

### Using the Polyfill

Install the WebCodecs API globally to make it available as browser-compatible globals:

```typescript
import { installWebCodecsPolyfill } from 'webcodecs-node';

// Install globally
installWebCodecsPolyfill();

// Now use standard WebCodecs API
const encoder = new VideoEncoder({
  output: (chunk, metadata) => {
    console.log('Encoded chunk:', chunk.byteLength, 'bytes');
  },
  error: (e) => console.error(e),
});

encoder.configure({
  codec: 'avc1.42001E', // H.264 Baseline
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
});
```

### Direct Import

```typescript
import {
  VideoEncoder,
  VideoDecoder,
  VideoFrame,
  AudioEncoder,
  AudioDecoder,
  AudioData,
  ImageDecoder,
  mediaCapabilities,
} from 'webcodecs-node';
```

## API Reference

### VideoEncoder

Encodes raw video frames to compressed video.

```typescript
const encoder = new VideoEncoder({
  output: (chunk, metadata) => {
    // chunk is EncodedVideoChunk
    // metadata contains decoder config info
  },
  error: (e) => console.error(e),
});

encoder.configure({
  codec: 'avc1.42001E',  // H.264
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  framerate: 30,
  bitrateMode: 'variable',                 // Optional: 'constant', 'variable', or 'quantizer'
  latencyMode: 'realtime',                 // Optional: 'realtime' for streaming, 'quality' for best compression
  hardwareAcceleration: 'prefer-hardware', // Optional: use GPU encoding
});

// Create a frame from raw RGBA data
const frame = new VideoFrame(rgbaBuffer, {
  format: 'RGBA',
  codedWidth: 1920,
  codedHeight: 1080,
  timestamp: 0,
});

encoder.encode(frame);
frame.close();

await encoder.flush();
encoder.close();
```

**Supported codecs:**
- `avc1.*` - H.264/AVC
- `hev1.*`, `hvc1.*` - H.265/HEVC
- `vp8` - VP8
- `vp09.*` - VP9
- `av01.*` - AV1

### VideoDecoder

Decodes compressed video to raw frames.

```typescript
const decoder = new VideoDecoder({
  output: (frame) => {
    // frame is VideoFrame with raw pixel data
    console.log(`Frame: ${frame.codedWidth}x${frame.codedHeight}`);
    frame.close();
  },
  error: (e) => console.error(e),
});

decoder.configure({
  codec: 'avc1.42001E',
  codedWidth: 1920,
  codedHeight: 1080,
});

// Decode an encoded chunk
decoder.decode(encodedVideoChunk);
await decoder.flush();
decoder.close();
```

### AudioEncoder

Encodes raw audio samples to compressed audio.

```typescript
const encoder = new AudioEncoder({
  output: (chunk, metadata) => {
    console.log('Encoded audio:', chunk.byteLength, 'bytes');
  },
  error: (e) => console.error(e),
});

encoder.configure({
  codec: 'opus',
  sampleRate: 48000,
  numberOfChannels: 2,
  bitrate: 128000,
});

// Create audio data from raw samples
const audioData = new AudioData({
  format: 'f32',
  sampleRate: 48000,
  numberOfChannels: 2,
  numberOfFrames: 1024,
  timestamp: 0,
  data: float32Samples,
});

encoder.encode(audioData);
audioData.close();

await encoder.flush();
encoder.close();
```

**Supported codecs:**
- `opus` - Opus
- `mp4a.40.2` - AAC-LC
- `mp3` - MP3
- `flac` - FLAC
- `vorbis` - Vorbis

### ImageDecoder

Decodes images (including animated) to VideoFrames. Fully compliant with the [WebCodecs ImageDecoder API](https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder).

```typescript
import { readFileSync } from 'fs';

const imageData = readFileSync('animation.gif');

const decoder = new ImageDecoder({
  type: 'image/gif',
  data: imageData,
});

// Wait for parsing to complete
await decoder.completed;

// Access track information
const track = decoder.tracks.selectedTrack;
console.log(`Type: ${decoder.type}`);
console.log(`Frames: ${track?.frameCount}`);
console.log(`Animated: ${track?.animated}`);
console.log(`Loop count: ${track?.repetitionCount}`); // Infinity = loop forever

// Decode each frame with timing info
for (let i = 0; i < track.frameCount; i++) {
  const { image, complete } = await decoder.decode({ frameIndex: i });
  console.log(`Frame ${i}: ${image.codedWidth}x${image.codedHeight}`);
  console.log(`  Timestamp: ${image.timestamp / 1000}ms`);
  console.log(`  Duration: ${image.duration / 1000}ms`);
  image.close();
}

decoder.close();
```

**Supported formats:**
- `image/png`, `image/apng`
- `image/jpeg`
- `image/webp`
- `image/gif`
- `image/avif`
- `image/bmp`
- `image/tiff`

### MediaCapabilities API

Query codec capabilities before encoding/decoding. Implements the standard [MediaCapabilities API](https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities).

```typescript
import { mediaCapabilities } from 'webcodecs-node';

// Query decoding capabilities
const decodeInfo = await mediaCapabilities.decodingInfo({
  type: 'file',
  video: {
    contentType: 'video/mp4; codecs="avc1.42E01E"',
    width: 1920,
    height: 1080,
    bitrate: 5_000_000,
    framerate: 30,
  },
  audio: {
    contentType: 'audio/mp4; codecs="mp4a.40.2"',
    channels: 2,
    bitrate: 128000,
    samplerate: 44100,
  },
});

console.log('Supported:', decodeInfo.supported);
console.log('Smooth playback:', decodeInfo.smooth);
console.log('Power efficient:', decodeInfo.powerEfficient);

// Query encoding capabilities
const encodeInfo = await mediaCapabilities.encodingInfo({
  type: 'record',
  video: {
    contentType: 'video/webm; codecs="vp9"',
    width: 1280,
    height: 720,
    bitrate: 2_000_000,
    framerate: 30,
  },
});

if (encodeInfo.supported && encodeInfo.powerEfficient) {
  console.log('Hardware-accelerated encoding available!');
}
```

### Hardware Acceleration

Detect and use hardware encoding/decoding:

```typescript
import {
  detectHardwareAcceleration,
  getHardwareAccelerationSummary,
  getBestEncoder,
} from 'webcodecs-node';

// Get a summary of available hardware acceleration
const summary = await getHardwareAccelerationSummary();
console.log(summary);

// Detect capabilities
const capabilities = await detectHardwareAcceleration();
console.log('Available methods:', capabilities.methods);
console.log('Hardware encoders:', capabilities.encoders);
console.log('Hardware decoders:', capabilities.decoders);

// Get best encoder for a codec
const best = await getBestEncoder('h264', 'prefer-hardware');
console.log(`Using: ${best.encoder} (hardware: ${best.isHardware})`);

// Use in VideoEncoder config
encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  hardwareAcceleration: 'prefer-hardware',
});
```

**Supported acceleration methods:**
- **VAAPI** - Intel/AMD on Linux
- **NVENC/NVDEC** - NVIDIA GPUs
- **QSV** - Intel Quick Sync Video
- **VideoToolbox** - macOS

### Container Utilities

Import container demuxing/muxing utilities for working with MP4 and WebM files:

```typescript
import { Mp4Demuxer, WebmMuxer } from 'webcodecs-node/containers';

// Demux an MP4 file
const demuxer = new Mp4Demuxer(mp4Data);
await demuxer.initialize();

for await (const sample of demuxer.videoSamples()) {
  // sample contains encoded video chunks
}

// Mux encoded chunks to WebM
const muxer = new WebmMuxer({
  video: { codec: 'vp9', width: 1920, height: 1080 },
});

muxer.addVideoChunk(encodedChunk, metadata);
const webmData = muxer.finalize();
```

### Streaming & Latency Modes

For real-time streaming applications, use `latencyMode: 'realtime'` to minimize encoding latency:

```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
  framerate: 30,
  latencyMode: 'realtime', // Prioritize low latency
});
```

**Latency mode options:**
- `'quality'` (default) - Best compression, higher latency (uses B-frames, lookahead)
- `'realtime'` - Minimum latency for live streaming (no B-frames, zero-delay)

### Bitrate Modes

Control how bitrate is managed during encoding:

```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  bitrateMode: 'constant', // CBR for streaming
});
```

| Mode | Description | Use Case |
|------|-------------|----------|
| `'variable'` | VBR - varies bitrate for quality (default) | General purpose |
| `'constant'` | CBR - fixed bitrate throughout | Streaming, broadcast |
| `'quantizer'` | CRF/CQ - fixed quality level | Archival, quality-first |

### Alpha Channel (Transparency)

Preserve transparency when encoding with VP9 or AV1:

```typescript
encoder.configure({
  codec: 'vp9',
  width: 1920,
  height: 1080,
  alpha: 'keep', // Preserve transparency
});

// Create RGBA frame with transparency
const frame = new VideoFrame(rgbaWithAlpha, {
  format: 'RGBA',
  codedWidth: 1920,
  codedHeight: 1080,
  timestamp: 0,
});

encoder.encode(frame);
```

### Canvas Rendering (skia-canvas)

GPU-accelerated 2D canvas rendering with automatic hardware detection:

```typescript
import {
  createCanvas,
  createFrameLoop,
  detectGpuAcceleration,
  isGpuAvailable,
  getGpuApi,
  ensureEvenDimensions,
  VideoEncoder,
} from 'webcodecs-node';

// Check GPU availability
const gpuInfo = detectGpuAcceleration();
console.log(`Renderer: ${gpuInfo.renderer}`); // 'GPU' or 'CPU'
console.log(`API: ${getGpuApi()}`);           // 'Metal', 'Vulkan', 'D3D', or null

// Create GPU-accelerated canvas
const canvas = createCanvas({
  width: 1920,
  height: 1080,
  gpu: true, // or omit for auto-detection
});

const ctx = canvas.getContext('2d');
ctx.fillStyle = 'red';
ctx.fillRect(0, 0, 1920, 1080);

// Create VideoFrame directly from canvas
const frame = new VideoFrame(canvas, { timestamp: 0 });
```

**FrameLoop helper** for animation with backpressure:

```typescript
const loop = createFrameLoop({
  width: 1920,
  height: 1080,
  frameRate: 30,
  maxQueueSize: 8, // Backpressure limit
  onFrame: (ctx, timing) => {
    // Draw each frame
    ctx.fillStyle = `hsl(${timing.frameIndex % 360}, 100%, 50%)`;
    ctx.fillRect(0, 0, 1920, 1080);
  },
});

loop.start(300); // Generate 300 frames

while (loop.getState() !== 'stopped' || loop.getQueueSize() > 0) {
  const frame = loop.takeFrame();
  if (frame) {
    encoder.encode(frame);
    frame.close(); // Always close frames!
  }
}
```

**OffscreenCanvas polyfill** for browser-compatible code:

```typescript
import { installOffscreenCanvasPolyfill } from 'webcodecs-node';

installOffscreenCanvasPolyfill();

// Now use standard OffscreenCanvas API
const canvas = new OffscreenCanvas(1920, 1080);
const ctx = canvas.getContext('2d');
const blob = await canvas.convertToBlob({ type: 'image/png' });
```

## Performance Tuning

### Memory Management

Always close VideoFrames and AudioData when done:

```typescript
const frame = new VideoFrame(buffer, { ... });
try {
  encoder.encode(frame);
} finally {
  frame.close(); // Prevent memory leaks
}
```

### Even Dimensions

Video codecs require even dimensions for YUV420 chroma subsampling:

```typescript
import { ensureEvenDimensions, validateEvenDimensions } from 'webcodecs-node';

// Auto-fix odd dimensions (rounds up)
const { width, height } = ensureEvenDimensions(1279, 719);
// Returns { width: 1280, height: 720 }

// Strict validation (throws if odd)
validateEvenDimensions(1280, 720); // OK
validateEvenDimensions(1279, 720); // Throws TypeError
```

### Backpressure Handling

Monitor encoder queue to prevent memory exhaustion:

```typescript
encoder.addEventListener('dequeue', () => {
  // Queue size decreased, safe to encode more
  if (encoder.encodeQueueSize < 10) {
    encodeNextFrame();
  }
});
```

### Raw Buffer Export

For maximum performance, use raw RGBA buffers instead of PNG/JPEG:

```typescript
import { getRawPixels } from 'webcodecs-node';

// Fast: raw RGBA buffer (no compression)
const pixels = getRawPixels(canvas); // Returns Buffer

// Slow: PNG encoding (avoid in hot paths)
const png = await canvas.toBuffer('png');
```

### GPU vs CPU Tradeoffs

| Scenario | Recommendation |
|----------|----------------|
| HD/4K encoding | `hardwareAcceleration: 'prefer-hardware'` |
| Real-time streaming | Hardware + `latencyMode: 'realtime'` |
| Maximum quality | Software + `bitrateMode: 'quantizer'` |
| Batch processing | Hardware for throughput |
| Low-end systems | Software (more compatible) |

## Demos

Run the included demos to test functionality:

```bash
npm run build

# Basic demo
npm run demo

# WebCodecs API demo
npm run demo:webcodecs

# Image decoding demo (animated GIF/PNG/WebP with frame timing)
npm run demo:image

# Hardware acceleration detection
npm run demo:hwaccel

# Streaming demo (real-time encoding)
npm run demo:streaming

# Sample-based encoding demo
npm run demo:samples

# Container demuxing/muxing demo
npm run demo:containers

# Video quadrant compositor demo (four-up render)
npm run demo:fourcorners

# 1080p transcoding demo
npm run demo:1080p
```

## API Compatibility

This implementation follows the [WebCodecs specification](https://www.w3.org/TR/webcodecs/) with some Node.js-specific adaptations:

| Feature | Browser | webcodecs-node |
|---------|---------|----------------|
| VideoEncoder | ✓ | ✓ |
| VideoDecoder | ✓ | ✓ |
| AudioEncoder | ✓ | ✓ |
| AudioDecoder | ✓ | ✓ |
| ImageDecoder | ✓ | ✓ |
| VideoFrame | ✓ | ✓ |
| AudioData | ✓ | ✓ |
| EncodedVideoChunk | ✓ | ✓ |
| EncodedAudioChunk | ✓ | ✓ |
| ImageTrack/ImageTrackList | ✓ | ✓ |
| MediaCapabilities | ✓ | ✓ |
| Hardware Acceleration | Auto | Opt-in |
| latencyMode | ✓ | ✓ |
| bitrateMode | ✓ | ✓ |
| alpha (transparency) | ✓ | ✓ (VP9, AV1) |
| isConfigSupported() | ✓ | ✓ |

## Architecture

This library uses **node-av** as its backend, which provides native bindings to FFmpeg's libav* libraries. This approach offers:

- **Native performance** - Direct library calls instead of subprocess spawning
- **Lower latency** - No IPC overhead between Node.js and FFmpeg
- **Better resource management** - Native memory handling and cleanup
- **Simplified deployment** - No need for separate FFmpeg installation

## License

webcodecs-node is distributed under the GNU Affero General Public License v3.0. See `LICENSE` for full terms.

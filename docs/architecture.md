# WebCodecs-Node Architecture

This document provides an architecture overview, design decisions, and feature matrix for the webcodecs-node library.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Application                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Public WebCodecs API                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │VideoEncoder │  │VideoDecoder │  │AudioEncoder │  │AudioDecoder │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────────┐ │
│  │ImageDecoder │  │ VideoFrame  │  │ AudioData / EncodedChunks       │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
         ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
         │  Validation  │  │    Config    │  │   Formats    │
         │   (codecs/)  │  │   Parsing    │  │ (pixel/color)│
         └──────────────┘  └──────────────┘  └──────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Backend Abstraction                              │
│                                                                          │
│   isConfigSupported() → validation → backend probe (if needed)          │
│   configure()         → validation → backend initialization             │
│   encode()/decode()   → data transform → backend processing             │
│   output callback     ← chunk creation ← backend output                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        node-av Backend                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  NodeAvVideoEncoder  │  NodeAvVideoDecoder  │  NodeAvImageDecoder│   │
│  │  NodeAvAudioEncoder  │  NodeAvAudioDecoder  │                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│              ┌─────────────────────┼─────────────────────┐              │
│              ▼                     ▼                     ▼              │
│      Hardware Accel         Software Codecs        Filter Graphs        │
│   (VAAPI, NVENC, QSV)    (x264, x265, libvpx,    (scale, format,       │
│                           SVT-AV1, libopus)       transpose)            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           FFmpeg (via node-av)                           │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Encoding Pipeline

```
VideoFrame/AudioData                 EncodedVideoChunk/EncodedAudioChunk
       │                                           ▲
       ▼                                           │
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Validate   │───▶│   Convert    │───▶│   Encode     │
│   (format,   │    │ (pixel fmt,  │    │  (hardware   │
│   dimensions)│    │  colorspace) │    │  or software)│
└──────────────┘    └──────────────┘    └──────────────┘
                           │                    │
                           ▼                    ▼
                    FFmpeg filters       FFmpeg encoder
                    (scale, format)      (h264_vaapi, libx264, etc.)
```

### Decoding Pipeline

```
EncodedVideoChunk/EncodedAudioChunk           VideoFrame/AudioData
       │                                              ▲
       ▼                                              │
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│    Parse     │───▶│    Decode    │───▶│   Convert    │
│  (NAL units, │    │  (hardware   │    │  (to user    │
│   headers)   │    │  or software)│    │   format)    │
└──────────────┘    └──────────────┘    └──────────────┘
```

## Module Structure

```
src/
├── core/                   # WebCodecs data types (VideoFrame, AudioData, etc.)
├── encoders/               # Public encoder APIs (VideoEncoder, AudioEncoder)
├── decoders/               # Public decoder APIs (VideoDecoder, AudioDecoder, ImageDecoder)
├── backends/node-av/       # FFmpeg backend implementation
│   ├── video/              # Video encoder/decoder
│   ├── audio/              # Audio encoder/decoder
│   └── image/              # Image decoder
├── codecs/                 # Codec-specific utilities
│   └── validation/         # Codec string validation (WebCodecs spec compliant)
├── formats/                # Pixel format and color space handling
├── containers/             # Muxer/Demuxer for MP4, WebM, MKV
├── capabilities/           # MediaCapabilities API
├── transfer/               # ArrayBuffer transfer semantics
└── utils/                  # Shared utilities (errors, logging, buffers)
```

## Feature Matrix

### Video Codecs

| Codec | Encode | Decode | Hardware Accel | Notes |
|-------|--------|--------|----------------|-------|
| H.264/AVC (`avc1.*`) | ✅ | ✅ | VAAPI, NVENC, QSV | Full profile/level support |
| H.265/HEVC (`hvc1.*`, `hev1.*`) | ✅ | ✅ | VAAPI, NVENC, QSV | 8-bit and 10-bit |
| VP8 (`vp8`) | ✅ | ✅ | ❌ | Software only |
| VP9 (`vp09.*`) | ✅ | ✅ | VAAPI | Alpha channel (software), profiles 0-3 |
| AV1 (`av01.*`) | ✅ | ✅ | VAAPI (decode) | SVT-AV1 encoder, 8/10/12-bit |

### Audio Codecs

| Codec | Encode | Decode | Notes |
|-------|--------|--------|-------|
| Opus (`opus`) | ✅ | ✅ | All sample rates, stereo/mono |
| AAC (`mp4a.40.*`) | ✅ | ✅ | AAC-LC, HE-AAC, HE-AACv2 |
| FLAC (`flac`) | ✅ | ✅ | Lossless, up to 24-bit |
| Vorbis (`vorbis`) | ✅ | ✅ | WebM container |
| MP3 (`mp3`) | ✅ | ✅ | Decode-only recommended |
| PCM (`pcm-*`) | ✅ | ✅ | u8, s16, s24, s32, f32 |

### Container Formats

| Format | Mux | Demux | Video Codecs | Audio Codecs |
|--------|-----|-------|--------------|--------------|
| MP4 | ✅ | ✅ | H.264, H.265, AV1 | AAC, Opus, FLAC |
| WebM | ✅ | ✅ | VP8, VP9, AV1 | Opus, Vorbis |
| MKV | ✅ | ✅ | All | All |

### Image Formats (ImageDecoder)

| Format | Decode | Animated | Notes |
|--------|--------|----------|-------|
| JPEG | ✅ | N/A | EXIF orientation |
| PNG | ✅ | ✅ (APNG) | Alpha channel |
| WebP | ✅ | ✅ | Lossy and lossless |
| GIF | ✅ | ✅ | Frame disposal |
| AVIF | ✅ | ✅ | AV1-based |
| BMP | ✅ | N/A | Basic support |

## Design Decisions

### 1. Timebase Handling

**Problem**: FFmpeg uses rational timebases (e.g., 1/90000 for video), while WebCodecs uses microseconds.

**Solution**:
- Input timestamps (microseconds) are converted to encoder timebase on write
- Output timestamps are converted back to microseconds from packet PTS
- For AV1 (SVT-AV1), timestamps are quantized to framerate-based timebase to match encoder behavior

**Rationale**: This preserves timestamp accuracy while letting FFmpeg handle internal timing correctly.

### 2. B-Frame Reordering

**Problem**: B-frames cause output order to differ from input order, breaking simple FIFO duration tracking.

**Solution**: Store pending frame info (duration, keyFrame hint) in a Map keyed by timestamp. Look up by timestamp when packets arrive, not by order.

**Tradeoff**: Small memory overhead for tracking pending frames.

### 3. Hardware Acceleration (Default Behavior)

**Default**: `'no-preference'` which tries hardware first, falls back to software automatically.

**Options**:
- `'no-preference'` (default): Use hardware if available, otherwise software
- `'prefer-hardware'`: Same as no-preference (explicit hardware preference)
- `'prefer-software'`: Force software encoder

**Fallback Logic**: If hardware encoder initialization fails (driver issues, unsupported resolution, etc.), automatically falls back to software encoder. This is logged at `info` level.

**Rationale**: Hardware acceleration provides significant performance benefits. Silent fallback ensures encoding always works even if hardware has quirks.

### 4. HDR Metadata Gap

**Problem**: WebCodecs supports HDR metadata (mastering display, content light level), but node-av's API doesn't expose side data attachment for encoded packets.

**Current Status**: HDR metadata is accepted in config but not written to output. Requires node-av API additions.

**Workaround**: For HDR content, use container-level metadata or post-process with FFmpeg.

### 5. Opus Format Restriction

**Problem**: Opus in WebM uses different framing than Opus in Ogg.

**Solution**: Only `webm` format is supported for Opus encoding. Requests for `ogg` format throw `NotSupportedError`.

**Rationale**: Ogg Opus requires page-based framing that doesn't map cleanly to WebCodecs' chunk model.

### 6. Validation Duplication

**Design Choice**: Validation exists in both `isConfigSupported()` and `configure()`.

- `isConfigSupported()`: Returns `{ supported: false }` for unsupported configs (no throw)
- `configure()`: Throws `TypeError` for invalid configs, `NotSupportedError` for unsupported

**Rationale**: This matches WebCodecs spec behavior where the two methods have different error semantics.

### 7. Native Frame Passthrough

**Optimization**: When VideoFrame wraps a native FFmpeg frame (from decoding), encoding can pass it directly to the encoder without pixel copy.

**Benefit**: Zero-copy transcoding path for same-colorspace scenarios.

## Known Limitations

1. **Scalability Mode (SVC)**: Not supported. `scalabilityMode` config is rejected.

2. **Alpha Channel**: Only VP9 software encoding supports alpha. H.264/H.265/AV1 do not.

3. **Odd Dimensions**: Require even width/height for most codecs (YUV420 subsampling). VP9/AV1 software can handle odd dimensions.

4. **Real-time Encoding**: `latencyMode: 'realtime'` reduces quality for lower latency but doesn't guarantee real-time performance.

5. **contentHint**: Accepted but only affects encoder tuning (not a hard guarantee):
   - `text`: Screen content mode (AV1), stillimage tune (x264)
   - `detail`: Lower preset, SSIM tune
   - `motion`: Film tune (x264/x265)

## Logging Conventions

Enable debug logging: `WEBCODECS_DEBUG=1`

| Level | Usage |
|-------|-------|
| `debug` | Internal state, fallback paths, timing details |
| `info` | Feature limitations, capability detection results |
| `warn` | Spec mismatches, deprecated usage, recoverable issues |
| `error` | Failures that will be reported to error callback |

## Testing Strategy

- **Unit tests**: Codec validation, format utilities, data type construction
- **Integration tests**: Full encode/decode cycles with real frames
- **WPT-style tests**: WebCodecs spec compliance (state machine, error conditions)
- **Benchmark tests**: Performance regression detection

## Future Considerations

1. **Additional backends**: WebAssembly-based codecs for environments without native FFmpeg
2. **Worker support**: Offload encoding/decoding to worker threads
3. **Streaming demux**: Chunk-at-a-time demuxing for live streams
4. **HDR passthrough**: When node-av exposes side data API

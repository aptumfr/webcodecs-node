# Architecture Refactoring Plan

## Status: COMPLETED (December 2025)

All phases have been completed successfully:
- Phase 1: Interface enforcement ✅
- Phase 2: FFmpeg fallback removal ✅
- Phase 3: Code organization ✅
- Phase 4: Code quality improvements ✅
- Phase 5: Testing and cleanup ✅

## Summary of Changes

1. **VideoEncoder/VideoDecoder**: Simplified to use only node-av backend
2. **AudioEncoder/AudioDecoder**: Simplified to use only node-av backend
3. **HardwarePipeline**: Replaced console.log with logger
4. **Backend types**: Properly typed interfaces (no `any`)
5. **ImageDecoder**: Kept FFmpeg CLI fallback for animated formats (node-av has issues with animated GIF/WebP demuxing)

---

## Original Analysis (for reference)

### Strengths
- Clean public API surface with barrel exports
- Pluggable backend strategy (node-av + FFmpeg CLI)
- WebCodecs API compliance
- Good TypeScript type definitions

### Issues Addressed

## 1. Backend Interface Not Enforced

**Problem**: `EncoderBackend`/`DecoderBackend` interfaces exist but aren't implemented.

**Files**:
- `src/backends/types.ts` - defines interface with `any` config
- `src/node-av/NodeAvVideoEncoder.ts` - doesn't implement interface
- `src/ffmpeg/FFmpegProcess.ts` - doesn't implement interface

**Solution**:
- Add proper generic types to backend interfaces
- Make backends explicitly implement the interfaces
- Remove `any` types

## 2. Remove FFmpeg CLI Fallback Where node-av Works

**Problem**: Dual code paths maintained unnecessarily.

**node-av working**:
- Video encoding (H.264, HEVC, VP8, VP9, AV1)
- Video decoding (all codecs)
- Audio encoding (AAC, Opus, MP3, FLAC)
- Audio decoding (all codecs)
- Still image decoding (PNG, JPEG, WebP, BMP, TIFF, AVIF)

**node-av NOT working** (keep FFmpeg CLI):
- Animated image decoding (GIF, APNG, animated WebP) - demuxing segfaults
- Animation metadata probing (frame durations, loop count)

**Files to simplify**:
- `src/encoders/VideoEncoder.ts` - remove FFmpegProcess path
- `src/decoders/VideoDecoder.ts` - remove FFmpegProcess path
- `src/encoders/AudioEncoder.ts` - remove FFmpegProcess path
- `src/decoders/AudioDecoder.ts` - remove FFmpegProcess path
- Remove or deprecate `src/ffmpeg/FFmpegProcess.ts`

## 3. Extract Backend Factory

**Problem**: Backend selection logic duplicated in VideoEncoder and VideoDecoder.

**Solution**: Create `src/backends/factory.ts`:
```typescript
export function createVideoEncoderBackend(config: VideoEncoderConfig): VideoEncoderBackend
export function createVideoDecoderBackend(config: VideoDecoderConfig): VideoDecoderBackend
export function createAudioEncoderBackend(config: AudioEncoderConfig): AudioEncoderBackend
export function createAudioDecoderBackend(config: AudioDecoderConfig): AudioDecoderBackend
```

## 4. Centralize Pixel Format Conversions

**Problem**: `convertRgbaToI420`, `convertNv12ToI420` duplicated in:
- `src/node-av/NodeAvVideoEncoder.ts`
- `src/node-av/NodeAvVideoDecoder.ts`

**Solution**: Move all to `src/formats/conversions/` and import from there.

## 5. Standardize Event Names

**Problem**: Inconsistent events between backends:
- FFmpegProcess: `'data'`, `'frame'`
- NodeAvVideoEncoder: `'encodedFrame'`

**Solution**: Define standard events in backend interface:
```typescript
interface EncoderBackend {
  on(event: 'encoded', listener: (data: EncodedFrame) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;
}
```

## 6. Replace console.log with Logger

**Problem**: Raw `console.log` in node-av backends.

**Files**:
- `src/node-av/NodeAvVideoEncoder.ts`
- `src/node-av/NodeAvVideoDecoder.ts`
- `src/node-av/NodeAvAudioEncoder.ts`
- `src/node-av/NodeAvAudioDecoder.ts`
- `src/node-av/HardwarePipeline.ts`

**Solution**: Import and use `createLogger` from `src/utils/logger.ts`.

## 7. Split Large Functions

**Problem**: Some methods mix too many concerns.

**VideoEncoder._emitEncodedChunk** (55 lines):
- Frame info extraction
- Codec detection
- Bitstream format conversion (AVCC/HVCC)
- Chunk creation
- Metadata assembly
- Callback invocation

**Solution**: Extract:
- `_extractCodecDescription(data, codecBase)`
- `_convertBitstreamFormat(data, codecBase)`
- `_buildOutputMetadata()`

## 8. Add Constants for Magic Numbers

**Problem**: Magic numbers without explanation.

**Examples**:
```typescript
if (this._encodedBuffer.length > 4096)  // Why 4096?
options['cpu-used'] = '8';               // Why 8?
options.crf = '23';                      // Why 23?
```

**Solution**: Create `src/constants.ts` with named constants and comments.

## 9. Naming Consistency

**Problem**: Inconsistent naming patterns.

**Current**:
- `NodeAvVideoEncoder` (function-based)
- `FFmpegProcess` (generic)

**Solution**: Either:
- Rename to `NodeAvEncoder` + `FFmpegEncoder` (by backend)
- Or keep current but document convention

## 10. Dead Code Removal

**Problem**: Unused code paths.

**Examples**:
- `_canUseNodeAv()` always returns `true`
- `backend: 'ffmpeg'` config option (remove if deprecated)
- FFmpeg-specific parsers if no longer used

---

## Implementation Order

### Phase 1: Interface Enforcement
1. Update `src/backends/types.ts` with proper types
2. Make NodeAv* backends implement interfaces
3. Add type tests

### Phase 2: Remove FFmpeg Fallback
1. Remove `FFmpegProcess` from VideoEncoder/VideoDecoder
2. Remove `FFmpegProcess` from AudioEncoder/AudioDecoder
3. Keep FFmpegProcess only for ImageDecoder animated formats
4. Update or remove `backend` config option

### Phase 3: Code Organization
1. Create backend factory
2. Centralize pixel format conversions
3. Standardize event names
4. Replace console.log with logger

### Phase 4: Code Quality
1. Split large functions
2. Add constants for magic numbers
3. Remove dead code
4. Fix naming consistency

### Phase 5: Testing & Documentation
1. Add integration tests for node-av path
2. Update documentation
3. Add migration guide if breaking changes

/**
 * Image dimension probing utilities
 */

import { Decoder } from 'node-av/api';
import { FormatContext, Packet, Stream, Rational } from 'node-av/lib';
import { AVMEDIA_TYPE_VIDEO } from 'node-av/constants';
import { MIME_TO_CODEC_ID } from './constants.js';

/**
 * Probe image dimensions using node-av
 * Returns { width, height } or { width: 0, height: 0 } if probing fails
 */
export async function probeImageDimensions(
  data: Uint8Array,
  mimeType: string
): Promise<{ width: number; height: number }> {
  const codecId = MIME_TO_CODEC_ID[mimeType.toLowerCase()];
  if (!codecId) {
    return { width: 0, height: 0 };
  }

  let formatContext: FormatContext | null = null;
  let stream: Stream | null = null;
  let decoder: Decoder | null = null;

  try {
    formatContext = new FormatContext();
    formatContext.allocContext();
    stream = formatContext.newStream();
    stream.timeBase = new Rational(1, 25);

    const params = stream.codecpar;
    params.codecType = AVMEDIA_TYPE_VIDEO;
    params.codecId = codecId;
    params.width = 0;
    params.height = 0;

    decoder = await Decoder.create(stream, { exitOnError: false });

    const packet = new Packet();
    packet.alloc();
    packet.streamIndex = stream.index;
    packet.pts = 0n;
    packet.dts = 0n;
    packet.timeBase = new Rational(1, 25);
    packet.data = Buffer.from(data);
    packet.duration = 1n;

    await decoder.decode(packet);
    packet.unref();

    const frame = await decoder.receive();
    if (frame) {
      const width = frame.width;
      const height = frame.height;
      frame.unref();
      return { width, height };
    }

    return { width: 0, height: 0 };
  } catch {
    return { width: 0, height: 0 };
  } finally {
    decoder?.close();
  }
}

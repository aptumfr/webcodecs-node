/**
 * Stream utilities for ImageDecoder
 */

/**
 * Check if an object is a ReadableStream
 */
export function isReadableStream(obj: unknown): obj is ReadableStream {
  return typeof obj === 'object' && obj !== null && typeof (obj as ReadableStream).getReader === 'function';
}

/**
 * Read entire ReadableStream into a Uint8Array
 */
export async function readStreamToBuffer(stream: ReadableStream<ArrayBufferView>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalReceived = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        chunks.push(chunk);
        totalReceived += chunk.length;
      }
    }

    // Concatenate all chunks
    const result = new Uint8Array(totalReceived);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  } finally {
    reader.releaseLock();
  }
}

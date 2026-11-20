import type { SSEMessage, VexaRequestConfig, VexaStreamResponse } from './types.js';

/**
 * Reads a ReadableStream of Uint8Array chunks and yields them as binary chunks.
 */
export async function* streamChunks(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<Uint8Array, void, unknown> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Reads a ReadableStream and yields decoded UTF-8 string chunks.
 */
export async function* streamText(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const remaining = decoder.decode();
        if (remaining) yield remaining;
        break;
      }
      if (value) {
        const text = decoder.decode(value, { stream: true });
        if (text) yield text;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Reads a ReadableStream and yields lines separated by newline (`\n` or `\r\n`).
 */
export async function* streamLines(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.length > 0) {
          yield buffer;
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        yield line;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parses a Server-Sent Events (SSE) stream and yields parsed SSEMessage objects.
 * Accurately handles event, data, id, retry fields, comments (: ping), and multi-line data.
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEMessage, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  let currentId: string | undefined;
  let currentEvent: string | undefined;
  let currentDataLines: string[] = [];
  let currentRetry: number | undefined;

  function dispatchMessage(): SSEMessage | null {
    if (currentDataLines.length === 0 && !currentEvent && !currentId) {
      return null;
    }

    const data = currentDataLines.join('\n');
    const msg: SSEMessage = {
      id: currentId,
      event: currentEvent,
      data,
      retry: currentRetry,
      json<T>() {
        try {
          return JSON.parse(data) as T;
        } catch (err) {
          throw new Error(
            `Failed to parse SSE data as JSON: "${data}" (Error: ${err instanceof Error ? err.message : String(err)})`
          );
        }
      },
    };

    // Reset message state
    currentId = undefined;
    currentEvent = undefined;
    currentDataLines = [];
    currentRetry = undefined;

    return msg;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      // Keep the last incomplete line in buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line === '') {
          // Empty line indicates event boundary
          const msg = dispatchMessage();
          if (msg) yield msg;
          continue;
        }

        // Comment line (e.g. keep-alive ping)
        if (line.startsWith(':')) {
          continue;
        }

        const colonIndex = line.indexOf(':');
        let field: string;
        let value: string;

        if (colonIndex === -1) {
          field = line;
          value = '';
        } else {
          field = line.slice(0, colonIndex);
          value = line.slice(colonIndex + 1);
          if (value.startsWith(' ')) {
            value = value.slice(1);
          }
        }

        if (field === 'data') {
          currentDataLines.push(value);
        } else if (field === 'event') {
          currentEvent = value;
        } else if (field === 'id') {
          currentId = value;
        } else if (field === 'retry') {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed)) currentRetry = parsed;
        }
      }
    }

    // Process any remaining buffered lines
    if (buffer.length > 0) {
      const remainingLines = buffer.split(/\r?\n/);
      for (const line of remainingLines) {
        if (line.startsWith('data:')) {
          currentDataLines.push(line.slice(5).replace(/^ /, ''));
        }
      }
    }

    const finalMsg = dispatchMessage();
    if (finalMsg) yield finalMsg;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Creates an empty ReadableStream for responses with no body.
 */
function createEmptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

/**
 * Wraps a fetch Response in a VexaStreamResponse helper.
 */
export function createStreamResponse(
  request: Request,
  response: Response,
  config: VexaRequestConfig
): VexaStreamResponse {
  const body = response.body ?? createEmptyStream();

  return {
    request,
    response,
    raw: response,
    config,
    [Symbol.asyncIterator]() {
      return streamText(body);
    },
    chunks() {
      return streamChunks(body);
    },
    lines() {
      return streamLines(body);
    },
    sse() {
      return parseSSEStream(body);
    },
    async text() {
      return response.text();
    },
    async cancel(reason?: string) {
      return body.cancel(reason);
    },
  };
}

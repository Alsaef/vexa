import { describe, it, expect, vi } from 'vitest';
import { createInstance, parseSSEStream } from '../src/index.js';

describe('Vexa Streaming & AI Helpers', () => {
  function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(encoder.encode(chunks[index++]));
        } else {
          controller.close();
        }
      },
    });
  }

  it('streams text chunks using vexa.stream() and for await loop', async () => {
    const mockChunks = ['Hello', ', ', 'world', '!'];
    const mockFetch = vi.fn().mockImplementation(() => {
      return Promise.resolve(
        new Response(createMockStream(mockChunks), {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      );
    });

    const client = createInstance({ fetch: mockFetch });
    const stream = await client.stream('https://api.example.com/chat');

    const receivedChunks: string[] = [];
    for await (const chunk of stream) {
      receivedChunks.push(chunk);
    }

    expect(receivedChunks).toEqual(mockChunks);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reads binary chunks using stream.chunks() and lines using stream.lines()', async () => {
    const linesData = ['Line 1\n', 'Line 2\r\n', 'Line 3'];
    const mockFetch = vi.fn().mockImplementation(() => {
      return Promise.resolve(
        new Response(createMockStream(linesData), {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      );
    });

    const client = createInstance({ fetch: mockFetch });
    const stream = await client.stream('https://api.example.com/lines');

    const lines: string[] = [];
    for await (const line of stream.lines()) {
      lines.push(line);
    }

    expect(lines).toEqual(['Line 1', 'Line 2', 'Line 3']);
  });

  it('parses Server-Sent Events (SSE) including data, event, id, and json()', async () => {
    const sseChunks = [
      'event: token\r\n',
      'id: 101\r\n',
      'data: {"token": "The"}\r\n\r\n',
      ': ping comment\r\n',
      'event: token\r\n',
      'id: 102\r\n',
      'data: {"token": " answer"}\r\n\r\n',
      'event: done\r\n',
      'data: [DONE]\r\n\r\n',
    ];

    const mockFetch = vi.fn().mockImplementation(() => {
      return Promise.resolve(
        new Response(createMockStream(sseChunks), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );
    });

    const client = createInstance({ fetch: mockFetch });
    const stream = await client.stream('https://api.openai.com/v1/chat/completions');

    const messages = [];
    for await (const msg of stream.sse()) {
      messages.push(msg);
    }

    expect(messages.length).toBe(3);

    // First event
    expect(messages[0].event).toBe('token');
    expect(messages[0].id).toBe('101');
    expect(messages[0].data).toBe('{"token": "The"}');
    expect(messages[0].json()).toEqual({ token: 'The' });

    // Second event
    expect(messages[1].event).toBe('token');
    expect(messages[1].id).toBe('102');
    expect(messages[1].json()).toEqual({ token: ' answer' });

    // Third event
    expect(messages[2].event).toBe('done');
    expect(messages[2].data).toBe('[DONE]');
  });

  it('handles multi-line data in SSE messages correctly', async () => {
    const rawSSE =
      'data: first line\n' +
      'data: second line\n\n';

    const stream = createMockStream([rawSSE]);
    const messages = [];
    for await (const msg of parseSSEStream(stream)) {
      messages.push(msg);
    }

    expect(messages.length).toBe(1);
    expect(messages[0].data).toBe('first line\nsecond line');
  });

  it('accumulates stream to text using stream.text()', async () => {
    const mockChunks = ['Stream', ' to', ' full', ' text'];
    const mockFetch = vi.fn().mockImplementation(() => {
      return Promise.resolve(
        new Response(createMockStream(mockChunks), {
          status: 200,
        })
      );
    });

    const client = createInstance({ fetch: mockFetch });
    const stream = await client.stream('https://api.example.com/accumulate');

    const fullText = await stream.text();
    expect(fullText).toBe('Stream to full text');
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  createInstance,
  VexaError,
  parseRetryAfter,
  calculateRetryDelay,
  normalizeRetryConfig,
} from '../src/index.js';

describe('Vexa Automatic Retries & Backoff', () => {
  it('parses Retry-After headers in seconds and HTTP-date formats', () => {
    // Seconds format
    expect(parseRetryAfter('120')).toBe(120000);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('invalid')).toBe(null);
    expect(parseRetryAfter(null)).toBe(null);

    // HTTP-date format (5 seconds in the future)
    const futureDate = new Date(Date.now() + 5000).toUTCString();
    const parsedDate = parseRetryAfter(futureDate);
    expect(parsedDate).toBeGreaterThan(3000);
    expect(parsedDate).toBeLessThanOrEqual(6000);
  });

  it('calculates retry delay using backoff and respects Retry-After header', () => {
    const config = normalizeRetryConfig({
      limit: 3,
      backoff: (attempt) => attempt * 100,
      maxDelay: 5000,
    });

    // Custom backoff calculation
    expect(calculateRetryDelay(1, config)).toBe(100);
    expect(calculateRetryDelay(2, config)).toBe(200);

    // Response with Retry-After header overrides backoff
    const responseWithRetryAfter = new Response('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': '2' },
    });
    expect(
      calculateRetryDelay(1, config, responseWithRetryAfter)
    ).toBe(2000);
  });

  it('retries on transient status codes (500) and succeeds when server recovers', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const beforeRetryHook = vi.fn();
    const client = createInstance({
      fetch: mockFetch,
      retry: {
        limit: 3,
        backoff: () => 1, // minimal delay for test speed
      },
      hooks: {
        beforeRetry: [beforeRetryHook],
      },
    });

    const res = await client.get('https://api.example.com/flaky');

    expect(callCount).toBe(3);
    expect(res.data).toEqual({ success: true });
    expect(beforeRetryHook).toHaveBeenCalledTimes(2);
    expect(beforeRetryHook).toHaveBeenNthCalledWith(
      1,
      expect.any(VexaError),
      1
    );
    expect(beforeRetryHook).toHaveBeenNthCalledWith(
      2,
      expect.any(VexaError),
      2
    );
  });

  it('does not retry non-retryable 4xx client errors (400, 404)', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'Bad Request' }), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const client = createInstance({
      fetch: mockFetch,
      retry: { limit: 3, backoff: () => 1 },
    });

    await expect(client.get('https://api.example.com/bad')).rejects.toThrow(
      VexaError
    );
    expect(callCount).toBe(1);
  });

  it('retries on network fetch rejection and throws VexaError when retries are exhausted', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.reject(new TypeError('Failed to fetch (network down)'));
    });

    const client = createInstance({
      fetch: mockFetch,
      retry: { limit: 2, backoff: () => 1 },
    });

    const errorPromise = client.get('https://api.example.com/network-error');

    await expect(errorPromise).rejects.toThrow(VexaError);
    // 1 initial attempt + 2 retries = 3 attempts total
    expect(callCount).toBe(3);
  });

  it('disables retries when retry is set to false or limit: 0', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(
        new Response('Gateway Timeout', { status: 504 })
      );
    });

    const client = createInstance({
      fetch: mockFetch,
      retry: false,
    });

    await expect(client.get('https://api.example.com/timeout')).rejects.toThrow(
      VexaError
    );
    expect(callCount).toBe(1);
  });
});

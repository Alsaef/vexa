import { describe, it, expect, vi } from 'vitest';
import { createInstance, VexaError } from '../src/index.js';

describe('Vexa In-Flight Request Deduplication', () => {
  it('deduplicates concurrent identical GET requests into a single network fetch', async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCount++;
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(
            new Response(
              JSON.stringify({ timestamp: Date.now(), items: [1, 2, 3] }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }
            )
          );
        }, 30);
      });
    });

    const client = createInstance({ fetch: mockFetch });

    // Trigger 5 concurrent identical GET requests
    const [res1, res2, res3, res4, res5] = await Promise.all([
      client.get('https://api.example.com/dedupe-test'),
      client.get('https://api.example.com/dedupe-test'),
      client.get('https://api.example.com/dedupe-test'),
      client.get('https://api.example.com/dedupe-test'),
      client.get('https://api.example.com/dedupe-test'),
    ]);

    // Only 1 underlying fetch should be dispatched!
    expect(fetchCount).toBe(1);

    // All callers get valid data without stream locking errors
    expect(res1.data).toEqual(res2.data);
    expect(res2.data).toEqual(res3.data);
    expect(res3.data).toEqual(res4.data);
    expect(res4.data).toEqual(res5.data);
    expect(res1.status).toBe(200);
  });

  it('allows callers to consume bodies independently without "body already read" errors', async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(
            new Response('sample text payload', {
              status: 200,
              headers: { 'Content-Type': 'text/plain' },
            })
          );
        }, 20);
      });
    });

    const client = createInstance({ fetch: mockFetch });

    const p1 = client.get('https://api.example.com/text-data', { responseType: 'text' });
    const p2 = client.get('https://api.example.com/text-data', { responseType: 'text' });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(r1.data).toBe('sample text payload');
    expect(r2.data).toBe('sample text payload');
  });

  it('subsequent requests after completion initiate a new network fetch', async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ count: fetchCount }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const client = createInstance({ fetch: mockFetch });

    // First request
    const r1 = await client.get('https://api.example.com/counter');
    expect(r1.data).toEqual({ count: 1 });
    expect(fetchCount).toBe(1);

    // Second request after first has completed
    const r2 = await client.get('https://api.example.com/counter');
    expect(r2.data).toEqual({ count: 2 });
    expect(fetchCount).toBe(2);
  });

  it('does not deduplicate POST requests by default', async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ id: fetchCount }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const client = createInstance({ fetch: mockFetch });

    await Promise.all([
      client.post('https://api.example.com/orders', { item: 'book' }),
      client.post('https://api.example.com/orders', { item: 'book' }),
    ]);

    expect(fetchCount).toBe(2);
  });

  it('bypasses deduplication when dedupe: false is set', async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCount++;
      return Promise.resolve(new Response('OK', { status: 200 }));
    });

    const client = createInstance({ fetch: mockFetch });

    await Promise.all([
      client.get('https://api.example.com/skip', { dedupe: false }),
      client.get('https://api.example.com/skip', { dedupe: false }),
    ]);

    expect(fetchCount).toBe(2);
  });

  it('broadcasts rejection to all concurrent followers if the leader fetch fails', async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      return new Promise<Response>((_, reject) => {
        setTimeout(() => {
          reject(new TypeError('Connection reset'));
        }, 20);
      });
    });

    const client = createInstance({
      fetch: mockFetch,
      retry: false,
    });

    const p1 = client.get('https://api.example.com/failing');
    const p2 = client.get('https://api.example.com/failing');

    await expect(p1).rejects.toThrow(VexaError);
    await expect(p2).rejects.toThrow(VexaError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

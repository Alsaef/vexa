import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vexa, createInstance, VexaTimeoutError, VexaError } from '../src/index.js';

describe('Vexa Client Core', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('performs direct call with default exported vexa instance', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ defaultInstance: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = mockFetch;

    try {
      const res = await vexa.get('https://api.example.com/global');
      expect(res.data).toEqual({ defaultInstance: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('performs direct call vexa(url) for GET request', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'hello' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createInstance({ fetch: mockFetch });
    const res = await client('https://api.example.com/test');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ message: 'hello' });
    expect(res.url).toBe('https://api.example.com/test');
  });

  it('supports shorthand methods: get, post, put, patch, delete, head', async () => {
    const mockFetch = vi.fn().mockImplementation((req: Request) => {
      const method = req.method;
      return Promise.resolve(
        new Response(JSON.stringify({ method }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const client = createInstance({ fetch: mockFetch });

    const getRes = await client.get('https://api.example.com/get');
    expect(getRes.data).toEqual({ method: 'GET' });

    const postRes = await client.post('https://api.example.com/post', { name: 'Alice' });
    expect(postRes.data).toEqual({ method: 'POST' });

    const putRes = await client.put('https://api.example.com/put', { name: 'Bob' });
    expect(putRes.data).toEqual({ method: 'PUT' });

    const patchRes = await client.patch('https://api.example.com/patch', { active: true });
    expect(patchRes.data).toEqual({ method: 'PATCH' });

    const deleteRes = await client.delete('https://api.example.com/delete');
    expect(deleteRes.data).toEqual({ method: 'DELETE' });

    const headRes = await client.head('https://api.example.com/head');
    expect(headRes.status).toBe(200);
  });

  it('resolves baseURL correctly with leading and trailing slashes', async () => {
    let requestedUrl = '';
    const mockFetch = vi.fn().mockImplementation((req: Request) => {
      requestedUrl = req.url;
      return Promise.resolve(new Response('OK', { status: 200 }));
    });

    const client = createInstance({
      baseURL: 'https://api.example.com/v1/',
      fetch: mockFetch,
    });

    await client.get('/users');
    expect(requestedUrl).toBe('https://api.example.com/v1/users');

    await client.get('posts');
    expect(requestedUrl).toBe('https://api.example.com/v1/posts');

    // Absolute URLs should bypass baseURL
    await client.get('https://other-domain.com/data');
    expect(requestedUrl).toBe('https://other-domain.com/data');
  });

  it('interpolates path parameters (:param and {param})', async () => {
    let requestedUrl = '';
    const mockFetch = vi.fn().mockImplementation((req: Request) => {
      requestedUrl = req.url;
      return Promise.resolve(new Response('OK', { status: 200 }));
    });

    const client = createInstance({ fetch: mockFetch });

    await client.get('https://api.example.com/users/:id/posts/{postId}', {
      pathParams: { id: 123, postId: 'abc' },
    });
    expect(requestedUrl).toBe('https://api.example.com/users/123/posts/abc');

    // Throws if path parameter is missing
    await expect(
      client.get('https://api.example.com/users/:id/profile', {
        pathParams: {},
      })
    ).rejects.toThrow('Missing required path parameter "id"');
  });

  it('serializes query parameters including arrays and nested objects', async () => {
    let requestedUrl = '';
    const mockFetch = vi.fn().mockImplementation((req: Request) => {
      requestedUrl = req.url;
      return Promise.resolve(new Response('OK', { status: 200 }));
    });

    const client = createInstance({ fetch: mockFetch });

    await client.get('https://api.example.com/search', {
      params: {
        query: 'test',
        page: 1,
        tags: ['typescript', 'fetch'],
        filter: { status: 'active' },
      },
    });

    const url = new URL(requestedUrl);
    expect(url.searchParams.get('query')).toBe('test');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.getAll('tags[]')).toEqual(['typescript', 'fetch']);
    expect(url.searchParams.get('filter[status]')).toBe('active');
  });

  it('appends params to URLs that already have query strings', async () => {
    let requestedUrl = '';
    const mockFetch = vi.fn().mockImplementation((req: Request) => {
      requestedUrl = req.url;
      return Promise.resolve(new Response('OK', { status: 200 }));
    });

    const client = createInstance({ fetch: mockFetch });
    await client.get('https://api.example.com/items?existing=true', {
      params: { limit: 10 },
    });

    expect(requestedUrl).toBe('https://api.example.com/items?existing=true&limit=10');
  });

  it('automatically serializes plain objects to JSON and sets Content-Type', async () => {
    let capturedReq: Request | null = null;
    const mockFetch = vi.fn().mockImplementation((req: Request) => {
      capturedReq = req;
      return Promise.resolve(new Response('OK', { status: 200 }));
    });

    const client = createInstance({ fetch: mockFetch });
    await client.post('https://api.example.com/users', { name: 'Alice', age: 30 });

    expect(capturedReq).not.null;
    expect(capturedReq!.headers.get('content-type')).toBe('application/json');
    const textBody = await capturedReq!.text();
    expect(JSON.parse(textBody)).toEqual({ name: 'Alice', age: 30 });
  });

  it('passes FormData through without overriding Content-Type', async () => {
    let capturedReq: Request | null = null;
    const mockFetch = vi.fn().mockImplementation((req: Request) => {
      capturedReq = req;
      return Promise.resolve(new Response('OK', { status: 200 }));
    });

    const client = createInstance({ fetch: mockFetch });
    const formData = new FormData();
    formData.append('username', 'testuser');

    await client.post('https://api.example.com/upload', formData);

    expect(capturedReq).not.null;
    // Native fetch sets boundary on multipart/form-data when Content-Type is not manually set
    expect(capturedReq!.headers.get('content-type')).toContain('multipart/form-data');
  });

  it('merges default headers and request headers', async () => {
    let capturedReq: Request | null = null;
    const mockFetch = vi.fn().mockImplementation((req: Request) => {
      capturedReq = req;
      return Promise.resolve(new Response('OK', { status: 200 }));
    });

    const client = createInstance({
      headers: {
        'X-Default': 'default-val',
        'X-Common': 'parent',
      },
      fetch: mockFetch,
    });

    await client.get('https://api.example.com/headers', {
      headers: {
        'X-Common': 'child-override',
        'X-Custom': 'custom-val',
      },
    });

    expect(capturedReq!.headers.get('x-default')).toBe('default-val');
    expect(capturedReq!.headers.get('x-common')).toBe('child-override');
    expect(capturedReq!.headers.get('x-custom')).toBe('custom-val');
  });

  it('aborts and throws VexaTimeoutError when timeout duration is exceeded', async () => {
    const mockFetch = vi.fn().mockImplementation((_req: Request, init: any) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    });

    const client = createInstance({ fetch: mockFetch });

    await expect(
      client.get('https://api.example.com/slow', {
        timeout: 50,
      })
    ).rejects.toThrow(VexaTimeoutError);
  });

  it('executes beforeRequest, afterResponse, and onError lifecycle hooks', async () => {
    const beforeRequestHook = vi.fn((req: Request) => {
      req.headers.set('Authorization', 'Bearer token123');
    });

    const afterResponseHook = vi.fn((_res: Response, data: any) => {
      return { ...data, transformed: true };
    });

    const mockFetch = vi.fn().mockImplementation((_req: Request) => {
      return Promise.resolve(
        new Response(JSON.stringify({ value: 42 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const client = createInstance({
      fetch: mockFetch,
      hooks: {
        beforeRequest: [beforeRequestHook],
        afterResponse: [afterResponseHook],
      },
    });

    const res = await client.get('https://api.example.com/hook-test');

    expect(beforeRequestHook).toHaveBeenCalledTimes(1);
    expect(afterResponseHook).toHaveBeenCalledTimes(1);
    expect(res.data).toEqual({ value: 42, transformed: true });
  });

  it('calls onError hook when an HTTP error status is encountered', async () => {
    const onErrorHook = vi.fn();
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createInstance({
      fetch: mockFetch,
      hooks: {
        onError: [onErrorHook],
      },
    });

    await expect(client.get('https://api.example.com/missing')).rejects.toThrow(VexaError);
    expect(onErrorHook).toHaveBeenCalledTimes(1);
    const err: VexaError = onErrorHook.mock.calls[0][0];
    expect(err.status).toBe(404);
    expect(err.data).toEqual({ error: 'Not Found' });
  });

  it('supports instance.extend() to inherit and augment defaults', async () => {
    let capturedReq: Request | null = null;
    const mockFetch = vi.fn().mockImplementation((req: Request) => {
      capturedReq = req;
      return Promise.resolve(new Response('OK', { status: 200 }));
    });

    const baseClient = createInstance({
      baseURL: 'https://api.example.com',
      headers: { 'X-Api-Key': 'key-1' },
      fetch: mockFetch,
    });

    const tenantClient = baseClient.extend({
      headers: { 'X-Tenant': 'tenant-42' },
    });

    await tenantClient.get('/tenant-data');

    expect(capturedReq!.url).toBe('https://api.example.com/tenant-data');
    expect(capturedReq!.headers.get('x-api-key')).toBe('key-1');
    expect(capturedReq!.headers.get('x-tenant')).toBe('tenant-42');
  });
});

/**
 * Determines whether a value is a plain JavaScript object.
 */
export function isPlainObject(value: unknown): value is Record<string, any> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/**
 * Checks whether a URL is absolute (has protocol or scheme).
 */
export function isAbsoluteURL(url: string): boolean {
  return (
    /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url) ||
    url.startsWith('data:') ||
    url.startsWith('blob:')
  );
}

/**
 * Combines a base URL and relative path cleanly without duplicate slashes.
 */
export function combineURLs(baseURL: string, relativeURL: string): string {
  if (!relativeURL) return baseURL;
  return `${baseURL.replace(/\/+$/, '')}/${relativeURL.replace(/^\/+/, '')}`;
}

/**
 * Interpolates path parameters into a URL string.
 * Supports both `:param` (e.g. `/users/:id`) and `{param}` (e.g. `/users/{id}`).
 */
export function interpolatePathParams(
  url: string,
  pathParams: Record<string, string | number | boolean>
): string {
  return url.replace(/:([a-zA-Z0-9_]+)|\{([a-zA-Z0-9_]+)\}/g, (_match, p1, p2) => {
    const key = p1 || p2;
    if (Object.prototype.hasOwnProperty.call(pathParams, key)) {
      const val = pathParams[key];
      return encodeURIComponent(String(val));
    }
    throw new Error(
      `Missing required path parameter "${key}" for URL template: ${url}`
    );
  });
}

/**
 * Serializes query parameters into a clean URL-encoded string.
 * Supports primitives, arrays (`tags[]=a&tags[]=b`), and nested objects (`filter[status]=active`).
 */
export function serializeParams(
  params: Record<string, any> | URLSearchParams | string
): string {
  if (typeof params === 'string') return params;
  if (params instanceof URLSearchParams) return params.toString();

  const pairs: string[] = [];

  function buildPairs(prefix: string, value: any) {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && item !== undefined) {
          if (typeof item === 'object') {
            buildPairs(`${prefix}[]`, item);
          } else {
            pairs.push(
              `${encodeURIComponent(prefix)}[]=${encodeURIComponent(String(item))}`
            );
          }
        }
      }
    } else if (
      typeof value === 'object' &&
      !(value instanceof Date) &&
      !(value instanceof RegExp)
    ) {
      for (const key of Object.keys(value)) {
        buildPairs(prefix ? `${prefix}[${key}]` : key, value[key]);
      }
    } else if (value instanceof Date) {
      pairs.push(
        `${encodeURIComponent(prefix)}=${encodeURIComponent(value.toISOString())}`
      );
    } else {
      pairs.push(
        `${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`
      );
    }
  }

  for (const key of Object.keys(params)) {
    buildPairs(key, params[key]);
  }

  return pairs.join('&');
}

/**
 * Builds the full normalized URL including baseURL, pathParams, and query params.
 */
export function buildURL(
  url: string | URL,
  baseURL?: string,
  params?: Record<string, any> | URLSearchParams | string,
  pathParams?: Record<string, string | number | boolean>
): string {
  let finalUrl = typeof url === 'string' ? url : url.toString();

  if (pathParams) {
    finalUrl = interpolatePathParams(finalUrl, pathParams);
  }

  if (baseURL && !isAbsoluteURL(finalUrl)) {
    finalUrl = combineURLs(baseURL, finalUrl);
  }

  if (params) {
    const queryString = serializeParams(params);
    if (queryString) {
      const hashIndex = finalUrl.indexOf('#');
      let hash = '';
      if (hashIndex !== -1) {
        hash = finalUrl.slice(hashIndex);
        finalUrl = finalUrl.slice(0, hashIndex);
      }
      const separator = finalUrl.includes('?') ? '&' : '?';
      finalUrl = `${finalUrl}${separator}${queryString}${hash}`;
    }
  }

  return finalUrl;
}

/**
 * Merges default headers and per-request headers into a unified Headers object.
 */
export function mergeHeaders(
  defaultHeaders?: HeadersInit | Record<string, any>,
  requestHeaders?: HeadersInit | Record<string, any>
): Headers {
  const merged = new Headers();

  function append(source?: HeadersInit | Record<string, any>) {
    if (!source) return;
    if (source instanceof Headers) {
      source.forEach((value, key) => {
        merged.set(key, value);
      });
    } else if (Array.isArray(source)) {
      for (const [key, value] of source) {
        if (value !== undefined && value !== null) {
          merged.set(key, String(value));
        }
      }
    } else if (typeof source === 'object') {
      for (const [key, value] of Object.entries(source)) {
        if (value === null) {
          merged.delete(key);
        } else if (value !== undefined) {
          merged.set(key, String(value));
        }
      }
    }
  }

  append(defaultHeaders);
  append(requestHeaders);
  return merged;
}

/**
 * Serializes request body and sets default Content-Type header if needed.
 */
export function serializeRequestBody(
  body: any,
  headers: Headers
): BodyInit | null | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (isPlainObject(body) || Array.isArray(body)) {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return JSON.stringify(body);
  }

  if (body instanceof URLSearchParams) {
    if (!headers.has('content-type')) {
      headers.set(
        'content-type',
        'application/x-www-form-urlencoded;charset=UTF-8'
      );
    }
    return body.toString();
  }

  // Native types: FormData, Blob, ArrayBuffer, ReadableStream, string
  return body as BodyInit;
}

/**
 * Delay execution for a given number of milliseconds.
 */
export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason ?? new Error('Aborted'));
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Aborted'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Polyfill-safe AbortSignal.any combining multiple abort signals.
 */
export function createCompositeSignal(
  signals: Array<AbortSignal | null | undefined>
): { signal: AbortSignal; cleanup: () => void } {
  const activeSignals = signals.filter((s): s is AbortSignal => Boolean(s));

  // If environment supports AbortSignal.any natively
  if (typeof (AbortSignal as any).any === 'function') {
    return {
      signal: (AbortSignal as any).any(activeSignals),
      cleanup: () => {},
    };
  }

  // Fallback for older runtimes
  const controller = new AbortController();
  const onAbort = (e: Event) => {
    const target = e.target as AbortSignal;
    controller.abort(target.reason);
  };

  for (const sig of activeSignals) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      break;
    }
    sig.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const sig of activeSignals) {
        sig.removeEventListener('abort', onAbort);
      }
    },
  };
}

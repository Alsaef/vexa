import {
  VexaError,
  VexaTimeoutError,
  VexaValidationError,
} from './error.js';
import type {
  InferOutput,
  Schema,
  StandardIssue,
  VexaConfig,
  VexaInstance,
  VexaRequestConfig,
  VexaResponse,
  VexaStreamResponse,
} from './types.js';
import {
  buildURL,
  createCompositeSignal,
  isPlainObject,
  mergeHeaders,
  serializeRequestBody,
  sleep,
} from './utils.js';
import {
  calculateRetryDelay,
  isRetryableMethod,
  isRetryableStatusCode,
  normalizeRetryConfig,
} from './retry.js';
import { defaultDeduplicator, RequestDeduplicator } from './dedupe.js';
import { createStreamResponse, parseSSEStream } from './stream.js';

const KNOWN_CONFIG_KEYS = new Set([
  'baseURL',
  'baseUrl',
  'headers',
  'params',
  'pathParams',
  'timeout',
  'signal',
  'retry',
  'dedupe',
  'responseType',
  'hooks',
  'fetch',
  'body',
  'data',
  'schema',
  'method',
  'cache',
  'credentials',
  'integrity',
  'keepalive',
  'mode',
  'redirect',
  'referrer',
  'referrerPolicy',
]);

/**
 * Parses response body based on expected responseType or Content-Type header.
 */
async function parseResponseBody(
  response: Response,
  responseType?: string
): Promise<any> {
  // If response has no body (e.g. 204 No Content, 205, HEAD requests)
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return null;
  }

  if (responseType === 'stream') {
    return response.body;
  }

  if (responseType === 'raw') {
    return response;
  }

  if (responseType === 'blob') {
    return response.blob();
  }

  if (responseType === 'arrayBuffer') {
    return response.arrayBuffer();
  }

  if (responseType === 'text') {
    return response.text();
  }

  if (responseType === 'json') {
    const text = await response.text();
    return text.trim().length > 0 ? JSON.parse(text) : null;
  }

  // Default: Smart Content-Type detection
  const contentType = response.headers.get('content-type') || '';
  if (
    contentType.includes('application/json') ||
    contentType.includes('+json')
  ) {
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // Fallback to text; attempt JSON parse if text resembles JSON
  const text = await response.text();
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }

  return text;
}

/**
 * Validates data against Standard Schema or custom validator function.
 */
async function validateSchema<T>(
  schema: Schema<T>,
  data: unknown,
  request: Request,
  response: Response,
  config: VexaRequestConfig
): Promise<T> {
  if (
    typeof schema === 'object' &&
    schema !== null &&
    '~standard' in schema &&
    typeof (schema as any)['~standard']?.validate === 'function'
  ) {
    const result = await (schema as any)['~standard'].validate(data);
    if (result.issues && result.issues.length > 0) {
      throw new VexaValidationError({
        request,
        response,
        config,
        status: response.status,
        statusText: response.statusText,
        issues: result.issues as ReadonlyArray<StandardIssue>,
        data,
      });
    }
    return result.value as T;
  }

  if (typeof schema === 'function') {
    try {
      return (await schema(data)) as T;
    } catch (err) {
      const issue: StandardIssue = {
        message: err instanceof Error ? err.message : String(err),
      };
      throw new VexaValidationError({
        request,
        response,
        config,
        status: response.status,
        statusText: response.statusText,
        issues: [issue],
        data,
        cause: err,
      });
    }
  }

  return data as T;
}

/**
 * Merges parent and child configurations.
 */
export function mergeConfig(
  parent: VexaConfig = {},
  child: VexaRequestConfig = {}
): VexaRequestConfig {
  const merged: VexaRequestConfig = {
    ...parent,
    ...child,
  };

  merged.headers = mergeHeaders(parent.headers, child.headers);

  // Combine hooks
  if (parent.hooks || child.hooks) {
    merged.hooks = {
      beforeRequest: [
        ...(parent.hooks?.beforeRequest ?? []),
        ...(child.hooks?.beforeRequest ?? []),
      ],
      beforeRetry: [
        ...(parent.hooks?.beforeRetry ?? []),
        ...(child.hooks?.beforeRetry ?? []),
      ],
      afterResponse: [
        ...(parent.hooks?.afterResponse ?? []),
        ...(child.hooks?.afterResponse ?? []),
      ],
      onError: [
        ...(parent.hooks?.onError ?? []),
        ...(child.hooks?.onError ?? []),
      ],
    };
  }

  // BaseURL resolution
  merged.baseURL = child.baseURL ?? child.baseUrl ?? parent.baseURL ?? parent.baseUrl;

  return merged;
}

/**
 * Dispatches a single HTTP request with timeout, retries, hooks, and deduplication.
 */
async function executeRequest<T = unknown>(
  url: string | URL,
  config: VexaRequestConfig,
  defaultConfig: VexaConfig,
  deduplicator: RequestDeduplicator
): Promise<VexaResponse<T>> {
  const mergedConfig = mergeConfig(defaultConfig, config);
  const fetchImpl = mergedConfig.fetch || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation found in current environment.');
  }

  const rawUrl = url;
  const method = (mergedConfig.method || 'GET').toUpperCase();
  const retryConfig = normalizeRetryConfig(mergedConfig.retry);
  const hooks = mergedConfig.hooks;

  // Build final URL with pathParams, baseURL, and query params
  const finalUrl = buildURL(
    rawUrl,
    mergedConfig.baseURL,
    mergedConfig.params,
    mergedConfig.pathParams
  );

  // Prepare headers & serialized body
  const requestHeaders = (mergedConfig.headers instanceof Headers)
    ? mergedConfig.headers
    : mergeHeaders(undefined, mergedConfig.headers);

  const rawBody = mergedConfig.body !== undefined ? mergedConfig.body : mergedConfig.data;
  const serializedBody = (method === 'GET' || method === 'HEAD')
    ? undefined
    : serializeRequestBody(rawBody, requestHeaders);

  // Construct initial Request instance
  let request = new Request(finalUrl, {
    method,
    headers: requestHeaders,
    body: serializedBody,
    cache: mergedConfig.cache,
    credentials: mergedConfig.credentials,
    integrity: mergedConfig.integrity,
    keepalive: mergedConfig.keepalive,
    mode: mergedConfig.mode,
    redirect: mergedConfig.redirect,
    referrer: mergedConfig.referrer,
    referrerPolicy: mergedConfig.referrerPolicy,
  });

  // Execute beforeRequest lifecycle hooks
  if (hooks?.beforeRequest && hooks.beforeRequest.length > 0) {
    for (const hook of hooks.beforeRequest) {
      const modified = await hook(request, mergedConfig);
      if (modified instanceof Request) {
        request = modified;
      }
    }
  }

  // Setup timeout & cancellation
  let timeoutController: AbortController | undefined;
  let timeoutTimer: any;
  let didTimeout = false;

  if (mergedConfig.timeout && mergedConfig.timeout > 0) {
    timeoutController = new AbortController();
    timeoutTimer = setTimeout(() => {
      didTimeout = true;
      timeoutController?.abort(
        new Error(`Request timed out after ${mergedConfig.timeout}ms`)
      );
    }, mergedConfig.timeout);
  }

  const { signal: compositeSignal, cleanup: cleanupSignal } = createCompositeSignal([
    mergedConfig.signal,
    timeoutController?.signal,
  ]);

  // Core fetch execution with retries
  const performFetch = async (): Promise<Response> => {
    let attempt = 1;

    while (true) {
      try {
        if (compositeSignal.aborted) {
          if (didTimeout) {
            throw new VexaTimeoutError({
              request,
              config: mergedConfig,
              timeout: mergedConfig.timeout!,
            });
          }
          throw compositeSignal.reason ?? new Error('Aborted');
        }

        // Clone request if needed so stream body is reusable across retries
        const reqForFetch =
          request.body && attempt > 1 ? request.clone() : request;

        const response = await fetchImpl(reqForFetch, {
          signal: compositeSignal,
        });

        // Check if response is HTTP error (4xx / 5xx)
        if (!response.ok) {
          const isRetryable =
            isRetryableStatusCode(response.status, retryConfig.statusCodes) &&
            isRetryableMethod(method, retryConfig.methods);

          if (isRetryable && attempt <= retryConfig.limit) {
            const delay = calculateRetryDelay(attempt, retryConfig, response);

            if (hooks?.beforeRetry && hooks.beforeRetry.length > 0) {
              const retryErr = new VexaError({
                status: response.status,
                statusText: response.statusText,
                request,
                response,
                config: mergedConfig,
                isRetryable: true,
              });
              for (const hook of hooks.beforeRetry) {
                await hook(retryErr, attempt);
              }
            }

            await sleep(delay, compositeSignal);
            attempt++;
            continue;
          }

          // Error is not retryable or retries exhausted
          const errorBody = await parseResponseBody(response, mergedConfig.responseType);
          const error = new VexaError({
            status: response.status,
            statusText: response.statusText,
            data: errorBody,
            request,
            response,
            config: mergedConfig,
            isRetryable,
          });

          if (hooks?.onError && hooks.onError.length > 0) {
            for (const hook of hooks.onError) {
              await hook(error);
            }
          }

          throw error;
        }

        // Request succeeded!
        return response;
      } catch (err: any) {
        // If it's already an instance of VexaError, rethrow
        if (err instanceof VexaError) {
          throw err;
        }

        // Handle Abort / Timeout
        if (didTimeout || (err?.name === 'AbortError' && didTimeout)) {
          const timeoutErr = new VexaTimeoutError({
            request,
            config: mergedConfig,
            timeout: mergedConfig.timeout!,
            cause: err,
          });
          if (hooks?.onError && hooks.onError.length > 0) {
            for (const hook of hooks.onError) {
              await hook(timeoutErr);
            }
          }
          throw timeoutErr;
        }

        if (compositeSignal.aborted && !didTimeout) {
          throw err;
        }

        // Network failure / fetch rejection
        const isRetryable =
          isRetryableMethod(method, retryConfig.methods) &&
          attempt <= retryConfig.limit;

        if (isRetryable) {
          const delay = calculateRetryDelay(attempt, retryConfig);

          if (hooks?.beforeRetry && hooks.beforeRetry.length > 0) {
            const retryErr = new VexaError({
              request,
              config: mergedConfig,
              isRetryable: true,
              cause: err,
            });
            for (const hook of hooks.beforeRetry) {
              await hook(retryErr, attempt);
            }
          }

          await sleep(delay, compositeSignal);
          attempt++;
          continue;
        }

        // Retries exhausted for network failure
        const networkError = new VexaError({
          message: err instanceof Error ? err.message : String(err),
          request,
          config: mergedConfig,
          isRetryable: isRetryableMethod(method, retryConfig.methods),
          cause: err,
        });

        if (hooks?.onError && hooks.onError.length > 0) {
          for (const hook of hooks.onError) {
            await hook(networkError);
          }
        }

        throw networkError;
      }
    }
  };

  try {
    let response: Response;

    if (deduplicator.shouldDedupe(method, mergedConfig.dedupe)) {
      const dedupeKey = deduplicator.generateKey(request, mergedConfig);
      response = await deduplicator.execute(
        dedupeKey,
        compositeSignal,
        performFetch
      );
    } else {
      response = await performFetch();
    }

    // Parse response body
    let parsedData = await parseResponseBody(response, mergedConfig.responseType);

    // Run afterResponse lifecycle hooks
    if (hooks?.afterResponse && hooks.afterResponse.length > 0) {
      for (const hook of hooks.afterResponse) {
        const transformed = await hook(response, parsedData, mergedConfig);
        if (transformed !== undefined) {
          parsedData = transformed;
        }
      }
    }

    // Run runtime schema validation if configured
    if (mergedConfig.schema) {
      try {
        parsedData = await validateSchema(
          mergedConfig.schema,
          parsedData,
          request,
          response,
          mergedConfig
        );
      } catch (valErr: any) {
        if (valErr instanceof VexaError && hooks?.onError && hooks.onError.length > 0) {
          for (const hook of hooks.onError) {
            await hook(valErr);
          }
        }
        throw valErr;
      }
    }

    const vexaResponse: VexaResponse<T> = {
      data: parsedData as T,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      ok: response.ok,
      url: response.url || request.url,
      request,
      response,
      raw: response,
      config: mergedConfig,
      sse() {
        if (response.body) {
          return parseSSEStream(response.body);
        }
        throw new Error('Response body is null or already consumed; cannot stream SSE.');
      },
    };

    return vexaResponse;
  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
    cleanupSignal();
  }
}

/**
 * Normalizes arguments for POST, PUT, and PATCH helper methods.
 */
function normalizeMethodArgs(
  method: string,
  url: string | URL,
  arg2?: any,
  arg3?: VexaRequestConfig
): { url: string | URL; config: VexaRequestConfig } {
  if (arg3 !== undefined) {
    return {
      url,
      config: { ...arg3, method, data: arg2 },
    };
  }

  if (arg2 === undefined || arg2 === null) {
    return { url, config: { method } };
  }

  // If arg2 has explicit body or data property
  if (isPlainObject(arg2) && ('data' in arg2 || 'body' in arg2)) {
    return { url, config: { ...arg2, method } };
  }

  // If arg2 is a plain object whose keys are all known VexaConfig properties
  if (isPlainObject(arg2)) {
    const keys = Object.keys(arg2);
    const hasOnlyConfigKeys =
      keys.length > 0 && keys.every((k) => KNOWN_CONFIG_KEYS.has(k));
    if (hasOnlyConfigKeys) {
      return { url, config: { ...arg2, method } };
    }
  }

  // Otherwise treat arg2 as the request body / data payload
  return {
    url,
    config: { method, data: arg2 },
  };
}

/**
 * Creates a new Vexa instance configured with default options.
 */
export function createInstance(
  defaults: VexaConfig = {},
  deduplicator = defaultDeduplicator
): VexaInstance {
  const instance = async function vexa<
    T = unknown,
    S extends Schema<any> | undefined = undefined
  >(
    url: string | URL,
    config?: VexaRequestConfig<T, S>
  ): Promise<VexaResponse<S extends Schema<any> ? InferOutput<S> : T>> {
    return executeRequest(
      url,
      config || {},
      defaults,
      deduplicator
    ) as Promise<VexaResponse<S extends Schema<any> ? InferOutput<S> : T>>;
  } as VexaInstance;

  instance.defaults = defaults;

  instance.create = function create(newDefaults: VexaConfig = {}): VexaInstance {
    return createInstance(newDefaults, new RequestDeduplicator());
  };

  instance.extend = function extend(customConfig: VexaConfig = {}): VexaInstance {
    return createInstance(
      mergeConfig(defaults, customConfig),
      deduplicator
    );
  };

  instance.get = function get<
    T = unknown,
    S extends Schema<any> | undefined = undefined
  >(
    url: string | URL,
    config?: VexaRequestConfig<T, S>
  ) {
    return instance(url, { ...config, method: 'GET' });
  };

  instance.delete = function del<
    T = unknown,
    S extends Schema<any> | undefined = undefined
  >(
    url: string | URL,
    config?: VexaRequestConfig<T, S>
  ) {
    return instance(url, { ...config, method: 'DELETE' });
  };

  instance.head = function head<
    T = unknown,
    S extends Schema<any> | undefined = undefined
  >(
    url: string | URL,
    config?: VexaRequestConfig<T, S>
  ) {
    return instance(url, { ...config, method: 'HEAD' });
  };

  instance.post = function post<
    T = unknown,
    S extends Schema<any> | undefined = undefined
  >(
    url: string | URL,
    arg2?: any,
    arg3?: VexaRequestConfig<T, S>
  ) {
    const { url: targetUrl, config } = normalizeMethodArgs(
      'POST',
      url,
      arg2,
      arg3
    );
    return instance(targetUrl, config);
  };

  instance.put = function put<
    T = unknown,
    S extends Schema<any> | undefined = undefined
  >(
    url: string | URL,
    arg2?: any,
    arg3?: VexaRequestConfig<T, S>
  ) {
    const { url: targetUrl, config } = normalizeMethodArgs('PUT', url, arg2, arg3);
    return instance(targetUrl, config);
  };

  instance.patch = function patch<
    T = unknown,
    S extends Schema<any> | undefined = undefined
  >(
    url: string | URL,
    arg2?: any,
    arg3?: VexaRequestConfig<T, S>
  ) {
    const { url: targetUrl, config } = normalizeMethodArgs(
      'PATCH',
      url,
      arg2,
      arg3
    );
    return instance(targetUrl, config);
  };

  instance.stream = async function stream(
    url: string | URL,
    config: VexaRequestConfig = {}
  ): Promise<VexaStreamResponse> {
    const res = await instance(url, {
      ...config,
      responseType: 'stream',
    });
    return createStreamResponse(res.request, res.raw, res.config);
  };

  return instance;
}

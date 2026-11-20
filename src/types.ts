import type { VexaError } from './error.js';

/**
 * Standard Schema v1 specification interfaces.
 * Works natively with Zod (v3.24+), Valibot, ArkType, and any Standard Schema compliant library.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
  };
}

export type StandardResult<Output> =
  | StandardSuccessResult<Output>
  | StandardFailureResult;

export interface StandardSuccessResult<Output> {
  readonly value: Output;
  readonly issues?: undefined;
}

export interface StandardFailureResult {
  readonly issues: ReadonlyArray<StandardIssue>;
}

export interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

/**
 * Custom validator function returning parsed data or throwing/rejecting.
 */
export type CustomValidator<T> = (data: unknown) => T | Promise<T>;

/**
 * Supported runtime schema validation: Standard Schema or custom validator function.
 */
export type Schema<T = any> = StandardSchemaV1<unknown, T> | CustomValidator<T>;

/**
 * Utility type to infer output type from a Standard Schema or custom validator function.
 */
export type InferOutput<S> = S extends {
  readonly '~standard': { readonly types?: { readonly output: infer O } };
}
  ? O
  : S extends {
      readonly '~standard': {
        readonly validate: (
          ...args: any[]
        ) =>
          | { readonly value: infer O }
          | Promise<{ readonly value: infer O }>;
      };
    }
  ? O
  : S extends (data: any) => infer R | Promise<infer R>
  ? R
  : unknown;

/**
 * Supported HTTP methods.
 */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | (string & {});

/**
 * Supported response parsing types.
 */
export type ResponseType =
  | 'json'
  | 'text'
  | 'blob'
  | 'arrayBuffer'
  | 'stream'
  | 'raw';

/**
 * Configuration options for automatic retries with exponential backoff and jitter.
 */
export interface VexaRetryConfig {
  /** Maximum number of retry attempts. Default: 2 */
  limit?: number;
  /** HTTP methods eligible for retry. Default: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'] */
  methods?: string[];
  /** HTTP status codes eligible for retry. Default: [408, 429, 500, 502, 503, 504] */
  statusCodes?: number[];
  /** Custom exponential backoff calculation function in milliseconds. */
  backoff?: (attempt: number) => number;
  /** Whether to respect the HTTP Retry-After header. Default: true */
  retryAfter?: boolean;
  /** Minimum backoff delay in ms. Default: 200 */
  minDelay?: number;
  /** Maximum backoff delay in ms. Default: 30000 */
  maxDelay?: number;
}

/**
 * Non-mutating lifecycle hooks for request and response interception.
 */
export interface VexaHooks {
  /**
   * Runs before the request is dispatched.
   * Can inspect or return a new Request instance.
   */
  beforeRequest?: Array<
    (
      request: Request,
      config: VexaRequestConfig
    ) => Request | void | Promise<Request | void>
  >;

  /**
   * Runs before a retry attempt is initiated.
   */
  beforeRetry?: Array<
    (error: VexaError, attempt: number) => void | Promise<void>
  >;

  /**
   * Runs after a successful response is received and parsed.
   * Can return modified data.
   */
  afterResponse?: Array<
    (
      response: Response,
      data: unknown,
      config: VexaRequestConfig
    ) => unknown | Promise<unknown>
  >;

  /**
   * Runs whenever an error is encountered (either network or HTTP error).
   */
  onError?: Array<(error: VexaError) => void | Promise<void>>;
}

/**
 * Server-Sent Events (SSE) parsed message.
 */
export interface SSEMessage<T = any> {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
  /** Parses the message data as JSON safely. */
  json: () => T;
}

/**
 * Base configuration options for a Vexa instance or request.
 */
export interface VexaConfig
  extends Omit<RequestInit, 'headers' | 'body' | 'signal'> {
  /** Base URL prepended to relative request paths. */
  baseURL?: string;
  /** Alias for baseURL. */
  baseUrl?: string;
  /** Default or request-specific HTTP headers. */
  headers?:
    | HeadersInit
    | Record<string, string | number | boolean | null | undefined>;
  /** Query parameters serialized onto the request URL. Supports arrays & nested objects. */
  params?: Record<string, any> | URLSearchParams | string;
  /** Path parameters interpolated into URL path (e.g. `/users/:id` or `/users/{id}`). */
  pathParams?: Record<string, string | number | boolean>;
  /** Request timeout in milliseconds. Aborts request when exceeded. */
  timeout?: number;
  /** AbortSignal for external request cancellation. */
  signal?: AbortSignal | null;
  /** Automatic retry options or number of retries or boolean. Default: { limit: 2 } */
  retry?: number | boolean | VexaRetryConfig;
  /** In-flight request deduplication (enabled by default for GET requests). */
  dedupe?:
    | boolean
    | {
        key?: (request: Request, config: VexaRequestConfig) => string;
      };
  /** Expected response parsing strategy. Default: smart JSON/text detection. */
  responseType?: ResponseType;
  /** Non-mutating lifecycle hooks. */
  hooks?: VexaHooks;
  /** Custom fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch;
}

/**
 * Full configuration for an individual Vexa request.
 */
export interface VexaRequestConfig<
  T = any,
  S extends Schema<any> | undefined = any
> extends VexaConfig {
  method?: HttpMethod;
  /** Request body. Plain objects/arrays are serialized to JSON with application/json header. */
  body?: T;
  /** Alias for body. */
  data?: T;
  /** Optional Standard Schema or custom validator function for runtime validation & return typing. */
  schema?: S;
}

/**
 * Vexa response representation wrapping the native Fetch Response.
 */
export interface VexaResponse<T = unknown> {
  /** Parsed response payload (typed via generics or runtime schema). */
  readonly data: T;
  /** HTTP status code (e.g. 200, 404). */
  readonly status: number;
  /** HTTP status message. */
  readonly statusText: string;
  /** Response headers. */
  readonly headers: Headers;
  /** Boolean indicating whether status is in the range 200-299. */
  readonly ok: boolean;
  /** The final URL of the response after any redirects. */
  readonly url: string;
  /** The Request instance used for the fetch. */
  readonly request: Request;
  /** The underlying native Response instance. */
  readonly response: Response;
  /** Alias for response. */
  readonly raw: Response;
  /** Configuration passed to this request. */
  readonly config: VexaRequestConfig;
  /** Server-Sent Events async generator yielding parsed SSEMessage objects. */
  sse: () => AsyncGenerator<SSEMessage, void, unknown>;
}

/**
 * Helper interface for streaming responses (AI token streaming, chunked transfers).
 */
export interface VexaStreamResponse extends AsyncIterable<string> {
  /** The Request instance used for the fetch. */
  readonly request: Request;
  /** The underlying native Response instance. */
  readonly response: Response;
  /** Alias for response. */
  readonly raw: Response;
  /** Configuration passed to this request. */
  readonly config: VexaRequestConfig;
  /** Iterate raw binary chunks as Uint8Array. */
  chunks: () => AsyncIterable<Uint8Array>;
  /** Iterate text lines split by newline. */
  lines: () => AsyncIterable<string>;
  /** Iterate parsed Server-Sent Events (SSE). */
  sse: () => AsyncGenerator<SSEMessage, void, unknown>;
  /** Read full stream as text string. */
  text: () => Promise<string>;
  /** Cancel the stream. */
  cancel: (reason?: string) => Promise<void>;
}

/**
 * Vexa Instance interface with shorthand methods and creation factory.
 */
export interface VexaInstance {
  /** Direct invocation: `vexa(url, config)` */
  <T = unknown, S extends Schema<any> | undefined = undefined>(
    url: string | URL,
    config?: VexaRequestConfig<T, S>
  ): Promise<VexaResponse<S extends Schema<any> ? InferOutput<S> : T>>;

  /** Current default configuration of this instance. */
  defaults: VexaConfig;

  /** Create a new VexaInstance with merged defaults. */
  create(defaultConfig?: VexaConfig): VexaInstance;

  /** Extend the current instance defaults into a new VexaInstance. */
  extend(customConfig?: VexaConfig): VexaInstance;

  /** HTTP GET request shorthand */
  get<T = unknown, S extends Schema<any> | undefined = undefined>(
    url: string | URL,
    config?: VexaRequestConfig<T, S>
  ): Promise<VexaResponse<S extends Schema<any> ? InferOutput<S> : T>>;

  /** HTTP DELETE request shorthand */
  delete<T = unknown, S extends Schema<any> | undefined = undefined>(
    url: string | URL,
    config?: VexaRequestConfig<T, S>
  ): Promise<VexaResponse<S extends Schema<any> ? InferOutput<S> : T>>;

  /** HTTP HEAD request shorthand */
  head<T = unknown, S extends Schema<any> | undefined = undefined>(
    url: string | URL,
    config?: VexaRequestConfig<T, S>
  ): Promise<VexaResponse<S extends Schema<any> ? InferOutput<S> : T>>;

  /** HTTP POST request shorthand */
  post<T = unknown, S extends Schema<any> | undefined = undefined>(
    url: string | URL,
    data?: any,
    config?: VexaRequestConfig<T, S>
  ): Promise<VexaResponse<S extends Schema<any> ? InferOutput<S> : T>>;

  /** HTTP PUT request shorthand */
  put<T = unknown, S extends Schema<any> | undefined = undefined>(
    url: string | URL,
    data?: any,
    config?: VexaRequestConfig<T, S>
  ): Promise<VexaResponse<S extends Schema<any> ? InferOutput<S> : T>>;

  /** HTTP PATCH request shorthand */
  patch<T = unknown, S extends Schema<any> | undefined = undefined>(
    url: string | URL,
    data?: any,
    config?: VexaRequestConfig<T, S>
  ): Promise<VexaResponse<S extends Schema<any> ? InferOutput<S> : T>>;

  /** Streaming request helper for chunked transfer or AI token streams */
  stream(
    url: string | URL,
    config?: VexaRequestConfig
  ): Promise<VexaStreamResponse>;
}

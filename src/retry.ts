import type { VexaRetryConfig } from './types.js';

export const DEFAULT_RETRY_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];
export const DEFAULT_RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504];

export const DEFAULT_RETRY_CONFIG: Required<VexaRetryConfig> = {
  limit: 2,
  methods: DEFAULT_RETRY_METHODS,
  statusCodes: DEFAULT_RETRY_STATUS_CODES,
  retryAfter: true,
  minDelay: 200,
  maxDelay: 30000,
  backoff: (attempt: number) => {
    // Truncated exponential backoff with full jitter
    const min = 200;
    const max = 30000;
    const base = Math.min(max, min * 2 ** (attempt - 1));
    return Math.floor(Math.random() * base);
  },
};

/**
 * Normalizes retry configuration from number, boolean, or config object.
 */
export function normalizeRetryConfig(
  retry?: number | boolean | VexaRetryConfig
): Required<VexaRetryConfig> {
  if (retry === false) {
    return { ...DEFAULT_RETRY_CONFIG, limit: 0 };
  }

  if (retry === true || retry === undefined) {
    return { ...DEFAULT_RETRY_CONFIG };
  }

  if (typeof retry === 'number') {
    return { ...DEFAULT_RETRY_CONFIG, limit: Math.max(0, retry) };
  }

  return {
    limit: retry.limit ?? DEFAULT_RETRY_CONFIG.limit,
    methods: (retry.methods ?? DEFAULT_RETRY_CONFIG.methods).map((m) =>
      m.toUpperCase()
    ),
    statusCodes: retry.statusCodes ?? DEFAULT_RETRY_CONFIG.statusCodes,
    retryAfter: retry.retryAfter ?? DEFAULT_RETRY_CONFIG.retryAfter,
    minDelay: retry.minDelay ?? DEFAULT_RETRY_CONFIG.minDelay,
    maxDelay: retry.maxDelay ?? DEFAULT_RETRY_CONFIG.maxDelay,
    backoff: retry.backoff ?? DEFAULT_RETRY_CONFIG.backoff,
  };
}

/**
 * Parses HTTP `Retry-After` header value into milliseconds.
 * Supports integer seconds (e.g. "120") and HTTP-date strings.
 */
export function parseRetryAfter(
  headerValue: string | null | undefined
): number | null {
  if (!headerValue) return null;

  const trimmed = headerValue.trim();

  // Try parsing as integer seconds
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    return isNaN(seconds) ? null : seconds * 1000;
  }

  // Try parsing as HTTP-date (RFC 7231 / RFC 2822 / RFC 850)
  const dateMs = Date.parse(trimmed);
  if (!isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

/**
 * Calculates the delay in milliseconds before the next retry attempt.
 */
export function calculateRetryDelay(
  attempt: number,
  config: Required<VexaRetryConfig>,
  response?: Response
): number {
  if (config.retryAfter && response) {
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterMs = parseRetryAfter(retryAfterHeader);
    if (retryAfterMs !== null && retryAfterMs >= 0) {
      return Math.min(retryAfterMs, config.maxDelay);
    }
  }

  const calculated = config.backoff(attempt);
  return Math.min(Math.max(calculated, 0), config.maxDelay);
}

/**
 * Checks whether an HTTP status code is eligible for retry.
 */
export function isRetryableStatusCode(
  status: number,
  statusCodes: number[]
): boolean {
  return statusCodes.includes(status);
}

/**
 * Checks whether an HTTP method is eligible for retry.
 */
export function isRetryableMethod(
  method: string,
  methods: string[]
): boolean {
  return methods.includes(method.toUpperCase());
}

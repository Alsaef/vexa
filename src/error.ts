import type { StandardIssue, VexaRequestConfig } from './types.js';

export interface VexaErrorOptions {
  message?: string;
  status?: number;
  statusText?: string;
  data?: any;
  request: Request;
  response?: Response;
  config: VexaRequestConfig;
  isRetryable?: boolean;
  cause?: unknown;
}

/**
 * Base error class for all HTTP and network errors produced by Vexa.
 */
export class VexaError extends Error {
  readonly status?: number;
  readonly statusText?: string;
  readonly data?: any;
  readonly request: Request;
  readonly response?: Response;
  readonly config: VexaRequestConfig;
  readonly isRetryable: boolean;

  constructor(options: VexaErrorOptions) {
    const url = options.request?.url || 'unknown';
    const method = options.request?.method || options.config?.method || 'GET';
    const defaultMsg = options.status
      ? `HTTP ${options.status}${options.statusText ? ` ${options.statusText}` : ''}: ${method} ${url}`
      : `Request failed: ${method} ${url}`;

    super(options.message || defaultMsg, { cause: options.cause });
    this.name = 'VexaError';
    this.status = options.status;
    this.statusText = options.statusText;
    this.data = options.data;
    this.request = options.request;
    this.response = options.response;
    this.config = options.config;
    this.isRetryable = options.isRetryable ?? false;

    // Restore prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a request exceeds its configured timeout duration.
 */
export class VexaTimeoutError extends VexaError {
  readonly timeout: number;

  constructor(options: Omit<VexaErrorOptions, 'status'> & { timeout: number }) {
    const url = options.request?.url || 'unknown';
    const method = options.request?.method || options.config?.method || 'GET';
    const message =
      options.message ||
      `Request timed out after ${options.timeout}ms: ${method} ${url}`;

    super({
      ...options,
      message,
      isRetryable: options.isRetryable ?? true,
    });
    this.name = 'VexaTimeoutError';
    this.timeout = options.timeout;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when runtime schema validation fails on the response payload.
 */
export class VexaValidationError extends VexaError {
  readonly issues: ReadonlyArray<StandardIssue>;
  override readonly data: unknown;

  constructor(
    options: VexaErrorOptions & {
      issues: ReadonlyArray<StandardIssue>;
      data: unknown;
    }
  ) {
    const formattedIssues = options.issues
      .map((i) => {
        const path = i.path
          ? i.path
              .map((p) => (typeof p === 'object' && p !== null && 'key' in p ? String(p.key) : String(p)))
              .join('.')
          : 'root';
        return `[${path}]: ${i.message}`;
      })
      .join('; ');

    const message =
      options.message ||
      `Validation failed: ${formattedIssues}`;

    super({
      ...options,
      message,
      isRetryable: false,
    });
    this.name = 'VexaValidationError';
    this.issues = options.issues;
    this.data = options.data;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

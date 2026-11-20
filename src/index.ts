import { createInstance } from './client.js';

/**
 * Default global Vexa client instance.
 */
export const vexa = createInstance();

export default vexa;

// Export client factory
export { createInstance, createInstance as create } from './client.js';

// Export error classes
export {
  VexaError,
  VexaTimeoutError,
  VexaValidationError,
  type VexaErrorOptions,
} from './error.js';

// Export types & interfaces
export type {
  StandardSchemaV1,
  StandardResult,
  StandardSuccessResult,
  StandardFailureResult,
  StandardIssue,
  CustomValidator,
  Schema,
  InferOutput,
  HttpMethod,
  ResponseType,
  VexaRetryConfig,
  VexaHooks,
  SSEMessage,
  VexaConfig,
  VexaRequestConfig,
  VexaResponse,
  VexaStreamResponse,
  VexaInstance,
} from './types.js';

// Export retry utilities
export {
  calculateRetryDelay,
  parseRetryAfter,
  normalizeRetryConfig,
  isRetryableMethod,
  isRetryableStatusCode,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_RETRY_METHODS,
  DEFAULT_RETRY_STATUS_CODES,
} from './retry.js';

// Export deduplication
export { RequestDeduplicator, defaultDeduplicator } from './dedupe.js';

// Export streaming helpers
export {
  streamChunks,
  streamText,
  streamLines,
  parseSSEStream,
  createStreamResponse,
} from './stream.js';

// Export utilities
export {
  buildURL,
  combineURLs,
  interpolatePathParams,
  serializeParams,
  mergeHeaders,
  serializeRequestBody,
  isPlainObject,
  isAbsoluteURL,
  sleep,
  createCompositeSignal,
} from './utils.js';

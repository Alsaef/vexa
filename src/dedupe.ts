import type { VexaRequestConfig } from './types.js';

interface Subscriber {
  resolve: (res: Response) => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal | null;
  onAbort?: () => void;
}

/**
 * Manages in-flight request deduplication for concurrent identical requests.
 * Shares a single underlying fetch and safely clones the response body for all consumers.
 */
export class RequestDeduplicator {
  private inFlight = new Map<string, Subscriber[]>();

  /**
   * Returns the count of currently in-flight deduplicated requests.
   */
  public get activeCount(): number {
    return this.inFlight.size;
  }

  /**
   * Determines if a request should be deduplicated based on HTTP method and configuration.
   */
  public shouldDedupe(
    method: string,
    dedupeOption?: boolean | { key?: any }
  ): boolean {
    if (dedupeOption === false) return false;
    if (dedupeOption === true || (typeof dedupeOption === 'object' && dedupeOption !== null)) {
      return true;
    }
    // Default: deduplicate GET requests only
    return method.toUpperCase() === 'GET';
  }

  /**
   * Generates a unique deduplication key for a request.
   */
  public generateKey(request: Request, config: VexaRequestConfig): string {
    if (typeof config.dedupe === 'object' && config.dedupe?.key) {
      return config.dedupe.key(request, config);
    }
    return `${request.method.toUpperCase()}:${request.url}`;
  }

  /**
   * Executes or attaches to an in-flight request.
   */
  public execute(
    key: string,
    signal: AbortSignal | null | undefined,
    fetchFn: () => Promise<Response>
  ): Promise<Response> {
    const existing = this.inFlight.get(key);

    if (existing) {
      // Follower request: attach to pending leader
      return new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) {
          return reject(signal.reason ?? new Error('Aborted'));
        }

        const sub: Subscriber = { resolve, reject, signal };

        if (signal) {
          const onAbort = () => {
            const index = existing.indexOf(sub);
            if (index !== -1) {
              existing.splice(index, 1);
            }
            reject(signal.reason ?? new Error('Aborted'));
          };
          sub.onAbort = onAbort;
          signal.addEventListener('abort', onAbort, { once: true });
        }

        existing.push(sub);
      });
    }

    // Leader request: initiate new fetch
    const subscribers: Subscriber[] = [];
    this.inFlight.set(key, subscribers);

    return (async () => {
      try {
        const response = await fetchFn();

        // Safely clone response for all attached followers
        while (subscribers.length > 0) {
          const sub = subscribers.shift()!;
          if (sub.signal && sub.onAbort) {
            sub.signal.removeEventListener('abort', sub.onAbort);
          }
          if (sub.signal?.aborted) {
            sub.reject(sub.signal.reason ?? new Error('Aborted'));
            continue;
          }

          try {
            sub.resolve(response.clone());
          } catch (err) {
            sub.reject(err);
          }
        }

        return response;
      } catch (err) {
        // Broadcast error to all followers
        while (subscribers.length > 0) {
          const sub = subscribers.shift()!;
          if (sub.signal && sub.onAbort) {
            sub.signal.removeEventListener('abort', sub.onAbort);
          }
          sub.reject(err);
        }
        throw err;
      } finally {
        this.inFlight.delete(key);
      }
    })();
  }

  /**
   * Clears all in-flight entries (useful for testing and reset).
   */
  public clear(): void {
    this.inFlight.clear();
  }
}

/** Global default deduplicator instance */
export const defaultDeduplicator = new RequestDeduplicator();

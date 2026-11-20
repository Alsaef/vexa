# Vexa ⚡

> **A tiny (< 3 kB), isomorphic, zero-dependency `fetch` client with built-in retries, request deduplication, AI streaming, and runtime schema validation.**

[![npm version](https://img.shields.io/npm/v/vexa.svg)](https://www.npmjs.com/package/vexa)
[![license](https://img.shields.io/github/license/alsaeff/vexa)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vexa)](https://bundlephobia.com/package/vexa)

---

## 📌 Overview

**Vexa** is engineered from the ground up to modernise HTTP client workflows across modern JavaScript and TypeScript environments. Built directly on the native Web Fetch API, Vexa eliminates the overhead, legacy adapters, and mutable state typical of older libraries like Axios, while providing first-class support for AI token streaming, concurrent request deduplication, and zero-overhead runtime schema validation.

> **Publishing Note:** If `vexa` is already claimed on npm, install via the scoped package `@alsaeff/vexa` or `vexa-fetch`.

---

## ✨ Features

- **🌐 Isomorphic & Universal:** Runs identically across Browsers, Node.js (18+), Bun, Deno, Cloudflare Workers, and Vercel Edge Runtime without polyfills.
- **🪶 Zero Runtime Dependencies:** Pure TypeScript implementation with zero external production dependencies.
- **🔁 Automatic Retries with Exponential Backoff & Jitter:** Default retries on idempotent HTTP methods and transient status codes (`408`, `429`, `500-504`), parsing HTTP `Retry-After` headers automatically.
- **⚡ In-Flight Request Deduplication:** Prevents duplicate concurrent `GET` requests from hitting the network multiple times, safely teeing and cloning responses so each caller receives an independent body stream.
- **🤖 Native AI & SSE Streaming:** Built-in helpers for token-by-token streaming from OpenAI, Anthropic, Gemini, Ollama, and Server-Sent Events (SSE) with `res.sse()`.
- **📐 Standard Schema Runtime Validation:** Natively validates responses with **Standard Schema** (Zod 3.24+, Valibot, ArkType) and custom validator functions, automatically inferring typed return values.
- **🪝 Non-Mutating Lifecycle Hooks:** Functional async hook pipelines (`beforeRequest`, `beforeRetry`, `afterResponse`, `onError`) replacing mutable interceptors.
- **🛡️ Typed Error Hierarchy:** Discriminated `VexaError`, `VexaTimeoutError`, and `VexaValidationError` classes.

---

## 📦 Installation

```bash
# npm
npm install vexa

# pnpm
pnpm add vexa

# bun
bun add vexa

# yarn
yarn add vexa
```

---

## 🚀 Quick Start

```typescript
import { vexa } from 'vexa';

// Basic GET request
const { data, status } = await vexa.get('https://api.example.com/users');
console.log(status, data);

// POST request with automatic JSON serialization
const created = await vexa.post('https://api.example.com/users', {
  name: 'Ada Lovelace',
  role: 'Mathematician',
});
console.log(created.data);
```

---

## 📖 Core Architectural Highlights

### 1. Creating Custom Instances

Create isolated clients with default headers, base URLs, timeouts, and hooks:

```typescript
import { vexa } from 'vexa';

const api = vexa.create({
  baseURL: 'https://api.example.com/v1',
  headers: {
    Authorization: 'Bearer YOUR_SECRET_KEY',
  },
  timeout: 5000,
  retry: {
    limit: 3,
  },
});

// Inherits baseURL, headers, and retry settings
const response = await api.get('/projects');

// Create hierarchical child clients
const teamApi = api.extend({
  headers: {
    'X-Team-ID': 'team_123',
  },
});
```

---

### 2. Path Parameter Interpolation & Clean Query Serialization

Vexa provides expressive path templates (`:param` and `{param}`) and serializes complex query parameters, including arrays and nested objects:

```typescript
// Path parameter interpolation
await vexa.get('/organizations/:orgId/repositories/{repoId}', {
  pathParams: {
    orgId: 'acme-corp',
    repoId: 'infra-service',
  },
});
// Dispatches: /organizations/acme-corp/repositories/infra-service

// Query string serializer
await vexa.get('/search', {
  params: {
    query: 'compiler',
    tags: ['typescript', 'rust'],
    filter: { active: true, stage: 'prod' },
  },
});
// Dispatches: /search?query=compiler&tags[]=typescript&tags[]=rust&filter[active]=true&filter[stage]=prod
```

---

### 3. Automatic Retries with Exponential Backoff & Jitter

Transient failures and rate limits are handled transparently:

```typescript
const response = await vexa.get('/analytics/reports', {
  retry: {
    limit: 3, // Maximum retry attempts
    methods: ['GET', 'HEAD', 'PUT', 'DELETE'], // Allowed HTTP methods
    statusCodes: [408, 429, 500, 502, 503, 504], // Status codes to retry
    retryAfter: true, // Respect Retry-After header (seconds & HTTP dates)
    backoff: (attempt) => Math.min(1000 * 2 ** (attempt - 1), 10000), // Custom backoff
  },
});
```

---

### 4. In-Flight Request Deduplication

When multiple UI components or services trigger identical `GET` requests simultaneously, Vexa consolidates them into a single in-flight network operation:

```typescript
// Multiple components requesting the same endpoint concurrently:
const [userProfile, sameProfile] = await Promise.all([
  vexa.get('/api/me'),
  vexa.get('/api/me'),
]);

// Result: Only 1 HTTP request hits the network!
// Both callers receive cloned response bodies without "already read" stream lock errors.
```

To opt out for specific requests:
```typescript
await vexa.get('/api/status', { dedupe: false });
```

---

### 5. AI Streaming & Server-Sent Events (SSE)

Vexa provides high-level helpers for AI token streaming and SSE event streams:

```typescript
import { vexa } from 'vexa';

// 1. Text token streaming with async iterators
const stream = await vexa.stream('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  data: {
    model: 'gpt-4o',
    stream: true,
    messages: [{ role: 'user', content: 'Explain quantum computing simply.' }],
  },
});

for await (const chunk of stream) {
  process.stdout.write(chunk);
}

// 2. Structured Server-Sent Events (SSE) parsing
for await (const event of stream.sse()) {
  if (event.data === '[DONE]') break;
  const payload = event.json<{ choices: Array<{ delta: { content?: string } }> }>();
  console.log(payload.choices[0]?.delta?.content);
}

// 3. Line-by-line reading for NDJSON logs
for await (const line of stream.lines()) {
  console.log('Log line:', line);
}
```

---

### 6. Zero-Dependency Runtime Schema Validation

Vexa supports **Standard Schema** (`~standard.validate`), enabling direct compatibility with libraries like **Zod 3.24+**, **Valibot**, and **ArkType** without bundling them as dependencies. TypeScript return types are automatically inferred!

```typescript
import { vexa } from 'vexa';
import { z } from 'zod';

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
});

// res.data is automatically inferred as: { id: number; name: string; email: string }
const res = await vexa.get('/users/123', {
  schema: UserSchema,
});

console.log(res.data.name); // Type-safe!

// You can also pass pure validator functions with zero external dependencies:
const customValidator = (input: unknown) => {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid JSON');
  return input as { status: string };
};

const result = await vexa.get('/status', { schema: customValidator });
```

If validation fails, a typed `VexaValidationError` is thrown with detailed issue paths.

---

### 7. Non-Mutating Lifecycle Hooks

Hooks replace Axios interceptors with clean, composable, async functions:

```typescript
const client = vexa.create({
  hooks: {
    // Modify or inspect request before dispatch
    beforeRequest: [
      async (req, config) => {
        req.headers.set('X-Request-Start', Date.now().toString());
      },
    ],

    // Called prior to each retry attempt
    beforeRetry: [
      async (error, attempt) => {
        console.warn(`Retry attempt #${attempt} following error:`, error.message);
      },
    ],

    // Transform response data
    afterResponse: [
      async (response, data, config) => {
        if (typeof data === 'object' && data !== null) {
          return { ...data, _retrievedAt: new Date() };
        }
        return data;
      },
    ],

    // Global error listener
    onError: [
      async (error) => {
        console.error(`[${error.name}] Request failed: ${error.request.url}`);
      },
    ],
  },
});
```

---

### 8. Typed Error Hierarchy

```typescript
import { vexa, VexaError, VexaTimeoutError, VexaValidationError } from 'vexa';

try {
  await vexa.get('/resource');
} catch (error) {
  if (error instanceof VexaTimeoutError) {
    console.error(`Operation timed out after ${error.timeout}ms`);
  } else if (error instanceof VexaValidationError) {
    console.error('Schema mismatch issues:', error.issues);
  } else if (error instanceof VexaError) {
    console.error(`HTTP ${error.status}: ${error.statusText}`);
    console.error('Error payload:', error.data);
    console.error('Retryable:', error.isRetryable);
  }
}
```

---

## 🔄 Migrating from Axios to Vexa

| Feature | Axios | Vexa |
| :--- | :--- | :--- |
| **Bundle Size** | ~32 kB minified | **< 3 kB minified + gzipped** |
| **Core Architecture** | Legacy adapters & XMLHttpRequest | **Native isomorphic Fetch** |
| **Runtime Dependencies** | Multiple | **0 dependencies** |
| **Interceptors** | Mutable array with numeric IDs (`eject`) | **Functional async hooks** |
| **Retries** | Requires external `axios-retry` plugin | **Built-in with jitter & Retry-After** |
| **Request Deduplication** | Requires custom cache adapters | **Built-in automatic in-flight deduplication** |
| **AI / SSE Streams** | Clunky manual reader handling | **Built-in `vexa.stream()` & `res.sse()`** |
| **Schema Validation** | Manual boilerplate | **Native Standard Schema integration** |
| **Edge Runtime Support** | Adapter configuration required | **First-class native compatibility** |

### Code Comparison

#### Axios
```typescript
import axios from 'axios';

const api = axios.create({ baseURL: 'https://api.example.com' });

api.interceptors.request.use((config) => {
  config.headers['Authorization'] = 'Bearer token';
  return config;
});

const res = await api.get('/users', { params: { active: true } });
console.log(res.data);
```

#### Vexa
```typescript
import { vexa } from 'vexa';

const api = vexa.create({
  baseURL: 'https://api.example.com',
  hooks: {
    beforeRequest: [(req) => {
      req.headers.set('Authorization', 'Bearer token');
    }],
  },
});

const { data } = await api.get('/users', { params: { active: true } });
console.log(data);
```

---

## 🛠️ Build & Verification

```bash
# Typecheck
npm run typecheck

# Run test suite
npm run test

# Build dual ESM + CJS bundles
npm run build
```

---

## 📄 License

MIT © [Alsaeff](https://github.com/alsaeff)

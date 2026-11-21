# Vexa ⚡

> **A tiny (< 3 kB), isomorphic, zero-dependency `fetch` client with built-in retries, request deduplication, AI streaming, and runtime schema validation.**

[![npm version](https://img.shields.io/npm/v/vexa-client.svg)](https://www.npmjs.com/package/vexa-client)
[![license](https://img.shields.io/github/license/alsaeff/vexa)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vexa-client)](https://bundlephobia.com/package/vexa-client)

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Installation](#-installation)
  - [Recommended: Install as `vexa`](#option-1-recommended-install-as-vexa-so-you-can-import-from-vexa)
  - [Direct Install: `vexa-client`](#option-2-direct-install-as-vexa-client)
  - [Local Project Install](#option-3-local-workspace-install-without-npm)
- [Quick Start](#-quick-start)
- [React.js & Vite Integration Guide](#-reactjs--vite-integration-guide)
  - [Vite Cache Tip (Fixing 504 Outdated Optimize Dep)](#vite-cache-troubleshooting-fixing-504-outdated-optimize-dep)
  - [Centralized API Client](#1-create-a-centralized-api-client-srcapiclientjs)
  - [Fetching Data in Components (`useEffect`)](#2-fetching-data-in-components-useeffect)
  - [Form Submissions (POST / PUT)](#3-submitting-forms-post--put)
  - [Solving React StrictMode Double-Fetch](#4-automatic-in-flight-deduplication-in-react)
  - [AI Token Streaming in React](#5-ai-token-streaming-in-react)
  - [Custom `useVexa` Hook](#6-optional-reusable-react-hook-usevexa)
- [Core Architectural Features](#-core-architectural-features)
  - [1. Instances & Shorthand Methods](#1-instances--shorthand-methods)
  - [2. Path Interpolation & Query Serialization](#2-path-parameter-interpolation--clean-query-serialization)
  - [3. Automatic Retries with Exponential Backoff & Jitter](#3-automatic-retries-with-exponential-backoff--jitter)
  - [4. In-Flight Request Deduplication](#4-in-flight-request-deduplication)
  - [5. First-Class AI Streaming & Server-Sent Events (SSE)](#5-first-class-ai-streaming--server-sent-events-sse)
  - [6. Zero-Dependency Runtime Schema Validation](#6-zero-dependency-runtime-schema-validation)
  - [7. Non-Mutating Lifecycle Hooks](#7-non-mutating-lifecycle-hooks)
  - [8. Typed Error Hierarchy](#8-typed-error-hierarchy)
- [Migrating from Axios to Vexa](#-migrating-from-axios-to-vexa)
- [npm Registry Details](#-npm-registry-details)
- [Build & Testing](#-build--testing)
- [License](#-license)

---

## 📌 Overview

**Vexa** is engineered from the ground up to modernize HTTP client workflows across modern JavaScript and TypeScript environments. Built directly on the native Web Fetch API, Vexa eliminates the overhead, legacy adapters, and mutable state typical of older libraries like Axios, while providing first-class support for AI token streaming, concurrent request deduplication, and zero-overhead runtime schema validation.

---

## 📦 Installation

### Option 1 (Recommended): Install as `vexa` (So you can `import from 'vexa'`)

npm natively supports package aliasing. This allows you to install the published `vexa-client` directly under the import name `"vexa"`:

```bash
# npm
npm install vexa@npm:vexa-client

# pnpm
pnpm add vexa@npm:vexa-client

# bun
bun add vexa@npm:vexa-client

# yarn
yarn add vexa@npm:vexa-client
```

Now you can import directly from `'vexa'` everywhere:
```javascript
import { vexa } from 'vexa';
// or:
import vexa from 'vexa';
```

---

### Option 2: Direct Install as `vexa-client`

```bash
# npm
npm install vexa-client

# pnpm
pnpm add vexa-client

# bun
bun add vexa-client

# yarn
yarn add vexa-client
```

Import syntax:
```javascript
import { vexa } from 'vexa-client';
// or:
import vexa from 'vexa-client';
```

---

### Option 3: Local Workspace Install (Without npm)

If you are developing locally and want to link the repository folder directly:

```bash
npm install "/path/to/vexa"
```

---

## 🚀 Quick Start

Both **named** and **default** imports are supported across ESM, CommonJS, TypeScript, Vite, Next.js, and Node.js:

```typescript
import { vexa } from 'vexa';
// or: import vexa from 'vexa';

// 1. Simple GET request
const { data, status } = await vexa.get('https://api.example.com/users');
console.log(status, data);

// 2. POST request with automatic JSON serialization
const created = await vexa.post('https://api.example.com/users', {
  name: 'Ada Lovelace',
  role: 'Mathematician',
});
console.log(created.data);
```

---

## ⚛️ React.js & Vite Integration Guide

### Vite Cache Troubleshooting: Fixing `504 (Outdated Optimize Dep)`

If you install or update dependencies while Vite's dev server is running, Vite might display:
`504 (Outdated Optimize Dep)`

**To fix in 5 seconds:**
1. Stop your Vite terminal (`Ctrl + C`).
2. Restart Vite with the `--force` flag:
   ```bash
   npm run dev -- --force
   ```
3. Hard-refresh your browser (`Ctrl + Shift + R` or `Cmd + Shift + R`).

---

### 1. Create a Centralized API Client (`src/api/client.js`)

Define your client once with a `baseURL`, default headers, and token interceptor hooks:

```javascript
// src/api/client.js
import { vexa } from 'vexa'; // or 'vexa-client'

export const api = vexa.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://api.example.com',
  timeout: 8000,
  retry: {
    limit: 2, // Retries failed transient requests up to 2 times
  },
  hooks: {
    // Automatically attach Bearer token before every request
    beforeRequest: [
      (request) => {
        const token = localStorage.getItem('token');
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`);
        }
      },
    ],
    // Handle global errors (e.g. redirect on 401 Unauthorized)
    onError: [
      (error) => {
        if (error.status === 401) {
          console.warn('Session expired. Redirecting to login...');
          // window.location.href = '/login';
        }
      },
    ],
  },
});
```

---

### 2. Fetching Data in Components (`useEffect`)

```jsx
// src/components/UserProfile.jsx
import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { VexaTimeoutError, VexaError } from 'vexa';

export function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchUser() {
      setLoading(true);
      setError(null);
      try {
        // Path parameter interpolation: /users/:id
        const res = await api.get('/users/:id', {
          pathParams: { id: userId },
          signal: controller.signal,
        });
        setUser(res.data);
      } catch (err) {
        if (err.name === 'AbortError') return; // Cancelled
        if (err instanceof VexaTimeoutError) {
          setError('Server took too long to respond.');
        } else if (err instanceof VexaError) {
          setError(err.data?.message || 'Failed to fetch user profile.');
        } else {
          setError('An unexpected error occurred.');
        }
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
    return () => controller.abort(); // Cancel request if component unmounts
  }, [userId]);

  if (loading) return <p>Loading profile...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;
  if (!user) return null;

  return (
    <div>
      <h2>{user.name}</h2>
      <p>Email: {user.email}</p>
    </div>
  );
}
```

---

### 3. Submitting Forms (POST / PUT)

```jsx
// src/components/CreatePost.jsx
import React, { useState } from 'react';
import { api } from '../api/client';

export function CreatePost({ onCreated }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post('/posts', { title, body });
      alert(`Post created! ID: ${res.data.id}`);
      setTitle('');
      setBody('');
      if (onCreated) onCreated(res.data);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Post Title"
        required
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Content..."
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? 'Publishing...' : 'Publish'}
      </button>
    </form>
  );
}
```

---

### 4. Automatic In-Flight Deduplication in React

In React 18+ `<React.StrictMode>`, components mount twice during development. Additionally, sibling components (such as a Navbar and a Sidebar) frequently request `/api/me` at the exact same moment.

Vexa **automatically deduplicates concurrent identical GET requests**:

```javascript
// Even if 3 components call this simultaneously:
const [res1, res2, res3] = await Promise.all([
  api.get('/api/me'),
  api.get('/api/me'),
  api.get('/api/me'),
]);

// Result: Only ONE HTTP request is sent over the network!
// All 3 callers receive cloned responses without stream locks.
```

---

### 5. AI Token Streaming in React

Vexa has first-class native support for chunked streaming via `for await`:

```jsx
// src/components/AIChat.jsx
import React, { useState } from 'react';
import { vexa } from 'vexa';

export function AIChat() {
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [streaming, setStreaming] = useState(false);

  const handleAskAI = async () => {
    setStreaming(true);
    setOutput('');

    try {
      const stream = await vexa.stream('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.REACT_APP_OPENAI_KEY}` },
        data: {
          model: 'gpt-4o',
          stream: true,
          messages: [{ role: 'user', content: prompt }],
        },
      });

      // Stream text chunk-by-chunk directly into React state
      for await (const chunk of stream) {
        setOutput((prev) => prev + chunk);
      }
    } catch (err) {
      console.error('Streaming error:', err);
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div>
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask AI anything..."
      />
      <button onClick={handleAskAI} disabled={streaming}>
        {streaming ? 'Generating...' : 'Send'}
      </button>
      <div style={{ whiteSpace: 'pre-wrap', marginTop: 16 }}>{output}</div>
    </div>
  );
}
```

---

### 6. Optional Reusable React Hook (`useVexa`)

```jsx
// src/hooks/useVexa.js
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export function useVexa(url, config = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(url, config);
      setData(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    execute();
  }, [execute]);

  return { data, loading, error, refetch: execute };
}
```

Usage in any component:
```jsx
const { data: users, loading, error, refetch } = useVexa('/users');
```

---

## 📖 Core Architectural Features

### 1. Instances & Shorthand Methods

```typescript
import { vexa } from 'vexa';

const api = vexa.create({
  baseURL: 'https://api.example.com/v1',
  headers: { Authorization: 'Bearer TOKEN' },
  timeout: 5000,
});

// Shorthand methods:
await api.get('/users');
await api.post('/users', { name: 'Alice' });
await api.put('/users/1', { name: 'Alice Smith' });
await api.patch('/users/1', { active: true });
await api.delete('/users/1');
await api.head('/users');

// Create hierarchical child clients:
const adminApi = api.extend({
  headers: { 'X-Admin-Role': 'superadmin' },
});
```

---

### 2. Path Parameter Interpolation & Clean Query Serialization

```typescript
// 1. Path parameter interpolation: /users/:id or /users/{id}
await vexa.get('/organizations/:orgId/repositories/{repoId}', {
  pathParams: {
    orgId: 'acme-corp',
    repoId: 'infra-service',
  },
});
// Dispatches: /organizations/acme-corp/repositories/infra-service

// 2. Query string serializer (supports primitives, arrays, and nested objects)
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
    retryAfter: true, // Respect HTTP Retry-After headers (seconds & HTTP dates)
    backoff: (attempt) => Math.min(1000 * 2 ** (attempt - 1), 10000), // Custom backoff
  },
});
```

---

### 4. In-Flight Request Deduplication

When multiple UI components trigger identical `GET` requests simultaneously, Vexa consolidates them into a single in-flight network operation:

```typescript
const [res1, res2] = await Promise.all([
  vexa.get('/api/me'),
  vexa.get('/api/me'),
]);

// Result: Only 1 HTTP request hits the network!
// Both callers receive independent cloned responses without stream locks.
```

To opt out for specific requests:
```typescript
await vexa.get('/api/status', { dedupe: false });
```

---

### 5. First-Class AI Streaming & Server-Sent Events (SSE)

```typescript
import { vexa } from 'vexa';

const stream = await vexa.stream('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  data: {
    model: 'gpt-4o',
    stream: true,
    messages: [{ role: 'user', content: 'Explain quantum computing.' }],
  },
});

// 1. Text token streaming
for await (const chunk of stream) {
  process.stdout.write(chunk);
}

// 2. Server-Sent Events (SSE) structured messages
for await (const event of stream.sse()) {
  if (event.data === '[DONE]') break;
  const payload = event.json();
  console.log(payload);
}

// 3. Line-by-line reading for NDJSON
for await (const line of stream.lines()) {
  console.log('Line:', line);
}
```

---

### 6. Zero-Dependency Runtime Schema Validation

Vexa supports **Standard Schema** (`~standard.validate`), enabling direct compatibility with **Zod 3.24+**, **Valibot**, and **ArkType** without bundling them as dependencies. TypeScript return types are automatically inferred!

```typescript
import { vexa } from 'vexa';
import { z } from 'zod';

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
});

// res.data is automatically typed as: { id: number; name: string; email: string }
const res = await vexa.get('/users/123', {
  schema: UserSchema,
});

console.log(res.data.name); // Type-safe!
```

---

### 7. Non-Mutating Lifecycle Hooks

```typescript
const client = vexa.create({
  hooks: {
    beforeRequest: [
      async (req, config) => {
        req.headers.set('X-Request-Start', Date.now().toString());
      },
    ],
    beforeRetry: [
      async (error, attempt) => {
        console.warn(`Retry attempt #${attempt} after error:`, error.message);
      },
    ],
    afterResponse: [
      async (response, data, config) => {
        if (typeof data === 'object' && data !== null) {
          return { ...data, _retrievedAt: new Date() };
        }
        return data;
      },
    ],
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

## 📦 npm Registry Details

* **Live Registry Package:** [`vexa-client`](https://www.npmjs.com/package/vexa-client) (Version `1.0.0`)
* **Why `vexa-client`?** The root name `vexa` on npm was registered in 2022 by another user as an empty placeholder. By installing via `npm install vexa@npm:vexa-client`, npm places it under `node_modules/vexa`, allowing you to write `import { vexa } from 'vexa'` without waiting for an npm name dispute transfer!

---

## 🛠️ Build & Testing

```bash
# Typecheck TypeScript source (strict: true)
npm run typecheck

# Run complete Vitest suite (37 tests)
npm run test

# Build dual ESM + CJS bundles with DTS
npm run build
```

---

## 📄 License

MIT © [Alsaeff](https://github.com/alsaeff)

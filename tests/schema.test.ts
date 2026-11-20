import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  createInstance,
  VexaValidationError,
  type StandardSchemaV1,
} from '../src/index.js';

describe('Vexa Runtime Schema Validation (Standard Schema & Custom)', () => {
  it('validates response data using native Zod schema via Standard Schema (~standard)', async () => {
    const UserSchema = z.object({
      id: z.number(),
      name: z.string(),
      email: z.string().email(),
    });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 1,
          name: 'Ada Lovelace',
          email: 'ada@example.com',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const client = createInstance({ fetch: mockFetch });
    const res = await client.get('https://api.example.com/users/1', {
      schema: UserSchema,
    });

    // Inferred type matches Zod output
    expect(res.data).toEqual({
      id: 1,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    expect(res.data.id).toBe(1);
    expect(res.data.name).toBe('Ada Lovelace');
  });

  it('throws VexaValidationError when Standard Schema validation fails', async () => {
    const UserSchema = z.object({
      id: z.number(),
      name: z.string(),
      email: z.string().email(),
    });

    // Email is invalid and id is wrong type
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'not-a-number',
          name: 'Ada Lovelace',
          email: 'invalid-email',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const client = createInstance({ fetch: mockFetch });

    try {
      await client.get('https://api.example.com/users/1', {
        schema: UserSchema,
      });
      expect.unreachable('Should have thrown VexaValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(VexaValidationError);
      const valErr = err as VexaValidationError;
      expect(valErr.issues.length).toBeGreaterThan(0);
      expect(valErr.status).toBe(200);
      expect(valErr.data).toEqual({
        id: 'not-a-number',
        name: 'Ada Lovelace',
        email: 'invalid-email',
      });
      expect(valErr.message).toContain('Validation failed:');
    }
  });

  it('validates response with a zero-dependency custom validator function', async () => {
    interface Product {
      sku: string;
      price: number;
    }

    const validateProduct = (data: unknown): Product => {
      if (typeof data !== 'object' || data === null) {
        throw new Error('Data must be an object');
      }
      const obj = data as Record<string, any>;
      if (typeof obj.sku !== 'string' || typeof obj.price !== 'number') {
        throw new Error('Invalid product schema: missing sku or price');
      }
      return { sku: obj.sku, price: obj.price };
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sku: 'PROD-99', price: 49.99 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createInstance({ fetch: mockFetch });
    const res = await client.get('https://api.example.com/products/99', {
      schema: validateProduct,
    });

    expect(res.data).toEqual({ sku: 'PROD-99', price: 49.99 });
  });

  it('throws VexaValidationError when custom validator throws', async () => {
    const strictValidator = (data: unknown) => {
      if (!data || typeof data !== 'object' || !('requiredField' in data)) {
        throw new Error('Missing requiredField');
      }
      return data;
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ wrongField: 123 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createInstance({ fetch: mockFetch });

    await expect(
      client.get('https://api.example.com/item', {
        schema: strictValidator,
      })
    ).rejects.toThrow(VexaValidationError);
  });

  it('supports raw Standard Schema v1 specification implementation', async () => {
    interface Article {
      title: string;
    }

    const mockStandardSchema: StandardSchemaV1<unknown, Article> = {
      '~standard': {
        version: 1,
        vendor: 'custom-spec-test',
        validate(value: unknown) {
          if (
            typeof value === 'object' &&
            value !== null &&
            'title' in value &&
            typeof (value as any).title === 'string'
          ) {
            return { value: { title: (value as any).title } };
          }
          return {
            issues: [{ message: 'Expected object with title string', path: ['title'] }],
          };
        },
      },
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ title: 'Standard Schema in Vexa' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createInstance({ fetch: mockFetch });
    const res = await client.get('https://api.example.com/article', {
      schema: mockStandardSchema,
    });

    expect(res.data).toEqual({ title: 'Standard Schema in Vexa' });
  });
});

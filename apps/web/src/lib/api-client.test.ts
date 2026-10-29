import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, ApiClientError } from './api-client';
import { z } from 'zod';

describe('Typed API Client & Contracts Runtime Validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const TestSchema = z.object({
    id: z.string().uuid(),
    price: z.number().positive(),
  });

  it('successfully validates and returns payload matching contract schema', async () => {
    const validData = {
      id: '11111111-2222-3333-4444-555555555555',
      price: 99.99,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(validData),
    } as unknown as Response);

    const result = await request('/test', { schema: TestSchema });
    expect(result).toEqual(validData);
  });

  it('throws validation error when backend response violates contract schema', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const invalidData = {
      id: 'not-a-uuid',
      price: -50,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(invalidData),
    } as unknown as Response);

    await expect(request('/test', { schema: TestSchema })).rejects.toThrow(
      /API response validation failed/,
    );
  });

  it('parses structured API error response and throws ApiClientError', async () => {
    const errorPayload = {
      success: false,
      statusCode: 409,
      message: 'Bid amount is below the minimum required increment',
      timestamp: new Date().toISOString(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve(errorPayload),
    } as unknown as Response);

    await expect(request('/auctions/123/bids', { method: 'POST' })).rejects.toThrow(ApiClientError);
  });
});

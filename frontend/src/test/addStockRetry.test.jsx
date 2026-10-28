import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { addStock } from '../portfolioWatcher/api/portfolioApi';

describe('Add Stock & Upstream Error Handling Guardrails', () => {
  it('requestJson converts HTTP 429 to a descriptive rate limit error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { code: 'upstream_rate_limited' } })
    });

    try {
      await addStock('/api/portfolio', 'FAS');
      expect.fail('Should have thrown an error');
    } catch (err) {
      expect(err.status).toBe(429);
      expect(err.code).toBe('upstream_rate_limited');
      expect(err.message).toContain('Yahoo Finance is temporarily rate-limiting requests');
      expect(err.message).not.toBe('Portfolio API request failed.');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('requestJson converts HTTP 504 Gateway Timeout to upstream timeout error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 504,
      text: async () => '<html>Gateway Timeout</html>'
    });

    try {
      await addStock('/api/portfolio', 'KLAC');
      expect.fail('Should have thrown an error');
    } catch (err) {
      expect(err.status).toBe(504);
      expect(err.code).toBe('upstream_timeout');
      expect(err.message).toContain('Connection to Yahoo Finance timed out');
      expect(err.message).not.toBe('Portfolio API request failed.');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('addStock accepts an AbortController signal option', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ stock: { symbol: 'NVDA' } })
    });

    const controller = new AbortController();
    await addStock('/api/portfolio', 'NVDA', { signal: controller.signal });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/portfolio/stocks',
      expect.objectContaining({
        signal: controller.signal,
        method: 'POST'
      })
    );
    vi.restoreAllMocks();
  });
});

/**
 * Tests for portfolioApi.js (PortfolioWatcher API client)
 *
 * Guardrail: Locks down the quote refresh endpoint paths and HTTP methods.
 * The interval auto-refresh and manual refresh both rely on these functions;
 * if a route changes on the backend, these tests will fail immediately.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  refreshStockQuotes,
  refreshStockQuote,
  refreshStockIntraday,
  refreshIndexQuotes,
  fetchBootstrap,
} from '../portfolioWatcher/api/portfolioApi.js';

const BASE = 'http://localhost:5074/api/portfolio';

// portfolioApi uses response.text() internally, not response.json()
function mockFetch(responseData, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(responseData),
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('portfolioApi — quote refresh endpoints', () => {
  it('refreshStockQuotes() POSTs to /stocks/quotes/refresh', async () => {
    const spy = mockFetch([{ symbol: 'AAPL', last_price: 190 }]);
    await refreshStockQuotes(BASE);
    expect(spy).toHaveBeenCalledWith(
      `${BASE}/stocks/quotes/refresh`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('refreshIndexQuotes() POSTs to /indices/quotes/refresh', async () => {
    const spy = mockFetch([{ symbol: '^GSPC', last_price: 5000 }]);
    await refreshIndexQuotes(BASE);
    expect(spy).toHaveBeenCalledWith(
      `${BASE}/indices/quotes/refresh`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('refreshStockQuote() POSTs to /stocks/:symbol/quote/refresh', async () => {
    const spy = mockFetch({ symbol: 'NVDA', last_price: 450 });
    await refreshStockQuote(BASE, 'NVDA');
    expect(spy).toHaveBeenCalledWith(
      `${BASE}/stocks/NVDA/quote/refresh`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('refreshStockIntraday() POSTs to /stocks/:symbol/intraday/refresh with interval', async () => {
    const spy = mockFetch({ prices: [] });
    await refreshStockIntraday(BASE, 'AAPL', '5m');
    expect(spy).toHaveBeenCalledWith(
      `${BASE}/stocks/AAPL/intraday/refresh?interval=5m`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('refreshStockIntraday() defaults interval to 5m', async () => {
    const spy = mockFetch({ prices: [] });
    await refreshStockIntraday(BASE, 'GOOG');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('interval=5m'),
      expect.anything()
    );
  });
});

describe('portfolioApi — bootstrap endpoint', () => {
  it('fetchBootstrap() GETs /bootstrap', async () => {
    const spy = mockFetch({ stocks: [], accounts: [], indices: [] });
    await fetchBootstrap(BASE);
    expect(spy).toHaveBeenCalledWith(
      `${BASE}/bootstrap`,
      expect.anything()
    );
  });
});

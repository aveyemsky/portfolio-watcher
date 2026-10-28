import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import StockCatalystsView from '../portfolioWatcher/ui/stock/StockCatalystsView';
import MacroCatalystRadarTab from '../portfolioWatcher/ui/account/MacroCatalystRadarTab';
import * as portfolioApi from '../portfolioWatcher/api/portfolioApi';
import {
  DEFAULT_STOCK_TABS,
  DEFAULT_ACCOUNT_TABS
} from '../portfolioWatcher/ui/layout/DetailPanel';

describe('Catalyst Radar & Prediction Markets (Phase 1B)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tab Registration', () => {
    it('keeps DEFAULT_STOCK_TABS focused without stock-level catalysts tab', () => {
      const catTab = DEFAULT_STOCK_TABS.find((t) => t.value === 'catalysts');
      expect(catTab).toBeUndefined();
    });

    it('keeps DEFAULT_ACCOUNT_TABS focused on portfolio assets without macro catalysts tab', () => {
      const catTab = DEFAULT_ACCOUNT_TABS.find((t) => t.value === 'catalysts');
      expect(catTab).toBeUndefined();
    });
  });

  describe('portfolioApi Catalyst Functions', () => {
    it('fetchMacroCatalysts constructs correct query URL', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ status: 'success', data: [] })
      });

      await portfolioApi.fetchMacroCatalysts('http://localhost:5001/api/portfolio', {
        category: 'fed',
        limit: 10,
        minVolume: 1000,
        refresh: true
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/catalysts/macro');
      expect(calledUrl).toContain('category=fed');
      expect(calledUrl).toContain('limit=10');
      expect(calledUrl).toContain('min_volume=1000');
      expect(calledUrl).toContain('refresh=true');
    });

    it('fetchStockCatalysts queries stock-specific route', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ status: 'success', symbol: 'NVDA', data: [] })
      });

      await portfolioApi.fetchStockCatalysts('http://localhost:5001/api/portfolio', 'NVDA', {
        limit: 5,
        refresh: true
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/stocks/NVDA/catalysts');
      expect(calledUrl).toContain('limit=5');
      expect(calledUrl).toContain('refresh=true');
    });

    it('searchCatalysts queries search endpoint with q parameter', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ status: 'success', data: [] })
      });

      await portfolioApi.searchCatalysts('http://localhost:5001/api/portfolio', 'Crude Oil', {
        limit: 8
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/catalysts/search');
      expect(calledUrl).toContain('q=Crude+Oil');
      expect(calledUrl).toContain('limit=8');
    });

    it('fetchCatalystProviders queries providers endpoint', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ status: 'success', data: [] })
      });

      await portfolioApi.fetchCatalystProviders('http://localhost:5001/api/portfolio');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/catalysts/providers');
    });
  });

  describe('Component Structure Rendering', () => {
    const mockStock = { symbol: 'NVDA', name: 'Nvidia Corporation' };
    const mockAccount = { id: 1, name: 'Main Portfolio' };

    it('renders StockCatalystsView layout and header titles', () => {
      const html = renderToString(
        <StockCatalystsView apiBaseUrl="/api/portfolio" stock={mockStock} />
      );

      expect(html).toContain('pw-catalyst-container');
      expect(html).toContain('Forward-Looking Catalyst Radar');
      expect(html).toContain('LIVE PROBABILITIES');
      expect(html).toContain('NVDA');
      expect(html).toContain('Nvidia Corporation');
    });

    it('renders MacroCatalystRadarTab layout, highlights, and category pills', () => {
      const html = renderToString(
        <MacroCatalystRadarTab apiBaseUrl="/api/portfolio" account={mockAccount} />
      );

      expect(html).toContain('pw-macro-radar-container');
      expect(html).toContain('Macro Catalyst &amp; Prediction Radar');
      expect(html).toContain('SKIN-IN-THE-GAME PROBABILITIES');
      expect(html).toContain('FOMC Interest Rates');
      expect(html).toContain('U.S. Recession Odds');
      expect(html).toContain('Energy / Oil Shocks');
      expect(html).toContain('Fed &amp; Rates');
      expect(html).toContain('Inflation &amp; CPI');
      expect(html).toContain('Tariffs &amp; Trade');
    });

    it('renders MacroCatalystRadarTab with initialQuery and initialCategory', () => {
      const html = renderToString(
        <MacroCatalystRadarTab
          apiBaseUrl="/api/portfolio"
          account={mockAccount}
          initialQuery="inflation"
          initialCategory="inflation"
        />
      );

      expect(html).toContain('value="inflation"');
      expect(html).toContain('pw-radar-search-clear-btn');
      expect(html).toContain('pw-category-pill pw-category-pill-active');
      expect(html).toContain('Inflation &amp; CPI');
    });
  });
});

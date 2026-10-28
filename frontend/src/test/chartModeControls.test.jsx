import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import StockChart from '../portfolioWatcher/ui/stock/StockChart';
import { createInitialPortfolioState } from '../portfolioWatcher/state/portfolioStore';
import { getDefaultVisibleRange } from '../portfolioWatcher/ui/stock/chartRange';

describe('Chart Mode Segmented Control: 1d | 3y | All', () => {
  const mockData = {
    stocks: [
      {
        symbol: 'NVDA',
        name: 'NVIDIA Corporation',
        shares: 10,
        current_price: 130.0,
        priceDirty: false
      }
    ],
    accounts: [],
    pricesBySymbol: {
      NVDA: [
        { date: '2017-01-03', open: 10, high: 12, low: 9, close: 11, volume: 1000 },
        { date: '2023-01-03', open: 40, high: 45, low: 39, close: 42, volume: 2000 },
        { date: '2026-10-12', open: 128, high: 132, low: 127, close: 130, volume: 3000 }
      ]
    }
  };

  it('initializes chartMode to 3y by default in portfolioStore', () => {
    const state = createInitialPortfolioState(mockData, 'NVDA');
    expect(state.chartMode).toBe('3y');
  });

  it('renders 1d, 3y, and All buttons with title="Since 2017" on All', () => {
    const state = createInitialPortfolioState(mockData, 'NVDA');
    const html = renderToString(
      <StockChart
        apiBaseUrl="/api/portfolio"
        data={mockData}
        state={state}
        dispatch={vi.fn()}
      />
    );

    // Verify 1d button
    expect(html).toContain('>1d<');
    // Verify 3y button is active by default
    expect(html).toContain('class="pw-active" type="button">3y<');
    // Verify All button has title="Since 2017"
    expect(html).toContain('title="Since 2017">All<');
  });

  it('getDefaultVisibleRange defaults to 6 months visible window on initial load when chartMode is 3y', () => {
    const samplePrices = [
      { date: '2017-01-03', open: 10, high: 12, low: 9, close: 11 },
      { date: '2020-01-03', open: 20, high: 22, low: 19, close: 21 },
      { date: '2023-10-15', open: 50, high: 52, low: 49, close: 51 },
      { date: '2026-03-01', open: 90, high: 95, low: 88, close: 92 },
      { date: '2026-06-01', open: 95, high: 98, low: 94, close: 96 },
      { date: '2026-10-12', open: 100, high: 105, low: 98, close: 102 }
    ];

    const rangeDefault = getDefaultVisibleRange(samplePrices, '3y');
    // 6 months before 2026-10-12 is ~2026-04-12, so the first visible bar is 2026-06-01 (index 4)
    expect(rangeDefault.from).toBe(4);

    const rangeAll = getDefaultVisibleRange(samplePrices, 'all');
    expect(rangeAll.from).toBe(4);
  });
});

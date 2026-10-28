import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import StockChart from '../portfolioWatcher/ui/stock/StockChart';
import { DEFAULT_STOCK_TABS } from '../portfolioWatcher/ui/layout/DetailPanel';
import { createInitialPortfolioState } from '../portfolioWatcher/state/portfolioStore';

describe('Guardrail: Open-source PortfolioWatcher Quant Alpha Exclusion', () => {
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
        { date: '2023-01-03', open: 40, high: 45, low: 39, close: 42, volume: 2000 },
        { date: '2026-10-12', open: 128, high: 132, low: 127, close: 130, volume: 3000 }
      ]
    }
  };

  it('DEFAULT_STOCK_TABS does not include Quant Alpha in core open-source engine', () => {
    const tabValues = DEFAULT_STOCK_TABS.map((t) => t.value);
    const tabLabels = DEFAULT_STOCK_TABS.map((t) => t.label);

    expect(tabValues).not.toContain('analysis');
    expect(tabValues).not.toContain('quant_alpha');
    expect(tabLabels).not.toContain('Quant Alpha');
    expect(tabValues).toEqual(['chart', 'documents', 'indicators', 'performance_lab']);
  });

  it('StockChart does not render Quant Alpha tab or proprietary strategy chips', () => {
    const state = createInitialPortfolioState(mockData, 'NVDA');
    const html = renderToString(
      <StockChart
        apiBaseUrl="/api/portfolio"
        data={mockData}
        state={state}
        dispatch={vi.fn()}
      />
    );

    // Guardrail: Quant Alpha tab button must NEVER render in StockChart
    expect(html).not.toContain('Quant Alpha');
    expect(html).not.toContain('pw-strategy-toggle-row');
    expect(html).not.toContain('Loading Quant Alpha models...');

    // Guardrail: None of the 8 proprietary strategies may be rendered as buttons/chips
    const proprietaryStrategyLabels = [
      'Supertrend',
      'Squeeze',
      'Regime',
      'Exhaustion',
      'Reversion',
      'Breakout',
      'Accumulation',
      'Structure'
    ];
    proprietaryStrategyLabels.forEach((label) => {
      expect(html).not.toContain(`>${label}<`);
    });

    // Guardrail: Technical indicators row is rendered and clean
    expect(html).toContain('Indicators');
    expect(html).toContain('MA50');
    expect(html).toContain('MA200');
    expect(html).toContain('RSI14');
  });

  it('StockChart renders Quant Alpha tab and strategy chips when enableQuantAlpha={true}', () => {
    const state = {
      ...createInitialPortfolioState(mockData, 'NVDA'),
      chartCategory: 'strategies'
    };
    const html = renderToString(
      <StockChart
        apiBaseUrl="/api/portfolio"
        data={mockData}
        state={state}
        dispatch={vi.fn()}
        enableQuantAlpha={true}
      />
    );

    // Host opt-in: Quant Alpha tab button is rendered
    expect(html).toContain('Quant Alpha');
    expect(html).toContain('pw-strategy-toggle-row');

    // Host opt-in: Proprietary strategy buttons are rendered
    expect(html).toContain('>Supertrend<');
    expect(html).toContain('>Squeeze<');
    expect(html).toContain('>Regime<');
  });
});

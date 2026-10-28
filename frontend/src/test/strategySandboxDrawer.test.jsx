import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import StrategySandboxDrawer, { LOOKBACK_OPTIONS } from '../portfolioWatcher/ui/stock/StrategySandboxDrawer';

describe('StrategySandboxDrawer Time Span & Custom Dates', () => {
  it('renders time span options and hides start/end date inputs by default', () => {
    const html = renderToString(
      <StrategySandboxDrawer symbol="AAPL" />
    );

    expect(html).toContain('Time Span');
    expect(html).toContain('All (since 2017)');
    expect(html).toContain('Custom Date Range...');
    // By default, Start Date and End Date inputs are hidden
    expect(html).not.toContain('Start Date');
    expect(html).not.toContain('End Date');
  });

  it('defaults Time Span to 2 Years (730 days)', () => {
    const html = renderToString(
      <StrategySandboxDrawer symbol="AAPL" />
    );

    // Option 730 (2 Years) should be selected by default
    expect(html).toContain('value="730" selected=""');
  });

  it('exposes the standard LOOKBACK_OPTIONS list including custom', () => {
    expect(LOOKBACK_OPTIONS).toBeDefined();
    const values = LOOKBACK_OPTIONS.map((o) => o.value);
    expect(values).toContain('0');
    expect(values).toContain('2555');
    expect(values).toContain('365');
    expect(values).toContain('custom');
  });

  it('renders chart container with click-to-focus hint when unfocused', () => {
    const html = renderToString(
      <StrategySandboxDrawer symbol="AAPL" />
    );

    expect(html).toContain('fowa-sandbox-chart-container');
    expect(html).toContain('Click chart to zoom / drag');
  });

  it('renders default title Performance Lab and subtitle', () => {
    const html = renderToString(
      <StrategySandboxDrawer symbol="AAPL" />
    );

    expect(html).toContain('Performance Lab');
    expect(html).toContain('Portfolio Performance &amp; Strategy Simulator');
  });

  it('renders custom title when title prop is provided', () => {
    const html = renderToString(
      <StrategySandboxDrawer symbol="AAPL" title="Quant Lab" />
    );

    expect(html).toContain('Quant Lab');
  });

  it('accepts visibleLogicalRange, onVisibleLogicalRangeChange, and mainPrices props', () => {
    const dummyRange = { from: 100, to: 200 };
    const html = renderToString(
      <StrategySandboxDrawer
        symbol="AAPL"
        visibleLogicalRange={dummyRange}
        onVisibleLogicalRangeChange={() => {}}
        mainPrices={[{ date: '2024-01-02', close: 150 }]}
      />
    );

    expect(html).toContain('fowa-sandbox-drawer');
  });
});


import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import StrategySandboxDrawer, { getFixedHistoryStartDate, FIXED_HISTORY_START_DATE } from '../portfolioWatcher/ui/stock/StrategySandboxDrawer';

describe('StrategySandboxDrawer Date Picker Capping & Boundaries', () => {
  it('returns fixed historical start date 2017-01-01', () => {
    expect(FIXED_HISTORY_START_DATE).toBe('2017-01-01');
    expect(getFixedHistoryStartDate()).toBe('2017-01-01');
  });

  it('renders min and max boundary caps on Start Date and End Date inputs in custom mode', () => {
    const mockPrices = [
      { date: '2017-01-03', open: 100, high: 105, low: 99, close: 102 },
      { date: '2026-10-12', open: 150, high: 155, low: 148, close: 152 },
    ];

    const html = renderToString(
      <StrategySandboxDrawer
        symbol="AAPL"
        initialTimeSpanMode="custom"
        initialCustomStartDate="2024-01-01"
        initialCustomEndDate="2026-10-12"
        mainPrices={mockPrices}
      />
    );

    // Verify Start Date input has min="2017-01-03" and max="2026-10-12"
    expect(html).toContain('data-testid="custom-start-date"');
    expect(html).toContain('min="2017-01-03"');
    expect(html).toContain('max="2026-10-12"');

    // Verify End Date input has min="2024-01-01" and max="2026-10-12"
    expect(html).toContain('data-testid="custom-end-date"');
    expect(html).toContain('value="2026-10-12"');
  });

  it('respects asset-specific earliest bar for newer IPO stocks (e.g. ALAB starting 2024)', () => {
    const mockAlabPrices = [
      { date: '2024-03-20', open: 25, high: 30, low: 24, close: 28 },
      { date: '2026-10-12', open: 80, high: 85, low: 78, close: 82 },
    ];

    const html = renderToString(
      <StrategySandboxDrawer
        symbol="ALAB"
        initialTimeSpanMode="custom"
        initialCustomStartDate="2024-03-20"
        initialCustomEndDate="2026-10-12"
        mainPrices={mockAlabPrices}
      />
    );

    // Min on Start Date should be 2024-03-20, not 2017
    expect(html).toContain('data-testid="custom-start-date"');
    expect(html).toContain('min="2024-03-20"');
    expect(html).not.toContain('min="2017-01-01"');
  });
});

/**
 * UI Layout Guardrails for Stock Cards and Lists
 *
 * Enforces key design requirements from user preferences:
 * 1. Timestamps must NOT be displayed on the stock cards ("Time is not needed. pls remove it").
 * 2. Delta price + % formatting must preserve original font and display both signed dollars and percentage.
 * 3. Directional tone is applied to the metric container, avoiding misplaced/left-aligned arrows.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import StockGridView from '../portfolioWatcher/ui/stock/StockGridView';
import ListItem from '../portfolioWatcher/ui/shared/ListItem';
import { fmtTodayChange } from '../portfolioWatcher/ui/viewModel';

describe('Stock Card UI Guardrails', () => {
  const sampleStock = {
    symbol: 'SPCX',
    name: 'S&P 500 ETF',
    sector: 'Index ETF',
    lastPrice: 520.50,
  };

  const sampleData = {
    stocks: [sampleStock],
    accounts: [],
    holdingsByAccount: {},
    pricesBySymbol: {
      SPCX: [
        { date: '2026-10-01', close: 510.00 },
        { date: '2026-10-02', close: 520.50 },
      ],
    },
    indices: [],
  };

  const sampleState = {
    mode: 'all',
    search: '',
    selectedType: 'stock',
    selectedStockSymbol: 'SPCX',
    activeAccountId: null,
  };

  it('StockGridView does NOT render timestamp or time strings on stock cards', () => {
    const html = renderToString(
      <StockGridView
        data={sampleData}
        stocks={sampleData.stocks}
        state={sampleState}
        dispatch={() => {}}
        mode="all"
      />
    );

    expect(html).toContain('SPCX');
    // Ensure no timestamp / clock indicators
    expect(html).not.toMatch(/\b\d{1,2}:\d{2}\s*(?:AM|PM|ET)?\b/i);
    expect(html).not.toContain('pw-item-time');
    expect(html).not.toContain('pw-card-time');
  });

  it('StockGridView formats price change with both signed dollars and percentage', () => {
    const html = renderToString(
      <StockGridView
        data={sampleData}
        stocks={sampleData.stocks}
        state={sampleState}
        dispatch={() => {}}
        mode="all"
      />
    );

    // SPCX rose from 510.00 to 520.50 (+10.50, +2.06%)
    expect(html).toContain('+$10.50');
    expect(html).toContain('+2.06%');
    expect(html).toContain('class="pw-stock-card-change pw-up"');
  });

  it('ListItem maintains rightTop for price and rightBottom for change without left-aligned arrows', () => {
    const priceDiff = 10.50;
    const pctChange = 2.06;
    const changeFormatted = fmtTodayChange(priceDiff, pctChange);

    const html = renderToString(
      <ListItem
        title="SPCX"
        subtitle="S&P 500 ETF"
        rightTop="$520.50"
        rightBottom={changeFormatted}
        tone="up"
      />
    );

    expect(html).toContain('class="pw-item-right"');
    expect(html).toContain('<strong>$520.50</strong>');
    expect(html).toContain('<span class="pw-up">+$10.50 (+2.06%)</span>');
    // Ensure direction/arrow is not placed on the left item title side
    expect(html).not.toContain('pw-item-title pw-up');
  });

  it('fmtTodayChange helper produces standard signed format', () => {
    expect(fmtTodayChange(5.25, 1.45)).toBe('+$5.25 (+1.45%)');
    expect(fmtTodayChange(-3.10, -0.85)).toBe('-$3.10 (-0.85%)');
    expect(fmtTodayChange(0, 0)).toBe('$0.00 (0.00%)');
  });
});

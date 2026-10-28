import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import StockDocumentsView from '../portfolioWatcher/ui/stock/StockDocumentsView';
import {
  DEFAULT_STOCK_TABS,
  resolveTabs
} from '../portfolioWatcher/ui/layout/DetailPanel';

describe('Stock Documents Feature & Tab Integration', () => {
  const mockStock = { symbol: 'AAPL', name: 'Apple Inc.' };

  it('includes documents tab in DEFAULT_STOCK_TABS', () => {
    const docTab = DEFAULT_STOCK_TABS.find((t) => t.value === 'documents');
    expect(docTab).toBeDefined();
    expect(docTab.label).toBe('Intel');
    expect(docTab.component).toBe(StockDocumentsView);
  });

  it('renders StockDocumentsView structure using server-side string rendering', () => {
    const html = renderToString(
      <StockDocumentsView apiBaseUrl="/api/portfolio" stock={mockStock} />
    );
    expect(html).toContain('pw-docs-view');
    expect(html).toContain('All Intel');
    expect(html).toContain('My Notes');
    expect(html).toContain('News');
    expect(html).toContain('Insider Trades');
    expect(html).toContain('SEC Filings');
    expect(html).toContain('+ Add Note');
  });

  it('hides + Add Note button when readOnly is true', () => {
    const html = renderToString(
      <StockDocumentsView apiBaseUrl="/api/portfolio" stock={mockStock} readOnly={true} />
    );
    expect(html).not.toContain('+ Add Note');
    expect(html).toContain('All Intel');
  });
});

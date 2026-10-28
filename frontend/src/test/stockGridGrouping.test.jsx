import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import StockGridView from '../portfolioWatcher/ui/stock/StockGridView';
import LeftNavigator from '../portfolioWatcher/ui/layout/LeftNavigator';
import { groupStocksBySector, normalizeSector, UNCLASSIFIED_SECTOR_LABEL } from '../portfolioWatcher/ui/stock/stockGrouping';
import { portfolioReducer, createInitialPortfolioState } from '../portfolioWatcher/state/portfolioStore';

const mockStocks = [
  { symbol: 'AAPL', name: 'Apple Inc', sector: 'Technology', lastPrice: 200, previousClose: 190 }, // +5.26%
  { symbol: 'MSFT', name: 'Microsoft Corp', sector: 'Technology', lastPrice: 400, previousClose: 400 }, // 0.00%
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', lastPrice: 150, previousClose: 150 }, // 0.00%
  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', lastPrice: 110, previousClose: 100 }, // +10.00%
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', sector: 'Unknown', lastPrice: 500, previousClose: 500 } // 0.00%
];

const mockData = {
  stocks: mockStocks,
  accounts: [{ id: 1, name: 'Default', type: 'Brokerage' }],
  categories: [],
  holdingsByAccount: { '1': [] },
  pricesBySymbol: {}
};

describe('Stock Grid Grouping Utility (stockGrouping.js)', () => {
  it('normalizes missing, Unknown, or empty sectors to UNCLASSIFIED_SECTOR_LABEL', () => {
    expect(normalizeSector(null)).toBe(UNCLASSIFIED_SECTOR_LABEL);
    expect(normalizeSector('')).toBe(UNCLASSIFIED_SECTOR_LABEL);
    expect(normalizeSector('   ')).toBe(UNCLASSIFIED_SECTOR_LABEL);
    expect(normalizeSector('Unknown')).toBe(UNCLASSIFIED_SECTOR_LABEL);
    expect(normalizeSector('unknown')).toBe(UNCLASSIFIED_SECTOR_LABEL);
    expect(normalizeSector('N/A')).toBe(UNCLASSIFIED_SECTOR_LABEL);
    expect(normalizeSector('Technology')).toBe('Technology');
  });

  it('groups stocks into sectors, sorts alphabetically with unclassified at the end', () => {
    const groups = groupStocksBySector(mockStocks, mockData);

    // Alphabetical: Energy, Healthcare, Technology, Other / Uncategorized
    expect(groups.map((g) => g.sector)).toEqual([
      'Energy',
      'Healthcare',
      'Technology',
      UNCLASSIFIED_SECTOR_LABEL
    ]);

    const techGroup = groups.find((g) => g.sector === 'Technology');
    expect(techGroup.count).toBe(2);
    expect(techGroup.stocks.map((s) => s.symbol)).toEqual(['AAPL', 'MSFT']);

    const otherGroup = groups.find((g) => g.sector === UNCLASSIFIED_SECTOR_LABEL);
    expect(otherGroup.count).toBe(1);
    expect(otherGroup.stocks[0].symbol).toBe('SPY');
  });

  it('calculates average percentage change per sector accurately', () => {
    const groups = groupStocksBySector(mockStocks, mockData);
    const energyGroup = groups.find((g) => g.sector === 'Energy');
    expect(energyGroup.avgChange).toBeCloseTo(10.0, 1);

    const techGroup = groups.find((g) => g.sector === 'Technology');
    // AAPL is +5.263%, MSFT is 0% -> avg is ~2.63%
    expect(techGroup.avgChange).toBeCloseTo(2.63, 1);
  });
});

describe('Portfolio Store Grouping Actions', () => {
  it('toggleGridGroupBy switches between none and sector', () => {
    const initial = { gridGroupBy: 'none' };
    const step1 = portfolioReducer(initial, { type: 'toggleGridGroupBy' });
    expect(step1.gridGroupBy).toBe('sector');

    const step2 = portfolioReducer(step1, { type: 'toggleGridGroupBy' });
    expect(step2.gridGroupBy).toBe('none');
  });

  it('toggleSectorCollapse toggles collapse state for a given sector', () => {
    const initial = { collapsedSectors: {} };
    const step1 = portfolioReducer(initial, { type: 'toggleSectorCollapse', sector: 'Technology' });
    expect(step1.collapsedSectors['Technology']).toBe(true);

    const step2 = portfolioReducer(step1, { type: 'toggleSectorCollapse', sector: 'Technology' });
    expect(step2.collapsedSectors['Technology']).toBe(false);
  });

  it('setAllSectorsCollapse expands or collapses all sectors in batch', () => {
    const initial = { collapsedSectors: { Technology: true } };
    const sectors = ['Energy', 'Healthcare', 'Technology'];

    const collapsedAll = portfolioReducer(initial, {
      type: 'setAllSectorsCollapse',
      collapsed: true,
      sectors
    });
    expect(collapsedAll.collapsedSectors).toEqual({
      Energy: true,
      Healthcare: true,
      Technology: true
    });

    const expandedAll = portfolioReducer(collapsedAll, {
      type: 'setAllSectorsCollapse',
      collapsed: false,
      sectors
    });
    expect(expandedAll.collapsedSectors).toEqual({});
  });
});

describe('StockGridView Grouped Rendering', () => {
  it('renders flat grid without sector dividers when gridGroupBy is none', () => {
    const state = {
      search: '',
      gridGroupBy: 'none',
      selectedType: 'stock',
      selectedStockSymbol: 'AAPL',
      activeAccountId: 1
    };

    const html = renderToString(
      <StockGridView
        data={mockData}
        stocks={mockStocks}
        mode="all"
        state={state}
        dispatch={vi.fn()}
      />
    );

    expect(html).not.toContain('pw-grid-sector-divider');
    expect(html).not.toContain('pw-grid-group-toolbar');
    expect(html).toContain('AAPL');
    expect(html).toContain('MSFT');
  });

  it('renders sector dividers and group toolbar when gridGroupBy is sector', () => {
    const state = {
      search: '',
      gridGroupBy: 'sector',
      collapsedSectors: {},
      selectedType: 'stock',
      selectedStockSymbol: 'AAPL',
      activeAccountId: 1
    };

    const html = renderToString(
      <StockGridView
        data={mockData}
        stocks={mockStocks}
        mode="all"
        state={state}
        dispatch={vi.fn()}
      />
    );

    expect(html).toContain('pw-grid-sector-divider');
    expect(html).toContain('pw-grid-group-toolbar');
    expect(html).toContain('Technology');
    expect(html).toContain('Healthcare');
    expect(html).toContain('Energy');
    expect(html).toContain(UNCLASSIFIED_SECTOR_LABEL);
    expect(html).toContain('Collapse All');
    expect(html).toContain('Expand All');
    expect(html).toContain('avg');
  });

  it('hides stock cards when a sector is collapsed', () => {
    const state = {
      search: '',
      gridGroupBy: 'sector',
      collapsedSectors: { Technology: true },
      selectedType: 'stock',
      selectedStockSymbol: 'JNJ',
      activeAccountId: 1
    };

    const html = renderToString(
      <StockGridView
        data={mockData}
        stocks={mockStocks}
        mode="all"
        state={state}
        dispatch={vi.fn()}
      />
    );

    // Technology header is still rendered with collapsed indicator
    expect(html).toContain('Technology');
    expect(html).toContain('pw-collapsed');
    // AAPL and MSFT are inside Technology, so they must NOT be rendered
    expect(html).not.toContain('AAPL');
    expect(html).not.toContain('MSFT');
    // Healthcare is not collapsed, so JNJ IS rendered
    expect(html).toContain('JNJ');
  });

  it('filters sectors when search query is entered', () => {
    const state = {
      search: 'Apple',
      gridGroupBy: 'sector',
      collapsedSectors: {},
      selectedType: 'stock',
      selectedStockSymbol: 'AAPL',
      activeAccountId: 1
    };

    const html = renderToString(
      <StockGridView
        data={mockData}
        stocks={mockStocks}
        mode="all"
        state={state}
        dispatch={vi.fn()}
      />
    );

    // Technology contains Apple, so it is rendered
    expect(html).toContain('Technology');
    expect(html).toContain('AAPL');
    // Healthcare and Energy have no match for "Apple", so their headers are hidden
    expect(html).not.toContain('Healthcare');
    expect(html).not.toContain('Energy');
  });
});

describe('LeftNavigator Group Toggle Button', () => {
  it('renders pw-group-toggle button when in Grid View', () => {
    const state = {
      leftTab: 'all',
      viewMode: 'grid',
      gridGroupBy: 'none',
      search: '',
      selectedType: 'stock',
      selectedStockSymbol: 'AAPL',
      activeAccountId: 1
    };

    const html = renderToString(
      <LeftNavigator
        data={mockData}
        state={state}
        dispatch={vi.fn()}
      />
    );

    expect(html).toContain('pw-group-toggle');
    expect(html).toContain('Group stocks by sector');
  });

  it('pw-group-toggle reflects active state when gridGroupBy is sector', () => {
    const state = {
      leftTab: 'all',
      viewMode: 'grid',
      gridGroupBy: 'sector',
      search: '',
      selectedType: 'stock',
      selectedStockSymbol: 'AAPL',
      activeAccountId: 1
    };

    const html = renderToString(
      <LeftNavigator
        data={mockData}
        state={state}
        dispatch={vi.fn()}
      />
    );

    expect(html).toContain('pw-group-toggle');
    expect(html).toContain('pw-active');
  });
});

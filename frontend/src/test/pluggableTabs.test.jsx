import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import DetailPanel, {
  DEFAULT_STOCK_TABS,
  DEFAULT_ACCOUNT_TABS,
  resolveTabs
} from '../portfolioWatcher/ui/layout/DetailPanel';
import { portfolioReducer, isStockTab } from '../portfolioWatcher/state/portfolioStore';
import PortfolioWatcherApp from '../portfolioWatcher/PortfolioWatcherApp';
import PortfolioShell from '../portfolioWatcher/ui/layout/PortfolioShell';

describe('Pluggable Tabs - Configuration and Resolution', () => {
  it('exports default stock tabs with chart, documents, indicators, and performance_lab', () => {
    const values = DEFAULT_STOCK_TABS.map((t) => t.value);
    expect(values).toEqual(['chart', 'documents', 'indicators', 'performance_lab']);
  });

  it('exports default account tabs with overview, allocation, and performance', () => {
    const values = DEFAULT_ACCOUNT_TABS.map((t) => t.value);
    expect(values).toEqual(['overview', 'allocation', 'performance']);
  });

  it('resolveTabs returns default tabs when custom/extra tabs are omitted', () => {
    const tabs = resolveTabs(DEFAULT_STOCK_TABS, null, []);
    expect(tabs.map((t) => t.value)).toEqual(['chart', 'documents', 'indicators', 'performance_lab']);
  });

  it('resolveTabs appends extra tabs when extraTabs array is provided', () => {
    const extra = [
      { value: 'pro_signals', label: 'Pro Signals' },
      { id: 'risk', name: 'Risk Analytics' }
    ];
    const tabs = resolveTabs(DEFAULT_STOCK_TABS, null, extra);
    expect(tabs.map((t) => t.value)).toEqual(['chart', 'documents', 'indicators', 'performance_lab', 'pro_signals', 'risk']);
    expect(tabs.find((t) => t.value === 'risk').label).toBe('Risk Analytics');
  });

  it('resolveTabs replaces defaults when customTabs array is provided', () => {
    const custom = [
      { value: 'custom_chart', label: 'Custom Chart' },
      { value: 'metrics', label: 'Key Metrics' }
    ];
    const tabs = resolveTabs(DEFAULT_STOCK_TABS, custom, []);
    expect(tabs.map((t) => t.value)).toEqual(['custom_chart', 'metrics']);
  });

  it('resolveTabs allows filtering or modifying defaults when customTabs is a function', () => {
    // Used by host applications to inject custom tabs
    const modifier = (defaults) => [
      defaults[0],
      { value: 'analysis', label: 'Analysis' },
      ...defaults.slice(1)
    ];
    const tabs = resolveTabs(DEFAULT_STOCK_TABS, modifier, []);
    expect(tabs.map((t) => t.value)).toEqual(['chart', 'analysis', 'documents', 'indicators', 'performance_lab']);
  });

  it('PortfolioWatcherApp re-exports tab definitions and resolveTabs', () => {
    expect(PortfolioWatcherApp).toBeDefined();
    expect(DEFAULT_STOCK_TABS).toBeDefined();
    expect(DEFAULT_ACCOUNT_TABS).toBeDefined();
    expect(resolveTabs).toBeDefined();
  });
});

describe('Pluggable Tabs - DetailPanel Rendering', () => {
  const mockData = {
    accounts: [{ id: 1, name: 'Main Account', type: 'Taxable' }],
    stocks: [{ symbol: 'AAPL', name: 'Apple Inc.', lastPrice: 200, sector: 'Technology' }],
    pricesBySymbol: {},
    holdingsByAccount: {}
  };

  const stockState = {
    selectedType: 'stock',
    selectedStockSymbol: 'AAPL',
    selectedAccountId: null,
    rightTab: 'chart',
    navigatorMode: 'view'
  };

  it('renders default tabs in SegmentedControl when no custom tabs are provided', () => {
    const html = renderToString(
      <DetailPanel
        apiBaseUrl="/api/portfolio"
        data={mockData}
        state={stockState}
        dispatch={vi.fn()}
      />
    );

    expect(html).toContain('Chart');
    expect(html).toContain('Indicators');
  });

  it('renders dividers in default portfolio-watcher tabs: [Chart, Intel] | [Indicators] | [Performance Lab]', () => {
    const html = renderToString(
      <DetailPanel
        apiBaseUrl="/api/portfolio"
        data={mockData}
        state={stockState}
        dispatch={vi.fn()}
      />
    );

    // Count occurrences of pw-seg-divider
    const dividerMatches = html.match(/class="pw-seg-divider"/g) || [];
    expect(dividerMatches.length).toBe(2);

    // Verify ordering in rendered HTML:
    // Chart -> Intel -> Divider -> Indicators -> Divider -> Performance Lab
    const chartIdx = html.indexOf('>Chart<');
    const intelIdx = html.indexOf('>Intel<');
    const firstDivIdx = html.indexOf('class="pw-seg-divider"');
    const indIdx = html.indexOf('>Indicators<');
    const secondDivIdx = html.indexOf('class="pw-seg-divider"', firstDivIdx + 1);
    const labIdx = html.indexOf('>Performance Lab<');

    expect(chartIdx).toBeLessThan(intelIdx);
    expect(intelIdx).toBeLessThan(firstDivIdx);
    expect(firstDivIdx).toBeLessThan(indIdx);
    expect(indIdx).toBeLessThan(secondDivIdx);
    expect(secondDivIdx).toBeLessThan(labIdx);
  });

  it('renders dividers when extended by host application: [Chart, Intel] | [Indicators] | [Quant Alpha] | [Performance Lab]', () => {
    const customTabsFunc = (defaults) => [
      defaults[0], // Chart
      defaults[1], // Intel
      defaults[2], // Indicators
      { value: 'quant_alpha', label: 'Quant Alpha', component: () => null, dividerAfter: true },
      defaults[3]  // Performance Lab
    ];

    const html = renderToString(
      <DetailPanel
        apiBaseUrl="/api/portfolio"
        data={mockData}
        state={stockState}
        dispatch={vi.fn()}
        stockTabs={customTabsFunc}
      />
    );

    const dividerMatches = html.match(/class="pw-seg-divider"/g) || [];
    expect(dividerMatches.length).toBe(3);

    const intelIdx = html.indexOf('>Intel<');
    const firstDivIdx = html.indexOf('class="pw-seg-divider"');
    const indIdx = html.indexOf('>Indicators<');
    const secondDivIdx = html.indexOf('class="pw-seg-divider"', firstDivIdx + 1);
    const quantIdx = html.indexOf('>Quant Alpha<');
    const thirdDivIdx = html.indexOf('class="pw-seg-divider"', secondDivIdx + 1);
    const labIdx = html.indexOf('>Performance Lab<');

    expect(intelIdx).toBeLessThan(firstDivIdx);
    expect(firstDivIdx).toBeLessThan(indIdx);
    expect(indIdx).toBeLessThan(secondDivIdx);
    expect(secondDivIdx).toBeLessThan(quantIdx);
    expect(quantIdx).toBeLessThan(thirdDivIdx);
    expect(thirdDivIdx).toBeLessThan(labIdx);
  });

  it('renders pluggable extra tabs in SegmentedControl', () => {
    const CustomTabComponent = () => <div className="custom-tab-content">Custom Content</div>;

    const extraStockTabs = [
      { value: 'pro_signals', label: 'Signals', component: CustomTabComponent }
    ];

    const html = renderToString(
      <DetailPanel
        apiBaseUrl="/api/portfolio"
        data={mockData}
        state={stockState}
        dispatch={vi.fn()}
        extraStockTabs={extraStockTabs}
      />
    );

    expect(html).toContain('Signals');
    expect(html).toContain('Chart');
  });

  it('renders custom tab component and forwards tabProps when active', () => {
    const CustomTabComponent = (props) => (
      <div className="custom-tab-content">
        <span>{`Stock: ${props.stock?.symbol}`}</span>
        <span>{`Api: ${props.apiBaseUrl}`}</span>
        <span>{`ReadOnly: ${String(props.readOnly)}`}</span>
      </div>
    );

    const extraStockTabs = [
      { value: 'my_extension', label: 'Extension', component: CustomTabComponent }
    ];

    const activeCustomState = {
      ...stockState,
      rightTab: 'my_extension'
    };

    const html = renderToString(
      <DetailPanel
        apiBaseUrl="/api/portfolio"
        readOnly={true}
        data={mockData}
        state={activeCustomState}
        dispatch={vi.fn()}
        extraStockTabs={extraStockTabs}
      />
    );

    expect(html).toContain('Stock: AAPL');
    expect(html).toContain('Api: /api/portfolio');
    expect(html).toContain('ReadOnly: true');
  });

  it('supports custom render function instead of component class', () => {
    const extraStockTabs = [
      {
        value: 'custom_render_tab',
        label: 'Render Slot',
        render: (props) => (
          <div className="render-slot-content">
            {`Custom render for ${props.stock?.name}`}
          </div>
        )
      }
    ];

    const activeCustomState = {
      ...stockState,
      rightTab: 'custom_render_tab'
    };

    const html = renderToString(
      <DetailPanel
        apiBaseUrl="/api/portfolio"
        data={mockData}
        state={activeCustomState}
        dispatch={vi.fn()}
        extraStockTabs={extraStockTabs}
      />
    );

    expect(html).toContain('Custom render for Apple Inc.');
  });

  it('replaces all tabs when stockTabs array is passed', () => {
    const CustomOnly = () => <div>Only Tab</div>;
    const stockTabs = [
      { value: 'only_tab', label: 'Exclusive', component: CustomOnly }
    ];

    const html = renderToString(
      <DetailPanel
        apiBaseUrl="/api/portfolio"
        data={mockData}
        state={stockState}
        dispatch={vi.fn()}
        stockTabs={stockTabs}
      />
    );

    expect(html).toContain('Exclusive');
    expect(html).not.toContain('Indicators');
    expect(html).not.toContain('Analysis');
  });
});

describe('Preserving Focused Tab on Stock Selection', () => {
  it('isStockTab returns true for stock tabs and false for account tabs', () => {
    expect(isStockTab('chart')).toBe(true);
    expect(isStockTab('indicators')).toBe(true);
    expect(isStockTab('documents')).toBe(true);
    expect(isStockTab('overview')).toBe(false);
    expect(isStockTab('allocation')).toBe(false);
    expect(isStockTab('performance')).toBe(false);
  });

  it('preserves indicators tab when selecting a new stock', () => {
    const state = {
      selectedType: 'stock',
      selectedStockSymbol: 'ALAB',
      rightTab: 'indicators',
      chartMode: '7y'
    };
    const nextState = portfolioReducer(state, { type: 'selectStock', symbol: 'ARM' });
    expect(nextState.selectedStockSymbol).toBe('ARM');
    expect(nextState.rightTab).toBe('indicators');
  });

  it('preserves documents (intel) tab when selecting a new stock', () => {
    const state = {
      selectedType: 'stock',
      selectedStockSymbol: 'ALAB',
      rightTab: 'documents',
      chartMode: '7y'
    };
    const nextState = portfolioReducer(state, { type: 'selectStock', symbol: 'ARM' });
    expect(nextState.selectedStockSymbol).toBe('ARM');
    expect(nextState.rightTab).toBe('documents');
  });

  it('defaults to chart tab when switching from an account overview to a stock', () => {
    const state = {
      selectedType: 'account',
      selectedAccountId: 1,
      rightTab: 'overview'
    };
    const nextState = portfolioReducer(state, { type: 'selectStock', symbol: 'ALAB' });
    expect(nextState.selectedStockSymbol).toBe('ALAB');
    expect(nextState.rightTab).toBe('chart');
  });

  it('renders customRightPanel inside PortfolioShell while keeping LeftNavigator visible', () => {
    const mockData = {
      accounts: [{ id: 1, name: 'moomoo', type: 'Taxable', categoryKey: 'accounts' }],
      stocks: [{ symbol: 'NVDA', name: 'NVIDIA', lastPrice: 120, sector: 'Technology' }],
      pricesBySymbol: {},
      holdingsByAccount: { 1: [{ symbol: 'NVDA', shares: 10 }] }
    };
    const state = {
      leftTab: 'accounts',
      activeAccountId: 1,
      selectedType: 'stock',
      selectedStockSymbol: 'NVDA',
      rightTab: 'chart',
      navigatorMode: 'view'
    };
    const html = renderToString(
      <PortfolioShell
        apiBaseUrl="/api/portfolio"
        data={mockData}
        state={state}
        dispatch={vi.fn()}
        actions={{}}
        customRightPanel={({ data: d }) => (
          <div data-testid="custom-mission-hub">{`Mission Hub for ${d.accounts[0].name}`}</div>
        )}
      />
    );
    expect(html).toContain('Mission Hub for moomoo');
    expect(html).toContain('pw-portfolio-tree-row');
  });
});



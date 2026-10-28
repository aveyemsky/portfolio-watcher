import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import LeftNavigator from '../portfolioWatcher/ui/layout/LeftNavigator';
import CategoryAccordion from '../portfolioWatcher/ui/account/CategoryAccordion';
import StockList from '../portfolioWatcher/ui/stock/StockList';
import StockGridView from '../portfolioWatcher/ui/stock/StockGridView';
import {
  fetchCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  fetchMasterStocks,
  addPortfolioSection,
  deletePortfolioSection,
  reorderPortfolioItems
} from '../portfolioWatcher/api/portfolioApi';

const mockCategories = [
  { id: 'cat-1', name: 'Brokerage Accounts', sortOrder: 0, isDefault: true },
  { id: 'cat-2', name: 'Sector Baskets', sortOrder: 1, isDefault: true },
  { id: 'cat-3', name: 'Action Watchlists', sortOrder: 2, isDefault: true }
];

const mockAccounts = [
  { id: 1, name: 'moomoo', type: 'Brokerage', categoryId: 'cat-1', sortOrder: 0 },
  { id: 2, name: 'Tech Rotation', type: 'Basket', categoryId: 'cat-2', sortOrder: 0 }
];

const mockStocks = [
  { symbol: 'NVDA', name: 'NVIDIA Corp', lastPrice: 130.0 },
  { symbol: 'AAPL', name: 'Apple Inc', lastPrice: 220.0 }
];

const mockData = {
  stocks: mockStocks,
  categories: mockCategories,
  accounts: mockAccounts,
  holdingsByAccount: {
    '1': [{ id: 101, symbol: 'NVDA', shares: 10, avgCost: 100 }],
    '2': [
      { id: 201, isSectionHeader: true, sectionLabel: '=== TOP MOMENTUM ===', sortOrder: 0 },
      { id: 202, symbol: 'AAPL', shares: 5, avgCost: 200, sortOrder: 1 }
    ]
  },
  pricesBySymbol: {
    NVDA: [{ date: '2026-10-01', close: 125.0 }, { date: '2026-10-02', close: 130.0 }],
    AAPL: [{ date: '2026-10-01', close: 215.0 }, { date: '2026-10-02', close: 220.0 }]
  },
  masterStocksSummary: {
    totalDistinct: 2
  }
};

describe('Dynamic Portfolio Categories & In-List Sectioning UI', () => {

  it('renders All tab with distinct ticker count in segmented control', () => {
    const state = {
      leftTab: 'all',
      accountDrilldown: false,
      navigatorMode: 'view',
      viewMode: 'list',
      search: '',
      collapsedCategoryIds: {}
    };

    const html = renderToString(
      <LeftNavigator
        data={mockData}
        state={state}
        dispatch={vi.fn()}
      />
    );

    expect(html).toContain('All (2)');
    expect(html).not.toContain('pw-pinned-all-stocks-wrap');
  });

  it('renders grid toggle button beside segmented control tabs and omits Navigator title', () => {
    const state = {
      leftTab: 'all',
      accountDrilldown: false,
      navigatorMode: 'view',
      viewMode: 'list',
      search: '',
      collapsedCategoryIds: {}
    };

    const html = renderToString(
      <LeftNavigator
        data={mockData}
        state={state}
        dispatch={vi.fn()}
      />
    );

    // Navigator heading text should be removed
    expect(html).not.toContain('<h3 class="pw-pane-title">Navigator</h3>');
    expect(html).not.toContain('Navigator</h3>');

    // Both segmented control tabs and pw-view-toggle should be within pw-nav-title-group
    expect(html).toContain('pw-nav-title-group');
    expect(html).toContain('pw-view-toggle');
    expect(html).toContain('All (2)');
    expect(html).toContain('Portfolios');

    // In the HTML string, Portfolios tab comes before pw-view-toggle
    const portfoliosIdx = html.indexOf('Portfolios');
    const viewToggleIdx = html.indexOf('pw-view-toggle');
    expect(portfoliosIdx).toBeGreaterThan(-1);
    expect(viewToggleIdx).toBeGreaterThan(portfoliosIdx);
  });

  it('renders default categories and portfolios in Category Accordions on Portfolios tab', () => {
    const state = {
      leftTab: 'accounts',
      accountDrilldown: false,
      navigatorMode: 'view',
      viewMode: 'list',
      search: '',
      collapsedCategoryIds: {}
    };

    const html = renderToString(
      <LeftNavigator
        data={mockData}
        state={state}
        dispatch={vi.fn()}
      />
    );

    expect(html).toContain('Brokerage Accounts');
    expect(html).toContain('Sector Baskets');
    expect(html).toContain('Action Watchlists');
    expect(html).toContain('moomoo');
    expect(html).toContain('Tech Rotation');
    expect(html).not.toContain('+ New Category');
  });

  it('hides "+ New Category" in view mode and displays it in edit (manage) mode', () => {
    const viewState = {
      leftTab: 'accounts',
      accountDrilldown: false,
      navigatorMode: 'view',
      viewMode: 'list',
      search: '',
      collapsedCategoryIds: {}
    };

    const viewHtml = renderToString(
      <LeftNavigator
        data={mockData}
        state={viewState}
        dispatch={vi.fn()}
      />
    );
    expect(viewHtml).not.toContain('+ New Category');

    const manageState = {
      ...viewState,
      navigatorMode: 'manage'
    };

    const manageHtml = renderToString(
      <LeftNavigator
        data={mockData}
        state={manageState}
        dispatch={vi.fn()}
      />
    );
    expect(manageHtml).toContain('+ New Category');
  });

  it('hides "+ Add Section Divider" in view mode and displays it in edit (manage) mode', () => {
    const viewState = {
      leftTab: 'accounts',
      accountDrilldown: true,
      activeAccountId: 1,
      navigatorMode: 'view',
      viewMode: 'list',
      search: '',
      collapsedCategoryIds: {}
    };

    const viewHtml = renderToString(
      <LeftNavigator
        data={mockData}
        state={viewState}
        dispatch={vi.fn()}
      />
    );
    expect(viewHtml).toContain('Holdings');
    expect(viewHtml).not.toContain('+ Add Section Divider');

    const manageState = {
      ...viewState,
      navigatorMode: 'manage'
    };

    const manageHtml = renderToString(
      <LeftNavigator
        data={mockData}
        state={manageState}
        dispatch={vi.fn()}
      />
    );
    expect(manageHtml).toContain('Holdings');
    expect(manageHtml).toContain('+ Add Section Divider');
  });

  it('omits legacy bottom portfolio input fields from categories view in edit mode', () => {
    const manageCategoriesState = {
      leftTab: 'accounts',
      accountDrilldown: false,
      navigatorMode: 'manage',
      viewMode: 'list',
      search: '',
      collapsedCategoryIds: {}
    };

    const html = renderToString(
      <LeftNavigator
        data={mockData}
        state={manageCategoriesState}
        dispatch={vi.fn()}
      />
    );

    expect(html).toContain('+ New Category');
    expect(html).not.toContain('Create Portfolio');
    expect(html).not.toContain('placeholder="Portfolio name"');
    expect(html).not.toContain('placeholder="Portfolio type"');
  });

  it('renders Sync button in manage mode with independent state from Add button', () => {
    const manageAllState = {
      leftTab: 'all',
      accountDrilldown: false,
      navigatorMode: 'manage',
      viewMode: 'list',
      search: '',
      collapsedCategoryIds: {}
    };

    const html = renderToString(
      <LeftNavigator
        data={mockData}
        state={manageAllState}
        dispatch={vi.fn()}
      />
    );

    // Add stock button renders "Add" (not "Adding...")
    expect(html).toContain('Add stock');
    expect(html).toContain('>Add</button>');
    expect(html).not.toContain('Adding...</button>');

    // Sync button renders "Sync"
    expect(html).toContain('pw-secondary-action');
    expect(html).toContain('Sync</button>');
  });

  it('renders section dividers in StockList with label and delete action when in manageMode', () => {
    const holdingsWithSection = [
      { id: 201, isSectionHeader: true, sectionLabel: '=== TOP MOMENTUM ===' },
      { id: 202, symbol: 'AAPL', name: 'Apple Inc', lastPrice: 220.0 }
    ];

    const onRemoveSection = vi.fn();

    const html = renderToString(
      <StockList
        data={mockData}
        stocks={holdingsWithSection}
        mode="holdings"
        state={{ selectedStockSymbol: 'AAPL' }}
        dispatch={vi.fn()}
        manageMode={true}
        onRemoveSection={onRemoveSection}
      />
    );

    expect(html).toContain('pw-list-section-header');
    expect(html).toContain('=== TOP MOMENTUM ===');
    expect(html).toContain('pw-section-remove-btn');
    expect(html).toContain('AAPL');
  });

  it('renders section dividers across all columns in StockGridView', () => {
    const holdingsWithSection = [
      { id: 201, isSectionHeader: true, sectionLabel: '=== PULLBACKS ===' },
      { id: 202, symbol: 'NVDA', name: 'NVIDIA Corp', lastPrice: 130.0 }
    ];

    const html = renderToString(
      <StockGridView
        data={mockData}
        stocks={holdingsWithSection}
        mode="holdings"
        state={{ selectedStockSymbol: 'NVDA' }}
        dispatch={vi.fn()}
        manageMode={false}
      />
    );

    expect(html).toContain('pw-grid-section-divider');
    expect(html).toContain('=== PULLBACKS ===');
    expect(html).toContain('NVDA');
  });

  it('CategoryAccordion displays [⋮] options menu trigger', () => {
    const html = renderToString(
      <CategoryAccordion
        category={{ id: 'cat-1', name: 'Sector Baskets' }}
        portfolios={[]}
        isCollapsed={false}
        data={mockData}
      />
    );

    expect(html).toContain('pw-category-menu-trigger');
    expect(html).toContain('Sector Baskets');
  });
});

describe('Category & Section API Client Methods', () => {
  it('fetchCategories sends GET request to /api/categories', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ categories: [] })
    });

    await fetchCategories('/api');
    expect(fetchSpy).toHaveBeenCalledWith('/api/categories', expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/json' })
    }));
    vi.restoreAllMocks();
  });

  it('createCategory sends POST request with name and sortOrder', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ category: { id: 'c-new', name: 'Macro Trends' } })
    });

    await createCategory('/api', { name: 'Macro Trends', sortOrder: 3 });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/categories',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Macro Trends', sortOrder: 3 })
      })
    );
    vi.restoreAllMocks();
  });

  it('deleteCategory sends DELETE request with ?delete_portfolios=true when boolean or options provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true })
    });

    // Test with boolean true
    await deleteCategory('/api', 'cat-1', true);
    expect(fetchSpy).toHaveBeenCalledWith('/api/categories/cat-1?delete_portfolios=true', expect.objectContaining({
      method: 'DELETE'
    }));

    // Test with options object { deletePortfolios: true }
    await deleteCategory('/api', 'cat-1', { deletePortfolios: true });
    expect(fetchSpy).toHaveBeenCalledWith('/api/categories/cat-1?delete_portfolios=true', expect.objectContaining({
      method: 'DELETE'
    }));

    // Test with false
    await deleteCategory('/api', 'cat-1', false);
    expect(fetchSpy).toHaveBeenCalledWith('/api/categories/cat-1', expect.objectContaining({
      method: 'DELETE'
    }));

    vi.restoreAllMocks();
  });

  it('CategoryAccordion renders portfolio delete button when onDeletePortfolio is provided', () => {
    const html = renderToString(
      <CategoryAccordion
        category={{ id: 'uncategorized', name: 'Uncategorized' }}
        portfolios={[{ id: 99, name: 'Test Portfolio', type: 'Brokerage' }]}
        isCollapsed={false}
        data={mockData}
        onDeletePortfolio={() => {}}
      />
    );

    expect(html).toContain('pw-portfolio-delete-btn');
    expect(html).toContain('Delete Test Portfolio');
  });

  it('addPortfolioSection sends POST request to /api/portfolios/:id/section', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ item: { id: 99, isSectionHeader: true, sectionLabel: '=== LEADERS ===' } })
    });

    await addPortfolioSection('/api', 1, '=== LEADERS ===', 0);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/portfolios/1/section',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sectionLabel: '=== LEADERS ===', sortOrder: 0 })
      })
    );
    vi.restoreAllMocks();
  });

  it('reorderPortfolioItems sends PUT request to /api/portfolios/:id/items/reorder', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ id: 101, sortOrder: 0 }])
    });

    await reorderPortfolioItems('/api', 1, [{ id: 101, sortOrder: 0 }, { id: 201, sortOrder: 1 }]);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/portfolios/1/items/reorder',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ items: [{ id: 101, sortOrder: 0 }, { id: 201, sortOrder: 1 }] })
      })
    );
    vi.restoreAllMocks();
  });

  it('StockList renders drag handles when in manageMode for holdings', () => {
    const holdings = [
      { id: 201, isSectionHeader: true, sectionLabel: '=== LEADERS ===', sortOrder: 0 },
      { id: 101, symbol: 'NVDA', name: 'NVIDIA Corp', lastPrice: 130, shares: 10, avgCost: 100, sortOrder: 1 }
    ];

    const html = renderToString(
      <StockList
        data={mockData}
        stocks={holdings}
        mode="holdings"
        state={{ activeAccountId: 1, search: '' }}
        manageMode={true}
        onReorderItems={() => {}}
      />
    );

    expect(html).toContain('pw-draggable-item');
    expect(html).toContain('pw-drag-handle');
    expect(html).toContain('has-drag-handle');
    expect(html).toContain('=== LEADERS ===');
    expect(html).toContain('NVDA');
  });
});

describe('Standardized ModalDialog and ConfirmDialog Components', () => {
  it('ModalDialog renders title, content, close button, and actions', async () => {
    const { default: ModalDialog } = await import('../portfolioWatcher/ui/shared/ModalDialog');
    const html = renderToString(
      <ModalDialog
        isOpen={true}
        title="Test Modal"
        onClose={() => {}}
        actions={<button type="button">Confirm</button>}
      >
        <p>Modal body content</p>
      </ModalDialog>
    );

    expect(html).toContain('pw-dialog-backdrop');
    expect(html).toContain('pw-dialog-box');
    expect(html).toContain('Test Modal');
    expect(html).toContain('Modal body content');
    expect(html).toContain('pw-dialog-close-btn');
    expect(html).toContain('Confirm');
  });

  it('ConfirmDialog renders title, message, danger styling, and action buttons', async () => {
    const { ConfirmDialog } = await import('../portfolioWatcher/ui/shared/ModalDialog');
    const html = renderToString(
      <ConfirmDialog
        isOpen={true}
        title="Delete Portfolio: Test 1"
        message="Are you sure you want to delete this portfolio?"
        confirmLabel="Delete Portfolio"
        cancelLabel="Cancel"
        isDanger={true}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(html).toContain('Delete Portfolio: Test 1');
    expect(html).toContain('Are you sure you want to delete this portfolio?');
    expect(html).toContain('pw-btn-danger');
    expect(html).toContain('Delete Portfolio');
    expect(html).toContain('Cancel');
  });

  it('accountDeleted preserves category portfolio view when user was in category view', async () => {
    const { portfolioReducer, LEFT_TABS } = await import('../portfolioWatcher/state/portfolioStore');
    const initialState = {
      activeAccountId: 1,
      selectedAccountId: null,
      leftTab: LEFT_TABS.accounts,
      accountDrilldown: false,
      navigatorMode: 'manage',
      rightTab: 'overview'
    };

    const nextState = portfolioReducer(initialState, {
      type: 'accountDeleted',
      accountId: 1,
      nextAccountId: 2
    });

    expect(nextState.leftTab).toBe(LEFT_TABS.accounts);
    expect(nextState.accountDrilldown).toBe(false);
    expect(nextState.navigatorMode).toBe('manage');
    expect(nextState.selectedAccountId).toBeNull();
  });
});

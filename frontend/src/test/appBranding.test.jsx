import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import PortfolioWatcherApp from '../portfolioWatcher/PortfolioWatcherApp';
import PortfolioShell from '../portfolioWatcher/ui/layout/PortfolioShell';

describe('PortfolioWatcherApp Branding and Custom Logo', () => {
  it('renders default icon, alt text, and loading message in loading state', () => {
    const html = renderToString(
      <PortfolioWatcherApp apiBaseUrl="/api/portfolio" />
    );

    expect(html).toContain('class="pw-loading"');
    expect(html).toContain('class="pw-loading-logo"');
    expect(html).toContain('alt="PortfolioWatcher"');
    expect(html).toContain('Loading PortfolioWatcher...');
  });

  it('renders custom appIcon, appName, and loadingText when provided', () => {
    const customIcon = '/assets/custom-brand-logo.svg';
    const customName = 'AlphaCockpit';
    const customLoading = 'Loading AlphaCockpit cloud cockpit...';

    const html = renderToString(
      <PortfolioWatcherApp
        apiBaseUrl="/api/portfolio"
        appIcon={customIcon}
        appName={customName}
        loadingText={customLoading}
      />
    );

    expect(html).toContain('class="pw-loading"');
    expect(html).toContain(`src="${customIcon}"`);
    expect(html).toContain(`alt="${customName}"`);
    expect(html).toContain(customLoading);
  });

  it('automatically derives loadingText from custom appName if loadingText is omitted', () => {
    const customName = 'AlphaWatcher';

    const html = renderToString(
      <PortfolioWatcherApp
        apiBaseUrl="/api/portfolio"
        appName={customName}
      />
    );

    expect(html).toContain(`alt="${customName}"`);
    expect(html).toContain(`Loading ${customName}...`);
  });

  it('PortfolioShell renders custom appIcon and appName in header brand when hideHeader is false', () => {
    const customIcon = '/custom-brand-icon.svg';
    const customName = 'Alpha Platform';

    const mockData = {
      stocks: [],
      accounts: [],
      pricesBySymbol: {},
      holdingsByAccount: {},
      indices: []
    };

    const mockState = {
      viewMode: 'list',
      selectedType: 'stock',
      selectedSymbol: null,
      selectedAccountId: null
    };

    const html = renderToString(
      <PortfolioShell
        apiBaseUrl="/api/portfolio"
        hideHeader={false}
        appIcon={customIcon}
        appName={customName}
        data={mockData}
        state={mockState}
        dispatch={vi.fn()}
      />
    );

    expect(html).toContain('class="pw-header"');
    expect(html).toContain('src="/custom-brand-icon.svg"');
    expect(html).toContain('alt="Alpha Platform"');
    expect(html).toContain('Alpha Platform</h1>');
  });
});

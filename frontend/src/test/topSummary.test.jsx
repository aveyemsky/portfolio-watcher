import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import TopSummary from '../portfolioWatcher/ui/layout/TopSummary';
import { fmtIndexValue, fmtIndexTime, fmtObservationDate, getSkewRegime } from '../portfolioWatcher/ui/viewModel';

describe('TopSummary Index Cards (Pic 2 Design)', () => {
  const mockData = {
    indices: [
      {
        symbol: '^DJI',
        name: 'Dow Jones Industrial Average',
        shortName: 'Dow Jones',
        displayOrder: 1,
        lastPrice: 51349.92,
        previousClose: 51481.51,
        updatedAt: '2026-09-29T20:38:50Z'
      },
      {
        symbol: '^GSPC',
        name: 'S&P 500',
        shortName: 'S&P 500',
        displayOrder: 2,
        lastPrice: 7670.84,
        previousClose: 7683.69,
        updatedAt: '2026-09-29T20:38:43Z'
      },
      {
        symbol: '^IXIC',
        name: 'NASDAQ Composite',
        shortName: 'NASDAQ',
        displayOrder: 3,
        lastPrice: 30339.33,
        previousClose: 30276.81,
        updatedAt: '2026-09-29T21:02:41Z'
      }
    ],
    pricesBySymbol: {}
  };

  it('renders index cards with proper tone classes and white-styled structure', () => {
    const html = renderToString(
      <TopSummary data={mockData} state={{}} dispatch={() => {}} />
    );

    // Should include down tone card for negative change and up tone card for positive change
    expect(html).toContain('pw-index-card--down');
    expect(html).toContain('pw-index-card--up');

    // Should display Dow Jones instead of DJIA
    expect(html).toContain('Dow Jones');

    // Should contain formatted index price without dollar sign
    expect(html).toContain('51,349.92');
    expect(html).not.toContain('$51,349.92');

    // Should contain arrow icons
    expect(html).toContain('▼');
    expect(html).toContain('▲');

    // Should not contain LAST timestamp
    expect(html).not.toContain('LAST |');
  });

  it('formats index values cleanly without dollar signs', () => {
    expect(fmtIndexValue(51349.92)).toBe('51,349.92');
    expect(fmtIndexValue(7670.84)).toBe('7,670.84');
    expect(fmtIndexValue(26797.541)).toBe('26,797.541');
  });

  it('formats index timestamp in New York time', () => {
    const formatted = fmtIndexTime('2026-09-29T20:38:50Z');
    expect(formatted).toContain('4:38:50 PM');
    expect(formatted).toMatch(/EDT|EST/);
  });

  it('renders VIX with radial arc gauge, regime badge, and neutral card styling', () => {
    const vixData = {
      indices: [
        {
          symbol: '^VIX',
          name: 'CBOE Volatility Index',
          shortName: 'Volatility (VIX)',
          displayOrder: 6,
          lastPrice: 16.34,
          previousClose: 16.04,
          updatedAt: '2026-09-30T18:30:00Z'
        }
      ],
      pricesBySymbol: {}
    };

    const html = renderToString(
      <TopSummary data={vixData} state={{}} dispatch={() => {}} />
    );

    // Should render with the dedicated vix card class and not the alarming down card
    expect(html).toContain('pw-index-card--vix');
    expect(html).toContain('pw-vix-gauge-svg');
    expect(html).toContain('pw-vix-regime-badge');
    expect(html).toContain('Normal');
    expect(html).toContain('16.34');
    expect(html).toContain('▲');
    expect(html).toContain('+0.30');
  });

  it('renders Macro Radar card adjacent to VIX with Polymarket badge', () => {
    const html = renderToString(
      <TopSummary data={{ indices: [], pricesBySymbol: {} }} state={{}} dispatch={() => {}} />
    );

    expect(html).toContain('pw-index-card--macro');
    expect(html).toContain('Macro Radar');
    expect(html).toContain('POLYMARKET');
    expect(html).toContain('Fed &amp; Macro');
    expect(html).toContain('Crowd Odds');
  });

  it('evaluates SKEW regimes accurately', () => {
    expect(getSkewRegime(110).label).toBe('Low Risk');
    expect(getSkewRegime(110).key).toBe('calm');

    expect(getSkewRegime(125).label).toBe('Normal');
    expect(getSkewRegime(125).key).toBe('normal');

    expect(getSkewRegime(140).label).toBe('Elevated');
    expect(getSkewRegime(140).key).toBe('elevated');

    expect(getSkewRegime(155).label).toBe('Tail Risk');
    expect(getSkewRegime(155).key).toBe('fear');
  });

  it('formats observation date cleanly without timezone shifting', () => {
    expect(fmtObservationDate('2026-10-13')).toBe('Oct 13');
    expect(fmtObservationDate('')).toBe('');
    expect(fmtObservationDate(null)).toBe('');
  });

  it('renders combined rotating panel with SKEW view and observation date when initialRotatingView is skew', () => {
    const dataWithSkew = {
      indices: [
        {
          symbol: '^VIX',
          name: 'CBOE Volatility Index',
          shortName: 'Volatility (VIX)',
          displayOrder: 6,
          lastPrice: 16.34,
          previousClose: 16.04
        },
        {
          symbol: '^SKEW',
          name: 'CBOE SKEW Index',
          shortName: 'Tail Risk (SKEW)',
          displayOrder: 7,
          lastPrice: 153.25,
          previousClose: 151.15,
          quoteDate: '2026-10-13'
        }
      ],
      pricesBySymbol: {}
    };

    const html = renderToString(
      <TopSummary
        data={dataWithSkew}
        state={{}}
        dispatch={() => {}}
        initialRotatingView="skew"
      />
    );

    expect(html).toContain('pw-index-card--skew');
    expect(html).toContain('pw-index-card--rotating');
    expect(html).toContain('pw-rotating-card-slide');
    expect(html).toContain('SKEW Index');
    expect(html).toContain('153.25');
    expect(html).toContain('Oct 13 Close');
    expect(html).toContain('Tail Risk ↗');
    expect(html).not.toContain('0.00%');
    expect(html).toContain('pw-rotating-dots');
    expect(html).toContain('pw-rotating-dot pw-active');
  });

  it('renders combined rotating panel with Polymarket Macro Radar view when initialRotatingView is radar', () => {
    const dataWithSkew = {
      indices: [
        {
          symbol: '^SKEW',
          name: 'CBOE SKEW Index',
          shortName: 'Tail Risk (SKEW)',
          displayOrder: 7,
          lastPrice: 153.25,
          previousClose: 151.15
        }
      ],
      pricesBySymbol: {}
    };

    const html = renderToString(
      <TopSummary
        data={dataWithSkew}
        state={{}}
        dispatch={() => {}}
        initialRotatingView="radar"
      />
    );

    expect(html).toContain('pw-index-card--macro');
    expect(html).toContain('pw-index-card--rotating');
    expect(html).toContain('Macro Radar');
    expect(html).toContain('POLYMARKET');
    expect(html).toContain('pw-rotating-dots');
  });

  it('extractMacroHeadlines extracts punchy titles and round-robins across categories', async () => {
    const { extractMacroHeadlines } = await import('../portfolioWatcher/ui/layout/TopSummary');

    const mockEvents = [
      {
        id: '1',
        title: 'Fed Decision in October?',
        category: 'fed',
        markets: [
          {
            question: 'Will there be no change in Fed interest rates after the October 2026 meeting?',
            outcomes: [{ label: 'Yes', probability_pct: 68.5 }]
          },
          {
            question: 'Will the Fed decrease interest rates by 50+ bps after the October 2026 meeting?',
            outcomes: [{ label: 'Yes', probability_pct: 0.1 }]
          }
        ]
      },
      {
        id: '2',
        title: 'Largest Company end of 2026?',
        category: 'tech',
        markets: [
          {
            question: 'Will NVIDIA be the largest company in the world by market cap?',
            outcomes: [{ label: 'Yes', probability_pct: 71.8 }]
          }
        ]
      },
      {
        id: '3',
        title: 'Crude Oil ATH by end of year?',
        category: 'energy',
        markets: [
          {
            question: 'Will Crude Oil reach a new all-time high by December 31?',
            outcomes: [{ label: 'Yes', probability_pct: 10.5 }]
          }
        ]
      },
      {
        id: '4',
        title: 'US Recession by end of 2026?',
        category: 'recession',
        markets: [
          {
            question: 'US recession by end of 2026?',
            outcomes: [{ label: 'Yes', probability_pct: 8.2 }]
          }
        ]
      }
    ];

    const headlines = extractMacroHeadlines(mockEvents);

    expect(headlines.length).toBe(4);
    // Picks highest probability Fed outcome (Fed Hold 69%, NOT the 0.1% decreasing 50 bps)
    expect(headlines[0].title).toBe('Fed Hold 69%');
    expect(headlines[0].icon).toBe('🏛️');
    expect(headlines[0].category).toBe('Fed');

    // Interleaved tech headline
    expect(headlines[1].title).toBe('NVDA #1 Co 72%');
    expect(headlines[1].icon).toBe('🤖');
    expect(headlines[1].category).toBe('Tech');

    // Interleaved energy headline
    expect(headlines[2].title).toBe('Crude Oil ATH 11%');
    expect(headlines[2].icon).toBe('🛢️');
    expect(headlines[2].category).toBe('Energy');

    // Interleaved recession headline
    expect(headlines[3].title).toBe('US Recession 8%');
    expect(headlines[3].icon).toBe('📉');
    expect(headlines[3].category).toBe('Recession');
  });
});

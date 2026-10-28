import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import StockCard, { getStockCardBadges } from '../portfolioWatcher/ui/stock/StockCard';
import FowaStockChart, { buildFundamentalMarkers, buildUpcomingChartCatalysts } from '../portfolioWatcher/ui/stock/FowaStockChart';
import FundamentalsCatalystDrawer from '../portfolioWatcher/ui/stock/FundamentalsCatalystDrawer';
import { fetchStockFundamentals } from '../portfolioWatcher/api/portfolioApi';

describe('Earnings & Dividend Intelligence — Frontend Guardrails', () => {
  describe('fetchStockFundamentals API contract', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('GETs /stocks/:symbol/fundamentals', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ symbol: 'AAPL' })),
        json: () => Promise.resolve({ symbol: 'AAPL' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await fetchStockFundamentals('/api/portfolio', 'AAPL');
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/portfolio/stocks/AAPL/fundamentals');
      expect(opts.method ?? 'GET').toBe('GET');
    });
  });

  describe('StockCard Badges (Earnings & Dividend)', () => {
    const nowRef = new Date('2026-10-22T12:00:00Z');

    it('renders caution earnings badge right after symbol when next_earnings_date is within <= 7 days', () => {
      const stock = {
        symbol: 'NFLX',
        name: 'Netflix, Inc.',
        lastPrice: 70.53,
        previousClose: 72.61,
        calendar: { next_earnings_date: '2026-10-24' },
        dividend_snapshot: { yield_pct: 0.52, annual_rate: 1.0 },
      };

      const badges = getStockCardBadges(stock, nowRef);
      expect(badges.earningsBadge).toEqual({
        type: 'caution',
        daysUntil: 2,
        mmdd: '10/24',
        date: '2026-10-24',
        text: '⚠️ EPS in 2d (10/24)',
      });
      expect(badges.dividendBadge).toEqual({
        yieldPct: 0.52,
        text: 'Div 0.52%',
      });

      const html = renderToString(
        <StockCard
          stock={stock}
          data={{ stocks: [stock], pricesBySymbol: {} }}
          state={{}}
          refDate={nowRef}
        />
      );
      expect(html).toContain('pw-stock-card-earnings-badge');
      expect(html).toContain('Div 0.52%');
      // Verify badge appears right after symbol (NFLX) and before company name (Netflix, Inc.)
      const symbolIdx = html.indexOf('NFLX');
      const badgeIdx = html.indexOf('pw-stock-card-earnings-badge');
      const nameIdx = html.indexOf('Netflix, Inc.');
      expect(badgeIdx).toBeGreaterThan(symbolIdx);
      expect(nameIdx).toBeGreaterThan(badgeIdx);
    });

    it('renders muted earnings badge when next_earnings_date is > 7 days out and hides dividend badge when yield_pct is 0', () => {
      const stock = {
        symbol: 'TSLA',
        name: 'Tesla Inc.',
        lastPrice: 250.0,
        previousClose: 245.0,
        calendar: { next_earnings_date: '2026-11-15' },
        dividend_snapshot: { yield_pct: 0, annual_rate: 0 },
      };

      const badges = getStockCardBadges(stock, nowRef);
      expect(badges.earningsBadge).toEqual({
        type: 'muted',
        daysUntil: 24,
        mmdd: '11/15',
        date: '2026-11-15',
        text: '📅 EPS: 11/15',
      });
      expect(badges.dividendBadge).toBeNull();

      const html = renderToString(
        <StockCard
          stock={stock}
          data={{ stocks: [stock], pricesBySymbol: {} }}
          state={{}}
          refDate={nowRef}
        />
      );
      expect(html).toContain('📅 EPS: 11/15');
      expect(html).not.toContain('pw-stock-card-dividend-badge');
    });
  });

  describe('FowaStockChart Event Markers ([E] & [D])', () => {
    const samplePrices = [
      { date: '2026-07-30', open: 218, high: 221, low: 217, close: 220 },
      { date: '2026-07-31', open: 220, high: 223, low: 219, close: 222 },
      { date: '2026-08-03', open: 222, high: 226, low: 221, close: 225 },
      { date: '2026-08-10', open: 225, high: 228, low: 224, close: 227 },
      { date: '2026-10-16', open: 230, high: 233, low: 229, close: 232 },
    ];

    it('maps earnings_history to belowBar circle [E] markers and dividend_history to aboveBar square [D] markers without introducing non-candle dates', () => {
      const earningsHistory = [
        // 2026-08-01 is Saturday -> snaps cleanly to 2026-08-03 trading bar so candle alignment never shifts
        { date: '2026-08-01', eps_reported: 1.40, eps_estimate: 1.35, surprise_pct: 3.7 },
        { date: '2026-07-30', eps_reported: 1.20, eps_estimate: 1.25, surprise_pct: -4.0 },
        { date: '2026-10-16', eps_reported: null, eps_estimate: 1.62, surprise_pct: null },
        // Out-of-range historical date before chart start -> excluded so candle range is untouched
        { date: '2024-01-15', eps_reported: 1.10, eps_estimate: 1.05, surprise_pct: 4.8 },
      ];
      const dividendHistory = [
        { date: '2026-08-10', amount: 0.25 },
      ];

      const markers = buildFundamentalMarkers(earningsHistory, dividendHistory, samplePrices);
      const validCandleDates = new Set(samplePrices.map((p) => p.date));

      expect(markers.length).toBe(4);
      markers.forEach((m) => {
        expect(validCandleDates.has(m.time)).toBe(true);
      });

      const missMarker = markers.find((m) => m.time === '2026-07-30');
      expect(missMarker).toMatchObject({
        position: 'belowBar',
        shape: 'circle',
        text: 'E',
        color: '#EF4444',
        tooltip: 'EPS: $1.20 (Est: $1.25, -4.0% Miss)',
      });

      const beatMarker = markers.find((m) => m.time === '2026-08-03');
      expect(beatMarker).toMatchObject({
        position: 'belowBar',
        shape: 'circle',
        text: 'E',
        color: '#10B981',
        tooltip: 'EPS: $1.40 (Est: $1.35, +3.7% Beat)',
      });

      const divMarker = markers.find((m) => m.time === '2026-08-10');
      expect(divMarker).toMatchObject({
        position: 'aboveBar',
        shape: 'square',
        text: 'D',
        color: '#0EA5E9',
        tooltip: 'Dividend Ex-Date: $0.25 / sh',
      });

      const pendingMarker = markers.find((m) => m.time === '2026-10-16');
      expect(pendingMarker).toMatchObject({
        position: 'belowBar',
        shape: 'circle',
        text: 'E',
        color: '#64748B',
      });
    });

    it('renders upcoming [E] catalyst badge on chart when next_earnings_date is a few days away', () => {
      const fundamentals = {
        symbol: 'NFLX',
        calendar: {
          next_earnings_date: '2026-10-20',
          earnings_avg_est: 5.12,
        },
        earnings_history: [],
        dividend_history: [],
      };
      const refDate = new Date('2026-10-18T12:00:00Z');
      const upcoming = buildUpcomingChartCatalysts(fundamentals, [], [], samplePrices, refDate);
      expect(upcoming.length).toBe(1);
      expect(upcoming[0]).toMatchObject({
        eventType: 'earnings',
        text: 'E',
        date: '2026-10-20',
        mmdd: '10/20',
        daysUntil: 2,
      });

      const html = renderToString(
        <FowaStockChart
          symbol="NFLX"
          chartMode="3y"
          prices={samplePrices}
          fundamentals={fundamentals}
          refDate={refDate}
        />
      );
      expect(html).toContain('data-testid="chart-upcoming-earnings"');
      expect(html).toContain('10/20');
      expect(html).toContain('Upcoming Earnings: 10/20 (in 2d) · Est EPS: $5.12');
    });

    it('renders [E] marker and Today catalyst when next_earnings_date equals maxCandleDate and has not reported yet', () => {
      const fundamentals = {
        symbol: 'ISRG',
        calendar: {
          next_earnings_date: '2026-10-16',
          earnings_avg_est: 2.64,
        },
        earnings_history: [],
        dividend_history: [],
      };
      const refDate = new Date('2026-10-16T19:00:00Z');
      const markers = buildFundamentalMarkers([], [], samplePrices, fundamentals);
      expect(markers).toHaveLength(1);
      expect(markers[0]).toMatchObject({
        time: '2026-10-16',
        position: 'belowBar',
        shape: 'circle',
        text: 'E',
        color: '#64748B',
        tooltip: 'EPS: Pending (Est: $2.64)',
      });

      const upcoming = buildUpcomingChartCatalysts(fundamentals, [], [], samplePrices, refDate);
      expect(upcoming).toHaveLength(1);
      expect(upcoming[0]).toMatchObject({
        eventType: 'earnings',
        date: '2026-10-16',
        daysUntil: 0,
        daysFromLastBar: 0,
        tradingBarsAhead: 0,
        tooltip: 'Upcoming Earnings: 10/16 (Today) · Est EPS: $2.64',
      });
    });
  });

  describe('Layer 3: FundamentalsCatalystDrawer', () => {
    const dividendStockFundamentals = {
      symbol: 'AAPL',
      calendar: {
        next_earnings_date: '2026-10-29',
        earnings_avg_est: 1.62,
        ex_dividend_date: '2026-11-08',
      },
      dividend_snapshot: {
        annual_rate: 1.0,
        yield_pct: 0.52,
        payout_ratio_pct: 15.2,
        five_year_avg_yield: 0.58,
      },
      earnings_history: [
        { date: '2026-05-02', eps_reported: 1.25, eps_estimate: 1.28, surprise_pct: -2.1 },
        { date: '2026-08-01', eps_reported: 1.40, eps_estimate: 1.35, surprise_pct: 3.7 },
      ],
      dividend_history: [
        { date: '2026-08-10', amount: 0.25 },
      ],
    };

    it('renders Upcoming Event Horizon, Dividend Snapshot (when annual_rate > 0), and chronological descending Earnings Surprise Log', () => {
      const html = renderToString(
        <FundamentalsCatalystDrawer
          symbol="AAPL"
          fundamentals={dividendStockFundamentals}
        />
      );

      expect(html).toContain('bg-white border border-slate-200 rounded-xl p-5');
      expect(html).toContain('Next Earnings Release');
      expect(html).toContain('2026-10-29');
      expect(html).toContain('$1.62');
      expect(html).toContain('Next Ex-Dividend Date');
      expect(html).toContain('2026-11-08');
      expect(html).toContain('$1.00 / sh');

      // Section 2: Dividend Snapshot visible for dividend payer
      expect(html).toContain('Dividend Snapshot');
      expect(html).toContain('0.52%');
      expect(html).toContain('15.2%');
      expect(html).toContain('0.58%');

      // Section 3: Historical Earnings Surprise Log sorted descending with BEAT/MISS pills
      expect(html).toContain('+3.70% BEAT');
      expect(html).toContain('-2.10% MISS');
      const idxAug = html.indexOf('2026-08-01');
      const idxMay = html.indexOf('2026-05-02');
      expect(idxAug).toBeGreaterThan(-1);
      expect(idxMay).toBeGreaterThan(idxAug);
    });

    it('hides Dividend Snapshot strip when annual_rate is 0 (non-dividend stock)', () => {
      const nonDividendFundamentals = {
        symbol: 'TSLA',
        calendar: {
          next_earnings_date: '2026-10-21',
          earnings_avg_est: 0.65,
          ex_dividend_date: null,
        },
        dividend_snapshot: {
          annual_rate: 0,
          yield_pct: 0,
          payout_ratio_pct: 0,
          five_year_avg_yield: null,
        },
        earnings_history: [],
        dividend_history: [],
      };

      const html = renderToString(
        <FundamentalsCatalystDrawer
          symbol="TSLA"
          fundamentals={nonDividendFundamentals}
        />
      );

      expect(html).toContain('Next Earnings Release');
      expect(html).toContain('Non-Dividend Payer');
      expect(html).not.toContain('data-testid="dividend-snapshot-strip"');
    });
  });
});

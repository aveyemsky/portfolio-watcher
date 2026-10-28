import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import RsiChart from '../portfolioWatcher/ui/stock/RsiChart';
import MacdChart from '../portfolioWatcher/ui/stock/MacdChart';
import StochChart from '../portfolioWatcher/ui/stock/StochChart';
import ObvChart from '../portfolioWatcher/ui/stock/ObvChart';
import AtrChart from '../portfolioWatcher/ui/stock/AtrChart';
import StockIndicators from '../portfolioWatcher/ui/stock/StockIndicators';
import { INDICATORS_CONFIG } from '../portfolioWatcher/ui/stock/indicatorColors';

describe('Indicator loading vs insufficient data messages', () => {
  describe('RsiChart', () => {
    it('shows "Loading RSI-14..." when isLoading is true and series is empty', () => {
      const html = renderToString(
        <RsiChart prices={[]} series={[]} isLoading={true} />
      );
      expect(html).toContain('Loading RSI-14...');
      expect(html).not.toContain('Not enough historical data for RSI-14.');
    });

    it('shows "Not enough historical data for RSI-14." when isLoading is false and series is empty', () => {
      const html = renderToString(
        <RsiChart prices={[]} series={[]} isLoading={false} />
      );
      expect(html).not.toContain('Loading RSI-14...');
      expect(html).toContain('Not enough historical data for RSI-14.');
    });
  });

  describe('MacdChart', () => {
    it('shows "Loading MACD (12, 26, 9)..." when isLoading is true and series is empty', () => {
      const html = renderToString(
        <MacdChart prices={[]} series={{}} isLoading={true} />
      );
      expect(html).toContain('Loading MACD (12, 26, 9)...');
      expect(html).not.toContain('Not enough historical data for MACD (12, 26, 9).');
    });

    it('shows "Not enough historical data for MACD (12, 26, 9)." when isLoading is false and series is empty', () => {
      const html = renderToString(
        <MacdChart prices={[]} series={{}} isLoading={false} />
      );
      expect(html).not.toContain('Loading MACD (12, 26, 9)...');
      expect(html).toContain('Not enough historical data for MACD (12, 26, 9).');
    });
  });

  describe('StochChart', () => {
    it('shows "Loading Stochastic (14, 3, 3)..." when isLoading is true and series is empty', () => {
      const html = renderToString(
        <StochChart prices={[]} series={{}} isLoading={true} />
      );
      expect(html).toContain('Loading Stochastic (14, 3, 3)...');
      expect(html).not.toContain('Not enough historical data for Stochastic (14, 3, 3).');
    });

    it('shows "Not enough historical data for Stochastic (14, 3, 3)." when isLoading is false and series is empty', () => {
      const html = renderToString(
        <StochChart prices={[]} series={{}} isLoading={false} />
      );
      expect(html).not.toContain('Loading Stochastic (14, 3, 3)...');
      expect(html).toContain('Not enough historical data for Stochastic (14, 3, 3).');
    });
  });

  describe('ObvChart', () => {
    it('shows "Loading On-Balance Volume (OBV)..." when isLoading is true and series is empty', () => {
      const html = renderToString(
        <ObvChart prices={[]} series={{}} isLoading={true} />
      );
      expect(html).toContain('Loading On-Balance Volume (OBV)...');
      expect(html).not.toContain('Not enough historical data for OBV.');
    });

    it('shows "Not enough historical data for OBV." when isLoading is false and series is empty', () => {
      const html = renderToString(
        <ObvChart prices={[]} series={{}} isLoading={false} />
      );
      expect(html).not.toContain('Loading On-Balance Volume (OBV)...');
      expect(html).toContain('Not enough historical data for OBV.');
    });
  });

  describe('AtrChart', () => {
    it('shows "Loading ATR-14..." when isLoading is true and series is empty', () => {
      const html = renderToString(
        <AtrChart prices={[]} series={[]} isLoading={true} />
      );
      expect(html).toContain('Loading ATR-14...');
      expect(html).not.toContain('Not enough historical data for ATR-14.');
    });

    it('shows "Not enough historical data for ATR-14." when isLoading is false and series is empty', () => {
      const html = renderToString(
        <AtrChart prices={[]} series={[]} isLoading={false} />
      );
      expect(html).not.toContain('Loading ATR-14...');
      expect(html).toContain('Not enough historical data for ATR-14.');
    });
  });

  describe('INDICATORS_CONFIG Suite', () => {
    it('contains all 9 classic indicators configured for interactive charting', () => {
      const ids = INDICATORS_CONFIG.map((ind) => ind.id);
      expect(ids).toEqual([
        'ema20',
        'ma50',
        'ma200',
        'bb20',
        'atr14',
        'rsi14',
        'stoch14',
        'macd',
        'obv',
      ]);
    });
  });

  describe('StockIndicators', () => {
    it('shows "Loading technical indicators for <SYMBOL>..." while initial load is in flight', () => {
      const mockData = {
        stocks: [{ symbol: 'SPCX', name: 'SPCX ETF' }],
        accounts: [],
        pricesBySymbol: {},
      };
      const mockState = {
        selectedType: 'stock',
        selectedStockSymbol: 'SPCX',
      };

      const html = renderToString(
        <StockIndicators apiBaseUrl="/api/portfolio" data={mockData} state={mockState} />
      );

      expect(html).toContain('Loading technical indicators for');
      expect(html).toContain('SPCX');
      expect(html).not.toContain('Not enough historical price data to calculate indicators.');
    });

    it('exposes comprehensive explanations in INDICATOR_INFO for all 6 classic indicators', async () => {
      const { INDICATOR_INFO, getIndicatorInfo } = await import('../portfolioWatcher/ui/stock/StockIndicators');
      expect(INDICATOR_INFO).toBeDefined();
      expect(INDICATOR_INFO.ema20.description).toContain('20-day EMA');
      expect(INDICATOR_INFO.ma50.description).toContain('MA-50');
      expect(INDICATOR_INFO.ma200.description).toContain('MA-200');
      expect(INDICATOR_INFO.bb20.description).toContain('Bollinger Bands');
      expect(INDICATOR_INFO.rsi14.description).toContain('RSI-14');
      expect(INDICATOR_INFO.macd.description).toContain('MACD');

      // Test helper
      const emaInfo = getIndicatorInfo({ id: 'ema20', label: 'EMA-20' });
      expect(emaInfo.fullName).toContain('Exponential Moving Average');
      expect(emaInfo.description).toBe(INDICATOR_INFO.ema20.description);

      const rsiInfo = getIndicatorInfo({ id: 'rsi14', label: 'RSI-14' });
      expect(rsiInfo.fullName).toContain('Relative Strength Index');
      expect(rsiInfo.description).toBe(INDICATOR_INFO.rsi14.description);
    });
  });
});

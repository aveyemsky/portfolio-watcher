import { describe, it, expect } from 'vitest';
import { isLineOnlySymbol, toAreaSeriesData, toCandlestickData } from '../portfolioWatcher/ui/stock/FowaStockChart';

describe('SKEW Line / Area Series Representation Guardrails', () => {
  describe('isLineOnlySymbol', () => {
    it('returns true for ^SKEW and SKEW', () => {
      expect(isLineOnlySymbol('^SKEW')).toBe(true);
      expect(isLineOnlySymbol('SKEW')).toBe(true);
      expect(isLineOnlySymbol('^skew')).toBe(true);
      expect(isLineOnlySymbol(' skew ')).toBe(true);
    });

    it('returns false for regular stocks and other indices', () => {
      expect(isLineOnlySymbol('NVDA')).toBe(false);
      expect(isLineOnlySymbol('AAPL')).toBe(false);
      expect(isLineOnlySymbol('SPY')).toBe(false);
      expect(isLineOnlySymbol('^GSPC')).toBe(false);
      expect(isLineOnlySymbol('^IXIC')).toBe(false);
      expect(isLineOnlySymbol('^VIX')).toBe(false);
      expect(isLineOnlySymbol('')).toBe(false);
      expect(isLineOnlySymbol(null)).toBe(false);
      expect(isLineOnlySymbol(undefined)).toBe(false);
    });
  });

  describe('toAreaSeriesData', () => {
    it('transforms prices into continuous area/line series points with close values', () => {
      const mockSkewPrices = [
        {
          date: '2026-10-09',
          open: 153.25,
          high: 153.25,
          low: 153.25,
          close: 153.25,
          volume: 0
        },
        {
          date: '2026-10-10',
          open: 154.10,
          high: 154.10,
          low: 154.10,
          close: 154.10,
          volume: 0
        },
        {
          date: '2026-10-13',
          open: 151.80,
          high: 151.80,
          low: 151.80,
          close: 151.80,
          volume: 0
        }
      ];

      const areaData = toAreaSeriesData(mockSkewPrices);
      expect(areaData).toHaveLength(3);
      expect(areaData[0]).toEqual({ time: '2026-10-09', value: 153.25 });
      expect(areaData[1]).toEqual({ time: '2026-10-10', value: 154.10 });
      expect(areaData[2]).toEqual({ time: '2026-10-13', value: 151.80 });
    });

    it('handles intraday timestamp prices and sorts chronologically', () => {
      const intradayPrices = [
        {
          timestamp: '2026-10-14T15:00:00Z',
          open: 152.0,
          close: 152.0
        },
        {
          timestamp: '2026-10-14T14:00:00Z',
          open: 151.5,
          close: 151.5
        }
      ];

      const areaData = toAreaSeriesData(intradayPrices);
      expect(areaData).toHaveLength(2);
      // Chronological order: 14:00 first, then 15:00
      expect(areaData[0].value).toBe(151.5);
      expect(areaData[1].value).toBe(152.0);
      expect(areaData[0].time).toBeLessThan(areaData[1].time);
    });

    it('handles empty or missing prices gracefully', () => {
      expect(toAreaSeriesData([])).toEqual([]);
      expect(toAreaSeriesData(null)).toEqual([]);
      expect(toAreaSeriesData(undefined)).toEqual([]);
    });
  });

  describe('toCandlestickData preserves regular candle structure', () => {
    it('returns full open/high/low/close tuples for regular stock series', () => {
      const mockStockPrices = [
        {
          date: '2026-10-13',
          open: 130.0,
          high: 135.5,
          low: 129.2,
          close: 134.8,
          volume: 45000000
        }
      ];

      const candleData = toCandlestickData(mockStockPrices);
      expect(candleData).toHaveLength(1);
      expect(candleData[0]).toEqual({
        time: '2026-10-13',
        open: 130.0,
        high: 135.5,
        low: 129.2,
        close: 134.8
      });
    });
  });
});

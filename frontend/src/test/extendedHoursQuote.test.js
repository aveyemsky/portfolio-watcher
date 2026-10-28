import { describe, it, expect, vi, afterEach } from 'vitest';
import { getExtendedHoursQuote, getMarketSession } from '../portfolioWatcher/ui/viewModel';

function makeETDate(isoDateString, hourET, minuteET = 0) {
  return new Date(`${isoDateString}T${String(hourET).padStart(2, '0')}:${String(minuteET).padStart(2, '0')}:00-04:00`);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('getMarketSession', () => {
  it('identifies pre-market hours on weekdays (4:00 AM – 9:30 AM ET)', () => {
    // 2024-06-03 is Monday
    expect(getMarketSession(makeETDate('2024-06-03', 4, 0))).toBe('pre');
    expect(getMarketSession(makeETDate('2024-06-03', 8, 30))).toBe('pre');
    expect(getMarketSession(makeETDate('2024-06-03', 9, 29))).toBe('pre');
  });

  it('identifies regular market hours on weekdays (9:30 AM – 4:00 PM ET)', () => {
    expect(getMarketSession(makeETDate('2024-06-03', 9, 30))).toBe('regular');
    expect(getMarketSession(makeETDate('2024-06-03', 14, 0))).toBe('regular');
    expect(getMarketSession(makeETDate('2024-06-03', 16, 0))).toBe('regular');
  });

  it('identifies post-market hours on weekdays (4:00 PM – 8:00 PM ET)', () => {
    expect(getMarketSession(makeETDate('2024-06-03', 16, 1))).toBe('post');
    expect(getMarketSession(makeETDate('2024-06-03', 19, 59))).toBe('post');
  });

  it('identifies closed session overnight and on weekends', () => {
    expect(getMarketSession(makeETDate('2024-06-03', 21, 0))).toBe('closed');
    expect(getMarketSession(makeETDate('2024-06-03', 2, 0))).toBe('closed');
    expect(getMarketSession(makeETDate('2024-06-01', 11, 0))).toBe('closed'); // Saturday
  });
});

describe('getExtendedHoursQuote', () => {
  const stock = {
    symbol: 'AAPL',
    lastPrice: 341.07,
    previousClose: 335.92,
    postMarketPrice: 341.46,
    postMarketChange: 0.39,
    postMarketChangePercent: 0.11,
    preMarketPrice: 340.85,
    preMarketChange: -0.22,
    preMarketChangePercent: -0.06
  };

  it('shows pre-market quote during pre-market session, ignoring stale post-market', () => {
    const mondayPre = makeETDate('2024-06-03', 8, 0);
    const quote = getExtendedHoursQuote(stock, mondayPre);
    expect(quote).not.toBeNull();
    expect(quote.type).toBe('pre');
    expect(quote.label).toBe('Pre');
    expect(quote.price).toBe(340.85);
    expect(quote.diff).toBe(-0.22);
    expect(quote.tone).toBe('down');
  });

  it('computes pre-market delta relative to last regular close (lastPrice), not previousClose', () => {
    const stockWithoutDiff = {
      symbol: 'AAPL',
      lastPrice: 341.07,
      previousClose: 335.92,
      preMarketPrice: 340.85
    };
    const mondayPre = makeETDate('2024-06-03', 8, 0);
    const quote = getExtendedHoursQuote(stockWithoutDiff, mondayPre);
    expect(quote).not.toBeNull();
    expect(quote.diff).toBeCloseTo(340.85 - 341.07, 2);
  });

  it('returns null during regular market hours', () => {
    const mondayRegular = makeETDate('2024-06-03', 11, 0);
    expect(getExtendedHoursQuote(stock, mondayRegular)).toBeNull();
  });

  it('shows AH post-market quote during post-market session', () => {
    const mondayPost = makeETDate('2024-06-03', 17, 30);
    const quote = getExtendedHoursQuote(stock, mondayPost);
    expect(quote).not.toBeNull();
    expect(quote.type).toBe('post');
    expect(quote.label).toBe('AH');
    expect(quote.price).toBe(341.46);
    expect(quote.diff).toBe(0.39);
    expect(quote.tone).toBe('up');
  });
});

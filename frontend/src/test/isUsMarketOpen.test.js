/**
 * Tests for isUsMarketOpen()
 *
 * Guardrail: This function controls the 60-second auto-refresh interval for
 * all stock quotes in the master DB. It MUST block refreshes on weekends and
 * outside 9:30 AM – 4:00 PM ET. Any change to this logic requires updating
 * these tests first.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isUsMarketOpen, isUsTradingSessionActive } from '../portfolioWatcher/PortfolioWatcherApp';

// Helper: build a fake Date for a given ET clock time on a specific weekday.
// weekday: 0=Sun, 1=Mon, ..., 6=Sat
// hour/minute: in Eastern Time (America/New_York)
function makeETDate(isoDateString, hourET, minuteET = 0) {
  // Parse as UTC then shift. We use a fixed offset approach: EST = UTC-5, EDT = UTC-4.
  // For test determinism we always test against known DST-stable dates.
  const d = new Date(`${isoDateString}T${String(hourET).padStart(2,'0')}:${String(minuteET).padStart(2,'0')}:00-04:00`);
  return d;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('isUsMarketOpen', () => {
  // ── Weekend guard ──────────────────────────────────────────────────────────

  it('returns false on Saturday (market hours)', () => {
    // 2024-06-01 is a Saturday
    vi.setSystemTime(makeETDate('2024-06-01', 11, 0));
    expect(isUsMarketOpen()).toBe(false);
  });

  it('returns false on Sunday (market hours)', () => {
    // 2024-06-02 is a Sunday
    vi.setSystemTime(makeETDate('2024-06-02', 11, 0));
    expect(isUsMarketOpen()).toBe(false);
  });

  // ── Weekday / market hours ────────────────────────────────────────────────

  it('returns true on Monday during core market hours (11:00 AM ET)', () => {
    // 2024-06-03 is a Monday
    vi.setSystemTime(makeETDate('2024-06-03', 11, 0));
    expect(isUsMarketOpen()).toBe(true);
  });

  it('returns true exactly at market open (9:30 AM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-03', 9, 30));
    expect(isUsMarketOpen()).toBe(true);
  });

  it('returns true exactly at market close (4:00 PM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-03', 16, 0));
    expect(isUsMarketOpen()).toBe(true);
  });

  it('returns false before market open (9:29 AM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-03', 9, 29));
    expect(isUsMarketOpen()).toBe(false);
  });

  it('returns false after market close (4:01 PM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-03', 16, 1));
    expect(isUsMarketOpen()).toBe(false);
  });

  it('returns false in after-hours evening (7:00 PM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-03', 19, 0));
    expect(isUsMarketOpen()).toBe(false);
  });

  it('returns false early morning before open (6:00 AM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-03', 6, 0));
    expect(isUsMarketOpen()).toBe(false);
  });

  it('returns true on Friday during market hours', () => {
    // 2024-06-07 is a Friday
    vi.setSystemTime(makeETDate('2024-06-07', 14, 0));
    expect(isUsMarketOpen()).toBe(true);
  });

  it('returns false on Friday after close (5:00 PM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-07', 17, 0));
    expect(isUsMarketOpen()).toBe(false);
  });
});

describe('isUsTradingSessionActive', () => {
  it('returns true during pre-market (6:00 AM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-03', 6, 0));
    expect(isUsTradingSessionActive()).toBe(true);
  });

  it('returns true during regular market (11:00 AM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-03', 11, 0));
    expect(isUsTradingSessionActive()).toBe(true);
  });

  it('returns true during post-market (5:00 PM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-03', 17, 0));
    expect(isUsTradingSessionActive()).toBe(true);
  });

  it('returns false on Saturday (11:00 AM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-01', 11, 0));
    expect(isUsTradingSessionActive()).toBe(false);
  });

  it('returns false overnight (9:00 PM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-03', 21, 0));
    expect(isUsTradingSessionActive()).toBe(false);
  });

  it('returns false overnight (2:00 AM ET)', () => {
    vi.setSystemTime(makeETDate('2024-06-03', 2, 0));
    expect(isUsTradingSessionActive()).toBe(false);
  });
});

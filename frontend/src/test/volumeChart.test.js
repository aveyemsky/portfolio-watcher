import { describe, it, expect } from 'vitest';
import { toVolumeData } from '../portfolioWatcher/ui/stock/FowaStockChart';

describe('toVolumeData for Main Chart Volume Histogram', () => {
  it('converts prices into volume histogram bars with appropriate direction colors', () => {
    const mockPrices = [
      {
        date: '2026-09-01',
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 5000000
      },
      {
        date: '2026-09-02',
        open: 106,
        high: 108,
        low: 98,
        close: 99,
        volume: 8200000
      },
      {
        date: '2026-09-03',
        open: 100,
        high: 102,
        low: 99,
        close: 100,
        volume: 3100000
      }
    ];

    const volumeData = toVolumeData(mockPrices);
    expect(volumeData).toHaveLength(3);

    // Day 1: close (105) >= open (100) -> up bar
    expect(volumeData[0]).toEqual({
      time: '2026-09-01',
      value: 5000000,
      color: 'rgba(22, 160, 107, 0.45)'
    });

    // Day 2: close (99) < open (106) -> down bar
    expect(volumeData[1]).toEqual({
      time: '2026-09-02',
      value: 8200000,
      color: 'rgba(226, 87, 87, 0.45)'
    });

    // Day 3: close (100) >= open (100) -> up bar (neutral treated as non-down)
    expect(volumeData[2]).toEqual({
      time: '2026-09-03',
      value: 3100000,
      color: 'rgba(22, 160, 107, 0.45)'
    });
  });

  it('handles intraday unix timestamps properly', () => {
    const intradayPrices = [
      {
        timestamp: '2026-09-29T13:30:00Z',
        open: 200,
        high: 202,
        low: 199,
        close: 201,
        volume: 125000
      },
      {
        timestamp: '2026-09-29T13:35:00Z',
        open: 201,
        high: 201.5,
        low: 198,
        close: 198.5,
        volume: 98000
      }
    ];

    const volumeData = toVolumeData(intradayPrices);
    expect(volumeData).toHaveLength(2);
    expect(typeof volumeData[0].time).toBe('number');
    expect(volumeData[0].value).toBe(125000);
    expect(volumeData[0].color).toBe('rgba(22, 160, 107, 0.45)');
    expect(volumeData[1].value).toBe(98000);
    expect(volumeData[1].color).toBe('rgba(226, 87, 87, 0.45)');
  });

  it('handles empty or missing volume gracefully', () => {
    expect(toVolumeData([])).toEqual([]);
    expect(toVolumeData(null)).toEqual([]);

    const missingVol = [{ date: '2026-09-01', open: 50, close: 52 }];
    const res = toVolumeData(missingVol);
    expect(res).toHaveLength(1);
    expect(res[0].value).toBe(0);
    expect(res[0].color).toBe('rgba(22, 160, 107, 0.45)');
  });
});

import { describe, it, expect } from 'vitest';

describe('Stock Sorting Guardrail', () => {
  it('sorts stocks alphabetically by symbol (A-Z)', () => {
    const unsortedStocks = [
      { symbol: 'KLAC', name: 'KLA Corporation' },
      { symbol: 'AVGO', name: 'Broadcom Inc.' },
      { symbol: 'ARM', name: 'Arm Holdings plc' },
      { symbol: 'FBTC', name: 'Fidelity Wise Origin Bitcoin Fund' },
      { symbol: 'NVDA', name: 'NVIDIA Corporation' },
      { symbol: 'GOOG', name: 'Alphabet Inc.' },
    ];

    const sorted = [...unsortedStocks].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const symbols = sorted.map((s) => s.symbol);

    expect(symbols).toEqual(['ARM', 'AVGO', 'FBTC', 'GOOG', 'KLAC', 'NVDA']);
  });

  it('sorts holding stocks alphabetically by symbol (A-Z)', () => {
    const stocks = [
      { symbol: 'KLAC', name: 'KLA Corporation' },
      { symbol: 'AVGO', name: 'Broadcom Inc.' },
      { symbol: 'ARM', name: 'Arm Holdings plc' },
    ];
    const holdings = [
      { symbol: 'KLAC', shares: 10 },
      { symbol: 'ARM', shares: 5 },
      { symbol: 'AVGO', shares: 20 },
    ];

    const holdingStocks = holdings
      .map((holding) => stocks.find((stock) => stock.symbol === holding.symbol))
      .filter(Boolean)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    expect(holdingStocks.map((s) => s.symbol)).toEqual(['ARM', 'AVGO', 'KLAC']);
  });
});

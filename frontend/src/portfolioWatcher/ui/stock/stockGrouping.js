import { stockChange } from "../viewModel";

export const UNCLASSIFIED_SECTOR_LABEL = "Other / Uncategorized";

export function normalizeSector(sector) {
  if (!sector || typeof sector !== "string") return UNCLASSIFIED_SECTOR_LABEL;
  const trimmed = sector.trim();
  if (
    !trimmed ||
    trimmed.toLowerCase() === "unknown" ||
    trimmed.toLowerCase() === "n/a" ||
    trimmed.toLowerCase() === "none"
  ) {
    return UNCLASSIFIED_SECTOR_LABEL;
  }
  return trimmed;
}

export function groupStocksBySector(stocks = [], data = null) {
  const groupsMap = new Map();

  for (const stock of stocks) {
    if (stock.isSectionHeader) continue;
    const sectorName = normalizeSector(stock.sector);
    if (!groupsMap.has(sectorName)) {
      groupsMap.set(sectorName, []);
    }
    groupsMap.get(sectorName).push(stock);
  }

  // Sort sectors alphabetically, with UNCLASSIFIED_SECTOR_LABEL always at the end
  const sortedSectorNames = Array.from(groupsMap.keys()).sort((a, b) => {
    if (a === UNCLASSIFIED_SECTOR_LABEL) return 1;
    if (b === UNCLASSIFIED_SECTOR_LABEL) return -1;
    return a.localeCompare(b);
  });

  return sortedSectorNames.map((sector) => {
    const sectorStocks = groupsMap.get(sector).slice().sort((a, b) => a.symbol.localeCompare(b.symbol));
    const count = sectorStocks.length;

    let avgChange = 0;
    if (count > 0 && data) {
      const sum = sectorStocks.reduce((acc, s) => acc + stockChange(data, s.symbol), 0);
      avgChange = sum / count;
    }

    return {
      sector,
      stocks: sectorStocks,
      count,
      avgChange
    };
  });
}

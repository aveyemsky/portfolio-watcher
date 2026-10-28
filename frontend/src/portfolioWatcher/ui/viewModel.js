export function fmtMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

export function fmtMoney0(value) {
  return Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

export function getUsMarketSession() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);

  if (["Sat", "Sun"].includes(weekday)) {
    return { status: "closed", label: "Market Closed", tone: "closed" };
  }

  const currentMinutes = hour * 60 + minute;
  const preOpen = 4 * 60;          // 4:00 AM ET
  const regularOpen = 9 * 60 + 30; // 9:30 AM ET
  const regularClose = 16 * 60;    // 4:00 PM ET
  const postClose = 20 * 60;       // 8:00 PM ET

  if (currentMinutes >= regularOpen && currentMinutes < regularClose) {
    return { status: "open", label: "Market Open", tone: "open" };
  }
  if (currentMinutes >= regularClose && currentMinutes < postClose) {
    return { status: "post", label: "Post-Market", tone: "post" };
  }
  if (currentMinutes >= preOpen && currentMinutes < regularOpen) {
    return { status: "pre", label: "Pre-Market", tone: "pre" };
  }
  return { status: "closed", label: "Market Closed", tone: "closed" };
}

export function fmtPct(value) {
  const number = Number(value || 0);
  if (Math.abs(number) < 0.005) return "0.00%";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

export function fmtSignedMoney(value) {
  const number = Number(value || 0);
  const formatted = Math.abs(number).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  if (number >= 0.005) return `+${formatted}`;
  if (number <= -0.005) return `-${formatted}`;
  return formatted;
}

export function fmtTodayChange(priceDiff, pctChange) {
  return `${fmtSignedMoney(priceDiff)} (${fmtPct(pctChange)})`;
}

export function fmtIndexValue(value, isVix = false) {
  const num = Number(value || 0);
  const parts = String(value || "").split(".");
  const maxDecimals = parts[1] && parts[1].length > 2 ? Math.min(parts[1].length, 3) : 2;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals
  });
}

export function fmtIndexTime(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  if (isNaN(d.getTime())) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    }).format(new Date());
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(d);
}

export function fmtIndexChange(priceDiff, pctChange, isVix = false) {
  const numDiff = Number(priceDiff || 0);
  const diffStr = isVix
    ? `${numDiff >= 0 ? "+" : ""}${numDiff.toFixed(2)}`
    : fmtSignedMoney(priceDiff);
  return `${diffStr} (${fmtPct(pctChange)})`;
}

export function getVixRegime(vixValue) {
  const val = Number(vixValue || 0);
  if (val < 15) {
    return { key: "calm", label: "Calm", color: "#10b981" };
  } else if (val < 20) {
    return { key: "normal", label: "Normal", color: "#22c55e" };
  } else if (val < 30) {
    return { key: "elevated", label: "Elevated", color: "#f59e0b" };
  } else {
    return { key: "fear", label: "Fear", color: "#ef4444" };
  }
}

export function getSkewRegime(skewValue) {
  const val = Number(skewValue || 0);
  if (val < 115) {
    return { key: "calm", label: "Low Risk", color: "#10b981" };
  } else if (val < 135) {
    return { key: "normal", label: "Normal", color: "#22c55e" };
  } else if (val < 145) {
    return { key: "elevated", label: "Elevated", color: "#f59e0b" };
  } else {
    return { key: "fear", label: "Tail Risk", color: "#ef4444" };
  }
}

export function fmtObservationDate(dateStr) {
  if (!dateStr) return "";
  try {
    const raw = String(dateStr).slice(0, 10);
    const parts = raw.split("-");
    if (parts.length === 3) {
      const year = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const day = Number(parts[2]);
      const d = new Date(year, month, day);
      return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
    }
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(dateStr));
  } catch {
    return String(dateStr);
  }
}

export function getVixNeedleCoords(vixValue, minVix = 10, maxVix = 40, cx = 32, cy = 32, radius = 20) {
  const val = Number(vixValue || 0);
  const clamped = Math.max(minVix, Math.min(maxVix, val));
  const ratio = (clamped - minVix) / (maxVix - minVix);
  const angle = ratio * Math.PI;
  const x = cx - radius * Math.cos(angle);
  const y = cy - radius * Math.sin(angle);
  return { x, y };
}

export function getActiveAccount(data, state) {
  return data.accounts.find((account) => account.id === state.activeAccountId);
}

export function getSelectedAccount(data, state) {
  return data.accounts.find((account) => account.id === state.selectedAccountId);
}

export function getSelectedStock(data, state) {
  return data.stocks?.find((stock) => stock.symbol === state.selectedStockSymbol) ||
         data.indices?.find((index) => index.symbol === state.selectedStockSymbol);
}

export function latestPrice(data, symbol) {
  const stock = data.stocks?.find((s) => s.symbol === symbol) || data.indices?.find((s) => s.symbol === symbol);
  const prices = data.pricesBySymbol?.[symbol] || [];
  const latestHistorical = prices[prices.length - 1];
  const previousHistorical = prices[prices.length - 2];

  if (!stock && !latestHistorical) return null;

  const close = stock?.lastPrice ?? latestHistorical?.close ?? 0;
  const previousClose = stock?.previousClose ?? previousHistorical?.close ?? null;
  const volume = latestHistorical?.volume ?? 0;
  const date = stock?.quoteDate || latestHistorical?.date || stock?.updatedAt?.slice(0, 10);

  return {
    ...(latestHistorical || {}),
    date,
    close,
    previousClose,
    volume
  };
}

export function getDailyPricesWithLiveCandle(prices, stock) {
  if (!prices || !prices.length) return prices || [];
  if (!stock || stock.lastPrice == null) return prices;

  const isSkew = stock.symbol === "^SKEW" || stock.symbol === "SKEW";
  const lastHistorical = prices[prices.length - 1];
  const lastPrice = Number(stock.lastPrice);
  const quoteDate = stock.quoteDate || (isSkew ? lastHistorical.date : (stock.updatedAt?.slice(0, 10) || lastHistorical.date));

  if (isSkew && lastHistorical.close === lastPrice) {
    return prices;
  }

  const rawOpen = Number(stock.dayOpen);
  const rawPrevClose = Number(stock.previousClose);
  const open = rawOpen > 0 ? rawOpen : (rawPrevClose > 0 ? rawPrevClose : lastPrice);
  const rawHigh = Number(stock.dayHigh);
  const high = Math.max(rawHigh > 0 ? rawHigh : lastPrice, open, lastPrice);
  const rawLow = Number(stock.dayLow);
  const low = Math.min(rawLow > 0 ? rawLow : lastPrice, open, lastPrice);
  const volume = Number(stock.dayVolume ?? stock.volume ?? lastHistorical.volume ?? 0);

  if (lastHistorical.date === quoteDate) {
    const updated = {
      ...lastHistorical,
      open: rawOpen > 0 ? open : lastHistorical.open,
      high: Math.max(lastHistorical.high, high),
      low: Math.min(lastHistorical.low, low),
      close: lastPrice,
      volume: stock.dayVolume != null ? volume : lastHistorical.volume
    };
    return [...prices.slice(0, -1), updated];
  }

  if (lastHistorical.date < quoteDate) {
    const liveCandle = {
      date: quoteDate,
      open,
      high,
      low,
      close: lastPrice,
      volume
    };
    return [...prices, liveCandle];
  }

  return prices;
}

export function getCategoryKey(category, account) {
  const catName = (category?.name || "").toLowerCase();
  const accType = (account?.type || "").toLowerCase();
  if (catName.includes("sector") || catName.includes("basket") || accType.includes("sector") || accType.includes("basket")) {
    return "sectors";
  }
  if (catName.includes("watch") || catName.includes("action") || accType.includes("watch") || accType.includes("action")) {
    return "watchlists";
  }
  return "accounts";
}

export function accountValue(data, accountId) {
  const holdings = data?.holdingsByAccount?.[String(accountId)] || [];
  return holdings.reduce((sum, holding) => {
    if (holding.isSectionHeader) return sum;
    const price = latestPrice(data, holding.symbol)?.close || holding.avgCost || 0;
    const shares = Number(holding.shares || 0);
    return sum + (shares * price);
  }, 0);
}

export function accountDailyPercentChange(data, accountId) {
  const account = (data?.accounts || []).find((a) => a.id === accountId);
  const holdings = (data?.holdingsByAccount?.[String(accountId)] || []).filter((h) => !h.isSectionHeader);
  if (!holdings.length) return 0;

  const category = (data?.categories || []).find((c) => c.id === (account?.categoryId || account?.category_id));
  const isPercent = getCategoryKey(category, account) !== "accounts" || (account?.sizing_mode || account?.sizingMode || "PERCENT") === "PERCENT";

  if (isPercent) {
    let sum = 0;
    const N = holdings.length;
    holdings.forEach((h) => {
      const chg = stockChange(data, h.symbol);
      const w = h.effective_weight_pct ?? h.effectiveWeightPct ?? (100 / N);
      sum += chg * (w / 100);
    });
    return sum;
  } else {
    let currentTotal = Number(account?.cash || 0);
    let prevTotal = Number(account?.cash || 0);
    holdings.forEach((h) => {
      const price = latestPrice(data, h.symbol)?.close || h.avgCost || 0;
      const prevClose = latestPrice(data, h.symbol)?.previousClose || price;
      const sh = Number(h.shares || 0);
      currentTotal += sh * price;
      prevTotal += sh * prevClose;
    });
    return prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0;
  }
}

export function getHolding(data, accountId, symbol) {
  const holdings = data.holdingsByAccount[String(accountId)] || [];
  return holdings.find((holding) => holding.symbol === symbol);
}

export function stockChange(data, symbol) {
  const price = latestPrice(data, symbol);
  if (!price || !price.previousClose) return 0;
  return ((price.close - price.previousClose) / price.previousClose) * 100;
}

export function stockPriceChange(data, symbol) {
  const price = latestPrice(data, symbol);
  if (!price || !price.previousClose) return 0;
  return price.close - price.previousClose;
}

export function getMarketSession(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);

  const isWeekend = ["Sat", "Sun"].includes(weekday);
  const currentMinutes = hour * 60 + minute;
  const preStart = 4 * 60;          // 4:00 AM ET
  const regularStart = 9 * 60 + 30; // 9:30 AM ET
  const regularEnd = 16 * 60;       // 4:00 PM ET
  const postEnd = 20 * 60;          // 8:00 PM ET

  if (!isWeekend && currentMinutes >= preStart && currentMinutes < regularStart) {
    return "pre";
  }
  if (!isWeekend && currentMinutes >= regularStart && currentMinutes <= regularEnd) {
    return "regular";
  }
  if (!isWeekend && currentMinutes > regularEnd && currentMinutes <= postEnd) {
    return "post";
  }
  return "closed";
}

export function isUsTradingSessionActive(date = new Date()) {
  const session = getMarketSession(date);
  return session === "regular" || session === "pre" || session === "post";
}

export function getExtendedHoursQuote(stock, now = new Date()) {
  if (!stock) return null;

  const session = getMarketSession(now);

  const hasPre = stock.preMarketPrice && typeof stock.preMarketPrice === "number";
  const hasPost = stock.postMarketPrice && typeof stock.postMarketPrice === "number";

  function makePreQuote() {
    const price = stock.preMarketPrice;
    const ref = stock.lastPrice || stock.previousClose;
    const diff = stock.preMarketChange ?? (ref ? price - ref : 0);
    const pct = stock.preMarketChangePercent ?? (ref ? ((price - ref) / ref) * 100 : 0);
    return {
      type: "pre",
      label: "Pre",
      fullLabel: "Pre-Market",
      price,
      diff,
      pct,
      tone: pct >= 0 ? "up" : "down"
    };
  }

  function makePostQuote() {
    const price = stock.postMarketPrice;
    const ref = stock.lastPrice || stock.previousClose;
    const diff = stock.postMarketChange ?? (ref ? price - ref : 0);
    const pct = stock.postMarketChangePercent ?? (ref ? ((price - ref) / ref) * 100 : 0);
    return {
      type: "post",
      label: "AH",
      fullLabel: "After-Hours",
      price,
      diff,
      pct,
      tone: pct >= 0 ? "up" : "down"
    };
  }

  if (session === "pre") {
    return hasPre ? makePreQuote() : null;
  }

  if (session === "post") {
    return hasPost ? makePostQuote() : null;
  }

  if (session === "regular") {
    return null;
  }

  // session === "closed" (overnight 8:00 PM - 4:00 AM ET, or weekends)
  if (hasPost) return makePostQuote();
  if (hasPre) return makePreQuote();

  return null;
}


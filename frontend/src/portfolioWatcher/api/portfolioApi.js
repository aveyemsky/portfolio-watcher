import { PortfolioApiError } from "../core/errors";
import { logger } from "../core/logger";

async function parseJsonSafely(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    logger.warn("Failed to parse API response JSON", error);
    return null;
  }
}

async function requestJson(apiBaseUrl, path, options = {}) {
  const url = `${apiBaseUrl}${path}`;
  logger.debug("API request", url);

  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      },
      ...options
    });
  } catch (error) {
    logger.error("Network request failed", error);
    throw new PortfolioApiError("Unable to reach the PortfolioWatcher backend.", {
      code: "network_error",
      details: error
    });
  }

  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    const apiError = payload?.error || {};
    logger.error("API request failed", response.status, apiError);

    let defaultMsg = "Portfolio API request failed.";
    let code = apiError.code || "api_error";

    if (response.status === 429 || apiError.code === "upstream_rate_limited") {
      defaultMsg = "Yahoo Finance is temporarily rate-limiting requests. Retrying shortly...";
      code = "upstream_rate_limited";
    } else if (response.status === 504 || apiError.code === "upstream_timeout") {
      defaultMsg = "Connection to Yahoo Finance timed out.";
      code = "upstream_timeout";
    } else if (response.status === 502) {
      defaultMsg = "Upstream server returned an invalid response (502 Bad Gateway).";
      code = "bad_gateway";
    } else if (response.status === 404) {
      defaultMsg = "Requested resource or ticker was not found.";
      code = "not_found";
    }

    throw new PortfolioApiError(apiError.message || defaultMsg, {
      code,
      status: response.status,
      details: payload
    });
  }

  return payload;
}

export function fetchBootstrap(apiBaseUrl) {
  return requestJson(apiBaseUrl, "/bootstrap");
}

export function fetchAccounts(apiBaseUrl) {
  return requestJson(apiBaseUrl, "/accounts");
}

export function fetchAccount(apiBaseUrl, accountId) {
  return requestJson(apiBaseUrl, `/accounts/${accountId}`);
}

export function fetchAccountHoldings(apiBaseUrl, accountId) {
  return requestJson(apiBaseUrl, `/accounts/${accountId}/holdings`);
}

export function addHoldingToAccount(apiBaseUrl, accountId, payload) {
  return requestJson(apiBaseUrl, `/accounts/${accountId}/holdings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function deleteHoldingFromAccount(apiBaseUrl, accountId, symbol) {
  return requestJson(apiBaseUrl, `/accounts/${accountId}/holdings/${encodeURIComponent(symbol)}`, {
    method: "DELETE"
  });
}

export function updateHolding(apiBaseUrlOrAccountId, accountIdOrSymbol, symbolOrPayload, optionalPayload) {
  let apiBaseUrl = "";
  let accountId;
  let symbol;
  let payload;
  if (optionalPayload !== undefined) {
    apiBaseUrl = apiBaseUrlOrAccountId;
    accountId = accountIdOrSymbol;
    symbol = symbolOrPayload;
    payload = optionalPayload;
  } else {
    accountId = apiBaseUrlOrAccountId;
    symbol = accountIdOrSymbol;
    payload = symbolOrPayload;
  }
  return requestJson(apiBaseUrl, `/accounts/${accountId}/stocks/${encodeURIComponent(symbol)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function createAccount(apiBaseUrl, payload) {
  return requestJson(apiBaseUrl, "/accounts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function updateAccount(apiBaseUrl, accountId, payload) {
  return requestJson(apiBaseUrl, `/accounts/${accountId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function deleteAccount(apiBaseUrl, accountId) {
  return requestJson(apiBaseUrl, `/accounts/${accountId}`, {
    method: "DELETE"
  });
}

export function fetchStocks(apiBaseUrl) {
  return requestJson(apiBaseUrl, "/stocks");
}

export function fetchStock(apiBaseUrl, symbol) {
  return requestJson(apiBaseUrl, `/stocks/${symbol}`);
}

export function fetchStockPrices(apiBaseUrl, symbol) {
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/prices`);
}

export function fetchStockIntraday(apiBaseUrl, symbol, interval = "5m") {
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/intraday?interval=${encodeURIComponent(interval)}`);
}

export function refreshStockIntraday(apiBaseUrl, symbol, interval = "5m") {
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/intraday/refresh?interval=${encodeURIComponent(interval)}`, {
    method: "POST"
  });
}

export function fetchStockAnalysis(apiBaseUrl, symbol) {
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/analysis`);
}

export function fetchStockIndicators(apiBaseUrl, symbol) {
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/indicators`);
}

export function fetchStockIndicatorSeries(apiBaseUrl, symbol) {
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/indicators/series`);
}

export function fetchStockFundamentals(apiBaseUrl, symbol, { refresh = false } = {}) {
  const query = refresh ? "?refresh=true" : "";
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/fundamentals${query}`);
}


export function addStock(apiBaseUrl, symbol, options = {}) {
  const bodyPayload = typeof symbol === "object"
    ? { ...symbol, ...options }
    : {
        symbol,
        ...(options?.weight_pct !== undefined ? { weight_pct: options.weight_pct } : {}),
        ...(options?.weightPct !== undefined ? { weight_pct: options.weightPct } : {})
      };

  return requestJson(apiBaseUrl, "/stocks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: JSON.stringify(bodyPayload),
    ...options
  });
}

export function deleteStock(apiBaseUrl, symbol) {
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}`, {
    method: "DELETE"
  });
}

export function syncStock(apiBaseUrl, symbol) {
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/sync`, {
    method: "POST"
  });
}

export function syncAllStocks(apiBaseUrl, options = {}) {
  return requestJson(apiBaseUrl, "/stocks/sync", {
    method: "POST",
    ...options
  });
}

export function refreshStockQuotes(apiBaseUrl) {
  return requestJson(apiBaseUrl, "/stocks/quotes/refresh", {
    method: "POST"
  });
}

export function refreshStockQuote(apiBaseUrl, symbol) {
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/quote/refresh`, {
    method: "POST"
  });
}

export function refreshIndexQuotes(apiBaseUrl) {
  return requestJson(apiBaseUrl, "/indices/quotes/refresh", {
    method: "POST"
  });
}

export function fetchDocumentProviders(apiBaseUrl) {
  return requestJson(apiBaseUrl, "/documents/providers");
}

export function fetchStockDocuments(apiBaseUrl, symbol, options = {}) {
  const { category, provider, refresh, limit } = options;
  const params = new URLSearchParams();
  if (category && category !== "all") params.append("category", category);
  if (provider) params.append("provider", provider);
  if (refresh) params.append("refresh", "true");
  if (limit) params.append("limit", String(limit));

  const queryStr = params.toString() ? `?${params.toString()}` : "";
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/documents${queryStr}`);
}

export function saveStockNote(apiBaseUrl, symbol, payload) {
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/notes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function deleteStockNote(apiBaseUrl, symbol, noteId) {
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE"
  });
}

export function fetchCategories(apiBaseUrl) {
  return requestJson(apiBaseUrl, "/categories");
}

export function createCategory(apiBaseUrl, payload) {
  return requestJson(apiBaseUrl, "/categories", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function updateCategory(apiBaseUrl, categoryId, payload) {
  return requestJson(apiBaseUrl, `/categories/${encodeURIComponent(categoryId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function deleteCategory(apiBaseUrl, categoryId, options = {}) {
  const deletePortfolios = typeof options === "boolean" ? options : Boolean(options?.deletePortfolios);
  const query = deletePortfolios ? "?delete_portfolios=true" : "";
  return requestJson(apiBaseUrl, `/categories/${encodeURIComponent(categoryId)}${query}`, {
    method: "DELETE"
  });
}


export function fetchMasterStocks(apiBaseUrl) {
  return requestJson(apiBaseUrl, "/stocks/master");
}

export function addPortfolioSection(apiBaseUrl, portfolioId, payload, sortOrder = 0) {
  const body = typeof payload === "string" ? { sectionLabel: payload, sortOrder } : payload;
  return requestJson(apiBaseUrl, `/portfolios/${encodeURIComponent(portfolioId)}/section`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

export function deletePortfolioSection(apiBaseUrl, portfolioId, sectionId) {
  return requestJson(apiBaseUrl, `/portfolios/${encodeURIComponent(portfolioId)}/section/${encodeURIComponent(sectionId)}`, {
    method: "DELETE"
  });
}

export function reorderPortfolioItems(apiBaseUrl, portfolioId, items) {
  return requestJson(apiBaseUrl, `/portfolios/${encodeURIComponent(portfolioId)}/items/reorder`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items })
  });
}

// --- Prediction Market & Catalyst API ---

export function fetchMacroCatalysts(apiBaseUrl, { category, provider, limit = 20, minVolume = 500, refresh = false } = {}) {
  const params = new URLSearchParams();
  if (category && category !== "all") params.set("category", category);
  if (provider) params.set("provider", provider);
  if (limit) params.set("limit", String(limit));
  if (minVolume) params.set("min_volume", String(minVolume));
  if (refresh) params.set("refresh", "true");

  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson(apiBaseUrl, `/catalysts/macro${query}`);
}

export function fetchStockCatalysts(apiBaseUrl, symbol, { provider, limit = 15, minVolume = 0, refresh = false } = {}) {
  const params = new URLSearchParams();
  if (provider) params.set("provider", provider);
  if (limit) params.set("limit", String(limit));
  if (minVolume) params.set("min_volume", String(minVolume));
  if (refresh) params.set("refresh", "true");

  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson(apiBaseUrl, `/stocks/${encodeURIComponent(symbol)}/catalysts${query}`);
}

export function searchCatalysts(apiBaseUrl, queryStr, { provider, limit = 15, minVolume = 0, refresh = false } = {}) {
  const params = new URLSearchParams();
  params.set("q", queryStr || "");
  if (provider) params.set("provider", provider);
  if (limit) params.set("limit", String(limit));
  if (minVolume) params.set("min_volume", String(minVolume));
  if (refresh) params.set("refresh", "true");

  return requestJson(apiBaseUrl, `/catalysts/search?${params.toString()}`);
}

export function fetchCatalystProviders(apiBaseUrl) {
  return requestJson(apiBaseUrl, "/catalysts/providers");
}



from zoneinfo import ZoneInfo

MARKET_TIMEZONE = ZoneInfo("America/New_York")


def compute_effective_weights(account, holdings, quotes=None):
    """
    Computes effective_weight_pct for holdings and unallocated_cash_pct for account.
    Returns: (dict_of_holding_key_to_effective_weight, unallocated_cash_pct)
    """
    stock_holdings = [h for h in holdings if not getattr(h, "is_section_header", False)]
    N = len(stock_holdings)
    if N == 0:
        return {}, None

    # Determine mode:
    # If category name contains sector/basket/watchlist, or account.type contains basket/watchlist/sector:
    cat_name = getattr(getattr(account, "category", None), "name", "") or ""
    acc_type = getattr(account, "type", "") or ""
    is_basket = any(term in cat_name.lower() or term in acc_type.lower() for term in ["sector", "basket", "watch", "action"])
    sizing_mode = "PERCENT" if is_basket else getattr(account, "sizing_mode", "PERCENT")

    weights_by_key = {}
    unallocated_cash_pct = None

    if sizing_mode == "SHARES":
        total_market_value = 0.0
        values_by_key = {}
        for h in stock_holdings:
            key = getattr(h, "id", None) or getattr(h, "symbol", None)
            sym = (getattr(h, "symbol", "") or "").upper()
            price = 0.0
            if quotes:
                q = quotes.get(sym) or quotes.get(getattr(h, "symbol", ""))
                if isinstance(q, (int, float)):
                    price = float(q)
                elif isinstance(q, dict):
                    price = float(q.get("last_price") or q.get("lastPrice") or q.get("price") or q.get("close") or 0.0)
                elif hasattr(q, "last_price"):
                    price = float(getattr(q, "last_price", 0.0) or 0.0)
            if price <= 0.0:
                stk = getattr(h, "stock", None)
                if stk and getattr(stk, "last_price", None):
                    price = float(stk.last_price)
                else:
                    price = float(getattr(h, "avg_cost", 0.0) or 0.0)

            val = float(getattr(h, "shares", 0.0) or 0.0) * price
            values_by_key[key] = val
            total_market_value += val

        if total_market_value > 0:
            for h in stock_holdings:
                key = getattr(h, "id", None) or getattr(h, "symbol", None)
                weights_by_key[key] = round((values_by_key[key] / total_market_value) * 100.0, 1)
        else:
            for h in stock_holdings:
                key = getattr(h, "id", None) or getattr(h, "symbol", None)
                weights_by_key[key] = round(100.0 / N, 1)
    else:
        # PERCENT mode (and Sector/Watchlist baskets)
        explicit_weights = {}
        none_holdings = []
        for h in stock_holdings:
            key = getattr(h, "id", None) or getattr(h, "symbol", None)
            w = getattr(h, "weight_pct", None)
            if isinstance(h, dict):
                w = h.get("weight_pct", h.get("weightPct"))
            if w is not None and float(w) > 0:
                explicit_weights[key] = float(w)
            else:
                none_holdings.append(h)

        if not explicit_weights:
            # If no stock has weight_pct > 0, assign true Equal Weight
            for h in stock_holdings:
                key = getattr(h, "id", None) or getattr(h, "symbol", None)
                weights_by_key[key] = round(100.0 / N, 1)
        else:
            total_explicit = sum(explicit_weights.values())
            if total_explicit > 100.0:
                # normalize if sum > 100%
                for h in stock_holdings:
                    key = getattr(h, "id", None) or getattr(h, "symbol", None)
                    if key in explicit_weights:
                        weights_by_key[key] = round((explicit_weights[key] / total_explicit) * 100.0, 1)
                    else:
                        weights_by_key[key] = 0.0
            elif total_explicit < 100.0 and len(none_holdings) > 0:
                # if sum < 100% and some stocks are None, distribute remainder equally to None stocks
                rem = 100.0 - total_explicit
                rem_per_none = rem / len(none_holdings)
                for h in stock_holdings:
                    key = getattr(h, "id", None) or getattr(h, "symbol", None)
                    if key in explicit_weights:
                        weights_by_key[key] = round(explicit_weights[key], 1)
                    else:
                        weights_by_key[key] = round(rem_per_none, 1)
            elif total_explicit < 100.0 and len(none_holdings) == 0:
                # all stocks have explicit weight_pct and sum < 100%
                for h in stock_holdings:
                    key = getattr(h, "id", None) or getattr(h, "symbol", None)
                    weights_by_key[key] = round(explicit_weights[key], 1)
                unallocated_cash_pct = round(100.0 - total_explicit, 1)
            else:
                # total_explicit == 100.0
                for h in stock_holdings:
                    key = getattr(h, "id", None) or getattr(h, "symbol", None)
                    weights_by_key[key] = round(explicit_weights.get(key, 0.0), 1)

    return weights_by_key, unallocated_cash_pct


def serialize_account(account, quotes=None, items=None):
    res = {
        "id": account.id,
        "name": account.name,
        "type": account.type,
        "categoryId": getattr(account, "category_id", None),
        "sortOrder": getattr(account, "sort_order", 0),
        "sizingMode": getattr(account, "sizing_mode", "PERCENT"),
        "sizing_mode": getattr(account, "sizing_mode", "PERCENT"),
    }
    if items is None:
        items = getattr(account, "items", None) or getattr(account, "holdings", None) or getattr(account, "stocks", None)
    if items:
        weights_by_key, unallocated = compute_effective_weights(account, items, quotes=quotes)
        if unallocated is not None:
            res["unallocated_cash_pct"] = unallocated
            res["unallocatedCashPct"] = unallocated
        res["holdings"] = [
            serialize_holding(
                h,
                effective_weight_pct=weights_by_key.get(getattr(h, "id", None))
                if getattr(h, "id", None) in weights_by_key
                else weights_by_key.get(getattr(h, "symbol", None))
            )
            for h in items
        ]
        res["stocks"] = res["holdings"]
    return res


def serialize_category(category, serialized_accounts_by_cat=None):
    if serialized_accounts_by_cat is not None:
        portfolios = serialized_accounts_by_cat.get(category.id, [])
    else:
        portfolios = [
            serialize_account(p) for p in (category.portfolios or [])
        ]
    return {
        "id": category.id,
        "name": category.name,
        "sortOrder": category.sort_order,
        "isDefault": category.is_default,
        "createdAt": category.created_at.isoformat() if getattr(category, "created_at", None) else None,
        "portfolios": portfolios,
    }


def serialize_stock(stock, fundamentals_map=None):
    payload = {
        "id": stock.id,
        "symbol": stock.symbol,
        "name": stock.name,
        "sector": stock.sector,
    }
    skew_quote_date = None
    if getattr(stock, "symbol", None) == "^SKEW" and getattr(stock, "id", None):
        try:
            from portfolio.data.repositories import price_repository
            latest_date = price_repository.get_latest_price_date(stock.id)
            if latest_date:
                skew_quote_date = latest_date.isoformat()
        except Exception:
            pass

    optional_fields = {
        "exchange": getattr(stock, "exchange", None),
        "currency": getattr(stock, "currency", None),
        "lastPrice": getattr(stock, "last_price", None),
        "previousClose": getattr(stock, "previous_close", None),
        "marketCap": getattr(stock, "market_cap", None),
        "lastSplitDate": stock.last_split_date.isoformat() if getattr(stock, "last_split_date", None) else None,
        "splitDirty": getattr(stock, "split_dirty", None),
        "priceDirty": getattr(stock, "price_dirty", None),
        "postMarketPrice": getattr(stock, "post_market_price", None),
        "postMarketChange": getattr(stock, "post_market_change", None),
        "postMarketChangePercent": getattr(stock, "post_market_change_percent", None),
        "preMarketPrice": getattr(stock, "pre_market_price", None),
        "preMarketChange": getattr(stock, "pre_market_change", None),
        "preMarketChangePercent": getattr(stock, "pre_market_change_percent", None),
        "dayOpen": getattr(stock, "day_open", None),
        "dayHigh": getattr(stock, "day_high", None),
        "dayLow": getattr(stock, "day_low", None),
        "assetType": getattr(stock, "asset_type", "stock"),
        "isDeletable": getattr(stock, "is_deletable", True),
        "displayOrder": getattr(stock, "display_order", None),
        "shortName": getattr(stock, "short_name", None),
        "quoteDate": (
            skew_quote_date
            if skew_quote_date
            else (
                stock.quote_date.isoformat()
                if getattr(stock, "quote_date", None)
                else (
                    stock.updated_at.astimezone(MARKET_TIMEZONE).date().isoformat()
                    if getattr(stock, "updated_at", None) and stock.updated_at.tzinfo
                    else (
                        stock.updated_at.replace(tzinfo=ZoneInfo("UTC")).astimezone(MARKET_TIMEZONE).date().isoformat()
                        if getattr(stock, "updated_at", None)
                        else None
                    )
                )
            )
        ),
        "updatedAt": stock.updated_at.isoformat() if getattr(stock, "updated_at", None) else None,
    }
    payload.update({key: value for key, value in optional_fields.items() if value is not None})

    sym = getattr(stock, "symbol", None)
    if sym and getattr(stock, "asset_type", "stock") != "index" and not str(sym).startswith("^"):
        f_summary = None
        if fundamentals_map is not None:
            f_summary = fundamentals_map.get(sym)
        else:
            try:
                from portfolio.services.fundamental_service import get_cached_fundamentals_map
                f_summary = get_cached_fundamentals_map([sym]).get(sym)
            except Exception:
                f_summary = None
        if f_summary:
            if f_summary.get("next_earnings_date"):
                payload["next_earnings_date"] = f_summary["next_earnings_date"]
                payload["nextEarningsDate"] = f_summary["next_earnings_date"]
            payload["calendar"] = f_summary["calendar"]
            payload["dividend_snapshot"] = f_summary["dividend_snapshot"]

    return payload


def serialize_holding(holding, effective_weight_pct=None):
    weight_pct = getattr(holding, "weight_pct", None)
    if isinstance(holding, dict):
        weight_pct = holding.get("weight_pct", holding.get("weightPct"))
        if effective_weight_pct is None:
            effective_weight_pct = holding.get("effective_weight_pct", holding.get("effectiveWeightPct"))
    return {
        "id": getattr(holding, "id", None) if not isinstance(holding, dict) else holding.get("id"),
        "accountId": getattr(holding, "portfolio_id", getattr(holding, "account_id", None)) if not isinstance(holding, dict) else (holding.get("portfolio_id") or holding.get("account_id") or holding.get("accountId")),
        "portfolioId": getattr(holding, "portfolio_id", getattr(holding, "account_id", None)) if not isinstance(holding, dict) else (holding.get("portfolio_id") or holding.get("account_id") or holding.get("portfolioId")),
        "stockId": getattr(holding, "stock_id", None) if not isinstance(holding, dict) else holding.get("stock_id", holding.get("stockId")),
        "symbol": holding.symbol if not isinstance(holding, dict) else holding.get("symbol"),
        "shares": holding.shares if not isinstance(holding, dict) else holding.get("shares", 0.0),
        "avgCost": holding.avg_cost if not isinstance(holding, dict) else holding.get("avg_cost", holding.get("avgCost", 0.0)),
        "weight_pct": weight_pct,
        "weightPct": weight_pct,
        "effective_weight_pct": effective_weight_pct,
        "effectiveWeightPct": effective_weight_pct,
        "isSectionHeader": getattr(holding, "is_section_header", False) if not isinstance(holding, dict) else holding.get("isSectionHeader", False),
        "sectionLabel": getattr(holding, "section_label", None) if not isinstance(holding, dict) else holding.get("sectionLabel"),
        "sortOrder": getattr(holding, "sort_order", 0) if not isinstance(holding, dict) else holding.get("sortOrder", holding.get("sort_order", 0)),
    }


def serialize_price(price):
    return {
        "date": price.date.isoformat(),
        "open": round(price.open, 2),
        "high": round(price.high, 2),
        "low": round(price.low, 2),
        "close": round(price.close, 2),
        "volume": price.volume,
    }


def serialize_intraday_price(price):
    return {
        "timestamp": _market_time_iso(price.timestamp),
        "open": round(price.open, 2),
        "high": round(price.high, 2),
        "low": round(price.low, 2),
        "close": round(price.close, 2),
        "volume": price.volume,
    }


def serialize_intraday_payload(payload):
    return {
        "symbol": payload["symbol"],
        "interval": payload["interval"],
        "tradingDate": payload["trading_date"].isoformat(),
        "fetchedAt": _market_time_iso(payload["fetched_at"]) if payload.get("fetched_at") else None,
        "prices": [serialize_intraday_price(price) for price in payload["prices"]],
    }


def _market_time_iso(value):
    if value.tzinfo is None:
        value = value.replace(tzinfo=MARKET_TIMEZONE)
    return value.astimezone(MARKET_TIMEZONE).isoformat()


def serialize_account_with_holdings(account, holdings, quotes=None):
    weights_by_key, unallocated = compute_effective_weights(account, holdings, quotes=quotes)
    acc_dict = serialize_account(account, quotes=quotes)
    if unallocated is not None:
        acc_dict["unallocated_cash_pct"] = unallocated
        acc_dict["unallocatedCashPct"] = unallocated

    serialized_holdings = [
        serialize_holding(
            h,
            effective_weight_pct=weights_by_key.get(getattr(h, "id", None))
            if getattr(h, "id", None) in weights_by_key
            else weights_by_key.get(getattr(h, "symbol", None))
        )
        for h in holdings
    ]
    acc_dict["holdings"] = serialized_holdings
    acc_dict["stocks"] = serialized_holdings
    return acc_dict


def serialize_bootstrap(payload):
    quotes = {
        s.symbol: getattr(s, "last_price", 0.0)
        for s in payload.get("stocks", [])
        if getattr(s, "symbol", None)
    }

    holdings_by_account_data = {}
    accounts_with_unallocated = []
    serialized_accounts_by_cat = {}
    categories_by_id = {c.id: c for c in payload.get("categories", [])}

    for account in payload.get("accounts", []):
        raw_holdings = payload["holdings_by_account"].get(account.id, [])
        weights_by_key, unallocated = compute_effective_weights(account, raw_holdings, quotes=quotes)
        serialized_h = [
            serialize_holding(
                h,
                effective_weight_pct=weights_by_key.get(getattr(h, "id", None))
                if getattr(h, "id", None) in weights_by_key
                else weights_by_key.get(getattr(h, "symbol", None))
            )
            for h in raw_holdings
        ]
        holdings_by_account_data[str(account.id)] = serialized_h

        acc_serialized = {
            "id": account.id,
            "name": account.name,
            "type": account.type,
            "categoryId": getattr(account, "category_id", None),
            "sortOrder": getattr(account, "sort_order", 0),
            "sizingMode": getattr(account, "sizing_mode", "PERCENT"),
            "sizing_mode": getattr(account, "sizing_mode", "PERCENT"),
        }
        if serialized_h:
            acc_serialized["holdings"] = serialized_h
            acc_serialized["stocks"] = serialized_h
        if unallocated is not None:
            acc_serialized["unallocated_cash_pct"] = unallocated
            acc_serialized["unallocatedCashPct"] = unallocated
        accounts_with_unallocated.append(acc_serialized)
        cat_id = getattr(account, "category_id", None)
        if cat_id is not None:
            serialized_accounts_by_cat.setdefault(cat_id, []).append(acc_serialized)

    fundamentals_map = {}
    try:
        from portfolio.services.fundamental_service import (
            FundamentalQueueManager,
            get_cached_fundamentals_map,
        )

        stock_syms = [s.symbol for s in payload.get("stocks", []) if getattr(s, "symbol", None)]
        if stock_syms:
            priority_by_symbol = {
                sym.upper(): FundamentalQueueManager.PRIORITY_LOW
                for sym in stock_syms
                if sym and not str(sym).startswith("^")
            }
            for account in payload.get("accounts", []):
                cat_obj = categories_by_id.get(getattr(account, "category_id", None))
                cat_name = getattr(cat_obj, "name", "") if cat_obj is not None else (getattr(getattr(account, "category", None), "name", "") or "")
                acc_type = getattr(account, "type", "") or ""
                acc_name = getattr(account, "name", "") or ""
                is_watchlist = any(
                    term in f"{cat_name} {acc_type} {acc_name}".lower()
                    for term in ("watch", "basket", "sector")
                )
                tier = (
                    FundamentalQueueManager.PRIORITY_LOW
                    if is_watchlist
                    else FundamentalQueueManager.PRIORITY_MEDIUM
                )
                for h in payload.get("holdings_by_account", {}).get(account.id, []):
                    if getattr(h, "is_section_header", False):
                        continue
                    h_sym = (getattr(h, "symbol", "") or "").strip().upper()
                    if h_sym and not h_sym.startswith("^"):
                        existing = priority_by_symbol.get(h_sym, FundamentalQueueManager.PRIORITY_LOW)
                        priority_by_symbol[h_sym] = min(existing, tier)

            fundamentals_map = get_cached_fundamentals_map(
                stock_syms,
                priority_by_symbol=priority_by_symbol,
            )
    except Exception:
        fundamentals_map = {}

    result = {
        "categories": [
            serialize_category(cat, serialized_accounts_by_cat=serialized_accounts_by_cat)
            for cat in payload.get("categories", [])
        ],
        "accounts": accounts_with_unallocated,
        "portfolios": accounts_with_unallocated,
        "stocks": [serialize_stock(stock, fundamentals_map=fundamentals_map) for stock in payload["stocks"]],
        "indices": [serialize_stock(idx, fundamentals_map={}) for idx in payload.get("indices", [])],
        "holdingsByAccount": holdings_by_account_data,
        "pricesBySymbol": {
            symbol: [serialize_price(price) for price in prices]
            for symbol, prices in payload["prices_by_symbol"].items()
        },
    }
    if "master_stocks_summary" in payload:
        result["masterStocksSummary"] = payload["master_stocks_summary"]
    return result


def serialize_stock_with_prices(payload):
    return {
        "stock": serialize_stock(payload["stock"]),
        "prices": [serialize_price(price) for price in payload["prices"]],
    }

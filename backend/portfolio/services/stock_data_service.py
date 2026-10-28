import os
import threading
import warnings
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

# Suppress NumPy/pandas timedelta deprecation warnings emitted by yfinance internal scrapers
warnings.filterwarnings("ignore", message=r".*generic.*unit for NumPy timedelta.*")
warnings.filterwarnings("ignore", message=r".*The 'generic' unit for NumPy timedelta is deprecated.*")
warnings.filterwarnings("ignore", category=DeprecationWarning, module=r"yfinance(\..*)?")

import pandas as pd
from flask import current_app, has_app_context

from portfolio.core.logging import get_logger, suppress_yfinance_warnings

suppress_yfinance_warnings()

try:
    import yfinance as yf
    suppress_yfinance_warnings()
except ModuleNotFoundError:
    yf = None

logger = get_logger(__name__)

# Primary historical anchor date: all daily stock prices sync from this deterministic date forward.
# Anchoring to a fixed date ensures uniform timeline alignment across all assets for technical
# indicators, multi-year trend charts, and strategy backtesting simulations without sliding-window drift.
DEFAULT_PRICE_HISTORY_START_DATE = "2017-01-01"
MARKET_TIMEZONE = ZoneInfo("America/New_York")


def normalize_symbol(symbol):
    normalized = (symbol or "").strip().upper()
    if not normalized:
        raise ValueError("symbol is required")
    return normalized


def default_history_start_date():
    if has_app_context():
        return current_app.config.get("STOCK_HISTORY_START_DATE", DEFAULT_PRICE_HISTORY_START_DATE)
    return os.environ.get("STOCK_HISTORY_START_DATE", DEFAULT_PRICE_HISTORY_START_DATE)


def get_fixed_history_start_date(years=None, ref_date=None):
    """Calculates a deterministic fixed starting date for the historical window.
    If years is None, defaults to default_history_start_date() ('2017-01-01').
    If years is provided (e.g. 7 or 10), anchors to the 1st of the month years ago.
    """
    if years is None:
        return default_history_start_date()
    if ref_date is None:
        ref_date = date.today()
    return date(ref_date.year - years, ref_date.month, 1).isoformat()


def default_end_date():
    return (date.today() + timedelta(days=1)).isoformat()


def default_start_date(days=365, years=None):
    if years is not None:
        return get_fixed_history_start_date(years=years)
    return (date.today() - timedelta(days=days)).isoformat()


def default_history_period():
    if has_app_context():
        return current_app.config.get("STOCK_HISTORY_PERIOD")
    return os.environ.get("STOCK_HISTORY_PERIOD")


_session_lock = threading.Lock()
_session_initialized = False


def ensure_yfinance_session(force=False):
    global _session_initialized
    if _session_initialized and not force:
        return
    with _session_lock:
        if _session_initialized and not force:
            return
        if yf is None:
            return
        suppress_yfinance_warnings()
        try:
            import re
            from curl_cffi import requests as cffi_requests
            session = cffi_requests.Session(impersonate="chrome120")
            crumb = None
            try:
                session.get("https://fc.yahoo.com", timeout=6)
                r_crumb = session.get("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=6)
                if r_crumb.status_code == 200 and r_crumb.text and "Too Many Requests" not in r_crumb.text:
                    crumb = r_crumb.text.strip()
            except Exception:
                pass

            if not crumb:
                # Resilient fallback: extract active crumb directly from Yahoo Finance quote HTML
                try:
                    r_html = session.get("https://finance.yahoo.com/quote/SPY/", timeout=10)
                    if r_html.status_code == 200:
                        crumbs = re.findall(r'"crumb":"([^"]+)"', r_html.text)
                        if crumbs:
                            crumb = crumbs[0]
                except Exception as exc:
                    logger.debug("Failed HTML crumb fallback: %s", exc)

            if crumb:
                data = yf.data.YfData()
                data._session = session
                data._crumb = crumb
                data._cookie = True
                _session_initialized = True
                logger.info("Initialized authenticated Yahoo Finance session (crumb=%s...)", crumb[:4])
        except Exception as exc:
            logger.warning("Could not initialize custom Yahoo Finance session: %s", exc)


def _require_yfinance():
    if yf is None:
        raise RuntimeError("yfinance is required to fetch stock data")
    ensure_yfinance_session()


def _flatten_download_columns(df):
    if isinstance(df.columns, pd.MultiIndex):
        df = df.copy()
        df.columns = df.columns.get_level_values(0)
    return df


def _safe_float(value):
    if value is None or pd.isna(value):
        return None
    return float(value)


def _safe_int(value):
    if value is None or pd.isna(value):
        return None
    return int(value)


def _parse_ohlc_row(row, fields):
    values = {field.lower(): _safe_float(row[field]) for field in fields}
    if any(value is None for value in values.values()):
        return None
    return values


def get_market_session(dt=None):
    """
    Classify the current US market trading session (America/New_York):
      - 'pre': Weekdays 04:00 – 09:30 ET
      - 'regular': Weekdays 09:30 – 16:00 ET
      - 'post': Weekdays 16:00 – 20:00 ET
      - 'closed': Weekends and weekdays 20:00 – 04:00 ET
    """
    if dt is None:
        dt = datetime.now(MARKET_TIMEZONE)
    elif dt.tzinfo is None:
        dt = dt.replace(tzinfo=MARKET_TIMEZONE)
    else:
        dt = dt.astimezone(MARKET_TIMEZONE)

    weekday = dt.weekday()
    if weekday in (5, 6):  # Saturday or Sunday
        return "closed"

    current_minutes = dt.hour * 60 + dt.minute
    pre_start = 4 * 60          # 04:00 ET
    regular_start = 9 * 60 + 30 # 09:30 ET
    regular_end = 16 * 60       # 16:00 ET
    post_end = 20 * 60          # 20:00 ET

    if pre_start <= current_minutes < regular_start:
        return "pre"
    if regular_start <= current_minutes <= regular_end:
        return "regular"
    if regular_end < current_minutes <= post_end:
        return "post"
    return "closed"


def _extract_extended_hours_data(info, last_price=None, previous_close=None):
    if not info:
        return {
            "post_market_price": None,
            "post_market_change": None,
            "post_market_change_percent": None,
            "pre_market_price": None,
            "pre_market_change": None,
            "pre_market_change_percent": None,
        }

    post_price = _safe_float(info.get("postMarketPrice"))
    post_change = _safe_float(info.get("postMarketChange"))
    post_change_pct = _safe_float(info.get("postMarketChangePercent"))
    post_time = _safe_int(info.get("postMarketTime"))
    reg_time = _safe_int(info.get("regularMarketTime"))

    pre_price = _safe_float(info.get("preMarketPrice"))
    pre_change = _safe_float(info.get("preMarketChange"))
    pre_change_pct = _safe_float(info.get("preMarketChangePercent"))
    pre_time = _safe_int(info.get("preMarketTime"))

    # Guard against invalid / non-positive prices
    if post_price is not None and post_price <= 0:
        post_price = None
        post_change = None
        post_change_pct = None
    if pre_price is not None and pre_price <= 0:
        pre_price = None
        pre_change = None
        pre_change_pct = None

    market_state = str(info.get("marketState") or "").upper()

    # Disambiguate sessions with strict isolation guardrails
    if market_state == "PRE":
        post_price = None
        post_change = None
        post_change_pct = None
    elif market_state == "PREPRE":
        # Yahoo Finance emits PREPRE from 00:00–04:00 ET before pre-market opens.
        # Only clear post_price if we are in active pre-market or have a pre-market quote;
        # during the overnight closed window (before 04:00 ET), retain the last after-hours quote.
        if pre_price is not None or get_market_session() == "pre":
            post_price = None
            post_change = None
            post_change_pct = None
    elif market_state in ("POST", "POSTPOST"):
        pre_price = None
        pre_change = None
        pre_change_pct = None
    elif market_state == "REGULAR":
        pre_price = None
        pre_change = None
        pre_change_pct = None
        post_price = None
        post_change = None
        post_change_pct = None
    elif market_state == "CLOSED":
        pre_price = None
        pre_change = None
        pre_change_pct = None
    elif not market_state and pre_price is not None and post_price is not None:
        # Both present without marketState: use session timing to disambiguate
        session = get_market_session()
        if session == "pre":
            post_price = None
            post_change = None
            post_change_pct = None
        elif session in ("post", "closed"):
            pre_price = None
            pre_change = None
            pre_change_pct = None

    # If post-market time is older than the regular session close, it's stale from a previous day
    if post_price is not None and post_time is not None and reg_time is not None and post_time < reg_time:
        post_price = None
        post_change = None
        post_change_pct = None

    if post_price is not None:
        ref_price = last_price or _safe_float(info.get("regularMarketPrice") or info.get("currentPrice"))
        if post_change is None and ref_price:
            post_change = round(post_price - ref_price, 4)
        if post_change_pct is None and ref_price and ref_price > 0:
            post_change_pct = round(((post_price - ref_price) / ref_price) * 100, 4)

    # If regular market has updated more recently than pre-market, pre-market is no longer active
    if pre_price is not None and pre_time is not None and reg_time is not None and reg_time >= pre_time:
        pre_price = None
        pre_change = None
        pre_change_pct = None

    if pre_price is not None:
        # Pre-market change is relative to the last regular session close (last_price)
        ref_price = (
            last_price
            or _safe_float(info.get("regularMarketPrice") or info.get("currentPrice"))
            or previous_close
            or _safe_float(info.get("previousClose"))
        )
        if pre_change is None and ref_price:
            pre_change = round(pre_price - ref_price, 4)
        if pre_change_pct is None and ref_price and ref_price > 0:
            pre_change_pct = round(((pre_price - ref_price) / ref_price) * 100, 4)

    return {
        "post_market_price": post_price,
        "post_market_change": post_change,
        "post_market_change_percent": post_change_pct,
        "pre_market_price": pre_price,
        "pre_market_change": pre_change,
        "pre_market_change_percent": pre_change_pct,
    }


def fetch_stock_info(symbol):
    _require_yfinance()
    normalized = normalize_symbol(symbol)
    logger.info("Fetching stock info for %s", normalized)

    ticker = yf.Ticker(normalized)
    info = {}
    try:
        info = ticker.info or {}
    except Exception as exc:
        logger.warning("ticker.info call failed for %s, falling back to fast_info: %s", normalized, exc)

    fast = getattr(ticker, "fast_info", None)

    current_price = info.get("currentPrice") or info.get("regularMarketPrice")
    last_price = _safe_float(current_price) if current_price is not None else None
    previous_close = _safe_float(info.get("regularMarketPreviousClose") or info.get("previousClose"))
    day_open = _safe_float(info.get("regularMarketOpen") or info.get("open"))
    day_high = _safe_float(info.get("regularMarketDayHigh") or info.get("dayHigh"))
    day_low = _safe_float(info.get("regularMarketDayLow") or info.get("dayLow"))
    market_cap = _safe_int(info.get("marketCap"))
    currency = info.get("currency")
    exchange = info.get("exchange") or info.get("fullExchangeName")
    name = info.get("shortName") or info.get("longName")

    # Fast info fallback if info is missing or throttled
    if fast:
        try:
            if last_price is None:
                last_price = _safe_float(
                    fast.get("lastPrice") or fast.get("regularMarketPrice") or fast.get("last_price")
                )
            if previous_close is None:
                previous_close = _safe_float(
                    fast.get("regularMarketPreviousClose")
                    or getattr(fast, "regular_market_previous_close", None)
                    or fast.get("previousClose")
                    or fast.get("previous_close")
                )
            if day_open is None:
                day_open = _safe_float(fast.get("open") or fast.get("regularMarketOpen"))
            if day_high is None:
                day_high = _safe_float(fast.get("dayHigh") or fast.get("day_high") or fast.get("regularMarketDayHigh"))
            if day_low is None:
                day_low = _safe_float(fast.get("dayLow") or fast.get("day_low") or fast.get("regularMarketDayLow"))
            if market_cap is None:
                market_cap = _safe_int(fast.get("marketCap") or fast.get("market_cap"))
            if not currency:
                currency = fast.get("currency")
            if not exchange:
                exchange = fast.get("exchange")
            if not name:
                name = getattr(fast, "shortName", None) or getattr(fast, "name", None)
        except Exception as exc:
            logger.warning("fast_info fallback read failed for %s: %s", normalized, exc)

    if last_price is not None:
        if day_high is not None:
            day_high = max(day_high, last_price)
        if day_low is not None:
            day_low = min(day_low, last_price)
    extended = _extract_extended_hours_data(info, last_price=last_price, previous_close=previous_close)

    return {
        "symbol": normalized,
        "name": name or normalized,
        "sector": info.get("sector") or "Unknown",
        "exchange": exchange,
        "currency": currency,
        "last_price": last_price,
        "previous_close": previous_close,
        "day_open": day_open,
        "day_high": day_high,
        "day_low": day_low,
        "market_cap": market_cap,
        **extended,
    }


def fetch_batch_stock_quotes(symbols):
    _require_yfinance()
    if not symbols:
        return {}

    clean_symbols = [normalize_symbol(s) for s in symbols if s]
    logger.info("Fetching batch stock quotes for %s symbols", len(clean_symbols))
    results = {}

    tickers = yf.Tickers(" ".join(clean_symbols))
    session_mode = get_market_session()

    def _fetch_single(symbol):
        try:
            ticker = tickers.tickers.get(symbol) or yf.Ticker(symbol)
            last_price = None
            previous_close = None
            market_cap = None
            day_open = None
            day_high = None
            day_low = None

            fast = getattr(ticker, "fast_info", None)
            if fast:
                try:
                    last_price = _safe_float(
                        fast.get("lastPrice") or fast.get("regularMarketPrice") or fast.get("last_price")
                    )
                    previous_close = _safe_float(
                        fast.get("regularMarketPreviousClose")
                        or getattr(fast, "regular_market_previous_close", None)
                        or fast.get("previousClose")
                        or fast.get("previous_close")
                    )
                    market_cap = _safe_int(fast.get("marketCap") or fast.get("market_cap"))
                    day_open = _safe_float(fast.get("open") or fast.get("regularMarketOpen"))
                    day_high = _safe_float(fast.get("dayHigh") or fast.get("day_high") or fast.get("regularMarketDayHigh"))
                    day_low = _safe_float(fast.get("dayLow") or fast.get("day_low") or fast.get("regularMarketDayLow"))
                except Exception:
                    pass

            need_info = (
                session_mode != "regular"
                or last_price is None
                or previous_close is None
                or day_open is None
                or day_high is None
                or day_low is None
            )

            info = {}
            if need_info:
                try:
                    info = ticker.info or {}
                except Exception:
                    pass

                if last_price is None or previous_close is None or day_open is None or day_high is None or day_low is None:
                    if last_price is None:
                        current_price = info.get("currentPrice") or info.get("regularMarketPrice")
                        last_price = _safe_float(current_price)
                    if previous_close is None:
                        previous_close = _safe_float(info.get("regularMarketPreviousClose") or info.get("previousClose"))
                    if market_cap is None:
                        market_cap = _safe_int(info.get("marketCap"))
                    if day_open is None:
                        day_open = _safe_float(info.get("regularMarketOpen") or info.get("open"))
                    if day_high is None:
                        day_high = _safe_float(info.get("regularMarketDayHigh") or info.get("dayHigh"))
                    if day_low is None:
                        day_low = _safe_float(info.get("regularMarketDayLow") or info.get("dayLow"))

            # Sanity guard: prices must be strictly positive
            if last_price is not None and last_price <= 0:
                last_price = None
            if previous_close is not None and previous_close <= 0:
                previous_close = None

            if last_price is not None:
                if day_high is not None:
                    day_high = max(day_high, last_price)
                if day_low is not None:
                    day_low = min(day_low, last_price)

            extended = _extract_extended_hours_data(info, last_price=last_price, previous_close=previous_close)

            return symbol, {
                "symbol": symbol,
                "last_price": last_price,
                "previous_close": previous_close,
                "day_open": day_open,
                "day_high": day_high,
                "day_low": day_low,
                "market_cap": market_cap,
                **extended,
            }
        except Exception as exc:
            logger.warning("Failed to fetch quote for %s: %s", symbol, exc)
            return symbol, None

    if len(clean_symbols) <= 1:
        for sym in clean_symbols:
            k, v = _fetch_single(sym)
            results[k] = v
    else:
        max_workers = min(10, len(clean_symbols))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            for k, v in executor.map(_fetch_single, clean_symbols):
                results[k] = v

    return results


def fetch_latest_split_date(symbol):
    _require_yfinance()
    normalized = normalize_symbol(symbol)
    logger.info("Fetching latest split date for %s", normalized)

    ticker = yf.Ticker(normalized)
    try:
        splits = ticker.splits
    except Exception as exc:
        logger.warning("Failed to fetch splits for %s: %s", normalized, exc)
        return None

    if splits is None or splits.empty:
        return None

    valid_splits = splits[(splits > 0) & (splits != 1.0)]
    if valid_splits.empty:
        return None

    latest_dt = valid_splits.index.max()
    return pd.to_datetime(latest_dt).date()


def fetch_stock_price_history(symbol, start_date=None, end_date=None, period=None, return_meta=False):
    _require_yfinance()
    normalized = normalize_symbol(symbol)
    explicit_period = period or default_history_period()

    download_options = {
        "tickers": normalized,
        "group_by": "column",
        "auto_adjust": False,
        "progress": False,
    }
    if explicit_period and explicit_period not in ("10y", "7y", "all"):
        logger.info("Fetching stock price history for %s using explicit period=%s", normalized, explicit_period)
        download_options["period"] = explicit_period
    else:
        resolved_start = start_date or get_fixed_history_start_date()
        resolved_end = end_date or default_end_date()
        logger.info("Fetching stock price history for %s (start=%s, end=%s)", normalized, resolved_start, resolved_end)
        download_options["start"] = resolved_start
        download_options["end"] = resolved_end

    import time
    stock_data = None
    last_exc = None
    for attempt in range(1, 3):
        try:
            stock_data = yf.download(**download_options)
            if stock_data is not None and not stock_data.empty:
                break
        except Exception as exc:
            last_exc = exc
            logger.warning("yf.download attempt %d failed for %s: %s", attempt, normalized, exc)
            if "Rate limit" in str(exc) or "429" in str(exc):
                ensure_yfinance_session(force=True)
            if attempt < 2:
                time.sleep(1.0)

    if stock_data is None or stock_data.empty:
        # Fallback to ticker.history() directly
        try:
            ticker = yf.Ticker(normalized)
            ticker_opts = {}
            if start_date or end_date:
                ticker_opts["start"] = download_options.get("start")
                ticker_opts["end"] = download_options.get("end")
            else:
                ticker_opts["period"] = download_options.get("period")
            fallback_data = ticker.history(**ticker_opts)
            if fallback_data is not None and not fallback_data.empty:
                stock_data = fallback_data
        except Exception as exc:
            logger.warning("ticker.history fallback failed for %s: %s", normalized, exc)

    if stock_data is None or stock_data.empty:
        if last_exc is not None:
            raise last_exc
        return {"prices": [], "has_missing_data": False} if return_meta else []

    stock_data = _flatten_download_columns(stock_data)
    required = {"Open", "High", "Low", "Close"}
    if not required.issubset(set(stock_data.columns)):
        raise ValueError(f"missing required price columns for {normalized}: {list(stock_data.columns)}")

    prices = []
    has_missing_data = False
    today_et = datetime.now(MARKET_TIMEZONE).date()
    total_rows = len(stock_data)
    for idx, (dt, row) in enumerate(stock_data.iterrows()):
        row_date = pd.to_datetime(dt).date()
        ohlc = _parse_ohlc_row(row, ("Open", "High", "Low", "Close"))
        if ohlc is None:
            open_v = _safe_float(row.get("Open"))
            high_v = _safe_float(row.get("High"))
            low_v = _safe_float(row.get("Low"))
            close_v = _safe_float(row.get("Close")) or _safe_float(row.get("Adj Close"))
            is_unsettled_final_row = (
                idx == total_rows - 1
                and open_v is not None
                and high_v is not None
                and low_v is not None
                and close_v is None
            )
            if row_date >= today_et or is_unsettled_final_row:
                if close_v is None and open_v is not None and high_v is not None and low_v is not None:
                    try:
                        t = yf.Ticker(normalized)
                        fast = getattr(t, "fast_info", None)
                        if fast:
                            close_v = _safe_float(
                                fast.get("lastPrice")
                                or fast.get("regularMarketPrice")
                                or fast.get("last_price")
                            )
                    except Exception:
                        pass
                if (
                    open_v is not None and open_v > 0
                    and high_v is not None and high_v > 0
                    and low_v is not None and low_v > 0
                    and close_v is not None and close_v > 0
                ):
                    ohlc = {
                        "open": open_v,
                        "high": max(high_v, open_v, close_v),
                        "low": min(low_v, open_v, close_v),
                        "close": close_v,
                    }
                else:
                    logger.debug(
                        "Skipping unsettled current-day price row for %s on %s without marking price_dirty",
                        normalized,
                        dt,
                    )
                    continue
            else:
                has_missing_data = True
                logger.warning("Skipping incomplete daily price row for %s on %s", normalized, dt)
                continue
        prices.append(
            {
                "date": row_date,
                **ohlc,
                "volume": int(row["Volume"]) if "Volume" in row and not pd.isna(row["Volume"]) else 0,
            }
        )
    if return_meta:
        return {"prices": prices, "has_missing_data": has_missing_data}
    return prices


def fetch_stock_intraday_history(symbol, interval="5m"):
    _require_yfinance()
    normalized = normalize_symbol(symbol)
    logger.info("Fetching intraday stock prices for %s interval=%s", normalized, interval)

    stock_data = yf.download(
        tickers=normalized,
        period="1d",
        interval=interval,
        group_by="column",
        auto_adjust=False,
        progress=False,
    )

    if stock_data is None or stock_data.empty:
        return []

    stock_data = _flatten_download_columns(stock_data)
    required = {"Open", "High", "Low", "Close"}
    if not required.issubset(set(stock_data.columns)):
        raise ValueError(f"missing required intraday columns for {normalized}: {list(stock_data.columns)}")

    prices = []
    for dt, row in stock_data.iterrows():
        ohlc = _parse_ohlc_row(row, ("Open", "High", "Low", "Close"))
        if ohlc is None:
            logger.warning("Skipping incomplete intraday price row for %s at %s", normalized, dt)
            continue
        timestamp = pd.to_datetime(dt)
        if timestamp.tzinfo is None:
            timestamp = timestamp.tz_localize(MARKET_TIMEZONE)
        else:
            timestamp = timestamp.tz_convert(MARKET_TIMEZONE)

        prices.append(
            {
                "timestamp": timestamp.to_pydatetime(),
                "trading_date": timestamp.date(),
                **ohlc,
                "volume": int(row["Volume"]) if "Volume" in row and not pd.isna(row["Volume"]) else 0,
                "provider": "yfinance",
            }
        )
    return prices

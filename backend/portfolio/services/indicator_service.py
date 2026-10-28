import pandas as pd

from portfolio.api.errors import NotFoundError, ValidationError
from portfolio.core.logging import get_logger
from portfolio.data.repositories import price_repository, stock_repository

logger = get_logger(__name__)


class IndicatorDefinition:
    def __init__(self, id, label, indicator_type, period, calculate_fn, latest_fn, series_format_fn=None):
        self.id = id
        self.label = label
        self.type = indicator_type  # "overlay", "overlay_bands", "oscillator"
        self.period = period
        self.calculate_fn = calculate_fn
        self.latest_fn = latest_fn
        self.series_format_fn = series_format_fn or _format_single_series

    def calculate_series(self, price_df):
        return self.calculate_fn(price_df)

    def calculate_latest(self, price_df, latest_close, series_data):
        return self.latest_fn(self, price_df, latest_close, series_data)

    def format_series_payload(self, price_df, series_data):
        return self.series_format_fn(price_df, series_data)

    def empty_payload(self):
        return {
            "label": self.label,
            "type": self.type,
            "period": self.period,
            "value": None,
            "status": "not_enough_data",
        }

    def empty_series_payload(self):
        if self.type == "overlay_bands":
            return {"upper": [], "middle": [], "lower": []}
        if self.id == "macd":
            return {"macd": [], "signal": [], "histogram": []}
        if self.id == "stoch14":
            return {"k": [], "d": []}
        if self.id == "obv":
            return {"obv": [], "sma20": []}
        return []


def _format_single_series(price_df, series_data):
    return _series_payload(price_df, series_data)


def _format_bands_series(price_df, series_data):
    return {
        "upper": _series_payload(price_df, series_data["upper"]),
        "middle": _series_payload(price_df, series_data["middle"]),
        "lower": _series_payload(price_df, series_data["lower"]),
    }


def _format_macd_series(price_df, series_data):
    return {
        "macd": _series_payload(price_df, series_data["macd"]),
        "signal": _series_payload(price_df, series_data["signal"]),
        "histogram": _series_payload(price_df, series_data["histogram"]),
    }


def _format_stoch_series(price_df, series_data):
    return {
        "k": _series_payload(price_df, series_data["k"]),
        "d": _series_payload(price_df, series_data["d"]),
    }


def _format_obv_series(price_df, series_data):
    return {
        "obv": _series_payload(price_df, series_data["obv"]),
        "sma20": _series_payload(price_df, series_data["sma20"]),
    }


# --- Calculation Implementations ---

def _moving_average_series(price_df, period):
    return price_df["Close"].rolling(window=period, min_periods=period).mean()


def _ema_series(price_df, period):
    return price_df["Close"].ewm(span=period, adjust=False, min_periods=period).mean()


def _bollinger_bands_series(price_df, period=20, std_dev=2.0):
    middle = price_df["Close"].rolling(window=period, min_periods=period).mean()
    std = price_df["Close"].rolling(window=period, min_periods=period).std()
    upper = middle + (std * std_dev)
    lower = middle - (std * std_dev)
    return {"upper": upper, "middle": middle, "lower": lower}


def _rsi_series(price_df, period=14):
    close = price_df["Close"]
    delta = close.diff()
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)
    average_gain = gains.rolling(window=period, min_periods=period).mean()
    average_loss = losses.rolling(window=period, min_periods=period).mean()
    relative_strength = average_gain / average_loss
    rsi = 100 - (100 / (1 + relative_strength))
    return rsi.where(average_loss != 0, 100.0)


def _macd_series(price_df, fast=12, slow=26, signal=9):
    close = price_df["Close"]
    ema_fast = close.ewm(span=fast, adjust=False, min_periods=fast).mean()
    ema_slow = close.ewm(span=slow, adjust=False, min_periods=slow).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    histogram = macd_line - signal_line
    return {"macd": macd_line, "signal": signal_line, "histogram": histogram}


def _atr_series(price_df, period=14):
    high = price_df["High"]
    low = price_df["Low"]
    prev_close = price_df["Close"].shift(1)
    tr0 = high - low
    tr1 = (high - prev_close).abs()
    tr2 = (low - prev_close).abs()
    tr = pd.concat([tr0, tr1, tr2], axis=1).max(axis=1)
    return tr.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()


def _stochastic_series(price_df, k_period=14, d_period=3, smooth_k=3):
    low_min = price_df["Low"].rolling(window=k_period, min_periods=k_period).min()
    high_max = price_df["High"].rolling(window=k_period, min_periods=k_period).max()
    diff = high_max - low_min
    fast_k = 100.0 * ((price_df["Close"] - low_min) / diff.replace(0, float("nan")))
    fast_k = fast_k.fillna(50.0)
    slow_k = fast_k.rolling(window=smooth_k, min_periods=smooth_k).mean()
    slow_d = slow_k.rolling(window=d_period, min_periods=d_period).mean()
    return {"k": slow_k, "d": slow_d}


def _obv_series(price_df):
    delta = price_df["Close"].diff()
    direction = pd.Series(0, index=price_df.index)
    direction[delta > 0] = 1
    direction[delta < 0] = -1
    volume = price_df["Volume"].fillna(0)
    obv = (direction * volume).cumsum()
    obv_sma = obv.rolling(window=20, min_periods=1).mean()
    return {"obv": obv, "sma20": obv_sma}


# --- Latest Payload Builders ---

def _latest_ema(definition, price_df, latest_close, series):
    val = _latest_valid_value(series)
    status = "not_enough_data" if val is None else ("price_above_ema" if latest_close >= val else "price_below_ema")
    return {
        "label": definition.label,
        "type": definition.type,
        "period": definition.period,
        "value": round(val, 2) if val is not None else None,
        "status": status,
    }


def _latest_ma(definition, price_df, latest_close, series):
    val = _latest_valid_value(series)
    status = _ma_status(latest_close, val)
    return {
        "label": definition.label,
        "type": definition.type,
        "period": definition.period,
        "value": round(val, 2) if val is not None else None,
        "status": status,
    }


def _latest_bb(definition, price_df, latest_close, series):
    u = _latest_valid_value(series["upper"])
    m = _latest_valid_value(series["middle"])
    l = _latest_valid_value(series["lower"])
    if u is None or m is None or l is None:
        return definition.empty_payload()

    bandwidth = (u - l) / m if m != 0 else 0
    percent_b = (latest_close - l) / (u - l) if (u - l) != 0 else 0.5

    if latest_close > u:
        status = "price_above_upper"
    elif latest_close < l:
        status = "price_below_lower"
    else:
        status = "inside_bands"

    return {
        "label": definition.label,
        "type": definition.type,
        "period": definition.period,
        "value": {
            "upper": round(u, 2),
            "middle": round(m, 2),
            "lower": round(l, 2),
            "percentB": round(percent_b, 2),
            "bandwidth": round(bandwidth, 4),
        },
        "status": status,
    }


def _latest_atr(definition, price_df, latest_close, series):
    val = _latest_valid_value(series)
    if val is None:
        return definition.empty_payload()
    atr_pct = (val / latest_close * 100.0) if latest_close > 0 else 0.0
    if atr_pct >= 4.0:
        status = "high_volatility"
    elif atr_pct <= 1.5:
        status = "low_volatility"
    else:
        status = "normal_volatility"
    return {
        "label": definition.label,
        "type": definition.type,
        "period": definition.period,
        "value": {
            "atr": round(val, 2),
            "atrPct": round(atr_pct, 2),
        },
        "status": status,
    }


def _latest_rsi(definition, price_df, latest_close, series):
    val = _latest_valid_value(series)
    return {
        "label": definition.label,
        "type": definition.type,
        "period": definition.period,
        "value": round(val, 2) if val is not None else None,
        "status": _rsi_status(val),
    }


def _latest_stoch(definition, price_df, latest_close, series):
    k_val = _latest_valid_value(series["k"])
    d_val = _latest_valid_value(series["d"])
    if k_val is None or d_val is None:
        return definition.empty_payload()

    valid_k = series["k"].dropna()
    valid_d = series["d"].dropna()
    status = "neutral"
    if len(valid_k) >= 2 and len(valid_d) >= 2:
        prev_k = valid_k.iloc[-2]
        prev_d = valid_d.iloc[-2]
        if prev_k <= prev_d and k_val > d_val:
            status = "bullish_crossover"
        elif prev_k >= prev_d and k_val < d_val:
            status = "bearish_crossover"
        elif k_val >= 80.0:
            status = "overbought"
        elif k_val <= 20.0:
            status = "oversold"
        elif k_val >= d_val:
            status = "bullish"
        else:
            status = "bearish"
    else:
        if k_val >= 80.0:
            status = "overbought"
        elif k_val <= 20.0:
            status = "oversold"
        else:
            status = "bullish" if k_val >= d_val else "bearish"

    return {
        "label": definition.label,
        "type": definition.type,
        "period": definition.period,
        "value": {
            "k": round(k_val, 1),
            "d": round(d_val, 1),
        },
        "status": status,
    }


def _latest_macd(definition, price_df, latest_close, series):
    m = _latest_valid_value(series["macd"])
    s = _latest_valid_value(series["signal"])
    h = _latest_valid_value(series["histogram"])
    if m is None or s is None or h is None:
        return definition.empty_payload()

    valid_h = series["histogram"].dropna()
    status = "neutral"
    if len(valid_h) >= 2:
        prev_h = valid_h.iloc[-2]
        if prev_h <= 0 and h > 0:
            status = "bullish_crossover"
        elif prev_h >= 0 and h < 0:
            status = "bearish_crossover"
        elif h > 0:
            status = "bullish"
        elif h < 0:
            status = "bearish"
    elif h > 0:
        status = "bullish"
    elif h < 0:
        status = "bearish"

    return {
        "label": definition.label,
        "type": definition.type,
        "period": definition.period,
        "value": {
            "macd": round(m, 2),
            "signal": round(s, 2),
            "histogram": round(h, 2),
        },
        "status": status,
    }


def _latest_obv(definition, price_df, latest_close, series):
    obv_val = _latest_valid_value(series["obv"])
    sma_val = _latest_valid_value(series["sma20"])
    if obv_val is None:
        return definition.empty_payload()

    status = "accumulation" if (sma_val is None or obv_val >= sma_val) else "distribution"
    return {
        "label": definition.label,
        "type": definition.type,
        "period": definition.period,
        "value": {
            "obv": int(obv_val),
            "sma20": int(sma_val) if sma_val is not None else None,
        },
        "status": status,
    }


# Declarative Indicator Registry
INDICATOR_REGISTRY = {
    "ema20": IndicatorDefinition(
        id="ema20",
        label="EMA-20",
        indicator_type="overlay",
        period=20,
        calculate_fn=lambda df: _ema_series(df, 20),
        latest_fn=_latest_ema,
    ),
    "ma50": IndicatorDefinition(
        id="ma50",
        label="MA-50",
        indicator_type="overlay",
        period=50,
        calculate_fn=lambda df: _moving_average_series(df, 50),
        latest_fn=_latest_ma,
    ),
    "ma200": IndicatorDefinition(
        id="ma200",
        label="MA-200",
        indicator_type="overlay",
        period=200,
        calculate_fn=lambda df: _moving_average_series(df, 200),
        latest_fn=_latest_ma,
    ),
    "bb20": IndicatorDefinition(
        id="bb20",
        label="Bollinger Bands (20, 2)",
        indicator_type="overlay_bands",
        period=20,
        calculate_fn=lambda df: _bollinger_bands_series(df, period=20, std_dev=2.0),
        latest_fn=_latest_bb,
        series_format_fn=_format_bands_series,
    ),
    "atr14": IndicatorDefinition(
        id="atr14",
        label="ATR-14",
        indicator_type="volatility",
        period=14,
        calculate_fn=lambda df: _atr_series(df, 14),
        latest_fn=_latest_atr,
    ),
    "rsi14": IndicatorDefinition(
        id="rsi14",
        label="RSI-14",
        indicator_type="oscillator",
        period=14,
        calculate_fn=lambda df: _rsi_series(df, 14),
        latest_fn=_latest_rsi,
    ),
    "stoch14": IndicatorDefinition(
        id="stoch14",
        label="Stochastic (14, 3, 3)",
        indicator_type="oscillator",
        period=14,
        calculate_fn=lambda df: _stochastic_series(df, k_period=14, d_period=3, smooth_k=3),
        latest_fn=_latest_stoch,
        series_format_fn=_format_stoch_series,
    ),
    "macd": IndicatorDefinition(
        id="macd",
        label="MACD (12, 26, 9)",
        indicator_type="oscillator",
        period=26,
        calculate_fn=lambda df: _macd_series(df, fast=12, slow=26, signal=9),
        latest_fn=_latest_macd,
        series_format_fn=_format_macd_series,
    ),
    "obv": IndicatorDefinition(
        id="obv",
        label="OBV",
        indicator_type="volume",
        period=20,
        calculate_fn=lambda df: _obv_series(df),
        latest_fn=_latest_obv,
        series_format_fn=_format_obv_series,
    ),
}

# --- In-Memory Indicator Caches ---
_CACHE_MAX_ENTRIES = 256
_INDICATORS_CACHE = {}
_INDICATOR_SERIES_CACHE = {}


def clear_indicator_cache(symbol=None):
    """Clear memory caches for indicator calculations."""
    global _INDICATORS_CACHE, _INDICATOR_SERIES_CACHE
    if symbol:
        norm = symbol.strip().upper()
        _INDICATORS_CACHE = {k: v for k, v in _INDICATORS_CACHE.items() if k[0] != norm}
        _INDICATOR_SERIES_CACHE = {k: v for k, v in _INDICATOR_SERIES_CACHE.items() if k[0] != norm}
    else:
        _INDICATORS_CACHE.clear()
        _INDICATOR_SERIES_CACHE.clear()


def _get_cache_key(normalized_symbol, prices):
    if not prices:
        return (normalized_symbol, None, None, 0)
    last_price = prices[-1]
    last_date = getattr(last_price, "date", None)
    last_close = round(float(getattr(last_price, "close", 0.0) or 0.0), 4)
    return (normalized_symbol, last_date, last_close, len(prices))


def _set_cache_entry(cache_dict, key, value):
    if len(cache_dict) >= _CACHE_MAX_ENTRIES:
        try:
            cache_dict.pop(next(iter(cache_dict)))
        except Exception:
            pass
    cache_dict[key] = value


# --- Public Service API ---

def calculate_indicators(symbol):
    normalized = _normalize_symbol(symbol)
    stock = stock_repository.get_stock_by_symbol(normalized)
    if not stock:
        raise NotFoundError(f"Stock not found: {normalized}")

    prices = price_repository.list_prices_for_stock_id(stock.id)
    cache_key = _get_cache_key(normalized, prices)
    if cache_key in _INDICATORS_CACHE:
        return _INDICATORS_CACHE[cache_key]

    logger.info("Calculating daily indicators for %s rows=%s", normalized, len(prices))

    if not prices:
        res = {
            "symbol": normalized,
            "asOfDate": None,
            "notEnoughData": True,
            "indicators": {
                ind_id: ind.empty_payload()
                for ind_id, ind in INDICATOR_REGISTRY.items()
            },
        }
        _set_cache_entry(_INDICATORS_CACHE, cache_key, res)
        return res

    price_df = _prices_to_dataframe(prices)
    latest_close = float(price_df["Close"].iloc[-1])
    as_of_date = pd.to_datetime(price_df["Date"].iloc[-1]).strftime("%Y-%m-%d")

    indicator_payloads = {}
    for ind_id, ind in INDICATOR_REGISTRY.items():
        series = ind.calculate_series(price_df)
        indicator_payloads[ind_id] = ind.calculate_latest(price_df, latest_close, series)

    res = {
        "symbol": normalized,
        "asOfDate": as_of_date,
        "notEnoughData": any(
            item["status"] == "not_enough_data"
            for item in indicator_payloads.values()
        ),
        "indicators": indicator_payloads,
    }
    _set_cache_entry(_INDICATORS_CACHE, cache_key, res)
    return res


def calculate_indicator_series(symbol):
    normalized = _normalize_symbol(symbol)
    stock = stock_repository.get_stock_by_symbol(normalized)
    if not stock:
        raise NotFoundError(f"Stock not found: {normalized}")

    prices = price_repository.list_prices_for_stock_id(stock.id)
    cache_key = _get_cache_key(normalized, prices)
    if cache_key in _INDICATOR_SERIES_CACHE:
        return _INDICATOR_SERIES_CACHE[cache_key]

    logger.info("Calculating daily indicator series for %s rows=%s", normalized, len(prices))

    if not prices:
        latest = calculate_indicators(normalized)
        res = {
            "symbol": normalized,
            "asOfDate": None,
            "series": {
                ind_id: ind.empty_series_payload()
                for ind_id, ind in INDICATOR_REGISTRY.items()
            },
            "latest": latest["indicators"],
        }
        _set_cache_entry(_INDICATOR_SERIES_CACHE, cache_key, res)
        return res

    price_df = _prices_to_dataframe(prices)
    latest_close = float(price_df["Close"].iloc[-1])
    as_of_date = pd.to_datetime(price_df["Date"].iloc[-1]).strftime("%Y-%m-%d")

    # Single-pass evaluation: compute series and latest indicators simultaneously
    indicator_payloads = {}
    series_payloads = {}
    for ind_id, ind in INDICATOR_REGISTRY.items():
        series_data = ind.calculate_series(price_df)
        indicator_payloads[ind_id] = ind.calculate_latest(price_df, latest_close, series_data)
        series_payloads[ind_id] = ind.format_series_payload(price_df, series_data)

    latest_payload = {
        "symbol": normalized,
        "asOfDate": as_of_date,
        "notEnoughData": any(
            item["status"] == "not_enough_data"
            for item in indicator_payloads.values()
        ),
        "indicators": indicator_payloads,
    }
    _set_cache_entry(_INDICATORS_CACHE, cache_key, latest_payload)

    res = {
        "symbol": normalized,
        "asOfDate": as_of_date,
        "series": series_payloads,
        "latest": indicator_payloads,
    }
    _set_cache_entry(_INDICATOR_SERIES_CACHE, cache_key, res)
    return res


# --- Helpers ---

def _prices_to_dataframe(prices):
    return pd.DataFrame(
        [
            {
                "Date": price.date,
                "Open": price.open,
                "High": price.high,
                "Low": price.low,
                "Close": price.close,
                "Volume": price.volume,
            }
            for price in prices
        ]
    ).sort_values("Date", ascending=True)


def _latest_valid_value(value_series):
    valid = value_series.dropna()
    if valid.empty:
        return None
    value = valid.iloc[-1]
    return None if pd.isna(value) else float(value)


def _series_payload(price_df, value_series):
    series = []
    for date_value, numeric_value in zip(price_df["Date"], value_series):
        if pd.isna(numeric_value):
            continue
        series.append(
            {
                "date": pd.to_datetime(date_value).strftime("%Y-%m-%d"),
                "value": round(float(numeric_value), 2),
            }
        )
    return series


def _ma_status(latest_close, value):
    if value is None:
        return "not_enough_data"
    return "price_above_ma" if latest_close >= value else "price_below_ma"


def _rsi_status(value):
    if value is None:
        return "not_enough_data"
    if value >= 70:
        return "overbought"
    if value <= 30:
        return "oversold"
    return "neutral"


def _normalize_symbol(symbol):
    normalized = (symbol or "").strip().upper()
    if not normalized:
        raise ValidationError("Stock symbol is required")
    return normalized


# --- Atomic Strategy Output Wrappers ---

def ma_to_atomic_output(price_df, period=50, strategy_id=None):
    """Converts a moving average into an AtomicStrategyOutput signal vector."""
    import numpy as np
    from portfolio.services.strategy_protocol import AtomicStrategyOutput

    strategy_id = strategy_id or f"ma{period}"
    close = price_df["Close"].values.astype(float)
    dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in price_df["Date"]]
    n = len(price_df)
    ma = pd.Series(close).rolling(window=period, min_periods=period).mean().values

    signals = np.zeros(n, dtype=int)
    confidence = np.zeros(n, dtype=float)

    for i in range(period - 1, n):
        if not np.isnan(ma[i]):
            diff_pct = abs(close[i] - ma[i]) / ma[i] if ma[i] > 0 else 0.0
            confidence[i] = min(1.0, 0.5 + diff_pct * 5.0)
            signals[i] = 1 if close[i] >= ma[i] else -1

    return AtomicStrategyOutput(
        strategy_id=strategy_id,
        dates=dates,
        signal_vector=signals,
        confidence=confidence,
        metadata={"period": period},
    )


def rsi_to_atomic_output(price_df, period=14, oversold=30, overbought=70, strategy_id=None):
    """Converts RSI indicator into an AtomicStrategyOutput signal vector."""
    import numpy as np
    from portfolio.services.strategy_protocol import AtomicStrategyOutput

    strategy_id = strategy_id or f"rsi{period}"
    dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in price_df["Date"]]
    n = len(price_df)
    rsi_vals = _rsi_series(price_df, period=period).values

    signals = np.zeros(n, dtype=int)
    confidence = np.zeros(n, dtype=float)

    for i in range(period, n):
        r = rsi_vals[i]
        if np.isnan(r):
            continue
        if r >= overbought:
            signals[i] = -1
            confidence[i] = 0.8
        elif r <= oversold:
            signals[i] = 1
            confidence[i] = 0.7
        elif r >= 50:
            signals[i] = 1
            confidence[i] = min(1.0, (r - 50) / 50.0 + 0.5)
        else:
            signals[i] = -1
            confidence[i] = 0.5

    return AtomicStrategyOutput(
        strategy_id=strategy_id,
        dates=dates,
        signal_vector=signals,
        confidence=confidence,
        metadata={"period": period, "oversold": oversold, "overbought": overbought},
    )


def supertrend_to_atomic_output(price_df, period=10, multiplier=3.0, strategy_id="supertrend"):
    """Converts Supertrend trailing bands into an AtomicStrategyOutput signal vector."""
    import numpy as np
    from portfolio.services.strategy_protocol import AtomicStrategyOutput

    high = price_df["High"].values.astype(float)
    low = price_df["Low"].values.astype(float)
    close = price_df["Close"].values.astype(float)
    dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in price_df["Date"]]
    n = len(price_df)

    if n < period:
        return AtomicStrategyOutput(
            strategy_id=strategy_id,
            dates=dates,
            signal_vector=np.zeros(n, dtype=int),
            confidence=np.zeros(n, dtype=float),
            metadata={"period": period, "multiplier": multiplier},
        )

    tr = np.zeros(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(
            high[i] - low[i],
            abs(high[i] - close[i - 1]),
            abs(low[i] - close[i - 1]),
        )

    atr_series = pd.Series(tr).rolling(window=period, min_periods=period).mean().values
    hl2 = (high + low) / 2.0
    basic_upper = hl2 + (multiplier * atr_series)
    basic_lower = hl2 - (multiplier * atr_series)

    upper_band = np.zeros(n)
    lower_band = np.zeros(n)
    trend = np.zeros(n, dtype=int)

    start_idx = period
    upper_band[start_idx - 1] = basic_upper[start_idx - 1]
    lower_band[start_idx - 1] = basic_lower[start_idx - 1]
    trend[start_idx - 1] = 1 if close[start_idx - 1] >= hl2[start_idx - 1] else -1

    for i in range(start_idx, n):
        if basic_lower[i] > lower_band[i - 1] or close[i - 1] < lower_band[i - 1]:
            lower_band[i] = basic_lower[i]
        else:
            lower_band[i] = lower_band[i - 1]

        if basic_upper[i] < upper_band[i - 1] or close[i - 1] > upper_band[i - 1]:
            upper_band[i] = basic_upper[i]
        else:
            upper_band[i] = upper_band[i - 1]

        prev_trend = trend[i - 1]
        if prev_trend == 1:
            trend[i] = -1 if close[i] < lower_band[i] else 1
        else:
            trend[i] = 1 if close[i] > upper_band[i] else -1

    confidence = np.full(n, 0.8, dtype=float)
    confidence[:start_idx] = 0.0

    return AtomicStrategyOutput(
        strategy_id=strategy_id,
        dates=dates,
        signal_vector=trend,
        confidence=confidence,
        metadata={
            "period": period,
            "multiplier": multiplier,
            "upper_band": upper_band,
            "lower_band": lower_band,
        },
    )


def ema_to_atomic_output(price_df, period=20, strategy_id=None):
    """Converts EMA into an AtomicStrategyOutput signal vector."""
    import numpy as np
    from portfolio.services.strategy_protocol import AtomicStrategyOutput

    strategy_id = strategy_id or f"ema{period}"
    close = price_df["Close"].values.astype(float)
    dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in price_df["Date"]]
    n = len(price_df)
    ema = _ema_series(price_df, period=period).values

    signals = np.zeros(n, dtype=int)
    confidence = np.zeros(n, dtype=float)

    for i in range(period - 1, n):
        if not np.isnan(ema[i]):
            diff_pct = abs(close[i] - ema[i]) / ema[i] if ema[i] > 0 else 0.0
            confidence[i] = min(1.0, 0.5 + diff_pct * 5.0)
            signals[i] = 1 if close[i] >= ema[i] else -1

    return AtomicStrategyOutput(
        strategy_id=strategy_id,
        dates=dates,
        signal_vector=signals,
        confidence=confidence,
        metadata={"period": period},
    )


def macd_to_atomic_output(price_df, fast=12, slow=26, signal=9, strategy_id="macd"):
    """Converts MACD histogram crossovers into an AtomicStrategyOutput signal vector."""
    import numpy as np
    from portfolio.services.strategy_protocol import AtomicStrategyOutput

    dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in price_df["Date"]]
    n = len(price_df)
    res = _macd_series(price_df, fast=fast, slow=slow, signal=signal)
    hist = res["histogram"].values

    signals = np.zeros(n, dtype=int)
    confidence = np.zeros(n, dtype=float)

    for i in range(slow, n):
        h = hist[i]
        if not np.isnan(h):
            signals[i] = 1 if h >= 0 else -1
            confidence[i] = 0.8 if abs(h) > 0.5 else 0.6

    return AtomicStrategyOutput(
        strategy_id=strategy_id,
        dates=dates,
        signal_vector=signals,
        confidence=confidence,
        metadata={"fast": fast, "slow": slow, "signal": signal},
    )


def bb_to_atomic_output(price_df, period=20, std_dev=2.0, strategy_id="bb20"):
    """Converts Bollinger Bands into an AtomicStrategyOutput signal vector."""
    import numpy as np
    from portfolio.services.strategy_protocol import AtomicStrategyOutput

    close = price_df["Close"].values.astype(float)
    dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in price_df["Date"]]
    n = len(price_df)
    bands = _bollinger_bands_series(price_df, period=period, std_dev=std_dev)
    u = bands["upper"].values
    m = bands["middle"].values
    l = bands["lower"].values

    signals = np.zeros(n, dtype=int)
    confidence = np.zeros(n, dtype=float)
    in_pos = False

    for i in range(period, n):
        if not np.isnan(u[i]) and not np.isnan(l[i]):
            c = close[i]
            if c <= l[i]:
                in_pos = True
                signals[i] = 1  # Dip buy rebound
                confidence[i] = 0.85
            elif c >= u[i]:
                in_pos = False
                signals[i] = -1  # Overbought exit / take profit
                confidence[i] = 0.85
            else:
                signals[i] = 1 if in_pos else 0
                confidence[i] = 0.6 if in_pos else 0.5

    return AtomicStrategyOutput(
        strategy_id=strategy_id,
        dates=dates,
        signal_vector=signals,
        confidence=confidence,
        metadata={"period": period, "std_dev": std_dev},
    )


def indicator_to_atomic_output(price_df, indicator_id, **params):
    """Factory helper to convert any standard indicator into an AtomicStrategyOutput."""
    norm_id = (indicator_id or "").lower()
    if norm_id in ("supertrend", "st"):
        return supertrend_to_atomic_output(
            price_df,
            period=params.get("period", 10),
            multiplier=params.get("multiplier", 3.0),
            strategy_id=indicator_id,
        )
    elif norm_id in ("trend_runner", "tr", "bull_runner"):
        return trend_runner_to_atomic_output(
            price_df,
            atr_period=params.get("atr_period", 14),
            multiplier=params.get("multiplier", 3.0),
            trend_ma=params.get("trend_ma", 50),
            strategy_id=indicator_id,
        )
    elif norm_id.startswith("ema") or norm_id == "ema20":
        period = params.get("period", 20)
        return ema_to_atomic_output(price_df, period=period, strategy_id=indicator_id)
    elif norm_id.startswith("ma") or norm_id in ("ma50", "ma200", "sma"):
        period = params.get("period")
        if not period:
            period = 200 if norm_id == "ma200" else 50
        return ma_to_atomic_output(price_df, period=period, strategy_id=indicator_id)
    elif norm_id.startswith("rsi") or norm_id == "rsi14":
        period = params.get("period", 14)
        return rsi_to_atomic_output(price_df, period=period, strategy_id=indicator_id)
    elif norm_id.startswith("macd"):
        return macd_to_atomic_output(price_df, strategy_id=indicator_id)
    elif norm_id.startswith("bb") or norm_id == "bb20":
        return bb_to_atomic_output(price_df, strategy_id=indicator_id)
    elif norm_id.startswith("stoch") or norm_id == "stoch14":
        return stoch_to_atomic_output(price_df, strategy_id=indicator_id)
    elif norm_id.startswith("obv"):
        return obv_to_atomic_output(price_df, strategy_id=indicator_id)
    else:
        from portfolio.services.simulation_service import _strategy_resolver
        if _strategy_resolver:
            strat = _strategy_resolver(indicator_id)
            if strat:
                return strat.to_atomic_output(price_df, context=params)
        return ma_to_atomic_output(price_df, period=50, strategy_id=indicator_id)


def stoch_to_atomic_output(price_df, k_period=14, d_period=3, smooth_k=3, strategy_id="stoch14"):
    """Converts Stochastic Oscillator (14, 3, 3) into an AtomicStrategyOutput signal vector."""
    import numpy as np
    from portfolio.services.strategy_protocol import AtomicStrategyOutput

    strategy_id = strategy_id or "stoch14"
    dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in price_df["Date"]]
    n = len(price_df)
    res = _stochastic_series(price_df, k_period=k_period, d_period=d_period, smooth_k=smooth_k)
    k_vals = res["k"].values
    d_vals = res["d"].values

    signals = np.zeros(n, dtype=int)
    confidence = np.zeros(n, dtype=float)

    in_pos = False
    warmup = k_period + smooth_k + d_period
    for i in range(warmup, n):
        k = k_vals[i]
        d = d_vals[i]
        if np.isnan(k) or np.isnan(d):
            continue
        prev_k = k_vals[i - 1]
        prev_d = d_vals[i - 1]
        if k <= 20.0 or (k >= d and prev_k < prev_d and k < 50.0):
            in_pos = True
            signals[i] = 1
            confidence[i] = 0.85
        elif k >= 80.0 or (k <= d and prev_k > prev_d and k > 50.0):
            in_pos = False
            signals[i] = -1
            confidence[i] = 0.85
        else:
            signals[i] = 1 if in_pos else 0
            confidence[i] = 0.6 if in_pos else 0.5

    return AtomicStrategyOutput(
        strategy_id=strategy_id,
        dates=dates,
        signal_vector=signals,
        confidence=confidence,
        metadata={"k_period": k_period, "d_period": d_period, "smooth_k": smooth_k},
    )


def obv_to_atomic_output(price_df, strategy_id="obv"):
    """Converts On-Balance Volume against its 20-day SMA into an AtomicStrategyOutput signal vector."""
    import numpy as np
    from portfolio.services.strategy_protocol import AtomicStrategyOutput

    strategy_id = strategy_id or "obv"
    dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in price_df["Date"]]
    n = len(price_df)
    res = _obv_series(price_df)
    obv_vals = res["obv"].values
    sma_vals = res["sma20"].values

    signals = np.zeros(n, dtype=int)
    confidence = np.zeros(n, dtype=float)

    for i in range(20, n):
        o = obv_vals[i]
        s = sma_vals[i]
        if np.isnan(o) or np.isnan(s):
            continue
        if o >= s:
            signals[i] = 1
            confidence[i] = 0.75
        else:
            signals[i] = -1
            confidence[i] = 0.75

    return AtomicStrategyOutput(
        strategy_id=strategy_id,
        dates=dates,
        signal_vector=signals,
        confidence=confidence,
        metadata={"period": 20},
    )


def trend_runner_to_atomic_output(
    price_df,
    atr_period=14,
    multiplier=3.0,
    trend_ma=50,
    strategy_id="trend_runner",
):
    """Converts Bull-Market Trend Runner with Asymmetric ATR Chandelier Trailing Stop into AtomicStrategyOutput.

    Rules:
      - Entry: Price closes above trend_ma (MA-50) with short-term momentum (Close >= EMA-20).
      - Trailing Ratchet: When in position, dynamic trailing stop sits multiplier * ATR below the highest high since entry.
        The stop can only ratchet UP, never down.
      - Asymmetric Holding: Zero premature oscillator profit-taking. Stays 100% invested through healthy bull-market pullbacks.
      - Exit: Only exits when Close breaches below the trailing stop.
    """
    import numpy as np
    import pandas as pd
    from portfolio.services.strategy_protocol import AtomicStrategyOutput

    strategy_id = strategy_id or "trend_runner"
    dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in price_df["Date"]]
    n = len(price_df)

    if n < max(trend_ma, atr_period) + 5:
        return AtomicStrategyOutput(
            strategy_id=strategy_id,
            dates=dates,
            signal_vector=np.zeros(n, dtype=int),
            confidence=np.zeros(n, dtype=float),
            metadata={"atr_period": atr_period, "multiplier": multiplier, "trend_ma": trend_ma},
        )

    high = price_df["High"].values.astype(float)
    low = price_df["Low"].values.astype(float)
    close = price_df["Close"].values.astype(float)

    # 1. 50-day Simple Moving Average
    ma_series = pd.Series(close).rolling(window=trend_ma, min_periods=trend_ma).mean().values

    # 2. 20-day Exponential Moving Average
    ema_series = pd.Series(close).ewm(span=20, adjust=False).mean().values

    # 3. 14-day Average True Range (ATR)
    tr = np.zeros(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(
            high[i] - low[i],
            abs(high[i] - close[i - 1]),
            abs(low[i] - close[i - 1]),
        )
    atr_series = pd.Series(tr).rolling(window=atr_period, min_periods=atr_period).mean().values

    signals = np.zeros(n, dtype=int)
    confidence = np.zeros(n, dtype=float)

    in_pos = False
    highest_high = 0.0
    trailing_stop = 0.0
    start_idx = max(trend_ma, atr_period)

    for i in range(start_idx, n):
        p = close[i]
        h = high[i]
        ma = ma_series[i]
        ema = ema_series[i]
        atr = atr_series[i]

        if np.isnan(ma) or np.isnan(atr):
            continue

        if not in_pos:
            # Bullish Entry: Above MA-50 baseline and holding above EMA-20
            if p >= ma and p >= ema:
                in_pos = True
                highest_high = h
                trailing_stop = highest_high - (multiplier * atr)
                signals[i] = 1
                confidence[i] = 0.85
            else:
                signals[i] = 0
                confidence[i] = 0.5
        else:
            # In position: update peak and ratchet trailing stop UP
            if h > highest_high:
                highest_high = h
            current_stop_calc = highest_high - (multiplier * atr)
            trailing_stop = max(trailing_stop, current_stop_calc)

            # Exit ONLY on structural trailing stop breach
            if p < trailing_stop:
                in_pos = False
                signals[i] = -1  # Structural exit
                confidence[i] = 0.85
            else:
                signals[i] = 1   # Hold through all non-breaking pullbacks
                # Higher confidence the stronger the profit cushion
                cushion_pct = (p - trailing_stop) / p if p > 0 else 0.0
                confidence[i] = min(0.95, 0.70 + cushion_pct)

    return AtomicStrategyOutput(
        strategy_id=strategy_id,
        dates=dates,
        signal_vector=signals,
        confidence=confidence,
        metadata={
            "atr_period": atr_period,
            "multiplier": multiplier,
            "trend_ma": trend_ma,
        },
    )




"""Fundamental & Catalyst Data Ingestion and Retrieval Service (Earnings & Dividends)."""

from datetime import date, datetime, timedelta, timezone
import itertools
import queue
import random
import threading
import time
from typing import Any, Dict, List, Optional, Set, Tuple
import warnings

import pandas as pd

from portfolio.core.logging import get_logger, suppress_yfinance_warnings
from portfolio.data.db import _ensure_fundamentals_schema, db
from portfolio.services.stock_data_service import ensure_yfinance_session

suppress_yfinance_warnings()

try:
    import yfinance as yf
    suppress_yfinance_warnings()
except ModuleNotFoundError:
    yf = None

logger = get_logger(__name__)

TTL_HOURS = 12

_ENSURED_ENGINES: Set[str] = set()
_ENSURED_LOCK = threading.Lock()


class FundamentalRateLimitError(Exception):
    """Raised when Yahoo Finance returns HTTP 429 rate-limit or an empty payload."""


def _is_rate_limit_exception(exc: Exception) -> bool:
    msg = f"{type(exc).__name__}: {exc}".lower()
    return any(
        token in msg
        for token in ("429", "too many requests", "rate limit", "ratelimit", "yfratelimiterror")
    )


def _ensure_schema_once(engine_or_conn: Any) -> None:
    key = str(getattr(engine_or_conn, "url", None) or id(engine_or_conn))
    if key in _ENSURED_ENGINES:
        try:
            if hasattr(engine_or_conn, "dialect"):
                from sqlalchemy import inspect
                inspector = inspect(engine_or_conn)
                if inspector.has_table("stock_fundamentals"):
                    return
            else:
                has_tbl = _exec_sql(
                    engine_or_conn,
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'stock_fundamentals'",
                ).fetchone()
                if has_tbl:
                    return
        except Exception:
            pass
    _ensure_fundamentals_schema(engine_or_conn)
    with _ENSURED_LOCK:
        _ENSURED_ENGINES.add(key)


def _safe_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, dict):
        if "raw" in val and val["raw"] is not None:
            return _safe_float(val["raw"])
        if "fmt" in val and val["fmt"] is not None:
            return _safe_float(str(val["fmt"]).replace("%", "").replace(",", ""))
        return None
    try:
        if pd.isna(val):
            return None
        num = float(val)
        if pd.isna(num):
            return None
        return num
    except (TypeError, ValueError):
        return None


def _parse_date(val: Any) -> Optional[date]:
    if val is None:
        return None
    if isinstance(val, dict):
        if "raw" in val and val["raw"] is not None:
            return _parse_date(val["raw"])
        if "fmt" in val and val["fmt"] is not None:
            return _parse_date(val["fmt"])
        return None
    if isinstance(val, (list, tuple, pd.Series, pd.Index)):
        if len(val) == 0:
            return None
        # Prefer the first upcoming date if multiple dates are provided, otherwise first item
        parsed_dates = [d for item in val if (d := _parse_date(item)) is not None]
        if not parsed_dates:
            return None
        today = date.today()
        upcoming = [d for d in parsed_dates if d >= today]
        return upcoming[0] if upcoming else parsed_dates[0]
    try:
        if pd.isna(val):
            return None
    except Exception:
        pass
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if isinstance(val, pd.Timestamp):
        return val.date()
    if isinstance(val, (int, float)):
        if val > 10000:
            try:
                return datetime.fromtimestamp(float(val), tz=timezone.utc).date()
            except Exception:
                return None
        return None
    if isinstance(val, str):
        cleaned = val.strip()
        if not cleaned:
            return None
        try:
            return date.fromisoformat(cleaned[:10])
        except ValueError:
            try:
                return pd.to_datetime(cleaned).date()
            except Exception:
                return None
    return None


def _merge_earnings_row(
    earnings_rows: List[Dict[str, Any]],
    e_date: date,
    eps_est: Optional[float],
    eps_rep: Optional[float],
    surp: Optional[float],
) -> None:
    """Insert or merge an earnings history row, deduplicating entries within ±2 days."""
    if eps_rep is None and eps_est is None and surp is None:
        return

    est_rounded = round(eps_est, 4) if eps_est is not None else None
    rep_rounded = round(eps_rep, 4) if eps_rep is not None else None
    surp_rounded = round(surp, 4) if surp is not None else None
    iso_d = e_date.isoformat()

    for existing in earnings_rows:
        try:
            ex_d = date.fromisoformat(existing["earnings_date"][:10])
        except Exception:
            continue
        if abs((ex_d - e_date).days) <= 2:
            if existing.get("eps_estimate") is None and est_rounded is not None:
                existing["eps_estimate"] = est_rounded
            if existing.get("eps_reported") is None and rep_rounded is not None:
                existing["eps_reported"] = rep_rounded
            if existing.get("surprise_pct") is None and surp_rounded is not None:
                existing["surprise_pct"] = surp_rounded
            return

    earnings_rows.append(
        {
            "earnings_date": iso_d,
            "eps_estimate": est_rounded,
            "eps_reported": rep_rounded,
            "surprise_pct": surp_rounded,
        }
    )


def _parse_timestamp(val: Any) -> Optional[datetime]:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.replace(tzinfo=None) if val.tzinfo else val
    if isinstance(val, str):
        cleaned = val.strip()
        if not cleaned:
            return None
        try:
            dt = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except ValueError:
            try:
                dt = pd.to_datetime(cleaned).to_pydatetime()
                return dt.replace(tzinfo=None) if dt.tzinfo else dt
            except Exception:
                return None
    return None


def _exec_sql(conn: Any, sql: str, params: tuple = ()):
    """Execute raw SQL across SQLAlchemy Connection, Engine, or sqlite3.Connection."""
    target = conn
    is_pg = False
    dialect = getattr(conn, "dialect", None) or getattr(getattr(conn, "engine", None), "dialect", None)
    if dialect is not None and getattr(dialect, "name", "") != "sqlite":
        is_pg = True
    exec_sql = sql.replace("?", "%s") if (is_pg and params) else sql

    if hasattr(target, "exec_driver_sql"):
        return target.exec_driver_sql(exec_sql, params)
    if hasattr(target, "begin") and callable(target.begin):
        with target.begin() as active_conn:
            return active_conn.exec_driver_sql(exec_sql, params)
    return target.execute(sql, params)


class FundamentalService:
    """Service for ingesting, caching, and querying corporate earnings & dividend fundamentals."""

    TTL_HOURS = TTL_HOURS

    @staticmethod
    def _get_cache_state(symbol: str, conn: Any) -> Tuple[bool, bool]:
        """Return (record_exists, is_fresh_within_ttl) for symbol in stock_fundamentals."""
        try:
            row = _exec_sql(
                conn,
                "SELECT updated_at FROM stock_fundamentals WHERE symbol = ?",
                (symbol,),
            ).fetchone()
            if not row:
                return False, False
            if not row[0]:
                return True, False
            updated_at = _parse_timestamp(row[0])
            if not updated_at:
                return True, False
            age = datetime.utcnow() - updated_at
            if age >= timedelta(hours=TTL_HOURS):
                return True, False
            if updated_at < datetime(2026, 10, 21, 2, 15, 0):
                max_ed_row = _exec_sql(
                    conn,
                    "SELECT MAX(earnings_date) FROM stock_earnings_history WHERE symbol = ?",
                    (symbol,),
                ).fetchone()
                if max_ed_row and max_ed_row[0] and str(max_ed_row[0])[:10] < "2025-08-01":
                    return True, False
            return True, True
        except Exception as exc:
            logger.debug("TTL check error for %s: %s", symbol, exc)
            return False, False

    @staticmethod
    def _is_cache_fresh(symbol: str, conn: Any) -> bool:
        _, is_fresh = FundamentalService._get_cache_state(symbol, conn)
        return is_fresh

    @staticmethod
    def fetch_and_store_fundamentals(
        symbol: str,
        conn: Any = None,
        force: bool = False,
        raise_on_rate_limit: bool = False,
    ) -> Dict[str, Any]:
        """
        Fetch earnings calendar, historical EPS surprises, dividend history, and dividend metrics
        from yfinance and upsert into SQLite with a 12-hour TTL cache check.
        """
        normalized = (symbol or "").strip().upper()
        if not normalized:
            raise ValueError("Stock symbol is required")

        if conn is None:
            master_engine = db.engines.get("master", db.engine)
            _ensure_schema_once(master_engine)
            with master_engine.begin() as active_conn:
                return FundamentalService._fetch_and_store_with_conn(
                    normalized,
                    active_conn,
                    force=force,
                    raise_on_rate_limit=raise_on_rate_limit,
                )

        # If an Engine was passed instead of a Connection
        if hasattr(conn, "begin") and callable(conn.begin) and not hasattr(conn, "exec_driver_sql"):
            _ensure_schema_once(conn)
            with conn.begin() as active_conn:
                return FundamentalService._fetch_and_store_with_conn(
                    normalized,
                    active_conn,
                    force=force,
                    raise_on_rate_limit=raise_on_rate_limit,
                )

        _ensure_schema_once(conn)
        result = FundamentalService._fetch_and_store_with_conn(
            normalized,
            conn,
            force=force,
            raise_on_rate_limit=raise_on_rate_limit,
        )
        if hasattr(conn, "commit") and not hasattr(conn, "exec_driver_sql"):
            conn.commit()
        return result

    @staticmethod
    def _fetch_and_store_with_conn(
        symbol: str,
        conn: Any,
        force: bool = False,
        raise_on_rate_limit: bool = False,
    ) -> Dict[str, Any]:
        if not force and FundamentalService._is_cache_fresh(symbol, conn):
            logger.debug("Using cached fundamentals for %s (< %dh old)", symbol, TTL_HOURS)
            return FundamentalService.get_fundamentals_from_db(symbol, conn)

        if yf is None:
            logger.warning("yfinance not available; returning stored fundamentals for %s", symbol)
            return FundamentalService.get_fundamentals_from_db(symbol, conn)

        try:
            ensure_yfinance_session()
        except Exception as exc:
            logger.debug("yfinance session init skipped: %s", exc)

        next_earnings_date: Optional[date] = None
        earnings_avg_est: Optional[float] = None
        ex_dividend_date: Optional[date] = None
        dividend_rate: Optional[float] = None
        dividend_yield: Optional[float] = None
        payout_ratio: Optional[float] = None
        five_year_avg_yield: Optional[float] = None
        earnings_rows: List[Dict[str, Any]] = []
        dividend_rows: List[Dict[str, Any]] = []
        rate_limit_exc: Optional[Exception] = None
        got_any_payload: bool = False

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                ticker = yf.Ticker(symbol)

                # 1. Extract calendar (Earnings Date, Earnings Average, Ex-Dividend Date)
                try:
                    cal = ticker.calendar
                    if isinstance(cal, dict) and len(cal) > 0:
                        got_any_payload = True
                        next_earnings_date = _parse_date(
                            cal.get("Earnings Date")
                            if "Earnings Date" in cal
                            else cal.get("earningsDate")
                        )
                        earnings_avg_est = _safe_float(
                            cal.get("Earnings Average")
                            if "Earnings Average" in cal
                            else cal.get("earningsAverage")
                        )
                        ex_dividend_date = _parse_date(
                            cal.get("Ex-Dividend Date")
                            if "Ex-Dividend Date" in cal
                            else cal.get("exDividendDate")
                        )
                    elif isinstance(cal, pd.DataFrame) and not cal.empty:
                        got_any_payload = True
                        if "Earnings Date" in cal.index:
                            next_earnings_date = _parse_date(cal.loc["Earnings Date"].values)
                        elif "Earnings Date" in cal.columns:
                            next_earnings_date = _parse_date(cal["Earnings Date"].values)
                        if "Earnings Average" in cal.index:
                            vals = cal.loc["Earnings Average"].values
                            earnings_avg_est = _safe_float(vals[0] if len(vals) else None)
                        elif "Earnings Average" in cal.columns:
                            vals = cal["Earnings Average"].values
                            earnings_avg_est = _safe_float(vals[0] if len(vals) else None)
                        if "Ex-Dividend Date" in cal.index:
                            ex_dividend_date = _parse_date(cal.loc["Ex-Dividend Date"].values)
                        elif "Ex-Dividend Date" in cal.columns:
                            ex_dividend_date = _parse_date(cal["Ex-Dividend Date"].values)
                except Exception as exc:
                    if _is_rate_limit_exception(exc):
                        rate_limit_exc = exc
                    logger.debug("Failed to extract calendar for %s: %s", symbol, exc)

                # 2. Extract get_earnings_dates(limit=12)
                try:
                    ed_df = ticker.get_earnings_dates(limit=12)
                    if isinstance(ed_df, pd.DataFrame) and not ed_df.empty:
                        got_any_payload = True
                        for idx, row in ed_df.head(12).iterrows():
                            raw_d = (
                                row.get("Earnings Date")
                                if "Earnings Date" in row
                                else (row.get("date") if "date" in row else idx)
                            )
                            e_date = _parse_date(raw_d)
                            if not e_date:
                                continue
                            eps_est = _safe_float(
                                row.get("EPS Estimate")
                                if "EPS Estimate" in row
                                else row.get("eps_estimate")
                            )
                            eps_rep = _safe_float(
                                row.get("Reported EPS")
                                if "Reported EPS" in row
                                else row.get("eps_reported")
                            )
                            surp = _safe_float(
                                row.get("Surprise(%)")
                                if "Surprise(%)" in row
                                else (
                                    row.get("Surprise (%)")
                                    if "Surprise (%)" in row
                                    else row.get("surprise_pct")
                                )
                            )
                            if eps_rep is None and next_earnings_date is None and e_date >= date.today():
                                next_earnings_date = e_date
                                if earnings_avg_est is None and eps_est is not None:
                                    earnings_avg_est = eps_est

                            # Record historical or scheduled earnings row
                            _merge_earnings_row(earnings_rows, e_date, eps_est, eps_rep, surp)
                except Exception as exc:
                    if _is_rate_limit_exception(exc):
                        rate_limit_exc = exc
                    logger.debug("Failed to extract earnings_dates for %s: %s", symbol, exc)

                # 2b. Supplement with quoteSummary earningsChart + calendarEvents (captures recent quarters
                # and same-day releases when Yahoo's /v1/finance/visualization endpoint lags behind)
                try:
                    quote_obj = getattr(ticker, "_quote", None)
                    if quote_obj is not None and hasattr(quote_obj, "_fetch") and callable(quote_obj._fetch):
                        qs_res = quote_obj._fetch(modules=["earnings", "calendarEvents"])
                        if isinstance(qs_res, dict):
                            qs_list = (qs_res.get("quoteSummary") or {}).get("result")
                            if isinstance(qs_list, list) and len(qs_list) > 0 and isinstance(qs_list[0], dict):
                                qs_data = qs_list[0]
                                cal_events = qs_data.get("calendarEvents")
                                if isinstance(cal_events, dict):
                                    got_any_payload = True
                                    cal_earn = cal_events.get("earnings")
                                    if isinstance(cal_earn, dict):
                                        if next_earnings_date is None:
                                            next_earnings_date = _parse_date(
                                                cal_earn.get("earningsDate") or cal_earn.get("earningsCallDate")
                                            )
                                        if earnings_avg_est is None:
                                            earnings_avg_est = _safe_float(cal_earn.get("earningsAverage"))
                                    if ex_dividend_date is None:
                                        ex_dividend_date = _parse_date(cal_events.get("exDividendDate"))

                                earnings_mod = qs_data.get("earnings")
                                if isinstance(earnings_mod, dict):
                                    got_any_payload = True
                                    e_chart = earnings_mod.get("earningsChart")
                                    if isinstance(e_chart, dict):
                                        quarterly_items = e_chart.get("quarterly")
                                        seen_quarters: Set[str] = set()
                                        if isinstance(quarterly_items, list):
                                            for q_item in quarterly_items:
                                                if not isinstance(q_item, dict):
                                                    continue
                                                q_label = (
                                                    q_item.get("calendarQuarter")
                                                    or q_item.get("fiscalQuarter")
                                                    or q_item.get("date")
                                                )
                                                if isinstance(q_label, str) and q_label:
                                                    seen_quarters.add(q_label)
                                                rep_d = _parse_date(q_item.get("reportedDate"))
                                                if not rep_d:
                                                    continue
                                                q_rep = _safe_float(q_item.get("actual"))
                                                q_est = _safe_float(q_item.get("estimate"))
                                                q_surp = _safe_float(q_item.get("surprisePct"))
                                                if (
                                                    q_surp is None
                                                    and q_rep is not None
                                                    and q_est is not None
                                                    and q_est != 0
                                                ):
                                                    q_surp = ((q_rep - q_est) / abs(q_est)) * 100.0
                                                _merge_earnings_row(earnings_rows, rep_d, q_est, q_rep, q_surp)

                                        cur_actual = _safe_float(e_chart.get("currentQuarterActual"))
                                        cur_est = _safe_float(e_chart.get("currentQuarterEstimate"))
                                        cur_qtr = (
                                            e_chart.get("currentCalendarQuarter")
                                            or e_chart.get("currentFiscalQuarter")
                                        )
                                        if cur_actual is not None and (
                                            not cur_qtr or cur_qtr not in seen_quarters
                                        ):
                                            cur_date = (
                                                _parse_date(e_chart.get("earningsDate"))
                                                or next_earnings_date
                                            )
                                            if cur_date and cur_date <= date.today() + timedelta(days=1):
                                                if cur_est is None:
                                                    cur_est = earnings_avg_est
                                                cur_surp = (
                                                    ((cur_actual - cur_est) / abs(cur_est)) * 100.0
                                                    if (cur_est is not None and cur_est != 0)
                                                    else None
                                                )
                                                _merge_earnings_row(
                                                    earnings_rows, cur_date, cur_est, cur_actual, cur_surp
                                                )
                except Exception as exc:
                    if _is_rate_limit_exception(exc):
                        rate_limit_exc = exc
                    logger.debug("Failed to extract quoteSummary earningsChart for %s: %s", symbol, exc)

                # 3. Extract dividends.tail(12)
                try:
                    divs = ticker.dividends
                    if divs is not None and len(divs) > 0:
                        got_any_payload = True
                        tail_divs = divs.tail(12) if hasattr(divs, "tail") else divs
                        if hasattr(tail_divs, "items"):
                            for idx, val in tail_divs.items():
                                d_date = _parse_date(idx)
                                amt = _safe_float(val)
                                if d_date and amt is not None and amt > 0:
                                    dividend_rows.append(
                                        {
                                            "ex_date": d_date.isoformat(),
                                            "cash_amount": round(amt, 4),
                                        }
                                    )
                except Exception as exc:
                    if _is_rate_limit_exception(exc):
                        rate_limit_exc = exc
                    logger.debug("Failed to extract dividends for %s: %s", symbol, exc)

                # 4. Extract info
                try:
                    info = ticker.info or {}
                    if isinstance(info, dict) and len(info) > 0:
                        got_any_payload = True
                        dividend_rate = _safe_float(info.get("dividendRate"))
                        raw_yield = _safe_float(info.get("dividendYield"))
                        if raw_yield is not None:
                            # Normalize if yfinance returned percentage instead of decimal
                            ref_price = _safe_float(
                                info.get("currentPrice")
                                or info.get("regularMarketPrice")
                                or info.get("previousClose")
                            )
                            if dividend_rate and ref_price and ref_price > 0:
                                expected_dec = dividend_rate / ref_price
                                if raw_yield > expected_dec * 20 and raw_yield > 0.15:
                                    raw_yield = raw_yield / 100.0
                            elif raw_yield > 0.50:
                                raw_yield = raw_yield / 100.0
                            dividend_yield = raw_yield

                        payout_ratio = _safe_float(info.get("payoutRatio"))
                        info_ex_div = _parse_date(info.get("exDividendDate"))
                        if info_ex_div:
                            ex_dividend_date = info_ex_div
                        five_year_avg_yield = _safe_float(info.get("fiveYearAvgDividendYield"))

                        if next_earnings_date is None:
                            ts_date = _parse_date(
                                info.get("earningsTimestamp") or info.get("earningsTimestampStart")
                            )
                            if ts_date:
                                next_earnings_date = ts_date
                except Exception as exc:
                    if _is_rate_limit_exception(exc):
                        rate_limit_exc = exc
                    logger.debug("Failed to extract ticker.info for %s: %s", symbol, exc)

        except Exception as exc:
            if _is_rate_limit_exception(exc):
                rate_limit_exc = exc
            if raise_on_rate_limit and rate_limit_exc is not None:
                raise FundamentalRateLimitError(str(rate_limit_exc)) from rate_limit_exc
            logger.warning("Failed to fetch yfinance fundamentals for %s: %s", symbol, exc)
            return FundamentalService.get_fundamentals_from_db(symbol, conn)

        if raise_on_rate_limit:
            if rate_limit_exc is not None:
                raise FundamentalRateLimitError(str(rate_limit_exc)) from rate_limit_exc
            if not got_any_payload:
                raise FundamentalRateLimitError(
                    f"Empty fundamental payload returned by Yahoo Finance for {symbol}"
                )

        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

        # Upsert StockFundamentals
        _exec_sql(
            conn,
            """
            INSERT INTO stock_fundamentals (
                symbol, next_earnings_date, earnings_avg_est, dividend_rate,
                dividend_yield, payout_ratio, ex_dividend_date, five_year_avg_yield, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
                next_earnings_date = excluded.next_earnings_date,
                earnings_avg_est = excluded.earnings_avg_est,
                dividend_rate = excluded.dividend_rate,
                dividend_yield = excluded.dividend_yield,
                payout_ratio = excluded.payout_ratio,
                ex_dividend_date = excluded.ex_dividend_date,
                five_year_avg_yield = excluded.five_year_avg_yield,
                updated_at = excluded.updated_at
            """,
            (
                symbol,
                next_earnings_date.isoformat() if next_earnings_date else None,
                earnings_avg_est,
                dividend_rate,
                dividend_yield,
                payout_ratio,
                ex_dividend_date.isoformat() if ex_dividend_date else None,
                five_year_avg_yield,
                now_str,
            ),
        )

        # Upsert StockEarningsHistory
        for erow in earnings_rows:
            _exec_sql(
                conn,
                """
                INSERT INTO stock_earnings_history (
                    symbol, earnings_date, eps_estimate, eps_reported, surprise_pct
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(symbol, earnings_date) DO UPDATE SET
                    eps_estimate = excluded.eps_estimate,
                    eps_reported = excluded.eps_reported,
                    surprise_pct = excluded.surprise_pct
                """,
                (
                    symbol,
                    erow["earnings_date"],
                    erow["eps_estimate"],
                    erow["eps_reported"],
                    erow["surprise_pct"],
                ),
            )

        # Upsert StockDividendHistory
        for drow in dividend_rows:
            _exec_sql(
                conn,
                """
                INSERT INTO stock_dividend_history (
                    symbol, ex_date, cash_amount
                ) VALUES (?, ?, ?)
                ON CONFLICT(symbol, ex_date) DO UPDATE SET
                    cash_amount = excluded.cash_amount
                """,
                (
                    symbol,
                    drow["ex_date"],
                    drow["cash_amount"],
                ),
            )

        return FundamentalService.get_fundamentals_from_db(symbol, conn)

    @staticmethod
    def get_fundamentals_from_db(symbol: str, conn: Any = None) -> Dict[str, Any]:
        """Read stored fundamentals, earnings history, and dividend history from SQLite."""
        normalized = (symbol or "").strip().upper()
        if conn is None:
            master_engine = db.engines.get("master", db.engine)
            _ensure_schema_once(master_engine)
            with master_engine.begin() as active_conn:
                return FundamentalService._read_from_conn(normalized, active_conn)

        if hasattr(conn, "begin") and callable(conn.begin) and not hasattr(conn, "exec_driver_sql"):
            _ensure_schema_once(conn)
            with conn.begin() as active_conn:
                return FundamentalService._read_from_conn(normalized, active_conn)

        return FundamentalService._read_from_conn(normalized, conn)

    @staticmethod
    def _read_from_conn(symbol: str, conn: Any) -> Dict[str, Any]:
        f_row = _exec_sql(
            conn,
            """
            SELECT next_earnings_date, earnings_avg_est, dividend_rate,
                   dividend_yield, payout_ratio, ex_dividend_date, five_year_avg_yield
            FROM stock_fundamentals
            WHERE symbol = ?
            """,
            (symbol,),
        ).fetchone()

        next_earnings_date = None
        earnings_avg_est = None
        ex_dividend_date = None
        annual_rate = 0.0
        yield_pct = 0.0
        payout_ratio_pct = None
        five_year_avg_yield = None

        if f_row:
            raw_ned, raw_est, raw_rate, raw_yield, raw_payout, raw_ex_div, raw_5y = f_row
            next_earnings_date = str(raw_ned)[:10] if raw_ned else None
            earnings_avg_est = round(float(raw_est), 2) if raw_est is not None else None
            ex_dividend_date = str(raw_ex_div)[:10] if raw_ex_div else None

            if raw_rate is not None and float(raw_rate) > 0:
                annual_rate = round(float(raw_rate), 2)
            if raw_yield is not None and float(raw_yield) > 0:
                y_val = float(raw_yield)
                yield_pct = round(y_val * 100.0 if y_val <= 1.0 else y_val, 2)
            if raw_payout is not None:
                p_val = float(raw_payout)
                payout_ratio_pct = round(p_val * 100.0 if p_val <= 2.0 else p_val, 2)
            if raw_5y is not None:
                five_year_avg_yield = round(float(raw_5y), 2)

        e_rows = _exec_sql(
            conn,
            """
            SELECT earnings_date, eps_reported, eps_estimate, surprise_pct
            FROM stock_earnings_history
            WHERE symbol = ?
            ORDER BY earnings_date DESC
            LIMIT 12
            """,
            (symbol,),
        ).fetchall()

        earnings_history = [
            {
                "date": str(r[0])[:10],
                "eps_reported": round(float(r[1]), 2) if r[1] is not None else None,
                "eps_estimate": round(float(r[2]), 2) if r[2] is not None else None,
                "surprise_pct": round(float(r[3]), 2) if r[3] is not None else None,
            }
            for r in e_rows
        ]

        d_rows = _exec_sql(
            conn,
            """
            SELECT ex_date, cash_amount
            FROM stock_dividend_history
            WHERE symbol = ?
            ORDER BY ex_date DESC
            LIMIT 16
            """,
            (symbol,),
        ).fetchall()

        dividend_history = [
            {
                "date": str(r[0])[:10],
                "amount": round(float(r[1]), 4) if round(float(r[1]), 2) != round(float(r[1]), 4) else round(float(r[1]), 2),
            }
            for r in d_rows
        ]

        return {
            "symbol": symbol,
            "calendar": {
                "next_earnings_date": next_earnings_date,
                "earnings_avg_est": earnings_avg_est,
                "ex_dividend_date": ex_dividend_date,
            },
            "dividend_snapshot": {
                "annual_rate": annual_rate,
                "yield_pct": yield_pct,
                "payout_ratio_pct": payout_ratio_pct,
                "five_year_avg_yield": five_year_avg_yield,
            },
            "earnings_history": earnings_history,
            "dividend_history": dividend_history,
        }

    @staticmethod
    def _empty_pending_payload(symbol: str) -> Dict[str, Any]:
        return {
            "symbol": symbol,
            "status": "pending_sync",
            "calendar": {
                "next_earnings_date": None,
                "earnings_avg_est": None,
                "ex_dividend_date": None,
            },
            "dividend_snapshot": {
                "annual_rate": 0.0,
                "yield_pct": 0.0,
                "payout_ratio_pct": None,
                "five_year_avg_yield": None,
            },
            "earnings_history": [],
            "dividend_history": [],
        }

    @staticmethod
    def get_fundamentals(
        symbol: str,
        conn: Any = None,
        refresh: bool = False,
        priority: int = 1,
    ) -> Dict[str, Any]:
        """
        Stale-While-Revalidate (SWR) lookup for stock fundamentals:
          1. Query local DB (stock_fundamentals).
          2. If record exists and updated_at is fresh (< 12 hours) and not refresh:
             return it immediately.
          3. If record is missing or stale (> 12 hours old) or refresh=True:
             - Return existing DB row immediately (or {"symbol": symbol, "status": "pending_sync", ...} if brand new).
             - Enqueue the ticker into FundamentalQueueManager at Priority 1 (or specified priority).
        """
        normalized = (symbol or "").strip().upper()
        if not normalized:
            raise ValueError("Stock symbol is required")

        target_engine_or_conn = conn
        if target_engine_or_conn is None:
            target_engine_or_conn = db.engines.get("master", db.engine)

        if (
            hasattr(target_engine_or_conn, "begin")
            and callable(target_engine_or_conn.begin)
            and not hasattr(target_engine_or_conn, "exec_driver_sql")
        ):
            _ensure_schema_once(target_engine_or_conn)
            with target_engine_or_conn.begin() as active_conn:
                exists, is_fresh = FundamentalService._get_cache_state(normalized, active_conn)
                if exists and is_fresh and not refresh:
                    return FundamentalService._read_from_conn(normalized, active_conn)
                cached_payload = (
                    FundamentalService._read_from_conn(normalized, active_conn)
                    if exists
                    else FundamentalService._empty_pending_payload(normalized)
                )
        else:
            _ensure_schema_once(target_engine_or_conn)
            exists, is_fresh = FundamentalService._get_cache_state(normalized, target_engine_or_conn)
            if exists and is_fresh and not refresh:
                return FundamentalService._read_from_conn(normalized, target_engine_or_conn)
            cached_payload = (
                FundamentalService._read_from_conn(normalized, target_engine_or_conn)
                if exists
                else FundamentalService._empty_pending_payload(normalized)
            )

        fundamental_queue_manager.enqueue(
            normalized,
            priority=priority,
            conn=target_engine_or_conn,
            force=refresh,
        )
        return cached_payload


class FundamentalQueueManager:
    """
    Background priority queue and rate-throttling worker for Yahoo Finance fundamental ingestion.

    Priority Tiers:
      - Priority 1 (High): Ticker currently active / viewed on the chart.
      - Priority 2 (Medium): Active portfolio holdings.
      - Priority 3 (Low): Watchlists & background directory.
    """

    PRIORITY_HIGH = 1
    PRIORITY_MEDIUM = 2
    PRIORITY_LOW = 3

    def __init__(
        self,
        min_delay: float = 0.6,
        max_delay: float = 1.2,
        backoff_seconds: float = 60.0,
        max_retries: int = 2,
        auto_start: bool = True,
    ):
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.backoff_seconds = backoff_seconds
        self.max_retries = max_retries
        self._auto_start = auto_start
        self.queue: queue.PriorityQueue = queue.PriorityQueue()
        self._counter = itertools.count()
        self._lock = threading.Lock()
        self._pending: Dict[str, int] = {}
        self._retry_counts: Dict[str, int] = {}
        self._default_engine: Any = None
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None
        if auto_start:
            self.start()

    def start(self) -> None:
        with self._lock:
            if self._worker_thread is not None and self._worker_thread.is_alive():
                return
            self._stop_event.clear()
            self._worker_thread = threading.Thread(
                target=self._worker_loop,
                name="FundamentalQueueWorker",
                daemon=True,
            )
            self._worker_thread.start()

    def stop(self, timeout: float = 1.0) -> None:
        self._stop_event.set()
        thread = self._worker_thread
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=timeout)

    def enqueue(
        self,
        symbol: str,
        priority: int = PRIORITY_HIGH,
        conn: Any = None,
        force: bool = False,
    ) -> bool:
        """
        Enqueue a ticker for background fundamental ingestion at the given priority tier.
        If the symbol is already pending at a lower priority (e.g. Priority 3), promotes it
        to the higher priority (e.g. Priority 1).
        """
        normalized = (symbol or "").strip().upper()
        if not normalized or normalized.startswith("^"):
            return False

        prio = max(self.PRIORITY_HIGH, min(int(priority), self.PRIORITY_LOW))
        target_conn = conn
        if target_conn is None:
            try:
                target_conn = db.engines.get("master", db.engine)
            except Exception:
                target_conn = self._default_engine

        if (
            target_conn is not None
            and hasattr(target_conn, "begin")
            and not hasattr(target_conn, "exec_driver_sql")
        ):
            self._default_engine = target_conn

        with self._lock:
            existing_prio = self._pending.get(normalized)
            if existing_prio is not None and existing_prio <= prio and not force:
                return False
            self._pending[normalized] = min(prio, existing_prio) if existing_prio is not None else prio
            seq = next(self._counter)
            self.queue.put((prio, seq, normalized, force, target_conn))

        if self._auto_start and not self._stop_event.is_set():
            self.start()
        return True

    def enqueue_many(
        self,
        symbols: List[str],
        priority: int = PRIORITY_MEDIUM,
        conn: Any = None,
    ) -> int:
        count = 0
        for sym in symbols or []:
            if self.enqueue(sym, priority=priority, conn=conn):
                count += 1
        return count

    def process_one(self, timeout: float = 0.2) -> Optional[str]:
        """Pop and process a single item from the priority queue (with pacing and 429 backoff)."""
        try:
            priority, _seq, symbol, force, item_conn = self.queue.get(timeout=timeout)
        except queue.Empty:
            return None

        try:
            with self._lock:
                expected_prio = self._pending.get(symbol)
                if expected_prio is None or priority > expected_prio:
                    # Already processed via a higher-priority promotion
                    return None
                self._pending.pop(symbol, None)

            # Pacing: randomized delay of 0.6s - 1.2s between Yahoo Finance calls
            delay = random.uniform(self.min_delay, self.max_delay)
            if delay > 0:
                time.sleep(delay)

            engine_or_conn = item_conn or self._default_engine
            FundamentalService.fetch_and_store_fundamentals(
                symbol=symbol,
                conn=engine_or_conn,
                force=force,
                raise_on_rate_limit=True,
            )
            with self._lock:
                self._retry_counts.pop(symbol, None)
            return symbol

        except FundamentalRateLimitError as exc:
            logger.warning(
                "Yahoo Finance HTTP 429 / empty payload for %s (%s); pausing queue worker for %.1fs before retrying",
                symbol,
                exc,
                self.backoff_seconds,
            )
            if self.backoff_seconds > 0:
                time.sleep(self.backoff_seconds)
            with self._lock:
                retries = self._retry_counts.get(symbol, 0) + 1
                if retries <= self.max_retries:
                    self._retry_counts[symbol] = retries
                    self._pending[symbol] = priority
                    self.queue.put((priority, next(self._counter), symbol, force, item_conn))
                else:
                    self._retry_counts.pop(symbol, None)
            return symbol

        except Exception as exc:
            logger.debug("Background fundamental sync skipped for %s: %s", symbol, exc)
            return symbol

        finally:
            self.queue.task_done()

    def _worker_loop(self) -> None:
        while not self._stop_event.is_set():
            self.process_one(timeout=0.2)


fundamental_queue_manager = FundamentalQueueManager()


def fetch_and_store_fundamentals(symbol: str, conn: Any = None, force: bool = False) -> Dict[str, Any]:
    return FundamentalService.fetch_and_store_fundamentals(symbol, conn=conn, force=force)


def get_fundamentals(
    symbol: str,
    conn: Any = None,
    refresh: bool = False,
    priority: int = FundamentalQueueManager.PRIORITY_HIGH,
) -> Dict[str, Any]:
    return FundamentalService.get_fundamentals(symbol, conn=conn, refresh=refresh, priority=priority)


def get_cached_fundamentals_map(
    symbols: Optional[List[str]] = None,
    priority_by_symbol: Optional[Dict[str, int]] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Fast non-blocking lookup of cached StockFundamentals rows for stock serialization.
    If priority_by_symbol is provided, enqueues any missing or stale symbols in the background
    at their corresponding priority tier (e.g., Priority 2 for holdings, Priority 3 for watchlists).
    """
    result: Dict[str, Dict[str, Any]] = {}
    fresh_symbols: Set[str] = set()
    try:
        master_engine = db.engines.get("master", db.engine)
        from sqlalchemy import bindparam, text
        _ensure_schema_once(master_engine)
        with master_engine.begin() as conn:
            if symbols:
                upper_syms = list({s.upper() for s in symbols if s})
                stmt = text(
                    """
                    SELECT symbol, next_earnings_date, earnings_avg_est, dividend_rate,
                           dividend_yield, payout_ratio, ex_dividend_date, five_year_avg_yield,
                           updated_at
                    FROM stock_fundamentals
                    WHERE symbol IN :symbols
                    """
                ).bindparams(bindparam("symbols", expanding=True))
                rows = conn.execute(stmt, {"symbols": upper_syms}).fetchall()
            else:
                rows = conn.exec_driver_sql(
                    """
                    SELECT symbol, next_earnings_date, earnings_avg_est, dividend_rate,
                           dividend_yield, payout_ratio, ex_dividend_date, five_year_avg_yield,
                           updated_at
                    FROM stock_fundamentals
                    """
                ).fetchall()

            now_utc = datetime.utcnow()
            for row in rows:
                sym, raw_ned, raw_est, raw_rate, raw_yield, raw_payout, raw_ex_div, raw_5y, raw_upd = row
                upd_dt = _parse_timestamp(raw_upd)
                if upd_dt and (now_utc - upd_dt) < timedelta(hours=TTL_HOURS):
                    fresh_symbols.add(sym)

                ned = str(raw_ned)[:10] if raw_ned else None
                est = round(float(raw_est), 2) if raw_est is not None else None
                ex_div = str(raw_ex_div)[:10] if raw_ex_div else None
                annual_rate = round(float(raw_rate), 2) if raw_rate is not None and float(raw_rate) > 0 else 0.0
                yield_pct = 0.0
                if raw_yield is not None and float(raw_yield) > 0:
                    y_val = float(raw_yield)
                    yield_pct = round(y_val * 100.0 if y_val <= 1.0 else y_val, 2)
                payout_pct = None
                if raw_payout is not None:
                    p_val = float(raw_payout)
                    payout_pct = round(p_val * 100.0 if p_val <= 2.0 else p_val, 2)
                five_yr = round(float(raw_5y), 2) if raw_5y is not None else None

                result[sym] = {
                    "next_earnings_date": ned,
                    "nextEarningsDate": ned,
                    "calendar": {
                        "next_earnings_date": ned,
                        "earnings_avg_est": est,
                        "ex_dividend_date": ex_div,
                    },
                    "dividend_snapshot": {
                        "annual_rate": annual_rate,
                        "yield_pct": yield_pct,
                        "payout_ratio_pct": payout_pct,
                        "five_year_avg_yield": five_yr,
                    },
                }

        if priority_by_symbol:
            for sym, prio in priority_by_symbol.items():
                norm_sym = (sym or "").strip().upper()
                if norm_sym and norm_sym not in fresh_symbols:
                    fundamental_queue_manager.enqueue(
                        norm_sym,
                        priority=prio,
                        conn=master_engine,
                    )
    except Exception as exc:
        logger.debug("Cached fundamentals map lookup skipped: %s", exc)
    return result

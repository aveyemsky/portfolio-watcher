from __future__ import annotations

from typing import Any, Dict, Optional
import numpy as np
import pandas as pd

from portfolio.core.logging import get_logger
from portfolio.data.repositories import price_repository, stock_repository
from portfolio.services import indicator_service

logger = get_logger(__name__)


def calculate_trend_efficiency(prices: np.ndarray, window: int = 30) -> float:
    """Calculates Kaufman's Efficiency Ratio (ER) over a specified rolling window.
    
    ER = |Net Price Change| / Sum of Absolute Price Changes
    Ranges from 0.0 (erratic random noise / chop) to 1.0 (perfectly smooth trend).
    """
    prices = np.asarray(prices, dtype=float)
    n = len(prices)
    if n < 3:
        return 0.5

    effective_window = min(window, n - 1)
    net_change = abs(prices[-1] - prices[-1 - effective_window])
    path_length = np.sum(np.abs(np.diff(prices[-1 - effective_window:])))
    if path_length <= 1e-9:
        return 0.5
    return float(np.clip(net_change / path_length, 0.0, 1.0))


def calculate_cycle_drawdown(prices: np.ndarray) -> Dict[str, float]:
    """Calculates peak-to-trough max drawdown and drawdown pain over historical prices."""
    prices = np.asarray(prices, dtype=float)
    n = len(prices)
    if n < 2:
        return {"max_drawdown_pct": 0.0, "current_drawdown_pct": 0.0}

    peaks = np.maximum.accumulate(prices)
    drawdowns = np.where(peaks > 0, (prices - peaks) / peaks, 0.0)
    max_dd = float(np.min(drawdowns)) * 100.0
    curr_dd = float(drawdowns[-1]) * 100.0

    return {
        "max_drawdown_pct": round(max_dd, 1),
        "current_drawdown_pct": round(curr_dd, 1),
    }


def calculate_secular_cagr(prices: np.ndarray, trading_days_per_year: int = 252) -> float:
    """Calculates annualized compound growth rate (CAGR) across the available history."""
    prices = np.asarray(prices, dtype=float)
    n = len(prices)
    if n < 2 or prices[0] <= 0 or prices[-1] <= 0:
        return 0.0

    years = max(n / trading_days_per_year, 0.25)
    cagr = (prices[-1] / prices[0]) ** (1.0 / years) - 1.0
    return float(cagr * 100.0)


class AssetProfileService:
    """Diagnostic service to compute a stock's intrinsic movement characteristics (Asset DNA)."""

    @classmethod
    def _evaluate_candidate_strategies(
        cls, symbol: str, lookback_days: int = 730, include_quant_alpha: bool = False
    ) -> Optional[Dict[str, Any]]:
        """Simulates candidate strategies to discover empirical best-fit alpha for this stock."""
        from portfolio.services.simulation_service import SimulationService, _strategy_resolver

        classic_candidates = [
            ("RSI-14 Rebound", ["rsi14"], [{"id": "rsi14"}]),
            ("Stochastic Swing Rebound", ["stoch14"], [{"id": "stoch14"}]),
            ("MACD Signal Crossover", ["macd"], [{"id": "macd"}]),
            ("EMA-20 Momentum Guide", ["ema20"], [{"id": "ema20"}]),
            ("Volume Flow Trend (EMA-20 + OBV)", ["ema20", "obv"], [{"id": "ema20"}, {"id": "obv"}]),
            ("Trend Shield (MACD + EMA-20)", ["macd", "ema20"], [{"id": "macd"}, {"id": "ema20"}]),
            ("Momentum Consensus (MACD + RSI)", ["macd", "rsi14"], [{"id": "macd"}, {"id": "rsi14"}]),
            ("SMA-200 Macro Baseline", ["ma200"], [{"id": "ma200"}]),
        ]

        candidates = list(classic_candidates)

        if include_quant_alpha and _strategy_resolver:
            registered_getter = getattr(_strategy_resolver, "get_available_strategies", None) or getattr(_strategy_resolver, "list_strategies", None)
            if callable(registered_getter):
                for item in registered_getter():
                    s_id = getattr(item, "id", None) or (item.get("id") if isinstance(item, dict) else str(item))
                    s_label = getattr(item, "name", None) or getattr(item, "label", None) or (item.get("label") or item.get("name") if isinstance(item, dict) else s_id)
                    candidates.append((s_label, [s_id], [{"id": s_id}]))

        best_alpha = -9999.0
        best_candidate = None

        for label, ids, specs in candidates:
            try:
                res = SimulationService.simulate_stock_ensemble(
                    symbol=symbol,
                    strategies=specs,
                    combine_mode="CONSENSUS",
                    lookback_days=lookback_days,
                )
                m = res.get("metrics", {})
                alpha = float(m.get("alpha_pct", 0.0))
                ret = float(m.get("strategy_return_pct", 0.0))
                win = float(m.get("win_rate_pct", 0.0))
                dd = float(m.get("strategy_max_drawdown_pct", 0.0))
                if alpha > best_alpha:
                    best_alpha = alpha
                    best_candidate = {
                        "label": label,
                        "strategies": ids,
                        "alpha_pct": alpha,
                        "strategy_return_pct": ret,
                        "win_rate_pct": win,
                        "max_drawdown_pct": dd,
                    }
            except Exception:
                continue

        return best_candidate

    @classmethod
    def get_asset_profile(
        cls, symbol: str, lookback_days: int = 730, include_quant_alpha: bool = True
    ) -> Dict[str, Any]:
        """Convenience alias for get_stock_dna_profile."""
        return cls.get_stock_dna_profile(
            symbol=symbol, include_quant_alpha=include_quant_alpha, lookback_days=lookback_days
        )

    @classmethod
    def get_stock_dna_profile(
        cls, symbol: str, include_quant_alpha: bool = False, lookback_days: int = 730
    ) -> Dict[str, Any]:
        normalized = (symbol or "").strip().upper()
        stock = stock_repository.get_stock_by_symbol(normalized)
        if not stock:
            return cls._empty_profile(normalized, "Stock not found", include_quant_alpha=include_quant_alpha)

        prices_records = price_repository.list_prices_for_stock_id(stock.id)
        if not prices_records or len(prices_records) < 20:
            try:
                from portfolio.services import chart_service
                chart_service.get_stock_prices(normalized)
                prices_records = price_repository.list_prices_for_stock_id(stock.id)
            except Exception:
                pass

        if not prices_records or len(prices_records) < 20:
            return cls._empty_profile(normalized, "Insufficient historical price bars", include_quant_alpha=include_quant_alpha)

        df = indicator_service._prices_to_dataframe(prices_records)
        if df.empty or "Close" not in df:
            return cls._empty_profile(normalized, "Unable to extract price history", include_quant_alpha=include_quant_alpha)

        closes = df["Close"].values.astype(float)
        n = len(closes)

        # 1. Metric: Trend Efficiency (30-day and 90-day Kaufman ER)
        er_30 = calculate_trend_efficiency(closes, window=min(30, n - 1))
        er_90 = calculate_trend_efficiency(closes, window=min(90, n - 1))
        trend_er = round((er_30 * 0.6) + (er_90 * 0.4), 2)

        # 2. Metric: Cycle Drawdown Severity
        dd_stats = calculate_cycle_drawdown(closes)
        max_dd = dd_stats["max_drawdown_pct"]

        # 3. Metric: Daily Volatility (ATR-14)
        atr_series = indicator_service._atr_series(df, period=14)
        latest_atr_val = indicator_service._latest_valid_value(atr_series)
        latest_close = closes[-1] if len(closes) > 0 else 1.0
        daily_vol_pct = round((latest_atr_val / latest_close * 100.0), 1) if (latest_atr_val is not None and latest_close > 0) else 0.0

        if daily_vol_pct >= 4.0:
            vol_label = "High Volatility"
        elif daily_vol_pct <= 1.5:
            vol_label = "Low Volatility"
        else:
            vol_label = "Normal Volatility"

        # 4. Auxiliary metric: Secular CAGR Drift
        cagr = round(calculate_secular_cagr(closes), 1)

        # 5. Empirical Candidate Evaluation
        eval_lookback = int(lookback_days) if lookback_days is not None and int(lookback_days) >= 0 else 730
        best_cand = cls._evaluate_candidate_strategies(
            normalized, lookback_days=eval_lookback, include_quant_alpha=include_quant_alpha
        )

        # 6. Adaptive Empirical Classification
        # Case A: Runaway Compounder (e.g. ANET, SNDK, NVDA)
        # Strong secular drift (>25% CAGR), but active indicators all lag unhedged Hold in raw return (Alpha < -20%)
        # because taking profit/cutting drawdown reduces raw bull compounding.
        # Recommend the empirically best active model that cushions downside rather than a rigid 200-SMA.
        if cagr >= 25.0 and best_cand and best_cand["alpha_pct"] < -20.0:
            profile_type = "RUNAWAY_COMPOUNDER"
            profile_label = "Runaway Compounder"
            badge_color = "emerald"
            efficiency_label = "High Chop Whipsaws" if trend_er < 0.20 else "High Secular Drift"
            drawdown_label = "Deep Growth Pullbacks" if max_dd <= -40.0 else "Tolerable Pullbacks"

            active_label = best_cand["label"]
            preset = {
                "id": "empirical_best",
                "label": active_label,
                "strategies": best_cand["strategies"],
                "combine_mode": "CONSENSUS",
                "reason": (
                    f"Strong secular growth (+{cagr:.0f}% CAGR). Best active model is {active_label} "
                    f"(+{best_cand['strategy_return_pct']:.1f}% return, {best_cand['win_rate_pct']:.0f}% Win Rate), "
                    "mitigating deep cycle pullbacks while capturing the secular trend."
                ),
            }
        # Case B: Empirical Alpha Winner (e.g. AAPL -> RSI-14, CAT -> MACD, BA -> EMA-20, cyclical -> Stoch)
        elif best_cand and best_cand["alpha_pct"] > 0.0:
            strat_label = best_cand["label"]
            alpha_val = best_cand["alpha_pct"]
            win_val = best_cand["win_rate_pct"]

            if "MACD" in strat_label:
                profile_type = "CYCLICAL_TREND"
                profile_label = "Cyclical Trend"
                badge_color = "purple"
            elif "RSI" in strat_label:
                profile_type = "MOMENTUM_REBOUND"
                profile_label = "Momentum Rebound"
                badge_color = "blue"
            elif "Stochastic" in strat_label:
                profile_type = "CYCLICAL_OSCILLATOR"
                profile_label = "Cyclical Swing Rebound"
                badge_color = "blue"
            elif "Trend Runner" in strat_label:
                profile_type = "BULL_TREND_RUNNER"
                profile_label = "Bull Trend Runner"
                badge_color = "emerald"
            elif "Supertrend" in strat_label:
                profile_type = "VOLATILITY_BREAKOUT"
                profile_label = "Adaptive Trend"
                badge_color = "emerald"
            elif "Squeeze" in strat_label:
                profile_type = "VOLATILITY_EXPANSION"
                profile_label = "Compression Breakout"
                badge_color = "purple"
            elif "Mean Reversion" in strat_label:
                profile_type = "STATISTICAL_REVERSION"
                profile_label = "Mean Reversion"
                badge_color = "blue"
            elif "Smart Money" in strat_label or "Institutional" in strat_label:
                profile_type = "INSTITUTIONAL_STRUCTURE"
                profile_label = "Smart Money Structure"
                badge_color = "emerald"
            elif "Capitulation" in strat_label or "Exhaustion" in strat_label:
                profile_type = "CAPITULATION_REVERSAL"
                profile_label = "Exhaustion Reversal"
                badge_color = "amber"
            elif "Volume" in strat_label or "OBV" in strat_label:
                profile_type = "VOLUME_ACCUMULATION"
                profile_label = "Institutional Flow"
                badge_color = "emerald"
            elif "EMA" in strat_label:
                profile_type = "FAST_MOMENTUM"
                profile_label = "Fast Momentum"
                badge_color = "purple"
            else:
                profile_type = "TRENDING_MOMENTUM"
                profile_label = "Trending Momentum"
                badge_color = "blue"

            efficiency_label = "Trend Follow-Through" if trend_er >= 0.25 else "Moderate Trend"
            drawdown_label = f"{max_dd:.0f}% Peak Cycle Dip"

            preset = {
                "id": "empirical_best",
                "label": strat_label,
                "strategies": best_cand["strategies"],
                "combine_mode": "CONSENSUS",
                "reason": (
                    f"Empirically optimal edge: {strat_label} generated +{alpha_val:.1f}% Alpha over Hold "
                    f"with a {win_val:.0f}% Win Rate."
                ),
            }
        # Case C: High Cycle Drawdown with moderate alpha (e.g. QCOM)
        elif max_dd <= -35.0:
            profile_type = "CYCLICAL_SWING"
            profile_label = "Cyclical Swing"
            badge_color = "purple"
            efficiency_label = "Cycle Driven Trend"
            drawdown_label = "Severe Cycle Drawdowns"
            preset = {
                "id": "trend_shield",
                "label": best_cand["label"] if best_cand else "Trend Shield (MACD + EMA-20)",
                "strategies": best_cand["strategies"] if best_cand else ["macd", "ema20"],
                "combine_mode": "CONSENSUS",
                "reason": f"Heavy cycle drawdown risk ({max_dd:.1f}% peak dip). Active trend filtering mitigates multi-month bear legs.",
            }
        # Case D: Choppy Range / Low Efficiency
        elif trend_er < 0.25:
            profile_type = "CHOPPY_NOISE"
            profile_label = "Choppy Range / Noise"
            badge_color = "amber"
            efficiency_label = "Low Signal-to-Noise"
            drawdown_label = "Range-Bound Consolidation"
            preset = {
                "id": "mean_reversion",
                "label": "Mean Reversion (Bollinger Bands + Stochastic)",
                "strategies": ["bb20", "stoch14"],
                "combine_mode": "CONSENSUS",
                "reason": "Low trend efficiency (ER < 0.25) produces moving average whipsaws. Stochastic and Bollinger Bands mean-reversion perform better.",
            }
        else:
            profile_type = "TRENDING_MOMENTUM"
            profile_label = "Trending Momentum"
            badge_color = "blue"
            efficiency_label = "Clean Trending Path"
            drawdown_label = "Moderate Volatility"
            preset = {
                "id": "momentum_consensus",
                "label": best_cand["label"] if best_cand else "Momentum Consensus (MACD + RSI)",
                "strategies": best_cand["strategies"] if best_cand else ["macd", "rsi14"],
                "combine_mode": "CONSENSUS",
                "reason": "Balanced trend efficiency. Indicator consensus filters false exits while capturing sustained moves.",
            }

        return {
            "symbol": normalized,
            "profile_type": profile_type,
            "profile_label": profile_label,
            "badge_color": badge_color,
            "trend_efficiency": trend_er,
            "efficiency_label": efficiency_label,
            "max_cycle_drawdown_pct": max_dd,
            "drawdown_label": drawdown_label,
            "daily_volatility_pct": daily_vol_pct,
            "volatility_label": vol_label,
            "secular_cagr_pct": cagr,
            "total_bars": n,
            "recommended_preset": preset,
            "include_quant_alpha": include_quant_alpha,
            "status": "ok",
        }

    @staticmethod
    def _empty_profile(symbol: str, message: str, include_quant_alpha: bool = False) -> Dict[str, Any]:
        return {
            "symbol": symbol,
            "profile_type": "UNKNOWN",
            "profile_label": "Unclassified",
            "badge_color": "gray",
            "trend_efficiency": 0.0,
            "efficiency_label": "N/A",
            "max_cycle_drawdown_pct": 0.0,
            "drawdown_label": "N/A",
            "daily_volatility_pct": 0.0,
            "volatility_label": "N/A",
            "secular_cagr_pct": 0.0,
            "total_bars": 0,
            "include_quant_alpha": include_quant_alpha,
            "recommended_preset": {
                "id": "default",
                "label": "Standard Ensemble",
                "strategies": ["macd"],
                "combine_mode": "CONSENSUS",
                "reason": message,
            },
            "status": "insufficient_data",
            "message": message,
        }

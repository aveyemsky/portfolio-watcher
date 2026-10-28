from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional
import numpy as np

_strategy_resolver: Optional[Callable[[str], Any]] = None


def register_strategy_resolver(resolver_fn: Callable[[str], Any]) -> None:
    """Registers an external/host strategy resolver for custom quant alpha models."""
    global _strategy_resolver
    _strategy_resolver = resolver_fn


class SimulationService:
    """High-performance stateless vectorized backtester for equity simulation."""

    @staticmethod
    def run_strategy_backtest(
        prices: np.ndarray,
        exposure_weights: np.ndarray,
        initial_capital: float = 10000.0,
    ) -> Dict[str, Any]:
        """Vectorized simulation evaluating target exposure weights (0.0 to 1.0) vs passive Buy-and-Hold benchmark."""
        prices = np.asarray(prices, dtype=float)
        exposure_weights = np.asarray(exposure_weights, dtype=float)
        n = len(prices)
        if n == 0:
            return {
                "equity_curve": [],
                "benchmark_curve": [],
                "strategy_return_pct": 0.0,
                "benchmark_return_pct": 0.0,
                "max_drawdown_pct": 0.0,
                "alpha_vs_hold": 0.0,
            }
        if n == 1:
            return {
                "equity_curve": [float(initial_capital)],
                "benchmark_curve": [float(initial_capital)],
                "strategy_return_pct": 0.0,
                "benchmark_return_pct": 0.0,
                "max_drawdown_pct": 0.0,
                "alpha_vs_hold": 0.0,
            }

        if len(exposure_weights) < n:
            exposure_weights = np.pad(exposure_weights, (0, n - len(exposure_weights)), constant_values=0.0)
        elif len(exposure_weights) > n:
            exposure_weights = exposure_weights[:n]

        # Calculate daily price returns
        returns = np.insert(np.diff(prices) / prices[:-1], 0, 0.0)

        # Strategy returns follow lagged exposure weights
        strategy_daily_returns = exposure_weights[:-1] * returns[1:]
        strategy_daily_returns = np.insert(strategy_daily_returns, 0, 0.0)

        equity_curve = initial_capital * np.cumprod(1.0 + strategy_daily_returns)
        benchmark_curve = (prices / prices[0]) * initial_capital if prices[0] > 0 else np.full(n, initial_capital)

        total_return_pct = float(((equity_curve[-1] - initial_capital) / initial_capital) * 100.0)
        benchmark_return_pct = float(((benchmark_curve[-1] - initial_capital) / initial_capital) * 100.0)

        # Drawdown calculation
        peak = np.maximum.accumulate(equity_curve)
        drawdowns = np.where(peak > 0, (equity_curve - peak) / peak, 0.0)
        max_drawdown = float(np.min(drawdowns)) * 100.0 if len(drawdowns) > 0 else 0.0

        return {
            "equity_curve": equity_curve.tolist(),
            "benchmark_curve": benchmark_curve.tolist(),
            "strategy_return_pct": round(total_return_pct, 2),
            "benchmark_return_pct": round(benchmark_return_pct, 2),
            "max_drawdown_pct": round(max_drawdown, 2),
            "alpha_vs_hold": round(total_return_pct - benchmark_return_pct, 2),
        }

    @staticmethod
    def run_backtest(
        dates: List[str],
        prices: np.ndarray,
        signals: Optional[np.ndarray] = None,
        initial_capital: float = 10000.0,
        target_weights: Optional[np.ndarray] = None,
        deadband: float = 0.03,
    ) -> Dict[str, Any]:
        """Runs a stateless backtest calculating equity curves based on dynamic staged rebalancing.

        Args:
            dates: List of ISO date strings for each bar.
            prices: Close prices ndarray for each bar.
            signals: Optional execution signal vector (+1 = Long/Buy, 0 = Sideline, -1 = Exit).
            initial_capital: Starting portfolio value in dollars.
            target_weights: Optional continuous target weight per bar: 0.0 (cash) to 1.0 (full position).
            deadband: Minimum allocation shift threshold (default 3%) to prevent micro-churning.

        Returns:
            Dict containing equity curves, performance metrics, and trade logs.
        """
        prices = np.asarray(prices, dtype=float)
        n = len(prices)

        if n == 0 or len(dates) == 0:
            return {
                "dates": [],
                "strategy_equity": [],
                "benchmark_equity": [],
                "metrics": {
                    "strategy_return_pct": 0.0,
                    "benchmark_return_pct": 0.0,
                    "alpha_pct": 0.0,
                    "strategy_max_drawdown_pct": 0.0,
                    "benchmark_max_drawdown_pct": 0.0,
                    "total_trades": 0,
                    "win_rate_pct": 0.0,
                },
                "trades": [],
            }

        # Resolve continuous target weights
        if target_weights is not None:
            weights = np.asarray(target_weights, dtype=float)
        elif signals is not None:
            sig = np.asarray(signals, dtype=float)
            # Automatic conversion from legacy signals:
            # +1 -> 1.0 (100% invested)
            # 0 / -1 -> 0.0 (100% cash)
            # With multi-bar state carry-forward for trigger sequences (where -1 marks exit)
            if np.any(sig < 0):
                weights = np.zeros(n, dtype=float)
                curr = 0.0
                for i in range(min(n, len(sig))):
                    if sig[i] == 1:
                        curr = 1.0
                    elif sig[i] == -1:
                        curr = 0.0
                    weights[i] = curr
            elif np.all((sig >= 0.0) & (sig <= 1.0)) and np.any((sig > 0.0) & (sig < 1.0)):
                weights = sig
            else:
                weights = np.where(sig > 0, 1.0, 0.0)
        else:
            weights = np.zeros(n, dtype=float)

        weights = np.clip(weights, 0.0, 1.0)

        cash = float(initial_capital)
        shares = 0.0
        avg_cost = 0.0
        closed_trades = 0
        winning_trades = 0
        strategy_curve = []
        trade_logs = []
        benchmark_curve = (prices / prices[0]) * initial_capital if prices[0] > 0 else np.full(n, initial_capital)

        for i in range(n):
            p = float(prices[i])
            w = float(weights[i]) if i < len(weights) else 0.0

            if p <= 0:
                val = cash + (shares * max(p, 0.0))
                strategy_curve.append(val)
                continue

            portfolio_val = cash + (shares * p)
            desired_equity = portfolio_val * w
            current_equity = shares * p
            diff = desired_equity - current_equity
            weight_diff = abs(diff) / portfolio_val if portfolio_val > 0 else 0.0

            # Execute rebalancing:
            # 1. Full exit requested (w == 0.0) and currently holding shares:
            if w <= 1e-6 and shares > 1e-6:
                executed_shares = shares
                proceeds = executed_shares * p
                cash += proceeds
                pnl = (p - avg_cost) * executed_shares
                ret_pct = ((p - avg_cost) / avg_cost * 100.0) if avg_cost > 0 else 0.0
                closed_trades += 1
                if pnl > 0:
                    winning_trades += 1
                shares = 0.0
                avg_cost = 0.0
                trade_logs.append({
                    "date": dates[i],
                    "action": "EXIT",
                    "price": round(p, 2),
                    "shares": round(executed_shares, 4),
                    "remaining_cash": round(cash, 2),
                    "cash": round(cash, 2),
                    "pnl": round(pnl, 2),
                    "return_pct": round(ret_pct, 2),
                })
            # 2. Trim / Harvest: diff < 0 and beyond deadband
            elif diff < 0 and weight_diff >= deadband and shares > 1e-6:
                shares_to_sell = min(shares, abs(diff) / p)
                if shares_to_sell > 1e-6:
                    executed_shares = shares_to_sell
                    proceeds = executed_shares * p
                    cash += proceeds
                    pnl = (p - avg_cost) * executed_shares
                    ret_pct = ((p - avg_cost) / avg_cost * 100.0) if avg_cost > 0 else 0.0
                    closed_trades += 1
                    if pnl > 0:
                        winning_trades += 1
                    shares -= executed_shares
                    if shares <= 1e-6:
                        shares = 0.0
                        avg_cost = 0.0
                        action = "EXIT"
                    else:
                        action = "TRIM_HARVEST"
                    trade_logs.append({
                        "date": dates[i],
                        "action": action,
                        "price": round(p, 2),
                        "shares": round(executed_shares, 4),
                        "remaining_cash": round(cash, 2),
                        "cash": round(cash, 2),
                        "pnl": round(pnl, 2),
                        "return_pct": round(ret_pct, 2),
                    })
            # 3. Buy / Scale In: diff > 0 and beyond deadband
            elif diff > 0 and weight_diff >= deadband and cash > 1e-6:
                cash_to_spend = min(cash, diff)
                shares_to_buy = cash_to_spend / p
                if shares_to_buy > 1e-6:
                    prev_shares = shares
                    action = "BUY" if prev_shares <= 1e-6 else "SCALE_IN"
                    total_shares = prev_shares + shares_to_buy
                    avg_cost = ((prev_shares * avg_cost) + (shares_to_buy * p)) / total_shares if total_shares > 0 else p
                    shares = total_shares
                    cash -= cash_to_spend
                    trade_logs.append({
                        "date": dates[i],
                        "action": action,
                        "price": round(p, 2),
                        "shares": round(shares_to_buy, 4),
                        "remaining_cash": round(cash, 2),
                        "cash": round(cash, 2),
                    })

            val = cash + (shares * p)
            strategy_curve.append(val)

        strat_ret = ((strategy_curve[-1] - initial_capital) / initial_capital) * 100.0
        bench_ret = ((benchmark_curve[-1] - initial_capital) / initial_capital) * 100.0

        # Strategy Max Drawdown
        strat_arr = np.array(strategy_curve, dtype=float)
        peak = np.maximum.accumulate(strat_arr)
        dds = np.where(peak > 0, (strat_arr - peak) / peak, 0.0)
        max_dd = float(np.min(dds)) * 100.0 if len(dds) > 0 else 0.0

        # Benchmark Max Drawdown
        bench_arr = np.array(benchmark_curve, dtype=float)
        bench_peak = np.maximum.accumulate(bench_arr)
        bench_dds = np.where(bench_peak > 0, (bench_arr - bench_peak) / bench_peak, 0.0)
        bench_max_dd = float(np.min(bench_dds)) * 100.0 if len(bench_dds) > 0 else 0.0

        win_rate = (winning_trades / closed_trades * 100.0) if closed_trades > 0 else 0.0

        return {
            "dates": dates,
            "strategy_equity": [round(float(v), 2) for v in strategy_curve],
            "benchmark_equity": [round(float(v), 2) for v in benchmark_curve],
            "metrics": {
                "strategy_return_pct": round(float(strat_ret), 2),
                "benchmark_return_pct": round(float(bench_ret), 2),
                "alpha_pct": round(float(strat_ret - bench_ret), 2),
                "alpha_vs_hold": round(float(strat_ret - bench_ret), 2),
                "strategy_max_drawdown_pct": round(float(max_dd), 2),
                "max_drawdown_pct": round(float(max_dd), 2),
                "benchmark_max_drawdown_pct": round(float(bench_max_dd), 2),
                "total_trades": len([t for t in trade_logs if t["action"] == "BUY"]),
                "win_rate_pct": round(float(win_rate), 2),
            },
            "trades": trade_logs,
        }

    @classmethod
    def simulate_ensemble(
        cls,
        symbol: str,
        strategies: List[Dict[str, Any] | str] | None = None,
        combine_mode: str = "CONSENSUS",
        lookback_days: int | None = 365,
        weights: List[float] | None = None,
        initial_capital: float = 10000.0,
        start_date: str | None = None,
        end_date: str | None = None,
        macro_sentiment_gate: Optional[Dict[str, Any] | str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Convenience alias for simulate_stock_ensemble."""
        return cls.simulate_stock_ensemble(
            symbol=symbol,
            strategies=strategies,
            combine_mode=combine_mode,
            lookback_days=lookback_days,
            weights=weights,
            initial_capital=initial_capital,
            start_date=start_date,
            end_date=end_date,
            macro_sentiment_gate=macro_sentiment_gate,
            **kwargs,
        )

    @staticmethod
    def simulate_stock_ensemble(
        symbol: str,
        strategies: List[Dict[str, Any]] | None = None,
        combine_mode: str = "CONSENSUS",
        lookback_days: int | None = 365,
        weights: List[float] | None = None,
        initial_capital: float = 10000.0,
        start_date: str | None = None,
        end_date: str | None = None,
        macro_sentiment_gate: Optional[Dict[str, Any] | str] = None,
    ) -> Dict[str, Any]:
        """Runs a backtest simulation for a stock using built-in indicators and the ensemble combiner."""
        import pandas as pd
        from portfolio.data.repositories import price_repository, stock_repository
        from portfolio.api.errors import NotFoundError
        from portfolio.services import indicator_service
        from portfolio.services.ensemble_service import EnsembleService

        normalized = (symbol or "").strip().upper()
        stock = stock_repository.get_stock_by_symbol(normalized)
        if not stock:
            raise NotFoundError(f"Stock not found: {normalized}")

        prices = price_repository.list_prices_for_stock_id(stock.id)
        if not prices or len(prices) < 5:
            return {
                "ticker": normalized,
                "combine_mode": combine_mode,
                "lookback_days": lookback_days,
                "start_date": start_date,
                "end_date": end_date,
                "dates": [],
                "strategy_equity": [],
                "benchmark_equity": [],
                "metrics": {
                    "strategy_return_pct": 0.0,
                    "benchmark_return_pct": 0.0,
                    "alpha_pct": 0.0,
                    "strategy_max_drawdown_pct": 0.0,
                    "benchmark_max_drawdown_pct": 0.0,
                    "total_trades": 0,
                    "win_rate_pct": 0.0,
                },
                "trades": [],
                "trade_markers": [],
                "current_posture": {
                    "posture": "CASH",
                    "signal": 0,
                    "as_of_date": None,
                    "latest_price": 0.0,
                    "participating_strategies": [],
                },
            }

        full_df = indicator_service._prices_to_dataframe(prices)

        strategy_specs = strategies or [{"id": "supertrend"}]
        atomic_outputs = []

        for spec in strategy_specs:
            s_id = spec.get("id") if isinstance(spec, dict) else str(spec)
            s_params = spec.get("params", {}) if isinstance(spec, dict) else {}
            strat = _strategy_resolver(s_id) if _strategy_resolver else None
            if strat:
                atomic_out = strat.to_atomic_output(full_df, context=s_params)
            else:
                atomic_out = indicator_service.indicator_to_atomic_output(full_df, s_id, **s_params)
            atomic_outputs.append(atomic_out)

        if not atomic_outputs:
            atomic_outputs.append(indicator_service.supertrend_to_atomic_output(full_df))

        combined_signals = EnsembleService.combine(
            atomic_outputs,
            mode=combine_mode,
            weights=weights,
        )

        dt_series = pd.to_datetime(full_df["Date"])
        start_dt = pd.to_datetime(start_date) if start_date and str(start_date).strip() else None
        end_dt = pd.to_datetime(end_date) if end_date and str(end_date).strip() else None

        if start_dt is not None or end_dt is not None:
            mask = pd.Series(True, index=full_df.index)
            if start_dt is not None:
                mask &= (dt_series >= start_dt)
            if end_dt is not None:
                mask &= (dt_series <= end_dt)
            if mask.any():
                matching_indices = mask[mask].index
                slice_start = int(matching_indices[0])
                slice_end = int(matching_indices[-1]) + 1
                df = full_df.iloc[slice_start:slice_end].reset_index(drop=True)
                dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in df["Date"]]
                close_prices = df["Close"].values.astype(float)
                combined_signals = combined_signals[slice_start:slice_end]
            else:
                dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in full_df["Date"]]
                close_prices = full_df["Close"].values.astype(float)
        elif lookback_days and lookback_days > 0:
            latest_dt = pd.Timestamp(str(full_df["Date"].iloc[-1]))
            cutoff_dt = latest_dt - pd.Timedelta(days=int(lookback_days))
            mask = dt_series >= cutoff_dt
            if mask.any() and not mask.all():
                slice_start = int(mask.idxmax())
                df = full_df.iloc[slice_start:].reset_index(drop=True)
                dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in df["Date"]]
                close_prices = df["Close"].values.astype(float)
                combined_signals = combined_signals[slice_start:]
            else:
                dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in full_df["Date"]]
                close_prices = full_df["Close"].values.astype(float)
        else:
            dates = [pd.to_datetime(d).strftime("%Y-%m-%d") for d in full_df["Date"]]
            close_prices = full_df["Close"].values.astype(float)

        # Macro Sentiment Gate evaluation (VIX & SKEW)
        macro_gate_info: Dict[str, Any] = {
            "enabled": False,
            "vix_max": 28.0,
            "skew_max": 145.0,
            "gated_bars": 0,
            "latest_vix": None,
            "latest_skew": None,
            "gate_active_today": False,
        }

        vix_stock = stock_repository.get_stock_by_symbol("^VIX")
        skew_stock = stock_repository.get_stock_by_symbol("^SKEW")

        vix_map: Dict[str, float] = {}
        if vix_stock:
            for p in price_repository.list_prices_for_stock_id(vix_stock.id):
                val = getattr(p, "close", getattr(p, "close_price", None))
                if val is not None:
                    vix_map[str(p.date)[:10]] = float(val)

        skew_map: Dict[str, float] = {}
        if skew_stock:
            for p in price_repository.list_prices_for_stock_id(skew_stock.id):
                val = getattr(p, "close", getattr(p, "close_price", None))
                if val is not None:
                    skew_map[str(p.date)[:10]] = float(val)

        if vix_map:
            latest_vix_date = max(vix_map.keys())
            macro_gate_info["latest_vix"] = round(vix_map[latest_vix_date], 2)
        if skew_map:
            latest_skew_date = max(skew_map.keys())
            macro_gate_info["latest_skew"] = round(skew_map[latest_skew_date], 2)

        gate_enabled = False
        vix_max = 28.0
        skew_max = 145.0

        if macro_sentiment_gate:
            if isinstance(macro_sentiment_gate, dict):
                gate_enabled = bool(macro_sentiment_gate.get("enabled", True))
                vix_max = float(macro_sentiment_gate.get("vix_max", 28.0))
                skew_max = float(macro_sentiment_gate.get("skew_max", 145.0))
            elif isinstance(macro_sentiment_gate, str) and macro_sentiment_gate.upper() in ("TRUE", "1", "DEFENSIVE", "ON"):
                gate_enabled = True

        macro_gate_info["enabled"] = gate_enabled
        macro_gate_info["vix_max"] = vix_max
        macro_gate_info["skew_max"] = skew_max

        if gate_enabled and dates:
            gated_count = 0
            cur_vix = None
            cur_skew = None
            gated_signals = np.copy(combined_signals)

            for i, d in enumerate(dates):
                if d in vix_map:
                    cur_vix = vix_map[d]
                if d in skew_map:
                    cur_skew = skew_map[d]

                is_risk_off = (cur_vix is not None and cur_vix > vix_max) or (cur_skew is not None and cur_skew > skew_max)
                if is_risk_off:
                    gated_count += 1
                    # Gated regime: override long positions to cash/sideline (0.0)
                    if gated_signals[i] > 0:
                        gated_signals[i] = 0.0

            combined_signals = gated_signals
            macro_gate_info["gated_bars"] = gated_count
            latest_bar_vix = cur_vix if cur_vix is not None else macro_gate_info["latest_vix"]
            latest_bar_skew = cur_skew if cur_skew is not None else macro_gate_info["latest_skew"]
            macro_gate_info["gate_active_today"] = bool(
                (latest_bar_vix is not None and latest_bar_vix > vix_max) or
                (latest_bar_skew is not None and latest_bar_skew > skew_max)
            )

        has_continuous = np.any((combined_signals > 0.0) & (combined_signals < 1.0)) or (
            np.all((combined_signals >= 0.0) & (combined_signals <= 1.0)) and not np.any(combined_signals < 0)
        )
        if has_continuous:
            sim = SimulationService.run_backtest(
                dates=dates,
                prices=close_prices,
                target_weights=combined_signals,
                initial_capital=initial_capital,
            )
        else:
            sim = SimulationService.run_backtest(
                dates=dates,
                prices=close_prices,
                signals=combined_signals,
                initial_capital=initial_capital,
            )

        strat_names = "+".join([o.strategy_id.upper() for o in atomic_outputs])
        trade_markers = []
        for t in sim["trades"]:
            act = t.get("action", "")
            if act == "BUY":
                label = "BUY"
                color = "#10b981"
                shape = "arrowUp"
                pos = "belowBar"
                details = f"[{strat_names}] Initial Buy @ ${t.get('price'):.2f} ({t.get('shares', 0):.2f} shs)"
            elif act == "SCALE_IN":
                label = "SCALE"
                color = "#34d399"
                shape = "arrowUp"
                pos = "belowBar"
                details = f"[{strat_names}] Scaled In @ ${t.get('price'):.2f} (+{t.get('shares', 0):.2f} shs)"
            elif act in ("TRIM_HARVEST", "TRIM"):
                label = "TRIM"
                color = "#f59e0b"
                shape = "arrowDown"
                pos = "aboveBar"
                details = f"[{strat_names}] Trimmed @ ${t.get('price'):.2f} (-{t.get('shares', 0):.2f} shs, PnL: ${t.get('pnl', 0):+.2f})"
            else:  # EXIT
                label = "EXIT"
                color = "#ef4444"
                shape = "arrowDown"
                pos = "aboveBar"
                details = f"[{strat_names}] Exited @ ${t.get('price'):.2f} (PnL: ${t.get('pnl', 0):+.2f})"

            trade_markers.append({
                "time": t.get("date"),
                "position": pos,
                "color": color,
                "shape": shape,
                "text": f"{label} [{strat_names}]",
                "price": t.get("price"),
                "details": details,
            })

        last_sig = float(combined_signals[-1]) if len(combined_signals) > 0 else 0.0
        if macro_gate_info.get("gate_active_today"):
            posture_label = "DEFENSIVE (MACRO GATED)"
        elif last_sig >= 0.99:
            posture_label = "LONG"
        elif last_sig > 0:
            posture_label = f"PARTIAL LONG ({int(round(last_sig * 100))}%)"
        elif last_sig == -1:
            posture_label = "EXIT / DEFENSIVE"
        else:
            posture_label = "CASH / SIDELINE"

        latest_price = float(close_prices[-1]) if len(close_prices) > 0 else 0.0
        as_of_date = dates[-1] if dates else None

        return {
            "ticker": normalized,
            "combine_mode": combine_mode,
            "lookback_days": lookback_days,
            "start_date": start_date,
            "end_date": end_date,
            "macro_gate": macro_gate_info,
            "dates": sim["dates"],
            "strategy_equity": sim["strategy_equity"],
            "benchmark_equity": sim["benchmark_equity"],
            "equity_curve": sim["strategy_equity"],
            "benchmark_curve": sim["benchmark_equity"],
            "metrics": sim["metrics"],
            "strategy_return_pct": sim["metrics"].get("strategy_return_pct", 0.0),
            "benchmark_return_pct": sim["metrics"].get("benchmark_return_pct", 0.0),
            "max_drawdown_pct": sim["metrics"].get("max_drawdown_pct", sim["metrics"].get("strategy_max_drawdown_pct", 0.0)),
            "alpha_vs_hold": sim["metrics"].get("alpha_vs_hold", sim["metrics"].get("alpha_pct", 0.0)),
            "trades": sim["trades"],
            "trade_markers": trade_markers,
            "current_posture": {
                "posture": posture_label,
                "signal": int(last_sig) if last_sig in (-1.0, 0.0, 1.0) else round(last_sig, 2),
                "as_of_date": as_of_date,
                "latest_price": round(latest_price, 2),
                "participating_strategies": [o.strategy_id for o in atomic_outputs],
                "macro_gate_active": macro_gate_info.get("gate_active_today", False),
            },
        }


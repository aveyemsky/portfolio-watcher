"""Resource definitions for PortfolioWatcher MCP server."""

from portfolio.mcp.server import with_app_context
from portfolio.services import (
    account_service,
    asset_profile_service,
    catalyst_service,
    index_service,
    indicator_service,
    stock_service,
)


def register_resources(server) -> None:
    """Register MCP resources and resource templates."""

    @server.resource("portfolio://accounts")
    @with_app_context
    def accounts_summary() -> str:
        """Markdown overview of all configured investment portfolios."""
        accounts = account_service.list_accounts()
        if not accounts:
            return "# PortfolioWatcher Accounts\n\nNo accounts configured yet."

        lines = ["# PortfolioWatcher Accounts Summary\n"]
        for acc in accounts:
            holdings = account_service.get_account_holdings(acc.id)
            symbols = [h.symbol for h in holdings if getattr(h, "symbol", None)]
            lines.append(f"## Account #{acc.id}: {acc.name} ({acc.type.upper()})")
            lines.append(f"- **Holdings Count**: {len(symbols)}")
            lines.append(f"- **Symbols**: {', '.join(symbols) if symbols else 'None'}\n")

        return "\n".join(lines)

    @server.resource("portfolio://macro/sentiment")
    @with_app_context
    def macro_sentiment_summary() -> str:
        """Markdown summary of macro sentiment, major indices, VIX, and SKEW."""
        try:
            indices = index_service.list_indices()
            lines = ["# PortfolioWatcher Macro Market Sentiment\n"]
            vix_line = ""
            skew_line = ""

            lines.append("## Major Benchmark Indices")
            for idx in indices:
                sym = idx.symbol
                last = getattr(idx, "last_price", None) or 0.0
                prev = getattr(idx, "previous_close", None) or last
                chg = round(last - prev, 2)
                chg_pct = round((chg / prev * 100), 2) if prev > 0 else 0.0
                name = getattr(idx, "short_name", None) or getattr(idx, "name", None) or sym

                if sym == "^VIX":
                    vix_line = f"- **VIX Volatility Gauge**: {last:.2f} ({chg:+.2f} / {chg_pct:+.2f}%)"
                elif sym == "^SKEW":
                    skew_line = f"- **SKEW Tail Risk Index**: {last:.2f} ({chg:+.2f} / {chg_pct:+.2f}%)"
                else:
                    lines.append(f"- **{name} ({sym})**: ${last:.2f} ({chg:+.2f} / {chg_pct:+.2f}%)")

            if vix_line or skew_line:
                lines.append("\n## Volatility & Tail-Risk Regimes")
                if vix_line:
                    lines.append(vix_line)
                if skew_line:
                    lines.append(skew_line)

            return "\n".join(lines)
        except Exception as exc:
            return f"# Macro Sentiment Error\n\nUnable to retrieve market sentiment: {exc}"

    @server.resource("portfolio://stocks/{symbol}/summary")
    @with_app_context
    def stock_summary(symbol: str) -> str:
        """Markdown quick-card snapshot of a stock quote and technical indicators."""
        sym = symbol.strip().upper()
        stock = stock_service.get_stock_by_symbol(sym)
        if not stock:
            return f"# Stock Not Found\n\nSymbol `{sym}` is not currently tracked."

        lines = [
            f"# {stock.symbol} — {stock.name}",
            f"- **Sector**: {stock.sector} | **Exchange**: {stock.exchange or 'N/A'}",
            f"- **Last Price**: ${stock.last_price:.2f}" if stock.last_price else "- **Last Price**: N/A",
            f"- **Previous Close**: ${stock.previous_close:.2f}" if stock.previous_close else "",
            f"- **Day Range**: ${stock.day_low or 0:.2f} - ${stock.day_high or 0:.2f}",
        ]

        try:
            indicators = indicator_service.calculate_indicators(sym)
            lines.append("\n## Technical Indicators")
            for key, val in indicators.items():
                if isinstance(val, dict):
                    status = val.get("status", "ok")
                    num_val = val.get("value")
                    label = val.get("label", key)
                    if num_val is not None:
                        lines.append(f"- **{label}**: {num_val} ({status})")
                    else:
                        lines.append(f"- **{label}**: {status}")
        except Exception:
            pass

        return "\n".join([line for line in lines if line])

    @server.resource("portfolio://stocks/{symbol}/dna")
    @with_app_context
    def stock_dna(symbol: str) -> str:
        """Markdown snapshot of an asset's behavioral DNA, volatility, and optimal strategy."""
        sym = symbol.strip().upper()
        try:
            profile = asset_profile_service.AssetProfileService.get_asset_profile(sym)
            if profile.get("status") == "error":
                return f"# Asset DNA Error\n\nUnable to evaluate DNA for {sym}: {profile.get('error')}"

            lines = [
                f"# Asset DNA Profile: {sym}",
                f"- **Behavioral Character**: {profile.get('profile_label', 'Unknown')}",
                f"- **Trend Efficiency (Kaufman ER)**: {profile.get('trend_efficiency', 0.0)} ({profile.get('efficiency_label', 'N/A')})",
                f"- **Daily Volatility (ATR-14 %)**: {profile.get('daily_vol_pct', 0.0)}% ({profile.get('vol_label', 'N/A')})",
                f"- **Cycle Max Drawdown**: {profile.get('max_drawdown_pct', 0.0)}% ({profile.get('drawdown_label', 'N/A')})",
                f"- **Secular Drift (CAGR %)**: {profile.get('cagr_pct', 0.0)}%",
            ]

            preset = profile.get("preset") or {}
            if preset:
                lines.append(f"\n## Recommended Active Strategy")
                lines.append(f"- **Model**: {preset.get('label', 'Default')}")
                lines.append(f"- **Rationale**: {preset.get('reason', 'N/A')}")

            cand = profile.get("empirical_candidate") or {}
            if cand:
                lines.append(f"\n## Historical Backtest Performance")
                lines.append(f"- **Strategy Return**: {cand.get('strategy_return_pct', 0.0):+.1f}%")
                lines.append(f"- **Benchmark Return**: {cand.get('benchmark_return_pct', 0.0):+.1f}%")
                lines.append(f"- **Alpha**: {cand.get('alpha_pct', 0.0):+.1f}%")
                lines.append(f"- **Win Rate**: {cand.get('win_rate_pct', 0.0):.0f}%")

            return "\n".join(lines)
        except Exception as exc:
            return f"# Asset DNA Error\n\nFailed to evaluate DNA for {sym}: {exc}"

    @server.resource("portfolio://stocks/{symbol}/catalysts")
    @with_app_context
    def stock_catalysts(symbol: str) -> str:
        """Markdown list of prediction market catalysts for the given stock ticker."""
        sym = symbol.strip().upper()
        try:
            catalysts = catalyst_service.get_stock_catalysts(sym, limit=10)
            if not catalysts:
                return f"# Prediction Market Catalysts for {sym}\n\nNo active prediction markets found for {sym}."

            lines = [f"# Prediction Market Catalysts for {sym}\n"]
            for cat in catalysts:
                title = cat.get("title", "Untitled Event")
                prob = cat.get("probability", cat.get("prob_yes"))
                prob_str = f"{round(prob * 100)}%" if prob is not None else "N/A"
                vol = cat.get("volume_usd", 0.0)
                vol_str = f"${vol:,.0f}" if vol else "$0"
                date_str = cat.get("end_date") or cat.get("target_date") or "Ongoing"
                lines.append(f"- **{title}**")
                lines.append(f"  - **Odds / Probability**: {prob_str}")
                lines.append(f"  - **24h Volume**: {vol_str} | **Resolution Date**: {date_str}")

            return "\n".join(lines)
        except Exception as exc:
            return f"# Catalysts Error\n\nFailed to fetch catalysts for {sym}: {exc}"

"""Tool definitions for PortfolioWatcher MCP server."""

from datetime import datetime, timezone
import os
from typing import Any, Dict, List, Optional

from portfolio.api.serializers import serialize_account, serialize_price, serialize_stock
from portfolio.core.logging import get_logger
from portfolio.mcp.server import with_app_context
from portfolio.services import (
    account_service,
    asset_profile_service,
    catalyst_service,
    chart_service,
    document_service,
    index_service,
    indicator_service,
    simulation_service,
    stock_service,
)

logger = get_logger(__name__)

_LOG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "mcp_access.log")


def _log_call(tool_name: str, **kwargs):
    logger.info("MCP Tool Executed: %s %s", tool_name, kwargs)
    try:
        with open(_LOG_PATH, "a") as f:
            f.write(f"{datetime.now(timezone.utc).isoformat()} | Tool: {tool_name} | Args: {kwargs}\n")
    except Exception:
        pass


def register_tools(server) -> None:
    """Register all domain tools on the MCPServer instance."""

    # ---------------------------------------------------------
    # 1. Portfolio / Account Management Tools
    # ---------------------------------------------------------

    @server.tool()
    @with_app_context
    def list_accounts() -> List[Dict[str, Any]]:
        """List all investment accounts/portfolios in PortfolioWatcher.

        Returns an array of accounts with id, name, and account type (e.g. taxable, ira).
        """
        _log_call("list_accounts")
        accounts = account_service.list_accounts()
        results = []
        for acc in accounts:
            holdings = account_service.get_account_holdings(acc.id)
            results.append({
                "id": acc.id,
                "name": acc.name,
                "type": acc.type,
                "category_id": getattr(acc, "category_id", None),
                "holding_count": len(holdings),
            })
        return results

    @server.tool()
    @with_app_context
    def list_account_categories() -> Dict[str, Any]:
        """List all portfolio account categories configured in PortfolioWatcher.

        Categories group investment accounts into thematic or institutional buckets
        (e.g. 'Core Wealth', 'Tactical Alpha', 'Retirement', 'Speculative').
        """
        _log_call("list_account_categories")
        try:
            categories = account_service.list_categories()
            return {
                "count": len(categories),
                "categories": [
                    {
                        "id": c.id,
                        "name": c.name,
                        "sort_order": getattr(c, "sort_order", 0),
                    }
                    for c in categories
                ],
            }
        except Exception as exc:
            return {"error": str(exc)}

    @server.tool()
    @with_app_context
    def get_account_holdings(account_id: int) -> Dict[str, Any]:
        """Get all stock holdings for a specific portfolio account.

        Provides holding details including shares, average cost, current market price,
        total cost basis, total market value, and unrealized gain/loss ($ and %).

        Args:
            account_id: The integer ID of the account.
        """
        _log_call("get_account_holdings", account_id=account_id)
        account = account_service.get_account(account_id)
        if not account:
            return {"error": f"Account with ID {account_id} not found."}

        holdings = account_service.get_account_holdings(account_id)
        holdings_data = []
        total_cost = 0.0
        total_market_value = 0.0

        for h in holdings:
            if getattr(h, "is_section_header", False) or not h.symbol:
                continue
            stock = stock_service.get_stock_by_symbol(h.symbol)
            current_price = getattr(stock, "last_price", None) or h.avg_cost
            cost_basis = round(h.shares * h.avg_cost, 2)
            market_val = round(h.shares * current_price, 2)
            gain_loss = round(market_val - cost_basis, 2)
            gain_loss_pct = (
                round((gain_loss / cost_basis) * 100, 2) if cost_basis > 0 else 0.0
            )

            total_cost += cost_basis
            total_market_value += market_val

            holdings_data.append({
                "symbol": h.symbol,
                "shares": h.shares,
                "avg_cost": h.avg_cost,
                "current_price": current_price,
                "cost_basis": cost_basis,
                "market_value": market_val,
                "unrealized_gain_loss": gain_loss,
                "unrealized_gain_loss_percent": gain_loss_pct,
                "sector": getattr(stock, "sector", "Unknown"),
                "name": getattr(stock, "name", h.symbol),
            })

        total_gain_loss = round(total_market_value - total_cost, 2)
        total_gain_loss_pct = (
            round((total_gain_loss / total_cost) * 100, 2) if total_cost > 0 else 0.0
        )

        return {
            "account": serialize_account(account),
            "summary": {
                "total_cost_basis": round(total_cost, 2),
                "total_market_value": round(total_market_value, 2),
                "total_unrealized_gain_loss": total_gain_loss,
                "total_unrealized_gain_loss_percent": total_gain_loss_pct,
                "holding_count": len(holdings_data),
            },
            "holdings": holdings_data,
        }

    @server.tool()
    @with_app_context
    def get_portfolio_summary(account_id: Optional[int] = None) -> Dict[str, Any]:
        """Get aggregate portfolio summary (total market value, cost basis, unrealized P&L).

        Args:
            account_id: Optional specific account ID. If omitted, aggregates across all investment accounts.
        """
        _log_call("get_portfolio_summary", account_id=account_id)
        if account_id is not None:
            data = get_account_holdings(account_id)
            if "error" in data:
                return data
            return {
                "account_id": account_id,
                "account_name": data.get("account", {}).get("name"),
                "summary": data.get("summary", {}),
            }

        accounts = account_service.list_accounts()
        total_market_val = 0.0
        total_cost = 0.0
        total_positions = 0
        account_summaries = []

        for acc in accounts:
            acc_data = get_account_holdings(acc.id)
            if "summary" in acc_data:
                s = acc_data["summary"]
                total_market_val += s.get("total_market_value", 0.0)
                total_cost += s.get("total_cost_basis", 0.0)
                total_positions += s.get("holding_count", 0)
                account_summaries.append({
                    "id": acc.id,
                    "name": acc.name,
                    "market_value": s.get("total_market_value", 0.0),
                    "unrealized_gain_loss": s.get("total_unrealized_gain_loss", 0.0),
                    "holding_count": s.get("holding_count", 0),
                })

        total_gain_loss = round(total_market_val - total_cost, 2)
        total_gain_loss_pct = (
            round((total_gain_loss / total_cost * 100), 2) if total_cost > 0 else 0.0
        )

        return {
            "total_market_value": round(total_market_val, 2),
            "total_cost_basis": round(total_cost, 2),
            "total_unrealized_gain_loss": total_gain_loss,
            "total_unrealized_gain_loss_percent": total_gain_loss_pct,
            "total_positions": total_positions,
            "account_count": len(accounts),
            "accounts": account_summaries,
        }

    @server.tool()
    @with_app_context
    def get_holdings(account_id: Optional[int] = None) -> Dict[str, Any]:
        """Get all stock positions across accounts or for a specific account with weights and valuations.

        Args:
            account_id: Optional account ID to inspect. If omitted, returns holdings across all accounts.
        """
        _log_call("get_holdings", account_id=account_id)
        if account_id is not None:
            return get_account_holdings(account_id)

        accounts = account_service.list_accounts()
        all_holdings = []
        total_market_val = 0.0
        total_cost = 0.0

        for acc in accounts:
            acc_data = get_account_holdings(acc.id)
            for h in acc_data.get("holdings", []):
                h_copy = dict(h)
                h_copy["account_id"] = acc.id
                h_copy["account_name"] = acc.name
                all_holdings.append(h_copy)
                total_market_val += h.get("market_value", 0.0)
                total_cost += h.get("cost_basis", 0.0)

        for h in all_holdings:
            mv = h.get("market_value", 0.0)
            h["weight_percent"] = (
                round((mv / total_market_val * 100), 2) if total_market_val > 0 else 0.0
            )

        all_holdings.sort(key=lambda x: x.get("market_value", 0.0), reverse=True)

        return {
            "count": len(all_holdings),
            "total_market_value": round(total_market_val, 2),
            "total_cost_basis": round(total_cost, 2),
            "holdings": all_holdings,
        }

    @server.tool()
    @with_app_context
    def create_account(name: str, account_type: str = "taxable") -> Dict[str, Any]:
        """Create a new portfolio account shell in PortfolioWatcher.

        Args:
            name: The name of the portfolio (e.g. 'Long Term Tech', 'Retirement IRA').
            account_type: Type classification, e.g. 'taxable', 'ira', 'roth', 'crypto'.
        """
        try:
            account = account_service.create_account({"name": name, "type": account_type})
            return serialize_account(account)
        except Exception as exc:
            return {"error": str(exc)}

    @server.tool()
    @with_app_context
    def add_holding(
        account_id: int, symbol: str, shares: float, avg_cost: float
    ) -> Dict[str, Any]:
        """Add or update a stock holding in an account and auto-tracks the stock.

        Args:
            account_id: The ID of the target portfolio account.
            symbol: Ticker symbol (e.g. 'AAPL', 'MSFT', 'NVDA').
            shares: Number of shares owned (e.g. 10.5).
            avg_cost: Average purchase cost per share in USD.
        """
        try:
            payload = {"symbol": symbol.strip().upper(), "shares": shares, "avgCost": avg_cost}
            result = account_service.add_holding_to_account(account_id, payload)
            return {
                "success": True,
                "holding": {
                    "id": result["holding"].id,
                    "account_id": result["holding"].account_id,
                    "symbol": result["holding"].symbol,
                    "shares": result["holding"].shares,
                    "avg_cost": result["holding"].avg_cost,
                },
                "warning": result.get("warning"),
            }
        except Exception as exc:
            return {"error": str(exc)}

    # ---------------------------------------------------------
    # 2. Stock & Market Data Tools
    # ---------------------------------------------------------

    @server.tool()
    @with_app_context
    def list_stocks(asset_type: str = "stock") -> List[Dict[str, Any]]:
        """List all tracked stocks or market indices in PortfolioWatcher.

        Args:
            asset_type: Filter by 'stock', 'index', or 'all'. Defaults to 'stock'.
        """
        stocks = stock_service.list_stocks(
            asset_type=asset_type if asset_type != "all" else None
        )
        return [serialize_stock(s) for s in stocks]

    @server.tool()
    @with_app_context
    def get_stock_quote(symbol: str) -> Dict[str, Any]:
        """Get full market quote details for a tracked stock or index.

        Includes current price, day open/high/low, pre/post-market price and change,
        market cap, sector, exchange, and last updated time.

        Args:
            symbol: Ticker symbol (e.g. 'AAPL', '^GSPC').
        """
        _log_call("get_stock_quote", symbol=symbol)
        sym = symbol.strip().upper()
        stock = stock_service.get_stock_by_symbol(sym)
        if not stock:
            return {"error": f"Stock '{sym}' is not currently tracked. Use sync_stock_data to track it."}
        return serialize_stock(stock)

    @server.tool()
    @with_app_context
    def get_stock_fundamentals(symbol: str, refresh: bool = False) -> Dict[str, Any]:
        """Get corporate earnings calendar, EPS surprise history, and dividend metrics for a stock.

        Args:
            symbol: Ticker symbol (e.g. 'AAPL', 'MSFT').
            refresh: Whether to bypass the 12-hour cache and fetch fresh data from Yahoo Finance.
        """
        _log_call("get_stock_fundamentals", symbol=symbol, refresh=refresh)
        from portfolio.services import fundamental_service

        return fundamental_service.get_fundamentals(symbol.strip().upper(), refresh=refresh)

    @server.tool()
    @with_app_context
    def get_stock_history(symbol: str, limit: int = 30) -> Dict[str, Any]:
        """Get recent daily OHLCV price history bars for a stock.

        Args:
            symbol: Ticker symbol (e.g. 'AAPL').
            limit: Number of recent trading days to return (default: 30, max: 200).
        """
        sym = symbol.strip().upper()
        stock = stock_service.get_stock_by_symbol(sym)
        if not stock:
            return {"error": f"Stock '{sym}' not found."}

        prices = chart_service.get_stock_prices(sym)
        limit = min(max(1, limit), 200)
        recent_prices = prices[-limit:] if len(prices) > limit else prices

        return {
            "symbol": sym,
            "total_stored_days": len(prices),
            "returned_bars": len(recent_prices),
            "prices": [serialize_price(p) for p in recent_prices],
        }

    @server.tool()
    @with_app_context
    def sync_stock_data(symbol: str) -> Dict[str, Any]:
        """Sync real market data and 7-year price history from Yahoo Finance.

        If the stock is not already tracked, this tool registers and fetches it.

        Args:
            symbol: Ticker symbol (e.g. 'NVDA', 'TSLA').
        """
        sym = symbol.strip().upper()
        try:
            result = stock_service.add_stock(sym)
            stock = result["stock"]
            prices = result.get("prices", [])
            return {
                "symbol": sym,
                "name": stock.name,
                "sector": stock.sector,
                "last_price": stock.last_price,
                "stored_prices_count": len(prices),
                "created": result.get("created", False),
            }
        except Exception as exc:
            return {"error": str(exc)}

    @server.tool()
    @with_app_context
    def get_market_sentiment() -> Dict[str, Any]:
        """Get macro market sentiment regime, benchmark performance, and volatility risk gauges.

        Returns:
        - Major benchmark indices: S&P 500 (^GSPC), Nasdaq (^IXIC), Dow (^DJI), Russell 2000 (^RUT).
        - VIX Volatility Gauge (^VIX): Current level and regime (Low Volatility < 15, Normal 15-20, Elevated 20-28, High Fear / Panic > 28).
        - SKEW Tail Risk Index (^SKEW): Tail-risk probability gauge (< 130 Normal, 130-145 Moderate, > 145 Elevated Black Swan Risk).
        """
        _log_call("get_market_sentiment")
        try:
            indices = index_service.list_indices()
            benchmarks = []
            vix_info = None
            skew_info = None

            for idx in indices:
                sym = idx.symbol
                last = getattr(idx, "last_price", None) or 0.0
                prev = getattr(idx, "previous_close", None) or last
                chg = round(last - prev, 2)
                chg_pct = round((chg / prev * 100), 2) if prev > 0 else 0.0

                item = {
                    "symbol": sym,
                    "name": getattr(idx, "short_name", None) or getattr(idx, "name", None) or sym,
                    "last_price": last,
                    "change": chg,
                    "change_percent": chg_pct,
                }

                if sym == "^VIX":
                    regime = "Normal Volatility"
                    if last < 15.0:
                        regime = "Low Volatility / Complacency"
                    elif last <= 20.0:
                        regime = "Normal Volatility"
                    elif last <= 28.0:
                        regime = "Elevated Volatility / Caution"
                    else:
                        regime = "High Volatility / Panic"
                    item["regime"] = regime
                    vix_info = item
                elif sym == "^SKEW":
                    skew_regime = "Normal Tail Risk"
                    if last > 145.0:
                        skew_regime = "Elevated Black Swan / Tail Risk"
                    elif last >= 130.0:
                        skew_regime = "Moderate Outlier Risk"
                    item["regime"] = skew_regime
                    skew_info = item
                else:
                    benchmarks.append(item)

            return {
                "vix_gauge": vix_info,
                "skew_index": skew_info,
                "benchmarks": benchmarks,
            }
        except Exception as exc:
            return {"error": str(exc)}

    # ---------------------------------------------------------
    # 3. Technical Indicators & Strategy Simulation Tools
    # ---------------------------------------------------------

    @server.tool()
    @with_app_context
    def get_technical_indicators(symbol: str) -> Dict[str, Any]:
        """Calculate technical indicators from daily historical price data.

        Returns calculated indicator values and synthesized conditions:
        - Moving Averages: EMA-20, MA-50, MA-200 (trend orientation)
        - Bollinger Bands: BB20 Upper, Middle, Lower bands and bandwidth
        - RSI-14: Relative Strength Index (oversold < 30, overbought > 70)
        - MACD: MACD line, Signal line, Histogram, and bullish/bearish momentum
        - Stochastic (14, 3, 3): %K, %D momentum oscillator
        - On-Balance Volume (OBV): Cumulative volume flow vs 20-period SMA
        - Average True Range (ATR-14): Volatility and price expanse
        - Supertrend & Squeeze Momentum indicators
        - Bull Trend Runner: Multi-trend regime alignment

        Args:
            symbol: Ticker symbol (e.g. 'SPY', 'AAPL').
        """
        _log_call("get_technical_indicators", symbol=symbol)
        sym = symbol.strip().upper()
        stock = stock_service.get_stock_by_symbol(sym)
        if not stock:
            return {"error": f"Stock '{sym}' not found."}

        try:
            indicators = indicator_service.calculate_indicators(sym)
            return {
                "symbol": sym,
                "current_price": stock.last_price,
                "indicators": indicators,
            }
        except Exception as exc:
            return {"error": str(exc)}

    @server.tool()
    @with_app_context
    def get_asset_profile(symbol: str, lookback_days: int = 730) -> Dict[str, Any]:
        """Retrieve Asset DNA diagnostic profile, behavioral classification, and strategy fit.

        Analyzes an equity ticker's historical character:
        - Trend Efficiency: Kaufman Efficiency Ratio (ER) measuring directional smoothness vs chop.
        - Volatility Regime: ATR-14 % daily volatility.
        - Cycle Drawdown Severity: Peak-to-trough max historical drawdown.
        - Secular Growth (CAGR %): Annualized drift rate.
        - Adaptive Classification: 'Runaway Compounder', 'Cycle Oscillator', or 'Momentum Mover'.
        - Empirical Strategy Fit: Optimal model (Squeeze Momentum, Supertrend, Bull Trend Runner, etc.)
          with historical alpha, win rate, and drawdown mitigation metrics.

        Args:
            symbol: Ticker symbol (e.g. 'NVDA', 'AAPL', 'MSFT').
            lookback_days: Evaluation window in days (default: 730 / 2 years).
        """
        _log_call("get_asset_profile", symbol=symbol, lookback_days=lookback_days)
        sym = symbol.strip().upper()
        try:
            profile = asset_profile_service.AssetProfileService.get_asset_profile(
                sym, lookback_days=lookback_days
            )
            return profile
        except Exception as exc:
            return {"error": str(exc)}

    @server.tool()
    @with_app_context
    def simulate_strategy(
        symbol: str,
        strategy_ids: Optional[List[str]] = None,
        lookback_days: int = 730,
        macro_gate: bool = False,
    ) -> Dict[str, Any]:
        """Run a vectorized backtest simulation of algorithmic strategies on historical daily prices.

        Evaluates execution against a Buy & Hold benchmark:
        - Net return vs Buy & Hold (Alpha %)
        - Drawdown Shield: Maximum drawdown of the strategy vs benchmark
        - Trade Frequency & Win Rate: Total trades, winning trade %, win/loss distribution
        - Recent Trigger Actions: Timestamped entry (BUY) and exit (SELL) execution logs

        Supported built-in strategies:
        - 'supertrend': ATR trailing dynamic bands
        - 'bull_trend_runner': Multi-period moving average alignment trend rider
        - 'rsi14': Mean-reversion swing strategy
        - 'macd': Moving average convergence/divergence crossover
        - 'bb20': Bollinger Bands dip rebound
        - 'stoch14': Stochastic oscillator oversold rebound
        - 'ema20', 'ma50', 'ma200': Moving average trend followers

        Args:
            symbol: Ticker symbol (e.g. 'NVDA', 'SPY').
            strategy_ids: List of strategy IDs to combine (e.g. ['supertrend', 'bull_trend_runner']).
                          Defaults to ['supertrend'] if not provided.
            lookback_days: Historical simulation window in days (default: 730 / 2 years).
            macro_gate: If True, halts new buy entries when macro volatility (^VIX > 28 or ^SKEW > 145).
        """
        _log_call("simulate_strategy", symbol=symbol, strategy_ids=strategy_ids, lookback_days=lookback_days)
        sym = symbol.strip().upper()
        try:
            strat_list = strategy_ids or ["supertrend"]
            result = simulation_service.SimulationService.simulate_ensemble(
                symbol=sym,
                strategies=strat_list,
                lookback_days=lookback_days,
                macro_sentiment_gate={"enabled": True} if macro_gate else None,
            )
            dates = result.get("dates") or []
            strat_eq = result.get("strategy_equity") or []
            bench_eq = result.get("benchmark_equity") or []

            step = max(1, len(dates) // 50) if len(dates) > 50 else 1
            sampled_dates = dates[::step]
            sampled_strat = strat_eq[::step]
            sampled_bench = bench_eq[::step]
            if dates and (not sampled_dates or dates[-1] != sampled_dates[-1]):
                sampled_dates.append(dates[-1])
                sampled_strat.append(strat_eq[-1])
                sampled_bench.append(bench_eq[-1])

            return {
                "symbol": sym,
                "strategies": strat_list,
                "lookback_days": lookback_days,
                "macro_gate_active": macro_gate,
                "metrics": result.get("metrics", {}),
                "recent_trades": (result.get("trades") or [])[-10:],
                "current_posture": result.get("current_posture", {}),
                "equity_curve": {
                    "dates": sampled_dates,
                    "strategy_equity": [round(float(x), 2) for x in sampled_strat],
                    "benchmark_equity": [round(float(x), 2) for x in sampled_bench],
                },
            }
        except Exception as exc:
            return {"error": str(exc)}

    # ---------------------------------------------------------
    # 4. Catalysts & Prediction Market Tools
    # ---------------------------------------------------------

    @server.tool()
    @with_app_context
    def get_stock_catalysts(symbol: str, limit: int = 15) -> Dict[str, Any]:
        """Fetch impending prediction market catalysts and event odds for an equity ticker.

        Queries crowd-sourced prediction markets (Polymarket) for events directly impacting
        the company, such as earnings beats/misses, major product releases, regulatory/antitrust rulings,
        or key revenue milestones.

        Args:
            symbol: Ticker symbol (e.g. 'NVDA', 'TSLA', 'AAPL').
            limit: Maximum number of events to return (default: 15).
        """
        _log_call("get_stock_catalysts", symbol=symbol, limit=limit)
        sym = symbol.strip().upper()
        try:
            events = catalyst_service.get_stock_catalysts(symbol=sym, limit=min(max(1, limit), 50))
            return {
                "symbol": sym,
                "count": len(events),
                "catalysts": events,
            }
        except Exception as exc:
            return {"error": str(exc)}

    @server.tool()
    @with_app_context
    def get_macro_catalysts(category: Optional[str] = None, limit: int = 20) -> Dict[str, Any]:
        """Fetch forward-looking macroeconomic prediction market events and probabilities.

        Retrieves high-volume Polymarket prediction markets across macro risk categories:
        - Interest rates (Fed rate cuts, FOMC decisions)
        - Macro health (Recession odds, US GDP, inflation/CPI)
        - Geopolitics & trade (Tariffs, elections, commodities/oil)

        Args:
            category: Optional filter: 'fed', 'economy', 'geopolitics', or 'all'.
            limit: Maximum number of events to return (default: 20).
        """
        _log_call("get_macro_catalysts", category=category, limit=limit)
        try:
            events = catalyst_service.get_macro_catalysts(
                category=category if category != "all" else None,
                limit=min(max(1, limit), 50),
            )
            return {
                "category": category or "all",
                "count": len(events),
                "catalysts": events,
            }
        except Exception as exc:
            return {"error": str(exc)}

    # ---------------------------------------------------------
    # 5. Fundamental Documents, Filings & Notes Tools
    # ---------------------------------------------------------

    @server.tool()
    @with_app_context
    def get_stock_documents(
        symbol: str, category: Optional[str] = None, limit: int = 10
    ) -> Dict[str, Any]:
        """Fetch fundamental documents, SEC filings, insider trades, and news.

        Args:
            symbol: Ticker symbol (e.g. 'AAPL').
            category: Optional filter: 'filings' (10-K, 10-Q, 8-K), 'insider' (Form 4),
                      'news' (headlines & summaries), or 'notes'. Leave empty for all.
            limit: Maximum number of items to return (default: 10, max: 50).
        """
        sym = symbol.strip().upper()
        stock = stock_service.get_stock_by_symbol(sym)
        if not stock:
            return {"error": f"Stock '{sym}' not found."}

        cat = category.strip() if category else None
        limit = min(max(1, limit), 50)

        docs = document_service.get_stock_documents(
            symbol=sym,
            category=cat,
            limit=limit,
        )
        return {
            "symbol": sym,
            "category": cat or "all",
            "count": len(docs),
            "documents": docs,
        }

    @server.tool()
    @with_app_context
    def save_stock_note(
        symbol: str,
        title: str,
        content: str,
        note_id: Optional[int] = None,
        upsert_same_day: bool = True,
    ) -> Dict[str, Any]:
        """Save, update, or append a research note or AI investment thesis for a stock.

        The saved note will immediately appear in PortfolioWatcher's Notes tab for this stock.
        If `note_id` is provided, the existing note will be updated in place.
        If `note_id` is omitted and `upsert_same_day` is True (default), an existing note with the
        same title created today will be updated instead of creating a duplicate row.

        Args:
            symbol: Ticker symbol (e.g. 'NVDA').
            title: Note title or headline (e.g. 'Q3 Earnings Thesis').
            content: Markdown or text content of the research note.
            note_id: Optional existing note ID to edit in place.
            upsert_same_day: If True, updates existing note with same title from today. Defaults to True.
        """
        _log_call("save_stock_note", symbol=symbol, title=title, note_id=note_id)
        sym = symbol.strip().upper()
        stock = stock_service.get_stock_by_symbol(sym)
        if not stock:
            return {"error": f"Stock '{sym}' not found."}

        try:
            payload: Dict[str, Any] = {"title": title, "content": content}
            if note_id is not None:
                payload["note_id"] = note_id
            elif upsert_same_day:
                payload["upsert_same_title"] = True

            saved = document_service.save_stock_note(sym, payload)
            action = "updated" if (note_id or saved.get("metadata", {}).get("updated_at") != saved.get("metadata", {}).get("created_at")) else "saved"
            return {
                "success": True,
                "note": saved,
                "message": f"Research note {action} for {sym}.",
            }
        except Exception as exc:
            return {"error": str(exc)}

    @server.tool()
    @with_app_context
    def add_stock_note(
        symbol: str,
        title: str,
        content: str,
        note_id: Optional[int] = None,
        upsert_same_day: bool = True,
    ) -> Dict[str, Any]:
        """Add or update an investment thesis or research note for a stock (alias for save_stock_note).

        The saved note will immediately appear in PortfolioWatcher's Notes tab for this stock.

        Args:
            symbol: Ticker symbol (e.g. 'NVDA').
            title: Headline or note subject (e.g. 'Asset DNA Evaluation').
            content: Detailed thesis or analysis text.
            note_id: Optional existing note ID to edit.
            upsert_same_day: If True, updates existing note with same title from today. Defaults to True.
        """
        return save_stock_note(
            symbol=symbol,
            title=title,
            content=content,
            note_id=note_id,
            upsert_same_day=upsert_same_day,
        )

    @server.tool()
    @with_app_context
    def delete_stock_note(symbol: str, note_id: int) -> Dict[str, Any]:
        """Delete a saved research note for a stock.

        Args:
            symbol: Ticker symbol (e.g. 'NVDA').
            note_id: The integer ID of the note to delete.
        """
        _log_call("delete_stock_note", symbol=symbol, note_id=note_id)
        sym = symbol.strip().upper()
        stock = stock_service.get_stock_by_symbol(sym)
        if not stock:
            return {"error": f"Stock '{sym}' not found."}

        try:
            success = document_service.delete_stock_note(sym, str(note_id))
            if not success:
                return {"error": f"Note with ID {note_id} not found for {sym}."}
            return {
                "success": True,
                "message": f"Research note #{note_id} deleted for {sym}.",
            }
        except Exception as exc:
            return {"error": str(exc)}

    @server.tool()
    @with_app_context
    def get_stock_notes(symbol: str) -> Dict[str, Any]:
        """Retrieve all research notes previously saved for a stock.

        Returns timestamped notes with id, title, content, created_at, and updated_at.

        Args:
            symbol: Ticker symbol (e.g. 'NVDA').
        """
        sym = symbol.strip().upper()
        stock = stock_service.get_stock_by_symbol(sym)
        if not stock:
            return {"error": f"Stock '{sym}' not found."}

        notes = document_service.get_stock_documents(symbol=sym, category="notes")
        return {"symbol": sym, "notes": notes}

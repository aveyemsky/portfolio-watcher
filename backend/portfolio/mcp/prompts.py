"""Prompt templates for PortfolioWatcher MCP server."""


def register_prompts(server) -> None:
    """Register prompt templates for common investment research workflows."""

    @server.prompt("analyze_stock")
    def analyze_stock_prompt(symbol: str) -> str:
        """Deep multi-dimensional research workflow combining technicals, DNA, catalysts, and fundamentals."""
        sym = symbol.strip().upper()
        return (
            f"Please conduct a comprehensive investment research analysis on {sym} using PortfolioWatcher tools:\n\n"
            f"1. Fetch the latest market quote using `get_stock_quote('{sym}')`.\n"
            f"2. Inspect Asset DNA and quantitative behavioral profile using `get_asset_profile('{sym}')`.\n"
            f"3. Check technical indicator signals (Moving Averages, RSI, MACD, Bollinger Bands, ATR, Stochastics, OBV) "
            f"using `get_technical_indicators('{sym}')`.\n"
            f"4. Check forward-looking crowd prediction market catalysts using `get_stock_catalysts('{sym}')`.\n"
            f"5. Retrieve recent SEC filings, insider transactions, and news headlines "
            f"using `get_stock_documents('{sym}', limit=10)`.\n"
            f"6. Synthesize the findings into an executive briefing:\n"
            f"   - **Behavioral DNA & Classification**: Asset character (Compounder vs Cycle Oscillator), volatility regime, optimal active model.\n"
            f"   - **Current Technical Setup**: Trend direction, momentum status, key support/resistance levels.\n"
            f"   - **Catalysts & Prediction Markets**: Impending high-probability events or crowd sentiment odds.\n"
            f"   - **Fundamental & Filing Context**: Notable insider transactions or recent SEC disclosures.\n"
            f"   - **Bottom Line**: Objective, actionable summary (bullish momentum, pullback entry zone, or defensive caution).\n"
        )

    @server.prompt("portfolio_health_check")
    def portfolio_health_check_prompt(account_id: int) -> str:
        """Portfolio audit reviewing diversification, performance, asset DNA, and risk metrics."""
        return (
            f"Please run a health audit on portfolio account ID #{account_id} using PortfolioWatcher tools:\n\n"
            f"1. Retrieve the account holdings and valuation summary using `get_account_holdings({account_id})`.\n"
            f"2. For each holding, inspect its technical positioning using `get_technical_indicators` and behavioral DNA using `get_asset_profile`.\n"
            f"3. Analyze and summarize:\n"
            f"   - **Sector & Category Concentration**: Identify any overweight or under-diversified exposures.\n"
            f"   - **Top Winners & Losers**: Highlight positions with large unrealized gains or losses.\n"
            f"   - **Technical & Drawdown Fragility**: Flag any holdings currently trading below their 200-day moving average "
            f"or in deep cycle drawdown.\n"
            f"   - **Actionable Rebalancing Observations**: Suggestions for risk management and allocation.\n"
        )

    @server.prompt("macro_market_briefing")
    def macro_market_briefing_prompt() -> str:
        """Macro risk and market regime briefing synthesizing index performance, VIX/SKEW, and macro catalysts."""
        return (
            "Please generate an executive macroeconomic and market regime briefing using PortfolioWatcher tools:\n\n"
            "1. Fetch major benchmark performance and volatility gauges using `get_market_sentiment()`.\n"
            "2. Retrieve high-stakes macroeconomic prediction markets using `get_macro_catalysts(limit=15)`.\n"
            "3. Synthesize the macro landscape:\n"
            "   - **Market Regime**: Broad index momentum (S&P 500, Nasdaq, Russell 2000 breadth).\n"
            "   - **Volatility & Tail Risk**: VIX regime (Complacency, Normal, Elevated, Panic) and SKEW tail-risk readings.\n"
            "   - **Policy & Event Odds**: Fed interest rate cut expectations, recession odds, and geopolitical/trade predictions from Polymarket.\n"
            "   - **Strategic Posture**: Risk-on expansion, selective stock-picking, or defensive capital preservation.\n"
        )

    @server.prompt("technical_indicator_audit")
    def technical_indicator_audit_prompt(symbol: str) -> str:
        """Comprehensive technical indicator evaluation across trend, momentum, and volatility."""
        sym = symbol.strip().upper()
        return (
            f"Please conduct an in-depth technical analysis for {sym} using PortfolioWatcher tools:\n\n"
            f"1. Fetch current price and session trading levels using `get_stock_quote('{sym}')`.\n"
            f"2. Compute standard technical indicators using `get_technical_indicators('{sym}')`.\n"
            f"3. Synthesize the technical health across 3 dimensions:\n"
            f"   - **Trend & Moving Averages**: Price location relative to EMA-20, MA-50, and MA-200. Check for golden/death cross alignment.\n"
            f"   - **Momentum & Oscillators**: RSI-14 levels (overbought/oversold) and MACD signal line / histogram expansion.\n"
            f"   - **Volatility & Bands**: Bollinger Bands (band width, channel position) and ATR-14 average daily volatility.\n"
            f"4. Provide a structured summary with key support/resistance levels and near-term technical posture.\n"
        )

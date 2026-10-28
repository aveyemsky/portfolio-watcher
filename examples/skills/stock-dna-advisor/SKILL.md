---
name: stock-dna-advisor
description: Performs an in-depth stock evaluation combining Asset DNA, Polymarket prediction catalysts, and technical indicators. Use when the user asks to analyze a stock, evaluate a ticker, or formulate an investment thesis.
---

# Stock DNA Advisor Skill

This skill performs a rigorous, 360-degree investment analysis on any stock tracked in PortfolioWatcher by combining quantitative technical indicators, fundamental Asset DNA profiles, and real-time prediction market catalysts.

## When to Run
- User asks: *"Analyze NVDA"*, *"What's our thesis on AAPL?"*, *"Should I buy/sell TSLA?"*
- User wants to update or establish an investment thesis and price target.

## MCP Tools Used
1. `get_asset_profile`: Retrieves the stock's recorded tier, conviction level, target price, and thesis.
2. `get_stock_catalysts`: Fetches prediction market probabilities (Polymarket) and scheduled earnings events.
3. `get_stock_quote`: Retrieves the current price, day change, and 52-week range.
4. `get_technical_indicators`: Evaluates RSI, MACD momentum, Bollinger Bands, and Supertrend.
5. `save_stock_note` (or `add_stock_note`): Offers to persist the synthesized findings directly into PortfolioWatcher.

## Step-by-Step Execution Workflow

1. **Retrieve Fundamental Thesis & Asset Profile**:
   - Call `get_asset_profile(symbol)`.
   - Note the assigned tier (e.g., Tier 1 Core, Speculative), target price, and original bull/bear thesis.

2. **Retrieve Prediction Catalysts**:
   - Call `get_stock_catalysts(symbol)`.
   - Extract upcoming earnings dates and any active prediction market questions/odds relating to the company.

3. **Evaluate Quantitative Technicals**:
   - Call `get_stock_quote(symbol)` to obtain the current price.
   - Call `get_technical_indicators(symbol)`.
   - Check trend filters:
     - Is price above or below the MA-50 and MA-200?
     - What is the Supertrend signal (Bullish / Bearish trailing stop)?
     - Is RSI overbought (> 70) or oversold (< 30)?
     - Is MACD histogram expanding or contracting?

4. **Synthesize & Recommend**:
   Deliver a clean analysis:
   - **Asset Profile & Thesis Alignment**: How current price compares to your target price; whether original thesis remains intact.
   - **Catalysts & Prediction Markets**: What near-term events could move the stock and what market probabilities say.
   - **Technical Timing & Stop Levels**: Favorable entry/exit levels based on Supertrend and moving averages.
   - **Save Note**: Ask the user: *"Would you like me to save this summary to your PortfolioWatcher notes for this stock?"* (If yes, call `add_stock_note`).

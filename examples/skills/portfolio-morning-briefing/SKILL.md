---
name: portfolio-morning-briefing
description: Generates an executive morning market pulse and portfolio vulnerability scan using PortfolioWatcher MCP tools. Use when the user asks for a daily portfolio briefing, morning update, or macro risk check.
---

# Portfolio Morning Briefing Skill

This skill equips an AI assistant to deliver an institutional-grade daily market briefing and portfolio vulnerability assessment using the PortfolioWatcher Model Context Protocol (MCP) server.

## When to Run
- User asks: *"Give me my morning briefing"*, *"How is my portfolio looking today?"*, *"Any macro risks I should worry about?"*
- Triggered automatically via a scheduled morning timer.

## MCP Tools Used
1. `get_market_sentiment`: Checks the VIX level, SKEW index, and Fear & Greed phase.
2. `get_macro_catalysts`: Fetches upcoming CPI prints, FOMC meetings, and macro prediction market events.
3. `get_portfolio_summary`: Retrieves total equity, cash balance, and overall day gain/loss.
4. `get_holdings`: Lists current stock positions with allocations and market values.

## Step-by-Step Execution Workflow

1. **Check Market Regime**:
   - Call `get_market_sentiment()`.
   - Identify whether the market is in Extreme Fear, Neutral, or Extreme Greed.
   - Note if VIX is elevated (> 20) or SKEW is elevated (> 140).

2. **Scan Macro Catalysts**:
   - Call `get_macro_catalysts()`.
   - Identify major market-moving catalysts occurring within the next 48 hours (e.g., Fed rate decision odds, jobs report).

3. **Audit Portfolio Exposure**:
   - Call `get_portfolio_summary()`.
   - Call `get_holdings()`.
   - Identify the top 3 holdings by weight (concentration risk).
   - Flag any position with an unrealized loss exceeding 10% or single-stock allocation exceeding 25%.

4. **Deliver Structured Executive Briefing**:
   Format the output into 3 concise sections:
   - **1. Market Regime & Sentiment**: VIX, Fear & Greed sentiment, key macro catalysts today.
   - **2. Portfolio Vital Signs**: Total portfolio value, cash percentage, top 3 holdings concentration.
   - **3. Risk Radar & Action Items**: Any vulnerable positions, upcoming catalyst exposure, and suggested hedging or rebalancing actions.

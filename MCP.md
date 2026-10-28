# PortfolioWatcher MCP (Model Context Protocol) Integration Guide

PortfolioWatcher includes a native **Model Context Protocol (MCP)** server. This allows AI assistants—such as **Claude Desktop**, **Cursor**, **ChatGPT Desktop**, **Google Gemini**, and **Antigravity**—to interact directly with your portfolio holdings, market quotes, technical indicators, SEC filings, prediction market catalysts (Polymarket), macro sentiment (VIX & SKEW), and algorithmic backtesting simulations.

---

## 1. Quick Start

The MCP server runs within the backend Python virtual environment.

### Mode A: Standard I/O (`stdio`) — Recommended for Local LLMs
```bash
cd backend
source .venv/bin/activate
python -m portfolio.mcp.server
```

### Mode B: Server-Sent Events (`sse`) — For Remote or Web AI Agents
```bash
cd backend
source .venv/bin/activate
python -m portfolio.mcp.server --transport sse --host 127.0.0.1 --port 8765
```

---

## 2. Client Setup

### A. Claude Desktop
Add PortfolioWatcher to your Claude Desktop configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "portfoliowatcher": {
      "command": "/path/to/portfolio-watcher/backend/.venv/bin/python",
      "args": [
        "-m",
        "portfolio.mcp.server"
      ],
      "cwd": "/path/to/portfolio-watcher/backend"
    }
  }
}
```

### B. Cursor IDE
In Cursor, navigate to **Settings > Features > MCP**, click **Add New MCP Server**:
- **Name**: `PortfolioWatcher`
- **Type**: `command`
- **Command**: `/path/to/portfolio-watcher/backend/.venv/bin/python -m portfolio.mcp.server`

Or add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "portfoliowatcher": {
      "command": "/path/to/portfolio-watcher/backend/.venv/bin/python",
      "args": ["-m", "portfolio.mcp.server"],
      "cwd": "/path/to/portfolio-watcher/backend"
    }
  }
}
```

### C. ChatGPT Desktop (macOS)
Enable **Developer Mode** in ChatGPT Settings > Advanced:
1. Go to **Settings > Workspaces / Developer Tools > MCP Servers**.
2. Add a new server pointing to `/path/to/portfolio-watcher/backend/.venv/bin/python` with args `["-m", "portfolio.mcp.server"]`.

### D. Google Gemini & Antigravity
For Python SDK / LangChain / Antigravity integration:
```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

server_params = StdioServerParameters(
    command="/path/to/portfolio-watcher/backend/.venv/bin/python",
    args=["-m", "portfolio.mcp.server"],
    cwd="/path/to/portfolio-watcher/backend",
)

async with stdio_client(server_params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        tools = await session.list_tools()
        print("Available tools:", [t.name for t in tools])
```

---

## 3. Available Tools Reference

| Category | Tool | Parameters | Description |
| :--- | :--- | :--- | :--- |
| **Portfolios** | `list_accounts` | *(none)* | Returns all portfolios with ID, name, account type, category ID, and holding counts. |
| | `list_account_categories` | *(none)* | Returns configured portfolio categories with ID, name, sort order. |
| | `get_portfolio_summary` | `account_id: int?` | Returns total portfolio equity, cost basis, and unrealized gain/loss ($ and %) across all accounts or for a specific account. |
| | `get_holdings` | `account_id: int?` | Returns all stock positions across accounts with calculated portfolio weight percentages and market values. |
| | `get_account_holdings` | `account_id: int` | Returns holdings for a specific account with current market value, cost basis, unrealized P&L ($ and %). |
| | `create_account` | `name: str`, `account_type: str` | Creates a new portfolio shell (e.g. taxable, IRA). |
| | `add_holding` | `account_id`, `symbol`, `shares`, `avg_cost` | Adds/updates a holding and auto-tracks the stock. |
| **Market Data** | `list_stocks` | `asset_type: str` ("stock" \| "index" \| "all") | Lists tracked symbols, sectors, and quotes. |
| | `get_stock_quote` | `symbol: str` | Detailed quotes: price, pre/post-market, day range, volume. |
| | `get_stock_history` | `symbol: str`, `limit: int` (default 30) | Historical daily OHLCV candlestick bars. |
| | `get_stock_fundamentals` | `symbol: str`, `refresh: bool` (default False) | Corporate earnings calendar, consensus EPS estimates, historical earnings surprises, and dividend yields. |
| | `sync_stock_data` | `symbol: str` | Syncs historical price history from fixed start date (2017-01-01) from Yahoo Finance. |
| | `get_market_sentiment` | *(none)* | Macro regime: S&P 500, Nasdaq, Dow, Russell 2000, VIX volatility regime, and SKEW tail risk index. |
| **Indicators & Quant** | `get_technical_indicators` | `symbol: str` | Computes RSI-14, MACD, Bollinger Bands, EMA-20, MA-50, MA-200, Stochastic, OBV, ATR-14. |
| | `get_asset_profile` | `symbol: str`, `lookback_days: int` (default 730) | Evaluates Asset DNA: Trend Efficiency (Kaufman ER), ATR Volatility %, Cycle Max Drawdown, Secular CAGR %, and empirical best active strategy. |
| | `simulate_strategy` | `symbol: str`, `strategy_ids: list`, `lookback_days: int`, `macro_gate: bool` | Vectorized backtest simulation of algorithmic strategies (Supertrend, Bull Trend Runner, MA crossovers) vs Buy & Hold with trade logs and drawdown shields. |
| **Prediction Catalysts** | `get_stock_catalysts` | `symbol: str`, `limit: int` (default 15) | Impending Polymarket crowd-prediction events & odds for an equity ticker (earnings, product releases, antitrust). |
| | `get_macro_catalysts` | `category: str`, `limit: int` (default 20) | High-stakes macro prediction markets across interest rates (Fed cuts), recession odds, inflation, tariffs, and geopolitics. |
| **Documents & Notes** | `get_stock_documents` | `symbol: str`, `category: str`, `limit: int` | Retrieves SEC filings (10-K, 10-Q), Form 4 insider trades, news headlines. |
| | `save_stock_note` / `add_stock_note` | `symbol: str`, `title: str`, `content: str`, `note_id: int?`, `upsert_same_day: bool?` | Saves or edits an investment thesis in PortfolioWatcher's UI. Supports editing via `note_id` and same-day upsert. |
| | `delete_stock_note` | `symbol: str`, `note_id: int` | Deletes a saved research note for a stock. |
| | `get_stock_notes` | `symbol: str` | Retrieves saved research notes for a stock with timestamps and note IDs. |

---

## 4. MCP Resources & Prompts

### Resources
- `portfolio://accounts`: Live markdown list of all accounts, types, and tracked symbols.
- `portfolio://macro/sentiment`: Live markdown snapshot of major indices, VIX volatility regime, and SKEW tail risk.
- `portfolio://stocks/{symbol}/summary`: Live markdown snapshot of stock price and technical indicators.
- `portfolio://stocks/{symbol}/dna`: Live markdown breakdown of an asset's behavioral DNA, volatility, and optimal strategy fit.
- `portfolio://stocks/{symbol}/catalysts`: Live markdown list of impending Polymarket prediction market event odds.

### Prompts
- `analyze_stock(symbol)`: Deep multi-dimensional research workflow combining technicals, Asset DNA, prediction catalysts, and SEC filings.
- `portfolio_health_check(account_id)`: Portfolio audit reviewing diversification, sector balance, Asset DNA, and technical risks.
- `macro_market_briefing()`: Macro risk and market regime briefing synthesizing index momentum, VIX/SKEW regimes, and macro prediction market odds.
- `technical_indicator_audit(symbol)`: Comprehensive technical indicator evaluation across trend, momentum, and volatility.

---

## 5. Example AI Conversations

### Example 1: Technical Indicators & Trend Audit
> **User**: *"What do NVDA's technical indicators look like right now?"*  
> **LLM**: Calls `get_stock_quote('NVDA')` and `get_technical_indicators('NVDA')`:
> - **Current Price**: \$130.40 (+2.1% today).
> - **Trend & Moving Averages**: Price is trading comfortably above both MA-50 (\$121.50) and MA-200 (\$105.20), confirming strong multi-month bullish alignment.
> - **Momentum Oscillators**: RSI-14 is at 58.4 (neutral-bullish, not overbought). MACD histogram is positive and expanding (+0.42), signaling accelerating upside momentum.
> - **Volatility & Channels**: Bollinger Bands Upper is at \$136.20 and Lower at \$118.80; ATR-14 average daily range is \$4.80 (3.7% daily volatility).

### Example 2: Prediction Market Catalyst Intelligence
> **User**: *"Are there any prediction markets for NVDA or upcoming Fed decisions?"*  
> **LLM**: Calls `get_stock_catalysts('NVDA')` and `get_macro_catalysts('fed')`:
> - NVDA: "Blackwell chip Q4 revenue > $10B" trading at 78% probability on Polymarket ($4.2M volume).
> - Macro: "Fed 25 bps rate cut at next FOMC" trading at 91% probability ($18.5M volume).

### Example 3: Portfolio Vital Signs & Concentration Risk
> **User**: *"How is my portfolio positioned today? Any high concentration risks?"*  
> **LLM**: Calls `get_portfolio_summary()` and `get_holdings()`:
> - **Total Value**: \$148,250 with 12.4% held in cash.
> - **Day Gain/Loss**: +\$1,840 (+1.26%).
> - **Top Holdings Concentration**: Top 3 assets (NVDA: 24.5%, AAPL: 18.2%, MSFT: 14.1%) represent 56.8% of total portfolio equity.
> - **Risk Observation**: NVDA position weight is approaching the 25% single-stock concentration guardrail.

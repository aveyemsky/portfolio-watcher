# PortfolioWatcher

PortfolioWatcher is a clean, extensible investment portfolio and technical analysis cockpit. It provides a full Flask + React framework that runs standalone out of the box and can also mount cleanly as an embedded module into host applications via its self-contained feature boundary.

The React UI features a top summary strip with live market session indicators, left navigator tabs, right detail workspace, compact segmented controls, portfolio/stock interaction, interactive candlestick charts with embedded `[E]` (Earnings) and `[D]` (Dividend) event markers, and an expandable Fundamentals & Catalysts drawer.

## Architecture

Backend:

- `backend/app.py` creates the Flask app, initializes SQLite through SQLAlchemy, enables CORS, registers the API blueprint, and attaches centralized error handlers.
- `backend/portfolio/api/` owns HTTP routes, serializers, and API error formatting.
- `backend/portfolio/services/` owns business orchestration and future stock retrieval, indicator, and analysis boundaries.
- `backend/portfolio/data/` owns SQLAlchemy setup, models, seed data, and repositories.
- `backend/portfolio/core/logging.py` centralizes backend logging.

Frontend:

- `frontend/src/App.jsx` is intentionally thin and mounts `<PortfolioWatcherApp apiBaseUrl="/api/portfolio" />`.
- `frontend/src/portfolioWatcher/` contains all PortfolioWatcher feature code.
- `frontend/src/portfolioWatcher/api/portfolioApi.js` owns API calls through a shared JSON request wrapper.
- `frontend/src/portfolioWatcher/core/` owns frontend logging and error normalization.
- `frontend/src/portfolioWatcher/ui/` contains feature-scoped account, stock, layout, and shared UI modules.
- `frontend/src/portfolioWatcher/styles/portfolioWatcher.css` contains prefixed `pw-` styles.

No code is placed under `frontend/src/components/`.

## Backend Setup

### First-Time Setup

macOS/Linux:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m portfolio.data.seed_demo
python app.py
```

Windows:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m portfolio.data.seed_demo
python app.py
```

### Subsequent Runs

macOS/Linux:

```bash
cd backend
source .venv/bin/activate
python app.py
```

Windows:

```bash
cd backend
.venv\Scripts\activate
python app.py
```

The backend runs at `http://127.0.0.1:5739` by default. Override with `PORT` if needed.

## Frontend Setup

### First-Time Setup

```bash
cd frontend
npm install
npm run dev
```

### Subsequent Runs

```bash
cd frontend
npm run dev
```

The Vite dev server runs at `http://localhost:5175` by default and proxies `/api` to Flask.

## Real Empty Setup

Run:

```bash
cd backend
python -m portfolio.data.init_db
python app.py
```

This resets the SQLite database to an empty schema only. It does not create fake accounts, holdings, stocks, or mock prices. Use the UI to add portfolios, add global stocks, and add holdings.

## Demo Seed Data

Run:

```bash
cd backend
python -m portfolio.data.seed_demo
```

The seed creates default categories, sample accounts, and core tracked stocks. Real market price history is automatically fetched on-demand from market data providers when stocks are viewed or synced. Real stock price sync defaults to a fixed start date of 2017-01-01 (or 10 years of OHLCV history).

## API Overview

All routes are namespaced under `/api/portfolio`:

- **System & Startup**:
  - `GET /health`
  - `GET /bootstrap`
- **Portfolios & Categories**:
  - `GET /categories` | `POST /categories` | `PATCH /categories/<id>` | `DELETE /categories/<id>`
  - `GET /portfolios` (or `/accounts`) | `POST /portfolios` | `PATCH /portfolios/<id>` | `DELETE /portfolios/<id>`
  - `GET /portfolios/<id>/holdings` | `POST /portfolios/<id>/holdings` | `DELETE /portfolios/<id>/holdings/<symbol>`
  - `POST /portfolios/<id>/section` | `DELETE /portfolios/<id>/section/<section_id>` | `PUT /portfolios/<id>/items/reorder`
- **Stocks & Quotes**:
  - `GET /stocks` | `POST /stocks` | `DELETE /stocks/<symbol>`
  - `POST /stocks/sync` | `POST /stocks/<symbol>/sync` (incremental daily sync)
  - `POST /stocks/quotes/refresh` | `POST /stocks/<symbol>/quote/refresh` (live quotes)
  - `GET /indices` | `POST /indices/quotes/refresh` (market indices)
  - `GET /stocks/<symbol>/prices`
  - `GET /stocks/<symbol>/intraday?interval=5m` | `POST /stocks/<symbol>/intraday/refresh?interval=5m`
- **Technical Indicators & Analysis**:
  - `GET /stocks/<symbol>/indicators`
  - `GET /stocks/<symbol>/indicators/series`
  - `GET /stocks/<symbol>/analysis`
- **Asset DNA & Research Notes**:
  - `GET /stocks/<symbol>/dna` | `PUT /stocks/<symbol>/dna`
  - `GET /stocks/<symbol>/documents` (SEC filings & notes)
  - `POST /stocks/<symbol>/notes` | `DELETE /stocks/<symbol>/notes/<note_id>`
- **Fundamentals & Catalysts**:
  - `GET /stocks/<symbol>/fundamentals` (Earnings calendar, EPS surprises, and dividend metrics)
  - `GET /catalysts/macro` (Macro catalysts & market sentiment)
  - `GET /stocks/<symbol>/catalysts` (Polymarket prediction market catalysts)
  - `GET /catalysts/search?query=...`

The bootstrap endpoint returns the one-call frontend startup payload:

```json
{
  "accounts": [],
  "stocks": [],
  "holdingsByAccount": {},
  "pricesBySymbol": {}
}
```

## Logging And Errors

Backend logging is centralized in `backend/portfolio/core/logging.py`. Backend modules use `get_logger(__name__)` rather than raw `print()`.

Backend API errors are centralized in `backend/portfolio/api/errors.py` and use this shape:

```json
{
  "error": {
    "code": "not_found",
    "message": "Stock not found"
  }
}
```

Frontend logging is centralized in `frontend/src/portfolioWatcher/core/logger.js` and uses `VITE_PW_LOG_LEVEL` when provided.

Frontend API errors are normalized in `frontend/src/portfolioWatcher/core/errors.js`. API requests go through the shared wrapper in `frontend/src/portfolioWatcher/api/portfolioApi.js`.

## Navigator UX

The left Navigator uses `All | Portfolios` tabs.

- `All` shows tracked global stocks. In view mode it shows search and the stock list only.
- `Portfolios` shows portfolio shells and, after selecting one, its selected portfolio strip and holdings list.
- The `+ / -` button beside the Navigator title toggles manage mode.
- Manage mode reveals add forms and red overlay `x` actions for the current context.
- In `All` manage mode, Add only applies to the symbol input, while Sync applies to all tracked stocks.
- Switching between `All` and `Portfolios` exits manage mode.

Destructive actions are intentionally scoped:

- Removing a holding from a portfolio does not delete the global stock or stored price history.
- Deleting a global stock from `All` is blocked while any portfolio uses that stock.
- Deleting a portfolio is blocked while it has holdings.

## Future Roadmap

- Add automated broker sync connectors (e.g., SnapTrade, Plaid).
- Add multi-asset portfolio walk-forward optimization and rebalancing models.
- Add intraday technical indicators and custom user alerts.

## Stock Data Architecture

Stock info and price sync logic uses `yfinance` to normalize symbols, download OHLCV history, and store stock/price rows in SQLite through dedicated application layers:

- Provider wrapper: `backend/portfolio/services/stock_data_service.py`
- Stock orchestration: `backend/portfolio/services/stock_service.py`
- Price storage: `backend/portfolio/data/repositories/price_repository.py`
- Stock storage: `backend/portfolio/data/repositories/stock_repository.py`

Default stock price history sync uses a fixed anchor starting date of January 1, 2017 (`STOCK_HISTORY_START_DATE=2017-01-01`). Add Stock, Sync Stock, and Sync All all use that same fixed historical start date to ensure deterministic date alignment across all assets. Re-syncing a stock replaces that stock's stored price rows before inserting the refreshed history, so repeated syncs do not create duplicate price rows.

The frontend chart opens to the most recent 6 months by default while keeping the full stored history (since 2017) available in SQLite. The chart also leaves right-side padding so the latest candle does not touch the chart edge.

The stock chart supports `1d | 3y | All` range controls:

- `3y` is selected by default whenever a stock is selected, opening to the latest 6-month window while keeping a responsive 3-year baseline.
- `All` displays the full stored daily candlestick history back to 2017 (`title="Since 2017"`).
- `1d` fetches current market-date intraday data on demand using yfinance `period=1d` and `interval=5m`.
- Intraday data is stored separately in `stock_intraday_prices`, keyed by stock, interval, and timestamp, so future `1m` and `15m` modes can reuse the same storage pattern.
- Intraday cache freshness is controlled by `INTRADAY_CACHE_TTL_SECONDS`, defaulting to 60 seconds. The market date is based on `America/New_York`.

Sync one stock:

```bash
curl -X POST http://127.0.0.1:5739/api/portfolio/stocks/AAPL/sync
```

Sync all tracked stocks:

```bash
curl -X POST http://127.0.0.1:5739/api/portfolio/stocks/sync
```

Daily stock sync is incremental after initial history exists. If a stock has no stored daily prices, PortfolioWatcher fetches the full history back to 2017-01-01. If daily prices already exist, sync fetches from the latest stored date forward and upserts rows without creating duplicate daily prices.

## Technical Indicators

PortfolioWatcher calculates 9 standard technical indicators from stored daily historical prices via an extensible declarative registry:

- `EMA-20` (Exponential Moving Average, 20-period)
- `MA-50` (Simple Moving Average, 50-period)
- `MA-200` (Simple Moving Average, 200-period)
- `BB20` (Bollinger Bands, 20-period SMA, 2.0 std dev: Upper, Middle, Lower)
- `ATR-14` (Average True Range, 14-period volatility metric)
- `RSI-14` (Relative Strength Index, 14-period oscillator)
- `STOCH-14` (Stochastic Oscillator %K / %D)
- `MACD` (Moving Average Convergence Divergence, 12/26/9: MACD line, Signal line, Histogram)
- `OBV` (On-Balance Volume with 20-period baseline)

The Analysis tab displays these indicators as dynamic metric cards, including band ranges, signal momentum, active signal observations, and synthesized natural language summaries. If there is not enough stored daily history for a given indicator, the backend returns `not_enough_data` for that indicator and the UI shows a friendly empty value instead of failing.

The Chart tab renders daily indicator series in `3y` and `All` modes:

- `EMA20`, `MA50`, and `MA200` render as line overlays on the candlestick chart.
- `BB20` renders as triple-band overlays (solid upper/lower bands and dashed middle baseline).
- `RSI14` renders in a compact panel below the price chart with 70, 50, and 30 reference levels.
- `MACD` renders in a synchronized sub-pane below the price chart with dual lines (MACD and Signal) and green/red histogram bars.
- Indicator overlays are hidden for `1d` intraday mode.

Add a stock through the API:

```bash
curl -X POST http://127.0.0.1:5739/api/portfolio/stocks \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL"}'
```

## Portfolio Management

PortfolioWatcher supports basic portfolio shell CRUD. The backend model and API path are still named `accounts` for now:

- Create: `POST /api/portfolio/accounts`
- Rename/edit: `PATCH /api/portfolio/accounts/<account_id>`
- Delete empty account: `DELETE /api/portfolio/accounts/<account_id>`

Deleting an account that has holdings is blocked with `409 account_in_use`.

Account holdings:

- Add holding: `POST /api/portfolio/accounts/<account_id>/holdings`
- Remove holding: `DELETE /api/portfolio/accounts/<account_id>/holdings/<symbol>`

When adding a holding, the backend auto-adds and syncs the global stock first if the symbol is not already tracked. The response can include both the created holding and newly tracked stock/prices so the frontend can update the `All` stock list and selected portfolio holdings together.

Removing a holding only removes the stock from that one portfolio. It does not delete the global stock record or stored stock prices. Deleting a global stock from All remains blocked while any portfolio still uses that stock as a holding.

## Modular Host Integration

PortfolioWatcher is designed to run standalone or mount cleanly inside larger host systems via its self-contained feature boundary:

- API namespace stays under `/api/portfolio`.
- Feature entry component is `<PortfolioWatcherApp apiBaseUrl="/api/portfolio" />`.
- Frontend feature code lives under `src/portfolioWatcher/`.
- CSS uses `pw-` prefixes to prevent namespace collisions.
- Flask backend does not depend on frontend build artifacts.
- React frontend interacts strictly via standardized REST contracts.

## Model Context Protocol (MCP) Integration

PortfolioWatcher provides a built-in MCP server that enables AI assistants (Claude Desktop, Cursor, ChatGPT, Google Gemini, Antigravity) to query live portfolios, calculate technical indicators, fetch real-time quotes and SEC filings, and save research notes:

```bash
cd backend
source .venv/bin/activate
python -m portfolio.mcp.server
```

For complete client setup instructions and tool definitions, see [MCP.md](MCP.md).

## Testing

Run backend tests:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest
```

Run frontend tests:

```bash
cd frontend
npm install
npm run test:run
```

## Third-Party Libraries & Attributions

- **Financial Charting**: Interactive candlestick and indicator charts are powered by [Lightweight Charts™](https://github.com/tradingview/lightweight-charts), open-sourced by TradingView under the Apache License 2.0.

## Disclaimer

This project is open-source software provided for **educational and personal research purposes only**. It does not provide financial, investment, or trading advice. Historical stock data is fetched via Yahoo Finance (`yfinance`); users must ensure their use complies with Yahoo Finance's terms of service.

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPLv3)](LICENSE).


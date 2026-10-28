from flask import Blueprint, jsonify, request

from portfolio.api.errors import NotFoundError
from portfolio.api.serializers import (
    serialize_account,
    serialize_account_with_holdings,
    serialize_bootstrap,
    serialize_category,
    serialize_holding,
    serialize_intraday_payload,
    serialize_price,
    serialize_stock_with_prices,
    serialize_stock,
)
from portfolio.core.logging import get_logger
from portfolio.services import (
    account_service,
    catalyst_service,
    chart_service,
    document_service,
    index_service,
    indicator_service,
    intraday_service,
    stock_service,
)

portfolio_api = Blueprint("portfolio_api", __name__, url_prefix="/api/portfolio")
logger = get_logger(__name__)


@portfolio_api.get("/health")
def health():
    logger.debug("Health check requested")
    return jsonify({"status": "ok", "service": "PortfolioWatcher"})


@portfolio_api.get("/bootstrap")
def bootstrap():
    payload = account_service.get_bootstrap_data()
    return jsonify(serialize_bootstrap(payload))


@portfolio_api.get("/categories")
def list_categories():
    categories = account_service.list_categories()
    return jsonify([serialize_category(cat) for cat in categories])


@portfolio_api.post("/categories")
def create_category():
    payload = request.get_json(silent=True) or {}
    category = account_service.create_category(payload)
    return jsonify(serialize_category(category)), 201


@portfolio_api.get("/categories/<int:category_id>")
def get_category(category_id):
    category = account_service.get_category(category_id)
    return jsonify(serialize_category(category))


@portfolio_api.route("/categories/<int:category_id>", methods=["PUT", "PATCH"])
def update_category(category_id):
    payload = request.get_json(silent=True) or {}
    category = account_service.update_category(category_id, payload)
    return jsonify(serialize_category(category))


@portfolio_api.delete("/categories/<int:category_id>")
def delete_category(category_id):
    delete_portfolios = request.args.get("delete_portfolios", "").lower() in ("true", "1")
    if not delete_portfolios and request.is_json:
        delete_portfolios = bool((request.get_json(silent=True) or {}).get("delete_portfolios"))
    return jsonify(account_service.delete_category(category_id, delete_portfolios=delete_portfolios))


@portfolio_api.get("/stocks/master")
def get_master_stocks():
    return jsonify(account_service.get_master_stocks())


@portfolio_api.get("/accounts")
def list_accounts():
    accounts = account_service.list_accounts()
    return jsonify([serialize_account(account) for account in accounts])


@portfolio_api.post("/accounts")
def create_account():
    account = account_service.create_account(request.get_json(silent=True) or {})
    return jsonify(serialize_account(account)), 201


@portfolio_api.get("/accounts/<int:account_id>")
def get_account(account_id):
    account = account_service.get_account(account_id)
    if not account:
        raise NotFoundError(f"Account not found: {account_id}")
    holdings = account_service.get_account_holdings(account_id)
    return jsonify(serialize_account_with_holdings(account, holdings))


@portfolio_api.route("/accounts/<int:account_id>", methods=["PUT", "PATCH"])
def update_account(account_id):
    account = account_service.update_account(account_id, request.get_json(silent=True) or {})
    return jsonify(serialize_account(account))


@portfolio_api.delete("/accounts/<int:account_id>")
def delete_account(account_id):
    return jsonify(account_service.delete_account(account_id))


@portfolio_api.get("/accounts/<int:account_id>/holdings")
def get_account_holdings(account_id):
    account = account_service.get_account(account_id)
    if not account:
        raise NotFoundError(f"Account not found: {account_id}")
    holdings = account_service.get_account_holdings(account_id)
    return jsonify([serialize_holding(holding) for holding in holdings])


@portfolio_api.post("/accounts/<int:account_id>/holdings")
def add_account_holding(account_id):
    payload = account_service.add_holding_to_account(account_id, request.get_json(silent=True) or {})
    response = {"holding": serialize_holding(payload["holding"])}
    if payload.get("stock"):
        response["stock"] = serialize_stock(payload["stock"])
        response["prices"] = [serialize_price(price) for price in payload.get("prices", [])]
    if payload.get("warning"):
        response["warning"] = payload["warning"]
    return jsonify(response), 201


@portfolio_api.post("/portfolios/<int:portfolio_id>/section")
@portfolio_api.post("/accounts/<int:portfolio_id>/section")
def add_portfolio_section(portfolio_id):
    payload = request.get_json(silent=True) or {}
    item = account_service.add_section_to_portfolio(portfolio_id, payload)
    return jsonify(serialize_holding(item)), 201


@portfolio_api.delete("/portfolios/<int:portfolio_id>/section/<int:section_id>")
@portfolio_api.delete("/accounts/<int:portfolio_id>/section/<int:section_id>")
def delete_portfolio_section(portfolio_id, section_id):
    return jsonify(account_service.delete_section_from_portfolio(portfolio_id, section_id))


@portfolio_api.put("/portfolios/<int:portfolio_id>/items/reorder")
@portfolio_api.put("/accounts/<int:portfolio_id>/items/reorder")
def reorder_portfolio_items(portfolio_id):
    payload = request.get_json(silent=True) or {}
    items_payload = payload.get("items") if isinstance(payload, dict) else payload
    items = account_service.reorder_portfolio_items(portfolio_id, items_payload or [])
    return jsonify([serialize_holding(item) for item in items])


@portfolio_api.route("/accounts/<int:account_id>/stocks/<symbol>", methods=["POST", "PUT"])
@portfolio_api.route("/portfolios/<int:account_id>/stocks/<symbol>", methods=["POST", "PUT"])
@portfolio_api.route("/accounts/<int:account_id>/holdings/<symbol>", methods=["PUT"])
@portfolio_api.route("/portfolios/<int:account_id>/holdings/<symbol>", methods=["PUT"])
def update_account_holding(account_id, symbol):
    holding = account_service.update_holding(account_id, symbol, request.get_json(silent=True) or {})
    return jsonify(serialize_holding(holding))


@portfolio_api.delete("/accounts/<int:account_id>/holdings/<symbol>")
def delete_account_holding(account_id, symbol):
    return jsonify(account_service.delete_holding_from_account(account_id, symbol))


# Portfolio URL aliases matching /accounts
@portfolio_api.get("/portfolios")
def list_portfolios():
    return list_accounts()


@portfolio_api.post("/portfolios")
def create_portfolio():
    return create_account()


@portfolio_api.get("/portfolios/<int:portfolio_id>")
def get_portfolio(portfolio_id):
    return get_account(portfolio_id)


@portfolio_api.route("/portfolios/<int:portfolio_id>", methods=["PUT", "PATCH"])
def update_portfolio(portfolio_id):
    return update_account(portfolio_id)


@portfolio_api.delete("/portfolios/<int:portfolio_id>")
def delete_portfolio(portfolio_id):
    return delete_account(portfolio_id)


@portfolio_api.get("/portfolios/<int:portfolio_id>/holdings")
def get_portfolio_holdings(portfolio_id):
    return get_account_holdings(portfolio_id)


@portfolio_api.post("/portfolios/<int:portfolio_id>/holdings")
def add_portfolio_holding(portfolio_id):
    return add_account_holding(portfolio_id)


@portfolio_api.delete("/portfolios/<int:portfolio_id>/holdings/<symbol>")
def delete_portfolio_holding(portfolio_id, symbol):
    return delete_account_holding(portfolio_id, symbol)


@portfolio_api.get("/stocks")
def list_stocks():
    asset_type = request.args.get("asset_type", "stock")
    stocks = stock_service.list_stocks(asset_type=asset_type if asset_type != "all" else None)
    return jsonify([serialize_stock(stock) for stock in stocks])


@portfolio_api.get("/indices")
def list_indices():
    indices = index_service.list_indices()
    return jsonify([serialize_stock(idx) for idx in indices])


@portfolio_api.post("/indices/quotes/refresh")
def refresh_all_indices_quotes():
    indices = index_service.refresh_index_quotes()
    return jsonify([serialize_stock(idx) for idx in indices])


@portfolio_api.post("/stocks")
def add_stock():
    payload = request.get_json(silent=True) or {}
    result = stock_service.add_stock(payload.get("symbol"))
    status_code = 201 if result.get("created") else 200
    return jsonify(serialize_stock_with_prices(result)), status_code


@portfolio_api.post("/stocks/sync")
def sync_all_stocks():
    max_duration = request.args.get("max_duration", type=int)
    kwargs = {"max_duration_seconds": max_duration} if max_duration else {}
    return jsonify(stock_service.sync_all_stocks(**kwargs))


@portfolio_api.post("/stocks/quotes/refresh")
def refresh_all_stock_quotes():
    force = request.args.get("force", "").lower() == "true"
    stocks = stock_service.refresh_all_stock_quotes(force=force)
    return jsonify([serialize_stock(stock) for stock in stocks])


@portfolio_api.get("/stocks/<symbol>")
def get_stock(symbol):
    stock = stock_service.get_stock_by_symbol(symbol)
    if not stock:
        raise NotFoundError(f"Stock not found: {symbol}")
    return jsonify(serialize_stock(stock))


@portfolio_api.delete("/stocks/<symbol>")
def delete_stock(symbol):
    force = request.args.get("force", "").lower() == "true"
    return jsonify(stock_service.delete_stock(symbol, force=force))


@portfolio_api.post("/stocks/<symbol>/sync")
def sync_stock(symbol):
    result = stock_service.sync_stock(symbol)
    return jsonify(serialize_stock_with_prices(result))


@portfolio_api.post("/stocks/<symbol>/quote/refresh")
def refresh_stock_quote(symbol):
    stock = stock_service.refresh_stock_quote(symbol)
    return jsonify(serialize_stock(stock))


@portfolio_api.get("/stocks/<symbol>/prices")
def get_stock_prices(symbol):
    stock = stock_service.get_stock_by_symbol(symbol)
    if not stock:
        raise NotFoundError(f"Stock not found: {symbol}")
    prices = chart_service.get_stock_prices(symbol)
    return jsonify([serialize_price(price) for price in prices])


@portfolio_api.get("/stocks/<symbol>/intraday")
def get_stock_intraday(symbol):
    payload = intraday_service.get_stock_intraday(symbol, interval=request.args.get("interval"))
    return jsonify(serialize_intraday_payload(payload))


@portfolio_api.post("/stocks/<symbol>/intraday/refresh")
def refresh_stock_intraday(symbol):
    payload = intraday_service.refresh_stock_intraday(symbol, interval=request.args.get("interval"))
    return jsonify(serialize_intraday_payload(payload))


@portfolio_api.get("/stocks/<symbol>/indicators")
def get_stock_indicators(symbol):
    stock = stock_service.get_stock_by_symbol(symbol)
    if not stock:
        raise NotFoundError(f"Stock not found: {symbol}")
    include_series = request.args.get("includeSeries", "").lower() == "true"
    if include_series:
        return jsonify(indicator_service.calculate_indicator_series(symbol))
    return jsonify(indicator_service.calculate_indicators(symbol))


@portfolio_api.get("/stocks/<symbol>/indicators/series")
def get_stock_indicator_series(symbol):
    stock = stock_service.get_stock_by_symbol(symbol)
    if not stock:
        raise NotFoundError(f"Stock not found: {symbol}")
    return jsonify(indicator_service.calculate_indicator_series(symbol))


@portfolio_api.get("/stocks/<symbol>/fundamentals")
def get_stock_fundamentals(symbol: str):
    from portfolio.services import fundamental_service

    refresh = request.args.get("refresh", "").lower() in ("true", "1")
    return jsonify(
        fundamental_service.get_fundamentals(
            symbol,
            refresh=refresh,
            priority=fundamental_service.FundamentalQueueManager.PRIORITY_HIGH,
        )
    )



@portfolio_api.get("/documents/providers")
def get_document_providers():
    providers = document_service.list_document_providers()
    return jsonify({"status": "success", "data": providers})


@portfolio_api.get("/stocks/<symbol>/documents")
def get_stock_documents(symbol):
    stock = stock_service.get_stock_by_symbol(symbol)
    if not stock:
        raise NotFoundError(f"Stock not found: {symbol}")

    category = request.args.get("category")
    provider_id = request.args.get("provider")
    limit = int(request.args.get("limit", 30))
    bypass_cache = request.args.get("refresh", "").lower() in ("true", "1")

    docs = document_service.get_stock_documents(
        symbol=symbol,
        category=category,
        provider_id=provider_id,
        limit=limit,
        bypass_cache=bypass_cache,
    )
    return jsonify({"status": "success", "data": docs, "total": len(docs)})


@portfolio_api.post("/stocks/<symbol>/notes")
def save_stock_note(symbol):
    stock = stock_service.get_stock_by_symbol(symbol)
    if not stock:
        raise NotFoundError(f"Stock not found: {symbol}")

    payload = request.get_json() or {}
    doc = document_service.save_stock_note(symbol, payload)
    return jsonify({"status": "success", "data": doc}), 201


@portfolio_api.delete("/stocks/<symbol>/notes/<note_id>")
def delete_stock_note(symbol, note_id):
    stock = stock_service.get_stock_by_symbol(symbol)
    if not stock:
        raise NotFoundError(f"Stock not found: {symbol}")

    success = document_service.delete_stock_note(symbol, note_id)
    if not success:
        raise NotFoundError(f"Note not found: {note_id}")
    return jsonify({"status": "success", "message": "Note deleted"})


@portfolio_api.post("/stocks/<symbol>/simulate")
@portfolio_api.post("/stocks/simulate")
def simulate_stock_strategy(symbol=None):
    from portfolio.services.simulation_service import SimulationService

    payload = request.get_json(silent=True) or {}
    target_symbol = symbol or payload.get("ticker") or payload.get("symbol")
    if not target_symbol:
        return jsonify({"error": {"message": "Ticker or symbol is required", "code": "validation_error"}}), 400

    raw_lookback = payload.get("lookback_days")
    lookback_days = int(raw_lookback) if raw_lookback is not None and str(raw_lookback).strip() != "" else 0
    start_date = payload.get("start_date")
    end_date = payload.get("end_date")
    combine_mode = payload.get("combine_mode", "CONSENSUS")
    strategies = payload.get("strategies") or [{"id": "supertrend"}]
    weights = payload.get("weights")
    initial_capital = float(payload.get("initial_capital", 10000.0))
    macro_sentiment_gate = payload.get("macro_sentiment_gate")

    result = SimulationService.simulate_stock_ensemble(
        symbol=target_symbol,
        strategies=strategies,
        combine_mode=combine_mode,
        lookback_days=lookback_days,
        weights=weights,
        initial_capital=initial_capital,
        start_date=start_date,
        end_date=end_date,
        macro_sentiment_gate=macro_sentiment_gate,
    )
    return jsonify(result)


@portfolio_api.get("/stocks/<symbol>/dna-profile")
def get_stock_dna_profile(symbol: str):
    from flask import request
    from portfolio.services.asset_profile_service import AssetProfileService

    include_quant_alpha = request.args.get("include_quant_alpha", "false").lower() in ("true", "1")
    lookback_param = request.args.get("lookback_days")
    lookback_days = int(lookback_param) if lookback_param and lookback_param.isdigit() else 730
    result = AssetProfileService.get_stock_dna_profile(
        symbol, include_quant_alpha=include_quant_alpha, lookback_days=lookback_days
    )
    return jsonify(result)


# --- Pluggable Prediction Market & Catalyst Endpoints ---

@portfolio_api.get("/catalysts/macro")
def get_macro_catalysts():
    category = request.args.get("category")
    provider_id = request.args.get("provider")
    limit = int(request.args.get("limit", 20))
    min_volume = float(request.args.get("min_volume", 500.0))
    bypass_cache = request.args.get("refresh", "").lower() in ("true", "1")

    events = catalyst_service.get_macro_catalysts(
        category=category,
        provider_id=provider_id,
        limit=limit,
        min_volume=min_volume,
        bypass_cache=bypass_cache,
    )
    return jsonify({"status": "success", "data": events, "total": len(events)})


@portfolio_api.get("/catalysts/stocks/<symbol>")
@portfolio_api.get("/stocks/<symbol>/catalysts")
def get_stock_catalysts(symbol: str):
    provider_id = request.args.get("provider")
    limit = int(request.args.get("limit", 15))
    min_volume = float(request.args.get("min_volume", 0.0))
    bypass_cache = request.args.get("refresh", "").lower() in ("true", "1")

    events = catalyst_service.get_stock_catalysts(
        symbol=symbol,
        provider_id=provider_id,
        limit=limit,
        min_volume=min_volume,
        bypass_cache=bypass_cache,
    )
    return jsonify({"status": "success", "symbol": symbol.upper(), "data": events, "total": len(events)})


@portfolio_api.get("/catalysts/search")
def search_catalysts():
    query = request.args.get("q") or request.args.get("query") or ""
    provider_id = request.args.get("provider")
    limit = int(request.args.get("limit", 15))
    min_volume = float(request.args.get("min_volume", 0.0))
    bypass_cache = request.args.get("refresh", "").lower() in ("true", "1")

    events = catalyst_service.search_catalysts(
        query=query,
        provider_id=provider_id,
        limit=limit,
        min_volume=min_volume,
        bypass_cache=bypass_cache,
    )
    return jsonify({"status": "success", "query": query, "data": events, "total": len(events)})


@portfolio_api.get("/catalysts/providers")
def list_catalyst_providers():
    providers = catalyst_service.list_catalyst_providers()
    return jsonify({"status": "success", "data": providers})



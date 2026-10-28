from portfolio.api.errors import NotFoundError, ValidationError
from portfolio.core.logging import get_logger
from portfolio.data.repositories import (
    account_repository,
    category_repository,
    holding_repository,
    price_repository,
    stock_repository,
)

logger = get_logger(__name__)


def list_categories():
    return category_repository.list_categories()


def get_category(category_id):
    category = category_repository.get_category(category_id)
    if not category:
        raise NotFoundError(f"Category not found: {category_id}")
    return category


def create_category(payload):
    name = _clean_required(payload.get("name"), "Category name is required")
    if len(name) > 64:
        raise ValidationError("Category name must be 64 characters or less")
    sort_order = int(payload.get("sort_order", 0) or payload.get("sortOrder", 0) or 0)
    return category_repository.create_category(name, sort_order=sort_order)


def update_category(category_id, payload):
    category = category_repository.get_category(category_id)
    if not category:
        raise NotFoundError(f"Category not found: {category_id}")

    updates = {}
    if "name" in payload:
        name = _clean_required(payload.get("name"), "Category name is required")
        if len(name) > 64:
            raise ValidationError("Category name must be 64 characters or less")
        updates["name"] = name
    if "sort_order" in payload or "sortOrder" in payload:
        updates["sort_order"] = int(payload.get("sort_order", payload.get("sortOrder", 0)) or 0)

    return category_repository.update_category(category, updates)


def delete_category(category_id, delete_portfolios=False):
    category = category_repository.get_category(category_id)
    if not category:
        raise NotFoundError(f"Category not found: {category_id}")

    category_repository.delete_category(category, delete_portfolios=delete_portfolios)
    return {"id": category_id, "deleted": True}


def list_accounts():
    return account_repository.list_accounts()


def get_account(account_id):
    return account_repository.get_account(account_id)


def get_account_holdings(account_id):
    return holding_repository.list_holdings_for_account(account_id)


def create_account(payload):
    name = _clean_required(payload.get("name"), "Account name is required")
    account_type = payload.get("type", "standard") or "standard"
    category_id = payload.get("category_id") or payload.get("categoryId")
    sort_order = int(payload.get("sort_order", 0) or payload.get("sortOrder", 0) or 0)

    if category_id:
        cat = category_repository.get_category(category_id)
        if not cat:
            category_id = None

    return account_repository.create_account(
        name=name,
        type=account_type,
        category_id=category_id,
        sort_order=sort_order,
    )


def update_account(account_id, payload):
    account = account_repository.get_account(account_id)
    if not account:
        raise NotFoundError(f"Account not found: {account_id}")

    updates = {}
    if "name" in payload:
        updates["name"] = _clean_required(payload.get("name"), "Account name is required")
    if "type" in payload:
        updates["type"] = _clean_required(payload.get("type"), "Account type is required")
    if "categoryId" in payload or "category_id" in payload:
        updates["category_id"] = payload.get("categoryId", payload.get("category_id"))
    if "sortOrder" in payload or "sort_order" in payload:
        updates["sort_order"] = int(payload.get("sortOrder", payload.get("sort_order", 0)) or 0)
    if "sizing_mode" in payload or "sizingMode" in payload:
        new_mode = str(payload.get("sizing_mode", payload.get("sizingMode")) or "").strip().upper()
        if new_mode in ("PERCENT", "SHARES"):
            updates["sizing_mode"] = new_mode
            if account.sizing_mode == "SHARES" and new_mode == "PERCENT":
                # Snapshot current market value share into weight_pct if holding has shares > 0 and weight_pct is None
                holdings = holding_repository.list_holdings_for_account(account_id)
                stock_holdings = [h for h in holdings if not h.is_section_header]
                holding_prices = {}
                total_equity = 0.0
                for h in stock_holdings:
                    sym = (h.symbol or "").upper()
                    stk = stock_repository.get_stock_by_symbol(sym)
                    p = (stk.last_price if (stk and stk.last_price is not None) else (h.avg_cost or 0.0))
                    holding_prices[h.id] = p
                    total_equity += (h.shares or 0.0) * p

                if total_equity > 0:
                    for h in stock_holdings:
                        if (h.shares or 0.0) > 0 and h.weight_pct is None:
                            p = holding_prices.get(h.id, 0.0)
                            h.weight_pct = round(((h.shares * p) / total_equity) * 100.0, 1)

    if not updates:
        raise ValidationError("At least one account field is required")

    return account_repository.update_account(account, updates)


def add_section_to_portfolio(account_id, payload):
    account = account_repository.get_account(account_id)
    if not account:
        raise NotFoundError(f"Portfolio not found: {account_id}")

    label = _clean_required(
        payload.get("section_label") or payload.get("sectionLabel"),
        "Section label is required",
    )
    sort_order = payload.get("sort_order", payload.get("sortOrder"))
    if sort_order is not None:
        sort_order = int(sort_order)

    return account_repository.add_section_divider(account_id, label, sort_order)


def delete_section_from_portfolio(account_id, section_id):
    account = account_repository.get_account(account_id)
    if not account:
        raise NotFoundError(f"Portfolio not found: {account_id}")

    item = account_repository.get_portfolio_item(section_id)
    if not item or item.portfolio_id != account_id:
        raise NotFoundError(f"Section divider not found: {section_id}")

    account_repository.delete_portfolio_item(item)
    return {"id": section_id, "deleted": True}


def reorder_portfolio_items(account_id, item_orders):
    account = account_repository.get_account(account_id)
    if not account:
        raise NotFoundError(f"Portfolio not found: {account_id}")

    if not isinstance(item_orders, list):
        raise ValidationError("item_orders must be a list of {id, sort_order}")

    return account_repository.reorder_portfolio_items(account_id, item_orders)


def delete_account(account_id):
    account = account_repository.get_account(account_id)
    if not account:
        raise NotFoundError(f"Account not found: {account_id}")

    holding_count = account_repository.count_holdings_for_account(account_id)
    if holding_count:
        raise ValidationError(
            "Cannot delete this portfolio because it has holdings.",
            status_code=409,
            code="account_in_use",
        )

    account_repository.delete_account(account)
    return {"id": account_id, "deleted": True}


def add_holding_to_account(account_id, payload):
    account = account_repository.get_account(account_id)
    if not account:
        raise NotFoundError(f"Account not found: {account_id}", code="account_not_found")

    symbol = _clean_required(payload.get("symbol"), "Stock symbol is required").upper()
    shares, shares_missing = _clean_optional_number(payload.get("shares"))
    avg_cost, avg_cost_missing = _clean_optional_number(payload.get("avgCost"))

    added_stock_payload = None
    stock = stock_repository.get_stock_by_symbol(symbol)
    if not stock:
        logger.info("Auto-adding missing stock before creating holding: %s", symbol)
        from portfolio.services import stock_service

        added_stock_payload = stock_service.add_stock(symbol)
        stock = added_stock_payload["stock"]

    existing = holding_repository.get_holding(account_id, symbol)
    if existing:
        raise ValidationError(
            f"{symbol} is already held in this portfolio.",
            code="holding_exists",
        )

    raw_weight = payload.get("weight_pct", payload.get("weightPct"))
    weight_pct = float(raw_weight) if raw_weight is not None and str(raw_weight).strip() != "" else None

    holding = holding_repository.create_holding(account.id, symbol, shares, avg_cost, weight_pct=weight_pct)
    stock_repository.increment_subscriber_count(symbol)

    warning = (
        "This holding is incomplete. Portfolio calculations may be inaccurate."
        if (shares_missing and weight_pct is None) or avg_cost_missing
        else None
    )
    response = {"holding": holding, "warning": warning}
    if added_stock_payload:
        response["stock"] = added_stock_payload["stock"]
        response["prices"] = added_stock_payload["prices"]
    return response


def update_holding(account_id, symbol, payload):
    account = account_repository.get_account(account_id)
    if not account:
        raise NotFoundError(f"Account not found: {account_id}", code="account_not_found")

    normalized = _clean_required(symbol, "Stock symbol is required").upper()
    holding = holding_repository.get_holding_by_account_and_symbol(account_id, normalized)
    if not holding:
        raise NotFoundError(f"Holding not found: {normalized}", code="holding_not_found")

    updates = {}
    if "shares" in payload:
        updates["shares"] = payload["shares"]
    if "avg_cost" in payload:
        updates["avg_cost"] = payload["avg_cost"]
    elif "avgCost" in payload:
        updates["avg_cost"] = payload["avgCost"]
    elif "average_cost" in payload:
        updates["avg_cost"] = payload["average_cost"]
    if "weight_pct" in payload:
        updates["weight_pct"] = payload["weight_pct"]
    elif "weightPct" in payload:
        updates["weight_pct"] = payload["weightPct"]

    return holding_repository.update_holding(holding, updates)


def delete_holding_from_account(account_id, symbol):
    account = account_repository.get_account(account_id)
    if not account:
        raise NotFoundError(f"Account not found: {account_id}", code="account_not_found")

    normalized = _clean_required(symbol, "Stock symbol is required").upper()
    holding = holding_repository.get_holding_by_account_and_symbol(account_id, normalized)
    if not holding:
        raise NotFoundError(
            f"Holding not found: {normalized}",
            code="holding_not_found",
        )

    holding_repository.delete_holding(holding)
    stock_repository.decrement_subscriber_count(normalized)
    return {"deleted": True, "accountId": account_id, "symbol": normalized}


def get_bootstrap_data():
    logger.info("Loading portfolio bootstrap data")
    categories = category_repository.list_categories()
    accounts = account_repository.list_accounts()
    stocks = stock_repository.list_stocks(asset_type="stock")
    from portfolio.services import index_service
    indices = index_service.list_indices()

    holdings_by_account = {account.id: [] for account in accounts}
    for holding in holding_repository.list_all_holdings():
        pid = getattr(holding, "portfolio_id", getattr(holding, "account_id", None))
        if pid in holdings_by_account:
            holdings_by_account[pid].append(holding)

    distinct_symbols = {s.symbol for s in stocks}

    return {
        "categories": categories,
        "accounts": accounts,
        "stocks": stocks,
        "indices": indices,
        "holdings_by_account": holdings_by_account,
        "prices_by_symbol": {},
        "master_stocks_summary": {
            "distinctCount": len(distinct_symbols),
        },
    }


def get_master_stocks():
    stocks = stock_repository.list_stocks(asset_type="stock")
    accounts = account_repository.list_accounts()
    account_map = {acc.id: acc for acc in accounts}

    all_holdings = holding_repository.Holding.query.filter(
        holding_repository.Holding.is_section_header.is_(False)
    ).all()

    symbol_memberships = {}
    for h in all_holdings:
        sym = (h.symbol or "").upper()
        if not sym:
            continue
        if sym not in symbol_memberships:
            symbol_memberships[sym] = []
        acc = account_map.get(h.portfolio_id)
        if acc:
            symbol_memberships[sym].append({
                "id": acc.id,
                "name": acc.name,
                "categoryId": acc.category_id,
                "shares": h.shares,
                "avgCost": h.avg_cost,
            })

    from portfolio.api.serializers import serialize_stock
    master_list = []
    for s in stocks:
        serialized = serialize_stock(s)
        portfolios = symbol_memberships.get(s.symbol, [])
        serialized["portfolios"] = portfolios
        serialized["portfolioCount"] = len(portfolios)
        serialized["totalShares"] = sum(p["shares"] for p in portfolios)
        master_list.append(serialized)

    return {
        "distinct_count": len(master_list),
        "stocks": master_list,
    }


def _clean_required(value, message):
    cleaned = (value or "").strip()
    if not cleaned:
        raise ValidationError(message)
    return cleaned


def _clean_positive_number(value, message):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(message) from exc
    if number <= 0:
        raise ValidationError(message)
    return number


def _clean_optional_number(value):
    if value in (None, ""):
        return 0, True
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError("Holding numbers must be valid numbers") from exc
    if number < 0:
        raise ValidationError("Holding numbers cannot be negative")
    return number, False

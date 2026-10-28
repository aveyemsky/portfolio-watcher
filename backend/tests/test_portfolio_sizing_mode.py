import pytest
from app import create_app
from portfolio.data.db import db, _ensure_sizing_mode_schema
from portfolio.data.models import Portfolio, PortfolioItem, Stock
from portfolio.services import account_service
from portfolio.api.serializers import serialize_account, serialize_holding, serialize_account_with_holdings


@pytest.fixture
def test_app():
    app = create_app()
    app.config["TESTING"] = True
    with app.app_context():
        yield app


def test_sizing_mode_schema_and_backfill(test_app):
    # 1. Test auto-migration and backfill on DB with holdings
    account = account_service.create_account({"name": "Test Account", "type": "brokerage"})
    holding = account_service.add_holding_to_account(account.id, {
        "symbol": "AAPL",
        "shares": 10.0,
        "avgCost": 150.0
    })

    # Trigger schema verification / backfill
    _ensure_sizing_mode_schema()

    refreshed_acc = account_service.get_account(account.id)
    assert refreshed_acc.sizing_mode == "SHARES"


def test_mode_switching_shares_to_percent_snapshots_weights(test_app):
    account = account_service.create_account({"name": "Switch Account", "type": "brokerage"})
    # Account starts with sizing_mode SHARES when holding shares > 0
    h1 = account_service.add_holding_to_account(account.id, {"symbol": "AAPL", "shares": 10.0, "avgCost": 100.0})
    h2 = account_service.add_holding_to_account(account.id, {"symbol": "NVDA", "shares": 10.0, "avgCost": 300.0})

    # Set mock stock prices
    s1 = Stock.query.filter_by(symbol="AAPL").first()
    if s1:
        s1.last_price = 100.0
    s2 = Stock.query.filter_by(symbol="NVDA").first()
    if s2:
        s2.last_price = 300.0
    db.session.commit()

    account.sizing_mode = "SHARES"
    db.session.commit()

    # Switch mode to PERCENT
    updated_acc = account_service.update_account(account.id, {"sizing_mode": "PERCENT"})
    assert updated_acc.sizing_mode == "PERCENT"

    # Verify weights were snapshotted: total equity = 10*100 + 10*300 = 4000
    # AAPL = 1000/4000 = 25.0%, NVDA = 3000/4000 = 75.0%
    holdings = account_service.get_account_holdings(account.id)
    weights = {h.symbol: h.weight_pct for h in holdings}
    assert weights["AAPL"] == 25.0
    assert weights["NVDA"] == 75.0
    # Ensure shares are intact
    shares = {h.symbol: h.shares for h in holdings}
    assert shares["AAPL"] == 10.0
    assert shares["NVDA"] == 10.0


def test_inline_holding_updates(test_app):
    client = test_app.test_client()
    account = account_service.create_account({"name": "Inline Edit Acc", "type": "brokerage"})
    account_service.add_holding_to_account(account.id, {"symbol": "MSFT", "shares": 5.0, "avgCost": 200.0})

    # Test PUT /api/accounts/<account_id>/stocks/<symbol>
    res = client.put(f"/api/accounts/{account.id}/stocks/MSFT", json={
        "shares": 15.0,
        "average_cost": 250.0,
        "weight_pct": 40.0
    })
    assert res.status_code == 200
    data = res.get_json()
    assert data["symbol"] == "MSFT"
    assert data["shares"] == 15.0
    assert data["avgCost"] == 250.0
    assert data["weightPct"] == 40.0


def test_effective_weight_pct_calculations(test_app):
    # 1. SHARES mode
    acc = Portfolio(id=991, name="Shares Acc", type="brokerage", sizing_mode="SHARES")
    h1 = PortfolioItem(id=1, portfolio_id=991, symbol="A", shares=10.0, avg_cost=100.0)
    h2 = PortfolioItem(id=2, portfolio_id=991, symbol="B", shares=10.0, avg_cost=300.0)
    acc.items = [h1, h2]

    serialized = serialize_account_with_holdings(acc, [h1, h2], quotes={"A": 100.0, "B": 300.0})
    assert serialized["sizingMode"] == "SHARES"
    weights = {h["symbol"]: h["effectiveWeightPct"] for h in serialized["holdings"]}
    assert weights["A"] == 25.0
    assert weights["B"] == 75.0

    # Fallback to equal weight when shares value is 0
    h1_zero = PortfolioItem(id=3, portfolio_id=992, symbol="A", shares=0.0, avg_cost=0.0)
    h2_zero = PortfolioItem(id=4, portfolio_id=992, symbol="B", shares=0.0, avg_cost=0.0)
    acc_zero = Portfolio(id=992, name="Zero Acc", type="brokerage", sizing_mode="SHARES")
    serialized_zero = serialize_account_with_holdings(acc_zero, [h1_zero, h2_zero])
    weights_zero = {h["symbol"]: h["effectiveWeightPct"] for h in serialized_zero["holdings"]}
    assert weights_zero["A"] == 50.0
    assert weights_zero["B"] == 50.0

    # 2. PERCENT mode: true equal weight if no weight_pct > 0
    acc_pct = Portfolio(id=993, name="Pct Acc", type="brokerage", sizing_mode="PERCENT")
    hp1 = PortfolioItem(id=5, portfolio_id=993, symbol="A", shares=0.0, weight_pct=None)
    hp2 = PortfolioItem(id=6, portfolio_id=993, symbol="B", shares=0.0, weight_pct=None)
    serialized_pct = serialize_account_with_holdings(acc_pct, [hp1, hp2])
    w_pct = {h["symbol"]: h["effectiveWeightPct"] for h in serialized_pct["holdings"]}
    assert w_pct["A"] == 50.0
    assert w_pct["B"] == 50.0

    # 3. PERCENT mode: custom weights with sum < 100% and unallocated cash
    hp3 = PortfolioItem(id=7, portfolio_id=994, symbol="A", shares=0.0, weight_pct=30.0)
    hp4 = PortfolioItem(id=8, portfolio_id=994, symbol="B", shares=0.0, weight_pct=40.0)
    acc_unallocated = Portfolio(id=994, name="Unalloc Acc", type="brokerage", sizing_mode="PERCENT")
    ser_unalloc = serialize_account_with_holdings(acc_unallocated, [hp3, hp4])
    assert ser_unalloc["unallocatedCashPct"] == 30.0

    # 4. PERCENT mode: custom weights with sum < 100% and some None stocks (distribute remainder)
    hp5 = PortfolioItem(id=9, portfolio_id=995, symbol="A", shares=0.0, weight_pct=60.0)
    hp6 = PortfolioItem(id=10, portfolio_id=995, symbol="B", shares=0.0, weight_pct=None)
    acc_distrib = Portfolio(id=995, name="Distrib Acc", type="brokerage", sizing_mode="PERCENT")
    ser_distrib = serialize_account_with_holdings(acc_distrib, [hp5, hp6])
    w_distrib = {h["symbol"]: h["effectiveWeightPct"] for h in ser_distrib["holdings"]}
    assert w_distrib["A"] == 60.0
    assert w_distrib["B"] == 40.0

    # 5. PERCENT mode: sum > 100% (normalize)
    hp7 = PortfolioItem(id=11, portfolio_id=996, symbol="A", shares=0.0, weight_pct=100.0)
    hp8 = PortfolioItem(id=12, portfolio_id=996, symbol="B", shares=0.0, weight_pct=100.0)
    acc_norm = Portfolio(id=996, name="Norm Acc", type="brokerage", sizing_mode="PERCENT")
    ser_norm = serialize_account_with_holdings(acc_norm, [hp7, hp8])
    w_norm = {h["symbol"]: h["effectiveWeightPct"] for h in ser_norm["holdings"]}
    assert w_norm["A"] == 50.0
    assert w_norm["B"] == 50.0

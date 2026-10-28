import json
import pytest
from app import create_app
from portfolio.data.db import db
from portfolio.data.models import Portfolio, PortfolioCategory, PortfolioItem, Stock


@pytest.fixture
def client():
    app = create_app(start_scheduler=False)
    app.config["TESTING"] = True
    with app.test_client() as test_client:
        with app.app_context():
            yield test_client


def test_default_categories_seeded(client):
    res = client.get("/api/categories")
    assert res.status_code == 200
    data = res.get_json()
    category_names = [c["name"] for c in data]
    assert "Brokerage Accounts" in category_names
    assert "Sector Baskets" in category_names
    assert "Action Watchlists" in category_names


def test_category_crud_and_portfolios(client):
    # 1. Create a 4th category
    res = client.post("/api/categories", json={"name": "Crypto & Commodities", "sort_order": 3})
    assert res.status_code == 201
    created_cat = res.get_json()
    cat_id = created_cat["id"]
    assert created_cat["name"] == "Crypto & Commodities"
    assert created_cat["sortOrder"] == 3

    # 2. Rename the category
    res = client.put(f"/api/categories/{cat_id}", json={"name": "Digital Assets", "sort_order": 4})
    assert res.status_code == 200
    updated_cat = res.get_json()
    assert updated_cat["name"] == "Digital Assets"
    assert updated_cat["sortOrder"] == 4

    # 3. Create a portfolio linked to this category
    res = client.post("/api/portfolios", json={
        "name": "DeFi Basket",
        "type": "speculative",
        "category_id": cat_id,
        "sort_order": 0,
    })
    assert res.status_code == 201
    created_port = res.get_json()
    port_id = created_port["id"]
    assert created_port["categoryId"] == cat_id

    # 4. Check category listing contains nested portfolio
    res = client.get("/api/categories")
    assert res.status_code == 200
    categories = res.get_json()
    matching_cat = next(c for c in categories if c["id"] == cat_id)
    assert any(p["id"] == port_id for p in matching_cat["portfolios"])

    # 5. Delete category with unlinking (child portfolios preserved)
    res = client.delete(f"/api/categories/{cat_id}?delete_portfolios=false")
    assert res.status_code == 200

    # Ensure portfolio still exists but category_id is None
    res = client.get(f"/api/portfolios/{port_id}")
    assert res.status_code == 200
    port_data = res.get_json()
    assert port_data["categoryId"] is None

    # Cleanup portfolio
    client.delete(f"/api/portfolios/{port_id}")


def test_in_list_section_divider(client):
    # 1. Create a temporary portfolio
    res = client.post("/api/portfolios", json={"name": "Swing Trading Watchlist"})
    assert res.status_code == 201
    port_id = res.get_json()["id"]

    try:
        # 2. Add a section divider
        res = client.post(f"/api/portfolios/{port_id}/section", json={
            "section_label": "--- Swing Triggers ---",
            "sort_order": 0,
        })
        assert res.status_code == 201
        section_item = res.get_json()
        assert section_item["isSectionHeader"] is True
        assert section_item["sectionLabel"] == "--- Swing Triggers ---"
        section_id = section_item["id"]

        # 3. Add a second section divider
        res = client.post(f"/api/portfolios/{port_id}/section", json={
            "section_label": "=== PULLBACKS ===",
            "sort_order": 1,
        })
        assert res.status_code == 201

        # 4. Fetch holdings/items for the portfolio and verify headers are present
        res = client.get(f"/api/portfolios/{port_id}/holdings")
        assert res.status_code == 200
        items = res.get_json()
        headers = [it for it in items if it["isSectionHeader"]]
        assert len(headers) == 2

        # 5. Delete section divider
        res = client.delete(f"/api/portfolios/{port_id}/section/{section_id}")
        assert res.status_code == 200
        assert res.get_json()["deleted"] is True

        res = client.get(f"/api/portfolios/{port_id}/holdings")
        items = res.get_json()
        assert not any(it["id"] == section_id for it in items)
    finally:
        client.delete(f"/api/portfolios/{port_id}")


def test_master_stocks_endpoint(client):
    res = client.get("/api/stocks/master")
    assert res.status_code == 200
    data = res.get_json()
    assert "distinct_count" in data
    assert "stocks" in data
    assert isinstance(data["stocks"], list)


def test_bootstrap_includes_categories_and_portfolios(client):
    res = client.get("/api/portfolio/bootstrap")
    assert res.status_code == 200
    data = res.get_json()
    assert "categories" in data
    assert len(data["categories"]) >= 3
    assert "portfolios" in data
    assert "accounts" in data
    assert "masterStocksSummary" in data
    assert "distinctCount" in data["masterStocksSummary"]


def test_legacy_portfolio_migration_from_accounts_table(tmp_path):
    from sqlalchemy import create_engine, text
    from portfolio.data.db import migrate_portfolio_database

    db_path = str(tmp_path / "legacy_portfolio.db")
    engine = create_engine(f"sqlite:///{db_path}")

    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(120) NOT NULL,
                type VARCHAR(120) NOT NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE holdings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                symbol VARCHAR(16) NOT NULL,
                shares FLOAT NOT NULL,
                avg_cost FLOAT NOT NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE portfolio_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(64) NOT NULL,
                sort_order INTEGER DEFAULT 0 NOT NULL,
                is_default BOOLEAN DEFAULT 0 NOT NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            INSERT INTO accounts (name, type, created_at, updated_at)
            VALUES ('Retirement IRA', 'ira', '2026-01-01', '2026-01-01')
        """))
        conn.execute(text("""
            INSERT INTO holdings (account_id, symbol, shares, avg_cost, created_at, updated_at)
            VALUES (1, 'MSFT', 25.0, 310.0, '2026-01-01', '2026-01-01')
        """))

    # Running migration must NOT raise: (sqlite3.OperationalError) use DROP TABLE to delete table accounts
    migrate_portfolio_database(engine)

    with engine.begin() as conn:
        portfolios = conn.execute(text("SELECT id, name, type, category_id FROM portfolios")).fetchall()
        assert len(portfolios) == 1
        assert portfolios[0][1] == "Retirement IRA"
        assert portfolios[0][3] is not None  # Automatically mapped to Brokerage category

        items = conn.execute(text("SELECT id, portfolio_id, symbol, shares, avg_cost FROM portfolio_items")).fetchall()
        assert len(items) == 1
        assert items[0][2] == "MSFT"
        assert items[0][3] == 25.0

        # Backward compatibility views
        acc_view = conn.execute(text("SELECT id, name FROM accounts")).fetchall()
        assert len(acc_view) == 1
        assert acc_view[0][1] == "Retirement IRA"

        hold_view = conn.execute(text("SELECT id, account_id, symbol FROM holdings")).fetchall()
        assert len(hold_view) == 1
        assert hold_view[0][2] == "MSFT"

    # Idempotent second run
    migrate_portfolio_database(engine)


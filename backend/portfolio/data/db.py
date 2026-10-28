from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect, text

db = SQLAlchemy()


def init_db(app):
    db.init_app(app)
    with app.app_context():
        _load_models()
        _migrate_portfolio_schema()
        db.create_all()
        _ensure_stock_columns()
        _ensure_fundamentals_schema()
        _ensure_default_categories()
        _ensure_sizing_mode_schema()


def migrate_portfolio_database(engine=None):
    """Public helper to migrate an existing portfolio SQLite database to the modern schema."""
    _migrate_portfolio_schema(engine=engine)
    _ensure_default_categories(engine=engine)
    _ensure_sizing_mode_schema(engine=engine)


def _migrate_portfolio_schema(engine=None):
    portfolio_engine = engine or db.engine
    inspector = inspect(portfolio_engine)
    existing_views = set(inspector.get_view_names())
    existing_tables = set(inspector.get_table_names())

    with portfolio_engine.begin() as conn:
        # 1. Clean up obsolete views ONLY if they are actually views.
        for view_name in ("accounts", "holdings"):
            if view_name in existing_views:
                conn.exec_driver_sql(f"DROP VIEW IF EXISTS {view_name}")

        conn.exec_driver_sql("DROP TABLE IF EXISTS portfolio_items_migrated")

        # 2. Check if legacy accounts/holdings tables exist and rename them to portfolios/portfolio_items
        if "accounts" in existing_tables and "portfolios" not in existing_tables:
            conn.exec_driver_sql("ALTER TABLE accounts RENAME TO portfolios")
            existing_tables.remove("accounts")
            existing_tables.add("portfolios")

        if "holdings" in existing_tables and "portfolio_items" not in existing_tables:
            conn.exec_driver_sql("ALTER TABLE holdings RENAME TO portfolio_items")
            existing_tables.remove("holdings")
            existing_tables.add("portfolio_items")

        if "portfolio_categories" not in existing_tables:
            try:
                from portfolio.data.models import PortfolioCategory
                PortfolioCategory.__table__.create(conn, checkfirst=True)
            except Exception:
                if portfolio_engine.dialect.name == "sqlite":
                    conn.exec_driver_sql("""
                        CREATE TABLE IF NOT EXISTS portfolio_categories (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            name VARCHAR(64) NOT NULL,
                            sort_order INTEGER DEFAULT 0 NOT NULL,
                            is_default BOOLEAN DEFAULT 0 NOT NULL,
                            created_at DATETIME NOT NULL,
                            updated_at DATETIME NOT NULL
                        )
                    """)
                else:
                    conn.exec_driver_sql("""
                        CREATE TABLE IF NOT EXISTS portfolio_categories (
                            id SERIAL PRIMARY KEY,
                            name VARCHAR(64) NOT NULL,
                            sort_order INTEGER DEFAULT 0 NOT NULL,
                            is_default BOOLEAN DEFAULT FALSE NOT NULL,
                            created_at TIMESTAMP NOT NULL,
                            updated_at TIMESTAMP NOT NULL
                        )
                    """)

    if inspector.has_table("portfolios"):
        port_cols = {col["name"] for col in inspector.get_columns("portfolios")}
        with portfolio_engine.begin() as conn:
            if "category_id" not in port_cols:
                conn.exec_driver_sql("ALTER TABLE portfolios ADD COLUMN category_id INTEGER REFERENCES portfolio_categories(id) ON DELETE SET NULL")
            if "sort_order" not in port_cols:
                conn.exec_driver_sql("ALTER TABLE portfolios ADD COLUMN sort_order INTEGER DEFAULT 0 NOT NULL")

    if inspector.has_table("portfolio_items"):
        item_cols_info = {col["name"]: col for col in inspector.get_columns("portfolio_items")}
        item_cols = set(item_cols_info.keys())
        with portfolio_engine.begin() as conn:
            if "portfolio_id" not in item_cols and "account_id" in item_cols:
                try:
                    conn.exec_driver_sql("ALTER TABLE portfolio_items RENAME COLUMN account_id TO portfolio_id")
                except Exception:
                    pass
            if "is_section_header" not in item_cols:
                conn.exec_driver_sql("ALTER TABLE portfolio_items ADD COLUMN is_section_header BOOLEAN DEFAULT 0 NOT NULL")
            if "section_label" not in item_cols:
                conn.exec_driver_sql("ALTER TABLE portfolio_items ADD COLUMN section_label VARCHAR(64)")
            if "sort_order" not in item_cols:
                conn.exec_driver_sql("ALTER TABLE portfolio_items ADD COLUMN sort_order INTEGER DEFAULT 0 NOT NULL")

        # Ensure symbol column is nullable so section dividers can omit symbol
        sym_col = item_cols_info.get("symbol")
        if sym_col and not sym_col.get("nullable", True):
            if portfolio_engine.dialect.name == "sqlite":
                with portfolio_engine.begin() as conn:
                    conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
                    conn.exec_driver_sql("DROP TABLE IF EXISTS portfolio_items_migrated")
                    conn.exec_driver_sql("""
                        CREATE TABLE portfolio_items_migrated (
                            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                            portfolio_id INTEGER NOT NULL,
                            symbol VARCHAR(16),
                            shares FLOAT NOT NULL DEFAULT 0.0,
                            avg_cost FLOAT NOT NULL DEFAULT 0.0,
                            is_section_header BOOLEAN DEFAULT 0 NOT NULL,
                            section_label VARCHAR(64),
                            sort_order INTEGER DEFAULT 0 NOT NULL,
                            created_at DATETIME NOT NULL,
                            updated_at DATETIME NOT NULL,
                            FOREIGN KEY(portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE
                        )
                    """)
                    conn.exec_driver_sql("""
                        INSERT INTO portfolio_items_migrated (
                            id, portfolio_id, symbol, shares, avg_cost, is_section_header, section_label, sort_order, created_at, updated_at
                        )
                        SELECT id, portfolio_id, symbol, shares, avg_cost, is_section_header, section_label, sort_order, created_at, updated_at
                        FROM portfolio_items
                    """)
                    conn.exec_driver_sql("DROP TABLE portfolio_items")
                    conn.exec_driver_sql("ALTER TABLE portfolio_items_migrated RENAME TO portfolio_items")
                    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_portfolio_items_portfolio_id ON portfolio_items (portfolio_id)")
                    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_portfolio_items_symbol ON portfolio_items (symbol)")
                    conn.exec_driver_sql("PRAGMA foreign_keys=ON")
            else:
                with portfolio_engine.begin() as conn:
                    conn.exec_driver_sql("ALTER TABLE portfolio_items ALTER COLUMN symbol DROP NOT NULL")

    # Create backward compatible SQLite views if needed
    if portfolio_engine.dialect.name == "sqlite":
        with portfolio_engine.begin() as conn:
            if inspector.has_table("portfolios"):
                conn.exec_driver_sql("DROP VIEW IF EXISTS accounts")
                conn.exec_driver_sql("CREATE VIEW IF NOT EXISTS accounts AS SELECT id, category_id, name, type, sort_order, created_at, updated_at FROM portfolios")
            if inspector.has_table("portfolio_items"):
                conn.exec_driver_sql("DROP VIEW IF EXISTS holdings")
                conn.exec_driver_sql("CREATE VIEW IF NOT EXISTS holdings AS SELECT id, portfolio_id AS account_id, symbol, shares, avg_cost, is_section_header, section_label, sort_order, created_at, updated_at FROM portfolio_items")


def _ensure_default_categories(engine=None):
    portfolio_engine = engine or db.engine
    inspector = inspect(portfolio_engine)
    if not inspector.has_table("portfolio_categories") or not inspector.has_table("portfolios"):
        return

    from datetime import datetime
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")

    with portfolio_engine.begin() as conn:
        cat_rows = conn.exec_driver_sql("SELECT id, name FROM portfolio_categories ORDER BY sort_order ASC").fetchall()
        if not cat_rows:
            insert_stmt = text(
                "INSERT INTO portfolio_categories (name, sort_order, is_default, created_at, updated_at) "
                "VALUES (:name, :sort_order, :is_default, :created_at, :updated_at)"
            )
            is_def_val = 1 if portfolio_engine.dialect.name == "sqlite" else True
            conn.execute(
                insert_stmt,
                {"name": "Brokerage Accounts", "sort_order": 0, "is_default": is_def_val, "created_at": now_str, "updated_at": now_str}
            )
            conn.execute(
                insert_stmt,
                {"name": "Sector Baskets", "sort_order": 1, "is_default": is_def_val, "created_at": now_str, "updated_at": now_str}
            )
            conn.execute(
                insert_stmt,
                {"name": "Action Watchlists", "sort_order": 2, "is_default": is_def_val, "created_at": now_str, "updated_at": now_str}
            )
            cat_rows = conn.exec_driver_sql("SELECT id, name FROM portfolio_categories ORDER BY sort_order ASC").fetchall()

        cat_map = {row[1]: row[0] for row in cat_rows}
        default_cat_id = cat_rows[0][0]
        brokerage_cat_id = cat_map.get("Brokerage Accounts", default_cat_id)
        sector_cat_id = cat_map.get("Sector Baskets", default_cat_id)
        watchlist_cat_id = cat_map.get("Action Watchlists", default_cat_id)

        unmapped = conn.exec_driver_sql("SELECT id, name, type FROM portfolios WHERE category_id IS NULL").fetchall()
        for p_id, p_name, p_type in unmapped:
            p_name_l = (p_name or "").lower()
            p_type_l = (p_type or "").lower()
            if any(term in p_name_l or term in p_type_l for term in ["sector", "basket", "macro", "industry", "tech", "medical", "consumer"]):
                target_cat_id = sector_cat_id
            elif any(term in p_name_l or term in p_type_l for term in ["watch", "action", "swing", "buy", "beat", "ideas"]):
                target_cat_id = watchlist_cat_id
            else:
                target_cat_id = brokerage_cat_id

            conn.execute(
                text("UPDATE portfolios SET category_id = :cat_id WHERE id = :id"),
                {"cat_id": target_cat_id, "id": p_id}
            )


def _load_models():
    # Import models so SQLAlchemy metadata is populated before create/drop calls.
    import portfolio.data.models  # noqa: F401


def _ensure_stock_columns():
    master_engine = db.engines.get("master", db.engine)
    inspector = inspect(master_engine)
    if not inspector.has_table("stocks"):
        return

    existing = {column["name"] for column in inspector.get_columns("stocks")}
    column_defs = {
        "exchange": "VARCHAR(80)",
        "currency": "VARCHAR(16)",
        "last_price": "FLOAT",
        "previous_close": "FLOAT",
        "market_cap": "BIGINT",
        "last_split_date": "DATE",
        "split_dirty": "BOOLEAN DEFAULT 0 NOT NULL" if master_engine.dialect.name == "sqlite" else "BOOLEAN DEFAULT FALSE NOT NULL",
        "price_dirty": "BOOLEAN DEFAULT 0 NOT NULL" if master_engine.dialect.name == "sqlite" else "BOOLEAN DEFAULT FALSE NOT NULL",
        "post_market_price": "FLOAT",
        "post_market_change": "FLOAT",
        "post_market_change_percent": "FLOAT",
        "pre_market_price": "FLOAT",
        "pre_market_change": "FLOAT",
        "pre_market_change_percent": "FLOAT",
        "day_open": "FLOAT",
        "day_high": "FLOAT",
        "day_low": "FLOAT",
        "subscriber_count": "INTEGER DEFAULT 1 NOT NULL",
    }

    with master_engine.begin() as connection:
        for column_name, column_type in column_defs.items():
            if column_name not in existing:
                connection.exec_driver_sql(f"ALTER TABLE stocks ADD COLUMN {column_name} {column_type}")

    if master_engine.dialect.name != "sqlite":
        for ddl in (
            "ALTER TABLE stocks ALTER COLUMN market_cap TYPE BIGINT",
            "ALTER TABLE stock_prices ALTER COLUMN volume TYPE BIGINT",
            "ALTER TABLE stock_intraday_prices ALTER COLUMN volume TYPE BIGINT",
        ):
            try:
                with master_engine.begin() as conn:
                    conn.exec_driver_sql(ddl)
            except Exception:
                pass

    # Clear false-positive price_dirty flags caused by unsettled current-day Close=NaN rows
    try:
        with master_engine.begin() as conn:
            if master_engine.dialect.name == "sqlite":
                conn.exec_driver_sql("UPDATE stocks SET price_dirty = 0 WHERE price_dirty = 1")
            else:
                conn.exec_driver_sql("UPDATE stocks SET price_dirty = FALSE WHERE price_dirty IS TRUE")
    except Exception:
        pass


def _ensure_sizing_mode_schema(engine=None):
    portfolio_engine = engine or db.engine
    inspector = inspect(portfolio_engine)
    existing_tables = set(inspector.get_table_names())

    with portfolio_engine.begin() as conn:
        # 1. Accounts / Portfolios columns (only real tables, not views)
        for tbl in ("portfolios", "accounts"):
            if tbl in existing_tables:
                cols = {col["name"] for col in inspector.get_columns(tbl)}
                if "sizing_mode" not in cols:
                    conn.exec_driver_sql(f"ALTER TABLE {tbl} ADD COLUMN sizing_mode VARCHAR(16) NOT NULL DEFAULT 'PERCENT'")

        # 2. Backfill: For any existing account/portfolio that already has a holding with shares > 0, set sizing_mode = 'SHARES'
        has_ports = "portfolios" in existing_tables
        has_items = "portfolio_items" in existing_tables
        if has_ports and has_items:
            conn.exec_driver_sql("""
                UPDATE portfolios 
                SET sizing_mode = 'SHARES' 
                WHERE id IN (
                    SELECT DISTINCT portfolio_id 
                    FROM portfolio_items 
                    WHERE shares > 0 AND (is_section_header IS NOT TRUE)
                )
            """)
        else:
            has_accs = "accounts" in existing_tables
            has_holds = "account_stocks" in existing_tables
            if has_accs and has_holds:
                conn.exec_driver_sql("""
                    UPDATE accounts 
                    SET sizing_mode = 'SHARES' 
                    WHERE id IN (
                        SELECT DISTINCT account_id 
                        FROM account_stocks 
                        WHERE shares > 0
                    )
                """)

        # 3. Item tables (only real tables, not views)
        for tbl in ("portfolio_items", "account_stocks", "holdings"):
            if tbl in existing_tables:
                cols = {col["name"] for col in inspector.get_columns(tbl)}
                if "weight_pct" not in cols:
                    conn.exec_driver_sql(f"ALTER TABLE {tbl} ADD COLUMN weight_pct FLOAT DEFAULT NULL")

        # 4. Refresh compatibility views for SQLite only
        if portfolio_engine.dialect.name == "sqlite":
            if has_ports:
                conn.exec_driver_sql("DROP VIEW IF EXISTS accounts")
                conn.exec_driver_sql("CREATE VIEW IF NOT EXISTS accounts AS SELECT id, category_id, name, type, sort_order, sizing_mode, created_at, updated_at FROM portfolios")

            if has_items:
                conn.exec_driver_sql("DROP VIEW IF EXISTS holdings")
                conn.exec_driver_sql("CREATE VIEW IF NOT EXISTS holdings AS SELECT id, portfolio_id AS account_id, symbol, shares, avg_cost, is_section_header, section_label, sort_order, weight_pct, created_at, updated_at FROM portfolio_items")


def _ensure_fundamentals_schema(engine_or_conn=None):
    """Auto-create stock_fundamentals, stock_earnings_history, and stock_dividend_history tables safely if they do not exist."""
    try:
        from portfolio.data.models import StockFundamentals, StockEarningsHistory, StockDividendHistory
        models = [StockFundamentals, StockEarningsHistory, StockDividendHistory]
        if engine_or_conn is not None:
            if hasattr(engine_or_conn, "begin") and callable(engine_or_conn.begin):
                with engine_or_conn.begin() as conn:
                    for m in models:
                        m.__table__.create(conn, checkfirst=True)
                return
            elif hasattr(engine_or_conn, "execute"):
                for m in models:
                    m.__table__.create(engine_or_conn, checkfirst=True)
                return
        else:
            target_engine = db.engines.get("master", db.engine)
            with target_engine.begin() as conn:
                for m in models:
                    m.__table__.create(conn, checkfirst=True)
            return
    except Exception:
        pass

    is_sqlite = True
    if hasattr(engine_or_conn, "dialect"):
        is_sqlite = engine_or_conn.dialect.name == "sqlite"
    elif hasattr(engine_or_conn, "engine") and hasattr(engine_or_conn.engine, "dialect"):
        is_sqlite = engine_or_conn.engine.dialect.name == "sqlite"

    pk_type = "INTEGER PRIMARY KEY AUTOINCREMENT" if is_sqlite else "SERIAL PRIMARY KEY"

    statements = [
        """
        CREATE TABLE IF NOT EXISTS stock_fundamentals (
            symbol VARCHAR(16) NOT NULL PRIMARY KEY,
            next_earnings_date DATE,
            earnings_avg_est FLOAT,
            dividend_rate FLOAT,
            dividend_yield FLOAT,
            payout_ratio FLOAT,
            ex_dividend_date DATE,
            five_year_avg_yield FLOAT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS stock_earnings_history (
            id {pk_type},
            symbol VARCHAR(16) NOT NULL,
            earnings_date DATE NOT NULL,
            eps_estimate FLOAT,
            eps_reported FLOAT,
            surprise_pct FLOAT,
            UNIQUE (symbol, earnings_date)
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_stock_earnings_history_symbol ON stock_earnings_history (symbol)",
        f"""
        CREATE TABLE IF NOT EXISTS stock_dividend_history (
            id {pk_type},
            symbol VARCHAR(16) NOT NULL,
            ex_date DATE NOT NULL,
            cash_amount FLOAT NOT NULL,
            UNIQUE (symbol, ex_date)
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_stock_dividend_history_symbol ON stock_dividend_history (symbol)",
    ]

    if engine_or_conn is not None:
        # Handle sqlite3.Connection, SQLAlchemy Connection, or SQLAlchemy Engine
        if hasattr(engine_or_conn, "begin") and callable(engine_or_conn.begin):
            with engine_or_conn.begin() as conn:
                for stmt in statements:
                    conn.exec_driver_sql(stmt)
        elif hasattr(engine_or_conn, "exec_driver_sql"):
            for stmt in statements:
                engine_or_conn.exec_driver_sql(stmt)
        else:
            for stmt in statements:
                engine_or_conn.execute(stmt)
            if hasattr(engine_or_conn, "commit"):
                engine_or_conn.commit()
        return

    target_engine = db.engines.get("master", db.engine)
    with target_engine.begin() as conn:
        for stmt in statements:
            conn.exec_driver_sql(stmt)



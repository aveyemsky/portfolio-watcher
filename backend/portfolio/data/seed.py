from flask import Flask

from config import Config
from portfolio.core.logging import get_logger
from portfolio.data.db import db, init_db
from portfolio.data.models import Account, Holding, PortfolioCategory, Stock, TrackedStock

logger = get_logger(__name__)

# Initial seed setup.
# Creates default categories, sample accounts, and core tracked stocks.
# Price history is retrieved live from market data on-demand or upon sync.

CATEGORIES = [
    ("Brokerage Accounts", 0, [
        ("account1", "Taxable brokerage"),
        ("account2", "Traditional IRA"),
    ]),
    ("Sector Baskets", 1, [
        ("Tech Rotation", "Macro tracking"),
        ("Healthcare", "Health sector"),
    ]),
    ("Action Watchlists", 2, [
        ("To Buy Soon", "Stage setups"),
        ("Beat Down", "Deep value / bounce"),
    ]),
]

STOCKS = [
    ("AAPL", "Apple Inc.", "Technology"),
    ("MSFT", "Microsoft Corporation", "Technology"),
    ("NVDA", "NVIDIA Corporation", "Semiconductors"),
    ("GOOGL", "Alphabet Inc.", "Communication Services"),
    ("AMZN", "Amazon.com Inc.", "Consumer Discretionary"),
    ("META", "Meta Platforms Inc.", "Communication Services"),
    ("TSLA", "Tesla Inc.", "Consumer Discretionary"),
    ("AMD", "Advanced Micro Devices Inc.", "Semiconductors"),
    ("AVGO", "Broadcom Inc.", "Semiconductors"),
    ("JPM", "JPMorgan Chase & Co.", "Financials"),
    ("V", "Visa Inc.", "Financials"),
    ("COST", "Costco Wholesale Corporation", "Consumer Staples"),
    ("UNH", "UnitedHealth Group Incorporated", "Health Care"),
    ("LLY", "Eli Lilly and Company", "Health Care"),
]

HOLDINGS = {}


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    init_db(app)
    return app


def seed_database():
    logger.info("Seeding PortfolioWatcher demo database")
    db.drop_all()
    db.create_all()

    accounts = {}
    categories = []
    for cat_name, cat_sort, port_list in CATEGORIES:
        category = PortfolioCategory(name=cat_name, sort_order=cat_sort, is_default=True)
        categories.append(category)
        db.session.add(category)
        db.session.flush()

        for port_sort, (p_name, p_type) in enumerate(port_list):
            account = Account(
                name=p_name,
                type=p_type,
                category_id=category.id,
                sort_order=port_sort,
            )
            accounts[p_name] = account
            db.session.add(account)

    stocks = {
        symbol: Stock(symbol=symbol, name=name, sector=sector)
        for symbol, name, sector in STOCKS
    }

    db.session.add_all(stocks.values())
    db.session.flush()

    tracked = [
        TrackedStock(symbol=symbol, display_order=idx)
        for idx, (symbol, _, _) in enumerate(STOCKS)
    ]
    db.session.add_all(tracked)
    db.session.flush()

    holdings = []
    for account_name, account_holdings in HOLDINGS.items():
        account = accounts.get(account_name)
        if not account:
            continue
        for sort_idx, item_tuple in enumerate(account_holdings):
            if len(item_tuple) == 4 and item_tuple[3]:
                # Section divider
                holdings.append(
                    Holding(
                        portfolio_id=account.id,
                        symbol=None,
                        shares=0.0,
                        avg_cost=0.0,
                        is_section_header=True,
                        section_label=item_tuple[0],
                        sort_order=sort_idx,
                    )
                )
            else:
                symbol, shares, avg_cost = item_tuple[0], item_tuple[1], item_tuple[2]
                holdings.append(
                    Holding(
                        portfolio_id=account.id,
                        symbol=symbol,
                        shares=shares or 0.0,
                        avg_cost=avg_cost or 0.0,
                        is_section_header=False,
                        section_label=None,
                        sort_order=sort_idx,
                    )
                )

    db.session.add_all(holdings)
    db.session.flush()

    db.session.commit()

    from portfolio.services.index_service import ensure_default_indices
    ensure_default_indices()

    logger.info(
        "Seed complete: %s accounts, %s stocks, %s holdings",
        len(accounts),
        len(stocks),
        len(holdings),
    )


if __name__ == "__main__":
    flask_app = create_app()
    with flask_app.app_context():
        seed_database()

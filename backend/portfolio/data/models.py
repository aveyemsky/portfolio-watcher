from datetime import datetime

from portfolio.data.db import db


class TimestampMixin:
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class PortfolioCategory(TimestampMixin, db.Model):
    __tablename__ = "portfolio_categories"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), nullable=False)
    sort_order = db.Column(db.Integer, default=0, nullable=False)
    is_default = db.Column(db.Boolean, default=False, nullable=False)

    portfolios = db.relationship(
        "Portfolio",
        back_populates="category",
        order_by="Portfolio.sort_order",
    )


class Portfolio(TimestampMixin, db.Model):
    __tablename__ = "portfolios"

    id = db.Column(db.Integer, primary_key=True)
    category_id = db.Column(
        db.Integer,
        db.ForeignKey("portfolio_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    name = db.Column(db.String(120), nullable=False)
    type = db.Column(db.String(120), nullable=True)
    sort_order = db.Column(db.Integer, default=0, nullable=False)
    sizing_mode = db.Column(db.String(16), nullable=False, default="PERCENT")

    category = db.relationship("PortfolioCategory", back_populates="portfolios")
    items = db.relationship(
        "PortfolioItem",
        back_populates="portfolio",
        cascade="all, delete-orphan",
        order_by="PortfolioItem.sort_order",
    )

    @property
    def holdings(self):
        return [item for item in self.items if not item.is_section_header]


# Backwards compatibility alias
Account = Portfolio


class PortfolioItem(TimestampMixin, db.Model):
    __tablename__ = "portfolio_items"

    id = db.Column(db.Integer, primary_key=True)
    portfolio_id = db.Column(
        db.Integer,
        db.ForeignKey("portfolios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    symbol = db.Column(db.String(16), nullable=True, index=True)
    shares = db.Column(db.Float, default=0.0, nullable=False)
    avg_cost = db.Column(db.Float, default=0.0, nullable=False)
    weight_pct = db.Column(db.Float, nullable=True, default=None)
    is_section_header = db.Column(db.Boolean, default=False, nullable=False)
    section_label = db.Column(db.String(64), nullable=True)
    sort_order = db.Column(db.Integer, default=0, nullable=False)

    portfolio = db.relationship("Portfolio", back_populates="items")

    @property
    def account_id(self):
        return self.portfolio_id

    @account_id.setter
    def account_id(self, val):
        self.portfolio_id = val

    @property
    def account(self):
        return self.portfolio

    @account.setter
    def account(self, val):
        self.portfolio = val


# Backwards compatibility alias
Holding = PortfolioItem
AccountStock = PortfolioItem


class Stock(TimestampMixin, db.Model):
    __bind_key__ = "master"
    __tablename__ = "stocks"

    id = db.Column(db.Integer, primary_key=True)
    symbol = db.Column(db.String(16), unique=True, nullable=False, index=True)
    name = db.Column(db.String(160), nullable=False)
    sector = db.Column(db.String(120), nullable=False)
    exchange = db.Column(db.String(80), nullable=True)
    currency = db.Column(db.String(16), nullable=True)
    last_price = db.Column(db.Float, nullable=True)
    previous_close = db.Column(db.Float, nullable=True)
    market_cap = db.Column(db.BigInteger, nullable=True)
    last_split_date = db.Column(db.Date, nullable=True)
    split_dirty = db.Column(db.Boolean, default=False, nullable=False)
    price_dirty = db.Column(db.Boolean, default=False, nullable=False)
    post_market_price = db.Column(db.Float, nullable=True)
    post_market_change = db.Column(db.Float, nullable=True)
    post_market_change_percent = db.Column(db.Float, nullable=True)
    pre_market_price = db.Column(db.Float, nullable=True)
    pre_market_change = db.Column(db.Float, nullable=True)
    pre_market_change_percent = db.Column(db.Float, nullable=True)
    day_open = db.Column(db.Float, nullable=True)
    day_high = db.Column(db.Float, nullable=True)
    day_low = db.Column(db.Float, nullable=True)
    asset_type = db.Column(db.String(16), default="stock", nullable=False)
    is_deletable = db.Column(db.Boolean, default=True, nullable=False)
    display_order = db.Column(db.Integer, nullable=True)
    short_name = db.Column(db.String(80), nullable=True)
    subscriber_count = db.Column(db.Integer, default=0, nullable=False)

    prices = db.relationship("StockPrice", back_populates="stock", cascade="all, delete-orphan")
    intraday_prices = db.relationship("StockIntradayPrice", back_populates="stock", cascade="all, delete-orphan")


class TrackedStock(TimestampMixin, db.Model):
    __tablename__ = "tracked_stocks"

    id = db.Column(db.Integer, primary_key=True)
    symbol = db.Column(db.String(16), unique=True, nullable=False, index=True)
    display_order = db.Column(db.Integer, default=0, nullable=False)


class StockPrice(db.Model):
    __bind_key__ = "master"
    __tablename__ = "stock_prices"

    id = db.Column(db.Integer, primary_key=True)
    stock_id = db.Column(db.Integer, db.ForeignKey("stocks.id"), nullable=False, index=True)
    date = db.Column(db.Date, nullable=False, index=True)
    open = db.Column(db.Float, nullable=False)
    high = db.Column(db.Float, nullable=False)
    low = db.Column(db.Float, nullable=False)
    close = db.Column(db.Float, nullable=False)
    volume = db.Column(db.BigInteger, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    stock = db.relationship("Stock", back_populates="prices")

    __table_args__ = (
        db.UniqueConstraint("stock_id", "date", name="uq_stock_price_stock_date"),
    )


class StockIntradayPrice(TimestampMixin, db.Model):
    __bind_key__ = "master"
    __tablename__ = "stock_intraday_prices"

    id = db.Column(db.Integer, primary_key=True)
    stock_id = db.Column(db.Integer, db.ForeignKey("stocks.id"), nullable=False, index=True)
    symbol = db.Column(db.String(16), nullable=False, index=True)
    trading_date = db.Column(db.Date, nullable=False, index=True)
    timestamp = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
    interval = db.Column(db.String(8), nullable=False, index=True)
    open = db.Column(db.Float, nullable=False)
    high = db.Column(db.Float, nullable=False)
    low = db.Column(db.Float, nullable=False)
    close = db.Column(db.Float, nullable=False)
    volume = db.Column(db.BigInteger, nullable=False)
    provider = db.Column(db.String(40), nullable=False, default="yfinance")
    fetched_at = db.Column(db.DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    stock = db.relationship("Stock", back_populates="intraday_prices")

    __table_args__ = (
        db.UniqueConstraint("stock_id", "interval", "timestamp", name="uq_stock_intraday_stock_interval_timestamp"),
    )


class StockNote(TimestampMixin, db.Model):
    __tablename__ = "stock_notes"

    id = db.Column(db.Integer, primary_key=True)
    symbol = db.Column(db.String(16), nullable=False, index=True)
    title = db.Column(db.String(255), nullable=False, default="")
    content = db.Column(db.Text, nullable=False, default="")


class StockFundamentals(db.Model):
    __bind_key__ = "master"
    __tablename__ = "stock_fundamentals"

    symbol = db.Column(db.String(16), primary_key=True)
    next_earnings_date = db.Column(db.Date, nullable=True)
    earnings_avg_est = db.Column(db.Float, nullable=True)
    dividend_rate = db.Column(db.Float, nullable=True)
    dividend_yield = db.Column(db.Float, nullable=True)
    payout_ratio = db.Column(db.Float, nullable=True)
    ex_dividend_date = db.Column(db.Date, nullable=True)
    five_year_avg_yield = db.Column(db.Float, nullable=True)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class StockEarningsHistory(db.Model):
    __bind_key__ = "master"
    __tablename__ = "stock_earnings_history"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    symbol = db.Column(db.String(16), nullable=False, index=True)
    earnings_date = db.Column(db.Date, nullable=False)
    eps_estimate = db.Column(db.Float, nullable=True)
    eps_reported = db.Column(db.Float, nullable=True)
    surprise_pct = db.Column(db.Float, nullable=True)

    __table_args__ = (
        db.UniqueConstraint("symbol", "earnings_date", name="uq_stock_earnings_symbol_date"),
    )


class StockDividendHistory(db.Model):
    __bind_key__ = "master"
    __tablename__ = "stock_dividend_history"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    symbol = db.Column(db.String(16), nullable=False, index=True)
    ex_date = db.Column(db.Date, nullable=False)
    cash_amount = db.Column(db.Float, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("symbol", "ex_date", name="uq_stock_dividend_symbol_date"),
    )


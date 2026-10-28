import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class Config:
    PORTFOLIO_DATABASE_PATH = os.environ.get(
        "PORTFOLIO_DATABASE_PATH",
        os.path.join(BASE_DIR, "portfolio.db"),
    )
    MASTER_DATABASE_PATH = os.environ.get(
        "MASTER_DATABASE_PATH",
        os.path.join(BASE_DIR, "master_stocks.db"),
    )

    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL",
        f"sqlite:///{PORTFOLIO_DATABASE_PATH}",
    )
    SQLALCHEMY_BINDS = {
        "master": f"sqlite:///{MASTER_DATABASE_PATH}",
    }
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
    PORT = int(os.environ.get("PORT", "5739"))
    STOCK_HISTORY_START_DATE = os.environ.get("STOCK_HISTORY_START_DATE", "2017-01-01")
    STOCK_HISTORY_PERIOD = os.environ.get("STOCK_HISTORY_PERIOD")
    DEFAULT_INTRADAY_INTERVAL = os.environ.get("DEFAULT_INTRADAY_INTERVAL", "5m")
    SUPPORTED_INTRADAY_INTERVALS = ["1m", "5m", "15m"]
    INTRADAY_CACHE_TTL_SECONDS = int(os.environ.get("INTRADAY_CACHE_TTL_SECONDS", "60"))

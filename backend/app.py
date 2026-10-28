import os
import warnings

# Suppress NumPy/pandas timedelta deprecation warnings emitted by yfinance internal scrapers
warnings.filterwarnings("ignore", message=r".*generic.*unit for NumPy timedelta.*")
warnings.filterwarnings("ignore", message=r".*The 'generic' unit for NumPy timedelta is deprecated.*")
warnings.filterwarnings("ignore", category=DeprecationWarning, module=r"yfinance(\..*)?")

from flask import Flask
from flask_cors import CORS

from config import Config
from portfolio.api.errors import register_error_handlers
from portfolio.api.routes import portfolio_api
from portfolio.core.logging import get_logger, suppress_yfinance_warnings
from portfolio.data.db import init_db

suppress_yfinance_warnings()
logger = get_logger(__name__)


def create_app(start_scheduler: bool = True):
    app = Flask(__name__)
    app.config.from_object(Config)

    init_db(app)
    CORS(app)

    app.register_blueprint(portfolio_api)
    app.register_blueprint(portfolio_api, name="api_direct", url_prefix="/api")
    register_error_handlers(app)

    with app.app_context():
        try:
            from portfolio.services.index_service import ensure_default_indices
            ensure_default_indices()
        except Exception as exc:
            logger.warning("Could not auto-seed indices on startup: %s", exc)

        if start_scheduler and not app.config.get("TESTING") and os.environ.get("DISABLE_SCHEDULER") != "1":
            try:
                from portfolio.services.market_scheduler import start_market_scheduler
                start_market_scheduler(app)
            except Exception as exc:
                logger.warning("Could not start market scheduler on startup: %s", exc)

    @app.get("/")
    def index():
        return {
            "service": "PortfolioWatcher backend",
            "status": "ok",
            "api": "/api/portfolio",
            "frontend": "http://localhost:5175",
        }

    @app.get("/favicon.ico")
    def favicon():
        return "", 204

    logger.info("PortfolioWatcher backend started")
    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=app.config["PORT"], debug=True)

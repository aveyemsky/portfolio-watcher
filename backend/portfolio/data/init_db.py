from flask import Flask

from config import Config
from portfolio.core.logging import get_logger
from portfolio.data.db import (
    db,
    init_db,
    _ensure_sizing_mode_schema,
    _ensure_fundamentals_schema,
)
import portfolio.data.models  # noqa: F401

logger = get_logger(__name__)


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    init_db(app)
    return app


def initialize_database():
    logger.info("Resetting PortfolioWatcher database to an empty schema")
    db.drop_all()
    db.create_all()
    _ensure_fundamentals_schema()


if __name__ == "__main__":
    flask_app = create_app()
    with flask_app.app_context():
        initialize_database()


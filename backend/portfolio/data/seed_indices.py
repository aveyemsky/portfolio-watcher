from flask import Flask

from config import Config
from portfolio.core.logging import get_logger
from portfolio.data.db import init_db
from portfolio.services.index_service import ensure_default_indices

logger = get_logger(__name__)


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    init_db(app)
    return app


def seed_indices():
    logger.info("Seeding market benchmark indices")
    indices = ensure_default_indices()
    logger.info("Seeded %d indices: %s", len(indices), [idx.symbol for idx in indices])
    return indices


if __name__ == "__main__":
    app = create_app()
    with app.app_context():
        seed_indices()

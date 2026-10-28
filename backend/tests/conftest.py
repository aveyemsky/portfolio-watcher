"""
Pytest configuration and test database isolation for portfolio-watcher backend.
Ensures tests run in an isolated temporary SQLite database and NEVER touch the default portfolio.db.
"""
import os
import shutil
import tempfile
import pytest

_ORIGINAL_PORTFOLIO_DB = os.environ.get("PORTFOLIO_DATABASE_PATH")
_ORIGINAL_MASTER_DB = os.environ.get("MASTER_DATABASE_PATH")
_ORIGINAL_DB_URL = os.environ.get("DATABASE_URL")


@pytest.fixture(scope="session", autouse=True)
def isolate_test_database():
    """
    Session-wide fixture that redirects all database operations to an isolated temp directory.
    Cleans up after the test session finishes.
    """
    temp_dir = tempfile.mkdtemp(prefix="pw_test_db_")
    temp_portfolio_db = os.path.join(temp_dir, "test_portfolio.db")
    temp_master_db = os.path.join(temp_dir, "test_master_stocks.db")

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src_portfolio = os.path.join(base_dir, "portfolio.db")
    src_master = os.path.join(base_dir, "master_stocks.db")

    if os.path.exists(src_portfolio):
        shutil.copyfile(src_portfolio, temp_portfolio_db)
    if os.path.exists(src_master):
        shutil.copyfile(src_master, temp_master_db)

    os.environ["PORTFOLIO_DATABASE_PATH"] = temp_portfolio_db
    os.environ["MASTER_DATABASE_PATH"] = temp_master_db
    os.environ["DATABASE_URL"] = f"sqlite:///{temp_portfolio_db}"

    try:
        from config import Config
        Config.PORTFOLIO_DATABASE_PATH = temp_portfolio_db
        Config.MASTER_DATABASE_PATH = temp_master_db
        Config.SQLALCHEMY_DATABASE_URI = f"sqlite:///{temp_portfolio_db}"
        Config.SQLALCHEMY_BINDS = {"master": f"sqlite:///{temp_master_db}"}
    except ImportError:
        pass

    try:
        from portfolio.mcp import server as mcp_server_module
        mcp_server_module._flask_app = None
    except ImportError:
        pass

    yield temp_dir

    shutil.rmtree(temp_dir, ignore_errors=True)

    if _ORIGINAL_PORTFOLIO_DB is not None:
        os.environ["PORTFOLIO_DATABASE_PATH"] = _ORIGINAL_PORTFOLIO_DB
    else:
        os.environ.pop("PORTFOLIO_DATABASE_PATH", None)

    if _ORIGINAL_MASTER_DB is not None:
        os.environ["MASTER_DATABASE_PATH"] = _ORIGINAL_MASTER_DB
    else:
        os.environ.pop("MASTER_DATABASE_PATH", None)

    if _ORIGINAL_DB_URL is not None:
        os.environ["DATABASE_URL"] = _ORIGINAL_DB_URL
    else:
        os.environ.pop("DATABASE_URL", None)

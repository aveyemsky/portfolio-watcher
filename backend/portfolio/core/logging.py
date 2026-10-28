import logging
import os
import warnings

_LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
_configured = False


def suppress_yfinance_warnings():
    """Suppress third-party deprecation warnings emitted by yfinance internal scrapers.

    yfinance/__init__.py injects `warnings.filterwarnings('default', category=DeprecationWarning, module='^yfinance')`
    at import time, which overrides all prior filters and forces Python to print NumPy 2.x timedelta warnings.
    This helper neutralizes yfinance's override and silences the warnings.
    """
    warnings.filterwarnings("ignore", message=r".*generic.*unit for NumPy timedelta.*")
    warnings.filterwarnings("ignore", message=r".*The 'generic' unit for NumPy timedelta is deprecated.*")
    warnings.filterwarnings("ignore", category=DeprecationWarning, module=r".*yfinance.*")
    warnings.filters[:] = [
        f for f in warnings.filters
        if not (f[0] == "default" and f[2] is DeprecationWarning and getattr(f[3], "pattern", "") == "^yfinance")
    ]


def configure_logging(level=None):
    global _configured
    log_level = (level or os.environ.get("LOG_LEVEL") or "INFO").upper()

    if not _configured:
        logging.basicConfig(level=log_level, format=_LOG_FORMAT)
        suppress_yfinance_warnings()
        _configured = True
    else:
        logging.getLogger().setLevel(log_level)


def get_logger(name):
    configure_logging()
    return logging.getLogger(name)



"""PortfolioWatcher backend package."""
import warnings

# Suppress upstream NumPy/pandas timedelta deprecation warnings emitted by yfinance internal scrapers
warnings.filterwarnings("ignore", category=DeprecationWarning, message=r".*generic.*unit for NumPy timedelta.*")
warnings.filterwarnings("ignore", category=DeprecationWarning, module=r"yfinance.*")

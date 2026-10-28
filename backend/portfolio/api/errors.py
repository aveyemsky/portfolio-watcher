from flask import jsonify
from werkzeug.exceptions import HTTPException

from portfolio.core.logging import get_logger

logger = get_logger(__name__)


class PortfolioApiError(Exception):
    status_code = 400
    code = "api_error"

    def __init__(self, message, status_code=None, code=None):
        super().__init__(message)
        if status_code is not None:
            self.status_code = status_code
        if code is not None:
            self.code = code


class NotFoundError(PortfolioApiError):
    status_code = 404
    code = "not_found"


class ValidationError(PortfolioApiError):
    status_code = 400
    code = "validation_error"


class ServiceError(PortfolioApiError):
    status_code = 500
    code = "service_error"


class UpstreamRateLimitError(PortfolioApiError):
    status_code = 429
    code = "upstream_rate_limited"


class UpstreamTimeoutError(PortfolioApiError):
    status_code = 504
    code = "upstream_timeout"


def api_error(message, status_code=400, code=None):
    payload = {
        "error": {
            "code": code or "api_error",
            "message": message,
        }
    }
    return jsonify(payload), status_code


def register_error_handlers(app):
    @app.errorhandler(PortfolioApiError)
    def handle_portfolio_api_error(error):
        logger.warning("Portfolio API error: %s", error)
        return api_error(str(error), error.status_code, error.code)

    @app.errorhandler(Exception)
    def handle_unexpected_error(error):
        if isinstance(error, HTTPException):
            logger.warning("HTTP error: %s", error)
            code = "not_found" if error.code == 404 else "http_error"
            return api_error(error.description, error.code or 500, code)

        logger.exception("Unexpected API error")
        return api_error("Internal server error", 500, "internal_error")

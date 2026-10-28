"""PortfolioWatcher MCP Server.

Provides entry point and server creation for Model Context Protocol integration.
"""

import argparse
import functools
import os
import sys

# Ensure background scheduler doesn't run during MCP operations
os.environ["DISABLE_SCHEDULER"] = "1"

from mcp.server.mcpserver import MCPServer
from portfolio.core.logging import get_logger

logger = get_logger(__name__)

_flask_app = None


def get_flask_app():
    """Lazily load and cache the Flask application instance."""
    global _flask_app
    if _flask_app is None:
        try:
            from flask import current_app
            if current_app:
                return current_app._get_current_object()
        except Exception:
            pass

        try:
            from app import create_app
            _flask_app = create_app(start_scheduler=False)
        except Exception:
            try:
                from backend.app import create_app
                _flask_app = create_app()
            except Exception:
                pass
    return _flask_app


def _bind_tenant_context():
    """Helper to resolve and bind the tenant engine inside the active app context."""
    try:
        from flask import g
        from backend.fowaplay.tenant_resolver import tenant_engine_manager
        from backend.config import Config
        from backend.fowaplay.user_manager import UserManager

        target_guid = getattr(g, "tenant_guid", None) or os.environ.get("FOWA_TENANT_GUID")
        if not target_guid:
            target_email = os.environ.get("FOWA_TENANT_EMAIL", getattr(Config, "ADMIN_EMAIL", None))
            if target_email:
                prof = UserManager().get_user_profile_by_email(target_email)
                if prof and prof.data and prof.data.get("guid"):
                    target_guid = prof.data["guid"]

        if target_guid:
            g.tenant_guid = target_guid
            g.tenant_engine = tenant_engine_manager.get_engine_for_tenant(target_guid)
    except Exception:
        pass


def with_app_context(func):
    """Decorator to ensure database access runs inside a Flask application context."""

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        from flask import has_app_context
        if has_app_context():
            _bind_tenant_context()
            return func(*args, **kwargs)

        app = get_flask_app()
        with app.app_context():
            _bind_tenant_context()
            return func(*args, **kwargs)

    return wrapper


def create_mcp_server() -> MCPServer:
    """Create and configure the PortfolioWatcher MCP Server instance."""
    server = MCPServer(
        name="PortfolioWatcher",
        version="1.0.0",
        instructions=(
            "You are connected to PortfolioWatcher, an investment portfolio and market "
            "analysis application. You have tools to query portfolio accounts and holdings, "
            "fetch real-time and historical stock quotes, calculate technical indicators "
            "(RSI, MACD, Bollinger Bands, Moving Averages), read fundamental SEC documents and news, "
            "and record research notes."
        ),
    )

    # Register domain tools, resources, and prompt templates
    from portfolio.mcp.tools import register_tools
    from portfolio.mcp.resources import register_resources
    from portfolio.mcp.prompts import register_prompts

    register_tools(server)
    register_resources(server)
    register_prompts(server)

    return server


def main():
    parser = argparse.ArgumentParser(description="PortfolioWatcher MCP Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "sse", "streamable-http"],
        default="stdio",
        help="Transport protocol to use (default: stdio)",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind for HTTP/SSE transport (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8765,
        help="Port to bind for HTTP/SSE transport (default: 8765)",
    )

    args = parser.parse_args()

    server = create_mcp_server()
    logger.info("Starting PortfolioWatcher MCP server using %s transport", args.transport)

    if args.transport == "stdio":
        server.run(transport="stdio")
    elif args.transport == "sse":
        server.run(transport="sse", host=args.host, port=args.port)
    elif args.transport == "streamable-http":
        server.run(transport="streamable-http", host=args.host, port=args.port)


if __name__ == "__main__":
    main()

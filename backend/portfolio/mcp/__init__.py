"""PortfolioWatcher Model Context Protocol (MCP) Integration.

Enables external LLM clients (Claude Desktop, Cursor, ChatGPT, Gemini, Antigravity)
to interact with PortfolioWatcher accounts, stock quotes, technical indicators,
and research documents.
"""

def create_mcp_server():
    from portfolio.mcp.server import create_mcp_server as _create_server

    return _create_server()


__all__ = ["create_mcp_server"]

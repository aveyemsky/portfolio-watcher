"""Unit tests for PortfolioWatcher MCP Server."""

import json
import pytest

from portfolio.mcp.server import create_mcp_server


@pytest.fixture
def mcp_server():
    return create_mcp_server()


@pytest.mark.anyio
async def test_server_registration(mcp_server):
    tools = await mcp_server.list_tools()
    tool_names = [t.name for t in tools]

    # Baseline portfolio & stock tools
    assert "list_accounts" in tool_names
    assert "list_account_categories" in tool_names
    assert "get_account_holdings" in tool_names
    assert "get_portfolio_summary" in tool_names
    assert "get_holdings" in tool_names
    assert "create_account" in tool_names
    assert "add_holding" in tool_names
    assert "list_stocks" in tool_names
    assert "get_stock_quote" in tool_names
    assert "get_stock_history" in tool_names
    assert "sync_stock_data" in tool_names
    assert "get_technical_indicators" in tool_names
    assert "get_stock_documents" in tool_names
    assert "save_stock_note" in tool_names
    assert "add_stock_note" in tool_names
    assert "delete_stock_note" in tool_names
    assert "get_stock_notes" in tool_names

    # Modernized analytical & catalyst tools
    assert "get_market_sentiment" in tool_names
    assert "get_asset_profile" in tool_names
    assert "simulate_strategy" in tool_names
    assert "get_stock_catalysts" in tool_names
    assert "get_macro_catalysts" in tool_names

    # Resources
    resources = await mcp_server.list_resources()
    resource_uris = [r.uri for r in resources]
    assert "portfolio://accounts" in resource_uris
    assert "portfolio://macro/sentiment" in resource_uris

    # Prompts
    prompts = await mcp_server.list_prompts()
    prompt_names = [p.name for p in prompts]
    assert "analyze_stock" in prompt_names
    assert "portfolio_health_check" in prompt_names
    assert "macro_market_briefing" in prompt_names
    assert "technical_indicator_audit" in prompt_names


@pytest.mark.anyio
async def test_list_accounts_and_categories_tool(mcp_server):
    res = await mcp_server.call_tool("list_accounts", {})
    assert not res.is_error
    assert len(res.content) > 0

    cat_res = await mcp_server.call_tool("list_account_categories", {})
    assert not cat_res.is_error
    cat_data = json.loads(cat_res.content[0].text)
    assert "categories" in cat_data
    assert isinstance(cat_data["categories"], list)


@pytest.mark.anyio
async def test_get_account_holdings_tool(mcp_server):
    res_err = await mcp_server.call_tool("get_account_holdings", {"account_id": 999999})
    assert not res_err.is_error
    data_err = json.loads(res_err.content[0].text)
    assert "error" in data_err

    accounts_res = await mcp_server.call_tool("list_accounts", {})
    if accounts_res.content:
        accounts = json.loads(accounts_res.content[0].text)
        if accounts and isinstance(accounts, list) and len(accounts) > 0:
            acc_id = accounts[0].get("id")
            if acc_id:
                res = await mcp_server.call_tool("get_account_holdings", {"account_id": acc_id})
                assert not res.is_error
                data = json.loads(res.content[0].text)
                assert "account" in data
                assert "summary" in data
                assert "holdings" in data

    # Test get_portfolio_summary across accounts
    summary_res = await mcp_server.call_tool("get_portfolio_summary", {})
    assert not summary_res.is_error
    summary_data = json.loads(summary_res.content[0].text)
    assert "total_market_value" in summary_data
    assert "accounts" in summary_data

    # Test get_holdings across accounts
    holdings_res = await mcp_server.call_tool("get_holdings", {})
    assert not holdings_res.is_error
    holdings_data = json.loads(holdings_res.content[0].text)
    assert "holdings" in holdings_data
    assert "count" in holdings_data


@pytest.mark.anyio
async def test_create_account_tool(mcp_server):
    res = await mcp_server.call_tool(
        "create_account", {"name": "MCP Test Portfolio", "account_type": "taxable"}
    )
    assert not res.is_error
    data = json.loads(res.content[0].text)
    assert data["name"] == "MCP Test Portfolio"
    assert data["type"] == "taxable"
    assert "id" in data

    # Clean up test account after verification
    acc_id = data.get("id")
    if acc_id:
        from portfolio.services import account_service
        from portfolio.mcp.server import with_app_context
        with_app_context(lambda: account_service.delete_account(acc_id))()


@pytest.mark.anyio
async def test_market_sentiment_tool(mcp_server):
    res = await mcp_server.call_tool("get_market_sentiment", {})
    assert not res.is_error
    data = json.loads(res.content[0].text)
    assert "benchmarks" in data
    assert "vix_gauge" in data
    assert "skew_index" in data


@pytest.mark.anyio
async def test_macro_catalysts_tool(mcp_server):
    res = await mcp_server.call_tool("get_macro_catalysts", {"limit": 5})
    assert not res.is_error
    data = json.loads(res.content[0].text)
    assert "catalysts" in data
    assert "count" in data


@pytest.mark.anyio
async def test_get_technical_indicators_and_dna(mcp_server):
    stocks_res = await mcp_server.call_tool("list_stocks", {})
    if stocks_res.content:
        stocks = json.loads(stocks_res.content[0].text)
        if stocks and isinstance(stocks, list) and len(stocks) > 0:
            sym = stocks[0].get("symbol")
            if sym:
                # Indicators
                ind_res = await mcp_server.call_tool("get_technical_indicators", {"symbol": sym})
                assert not ind_res.is_error
                ind_data = json.loads(ind_res.content[0].text)
                assert ind_data["symbol"] == sym
                assert "indicators" in ind_data

                # Asset DNA Profile
                dna_res = await mcp_server.call_tool("get_asset_profile", {"symbol": sym, "lookback_days": 365})
                assert not dna_res.is_error
                dna_data = json.loads(dna_res.content[0].text)
                assert "error" not in dna_data
                assert "profile_type" in dna_data or "symbol" in dna_data

                # Strategy Simulation
                sim_res = await mcp_server.call_tool(
                    "simulate_strategy",
                    {"symbol": sym, "strategy_ids": ["supertrend"], "lookback_days": 365},
                )
                assert not sim_res.is_error
                sim_data = json.loads(sim_res.content[0].text)
                assert "error" not in sim_data
                assert "metrics" in sim_data
                assert "equity_curve" in sim_data


@pytest.mark.anyio
async def test_stock_notes_tool(mcp_server):
    stocks_res = await mcp_server.call_tool("list_stocks", {})
    if stocks_res.content:
        stocks = json.loads(stocks_res.content[0].text)
        if stocks and isinstance(stocks, list) and len(stocks) > 0:
            sym = stocks[0].get("symbol")
            if sym:
                # 1. Create a new note
                save_res = await mcp_server.call_tool(
                    "save_stock_note",
                    {
                        "symbol": sym,
                        "title": "MCP Test Thesis",
                        "content": "Initial thesis content",
                    },
                )
                assert not save_res.is_error
                save_data = json.loads(save_res.content[0].text)
                assert save_data["success"] is True
                note_id = save_data["note"]["metadata"]["note_id"]

                # 2. Test same-day upsert (calling with same title updates existing note)
                upsert_res = await mcp_server.call_tool(
                    "save_stock_note",
                    {
                        "symbol": sym,
                        "title": "MCP Test Thesis",
                        "content": "Updated same-day content",
                    },
                )
                assert not upsert_res.is_error
                upsert_data = json.loads(upsert_res.content[0].text)
                assert upsert_data["success"] is True
                assert upsert_data["note"]["metadata"]["note_id"] == note_id

                # 3. Test explicit edit by note_id
                edit_res = await mcp_server.call_tool(
                    "save_stock_note",
                    {
                        "symbol": sym,
                        "title": "MCP Revised Thesis",
                        "content": "Directly edited content via note_id",
                        "note_id": note_id,
                    },
                )
                assert not edit_res.is_error
                edit_data = json.loads(edit_res.content[0].text)
                assert edit_data["success"] is True
                assert edit_data["note"]["metadata"]["note_id"] == note_id

                # 4. Verify get_stock_notes contains the updated note
                get_res = await mcp_server.call_tool("get_stock_notes", {"symbol": sym})
                assert not get_res.is_error
                get_data = json.loads(get_res.content[0].text)
                matching = [n for n in get_data.get("notes", []) if n.get("metadata", {}).get("note_id") == note_id]
                assert len(matching) == 1
                assert matching[0]["body"] == "Directly edited content via note_id"

                # 5. Delete note via delete_stock_note
                del_res = await mcp_server.call_tool(
                    "delete_stock_note",
                    {
                        "symbol": sym,
                        "note_id": note_id,
                    },
                )
                assert not del_res.is_error
                del_data = json.loads(del_res.content[0].text)
                assert del_data["success"] is True

                # 6. Test add_stock_note alias
                add_res = await mcp_server.call_tool(
                    "add_stock_note",
                    {
                        "symbol": sym,
                        "title": "MCP Add Alias Thesis",
                        "content": "Content created via add_stock_note alias",
                    },
                )
                assert not add_res.is_error
                add_data = json.loads(add_res.content[0].text)
                assert add_data["success"] is True
                alias_id = add_data["note"]["metadata"]["note_id"]
                await mcp_server.call_tool("delete_stock_note", {"symbol": sym, "note_id": alias_id})

                # 6. Verify note is gone
                get_after_del = await mcp_server.call_tool("get_stock_notes", {"symbol": sym})
                after_data = json.loads(get_after_del.content[0].text)
                assert not any(n.get("metadata", {}).get("note_id") == note_id for n in after_data.get("notes", []))


@pytest.mark.anyio
async def test_mcp_resources(mcp_server):
    # Accounts resource
    contents = await mcp_server.read_resource("portfolio://accounts")
    assert len(contents) > 0
    assert "# PortfolioWatcher" in contents[0].content

    # Sentiment resource
    sent_contents = await mcp_server.read_resource("portfolio://macro/sentiment")
    assert len(sent_contents) > 0
    assert "# PortfolioWatcher Macro" in sent_contents[0].content


@pytest.mark.anyio
async def test_mcp_prompts(mcp_server):
    prompt = await mcp_server.get_prompt("analyze_stock", {"symbol": "AAPL"})
    assert len(prompt.messages) > 0
    assert "AAPL" in prompt.messages[0].content.text

    macro_prompt = await mcp_server.get_prompt("macro_market_briefing", {})
    assert len(macro_prompt.messages) > 0

    indicator_prompt = await mcp_server.get_prompt("technical_indicator_audit", {"symbol": "NVDA"})
    assert len(indicator_prompt.messages) > 0
    assert "NVDA" in indicator_prompt.messages[0].content.text

# PortfolioWatcher Agent Skills

This directory provides ready-to-use **Agent Skills** (`SKILL.md`) that teach AI coding assistants and autonomous agents (Antigravity, Cursor, Claude Desktop, ChatGPT) how to interact with PortfolioWatcher via the **Model Context Protocol (MCP)**.

---

## Why Use Skills?

While the PortfolioWatcher MCP server exposes raw tools (such as `get_portfolio_summary`, `get_asset_profile`, or `get_market_sentiment`), an AI assistant doesn't inherently know how an institutional investor structures a morning briefing or evaluates technical risk.

Skills provide **expert playbooks**. With a skill installed, simple requests like *"Give me my morning briefing"* or *"Analyze NVDA"* trigger structured, multi-step financial workflows automatically.

---

## Included Skills

| Skill | Purpose | Key MCP Tools |
| :--- | :--- | :--- |
| [`portfolio-morning-briefing`](./portfolio-morning-briefing/SKILL.md) | Delivers a morning market regime check (VIX, Fear & Greed) and audits portfolio vulnerability/concentration. | `get_market_sentiment`, `get_macro_catalysts`, `get_portfolio_summary`, `get_holdings` |
| [`stock-dna-advisor`](./stock-dna-advisor/SKILL.md) | Synthesizes fundamental Asset DNA (theses, price targets), Polymarket prediction catalysts, and technical indicators. | `get_asset_profile`, `get_stock_catalysts`, `get_technical_indicators`, `add_stock_note` |

---

## How to Install

### Antigravity / Gemini CLI
Copy any skill folder into your Antigravity skills directory:
```bash
# Workspace level
mkdir -p .gemini/skills
cp -r examples/skills/portfolio-morning-briefing .gemini/skills/

# Or global level
cp -r examples/skills/* ~/.gemini/antigravity/builtin/skills/
```

### Claude Desktop / Cursor / Other Agents
You can paste the contents of `SKILL.md` directly into:
- **Claude Project Instructions** or Custom Instructions.
- **Cursor Rules** (`.cursorrules` or `.cursor/rules/`).
- **ChatGPT Custom GPT** instructions.

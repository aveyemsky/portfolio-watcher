/**
 * PortfolioWatcher WebMCP (Web Model Context Protocol) Extensible Engine.
 *
 * Exposes core in-browser tools on document.modelContext when loaded by AI agents,
 * and allows external hosts (like Foliowatcher) to inject extended domain tools.
 */

export function getCoreWebMcpTools(apiBaseUrl = "") {
  const base = apiBaseUrl.replace(/\/+$/, "");

  return [
    {
      name: "get_stock_quote",
      description: "Get real-time quote, price, and changes for a ticker symbol.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Stock ticker symbol (e.g. NVDA, AAPL)" }
        },
        required: ["symbol"]
      },
      execute: async ({ symbol }) => {
        const res = await fetch(`${base}/api/portfolio/stocks/${encodeURIComponent(symbol)}`, { credentials: "include" });
        return await res.json();
      }
    },
    {
      name: "list_accounts",
      description: "List all portfolio accounts in PortfolioWatcher.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const res = await fetch(`${base}/api/portfolio/accounts`, { credentials: "include" });
        return await res.json();
      }
    },
    {
      name: "get_account_holdings",
      description: "Get stock holdings for an account ID.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "integer", description: "Account ID" }
        },
        required: ["account_id"]
      },
      execute: async ({ account_id }) => {
        const res = await fetch(`${base}/api/portfolio/accounts/${account_id}/holdings`, { credentials: "include" });
        return await res.json();
      }
    },
    {
      name: "get_stock_notes",
      description: "Retrieve research notes for a stock symbol.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Stock ticker symbol" }
        },
        required: ["symbol"]
      },
      execute: async ({ symbol }) => {
        const res = await fetch(`${base}/api/portfolio/stocks/${encodeURIComponent(symbol)}/notes`, { credentials: "include" });
        return await res.json();
      }
    },
    {
      name: "save_stock_note",
      description: "Create or update research note for a stock symbol.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Stock ticker symbol" },
          title: { type: "string", description: "Note title" },
          content: { type: "string", description: "Note text or markdown" },
          note_id: { type: "integer", description: "Optional note ID to edit" }
        },
        required: ["symbol", "title", "content"]
      },
      execute: async ({ symbol, title, content, note_id }) => {
        const url = note_id
          ? `${base}/api/portfolio/stocks/${encodeURIComponent(symbol)}/notes/${note_id}`
          : `${base}/api/portfolio/stocks/${encodeURIComponent(symbol)}/notes`;
        const method = note_id ? "PUT" : "POST";
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title, content })
        });
        return await res.json();
      }
    },
    {
      name: "delete_stock_note",
      description: "Delete a stock note by ID.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Stock ticker symbol" },
          note_id: { type: "integer", description: "Note ID to delete" }
        },
        required: ["symbol", "note_id"]
      },
      execute: async ({ symbol, note_id }) => {
        const res = await fetch(`${base}/api/portfolio/stocks/${encodeURIComponent(symbol)}/notes/${note_id}`, {
          method: "DELETE",
          credentials: "include"
        });
        return await res.json();
      }
    }
  ];
}

/**
 * Register core + extended tools with WebMCP (document.modelContext or fallback polyfill).
 *
 * @param {Object} options
 * @param {Array} [options.extraTools] - Host-injected proprietary or extended tools
 * @param {string} [options.apiBaseUrl] - Base API URL prefix
 * @returns {Array} List of all registered tools
 */
export function registerWebMcpTools({ extraTools = [], apiBaseUrl = "" } = {}) {
  if (typeof window === "undefined") return [];

  const coreTools = getCoreWebMcpTools(apiBaseUrl);
  const allTools = [...coreTools, ...(extraTools || [])];

  // Expose on global window object for inspecting agents and polyfills
  window.__WEBMCP_TOOLS__ = allTools;

  const modelContext = document?.modelContext || window?.modelContext || navigator?.modelContext;
  if (modelContext && typeof modelContext.registerTool === "function") {
    for (const tool of allTools) {
      try {
        modelContext.registerTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: tool.execute
        });
      } catch (err) {
        console.warn(`[WebMCP] Failed to register tool ${tool.name}:`, err);
      }
    }
  }

  return allTools;
}

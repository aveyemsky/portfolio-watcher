import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCoreWebMcpTools, registerWebMcpTools } from "../portfolioWatcher/core/webMcp";

describe("WebMCP (Web Model Context Protocol) Extensible Engine", () => {
  beforeEach(() => {
    delete window.__WEBMCP_TOOLS__;
    delete document.modelContext;
    delete window.modelContext;
  });

  it("getCoreWebMcpTools returns all expected core portfolio tools", () => {
    const tools = getCoreWebMcpTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("get_stock_quote");
    expect(toolNames).toContain("list_accounts");
    expect(toolNames).toContain("get_account_holdings");
    expect(toolNames).toContain("get_stock_notes");
    expect(toolNames).toContain("save_stock_note");
    expect(toolNames).toContain("delete_stock_note");
  });

  it("registerWebMcpTools populates window.__WEBMCP_TOOLS__ and supports extraTools extension", () => {
    const customTool = {
      name: "custom_quant_scanner",
      description: "Proprietary quant scanner injected by host",
      inputSchema: { type: "object", properties: {} },
      execute: vi.fn(),
    };

    const registered = registerWebMcpTools({ extraTools: [customTool] });
    const registeredNames = registered.map((t) => t.name);

    expect(registeredNames).toContain("get_stock_quote");
    expect(registeredNames).toContain("custom_quant_scanner");
    expect(window.__WEBMCP_TOOLS__).toBeDefined();
    expect(window.__WEBMCP_TOOLS__.some((t) => t.name === "custom_quant_scanner")).toBe(true);
  });

  it("invokes document.modelContext.registerTool when available in the browser", () => {
    const registerToolMock = vi.fn();
    document.modelContext = {
      registerTool: registerToolMock,
    };

    const customTool = {
      name: "fowa_analysis",
      description: "Alpha analysis",
      inputSchema: { type: "object", properties: {} },
      execute: vi.fn(),
    };

    registerWebMcpTools({ extraTools: [customTool] });

    expect(registerToolMock).toHaveBeenCalled();
    const registeredToolNames = registerToolMock.mock.calls.map((c) => c[0].name);
    expect(registeredToolNames).toContain("get_stock_quote");
    expect(registeredToolNames).toContain("fowa_analysis");
  });
});

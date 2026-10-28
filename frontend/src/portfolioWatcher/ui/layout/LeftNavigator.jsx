import { LEFT_TABS } from "../../state/portfolioStore";
import {
  addHoldingToAccount,
  addPortfolioSection,
  addStock,
  createAccount,
  createCategory,
  deleteAccount,
  deleteCategory,
  deleteHoldingFromAccount,
  deletePortfolioSection,
  deleteStock,
  fetchBootstrap,
  reorderPortfolioItems,
  syncAllStocks,
  updateAccount,
  updateCategory,
  updateHolding
} from "../../api/portfolioApi";
import { normalizeError } from "../../core/errors";
import { logger } from "../../core/logger";
import { useEffect, useMemo, useRef, useState } from "react";
import AccountEditor from "../account/AccountEditor";
import CategoryAccordion from "../account/CategoryAccordion";
import SelectedAccountStrip from "../account/SelectedAccountStrip";
import StockList from "../stock/StockList";
import StockGridView from "../stock/StockGridView";
import ModalDialog, { ConfirmDialog } from "../shared/ModalDialog";
import SegmentedControl from "./SegmentedControl";
import { getActiveAccount, getCategoryKey } from "../viewModel";

export default function LeftNavigator({
  apiBaseUrl,
  readOnly = false,
  allowManualSync = true,
  data,
  state,
  dispatch,
  onStockAdded,
  onStockDeleted,
  onBootstrapRefreshed,
  onAccountCreated,
  onAccountUpdated,
  onAccountDeleted,
  onCategoryCreated,
  onCategoryUpdated,
  onCategoryDeleted,
  onSectionAdded,
  onSectionDeleted,
  onItemsReordered,
  onHoldingAdded,
  onHoldingDeleted,
  onAddHoldingStock
}) {
  const [newSymbol, setNewSymbol] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [retryState, setRetryState] = useState(null);
  const retryTimerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const syncAbortControllerRef = useRef(null);
  const [isAccountSubmitting, setIsAccountSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [accountError, setAccountError] = useState("");
  const [holdingError, setHoldingError] = useState("");
  const [holdingWarning, setHoldingWarning] = useState("");
  const [isEditingAccount, setIsEditingAccount] = useState(false);

  // Category and Section state
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState(null);
  const [renameCategoryName, setRenameCategoryName] = useState("");
  const [deletingCategory, setDeletingCategory] = useState(null);
  const [deletingAccount, setDeletingAccount] = useState(null);
  const [deletingStockSymbol, setDeletingStockSymbol] = useState(null);
  const [addingPortfolioCategoryId, setAddingPortfolioCategoryId] = useState(null);
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [sectionLabelInput, setSectionLabelInput] = useState("");

  const activeAccount = getActiveAccount(data, state);
  const holdings = data?.holdingsByAccount?.[String(state?.activeAccountId)] || [];
  const activeCategory = (data?.categories || []).find((c) => c.id === (activeAccount?.categoryId || activeAccount?.category_id));
  const isBrokerage = getCategoryKey(activeCategory, activeAccount) === "accounts";
  const currentSizingMode = activeAccount?.sizing_mode || activeAccount?.sizingMode || "PERCENT";

  const selectedHolding = useMemo(() => {
    if (state?.selectedType !== "stock" || !state?.selectedStockSymbol) return null;
    return holdings.find((h) => !h.isSectionHeader && h.symbol === state.selectedStockSymbol) || null;
  }, [holdings, state?.selectedType, state?.selectedStockSymbol]);

  const [holdingForm, setHoldingForm] = useState(() => {
    if (selectedHolding) {
      const weightVal = selectedHolding.weight_pct ?? selectedHolding.weightPct;
      return {
        symbol: selectedHolding.symbol || "",
        shares: selectedHolding.shares != null ? String(selectedHolding.shares) : "",
        avgCost: selectedHolding.avgCost != null ? String(selectedHolding.avgCost) : "",
        weightPct: weightVal != null ? String(weightVal) : ""
      };
    }
    return { symbol: "", shares: "", avgCost: "", weightPct: "" };
  });

  const isExistingHolding = useMemo(() => {
    const sym = holdingForm.symbol.trim().toUpperCase();
    if (!sym) return false;
    return holdings.some((h) => !h.isSectionHeader && h.symbol === sym);
  }, [holdingForm.symbol, holdings]);

  const lastSelectedSymbolRef = useRef(selectedHolding?.symbol || null);
  const lastAccountIdRef = useRef(state?.activeAccountId);

  useEffect(() => {
    if (state?.activeAccountId !== lastAccountIdRef.current) {
      lastAccountIdRef.current = state?.activeAccountId;
      lastSelectedSymbolRef.current = null;
      setHoldingForm({ symbol: "", shares: "", avgCost: "", weightPct: "" });
      setHoldingError("");
      setHoldingWarning("");
    }
  }, [state?.activeAccountId]);

  useEffect(() => {
    if (selectedHolding) {
      if (lastSelectedSymbolRef.current !== selectedHolding.symbol) {
        lastSelectedSymbolRef.current = selectedHolding.symbol;
        const weightVal = selectedHolding.weight_pct ?? selectedHolding.weightPct;
        setHoldingForm({
          symbol: selectedHolding.symbol || "",
          shares: selectedHolding.shares != null ? String(selectedHolding.shares) : "",
          avgCost: selectedHolding.avgCost != null ? String(selectedHolding.avgCost) : "",
          weightPct: weightVal != null ? String(weightVal) : ""
        });
        setHoldingError("");
        setHoldingWarning("");
      }
    } else {
      if (lastSelectedSymbolRef.current !== null) {
        lastSelectedSymbolRef.current = null;
        setHoldingForm({ symbol: "", shares: "", avgCost: "", weightPct: "" });
      }
    }
  }, [selectedHolding]);

  const allStocks = useMemo(() => {
    return [...(data?.stocks || [])].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [data?.stocks]);

  const distinctCount = useMemo(() => {
    if (data?.masterStocksSummary?.totalDistinct !== undefined) {
      return data.masterStocksSummary.totalDistinct;
    }
    const symbolSet = new Set((data?.stocks || []).map((s) => s.symbol));
    Object.values(data?.holdingsByAccount || {}).forEach((hList) => {
      (hList || []).forEach((h) => {
        if (!h.isSectionHeader && h.symbol) symbolSet.add(h.symbol);
      });
    });
    return symbolSet.size;
  }, [data?.masterStocksSummary, data?.stocks, data?.holdingsByAccount]);

  const holdingStocks = useMemo(() => {
    return holdings
      .map((holding) => {
        if (holding.isSectionHeader) {
          return {
            id: holding.id,
            holdingId: holding.id,
            isSectionHeader: true,
            sectionLabel: holding.sectionLabel || "Section",
            sortOrder: holding.sortOrder ?? 0
          };
        }
        const stock = data?.stocks?.find((s) => s.symbol === holding.symbol);
        return {
          ...(stock || { symbol: holding.symbol, name: holding.symbol }),
          id: holding.id,
          holdingId: holding.id,
          shares: holding.shares,
          avgCost: holding.avgCost,
          weight_pct: holding.weight_pct ?? holding.weightPct,
          effective_weight_pct: holding.effective_weight_pct ?? holding.effectiveWeightPct,
          sortOrder: holding.sortOrder ?? 0
        };
      })
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [holdings, data?.stocks]);

  const isManageMode = state.navigatorMode === "manage";
  const isGridView = state.viewMode === "grid";

  useEffect(() => {
    if (!isManageMode) {
      setIsEditingAccount(false);
      setAddingPortfolioCategoryId(null);
      setIsAddingSection(false);
      setIsAddingCategory(false);
      setHoldingForm({ symbol: "", shares: "", avgCost: "", weightPct: "" });
      lastSelectedSymbolRef.current = null;
    }
  }, [isManageMode]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearInterval(retryTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (syncAbortControllerRef.current) syncAbortControllerRef.current.abort();
    };
  }, []);

  const MAX_RETRY_ATTEMPTS = 4;
  const RETRY_DELAYS = [3, 4, 6];

  function cancelAddStockRetry() {
    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setRetryState(null);
    setIsSubmitting(false);
  }

  async function executeAddStock(symbol, attempt = 1) {
    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    setIsSubmitting(true);
    setInlineError("");

    abortControllerRef.current = new AbortController();

    try {
      const payload = await addStock(apiBaseUrl, symbol, {
        signal: abortControllerRef.current.signal
      });
      onStockAdded(payload);
      setNewSymbol("");
      setSyncStatus("");
      setRetryState(null);
      setIsSubmitting(false);
    } catch (error) {
      if (abortControllerRef.current?.signal?.aborted) {
        setIsSubmitting(false);
        return;
      }
      const normalized = normalizeError(error);
      logger.error("Add stock failed", normalized);

      const isRetryable =
        normalized.status === 429 ||
        normalized.status === 504 ||
        normalized.status === 502 ||
        normalized.code === "upstream_rate_limited" ||
        normalized.code === "upstream_timeout" ||
        normalized.code === "network_error" ||
        (normalized.message && (
          normalized.message.toLowerCase().includes("rate-limiting") ||
          normalized.message.toLowerCase().includes("timed out") ||
          normalized.message.toLowerCase().includes("timeout") ||
          normalized.message.toLowerCase().includes("unable to fetch stock data")
        ));

      if (isRetryable && attempt < MAX_RETRY_ATTEMPTS) {
        const delaySeconds = RETRY_DELAYS[attempt - 1] || 4;
        let countdown = delaySeconds;

        setRetryState({
          symbol,
          attempt: attempt + 1,
          maxAttempts: MAX_RETRY_ATTEMPTS,
          secondsLeft: countdown,
          errorMsg: normalized.message
        });

        retryTimerRef.current = setInterval(() => {
          countdown -= 1;
          if (countdown <= 0) {
            clearInterval(retryTimerRef.current);
            retryTimerRef.current = null;
            executeAddStock(symbol, attempt + 1);
          } else {
            setRetryState((curr) => curr ? { ...curr, secondsLeft: countdown } : null);
          }
        }, 1000);
      } else {
        setRetryState(null);
        setIsSubmitting(false);
        setInlineError(normalized.message || `Unable to add ${symbol}. Please check the symbol and try again.`);
      }
    }
  }

  function handleAddStock(event) {
    if (event) event.preventDefault();
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;
    executeAddStock(symbol, 1);
  }

  function handleRetryNow() {
    if (!retryState) return;
    const { symbol, attempt } = retryState;
    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    executeAddStock(symbol, attempt);
  }

  async function handleSyncAllStocks() {
    if (syncAbortControllerRef.current) {
      syncAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    syncAbortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    setIsSyncing(true);
    setInlineError("");
    setSyncStatus("");
    try {
      const payload = await syncAllStocks(apiBaseUrl, { signal: controller.signal });
      const refreshed = await fetchBootstrap(apiBaseUrl);
      onBootstrapRefreshed(refreshed);
      const syncedStocks = (payload.synced || []).filter((s) => !String(s).startsWith("^"));
      const syncedCount = syncedStocks.length;
      const failedCount = (payload.failed || []).filter((f) => !String(f?.symbol || f).startsWith("^")).length;
      if (payload.circuit_broken) {
        setSyncStatus(`Synced ${syncedCount} stocks (sync paused due to upstream rate limiting)`);
      } else if (payload.timed_out) {
        setSyncStatus(`Synced ${syncedCount} stocks (time limit reached, remaining queued)`);
      } else {
        setSyncStatus(
          failedCount
            ? `Synced ${syncedCount}, failed ${failedCount}`
            : `Synced ${syncedCount} stock${syncedCount === 1 ? "" : "s"}`
        );
      }
    } catch (error) {
      if (error?.name === "AbortError" || error?.details?.name === "AbortError" || syncAbortControllerRef.current?.signal?.aborted) {
        setInlineError("Sync request timed out after 35s. Refreshing current data...");
        try {
          const refreshed = await fetchBootstrap(apiBaseUrl);
          onBootstrapRefreshed(refreshed);
        } catch (_) {}
      } else {
        const normalized = normalizeError(error);
        logger.error("Sync all stocks failed", normalized);
        setInlineError(normalized.message || "Tracked stocks could not be synced.");
      }
    } finally {
      clearTimeout(timeoutId);
      setIsSyncing(false);
      syncAbortControllerRef.current = null;
    }
  }

  function handlePromptDeleteStock(symbol) {
    if (!symbol) return;
    setDeletingStockSymbol(symbol);
  }

  async function handleConfirmDeleteStock() {
    if (!deletingStockSymbol) return;
    const symbol = deletingStockSymbol;

    setIsSubmitting(true);
    setInlineError("");
    try {
      await deleteStock(apiBaseUrl, symbol);
      onStockDeleted(symbol);
      setDeletingStockSymbol(null);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Delete stock failed", normalized);
      setInlineError(normalized.message || `${symbol} could not be deleted.`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateAccount(payload) {
    setIsAccountSubmitting(true);
    setAccountError("");
    try {
      const account = await createAccount(apiBaseUrl, payload);
      onAccountCreated(account);
      setAddingPortfolioCategoryId(null);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Create account failed", normalized);
      setAccountError(normalized.message || "Portfolio could not be created.");
    } finally {
      setIsAccountSubmitting(false);
    }
  }

  async function handleUpdateAccount(payload) {
    if (!activeAccount) return;
    setIsAccountSubmitting(true);
    setAccountError("");
    try {
      const account = await updateAccount(apiBaseUrl, activeAccount.id, payload);
      onAccountUpdated(account);
      setIsEditingAccount(false);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Update account failed", normalized);
      setAccountError(normalized.message || "Portfolio could not be updated.");
    } finally {
      setIsAccountSubmitting(false);
    }
  }

  function handlePromptDeleteAccount(account = activeAccount) {
    if (!account) return;
    setDeletingAccount(account);
  }

  async function handleConfirmDeleteAccount() {
    if (!deletingAccount) return;
    const account = deletingAccount;

    setIsAccountSubmitting(true);
    setAccountError("");
    try {
      await deleteAccount(apiBaseUrl, account.id);
      onAccountDeleted(account.id);
      setIsEditingAccount(false);
      setDeletingAccount(null);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Delete account failed", normalized);
      setAccountError(
        normalized.code === "account_in_use"
          ? "Cannot delete this portfolio because it has holdings."
          : normalized.message || "Portfolio could not be deleted."
      );
    } finally {
      setIsAccountSubmitting(false);
    }
  }

  function handleClearHoldingSelection() {
    lastSelectedSymbolRef.current = null;
    setHoldingForm({ symbol: "", shares: "", avgCost: "", weightPct: "" });
    setHoldingError("");
    setHoldingWarning("");
    if (state?.selectedType === "stock") {
      dispatch({ type: "selectStock", symbol: null });
    }
  }

  async function handleAddHolding(event) {
    if (event) event.preventDefault();
    if (!activeAccount) return;

    setIsAccountSubmitting(true);
    setHoldingError("");
    setHoldingWarning("");
    try {
      const payload = await addHoldingToAccount(apiBaseUrl, activeAccount.id, {
        symbol: holdingForm.symbol,
        shares: isBrokerage && currentSizingMode === "SHARES" ? holdingForm.shares : undefined,
        avgCost: isBrokerage ? holdingForm.avgCost : undefined,
        weight_pct: isBrokerage && currentSizingMode === "PERCENT" ? holdingForm.weightPct : undefined
      });
      onHoldingAdded(payload);
      if (payload.warning) setHoldingWarning(payload.warning);
      setHoldingForm({ symbol: "", shares: "", avgCost: "", weightPct: "" });
      lastSelectedSymbolRef.current = null;
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Add holding failed", normalized);
      setHoldingError(normalized.message || "Holding could not be added.");
    } finally {
      setIsAccountSubmitting(false);
    }
  }

  async function handleSaveHolding(event) {
    if (event) event.preventDefault();
    if (!activeAccount) return;
    const sym = holdingForm.symbol.trim().toUpperCase();
    if (!sym) return;

    setIsAccountSubmitting(true);
    setHoldingError("");
    setHoldingWarning("");
    try {
      const payload = {
        shares: isBrokerage && currentSizingMode === "SHARES"
          ? (holdingForm.shares === "" ? null : Number(holdingForm.shares))
          : undefined,
        avg_cost: isBrokerage
          ? (holdingForm.avgCost === "" ? null : Number(holdingForm.avgCost))
          : undefined,
        weight_pct: isBrokerage && currentSizingMode === "PERCENT"
          ? (holdingForm.weightPct === "" ? null : Number(holdingForm.weightPct))
          : undefined
      };

      await updateHolding(apiBaseUrl, activeAccount.id, sym, payload);
      const refreshed = await fetchBootstrap(apiBaseUrl);
      onBootstrapRefreshed(refreshed);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Update holding failed", normalized);
      setHoldingError(normalized.message || "Holding could not be updated.");
    } finally {
      setIsAccountSubmitting(false);
    }
  }

  async function handleSubmitHoldingForm(event) {
    if (event) event.preventDefault();
    if (isExistingHolding) {
      await handleSaveHolding(event);
    } else {
      await handleAddHolding(event);
    }
  }

  async function handleUpdateHolding(accountId, symbol, payload) {
    try {
      await updateHolding(apiBaseUrl, accountId, symbol, payload);
      const refreshed = await fetchBootstrap(apiBaseUrl);
      onBootstrapRefreshed(refreshed);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Update holding failed", normalized);
      setHoldingError(normalized.message || "Holding could not be updated.");
    }
  }

  async function handleRemoveHolding(symbol) {
    if (!activeAccount) return;

    setIsAccountSubmitting(true);
    setHoldingError("");
    setHoldingWarning("");
    try {
      await deleteHoldingFromAccount(apiBaseUrl, activeAccount.id, symbol);
      onHoldingDeleted(activeAccount.id, symbol);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Remove holding failed", normalized);
      setHoldingError(normalized.message || `${symbol} could not be removed from this portfolio.`);
    } finally {
      setIsAccountSubmitting(false);
    }
  }

  // Section divider operations
  async function handleAddSectionSubmit(e) {
    if (e) e.preventDefault();
    if (!activeAccount || !sectionLabelInput.trim()) return;
    try {
      const currentHoldings = holdings || [];
      const sortOrder = currentHoldings.length;
      const created = await addPortfolioSection(
        apiBaseUrl,
        activeAccount.id,
        sectionLabelInput.trim(),
        sortOrder
      );
      onSectionAdded?.(activeAccount.id, created);
      setSectionLabelInput("");
      setIsAddingSection(false);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Add section divider failed", normalized);
      setHoldingError(normalized.message || "Could not add section divider.");
    }
  }

  async function handleRemoveSection(itemId) {
    if (!activeAccount) return;
    try {
      await deletePortfolioSection(apiBaseUrl, activeAccount.id, itemId);
      onSectionDeleted?.(activeAccount.id, itemId);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Remove section failed", normalized);
      setHoldingError(normalized.message || "Could not remove section divider.");
    }
  }

  async function handleReorderPortfolioItems(reorderedStocks) {
    if (!activeAccount) return;
    const itemsPayload = reorderedStocks.map((stock, idx) => ({
      id: stock.id || stock.holdingId,
      sort_order: idx
    }));
    try {
      // Optimistic update
      const updatedHoldings = reorderedStocks.map((stock, idx) => ({
        id: stock.id || stock.holdingId,
        portfolio_id: activeAccount.id,
        accountId: activeAccount.id,
        symbol: stock.symbol || null,
        shares: stock.shares || 0,
        avgCost: stock.avgCost || 0,
        isSectionHeader: Boolean(stock.isSectionHeader),
        sectionLabel: stock.sectionLabel || null,
        sortOrder: idx
      }));
      onItemsReordered?.(activeAccount.id, updatedHoldings);
      await reorderPortfolioItems(apiBaseUrl, activeAccount.id, itemsPayload);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Reorder portfolio items failed", normalized);
      setHoldingError(normalized.message || "Failed to save new order.");
    }
  }

  // Category CRUD operations
  async function handleSubmitNewCategory(e) {
    if (e) e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    setIsAccountSubmitting(true);
    setAccountError("");
    try {
      const nextSortOrder = (data?.categories?.length || 0);
      const cat = await createCategory(apiBaseUrl, { name, sortOrder: nextSortOrder });
      onCategoryCreated?.(cat);
      setNewCategoryName("");
      setIsAddingCategory(false);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Create category failed", normalized);
      setAccountError(normalized.message || "Category could not be created.");
    } finally {
      setIsAccountSubmitting(false);
    }
  }

  async function handleSubmitRenameCategory(e) {
    if (e) e.preventDefault();
    if (!editingCategory || !renameCategoryName.trim()) return;
    setIsAccountSubmitting(true);
    setAccountError("");
    try {
      const updated = await updateCategory(apiBaseUrl, editingCategory.id, {
        name: renameCategoryName.trim(),
        sortOrder: editingCategory.sortOrder
      });
      onCategoryUpdated?.(updated);
      setEditingCategory(null);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Rename category failed", normalized);
      setAccountError(normalized.message || "Category could not be renamed.");
    } finally {
      setIsAccountSubmitting(false);
    }
  }

  async function handleExecuteDeleteCategory(deletePortfolios = false) {
    if (!deletingCategory) return;
    setIsAccountSubmitting(true);
    setAccountError("");
    try {
      if (deletingCategory.id === "uncategorized") {
        for (const p of uncategorizedPortfolios) {
          await deleteAccount(apiBaseUrl, p.id);
          onAccountDeleted?.(p.id);
        }
        setDeletingCategory(null);
      } else {
        const res = await deleteCategory(apiBaseUrl, deletingCategory.id, deletePortfolios);
        onCategoryDeleted?.(deletingCategory.id, deletePortfolios);
        setDeletingCategory(null);
      }
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Delete category failed", normalized);
      setAccountError(normalized.message || "Category could not be deleted.");
    } finally {
      setIsAccountSubmitting(false);
    }
  }

  function handleOpenAddPortfolioToCategory(categoryId) {
    setAddingPortfolioCategoryId(categoryId);
  }

  function handleOpenRenameCategory(category) {
    setEditingCategory(category);
    setRenameCategoryName(category.name);
  }

  function handleOpenDeleteCategory(category) {
    setDeletingCategory(category);
  }

  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  function isInternalReorder(event) {
    const types = Array.from(event.dataTransfer?.types || []);
    return types.includes("application/x-pw-reorder");
  }

  function handleDragOver(event) {
    if (!isManageMode || isInternalReorder(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragEnter(event) {
    if (!isManageMode || isInternalReorder(event)) return;
    event.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }

  function handleDragLeave(event) {
    if (!isManageMode || isInternalReorder(event)) return;
    event.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }

  async function handleDrop(event) {
    if (!isManageMode || isInternalReorder(event)) return;
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const symbol = event.dataTransfer.getData("text/plain");
    if (!symbol || /^\d+$/.test(symbol.trim())) return;

    setIsAccountSubmitting(true);
    setHoldingError("");
    setHoldingWarning("");
    try {
      if (onAddHoldingStock) {
        await onAddHoldingStock(symbol);
      } else {
        const payload = await addHoldingToAccount(apiBaseUrl, activeAccount.id, {
          symbol: symbol.trim().toUpperCase(),
          shares: 0,
          avgCost: 0
        });
        onHoldingAdded(payload);
        if (payload.warning) setHoldingWarning(payload.warning);
      }
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Add holding from drag failed", normalized);
      setHoldingError(normalized.message || `Could not add ${symbol.toUpperCase()} to portfolio.`);
    } finally {
      setIsAccountSubmitting(false);
    }
  }

  // Partition portfolios by category
  const categories = useMemo(() => {
    return [...(data?.categories || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [data?.categories]);

  const categoryPortfoliosMap = useMemo(() => {
    const map = {};
    (categories || []).forEach((c) => {
      map[c.id] = [];
    });
    (data?.accounts || []).forEach((account) => {
      const catId = account.categoryId || account.category_id;
      if (catId && map[catId]) {
        map[catId].push(account);
      }
    });
    Object.keys(map).forEach((k) => {
      map[k].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    });
    return map;
  }, [categories, data?.accounts]);

  const uncategorizedPortfolios = useMemo(() => {
    const categoryIds = new Set((categories || []).map((c) => c.id));
    return (data?.accounts || []).filter((account) => {
      const catId = account.categoryId || account.category_id;
      return !catId || !categoryIds.has(catId);
    });
  }, [categories, data?.accounts]);

  const deletingCategoryChildCount = deletingCategory
    ? (deletingCategory.id === "uncategorized"
        ? uncategorizedPortfolios.length
        : (categoryPortfoliosMap[deletingCategory.id]?.length || 0))
    : 0;

  const leftOptions = useMemo(() => [
    { value: LEFT_TABS.all, label: distinctCount !== undefined ? `All (${distinctCount})` : "All" },
    { value: LEFT_TABS.accounts, label: "Portfolios" }
  ], [distinctCount]);

  return (
    <>
      <div className="pw-panel-head">
        <div className="pw-nav-title-row">
          <div className="pw-nav-title-group">
            <SegmentedControl
              ariaLabel="Navigator tabs"
              options={leftOptions}
              value={state.leftTab}
              onChange={(tab) => dispatch({ type: "setLeftTab", tab, firstStockSymbol: data.stocks[0]?.symbol })}
            />
            <button
              className={`pw-view-toggle ${isGridView ? "pw-active" : ""}`}
              type="button"
              aria-label={isGridView ? "Switch to list & chart view" : "Switch to grid view"}
              title={isGridView ? "Switch to list & chart view" : "Switch to grid view"}
              onClick={() => dispatch({ type: "toggleViewMode" })}
            >
              {isGridView ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
              )}
            </button>
            {isGridView && (
              <button
                className={`pw-view-toggle pw-group-toggle ${state.gridGroupBy === "sector" ? "pw-active" : ""}`}
                type="button"
                aria-label={state.gridGroupBy === "sector" ? "Disable sector grouping" : "Group by sector"}
                title={state.gridGroupBy === "sector" ? "View flat grid" : "Group stocks by sector"}
                onClick={() => dispatch({ type: "toggleGridGroupBy" })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="6" rx="1.5" />
                  <rect x="3" y="14" width="18" height="6" rx="1.5" />
                </svg>
              </button>
            )}
          </div>
          {!isGridView && !readOnly && (
            <button
              className={`pw-manage-toggle ${isManageMode ? "pw-active" : ""}`}
              type="button"
              aria-label={isManageMode ? "Exit manage mode" : "Enter manage mode"}
              onClick={() => dispatch({ type: "toggleNavigatorMode" })}
            >
              {isManageMode ? "−" : "+"}
            </button>
          )}
        </div>
      </div>

      {/* All Stocks View */}
      {state.leftTab === LEFT_TABS.all && (
        <div className="pw-search-box">
          <input
            type="search"
            placeholder="Search ticker, company, or sector"
            value={state.search}
            onChange={(event) => dispatch({ type: "setSearch", search: event.target.value })}
          />
        </div>
      )}

      {state.leftTab === LEFT_TABS.all && (isManageMode || inlineError || syncStatus || retryState) && (
        <div className="pw-stock-tools">
          {isManageMode && (
            <form className="pw-add-stock-form" onSubmit={handleAddStock}>
              <label htmlFor="pw-add-stock">Add stock</label>
              <div className="pw-add-stock-row">
                <input
                  id="pw-add-stock"
                  type="text"
                  value={newSymbol}
                  placeholder="AAPL"
                  disabled={Boolean(retryState) || isSubmitting || isSyncing}
                  onChange={(event) => setNewSymbol(event.target.value.toUpperCase())}
                />
                <button type="submit" disabled={Boolean(retryState) || isSubmitting || isSyncing || !newSymbol.trim()}>
                  {isSubmitting && !retryState ? "Adding..." : "Add"}
                </button>
              </div>
            </form>
          )}
          {retryState && (
            <div className="pw-retry-banner" role="alert">
              <div className="pw-retry-banner-msg">
                <span>⚠️ Yahoo Finance is busy/throttling.</span>
                <span>
                  Retrying {retryState.symbol} in <strong>{retryState.secondsLeft}s</strong>... (Attempt {retryState.attempt} of {retryState.maxAttempts})
                </span>
              </div>
              <div className="pw-retry-banner-actions">
                <button
                  type="button"
                  className="pw-retry-btn-now"
                  onClick={handleRetryNow}
                >
                  Retry Now
                </button>
                <button
                  type="button"
                  className="pw-retry-btn-cancel"
                  onClick={cancelAddStockRetry}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {!retryState && inlineError && <div className="pw-inline-error">{inlineError}</div>}
          {syncStatus && <div className="pw-inline-success">{syncStatus}</div>}
          {isManageMode && (
            <div className="pw-section-heading">
              <div className="pw-section-label pw-section-label--flush">Tracked Stocks</div>
              {allowManualSync && (
                <button
                  className={`pw-secondary-action ${isSyncing ? "pw-syncing" : ""}`}
                  type="button"
                  onClick={handleSyncAllStocks}
                  disabled={isSyncing || isSubmitting || !data.stocks.length}
                  aria-label={isSyncing ? "Syncing tracked stocks" : "Sync tracked stocks"}
                  title={isSyncing ? "Syncing tracked stocks..." : "Sync tracked stocks"}
                >
                  {isSyncing ? (
                    <>
                      <svg
                        className="pw-spin-icon"
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                      </svg>
                      <span>Syncing...</span>
                    </>
                  ) : (
                    "Sync"
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {state.leftTab === LEFT_TABS.all && (
        isGridView ? (
          <StockGridView
            data={data}
            stocks={allStocks}
            mode="all"
            state={state}
            dispatch={dispatch}
            manageMode={isManageMode}
            onDeleteStock={handlePromptDeleteStock}
          />
        ) : (
          <StockList
            data={data}
            stocks={allStocks}
            mode="all"
            state={state}
            dispatch={dispatch}
            manageMode={isManageMode}
            onDeleteStock={handlePromptDeleteStock}
          />
        )
      )}

      {/* Portfolios View: Category Grouping Accordions */}
      {state.leftTab === LEFT_TABS.accounts && !state.accountDrilldown && (
        <div className="pw-category-tree">
          {accountError && <div className="pw-inline-error">{accountError}</div>}

          {categories.map((category) => (
            <CategoryAccordion
              key={category.id}
              category={category}
              portfolios={categoryPortfoliosMap[category.id] || []}
              isCollapsed={Boolean(state.collapsedCategoryIds?.[category.id])}
              onToggleCollapse={(catId) => dispatch({ type: "toggleCategoryCollapse", categoryId: catId })}
              onSelectPortfolio={(portfolioId) => dispatch({ type: "selectPortfolio", accountId: portfolioId })}
              activePortfolioId={state.activeAccountId}
              isPortfolioActive={state.accountDrilldown}
              manageMode={isManageMode}
              onAddPortfolioToCategory={handleOpenAddPortfolioToCategory}
              onRenameCategory={handleOpenRenameCategory}
              onDeleteCategory={handleOpenDeleteCategory}
              onDeletePortfolio={handlePromptDeleteAccount}
              data={data}
            />
          ))}

          {uncategorizedPortfolios.length > 0 && (
            <CategoryAccordion
              category={{ id: "uncategorized", name: "Uncategorized" }}
              portfolios={uncategorizedPortfolios}
              isCollapsed={Boolean(state.collapsedCategoryIds?.["uncategorized"])}
              onToggleCollapse={(id) => dispatch({ type: "toggleCategoryCollapse", categoryId: id })}
              onSelectPortfolio={(portfolioId) => dispatch({ type: "selectPortfolio", accountId: portfolioId })}
              activePortfolioId={state.activeAccountId}
              isPortfolioActive={state.accountDrilldown}
              manageMode={isManageMode}
              onAddPortfolioToCategory={handleOpenAddPortfolioToCategory}
              onRenameCategory={null}
              onDeleteCategory={handleOpenDeleteCategory}
              onDeletePortfolio={handlePromptDeleteAccount}
              data={data}
            />
          )}

          {isManageMode && (
            isAddingCategory ? (
              <form className="pw-inline-editor" onSubmit={handleSubmitNewCategory}>
                <div className="pw-inline-editor-row">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Category name (e.g. Stage Setups)"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                  />
                  <button type="submit" className="pw-btn-primary" disabled={!newCategoryName.trim()}>
                    Add
                  </button>
                  <button type="button" className="pw-btn-secondary" onClick={() => setIsAddingCategory(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="pw-new-category-btn"
                onClick={() => setIsAddingCategory(true)}
              >
                + New Category
              </button>
            )
          )}
        </div>
      )}

      {/* Account/Portfolio Drilldown View */}
      {state.leftTab === LEFT_TABS.accounts && state.accountDrilldown && (
        <>
          <SelectedAccountStrip
            account={activeAccount}
            data={data}
            state={state}
            dispatch={dispatch}
            manageMode={isManageMode}
            onDeleteAccount={() => handlePromptDeleteAccount(activeAccount)}
          />

          <div className="pw-account-tools">
            <div className="pw-selected-stock-action">
              <span>Portfolio shell</span>
              {isManageMode && (
                <span className="pw-inline-actions">
                  <button type="button" onClick={() => setIsEditingAccount((current) => !current)}>
                    {isEditingAccount ? "Close" : "Edit"}
                  </button>
                </span>
              )}
            </div>
            {isManageMode && isEditingAccount && (
              <AccountEditor
                account={activeAccount}
                submitLabel="Save"
                onCancel={() => setIsEditingAccount(false)}
                onSubmit={handleUpdateAccount}
                isSubmitting={isAccountSubmitting}
              />
            )}
            {accountError && <div className="pw-inline-error">{accountError}</div>}
          </div>

          {isManageMode && (
            <div className="pw-account-tools">
              {(() => {
                const category = (data?.categories || []).find((c) => c.id === (activeAccount?.categoryId || activeAccount?.category_id));
                const isBrokerage = getCategoryKey(category, activeAccount) === "accounts";
                const currentSizingMode = activeAccount?.sizing_mode || activeAccount?.sizingMode || "PERCENT";

                return (
                  <>
                    {isBrokerage && (
                      <div className="pw-mode-switcher" style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                        <button
                          type="button"
                          className={`pw-btn-pill ${currentSizingMode === "PERCENT" ? "active" : ""}`}
                          style={{
                            flex: 1,
                            padding: "4px 8px",
                            fontSize: "12px",
                            borderRadius: "14px",
                            border: "1px solid var(--pw-line, #334155)",
                            background: currentSizingMode === "PERCENT" ? "var(--pw-accent, #3b82f6)" : "transparent",
                            color: currentSizingMode === "PERCENT" ? "#ffffff" : "var(--pw-muted, #94a3b8)",
                            cursor: "pointer"
                          }}
                          onClick={() => handleUpdateAccount({ sizing_mode: "PERCENT" })}
                        >
                          🔒 Privacy (% / Equal)
                        </button>
                        <button
                          type="button"
                          className={`pw-btn-pill ${currentSizingMode === "SHARES" ? "active" : ""}`}
                          style={{
                            flex: 1,
                            padding: "4px 8px",
                            fontSize: "12px",
                            borderRadius: "14px",
                            border: "1px solid var(--pw-line, #334155)",
                            background: currentSizingMode === "SHARES" ? "var(--pw-accent, #3b82f6)" : "transparent",
                            color: currentSizingMode === "SHARES" ? "#ffffff" : "var(--pw-muted, #94a3b8)",
                            cursor: "pointer"
                          }}
                          onClick={() => handleUpdateAccount({ sizing_mode: "SHARES" })}
                        >
                          💲 Exact Shares
                        </button>
                      </div>
                    )}
                    <form className="pw-holding-editor" onSubmit={handleSubmitHoldingForm}>
                      <div className="pw-section-heading" style={{ margin: 0, padding: 0 }}>
                        <div className="pw-section-label pw-section-label--flush">
                          {isExistingHolding ? `Edit holding: ${holdingForm.symbol}` : "Add holding"}
                        </div>
                        {isExistingHolding && (
                          <button
                            type="button"
                            onClick={handleClearHoldingSelection}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "var(--pw-blue, #2563eb)",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "600",
                              padding: "2px 4px"
                            }}
                          >
                            + Add new
                          </button>
                        )}
                      </div>
                      <div className="pw-holding-editor-grid">
                        <input
                          type="text"
                          value={holdingForm.symbol}
                          placeholder="Symbol"
                          readOnly={Boolean(selectedHolding)}
                          style={selectedHolding ? { opacity: 0.8, cursor: "not-allowed" } : undefined}
                          onChange={(event) => setHoldingForm((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))}
                        />
                        {isBrokerage && currentSizingMode === "PERCENT" && (
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="any"
                            value={holdingForm.weightPct}
                            placeholder="Weight %"
                            onChange={(event) => setHoldingForm((current) => ({ ...current, weightPct: event.target.value }))}
                          />
                        )}
                        {isBrokerage && currentSizingMode === "SHARES" && (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={holdingForm.shares}
                            placeholder="Shares"
                            onChange={(event) => setHoldingForm((current) => ({ ...current, shares: event.target.value }))}
                          />
                        )}
                        {isBrokerage && (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={holdingForm.avgCost}
                            placeholder="Avg Cost"
                            onChange={(event) => setHoldingForm((current) => ({ ...current, avgCost: event.target.value }))}
                          />
                        )}
                        <button
                          type="submit"
                          disabled={
                            isAccountSubmitting ||
                            !holdingForm.symbol.trim()
                          }
                        >
                          {isExistingHolding ? (isAccountSubmitting ? "Saving..." : "Save") : (isAccountSubmitting ? "Adding..." : "Add")}
                        </button>
                      </div>
                    </form>
                  </>
                );
              })()}
              {holdingError && <div className="pw-inline-error">{holdingError}</div>}
              {holdingWarning && <div className="pw-inline-warning">{holdingWarning}</div>}
            </div>
          )}

          {/* Holdings Toolbar with + Add Section Divider */}
          <div className="pw-section-heading" style={{ padding: "8px 12px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="pw-section-label pw-section-label--flush">Holdings</div>
            {isManageMode && (
              <button
                type="button"
                className="pw-add-section-btn"
                onClick={() => setIsAddingSection((curr) => !curr)}
              >
                + Add Section Divider
              </button>
            )}
          </div>

          {isManageMode && isAddingSection && (
            <form className="pw-inline-editor" style={{ margin: "6px 12px" }} onSubmit={handleAddSectionSubmit}>
              <div className="pw-inline-editor-row">
                <input
                  autoFocus
                  type="text"
                  placeholder="=== SECTION LABEL ==="
                  value={sectionLabelInput}
                  onChange={(e) => setSectionLabelInput(e.target.value)}
                />
                <button type="submit" className="pw-btn-primary" disabled={!sectionLabelInput.trim()}>
                  Add
                </button>
                <button type="button" className="pw-btn-secondary" onClick={() => setIsAddingSection(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div
            className={`pw-holdings-drop-zone ${isManageMode ? "pw-drop-zone-ready" : ""} ${isDragOver ? "pw-drop-zone-active" : ""}`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragOver && (
              <div className="pw-drop-indicator-overlay">
                <span>Drop stock here to add to {activeAccount?.name}</span>
              </div>
            )}
            {isGridView ? (
              <StockGridView
                data={data}
                stocks={holdingStocks}
                mode="holdings"
                state={state}
                dispatch={dispatch}
                manageMode={isManageMode}
                isEditing={isEditingAccount}
                onRemoveHolding={handleRemoveHolding}
                onRemoveSection={handleRemoveSection}
                onUpdateHolding={handleUpdateHolding}
                apiBaseUrl={apiBaseUrl}
              />
            ) : (
              <StockList
                data={data}
                stocks={holdingStocks}
                mode="holdings"
                state={state}
                dispatch={dispatch}
                manageMode={isManageMode}
                onRemoveHolding={handleRemoveHolding}
                onRemoveSection={handleRemoveSection}
                onReorderItems={handleReorderPortfolioItems}
              />
            )}
          </div>
        </>
      )}

      {/* Dialog: Delete Portfolio (Account) */}
      {deletingAccount && (
        <ConfirmDialog
          isOpen={Boolean(deletingAccount)}
          title={`Delete Portfolio: ${deletingAccount.name}`}
          message={`Are you sure you want to delete the "${deletingAccount.name}" portfolio? All list associations and data in this portfolio will be removed.`}
          confirmLabel="Delete Portfolio"
          cancelLabel="Cancel"
          isDanger={true}
          isSubmitting={isAccountSubmitting}
          onConfirm={handleConfirmDeleteAccount}
          onCancel={() => setDeletingAccount(null)}
        />
      )}

      {/* Dialog: Delete Stock from Watchlist */}
      {deletingStockSymbol && (
        <ConfirmDialog
          isOpen={Boolean(deletingStockSymbol)}
          title={`Remove Stock: ${deletingStockSymbol}`}
          message={`Are you sure you want to remove ${deletingStockSymbol} from tracked stocks?`}
          confirmLabel="Remove Stock"
          cancelLabel="Cancel"
          isDanger={true}
          isSubmitting={isSubmitting}
          onConfirm={handleConfirmDeleteStock}
          onCancel={() => setDeletingStockSymbol(null)}
        />
      )}

      {/* Dialog: Rename Category */}
      {editingCategory && (
        <ModalDialog
          isOpen={Boolean(editingCategory)}
          title="Rename Category"
          onClose={() => setEditingCategory(null)}
          actions={
            <>
              <button
                type="button"
                className="pw-btn-secondary"
                onClick={() => setEditingCategory(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pw-btn-primary"
                disabled={!renameCategoryName.trim()}
                onClick={handleSubmitRenameCategory}
              >
                Save
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmitRenameCategory}>
            <input
              autoFocus
              type="text"
              value={renameCategoryName}
              onChange={(e) => setRenameCategoryName(e.target.value)}
              placeholder="Category name"
              style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--pw-line)" }}
            />
          </form>
        </ModalDialog>
      )}

      {/* Dialog: Delete Category */}
      {deletingCategory && (
        <ModalDialog
          isOpen={Boolean(deletingCategory)}
          title={`Delete Category: ${deletingCategory.name}`}
          onClose={() => setDeletingCategory(null)}
          actions={
            <>
              <button
                type="button"
                className="pw-btn-secondary"
                onClick={() => setDeletingCategory(null)}
              >
                Cancel
              </button>
              {deletingCategory.id === "uncategorized" ? (
                <button
                  type="button"
                  className="pw-btn-primary pw-btn-danger"
                  onClick={() => handleExecuteDeleteCategory(true)}
                >
                  Delete Portfolios
                </button>
              ) : deletingCategoryChildCount > 0 ? (
                <>
                  <button
                    type="button"
                    className="pw-btn-secondary"
                    onClick={() => handleExecuteDeleteCategory(false)}
                  >
                    Unassign Portfolios
                  </button>
                  <button
                    type="button"
                    className="pw-btn-primary pw-btn-danger"
                    onClick={() => handleExecuteDeleteCategory(true)}
                  >
                    Delete Portfolios
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="pw-btn-primary pw-btn-danger"
                  onClick={() => handleExecuteDeleteCategory(false)}
                >
                  Delete
                </button>
              )}
            </>
          }
        >
          <div className="pw-dialog-msg">
            {deletingCategory.id === "uncategorized" ? (
              <>
                Are you sure you want to delete all {deletingCategoryChildCount} uncategorized {deletingCategoryChildCount === 1 ? "portfolio" : "portfolios"}?
              </>
            ) : deletingCategoryChildCount > 0 ? (
              <>
                This category contains {deletingCategoryChildCount} {deletingCategoryChildCount === 1 ? "portfolio" : "portfolios"}.
                Would you like to unassign them to Uncategorized or delete them?
              </>
            ) : (
              <>Are you sure you want to delete the "{deletingCategory.name}" category?</>
            )}
          </div>
        </ModalDialog>
      )}

      {/* Dialog: Add Portfolio to Category */}
      {addingPortfolioCategoryId && (
        <ModalDialog
          isOpen={Boolean(addingPortfolioCategoryId)}
          title={`Add Portfolio to ${categories.find((c) => c.id === addingPortfolioCategoryId)?.name || "Category"}`}
          onClose={() => setAddingPortfolioCategoryId(null)}
        >
          <AccountEditor
            submitLabel="Create"
            onSubmit={(payload) => handleCreateAccount({ ...payload, categoryId: addingPortfolioCategoryId })}
            onCancel={() => setAddingPortfolioCategoryId(null)}
            isSubmitting={isAccountSubmitting}
          />
        </ModalDialog>
      )}
    </>
  );
}

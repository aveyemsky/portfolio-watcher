const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const configuredLevel = String(import.meta.env.VITE_PW_LOG_LEVEL || "info").toLowerCase();
const activeLevel = LEVELS[configuredLevel] || LEVELS.info;

function shouldLog(level) {
  return LEVELS[level] >= activeLevel;
}

export const logger = {
  debug(...args) {
    if (shouldLog("debug")) console.debug("[PortfolioWatcher]", ...args);
  },
  info(...args) {
    if (shouldLog("info")) console.info("[PortfolioWatcher]", ...args);
  },
  warn(...args) {
    if (shouldLog("warn")) console.warn("[PortfolioWatcher]", ...args);
  },
  error(...args) {
    if (shouldLog("error")) console.error("[PortfolioWatcher]", ...args);
  }
};


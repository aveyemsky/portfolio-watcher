export class PortfolioApiError extends Error {
  constructor(message, { code, status, details } = {}) {
    super(message);
    this.name = "PortfolioApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function normalizeError(error) {
  if (error instanceof PortfolioApiError) {
    return error;
  }

  return new PortfolioApiError("Portfolio data could not be loaded.", {
    code: "unknown_error",
    details: error
  });
}


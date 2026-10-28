from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import numpy as np


@dataclass
class AtomicStrategyOutput:
    """Standardized atomic contract emitted by individual strategies.

    Attributes:
        strategy_id: Unique string identifier for the strategy.
        dates: List of ISO date strings (e.g. 'YYYY-MM-DD') aligned with the bars.
        target_weights: Continuous target weight per bar: 0.0 (cash), 0.5 (half-position), 1.0 (full position).
        confidence: Float ndarray with values in [0.0, 1.0] representing signal strength.
        metadata: Strategy-specific context values (e.g. stop prices, ATR, volatility).
        signal_vector: Integer ndarray with legacy values (+1, 0, -1) for backward compatibility.
    """
    strategy_id: str
    dates: List[str]
    target_weights: np.ndarray
    confidence: np.ndarray
    metadata: Dict[str, Any]
    signal_vector: Optional[np.ndarray] = None

    def __init__(
        self,
        strategy_id: str,
        dates: List[str],
        target_weights: Optional[np.ndarray] = None,
        confidence: Optional[np.ndarray] = None,
        metadata: Optional[Dict[str, Any]] = None,
        signal_vector: Optional[np.ndarray] = None,
    ):
        self.strategy_id = strategy_id
        self.dates = list(dates) if dates is not None else []
        self.metadata = metadata if metadata is not None else {}

        # Handle backward compatibility between target_weights and signal_vector
        if target_weights is None and signal_vector is not None:
            sig_arr = np.asarray(signal_vector)
            if np.issubdtype(sig_arr.dtype, np.floating) and np.any((sig_arr > 0.0) & (sig_arr < 1.0)):
                self.signal_vector = sig_arr
                self.target_weights = np.clip(np.where(sig_arr > 0, sig_arr, 0.0), 0.0, 1.0).astype(float)
            else:
                sig = sig_arr.astype(int)
                self.signal_vector = sig
                self.target_weights = np.where(sig == 1, 1.0, 0.0).astype(float)
        elif target_weights is not None and signal_vector is None and np.any(np.asarray(target_weights) < 0):
            # Positional legacy signal vector passed as 3rd arg containing negative values (-1)
            sig = np.asarray(target_weights, dtype=int)
            self.signal_vector = sig
            self.target_weights = np.where(sig == 1, 1.0, 0.0).astype(float)
        elif target_weights is not None:
            self.target_weights = np.asarray(target_weights, dtype=float)
            if signal_vector is not None:
                self.signal_vector = np.asarray(signal_vector, dtype=int)
            else:
                self.signal_vector = np.where(self.target_weights > 0, 1, 0).astype(int)
        else:
            self.target_weights = np.array([], dtype=float)
            self.signal_vector = np.array([], dtype=int)

        n = len(self.target_weights)
        if confidence is not None:
            self.confidence = np.asarray(confidence, dtype=float)
        else:
            self.confidence = np.full(n, 0.5, dtype=float)


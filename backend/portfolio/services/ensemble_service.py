from __future__ import annotations

from typing import Any, Dict, List, Optional, Union
import numpy as np

from portfolio.services.strategy_protocol import AtomicStrategyOutput


class EnsembleService:
    """Dynamic ensemble combiner for atomic strategy signals."""

    @staticmethod
    def combine(
        outputs: List[AtomicStrategyOutput],
        mode: str = "CONSENSUS",
        weights: Optional[Union[Dict[str, float], List[float]]] = None,
        threshold: float = 0.5,
        default_weight: float = 0.0,
    ) -> np.ndarray:
        """Combines N strategy outputs into a single consolidated execution vector.

        Returns:
            np.ndarray: Vector of int or float values (target weights or signals).
        """
        if not outputs:
            return np.array([], dtype=int)

        if hasattr(outputs[0], "target_weights") and outputs[0].target_weights is not None and len(outputs[0].target_weights) > 0:
            n_bars = len(outputs[0].target_weights)
        elif hasattr(outputs[0], "signal_vector") and outputs[0].signal_vector is not None:
            n_bars = len(outputs[0].signal_vector)
        else:
            n_bars = 0

        if n_bars == 0:
            return np.array([], dtype=int)

        normalized_mode = (mode or "CONSENSUS").upper()

        # Normalize weights if provided as dict {strategy_id: weight}
        weights_list: Optional[List[float]] = None
        if isinstance(weights, dict):
            weights_list = [float(weights.get(out.strategy_id, 1.0)) for out in outputs]
        elif weights is not None:
            weights_list = [float(w) for w in weights]

        if normalized_mode == "PRIORITY_LADDER":
            result = np.full(n_bars, default_weight, dtype=float)
            has_floats = False
            for t in range(n_bars):
                for out in outputs:
                    is_active = False
                    val = 0.0
                    if hasattr(out, "target_weights") and out.target_weights is not None and len(out.target_weights) > t:
                        w = float(out.target_weights[t])
                        if not np.isnan(w) and w != default_weight:
                            val = w
                            is_active = True
                    elif hasattr(out, "signal_vector") and out.signal_vector is not None and len(out.signal_vector) > t:
                        s = int(out.signal_vector[t])
                        if s != 0:
                            val = 1.0 if s == 1 else (-1.0 if s == -1 else float(s))
                            is_active = True

                    if is_active:
                        result[t] = val
                        if val not in (-1.0, 0.0, 1.0):
                            has_floats = True
                        break

            if not has_floats and not np.any((result > 0.0) & (result < 1.0)):
                return result.astype(int)
            return result

        has_continuous_weights = any(
            hasattr(out, "target_weights")
            and out.target_weights is not None
            and len(out.target_weights) == n_bars
            and np.any((np.asarray(out.target_weights) > 0.0) & (np.asarray(out.target_weights) < 1.0))
            for out in outputs
        )

        if has_continuous_weights:
            weight_matrix = []
            for out in outputs:
                if hasattr(out, "target_weights") and out.target_weights is not None and len(out.target_weights) == n_bars:
                    w = np.asarray(out.target_weights, dtype=float)
                elif hasattr(out, "signal_vector") and out.signal_vector is not None and len(out.signal_vector) == n_bars:
                    s = np.asarray(out.signal_vector, dtype=float)
                    w = np.where(s > 0, 1.0, 0.0)
                else:
                    w = np.zeros(n_bars, dtype=float)

                if hasattr(out, "signal_vector") and out.signal_vector is not None and len(out.signal_vector) == n_bars:
                    w = np.where(out.signal_vector == -1, 0.0, w)
                weight_matrix.append(w)
            weight_matrix = np.array(weight_matrix)

            if normalized_mode == "CONSENSUS":
                return np.minimum.reduce(weight_matrix, axis=0)
            elif normalized_mode == "ANY_TRIGGER":
                return np.maximum.reduce(weight_matrix, axis=0)
            elif normalized_mode in ("WEIGHTED_VOTE", "MAJORITY_VOTE"):
                n_strats = len(outputs)
                if weights_list is None or len(weights_list) != n_strats:
                    w_list = [1.0 / n_strats] * n_strats
                else:
                    total_w = sum(weights_list)
                    w_list = [w / total_w for w in weights_list] if total_w > 0 else [1.0 / n_strats] * n_strats
                w_arr = np.array(w_list).reshape(-1, 1)
                return np.sum(weight_matrix * w_arr, axis=0)
            elif normalized_mode == "CASCADE":
                regime = weight_matrix[0]
                trigger = weight_matrix[1] if len(weight_matrix) > 1 else weight_matrix[0]
                return np.where(regime > 0.0, trigger, 0.0)
            return weight_matrix[0]

        matrix = np.array([
            np.asarray(out.signal_vector if out.signal_vector is not None else out.target_weights, dtype=int)
            for out in outputs
        ])

        if normalized_mode == "CONSENSUS":
            # All active strategies must agree on Buy (+1)
            buy_mask = np.all(matrix == 1, axis=0)
            # Any strategy signaling stop/exit triggers safety
            exit_mask = np.any(matrix == -1, axis=0)
            return np.where(buy_mask, 1, np.where(exit_mask, -1, 0))

        elif normalized_mode == "ANY_TRIGGER":
            buy_mask = np.any(matrix == 1, axis=0)
            exit_mask = np.any(matrix == -1, axis=0)
            return np.where(exit_mask, -1, np.where(buy_mask, 1, 0))

        elif normalized_mode == "MAJORITY_VOTE":
            n_strats = len(outputs)
            if weights_list is None or len(weights_list) != n_strats:
                w_list = [1.0 / n_strats] * n_strats
            else:
                total_w = sum(weights_list)
                w_list = [w / total_w for w in weights_list] if total_w > 0 else [1.0 / n_strats] * n_strats

            w_arr = np.array(w_list).reshape(-1, 1)
            buy_weight = np.sum((matrix == 1) * w_arr, axis=0)
            exit_weight = np.sum((matrix == -1) * w_arr, axis=0)
            return np.where(buy_weight > 0.5, 1, np.where(exit_weight > 0.5, -1, 0))

        elif normalized_mode == "WEIGHTED_VOTE":
            n_strats = len(outputs)
            if weights_list is None or len(weights_list) != n_strats:
                w_list = [1.0 / n_strats] * n_strats
            else:
                total_w = sum(weights_list)
                w_list = [w / total_w for w in weights_list] if total_w > 0 else [1.0 / n_strats] * n_strats

            w_arr = np.array(w_list).reshape(-1, 1)
            score = np.sum(matrix * w_arr, axis=0)
            return np.where(score >= threshold, 1, np.where(score <= -threshold, -1, 0))

        elif normalized_mode == "CASCADE":
            # Strategy 0 = Regime Gate; Strategy 1 = Timing Trigger; Strategy 2..N = Exits
            regime = matrix[0]
            trigger = matrix[1] if len(matrix) > 1 else matrix[0]
            exits = np.any(matrix[1:] == -1, axis=0) if len(matrix) > 1 else (matrix[0] == -1)
            buy_mask = (regime > 0) & (trigger == 1)
            return np.where(exits, -1, np.where(buy_mask, 1, 0))

        # Default fallback: first strategy
        return matrix[0]

    @classmethod
    def combine_strategies(
        cls,
        outputs: List[AtomicStrategyOutput],
        mode: str = "CONSENSUS",
        weights: Optional[Union[Dict[str, float], List[float]]] = None,
        strategy_id: str = "ensemble",
    ) -> AtomicStrategyOutput:
        """Combines multiple AtomicStrategyOutput instances into a unified AtomicStrategyOutput contract."""
        if not outputs:
            return AtomicStrategyOutput(strategy_id=strategy_id, dates=[])

        combined_vec = cls.combine(outputs=outputs, mode=mode, weights=weights)
        dates = outputs[0].dates if outputs else []

        # Mean confidence across participating strategies
        confs = [out.confidence for out in outputs if hasattr(out, "confidence") and len(out.confidence) == len(dates)]
        avg_conf = np.mean(confs, axis=0) if confs else np.full(len(dates), 0.5, dtype=float)

        meta: Dict[str, Any] = {
            "combine_mode": mode,
            "participating_strategies": [o.strategy_id for o in outputs],
        }
        if weights is not None:
            meta["weights"] = weights

        has_continuous = np.any((combined_vec > 0.0) & (combined_vec < 1.0))
        if has_continuous:
            return AtomicStrategyOutput(
                strategy_id=strategy_id,
                dates=dates,
                target_weights=combined_vec,
                confidence=avg_conf,
                metadata=meta,
            )
        else:
            return AtomicStrategyOutput(
                strategy_id=strategy_id,
                dates=dates,
                signal_vector=combined_vec,
                confidence=avg_conf,
                metadata=meta,
            )

    # Alias for convenience
    combine_to_output = combine_strategies


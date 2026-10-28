import numpy as np
import pandas as pd
import pytest

from portfolio.services.strategy_protocol import AtomicStrategyOutput
from portfolio.services.ensemble_service import EnsembleService
from portfolio.services.simulation_service import SimulationService
from portfolio.services import indicator_service


def test_atomic_strategy_output_structure():
    dates = ["2024-01-01", "2024-01-02", "2024-01-03"]
    signals = np.array([1, 0, -1])
    conf = np.array([0.9, 0.5, 0.8])
    out = AtomicStrategyOutput(
        strategy_id="test_strat",
        dates=dates,
        signal_vector=signals,
        confidence=conf,
        metadata={"param": 10},
    )
    assert out.strategy_id == "test_strat"
    assert len(out.dates) == 3
    assert np.array_equal(out.signal_vector, signals)
    assert out.metadata["param"] == 10


def test_ensemble_consensus():
    dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"]
    out1 = AtomicStrategyOutput("s1", dates, np.array([1, 1, 0, -1]), np.ones(4), {})
    out2 = AtomicStrategyOutput("s2", dates, np.array([1, 0, 1, 0]), np.ones(4), {})

    # In CONSENSUS:
    # bar 0: both 1 -> +1
    # bar 1: 1 and 0 -> 0 (not all agree on 1)
    # bar 2: 0 and 1 -> 0
    # bar 3: -1 and 0 -> -1 (any exit triggers safety)
    res = EnsembleService.combine([out1, out2], mode="CONSENSUS")
    assert np.array_equal(res, np.array([1, 0, 0, -1]))


def test_ensemble_any_trigger():
    dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"]
    out1 = AtomicStrategyOutput("s1", dates, np.array([1, 0, 0, -1]), np.ones(4), {})
    out2 = AtomicStrategyOutput("s2", dates, np.array([0, 1, 0, 0]), np.ones(4), {})

    # In ANY_TRIGGER:
    # bar 0: out1 is 1 -> +1
    # bar 1: out2 is 1 -> +1
    # bar 2: both 0 -> 0
    # bar 3: out1 is -1 -> -1 (exit prioritized)
    res = EnsembleService.combine([out1, out2], mode="ANY_TRIGGER")
    assert np.array_equal(res, np.array([1, 1, 0, -1]))


def test_ensemble_weighted_vote():
    dates = ["2024-01-01", "2024-01-02"]
    out1 = AtomicStrategyOutput("s1", dates, np.array([1, -1]), np.ones(2), {})
    out2 = AtomicStrategyOutput("s2", dates, np.array([1, 0]), np.ones(2), {})
    out3 = AtomicStrategyOutput("s3", dates, np.array([0, 0]), np.ones(2), {})

    # Default weights equal (1/3 each):
    # bar 0: score = 1/3 + 1/3 + 0 = 2/3 (>= 0.5) -> +1
    # bar 1: score = -1/3 + 0 + 0 = -1/3 (not <= -0.5) -> 0
    res = EnsembleService.combine([out1, out2, out3], mode="WEIGHTED_VOTE", threshold=0.5)
    assert np.array_equal(res, np.array([1, 0]))

    # Custom weights where s1 has high weight (0.8, 0.1, 0.1):
    # bar 1: score = -0.8 <= -0.5 -> -1
    res2 = EnsembleService.combine([out1, out2, out3], mode="WEIGHTED_VOTE", weights=[0.8, 0.1, 0.1], threshold=0.5)
    assert np.array_equal(res2, np.array([1, -1]))


def test_ensemble_cascade():
    dates = ["2024-01-01", "2024-01-02", "2024-01-03"]
    regime = AtomicStrategyOutput("regime", dates, np.array([1, 0, 1]), np.ones(3), {})
    trigger = AtomicStrategyOutput("trigger", dates, np.array([1, 1, -1]), np.ones(3), {})

    # In CASCADE:
    # bar 0: regime=1, trigger=1 -> 1
    # bar 1: regime=0, trigger=1 -> 0 (regime blocked)
    # bar 2: trigger=-1 -> -1 (exit)
    res = EnsembleService.combine([regime, trigger], mode="CASCADE")
    assert np.array_equal(res, np.array([1, 0, -1]))


def test_simulation_service_run_backtest():
    dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"]
    prices = np.array([100.0, 110.0, 120.0, 105.0])
    signals = np.array([1, 0, -1, 0])

    sim = SimulationService.run_backtest(dates, prices, signals, initial_capital=10000.0)
    assert "metrics" in sim
    assert "strategy_equity" in sim
    assert "benchmark_equity" in sim
    assert "trades" in sim

    # Trade 1 buy at 100, exit at 120 -> +20%
    assert len(sim["trades"]) == 2
    assert sim["trades"][0]["action"] == "BUY"
    assert sim["trades"][0]["price"] == 100.0
    assert sim["trades"][1]["action"] == "EXIT"
    assert sim["trades"][1]["price"] == 120.0
    assert sim["metrics"]["strategy_return_pct"] == 20.0
    assert sim["metrics"]["benchmark_return_pct"] == 5.0
    assert sim["metrics"]["alpha_pct"] == 15.0
    assert sim["metrics"]["total_trades"] == 1
    assert sim["metrics"]["win_rate_pct"] == 100.0


def test_indicator_to_atomic_outputs():
    dates = [f"2024-01-{i:02d}" for i in range(1, 31)]
    # Trending prices
    df = pd.DataFrame({
        "Date": dates,
        "Open": [100.0 + i for i in range(30)],
        "High": [102.0 + i for i in range(30)],
        "Low": [99.0 + i for i in range(30)],
        "Close": [101.0 + i for i in range(30)],
        "Volume": [1000000 for _ in range(30)],
    })

    ma_out = indicator_service.ma_to_atomic_output(df, period=10)
    assert isinstance(ma_out, AtomicStrategyOutput)
    assert len(ma_out.signal_vector) == 30
    assert ma_out.signal_vector[-1] == 1 # Trending up above MA10

    st_out = indicator_service.supertrend_to_atomic_output(df, period=10, multiplier=3.0)
    assert isinstance(st_out, AtomicStrategyOutput)
    assert len(st_out.signal_vector) == 30
    assert st_out.signal_vector[-1] == 1 # Uptrend

    rsi_out = indicator_service.rsi_to_atomic_output(df, period=14)
    assert isinstance(rsi_out, AtomicStrategyOutput)
    assert len(rsi_out.signal_vector) == 30

    factory_out = indicator_service.indicator_to_atomic_output(df, "supertrend")
    assert factory_out.strategy_id == "supertrend"

    ema_out = indicator_service.ema_to_atomic_output(df, period=20)
    assert isinstance(ema_out, AtomicStrategyOutput)
    assert len(ema_out.signal_vector) == 30

    macd_out = indicator_service.macd_to_atomic_output(df)
    assert isinstance(macd_out, AtomicStrategyOutput)
    assert len(macd_out.signal_vector) == 30

    bb_out = indicator_service.bb_to_atomic_output(df, period=20)
    assert isinstance(bb_out, AtomicStrategyOutput)
    assert len(bb_out.signal_vector) == 30


def test_simulate_stock_ensemble_service():
    from unittest.mock import MagicMock, patch
    from datetime import datetime, timedelta

    mock_stock = MagicMock(id=1, symbol="AAPL")
    start = datetime(2024, 1, 1)
    mock_prices = [
        MagicMock(
            date=(start + timedelta(days=i)).strftime("%Y-%m-%d"),
            open=100.0 + i,
            high=102.0 + i,
            low=99.0 + i,
            close=101.0 + i,
            volume=1000000,
        )
        for i in range(35)
    ]

    with patch("portfolio.data.repositories.stock_repository.get_stock_by_symbol", return_value=mock_stock), \
         patch("portfolio.data.repositories.price_repository.list_prices_for_stock_id", return_value=mock_prices):
        res = SimulationService.simulate_stock_ensemble(
            symbol="AAPL",
            strategies=[{"id": "ma50"}, {"id": "supertrend"}],
            combine_mode="CONSENSUS",
            lookback_days=30,
        )

        assert res["ticker"] == "AAPL"
        assert "metrics" in res
        assert "strategy_equity" in res
        assert "benchmark_equity" in res
        assert "trade_markers" in res
        assert "current_posture" in res


def test_simulate_stock_ensemble_custom_date_range():
    from unittest.mock import MagicMock, patch
    from datetime import datetime, timedelta

    mock_stock = MagicMock(id=1, symbol="MSFT")
    start = datetime(2024, 1, 1)
    mock_prices = [
        MagicMock(
            date=(start + timedelta(days=i)).strftime("%Y-%m-%d"),
            open=100.0 + i,
            high=102.0 + i,
            low=99.0 + i,
            close=101.0 + i,
            volume=1000000,
        )
        for i in range(40)
    ]

    with patch("portfolio.data.repositories.stock_repository.get_stock_by_symbol", return_value=mock_stock), \
         patch("portfolio.data.repositories.price_repository.list_prices_for_stock_id", return_value=mock_prices):
        res = SimulationService.simulate_stock_ensemble(
            symbol="MSFT",
            strategies=[{"id": "ma50"}],
            combine_mode="CONSENSUS",
            lookback_days=0,
            start_date="2024-01-10",
            end_date="2024-01-25",
        )

        assert res["ticker"] == "MSFT"
        assert len(res["dates"]) > 0
        assert res["dates"][0] == "2024-01-10"
        assert res["dates"][-1] == "2024-01-25"
        assert res["start_date"] == "2024-01-10"
        assert res["end_date"] == "2024-01-25"


def test_simulation_staged_allocations_rebalancing():
    """Verifies staged continuous target weights [1.0, 1.0, 0.5, 0.5, 1.0].

    Verifies that setting target_weights to [1.0, 1.0, 0.5, 0.5, 1.0] correctly executes:
    - one initial BUY (bar 0: 100% position)
    - one TRIM selling half position (bar 2: trimmed to 50% position)
    - one re-accumulation SCALE_IN (bar 4: back to 100% position)
    without dumping the entire position to zero at any point.
    """
    dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]
    prices = np.array([100.0, 100.0, 100.0, 100.0, 100.0])
    target_weights = np.array([1.0, 1.0, 0.5, 0.5, 1.0])

    sim = SimulationService.run_backtest(
        dates=dates,
        prices=prices,
        target_weights=target_weights,
        initial_capital=10000.0,
    )

    trades = sim["trades"]
    assert len(trades) == 3, f"Expected 3 trades, got {len(trades)}: {trades}"

    # 1. Initial BUY
    assert trades[0]["action"] == "BUY"
    assert trades[0]["price"] == 100.0
    assert trades[0]["shares"] == 100.0
    assert trades[0]["remaining_cash"] == 0.0

    # 2. TRIM (selling half position)
    assert trades[1]["action"] in ("TRIM", "TRIM_HARVEST")
    assert trades[1]["price"] == 100.0
    assert trades[1]["shares"] == 50.0
    assert trades[1]["remaining_cash"] == 5000.0

    # 3. Re-accumulation (SCALE_IN)
    assert trades[2]["action"] in ("SCALE_IN", "BUY")
    assert trades[2]["action"] == "SCALE_IN"
    assert trades[2]["price"] == 100.0
    assert trades[2]["shares"] == 50.0
    assert trades[2]["remaining_cash"] == 0.0

    # Verify equity never dumped to zero or cash during hold
    assert sim["strategy_equity"] == [10000.0, 10000.0, 10000.0, 10000.0, 10000.0]


def test_ensemble_priority_ladder():
    dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"]
    # Strategy 1 (Priority 1): emits 1.0 on bar 1, 0.0 on others
    out1 = AtomicStrategyOutput("s1_high", dates, np.array([0.0, 1.0, 0.0, 0.0]), np.ones(4), {})
    # Strategy 2 (Priority 2): emits 0.5 on bars 0, 1, 2, 0.0 on bar 3
    out2 = AtomicStrategyOutput("s2_med", dates, np.array([0.5, 0.5, 0.5, 0.0]), np.ones(4), {})
    # Strategy 3 (Priority 3): emits 0.2 on all bars
    out3 = AtomicStrategyOutput("s3_low", dates, np.array([0.2, 0.2, 0.2, 0.2]), np.ones(4), {})

    # Bar 0: s1 is 0.0 -> s2 is 0.5 -> wins with 0.5
    # Bar 1: s1 is 1.0 -> wins with 1.0
    # Bar 2: s1 is 0.0 -> s2 is 0.5 -> wins with 0.5
    # Bar 3: s1 is 0.0 -> s2 is 0.0 -> s3 is 0.2 -> wins with 0.2
    ladder_weights = EnsembleService.combine([out1, out2, out3], mode="PRIORITY_LADDER")
    assert np.allclose(ladder_weights, np.array([0.5, 1.0, 0.5, 0.2]))


def test_trend_runner_strategy_atomic_output():
    # 60 days of steadily climbing prices
    n = 60
    dates = [(pd.Timestamp("2024-01-01") + pd.Timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n)]
    closes = [100.0 + (i * 2.0) for i in range(n)]
    highs = [c + 1.5 for c in closes]
    lows = [c - 1.5 for c in closes]
    opens = [c - 0.5 for c in closes]
    df = pd.DataFrame({
        "Date": dates,
        "Open": opens,
        "High": highs,
        "Low": lows,
        "Close": closes,
        "Volume": [1000000] * n,
    })

    out = indicator_service.trend_runner_to_atomic_output(df, multiplier=3.0, trend_ma=50)
    assert out.strategy_id == "trend_runner"
    assert len(out.signal_vector) == n
    # By day 55+ with continuous bull run above MA50 and EMA20, signal should be +1 (Long)
    assert out.signal_vector[-1] == 1.0


def test_simulate_stock_ensemble_macro_sentiment_gate():
    from unittest.mock import MagicMock, patch
    from datetime import datetime, timedelta

    mock_stock = MagicMock(id=1, symbol="NVDA")
    mock_vix = MagicMock(id=2, symbol="^VIX")
    mock_skew = MagicMock(id=3, symbol="^SKEW")

    start = datetime(2024, 1, 1)
    n = 60
    stock_prices = [
        MagicMock(
            date=(start + timedelta(days=i)).strftime("%Y-%m-%d"),
            open=100.0 + i,
            high=102.0 + i,
            low=99.0 + i,
            close=101.0 + i,
            volume=1000000,
        )
        for i in range(n)
    ]

    # Create VIX with a spike above 30 on the last 5 days
    vix_prices = [
        MagicMock(
            date=(start + timedelta(days=i)).strftime("%Y-%m-%d"),
            close=35.0 if i >= (n - 5) else 15.0,
            close_price=35.0 if i >= (n - 5) else 15.0,
        )
        for i in range(n)
    ]

    def mock_get_stock(sym):
        if sym == "NVDA":
            return mock_stock
        if sym == "^VIX":
            return mock_vix
        if sym == "^SKEW":
            return mock_skew
        return None

    def mock_list_prices(sid):
        if sid == 1:
            return stock_prices
        if sid == 2:
            return vix_prices
        return []

    with patch("portfolio.data.repositories.stock_repository.get_stock_by_symbol", side_effect=mock_get_stock), \
         patch("portfolio.data.repositories.price_repository.list_prices_for_stock_id", side_effect=mock_list_prices):
        # 1. Backtest without macro gate
        res_no_gate = SimulationService.simulate_stock_ensemble(
            symbol="NVDA",
            strategies=[{"id": "supertrend"}],
            lookback_days=30,
            macro_sentiment_gate={"enabled": False},
        )
        assert res_no_gate["macro_gate"]["enabled"] is False

        # 2. Backtest with macro gate enabled (vix_max = 28)
        res_gated = SimulationService.simulate_stock_ensemble(
            symbol="NVDA",
            strategies=[{"id": "supertrend"}],
            lookback_days=30,
            macro_sentiment_gate={"enabled": True, "vix_max": 28.0, "skew_max": 145.0},
        )
        assert res_gated["macro_gate"]["enabled"] is True
        assert res_gated["macro_gate"]["gated_bars"] >= 5
        assert res_gated["macro_gate"]["gate_active_today"] is True
        assert "DEFENSIVE" in res_gated["current_posture"]["posture"]


def test_vectorized_run_strategy_backtest():
    # Prices: 100 -> 110 (+10%) -> 99 (-10%) -> 108.9 (+10%)
    prices = np.array([100.0, 110.0, 99.0, 108.9])

    # 1. Full exposure (1.0) throughout: returns equal benchmark
    exposure_full = np.array([1.0, 1.0, 1.0, 1.0])
    res_full = SimulationService.run_strategy_backtest(prices, exposure_full, initial_capital=10000.0)
    assert res_full["strategy_return_pct"] == res_full["benchmark_return_pct"]
    assert res_full["alpha_vs_hold"] == 0.0
    assert len(res_full["equity_curve"]) == 4

    # 2. Timing: Long on bar 0 (captures 100->110), Exit to cash on bar 1 (avoids 110->99), Re-enter on bar 2 (captures 99->108.9)
    # Lagged exposure weights: exposure[0] acts on return[1], exposure[1] acts on return[2], etc.
    exposure_smart = np.array([1.0, 0.0, 1.0, 0.0])
    res_smart = SimulationService.run_strategy_backtest(prices, exposure_smart, initial_capital=10000.0)
    # Return 1: +10% -> 11,000. Return 2: exposure 0 -> stays 11,000. Return 3: +10% -> 12,100 (+21%)
    assert res_smart["strategy_return_pct"] == 21.0
    assert res_smart["benchmark_return_pct"] == 8.9
    assert res_smart["alpha_vs_hold"] == 12.1
    assert res_smart["max_drawdown_pct"] == 0.0

    # 3. Partial exposure scaling: 50% exposure
    exposure_half = np.array([0.5, 0.5, 0.5, 0.5])
    res_half = SimulationService.run_strategy_backtest(prices, exposure_half, initial_capital=10000.0)
    assert res_half["strategy_return_pct"] != 0.0
    assert res_half["max_drawdown_pct"] < 0.0

    # 4. Empty / Single bar edge cases
    res_empty = SimulationService.run_strategy_backtest(np.array([]), np.array([]))
    assert res_empty["strategy_return_pct"] == 0.0
    assert res_empty["equity_curve"] == []

    res_single = SimulationService.run_strategy_backtest(np.array([100.0]), np.array([1.0]))
    assert res_single["strategy_return_pct"] == 0.0
    assert res_single["equity_curve"] == [10000.0]


def test_ensemble_majority_vote_and_dict_weights():
    dates = ["2024-01-01", "2024-01-02", "2024-01-03"]
    out1 = AtomicStrategyOutput("s1", dates, np.array([1, 1, -1]), np.ones(3), {})
    out2 = AtomicStrategyOutput("s2", dates, np.array([1, -1, 0]), np.ones(3), {})
    out3 = AtomicStrategyOutput("s3", dates, np.array([0, -1, 0]), np.ones(3), {})

    # Unweighted MAJORITY_VOTE:
    # bar 0: votes for +1 = 2 out of 3 (> 1.5) -> +1
    # bar 1: votes for -1 = 2 out of 3 (> 1.5) -> -1
    # bar 2: votes for -1 = 1 out of 3 (not > 1.5) -> 0
    res_maj = EnsembleService.combine([out1, out2, out3], mode="MAJORITY_VOTE")
    assert np.array_equal(res_maj, np.array([1, -1, 0]))

    # Weighted with dict weights: s1 has weight 5.0, s2 has 1.0, s3 has 1.0
    res_dict_weights = EnsembleService.combine(
        [out1, out2, out3],
        mode="MAJORITY_VOTE",
        weights={"s1": 5.0, "s2": 1.0, "s3": 1.0},
    )
    # bar 1: s1 votes +1 (weight 5), s2 votes -1 (weight 1), s3 votes -1 (weight 1) -> +1 dominates (5/7 > 0.5)
    # bar 2: s1 votes -1 (weight 5), others 0 -> -1 dominates
    assert np.array_equal(res_dict_weights, np.array([1, 1, -1]))


def test_ensemble_combine_strategies_contract():
    dates = ["2024-01-01", "2024-01-02"]
    out1 = AtomicStrategyOutput("supertrend", dates, np.array([1, 1]), np.array([0.8, 0.9]), {})
    out2 = AtomicStrategyOutput("squeeze", dates, np.array([1, -1]), np.array([0.6, 0.7]), {})

    combined_out = EnsembleService.combine_strategies(
        [out1, out2],
        mode="CONSENSUS",
        strategy_id="custom_ensemble",
    )
    assert isinstance(combined_out, AtomicStrategyOutput)
    assert combined_out.strategy_id == "custom_ensemble"
    assert combined_out.dates == dates
    assert np.array_equal(combined_out.signal_vector, np.array([1, -1]))
    assert len(combined_out.confidence) == 2
    assert combined_out.metadata["combine_mode"] == "CONSENSUS"
    assert combined_out.metadata["participating_strategies"] == ["supertrend", "squeeze"]




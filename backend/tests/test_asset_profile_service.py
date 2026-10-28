import numpy as np
import pytest
from app import create_app

from portfolio.services.asset_profile_service import (
    calculate_trend_efficiency,
    calculate_cycle_drawdown,
    calculate_secular_cagr,
    AssetProfileService,
)


@pytest.fixture
def app():
    app = create_app(start_scheduler=False)
    app.config["TESTING"] = True
    return app


def test_calculate_trend_efficiency():
    # Straight line up (perfect trend)
    perfect_trend = np.array([10.0, 20.0, 30.0, 40.0, 50.0])
    er_perfect = calculate_trend_efficiency(perfect_trend, window=5)
    assert er_perfect == pytest.approx(1.0, rel=1e-2)

    # Pure alternating chop starting and ending at 10: 10, 20, 10, 20, 10
    pure_chop = np.array([10.0, 20.0, 10.0, 20.0, 10.0])
    er_chop = calculate_trend_efficiency(pure_chop, window=5)
    assert er_chop == pytest.approx(0.0, abs=1e-2)

    # Small sample fallback
    assert calculate_trend_efficiency(np.array([10.0, 11.0])) == 0.5


def test_calculate_cycle_drawdown():
    # Peak at 120, drops to 60 (-50%), then recovers to 90
    prices = np.array([100.0, 120.0, 60.0, 80.0, 90.0])
    dd = calculate_cycle_drawdown(prices)
    assert dd["max_drawdown_pct"] == pytest.approx(-50.0, abs=0.5)


def test_calculate_secular_cagr():
    # 252 days, doubles from 100 to 200 -> CAGR ~ 100%
    prices = np.linspace(100.0, 200.0, 252)
    cagr = calculate_secular_cagr(prices, trading_days_per_year=252)
    assert cagr == pytest.approx(100.0, abs=1.0)


def test_get_stock_dna_profile_real_stocks(app):
    with app.app_context():
        # Test on AAPL
        profile_aapl = AssetProfileService.get_stock_dna_profile("AAPL")
        assert profile_aapl["symbol"] == "AAPL"
        assert profile_aapl["status"] == "ok"
        assert "trend_efficiency" in profile_aapl
        assert "max_cycle_drawdown_pct" in profile_aapl
        assert "daily_volatility_pct" in profile_aapl
        assert "volatility_label" in profile_aapl
        assert "recommended_preset" in profile_aapl
        assert profile_aapl["profile_type"] in [
            "SECULAR_COMPOUNDER",
            "CYCLICAL_SWING",
            "CHOPPY_NOISE",
            "TRENDING_MOMENTUM",
            "MOMENTUM_REBOUND",
            "RUNAWAY_COMPOUNDER",
            "CYCLICAL_TREND",
            "CYCLICAL_OSCILLATOR",
            "VOLUME_ACCUMULATION",
            "FAST_MOMENTUM",
        ]


        # Test on unknown stock
        profile_unknown = AssetProfileService.get_stock_dna_profile("NONEXISTENT_XYZ")
        assert profile_unknown["profile_type"] == "UNKNOWN"
        assert profile_unknown["status"] == "insufficient_data"


def test_api_route_dna_profile(app):
    with app.test_client() as client:
        res = client.get("/api/portfolio/stocks/AAPL/dna-profile?lookback_days=365&include_quant_alpha=true")
        assert res.status_code == 200
        data = res.get_json()
        assert data["symbol"] == "AAPL"
        assert data["status"] == "ok"
        assert "recommended_preset" in data
        assert data["include_quant_alpha"] is True


def test_runaway_compounder_recommends_best_candidate_not_ma200(app, monkeypatch):
    """Verify that a stock with high CAGR (>25%) and negative alpha candidates (< -20%)
    recommends the best candidate (e.g. Squeeze Momentum or Trend Runner) instead of hardcoding ma200."""
    with app.app_context():
        # Mock _evaluate_candidate_strategies to return a high-performing candidate with negative alpha
        mock_cand = {
            "label": "Squeeze Momentum (BB / KC)",
            "strategies": ["squeeze_momentum"],
            "alpha_pct": -540.0,
            "strategy_return_pct": 2632.0,
            "win_rate_pct": 60.0,
            "max_drawdown_pct": -37.5,
        }
        monkeypatch.setattr(
            AssetProfileService,
            "_evaluate_candidate_strategies",
            lambda symbol, lookback_days=730, include_quant_alpha=False: mock_cand
        )
        # Mock calculate_secular_cagr to return high growth (>25%)
        monkeypatch.setattr(
            "portfolio.services.asset_profile_service.calculate_secular_cagr",
            lambda closes: 150.0
        )

        profile = AssetProfileService.get_stock_dna_profile("AAPL", include_quant_alpha=True)
        assert profile["status"] == "ok"
        assert profile["profile_type"] == "RUNAWAY_COMPOUNDER"
        assert profile["profile_label"] == "Runaway Compounder"
        preset = profile["recommended_preset"]
        # Must recommend the winning candidate, NOT hardcoded ma200
        assert preset["strategies"] == ["squeeze_momentum"]
        assert preset["label"] == "Squeeze Momentum (BB / KC)"
        assert "2632.0% return" in preset["reason"]
        assert "squeeze_momentum" in preset["strategies"]


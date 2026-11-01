"""API tests against the bundled January 2026 snapshot (no network)."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_meta_lists_january_decision_window():
    m = client.get("/api/meta").json()
    assert m["source"] == "snapshot"
    assert m["delivery_days"][0] == "2026-01-02"
    assert m["delivery_days"][-1] == "2026-02-01"
    assert len(m["delivery_days"]) == 31


def test_dayahead_returns_full_day_from_pre_gate_forecast():
    d = client.get("/api/dayahead", params={"date": "2026-01-15", "gate": "09:20"}).json()
    assert len(d["series"]) == 24
    assert d["publish_time"] <= d["decision_time"]
    assert all(r["band_low"] <= r["forecast"] <= r["band_high"] or r["band_high"] < r["forecast"]
               for r in d["series"])
    assert d["summary"]["reliable_p90_mwh"] <= d["summary"]["forecast_mwh"]


def test_dayahead_validation():
    assert client.get("/api/dayahead", params={"date": "2025-06-01"}).status_code == 404
    assert client.get("/api/dayahead", params={"date": "nope"}).status_code == 422
    assert client.get("/api/dayahead", params={"date": "2026-01-15", "gate": "25:99"}).status_code == 422


def test_accuracy_modes():
    da = client.get("/api/accuracy").json()
    assert da["mode"] == "dayahead" and da["metrics"]["n"] > 700
    hz = client.get("/api/accuracy", params={"horizon": 4}).json()
    assert hz["mode"] == "horizon"
    assert all(s["horizon_h"] >= 4 for s in hz["series"])


def test_horizon_curve_error_grows_with_lead_time():
    pts = client.get("/api/horizon-curve").json()["points"]
    assert len(pts) == 49
    assert pts[48]["mae"] > pts[0]["mae"]

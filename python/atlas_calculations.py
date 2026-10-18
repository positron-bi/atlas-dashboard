"""Calculations used by the Atlas public dashboard.

Inputs are already aggregated by fiscal year and month. No voucher, account,
person, or description-level records are read or emitted by this module.
Amounts are stored in Rials; the display unit is billion Toman (divide by 1e10).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "dashboard-data.json"


def load_data(path: Path = DATA_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def pnl_values(row: dict[str, Any]) -> dict[str, float]:
    """Mirror P&L visual's month/group SUM(NetAmount) calculation."""
    revenue = float(row["revenue"])
    expenses = float(row["expenses"])  # negative in the Power BI model
    return {
        "revenue": revenue,
        "expenses_display": -expenses,
        "profit": revenue + expenses,
    }


def budget_values(row: dict[str, Any]) -> dict[str, float | None]:
    """Mirror the report measures; expenses are shown as positive amounts."""
    revenue_budget = float(row["revenue"])
    expenses_budget = -float(row["expenses"])
    revenue_actual = row.get("actualRevenue")
    expense_actual_raw = row.get("actualExpenses")
    revenue_actual = None if revenue_actual is None else float(revenue_actual)
    expenses_actual = None if expense_actual_raw is None else -float(expense_actual_raw)
    profit_budget = revenue_budget - expenses_budget
    profit_actual = (
        None if revenue_actual is None or expenses_actual is None
        else revenue_actual - expenses_actual
    )
    return {
        "revenue_budget": revenue_budget,
        "revenue_actual": revenue_actual,
        "revenue_achievement": _divide(revenue_actual, revenue_budget),
        "expenses_budget": expenses_budget,
        "expenses_actual": expenses_actual,
        "expenses_achievement": _divide(expenses_actual, expenses_budget),
        "profit_budget": profit_budget,
        "profit_actual": profit_actual,
        "profit_achievement": _divide(profit_actual, profit_budget),
        "profit_variance": None if profit_actual is None else profit_actual - profit_budget,
        "profit_variance_percent": _divide(
            None if profit_actual is None else profit_actual - profit_budget,
            abs(profit_budget),
        ),
    }


def _divide(numerator: float | None, denominator: float) -> float | None:
    if numerator is None or denominator == 0:
        return None
    return numerator / denominator


def validate(data: dict[str, Any]) -> None:
    """Fail fast on unsafe grain, duplicate periods, or invalid month values."""
    for name in ("pnl", "budget"):
        seen: set[tuple[int, int]] = set()
        for row in data[name]:
            period = (int(row["year"]), int(row["month"]))
            if period in seen:
                raise ValueError(f"Duplicate {name} month: {period}")
            seen.add(period)
            if not 1 <= period[1] <= 12:
                raise ValueError(f"Invalid month in {name}: {period}")
            if any(key.lower() in {"voucherid", "vouchernumber", "description", "accountcode"} for key in row):
                raise ValueError(f"Detail-level field found in public {name} snapshot")


def main() -> None:
    data = load_data()
    validate(data)
    print(f"validated: {len(data['pnl'])} monthly P&L rows; {len(data['budget'])} monthly budget rows")
    for row in data["budget"]:
        values = budget_values(row)
        if row.get("actualRevenue") is not None:
            print(
                f"{row['year']}/{row['month']:02}: "
                f"revenue achievement={values['revenue_achievement']:.1%}; "
                f"expense achievement={values['expenses_achievement']:.1%}; "
                f"profit variance={values['profit_variance'] / 1e10:.2f} billion Toman"
            )


if __name__ == "__main__":
    main()

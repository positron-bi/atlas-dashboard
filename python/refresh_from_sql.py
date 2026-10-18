"""Refresh the Atlas dashboard from SQL Server using month-level aggregates only.

The queries mirror the two Power BI actuals populations. They never return
voucher IDs, dates, account names, descriptions, or individual ledger lines.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "dashboard-data.json"

PNL_SQL = r"""
SELECT RTRIM(h.doc_year) AS fiscal_year,
       CAST(SUBSTRING(RTRIM(d.doc_date), 6, 2) AS int) AS month_number,
       SUM(CASE WHEN RTRIM(d.ledger) LIKE '922%' THEN COALESCE(d.doc_credit, 0) - COALESCE(d.doc_debit, 0) ELSE 0 END) AS revenue,
       SUM(CASE WHEN RTRIM(d.ledger) LIKE '913%' THEN COALESCE(d.doc_credit, 0) - COALESCE(d.doc_debit, 0) ELSE 0 END) AS expenses
FROM dbo.document_detail AS d
JOIN dbo.document_head AS h ON h.dochead_id = d.dochead_id
WHERE h.doc_type = 0 AND h.doc_status = 0
  AND RTRIM(d.ledger) IN ('91320','91340','91350','92210','92220','92250','92260','92280')
  AND ((RTRIM(d.ledger) = '91320' AND RIGHT('00' + RTRIM(d.sledger), 2) = '02')
    OR (RTRIM(d.ledger) = '91340' AND TRY_CONVERT(int, RIGHT('00' + RTRIM(d.sledger), 2)) BETWEEN 1 AND 38)
    OR (RTRIM(d.ledger) = '91350' AND TRY_CONVERT(int, RIGHT('00' + RTRIM(d.sledger), 2)) BETWEEN 1 AND 36)
    OR (RTRIM(d.ledger) IN ('92210','92220','92250','92260') AND RIGHT('00' + RTRIM(d.sledger), 2) = '01')
    OR (RTRIM(d.ledger) = '92280' AND RIGHT('00' + RTRIM(d.sledger), 2) IN ('01','04','08')))
GROUP BY RTRIM(h.doc_year), CAST(SUBSTRING(RTRIM(d.doc_date), 6, 2) AS int)
ORDER BY RTRIM(h.doc_year), CAST(SUBSTRING(RTRIM(d.doc_date), 6, 2) AS int);
"""

# These account-code groups are the compact, non-transactional account map
# used by Atlas Account Map in the PBIX. Only their monthly totals leave SQL.
BUDGET_ACTUAL_SQL = r"""
WITH Mapped AS (
  SELECT RTRIM(h.doc_year) AS fiscal_year,
         CAST(SUBSTRING(RTRIM(d.doc_date), 6, 2) AS int) AS month_number,
         RTRIM(d.ledger) AS ledger_code,
         RIGHT('00' + RTRIM(d.sledger), 2) AS subledger_code,
         COALESCE(d.doc_credit, 0) - COALESCE(d.doc_debit, 0) AS net_amount
  FROM dbo.document_detail AS d
  JOIN dbo.document_head AS h ON h.dochead_id = d.dochead_id
), Classified AS (
  SELECT fiscal_year, month_number, net_amount,
         CASE
           WHEN (ledger_code = '91320' AND subledger_code = '02')
             OR (ledger_code = '91340' AND TRY_CONVERT(int, subledger_code) BETWEEN 1 AND 38)
             OR (ledger_code = '91350' AND TRY_CONVERT(int, subledger_code) BETWEEN 1 AND 36)
             THEN 'Expenses'
           WHEN (ledger_code IN ('92210','92220','92250','92260') AND subledger_code = '01')
             OR (ledger_code = '92280' AND subledger_code IN ('01','04','08'))
             THEN 'Revenue'
         END AS group_name
  FROM Mapped
)
SELECT fiscal_year, month_number,
       SUM(CASE WHEN group_name = 'Revenue' THEN net_amount ELSE 0 END) AS revenue_actual,
       SUM(CASE WHEN group_name = 'Expenses' THEN net_amount ELSE 0 END) AS expenses_actual
FROM Classified
WHERE group_name IS NOT NULL
GROUP BY fiscal_year, month_number
ORDER BY fiscal_year, month_number;
"""


def _load_env() -> None:
    env_path = ROOT / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _json_number(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


def _fetch(cursor, sql: str) -> list[dict]:
    cursor.execute(sql)
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, map(_json_number, row))) for row in cursor.fetchall()]


def refresh() -> None:
    _load_env()
    server = os.getenv("SQL_SERVER")
    if not server:
        raise SystemExit("Set SQL_SERVER in .env.local; the server is intentionally not embedded in the public repository.")
    try:
        import pyodbc
    except ImportError as exc:
        raise SystemExit("Install pyodbc and the Microsoft SQL Server ODBC driver first.") from exc

    driver = os.getenv("SQL_DRIVER", "ODBC Driver 18 for SQL Server")
    database = os.getenv("SQL_DATABASE", "mali")
    username, password = os.getenv("SQL_USERNAME"), os.getenv("SQL_PASSWORD")
    auth = f"UID={username};PWD={password};" if username and password else "Trusted_Connection=yes;"
    connection_string = f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};{auth}TrustServerCertificate=yes;"
    with pyodbc.connect(connection_string, timeout=30) as connection:
        cursor = connection.cursor()
        pnl_rows = _fetch(cursor, PNL_SQL)
        budget_actual_rows = _fetch(cursor, BUDGET_ACTUAL_SQL)

    # Reject any accidental detail-grain result before writing the public file.
    for rows in (pnl_rows, budget_actual_rows):
        if any(set(row) != {"fiscal_year", "month_number", "revenue", "expenses"} and
               set(row) != {"fiscal_year", "month_number", "revenue_actual", "expenses_actual"} for row in rows):
            raise ValueError("Unexpected SQL result shape; refusing to write the public snapshot.")

    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    pnl_by_period = {(int(row["fiscal_year"]), int(row["month_number"])): row for row in pnl_rows}
    data["pnl"] = [
        {"year": year, "month": month, "revenue": int(row["revenue"]), "expenses": int(row["expenses"])}
        for (year, month), row in sorted(pnl_by_period.items())
    ]
    actual_by_period = {
        (int(row["fiscal_year"]), int(row["month_number"])): row
        for row in budget_actual_rows
    }
    for row in data["budget"]:
        actual = actual_by_period.get((int(row["year"]), int(row["month"])))
        row["actualRevenue"] = None if actual is None else int(actual["revenue_actual"])
        row["actualExpenses"] = None if actual is None else int(actual["expenses_actual"])

    data["years"] = sorted({row["year"] for row in data["pnl"]} | {row["year"] for row in data["budget"]}, reverse=True)
    data["extractedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    DATA_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(data['pnl'])} monthly P&L rows and {len(data['budget'])} budget months; transaction detail was not exported.")


if __name__ == "__main__":
    refresh()

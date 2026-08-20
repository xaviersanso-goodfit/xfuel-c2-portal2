"use client";

import { useState } from "react";
import { PeriodHead, ValueRow } from "../Grid";
import type { ModelOutputs, PeriodResult, ScenarioInputs } from "@/lib/model/types";
import { fmt } from "@/lib/format";

type Line = {
  label: string;
  key?: keyof PeriodResult;
  bold?: boolean;
  section?: boolean;
  /** Component id, for lines driven by the editable revenue/COGS/OPEX lists. */
  component?: { block: "revenueByComponent" | "cogsByComponent" | "opexByComponent"; id: string };
};

const PNL_LINES: Line[] = [
  { label: "Revenue", section: true },
  { label: "Revenue at base price", key: "revenueBase" },
  { label: "Sustainable premium", key: "revenuePremium" },
  { label: "Total revenue", key: "revenue", bold: true },
  { label: "Cost of goods sold", section: true },
  { label: "__COGS_COMPONENTS__" },
  { label: "Total COGS", key: "cogs", bold: true },
  { label: "Gross margin", key: "grossMargin", bold: true },
  { label: "Operating expenses", section: true },
  { label: "Personnel", key: "opexPersonnel" },
  { label: "__OPEX_COMPONENTS__" },
  { label: "Total OPEX", key: "opexTotal", bold: true },
  { label: "EBITDA", key: "ebitda", bold: true },
  { label: "Below EBITDA", section: true },
  { label: "Depreciation", key: "depreciation" },
  { label: "EBIT", key: "ebit", bold: true },
  { label: "Interest expense", key: "interestExpense" },
  { label: "Grant income", key: "grantIncome" },
  { label: "Profit before tax", key: "pbt", bold: true },
  { label: "Loss carry-forward pool (closing)", key: "nolBalance" },
  { label: "Income tax", key: "tax" },
  { label: "Net income", key: "netIncome", bold: true },
];

const CF_LINES: Line[] = [
  { label: "Operating", section: true },
  { label: "Net income", key: "netIncome" },
  { label: "Add back depreciation", key: "depreciation" },
  { label: "Less grant income (shown in financing)", key: "grantIncome" },
  { label: "Change in receivables", key: "deltaAr" },
  { label: "Change in payables", key: "deltaAp" },
  { label: "Other working capital", key: "otherWc" },
  { label: "Operating cash flow (CFO)", key: "cfo", bold: true },
  { label: "Investing", section: true },
  { label: "CAPEX", key: "capexSpend" },
  { label: "Investing cash flow (CFI)", key: "cfi", bold: true },
  { label: "Financing", section: true },
  { label: "Debt drawdown", key: "debtDraw" },
  { label: "Debt repayment", key: "debtRepayment" },
  { label: "Equity raised", key: "equityRaise" },
  { label: "Grants collected", key: "grantCash" },
  { label: "Financing cash flow (CFF)", key: "cff", bold: true },
  { label: "Cash", section: true },
  { label: "Net cash flow", key: "netCashFlow", bold: true },
  { label: "Opening cash", key: "openingCash" },
  { label: "Closing cash", key: "closingCash", bold: true },
  { label: "Valuation flows", section: true },
  { label: "Project FCF (unlevered)", key: "projectFcf" },
  { label: "Equity FCF (levered)", key: "equityFcf" },
];

export default function StatementTab({
  kind, inputs, model,
}: {
  kind: "pnl" | "cashflow";
  inputs: ScenarioInputs;
  model: ModelOutputs;
}) {
  const [view, setView] = useState<"period" | "ytd">("period");
  const lines = kind === "pnl" ? PNL_LINES : CF_LINES;
  const data = view === "ytd" ? model.ytd : model.results;
  const periods = model.periods;

  const title = kind === "pnl" ? "Profit & loss" : "Cash flow";

  return (
    <>
      <div className="page-title">{title}</div>
      <div className="page-sub">
        Monthly for Y1 to Y3, annual from Y4. All figures in EUR. Scenario:{" "}
        <span className="pill">{inputs.name}</span>
      </div>

      <div className="toolbar">
        <button className={view === "period" ? "btn sm" : "btn ghost sm"} onClick={() => setView("period")}>
          Per period
        </button>
        <button className={view === "ytd" ? "btn sm" : "btn ghost sm"} onClick={() => setView("ytd")}>
          Year to date
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          {view === "ytd"
            ? "Monthly columns accumulate within each monthly plan year and reset each January. Annual periods are shown as-is."
            : "Each column shows the period in isolation."}
        </span>
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <table className="fin">
            <PeriodHead periods={periods} first={title} />
            <tbody>
              {lines.flatMap((line, i) => {
                if (line.section) {
                  return [<ValueRow key={`s${i}`} label={line.label} values={[]} periods={periods} section />];
                }
                // Placeholders expand into one row per editable component, so
                // renaming or adding a COGS line shows up here without a code change.
                if (line.label === "__COGS_COMPONENTS__") {
                  return inputs.cogs.map((c) => (
                    <ValueRow
                      key={`cogs-${c.id}`}
                      label={c.name}
                      values={data.map((r) => r.cogsByComponent?.[c.id] ?? 0)}
                      periods={periods}
                    />
                  ));
                }
                if (line.label === "__OPEX_COMPONENTS__") {
                  return inputs.opex.map((c) => (
                    <ValueRow
                      key={`opex-${c.id}`}
                      label={c.name}
                      values={data.map((r) => r.opexByComponent?.[c.id] ?? 0)}
                      periods={periods}
                    />
                  ));
                }
                return [
                  <ValueRow
                    key={line.key as string}
                    label={line.label}
                    values={data.map((r) => r[line.key!] as number)}
                    periods={periods}
                    bold={line.bold}
                  />,
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      {kind === "cashflow" && (
        <div className="card">
          <h3>Check</h3>
          <table className="list">
            <tbody>
              <tr>
                <td>CFO + CFI + CFF equals net cash flow, every period</td>
                <td style={{ textAlign: "right", fontWeight: 600, color: "var(--good)" }}>
                  {model.results.every((r) => Math.abs(r.cfo + r.cfi + r.cff - r.netCashFlow) < 0.01) ? "OK" : "MISMATCH"}
                </td>
              </tr>
              <tr>
                <td>Closing cash rolls into the next opening balance</td>
                <td style={{ textAlign: "right", fontWeight: 600, color: "var(--good)" }}>
                  {model.results.every(
                    (r, i) =>
                      i === 0 || Math.abs(r.openingCash - model.results[i - 1].closingCash) < 0.01
                  )
                    ? "OK"
                    : "MISMATCH"}
                </td>
              </tr>
              <tr>
                <td>Final cash</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>
                  {fmt(model.results[model.results.length - 1].closingCash)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

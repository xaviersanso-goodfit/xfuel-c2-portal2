// UI wiring tests.
//
// The engine tests prove the maths reacts to inputs. These tests prove the SCREEN
// is actually connected to the engine: every tab is rendered in a real DOM, an
// input is typed into, and we assert the change reaches the scenario object and
// changes the computed model. They also assert read-only users cannot edit.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node 22 defines navigator as a getter-only global; redefine rather than assign.
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
});
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { render, fireEvent, cleanup, within } = await import("@testing-library/react");
const { runModel } = await import("../src/lib/model/engine.ts");
const { defaultScenario } = await import("../src/lib/model/defaults.ts");
const { PERIOD_COUNT } = await import("../src/lib/model/periods.ts");

const ParametersTab = (await import("../src/components/tabs/ParametersTab.tsx")).default;
const CapexTab = (await import("../src/components/tabs/CapexTab.tsx")).default;
const UnitEconTab = (await import("../src/components/tabs/UnitEconTab.tsx")).default;
const OpexTab = (await import("../src/components/tabs/OpexTab.tsx")).default;
const FinancingTab = (await import("../src/components/tabs/FinancingTab.tsx")).default;
const StatementTab = (await import("../src/components/tabs/StatementTab.tsx")).default;
const GroupTab = (await import("../src/components/tabs/GroupTab.tsx")).default;
const { GROUP_MONTHS } = await import("../src/lib/model/group.ts");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

const BASE = defaultScenario();
const BASE_MODEL_LAST = runModel(BASE).results.length - 1;

/** Render a tab with a live onChange that records the updated scenario. */
function mount(Tab, { editable = true, inputs = BASE, extraProps = {} } = {}) {
  let latest = null;
  const onChange = (next) => { latest = next; };
  const model = runModel(inputs);
  const utils = render(
    React.createElement(Tab, { inputs, model, onChange, editable, ...extraProps })
  );
  return { ...utils, get latest() { return latest; } };
}

/** Find an input by the visible label text of its .field wrapper. */
function fieldInput(container, labelText) {
  const labels = Array.from(container.querySelectorAll(".field label"));
  const label = labels.find((l) => l.textContent.trim() === labelText);
  return label ? label.parentElement.querySelector("input") : null;
}

console.log("\n=== UI wiring (real DOM, real React) ===\n");

// ---------------------------------------------------------------- Parameters
console.log("-- Global parameters tab --");
{
  const t = mount(ParametersTab);
  const cases = [
    ["Corporate income tax rate (%)", "30", (s) => s.parameters.citr, 0.3],
    ["DSO (days)", "90", (s) => s.parameters.dso, 90],
    ["DPO (days)", "30", (s) => s.parameters.dpo, 30],
    ["WACC — project discount rate (%)", "12", (s) => s.parameters.wacc, 0.12],
    ["Cost of equity (%)", "20", (s) => s.parameters.costOfEquity, 0.2],
    ["Exit EV/EBITDA multiple", "11", (s) => s.parameters.exitMultiple, 11],
    ["Opening cash (EUR)", "250000", (s) => s.parameters.openingCash, 250000],
    ["OPEX inflation (% p.a.)", "3.5", (s) => s.parameters.opexInflation, 0.035],
    ["Compensation inflation (% p.a.)", "4", (s) => s.parameters.compensationInflation, 0.04],
    ["Operations start (period index)", "20", (s) => s.parameters.opsStartPeriod, 20],
  ];
  for (const [label, typed, get, expected] of cases) {
    const input = fieldInput(t.container, label);
    if (!input) { check(`field "${label}" exists`, false); continue; }
    fireEvent.change(input, { target: { value: typed } });
    const got = t.latest ? get(t.latest) : null;
    check(`"${label}" writes ${expected}`, got !== null && Math.abs(got - expected) < 1e-9, `got ${got}`);
  }
  // Text field
  const start = fieldInput(t.container, "Plan start month (YYYY-MM)");
  fireEvent.change(start, { target: { value: "2029-04" } });
  check('"Plan start month" writes the string', t.latest?.parameters.startMonth === "2029-04", t.latest?.parameters.startMonth);

  // The KPI block must reflect the model it was given.
  const model = runModel(BASE);
  const text = t.container.textContent;
  check("IRR KPI is rendered on screen", text.includes("Project IRR") && text.includes("Equity IRR"));
  check("annual summary renders 10 year columns", within(t.container).queryAllByText(/^Y10$/).length > 0);
  cleanup();
}

// -------------------------------------------------------------------- CAPEX
console.log("\n-- CAPEX tab --");
{
  const t = mount(CapexTab);
  const numberInputs = Array.from(t.container.querySelectorAll("table.list input[type=number]"));
  check("concept table renders inputs", numberInputs.length >= BASE.capex.length * 3, `${numberInputs.length}`);
  // First concept: total cost is the first number input in the first row.
  const firstRow = t.container.querySelector("table.list tbody tr");
  const totalInput = firstRow.querySelectorAll("input[type=number]")[0];
  fireEvent.change(totalInput, { target: { value: "20000000" } });
  check("CAPEX total writes through", t.latest?.capex[0].total === 20000000, `${t.latest?.capex[0].total}`);
  check("changing CAPEX total changes the model", runModel(t.latest).results.reduce((a, r) => a + r.capexSpend, 0) !==
    runModel(BASE).results.reduce((a, r) => a + r.capexSpend, 0));

  const rateInput = firstRow.querySelectorAll("input[type=number]")[2];
  fireEvent.change(rateInput, { target: { value: "1" } });
  check("depreciation rate writes through as a fraction", Math.abs((t.latest?.capex[0].depRateMonthly ?? 0) - 0.01) < 1e-12, `${t.latest?.capex[0].depRateMonthly}`);

  // Phasing grid
  const phaseInputs = Array.from(t.container.querySelectorAll("table.fin input.cell"));
  check("phasing grid renders a cell per period per concept", phaseInputs.length === BASE.capex.length * PERIOD_COUNT, `${phaseInputs.length}`);
  fireEvent.change(phaseInputs[0], { target: { value: "50" } });
  check("phasing cell writes back as a fraction", Math.abs((t.latest?.capex[0].phasing[0] ?? 0) - 0.5) < 1e-12, `${t.latest?.capex[0].phasing[0]}`);
  cleanup();
}

// ------------------------------------------------------------- Unit economics
console.log("\n-- Unit economics tab --");
{
  const t = mount(UnitEconTab);
  const TOTAL_YEARS = 10;
  const tables = Array.from(t.container.querySelectorAll("table.fin"));
  const yearTable = tables[0];
  const volTable = tables[1];

  /** Find a driver row in the yearly table by its rendered label. */
  const yearRow = (label) =>
    Array.from(yearTable.querySelectorAll("tbody tr")).find(
      (tr) => tr.cells[0] && tr.cells[0].textContent.trim() === label
    );

  const cases = [
    ["Price per ton MGO (EUR)", "900", (s) => s.unitEconomics.pricePerTon, 900],
    ["Annual operating hours at 100%", "7500", (s) => s.unitEconomics.annualHours, 7500],
    ["MGO yield (kg/h)", "2000", (s) => s.unitEconomics.mgoYieldKgPerHour, 2000],
    ["MTS input (kg/h)", "2100", (s) => s.unitEconomics.mtsInputKgPerHour, 2100],
    ["Reactant input (kg/h)", "60", (s) => s.unitEconomics.reactantInputKgPerHour, 60],
    ["Residue yield (kg/h)", "220", (s) => s.unitEconomics.residueYieldKgPerHour, 220],
    ["Water yield (kg/h)", "10", (s) => s.unitEconomics.waterYieldKgPerHour, 10],
    ["MTS feedstock", "200", (s) => s.unitEconomics.mtsCostPerTon, 200],
    ["Reactants", "4000", (s) => s.unitEconomics.reactantCostPerTon, 4000],
    ["Residue disposal", "400", (s) => s.unitEconomics.residueCostPerTon, 400],
    ["Water", "3", (s) => s.unitEconomics.waterCostPerTon, 3],
    ["Maintenance (% p.a. of deployed CAPEX)", "5", (s) => s.unitEconomics.maintenancePctOfCapex, 0.05],
    ["Electricity price (EUR/kWh)", "0.15", (s) => s.unitEconomics.electricityPricePerKwh, 0.15],
    ["Electricity consumption (kWh/h)", "150", (s) => s.unitEconomics.electricityKwhPerHour, 150],
    ["Heat price (EUR/kWh)", "0.09", (s) => s.unitEconomics.heatPricePerKwh, 0.09],
    ["Heat consumption (kWh/h)", "530", (s) => s.unitEconomics.heatKwhPerHour, 530],
  ];
  for (const [label, typed, get, expected] of cases) {
    const row = yearRow(label);
    if (!row) { check(`driver row "${label}" exists`, false); continue; }
    const cells = Array.from(row.querySelectorAll("input.cell"));
    if (cells.length !== TOTAL_YEARS) {
      check(`"${label}" renders ${TOTAL_YEARS} year cells`, false, `${cells.length}`);
      continue;
    }
    // Edit Y3 specifically: a yearly driver must write to the year that was typed in.
    fireEvent.change(cells[2], { target: { value: typed } });
    const series = t.latest ? get(t.latest) : null;
    check(
      `"${label}" writes ${expected} into Y3 only`,
      Array.isArray(series) &&
        series.length === TOTAL_YEARS &&
        Math.abs(series[2] - expected) < 1e-9 &&
        Math.abs(series[0] - get(BASE)[0]) < 1e-9,
      `got ${series}`
    );
  }

  // Editing a driver year must move the model in that year and leave others alone.
  {
    const row = yearRow("Price per ton MGO (EUR)");
    const cells = Array.from(row.querySelectorAll("input.cell"));
    fireEvent.change(cells[5], { target: { value: "1000" } });
    const after = runModel(t.latest);
    const before = runModel(BASE);
    const moved = after.results.filter((r, i) => Math.abs(r.revenue - before.results[i].revenue) > 1e-6);
    check("editing a driver year changes the model in that year", moved.length > 0);
    check(
      "editing a driver year changes nothing outside it",
      after.results.every((r, i) => after.periods[i].year === 6 || Math.abs(r.revenue - before.results[i].revenue) < 1e-6)
    );
  }

  // utilisation grid, in the second table on the tab
  const cells = Array.from(volTable.querySelectorAll("input.cell"));
  check(`utilisation grid renders ${PERIOD_COUNT} cells`, cells.length === PERIOD_COUNT, `${cells.length}`);
  fireEvent.change(cells[24], { target: { value: "75" } });
  check("utilisation cell writes back as a fraction", Math.abs((t.latest?.unitEconomics.utilisation[24] ?? 0) - 0.75) < 1e-12, `${t.latest?.unitEconomics.utilisation[24]}`);
  check("utilisation edit changes revenue", runModel(t.latest).results[24].revenue !== runModel(BASE).results[24].revenue);
  cleanup();
}
{
  // A scenario saved under a shorter horizon must still render a full row of
  // inputs. Mapping the row over the stored values instead of the periods left
  // the later months with no cell to type into at all, which is what made
  // utilisation read as zero from Sep-28 onwards.
  const CUT = 20;
  const shortInputs = JSON.parse(JSON.stringify(BASE));
  shortInputs.unitEconomics.utilisation = shortInputs.unitEconomics.utilisation.slice(0, CUT);
  const t = mount(UnitEconTab, { inputs: shortInputs });
  const volTable = Array.from(t.container.querySelectorAll("table.fin"))[1];
  const cells = Array.from(volTable.querySelectorAll("input.cell"));
  check(`short utilisation series still renders ${PERIOD_COUNT} cells`, cells.length === PERIOD_COUNT, `${cells.length}`);
  fireEvent.change(cells[PERIOD_COUNT - 1], { target: { value: "80" } });
  const written = t.latest?.unitEconomics.utilisation;
  check("editing the last cell emits a full-length array", written?.length === PERIOD_COUNT, `${written?.length}`);
  check("the emitted array has no holes", written?.every((v) => Number.isFinite(v)) === true);
  check("editing the last cell writes the typed value", Math.abs((written?.[PERIOD_COUNT - 1] ?? 0) - 0.8) < 1e-12);
  cleanup();
}
{
  // A legacy scalar driver must render as a full row of year cells, not blow up.
  const legacy = JSON.parse(JSON.stringify(BASE));
  legacy.unitEconomics.pricePerTon = 500;
  const t = mount(UnitEconTab, { inputs: legacy });
  const row = Array.from(t.container.querySelectorAll("table.fin")[0].querySelectorAll("tbody tr")).find(
    (tr) => tr.cells[0] && tr.cells[0].textContent.trim() === "Price per ton MGO (EUR)"
  );
  const cells = Array.from(row.querySelectorAll("input.cell"));
  check("a legacy scalar driver renders 10 year cells", cells.length === 10, `${cells.length}`);
  check("a legacy scalar shows in every year", cells.every((c) => Number(c.value) === 500));
  fireEvent.change(cells[0], { target: { value: "600" } });
  check("editing a legacy scalar emits a full yearly array",
    Array.isArray(t.latest?.unitEconomics.pricePerTon) && t.latest.unitEconomics.pricePerTon.length === 10);
  cleanup();
}

// --------------------------------------------------------------------- OPEX
console.log("\n-- OPEX & personnel tab --");
{
  // The inflation rates are global parameters but are surfaced here, next to the
  // costs they escalate, because that is where people look for them.
  const t = mount(OpexTab);
  for (const [label, typed, get, expected] of [
    ["Compensation inflation (% p.a.)", "4.5", (s) => s.parameters.compensationInflation, 0.045],
    ["OPEX inflation (% p.a.)", "3", (s) => s.parameters.opexInflation, 0.03],
  ]) {
    const input = fieldInput(t.container, label);
    if (!input) { check(`OPEX tab exposes "${label}"`, false); continue; }
    fireEvent.change(input, { target: { value: typed } });
    const got = t.latest ? get(t.latest) : null;
    check(`OPEX tab "${label}" writes ${expected}`, got !== null && Math.abs(got - expected) < 1e-9, `got ${got}`);
  }
  {
    const m = runModel(t.latest);
    check("editing inflation on the OPEX tab changes the model",
      Math.abs(m.results[m.results.length - 1].opexOther - runModel(BASE).results[BASE_MODEL_LAST].opexOther) > 0.01);
  }
  cleanup();
}
{
  const t = mount(OpexTab);
  const rows = Array.from(t.container.querySelectorAll("table.list tbody tr"));
  check("personnel table renders one row per archetype", rows.length >= BASE.personnel.length);
  const costInput = rows[0].querySelector("input[type=number]");
  fireEvent.change(costInput, { target: { value: "150000" } });
  check("annual cost per FTE writes through", t.latest?.personnel[0].annualCost === 150000, `${t.latest?.personnel[0].annualCost}`);

  const nameInput = rows[0].querySelector("input[type=text]");
  fireEvent.change(nameInput, { target: { value: "Plant director" } });
  check("archetype label writes through", t.latest?.personnel[0].label === "Plant director");

  const fteCells = Array.from(t.container.querySelectorAll("table.fin input.cell"));
  check("FTE grid renders cells for every archetype and period", fteCells.length >= BASE.personnel.length * PERIOD_COUNT);
  fireEvent.change(fteCells[24], { target: { value: "2.5" } });
  check("fractional FTE writes through", Math.abs((t.latest?.personnel[0].ftes[24] ?? 0) - 2.5) < 1e-12, `${t.latest?.personnel[0].ftes[24]}`);
  check("FTE edit changes personnel cost", runModel(t.latest).results[24].opexPersonnel !== runModel(BASE).results[24].opexPersonnel);

  // add / remove
  const addBtn = Array.from(t.container.querySelectorAll("button")).find((b) => b.textContent.includes("Add archetype"));
  fireEvent.click(addBtn);
  check("add archetype appends a role", (t.latest?.personnel.length ?? 0) === BASE.personnel.length + 1);
  const removeBtn = Array.from(t.container.querySelectorAll("button")).find((b) => b.textContent === "Remove");
  fireEvent.click(removeBtn);
  check("remove archetype deletes a role", (t.latest?.personnel.length ?? 0) === BASE.personnel.length - 1);
  cleanup();
}

// ---------------------------------------------------------------- Financing
console.log("\n-- Financing tab --");
{
  const t = mount(FinancingTab);
  const row = t.container.querySelector("table.list tbody tr");
  const numbers = row.querySelectorAll("input[type=number]");
  fireEvent.change(numbers[0], { target: { value: "15000000" } });
  check("instrument amount writes through", t.latest?.instruments[0].amount === 15000000, `${t.latest?.instruments[0].amount}`);
  fireEvent.change(numbers[1], { target: { value: "5" } });
  check("draw period writes through", t.latest?.instruments[0].drawPeriod === 5);
  fireEvent.change(numbers[2], { target: { value: "7.5" } });
  check("rate writes through as a fraction", Math.abs((t.latest?.instruments[0].rate ?? 0) - 0.075) < 1e-12, `${t.latest?.instruments[0].rate}`);
  fireEvent.change(numbers[3], { target: { value: "6" } });
  check("grace months writes through", t.latest?.instruments[0].graceMonths === 6);
  fireEvent.change(numbers[4], { target: { value: "84" } });
  check("tenor writes through", t.latest?.instruments[0].tenorMonths === 84);
  fireEvent.change(numbers[5], { target: { value: "1.5" } });
  check("upfront fee writes through as a fraction", Math.abs((t.latest?.instruments[0].upfrontFeePct ?? 0) - 0.015) < 1e-12);

  const selects = row.querySelectorAll("select");
  fireEvent.change(selects[1], { target: { value: "annuity" } });
  check("repayment profile writes through", t.latest?.instruments[0].repayment === "annuity");
  fireEvent.change(selects[0], { target: { value: "grant" } });
  check("instrument type writes through", t.latest?.instruments[0].kind === "grant");

  const addGrant = Array.from(t.container.querySelectorAll("button")).find((b) => b.textContent.includes("Add grant"));
  fireEvent.click(addGrant);
  check("add grant appends an instrument", (t.latest?.instruments.length ?? 0) === BASE.instruments.length + 1);
  check("financing edit changes the model", runModel(t.latest).results.reduce((a, r) => a + r.cff, 0) !== runModel(BASE).results.reduce((a, r) => a + r.cff, 0));
  cleanup();
}

// -------------------------------------------------------- Statements render
console.log("\n-- P&L / Cash flow tabs --");
{
  const model = runModel(BASE);
  const t = render(React.createElement(StatementTab, { kind: "pnl", inputs: BASE, model }));
  const txt = t.container.textContent;
  for (const line of ["Revenue", "Total COGS", "EBITDA", "Depreciation", "Interest expense", "Grant income", "Income tax", "Net income"]) {
    check(`P&L renders "${line}"`, txt.includes(line));
  }
  // Y3 EBITDA must appear on screen with the engine's value.
  const expected = Math.round(model.results[24].ebitda).toLocaleString("en-US");
  check("P&L shows the engine's Y3 EBITDA figure", txt.includes(expected), expected);

  // YTD toggle must change what is displayed.
  const ytdBtn = Array.from(t.container.querySelectorAll("button")).find((b) => b.textContent === "Year to date");
  fireEvent.click(ytdBtn);
  const ytdTxt = t.container.textContent;
  const ytdExpected = Math.round(model.ytd[11].revenue).toLocaleString("en-US");
  check("YTD toggle switches the table to cumulative figures", ytdTxt !== txt && ytdTxt.includes(ytdExpected), ytdExpected);
  cleanup();

  const cf = render(React.createElement(StatementTab, { kind: "cashflow", inputs: BASE, model }));
  const cftxt = cf.container.textContent;
  for (const line of ["Operating cash flow (CFO)", "Investing cash flow (CFI)", "Financing cash flow (CFF)", "Closing cash", "Project FCF (unlevered)", "Equity FCF (levered)"]) {
    check(`Cash flow renders "${line}"`, cftxt.includes(line));
  }
  check("cash flow self-check reports OK", cftxt.includes("OK"));
  cleanup();
}

// ------------------------------------------------------------- Read-only role
console.log("\n-- read-only enforcement in the UI --");
{
  for (const [name, Tab] of [["Parameters", ParametersTab], ["CAPEX", CapexTab], ["UnitEcon", UnitEconTab], ["OPEX", OpexTab], ["Financing", FinancingTab]]) {
    const t = mount(Tab, { editable: false });
    const inputs = Array.from(t.container.querySelectorAll("input"));
    const selects = Array.from(t.container.querySelectorAll("select"));
    const enabled = [...inputs, ...selects].filter((el) => !el.disabled);
    check(`${name}: every input is disabled for viewers`, enabled.length === 0, `${enabled.length} enabled`);
    // Attempting an edit must not produce a change.
    if (inputs[0]) {
      fireEvent.change(inputs[0], { target: { value: "999999" } });
      check(`${name}: viewer edit does not reach the scenario`, t.latest === null);
    }
    const removeBtns = Array.from(t.container.querySelectorAll("button")).filter((b) => b.textContent === "Remove" || b.textContent.startsWith("+ Add"));
    check(`${name}: add/remove controls are hidden for viewers`, removeBtns.length === 0, `${removeBtns.length} visible`);
    cleanup();
  }
}

console.log("\n-- XFuel total tab --");
{
  const t = mount(GroupTab);
  const table = t.container.querySelector("table.fin");
  const cells = Array.from(table.querySelectorAll("input.cell"));
  // 9 seeded lines x 30 months.
  check("group grid renders a cell per line per month", cells.length === 9 * GROUP_MONTHS, `${cells.length}`);

  const opening = fieldInput(t.container, "Cash 30/06/2026 (EUR)");
  check("opening cash field is present", !!opening);
  if (opening) {
    fireEvent.change(opening, { target: { value: "5000000" } });
    check("opening cash writes through", t.latest?.group.openingCash === 5000000, `${t.latest?.group.openingCash}`);
  }
  cleanup();
}
{
  const t = mount(GroupTab);
  const cells = Array.from(t.container.querySelector("table.fin").querySelectorAll("input.cell"));
  fireEvent.change(cells[0], { target: { value: "-125000" } });
  const line = t.latest?.group.lines[0];
  check("a group cell writes to the right line and month", line?.amounts[0] === -125000, `${line?.amounts[0]}`);
  check("a group cell emits a full-length array", line?.amounts.length === GROUP_MONTHS);
  check("a group cell leaves other months alone", line?.amounts.slice(1).every((v) => v === 0));
  cleanup();
}
{
  // Renaming a line and adding one must both write through.
  const t = mount(GroupTab);
  const labelInputs = Array.from(t.container.querySelectorAll("table.fin input[type=text]"));
  check("line labels are editable", labelInputs.length === 9, `${labelInputs.length}`);
  fireEvent.change(labelInputs[0], { target: { value: "Head office" } });
  check("renaming a line writes through", t.latest?.group.lines[0].label === "Head office");

  const addButtons = Array.from(t.container.querySelectorAll("button")).filter((b) => b.textContent.startsWith("+ Add line"));
  check("each section has an add button", addButtons.length === 3, `${addButtons.length}`);
  fireEvent.click(addButtons[0]);
  check("adding a line appends to the scenario", t.latest?.group.lines.length === 10, `${t.latest?.group.lines.length}`);
  check("an added line is full length", t.latest?.group.lines[9].amounts.length === GROUP_MONTHS);
  cleanup();
}
{
  // Read-only users must not be able to add, remove or edit.
  const t = mount(GroupTab, { editable: false });
  const cells = Array.from(t.container.querySelector("table.fin").querySelectorAll("input.cell"));
  check("group cells are disabled for viewers", cells.every((c) => c.disabled));
  fireEvent.change(cells[0], { target: { value: "999" } });
  check("a viewer cannot write a group cell", t.latest === null);
  check("no add buttons for viewers", Array.from(t.container.querySelectorAll("button")).filter((b) => b.textContent.startsWith("+ Add line")).length === 0);
  cleanup();
}

console.log(`\n=== ${failures === 0 ? "ALL UI WIRING CHECKS PASS" : failures + " CHECK(S) FAILED"} ===\n`);
process.exit(failures === 0 ? 0 : 1);

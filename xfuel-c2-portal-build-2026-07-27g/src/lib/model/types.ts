// XFuel C2 project model — input/output type contracts.
// Currency: EUR throughout. Horizon: 36 monthly periods (Y1..Y3) + 7 annual (Y4..Y10).

export type CapexConcept = "isbl" | "osbl" | "other" | "land";

export interface CapexLine {
  id: CapexConcept;
  label: string;
  /** Total cost of the concept, EUR. */
  total: number;
  /** Monthly depreciation rate applied to cost (e.g. 0.006 = 0.6%/month). Land = 0. */
  depRateMonthly: number;
  /** Period index (0-based into the period grid) in which spend starts. */
  startPeriod: number;
  /** Phasing as a fraction of total per period, indexed from startPeriod. Should sum to 1. */
  phasing: number[];
}

/**
 * A driver that varies by plan year. One entry per year of the horizon
 * (TOTAL_YEARS). Shorter arrays are carried forward; a bare number is accepted
 * on input and upgraded, so scenarios saved before these became yearly still load.
 */
export type YearlySeries = number[];

export interface UnitEconomics {
  /** Selling price per ton of MGO, EUR. */
  pricePerTon: YearlySeries;
  /** Plant operating hours per year at 100% (e.g. 8000). */
  annualHours: YearlySeries;
  /** Hourly throughput, kg/h. */
  mgoYieldKgPerHour: YearlySeries;
  mtsInputKgPerHour: YearlySeries;
  reactantInputKgPerHour: YearlySeries;
  residueYieldKgPerHour: YearlySeries;
  waterYieldKgPerHour: YearlySeries;
  /** Input/disposal unit costs, EUR per ton. */
  mtsCostPerTon: YearlySeries;
  reactantCostPerTon: YearlySeries;
  residueCostPerTon: YearlySeries;
  waterCostPerTon: YearlySeries;
  /** Energy. */
  electricityPricePerKwh: YearlySeries;
  electricityKwhPerHour: YearlySeries;
  heatPricePerKwh: YearlySeries;
  heatKwhPerHour: YearlySeries;
  /** Maintenance as % per annum of cumulative deployed CAPEX. */
  maintenancePctOfCapex: YearlySeries;
  /** Capacity utilisation as a fraction of maximum, per PERIOD (not per year). */
  utilisation: number[];
}

/** Every UnitEconomics field that is a yearly series. */
export const YEARLY_UE_KEYS = [
  "pricePerTon", "annualHours", "mgoYieldKgPerHour", "mtsInputKgPerHour",
  "reactantInputKgPerHour", "residueYieldKgPerHour", "waterYieldKgPerHour",
  "mtsCostPerTon", "reactantCostPerTon", "residueCostPerTon", "waterCostPerTon",
  "electricityPricePerKwh", "electricityKwhPerHour", "heatPricePerKwh",
  "heatKwhPerHour", "maintenancePctOfCapex",
] as const;

export type YearlyUeKey = (typeof YEARLY_UE_KEYS)[number];

export interface PersonnelArchetype {
  id: string;
  label: string;
  /** Fully loaded annual cost per FTE, EUR. */
  annualCost: number;
  /** FTEs per period (decimals allowed). */
  ftes: number[];
}

export interface OpexCategory {
  id: string;
  label: string;
  /** Fixed EUR amount per period. */
  amounts: number[];
  /** Optional: % per annum of cumulative deployed CAPEX (e.g. insurance). Adds to amounts. */
  pctOfCapexPerAnnum?: number;
}

export type InstrumentKind = "debt" | "grant" | "equity";
export type RepaymentProfile = "bullet" | "linear" | "annuity";

export interface Instrument {
  id: string;
  kind: InstrumentKind;
  label: string;
  /** Principal / grant amount / equity ticket, EUR. */
  amount: number;
  /** Period index of drawdown (debt/equity) or collection (grant). */
  drawPeriod: number;
  /** Debt only. Annual nominal interest rate, e.g. 0.06. */
  rate?: number;
  /** Debt only. Interest-only months before principal amortisation begins. */
  graceMonths?: number;
  /** Debt only. Total months from drawdown to full repayment. */
  tenorMonths?: number;
  repayment?: RepaymentProfile;
  /** Debt only. Upfront arrangement fee as a fraction of principal, expensed at drawdown. */
  upfrontFeePct?: number;
}

export interface GlobalParameters {
  /** First period of the plan, e.g. "2027-01". */
  startMonth: string;
  /** Period index at which the plant starts operations (depreciation begins). */
  opsStartPeriod: number;
  /** Corporate income tax rate, e.g. 0.25. */
  citr: number;
  /** Days sales outstanding / days payable outstanding, applied per year. */
  dso: number;
  dpo: number;
  /** Manual working capital adjustment per period (positive = cash inflow). */
  otherWorkingCapital: number[];
  /** Discount rates. */
  wacc: number;
  costOfEquity: number;
  /** Terminal value: exit EV/EBITDA multiple applied to final-year EBITDA. */
  exitMultiple: number;
  /** Opening cash at period 0. */
  openingCash: number;
  /** Annual escalation applied to OPEX categories, e.g. 0.02. Year 1 is the base. */
  opexInflation: number;
  /** Annual escalation applied to personnel cost per FTE. Year 1 is the base. */
  compensationInflation: number;
}

export interface ScenarioInputs {
  name: string;
  parameters: GlobalParameters;
  /** Group-level cash flow overlay. Optional so older saved scenarios still load. */
  group?: import("./group").GroupInputs;
  capex: CapexLine[];
  unitEconomics: UnitEconomics;
  personnel: PersonnelArchetype[];
  opex: OpexCategory[];
  instruments: Instrument[];
}

/** A period in the grid: 36 monthly then 7 annual. */
export interface Period {
  index: number;
  label: string;
  /** Number of months the period represents (1 for monthly, 12 for annual). */
  months: number;
  /** Year number of the plan, 1-based. */
  year: number;
  /** Whether this period is presented monthly. */
  monthly: boolean;
  /** Year fraction at period end, from plan start, used for discounting. */
  yearsAtEnd: number;
}

export interface PeriodResult {
  // Volume
  tons: number;
  utilisation: number;
  /** Nameplate capacity in force for this period, t/y. Varies with the yearly drivers. */
  nameplateTonsPerYear: number;
  // P&L
  revenue: number;
  cogsEnergy: number;
  cogsMts: number;
  cogsReactants: number;
  cogsResidue: number;
  cogsWater: number;
  cogsMaintenance: number;
  cogs: number;
  grossMargin: number;
  opexPersonnel: number;
  opexOther: number;
  opexTotal: number;
  ebitda: number;
  depreciation: number;
  ebit: number;
  interestExpense: number;
  grantIncome: number;
  pbt: number;
  tax: number;
  netIncome: number;
  // Cash flow
  deltaAr: number;
  deltaAp: number;
  otherWc: number;
  cfo: number;
  capexSpend: number;
  cfi: number;
  debtDraw: number;
  debtRepayment: number;
  equityRaise: number;
  grantCash: number;
  cff: number;
  netCashFlow: number;
  openingCash: number;
  closingCash: number;
  // Balances
  capexCumulative: number;
  debtBalance: number;
  nolBalance: number;
  ar: number;
  ap: number;
  // Valuation flows
  projectFcf: number;
  equityFcf: number;
}

export interface ValuationResult {
  terminalValueEnterprise: number;
  terminalValueEquity: number;
  netDebtAtExit: number;
  projectIrr: number | null;
  projectNpv: number;
  equityIrr: number | null;
  equityNpv: number;
}

export interface AnnualSummaryRow {
  year: number;
  label: string;
  revenue: number;
  cogs: number;
  grossMargin: number;
  opexTotal: number;
  ebitda: number;
  depreciation: number;
  ebit: number;
  interestExpense: number;
  grantIncome: number;
  pbt: number;
  tax: number;
  netIncome: number;
  cfo: number;
  cfi: number;
  cff: number;
  netCashFlow: number;
  closingCash: number;
}

export interface ModelOutputs {
  periods: Period[];
  results: PeriodResult[];
  /** Cumulative YTD within each monthly plan year (index-aligned with the monthly periods). */
  ytd: PeriodResult[];
  annual: AnnualSummaryRow[];
  valuation: ValuationResult;
  warnings: string[];
  /** CAPEX spend per period, keyed by concept id. Drives the stacked cover chart. */
  capexByConcept: Record<string, number[]>;
}

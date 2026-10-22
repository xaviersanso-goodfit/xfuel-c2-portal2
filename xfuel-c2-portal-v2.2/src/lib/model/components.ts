/**
 * Revenue, COGS and OPEX as editable component lists.
 *
 * Version 1 hardcoded sixteen named unit-economics drivers. That made the model
 * easy to verify and impossible to extend: adding a COGS line meant changing the
 * type, the engine, the interface and the Excel export together. Here the three
 * blocks are arrays of components instead, each carrying its own name,
 * description and calculation basis, so a user can add a line without anyone
 * touching the code.
 *
 * Every component keeps a stable `id`. The id, not the name, is what the
 * changelog, the Excel round trip and scenario comparison key on, so renaming
 * "Water" to "H2O" is a cosmetic change and not a new line item.
 */

export const DESCRIPTION_MAX = 150;

/** How a COGS or revenue component turns yearly inputs into a period amount. */
export type ComponentBasis =
  /** quantity (units per operating hour) x unitCost (per 1,000 units). Feedstock, reactants. */
  | "perHour"
  /** quantity (kWh per operating hour) x unitCost (per kWh). Electricity, heat. */
  | "perKwh"
  /** unitCost per ton of product sold. quantity is ignored. */
  | "perTon"
  /** quantity as a fraction per annum of cumulative deployed CAPEX. unitCost ignored. */
  | "pctOfCapex"
  /** unitCost as an absolute amount for the year. quantity ignored. */
  | "fixedAnnual";

export const BASIS_LABELS: Record<ComponentBasis, string> = {
  perHour: "Per operating hour",
  perKwh: "Per kWh",
  perTon: "Per ton of product",
  pctOfCapex: "% p.a. of deployed CAPEX",
  fixedAnnual: "Fixed annual amount",
};

/** Which of the two yearly series a basis actually reads. */
export const BASIS_USES: Record<ComponentBasis, { quantity: boolean; unitCost: boolean }> = {
  perHour: { quantity: true, unitCost: true },
  perKwh: { quantity: true, unitCost: true },
  perTon: { quantity: false, unitCost: true },
  pctOfCapex: { quantity: true, unitCost: false },
  fixedAnnual: { quantity: false, unitCost: true },
};

/** Column headings for the two series, which differ by basis. */
export const BASIS_FIELD_LABELS: Record<ComponentBasis, { quantity: string; unitCost: string }> = {
  perHour: { quantity: "Quantity (kg/h)", unitCost: "Unit cost (per ton)" },
  perKwh: { quantity: "Consumption (kWh/h)", unitCost: "Price (per kWh)" },
  perTon: { quantity: "", unitCost: "Amount per ton" },
  pctOfCapex: { quantity: "% p.a. of CAPEX", unitCost: "" },
  fixedAnnual: { quantity: "", unitCost: "Amount per year" },
};

/** A component of revenue, COGS or OPEX. Yearly series are TOTAL_YEARS long. */
export interface ModelComponent {
  id: string;
  name: string;
  /** Free text, capped at DESCRIPTION_MAX characters. */
  description: string;
  basis: ComponentBasis;
  /** First yearly series. Meaning depends on the basis; see BASIS_FIELD_LABELS. */
  quantity: number[];
  /** Second yearly series. */
  unitCost: number[];
  /**
   * Revenue only. Whether the sustainable premium multiplier applies to this
   * stream. A by-product sold at commodity prices should be false.
   */
  premiumEligible?: boolean;
  /**
   * Revenue only. Product yield in kg per operating hour, which sets the tons
   * this stream sells. The first revenue component is the primary product and
   * its yield drives nameplate capacity.
   */
  yieldKgPerHour?: number[];
}

/** Everything the plant produces. */
export interface RevenueComponent extends ModelComponent {
  premiumEligible: boolean;
  yieldKgPerHour: number[];
}

export const REVENUE_BASES: ComponentBasis[] = ["perTon", "fixedAnnual"];
export const COGS_BASES: ComponentBasis[] = ["perHour", "perKwh", "perTon", "pctOfCapex", "fixedAnnual"];
export const OPEX_BASES: ComponentBasis[] = ["fixedAnnual", "pctOfCapex", "perTon"];

/** Trim a description to the documented limit. */
export function clampDescription(s: string | undefined): string {
  return (s ?? "").slice(0, DESCRIPTION_MAX);
}

/** A fresh component of the given kind, ready to be appended to a list. */
export function newComponent(
  kind: "revenue" | "cogs" | "opex",
  years: number,
  seq: number
): ModelComponent {
  const zeros = () => new Array(years).fill(0);
  const basis: ComponentBasis = kind === "cogs" ? "perTon" : kind === "revenue" ? "perTon" : "fixedAnnual";
  const base: ModelComponent = {
    id: `${kind}_${Date.now()}_${seq}`,
    name: kind === "revenue" ? "New revenue line" : kind === "cogs" ? "New COGS line" : "New OPEX line",
    description: "",
    basis,
    quantity: zeros(),
    unitCost: zeros(),
  };
  if (kind === "revenue") {
    base.premiumEligible = false;
    base.yieldKgPerHour = zeros();
  }
  return base;
}

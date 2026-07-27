/**
 * Build marker, shown in the portal header.
 *
 * Exists so that "is the deployed site running the code I just uploaded?" is a
 * question you can answer by looking at the screen, rather than by inspecting
 * the Vercel dashboard or guessing from which features appear.
 *
 * Bump this whenever a build is handed over.
 */
export const BUILD = "2026-07-27g";

/** What landed in this build. Shown on hover of the version chip. */
export const BUILD_NOTES = [
  "Unit economics by plan year (Y1-Y10)",
  "OPEX and compensation inflation",
  "IRR/NPV panel with definitions",
  "36-month cover chart, PNG export",
  "Short-input-series fix",
  "Legacy workbook import fix",
  "Inflation shown on the OPEX tab",
  "XFuel total: group cash flow and bridge",
  "Waterfall: logo and larger type",
].join(" · ");

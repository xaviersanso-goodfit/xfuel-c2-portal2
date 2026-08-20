/**
 * Build marker, shown in the portal header.
 *
 * Exists so that "is the deployed site running the code I just uploaded?" is a
 * question you can answer by looking at the screen, rather than by inspecting
 * the Vercel dashboard or guessing from which features appear.
 *
 * Bump this whenever a build is handed over.
 */
export const BUILD = "2026-08-20-v2";

/** What landed in this build. Shown on hover of the version chip. */
export const BUILD_NOTES = [
  "v2: every line renamable, with a description",
  "Add and remove revenue, COGS and OPEX lines",
  "Five calculation bases per line",
  "Revenue and COGS inflation",
  "Sustainable premium, split out in margin",
  "Horizon extended to 20 years",
  "Insurance is a fixed amount, not a % of CAPEX",
  "Changelog: who changed what, when",
].join(" · ");

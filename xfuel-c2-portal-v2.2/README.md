# XFuel — C2 Tarragona project portal

Financial planning portal for the C2 sustainable fuel FOAK plant. Next.js on Vercel, Supabase for storage and auth, with a deterministic calculation engine and a formula-preserving Excel export.

## What it does

Enter the plan drivers and the model builds itself:

- **CAPEX** by concept (ISBL, OSBL, Other, Land): total cost, start month, month-by-month percentage phasing. Feeds the investing cash flow. Each concept depreciates at its own monthly rate, starting the month operations begin. Land is not depreciated.
- **Unit economics**: price per ton, hourly throughput (MGO yield, MTS, reactants, residue), input costs, energy, maintenance as a percentage of deployed CAPEX, and capacity utilisation per period. Drives revenue and COGS.
- **OPEX and personnel**: archetypes with a fully loaded annual cost per FTE and FTEs per period (decimals allowed), plus other categories with fixed amounts and optional percentage-of-CAPEX components. Gets you to EBITDA.
- **Financing**: debt, grants and equity. Debt drives the financing cash flow and the interest charge below EBITDA, with grace, tenor and linear/annuity/bullet amortisation. Grants are recognised as income below EBITDA when collected, with their cash shown in financing.
- **Tax**: loss carry-forward. No tax while cumulative losses remain; once exhausted, the CITR applies.
- **Cash flow**: EBITDA to CFO through DSO and DPO plus a manual other-working-capital line. CFI from CAPEX, CFF from the instruments.
- **Returns**: project (unlevered) and equity (levered) IRR and NPV, with a terminal value at the end of Y10 based on an exit EV/EBITDA multiple. Equity terminal value is enterprise value less net debt at exit.

Horizon: monthly for Y1 to Y3, annual for Y4 to Y10. Unit-economics drivers (price, throughput, input costs, energy) are set per plan year; OPEX and compensation escalate at their own inflation rates, compounding from year 1. The monthly P&L and cash flow roll into a YTD view (toggle on the P&L and Cash flow tabs). The Global parameters tab carries the annual summary P&L and cash flow.

## Deploy

**See `DEPLOY.md` for a click-by-click walkthrough** (about 30 minutes, no prior deployment experience assumed). The summary below is for reference.

### 1. Supabase

1. Create a project at supabase.com.
2. SQL Editor → paste `supabase/schema.sql` → Run. This creates the tables, the sign-up trigger and the row-level-security policies.
3. Project Settings → API: copy the Project URL and the `anon` public key.
4. After your first sign-in, promote yourself to editor:

   ```sql
   update public.profiles set role = 'editor' where email = 'you@xfuel.com';
   ```

### 2. Vercel

1. Push this folder to a Git repo and import it in Vercel (framework auto-detects as Next.js).
2. Add two environment variables:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
   ```

3. Deploy.

Locally: `cp .env.example .env.local`, fill in the same two values, then `npm install && npm run dev`.

Without those variables the portal still runs, storing scenarios in the browser only, so you can try it before wiring the backend.

## Access control

Two roles, enforced in the database by row-level security rather than in the UI:

- **editor** — full read and write on scenarios and commentary.
- **viewer** — read only. New sign-ups default to viewer; promote in SQL as above.

## Excel

**Download model (.xlsx)** produces a live workbook. The P&L, Cashflow and Summary tabs are real Excel formulas referencing the Parameters, CAPEX, UnitEcon, OPEX and Financing input tabs, so editing an input in Excel recalculates the model there. This is verified: the exported workbook is recalculated in a spreadsheet engine and compared against the portal engine cell by cell, and every line matches to the cent.

Two things are exported as values rather than formulas, and are labelled as such in the workbook:

- Debt amortisation schedules, because monthly amortisation with grace and a repayment profile cannot be expressed as one row of formulas.
- IRR and NPV, because the period-weighted discounting across mixed monthly and annual periods cannot be expressed in a single cell.

**Upload model (.xlsx)** reads the input tabs back into the working scenario. Calculated rows are ignored and recomputed, so a workbook edited in Excel round-trips cleanly.

## Verification

```bash
npm install
npm test          # runs all four suites plus the typecheck
npm run build
```

297 checks across four suites:

| Suite | Checks | What it proves |
|---|---|---|
| `npm run verify` | 77 | Engine invariants and known answers: period grid, CAPEX phasing, depreciation capped at cost, revenue and COGS cross-checked against the FAIIP formulas, debt amortisation on all three profiles (incl. zero-rate and maturities beyond the horizon), NOL behaviour, cash roll-forward, CFO+CFI+CFF reconciliation, IRR/NPV known answers, YTD and annual rollups, degenerate inputs. |
| `npm run sensitivity` | 113 | **Every input actually drives the outputs.** Each field is perturbed and the outputs that should move are asserted to move, and those that should not are asserted to stay put (e.g. WACC moves project NPV but not project IRR; grant income moves PBT but not EBITDA). Includes end-to-end chains: CAPEX to depreciation, maintenance, insurance, EBITDA, CFI, cash and IRR. |
| `npm run roundtrip` | 20 | Excel export to import to re-run reproduces every period to the cent, and an edit made in the workbook is picked up. |
| `npm run ui` | 87 | **The screen is wired to the engine.** Every tab is rendered in a real DOM, every input is typed into, and the change is asserted to reach the scenario object and change the computed model. Also asserts read-only sessions cannot edit. |

Identity checks alone (EBITDA = gross margin − OPEX) would pass even if an input were silently disconnected, which is why the sensitivity and UI suites exist: they are the ones that catch a dead field.

The exported workbook is additionally recalculated in LibreOffice and compared cell by cell against the engine; all fifteen tested lines match to 0.000000.

## Seed data

The base case is seeded from the two source files:

- CAPEX totals from `C2_Tarragona_CAPEX_integrated_260724 (5.1 DDIB - 30Jun Ditecsa)`, CAPEX Summary tab: ISBL 13,699,966; OSBL 9,578,612 plus land 1,375,000; Overheads 2,582,095. Grand total 27,235,672.
- Unit economics, OPEX and personnel from `Business model FAIIP (v20260515)`: 1,840 kg/h MGO on 8,000 hours (14,720 t/y nameplate), price 688.85 EUR/t, and the seven personnel archetypes totalling 19.6 FTE.

Assumptions I chose because the source files did not fix them, all editable in the portal: the construction phasing S-curve, depreciation rates (ISBL 15 years, OSBL 25 years, Other 10 years), the operations start month, the utilisation ramp, and the financing stack. Treat these as placeholders to replace with your own.

## Branding

The palette lives in the `:root` block of `src/app/globals.css`. Set `--brand`, `--brand-dark` and `--brand-accent` to the exact corporate hex codes. `src/components/Logo.tsx` renders an SVG wordmark; drop the official asset in `public/` and swap the component body to use it.

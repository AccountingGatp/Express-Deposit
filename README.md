# Express Text — Authorize.net Sales Entry

A small web app that turns the monthly **Authorize.net** transaction export into a
QuickBooks-ready **sales-entry workbook** for Express Text's QuickBooks Online file.

Drop in the tab-delimited `.txt` download for a month and the app:

1. Counts a row as a sale only when **Response Code = `1` (Approved)** *and*
   **Action Code = `AUTH_CAPTURE`**.
2. Excludes everything else and shows the breakdown — declined/error rows
   (Response Code ≠ 1), plus approved-but-uncaptured **EXPIRED** `$1.00`
   card-verification auths, **AUTH_ONLY**, and **VOID** rows.
3. Derives the reporting period, the entry date, and the memo date range from the
   actual capture transaction dates (including captures from the last evening of
   the prior month, after batch cut-off).
4. Generates **`Authorize_Sales_Entry_<Month>_<Year>.xlsx`** for download.

Everything runs in the browser — the export file is never uploaded to a server.

## The generated workbook

Matches Express Text's bookkeeping SOP exactly:

- **`Sales Data`** — the export loaded as-is (all rows, all columns) with a
  formula-driven totals block below it:
  - `Total (all rows in file)` = `SUM` of the Total Amount column
  - `Total Sales (Response Code 1 + AUTH_CAPTURE)` =
    `SUMIFS` where Response Code = `1` and Action Code = `AUTH_CAPTURE`
  - `Excluded (not approved / not captured)` = the difference of the two
  - a plain-language cell comment explaining the exclusion
- **`Entry`** — the QuickBooks sales-receipt view (Client `Authorize.net`,
  Deposit to `1080- Authorize Clearing`, Product/Service `PAYG`, Qty `1`). The
  **Rate** is a live link to the `Total Sales` cell — never a hardcoded number —
  and **Amount** = `Quantity × Rate`.
- **`SaasAnt Import`** — a one-row Sales Receipt import
  (`Sales Receipt No: AUTH-<MonYYYY>`) with Rate and Amount linked to the same total.

Formatting throughout: Arial, navy `#1F3864` headers with white bold text,
alternating `#D9E1F2` row fills, frozen header row, no gridlines, amounts
`#,##0.00`, dates `mm/dd/yyyy`. All totals are live formulas.

## Run locally

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build into dist/
npm run preview  # preview the production build
```

## Deploy

The app is a static Vite build. Any static host works. On **Vercel**, the
included `vercel.json` uses `npm run build` with `dist/` as the output directory.

## Tech

- [Vite](https://vitejs.dev/) — build tooling
- [ExcelJS](https://github.com/exceljs/exceljs) — `.xlsx` generation with
  styling, formulas, cell comments, frozen panes
- Vanilla JS — no framework

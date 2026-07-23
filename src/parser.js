// Parses an Authorize.net monthly transaction export (tab-delimited .txt)
// and derives every figure the QuickBooks sales entry needs.
//
// Business rules (Express Text bookkeeping SOP):
//   1. Only transactions with Response Code "1" (Approved) are included in the
//      working. Every other response code (2 Declined, 3 Error, 4 Held, blank)
//      is excluded because the transaction was not approved.
//   2. Among the approved rows, only AUTH_CAPTURE rows are real, collected
//      sales. Approved EXPIRED ($1.00 card-verification auths), AUTH_ONLY and
//      VOID rows are excluded because no money was actually collected on them.
//
//   => A row counts as a sale only when Response Code = "1" AND
//      Action Code = "AUTH_CAPTURE".

export const SALES_ACTION_CODE = 'AUTH_CAPTURE';
export const APPROVED_RESPONSE_CODE = '1';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MON_ABBR = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Human-readable names for Authorize.net response codes.
const RESPONSE_NAMES = {
  1: 'Approved',
  2: 'Declined',
  3: 'Error',
  4: 'Held for Review',
};

// Parse "01-May-2026 09:33:43 AM MDT" -> Date (local, time zone label ignored).
export function parseSubmitDate(value) {
  if (!value) return null;
  const m = String(value)
    .trim()
    .match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?/i);
  if (!m) return null;
  const [, d, monRaw, y, hhRaw, mm, ss, ap] = m;
  const mon = MON_ABBR[monRaw.toLowerCase()];
  if (mon === undefined) return null;
  let hh = parseInt(hhRaw, 10);
  if (ap) {
    const upper = ap.toUpperCase();
    if (upper === 'PM' && hh < 12) hh += 12;
    if (upper === 'AM' && hh === 12) hh = 0;
  }
  return new Date(+y, mon, +d, hh, +mm, +ss);
}

function toNumber(value) {
  if (value == null) return NaN;
  const cleaned = String(value).replace(/[$,\s]/g, '');
  if (cleaned === '') return NaN;
  return Number(cleaned);
}

export function formatDate(date) {
  if (!date) return '';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getFullYear()}`;
}

// Split tab-delimited text into a matrix of rows. Handles \r\n and trailing
// blank lines. Authorize.net exports are plain tab-delimited without quoting.
function splitRows(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line, i, arr) => line.length > 0 || i < arr.length - 1)
    .map((line) => line.split('\t'));
}

function findColumn(header, candidates) {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const name of candidates) {
    const idx = lower.indexOf(name.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

// Determine the reporting period from the sale dates: the calendar month that
// most sales fall in. (The file may include a few captures from the last
// evening of the prior month, after batch cut-off.)
function derivePeriod(saleDates) {
  const counts = new Map();
  for (const d of saleDates) {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = key;
    }
  }
  const [year, month] = best.split('-').map(Number);
  const lastDay = new Date(year, month + 1, 0); // last calendar day of month
  return {
    month, // 0-based
    year,
    monthName: MONTHS[month],
    monthAbbr: MONTHS[month].slice(0, 3),
    lastDate: lastDay,
  };
}

// Why a given row is excluded from sales.
function excludeReason(responseCode, actionCode) {
  if (responseCode !== APPROVED_RESPONSE_CODE) {
    const name = RESPONSE_NAMES[responseCode] || 'Not approved';
    return `Response Code ${responseCode || '(blank)'} — ${name}`;
  }
  // Approved, but not a captured sale.
  const map = {
    EXPIRED: 'EXPIRED — $1.00 card-verification auth',
    AUTH_ONLY: 'AUTH_ONLY — authorized, not captured',
    VOID: 'VOID — cancelled',
  };
  return map[actionCode] || (actionCode ? actionCode : '(blank action code)');
}

export function parseSales(text) {
  const matrix = splitRows(text);
  if (matrix.length < 2) {
    throw new Error('File appears to be empty or is not a valid Authorize.net export.');
  }

  const header = matrix[0];
  const responseIdx = findColumn(header, ['Response Code']);
  const actionIdx = findColumn(header, ['Action Code']);
  const amountIdx = findColumn(header, ['Total Amount', 'Settle Amount', 'Amount']);
  const dateIdx = findColumn(header, ['Submit Date/Time', 'Submit Date', 'Transaction Date']);

  if (responseIdx === -1 || actionIdx === -1 || amountIdx === -1) {
    throw new Error(
      'Could not find the required "Response Code", "Action Code" and ' +
        '"Total Amount" columns. Is this an Authorize.net transaction export?'
    );
  }

  const dataRows = matrix.slice(1);
  const rows = dataRows.map((cells) => ({
    cells,
    responseCode: (cells[responseIdx] || '').trim(),
    actionCode: (cells[actionIdx] || '').trim(),
    amount: toNumber(cells[amountIdx]),
    date: dateIdx !== -1 ? parseSubmitDate(cells[dateIdx]) : null,
  }));

  const isSale = (r) =>
    r.responseCode === APPROVED_RESPONSE_CODE && r.actionCode === SALES_ACTION_CODE;

  const saleRows = rows.filter(isSale);
  const excludedRows = rows.filter((r) => !isSale(r));

  const sum = (list) => list.reduce((acc, r) => acc + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  const totalAll = sum(rows);
  const totalSales = sum(saleRows);
  const totalExcluded = totalAll - totalSales;

  // Excluded rows grouped by reason, e.g. "Response Code 2 — Declined".
  const groups = new Map();
  for (const r of excludedRows) {
    const reason = excludeReason(r.responseCode, r.actionCode);
    const g = groups.get(reason) || { reason, rows: 0, amount: 0 };
    g.rows += 1;
    g.amount += Number.isFinite(r.amount) ? r.amount : 0;
    groups.set(reason, g);
  }
  const excludedBreakdown = [...groups.values()].sort((a, b) => b.amount - a.amount || b.rows - a.rows);

  const saleDates = saleRows.map((r) => r.date).filter(Boolean).sort((a, b) => a - b);
  const firstSale = saleDates[0] || null;
  const lastSale = saleDates[saleDates.length - 1] || null;
  const period = saleDates.length ? derivePeriod(saleDates) : null;

  const memo =
    firstSale && lastSale
      ? `Sales for the period ${formatDate(firstSale)} to ${formatDate(lastSale)}`
      : 'Sales for the period';

  return {
    header,
    rows,
    columns: { responseIdx, actionIdx, amountIdx, dateIdx },
    counts: {
      total: rows.length,
      sales: saleRows.length,
      excluded: excludedRows.length,
    },
    totals: {
      totalAll,
      totalSales,
      totalExcluded,
    },
    excludedBreakdown,
    dates: { firstSale, lastSale },
    period,
    memo,
  };
}

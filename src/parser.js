// Parses an Authorize.net monthly transaction export (tab-delimited .txt)
// and derives every figure the QuickBooks sales entry needs.
//
// Business rule (from Express Text's bookkeeping SOP):
//   Only AUTH_CAPTURE rows are real, collected sales.
//   EXPIRED ($1.00 card-verification auths), AUTH_ONLY and VOID rows are
//   excluded because no money was actually collected on them.

export const SALES_ACTION_CODE = 'AUTH_CAPTURE';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MON_ABBR = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
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

// Determine the reporting period from the AUTH_CAPTURE dates: the calendar
// month that most captures fall in. (The file may include a few captures from
// the last evening of the prior month, after batch cut-off.)
function derivePeriod(captureDates) {
  const counts = new Map();
  for (const d of captureDates) {
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

export function parseSales(text) {
  const matrix = splitRows(text);
  if (matrix.length < 2) {
    throw new Error('File appears to be empty or is not a valid Authorize.net export.');
  }

  const header = matrix[0];
  const actionIdx = findColumn(header, ['Action Code']);
  const amountIdx = findColumn(header, ['Total Amount', 'Settle Amount', 'Amount']);
  const dateIdx = findColumn(header, ['Submit Date/Time', 'Submit Date', 'Transaction Date']);

  if (actionIdx === -1 || amountIdx === -1) {
    throw new Error(
      'Could not find the required "Action Code" and "Total Amount" columns. ' +
        'Is this an Authorize.net transaction export?'
    );
  }

  const dataRows = matrix.slice(1);
  const rows = dataRows.map((cells) => ({
    cells,
    actionCode: (cells[actionIdx] || '').trim(),
    amount: toNumber(cells[amountIdx]),
    date: dateIdx !== -1 ? parseSubmitDate(cells[dateIdx]) : null,
  }));

  const captureRows = rows.filter((r) => r.actionCode === SALES_ACTION_CODE);
  const excludedRows = rows.filter((r) => r.actionCode !== SALES_ACTION_CODE);

  const sum = (list) => list.reduce((acc, r) => acc + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  const totalAll = sum(rows);
  const totalSales = sum(captureRows);
  const totalExcluded = totalAll - totalSales;

  // Breakdown of excluded rows by action code, e.g. { EXPIRED: 45, AUTH_ONLY: 6, VOID: 1 }
  const excludedBreakdown = {};
  for (const r of excludedRows) {
    const key = r.actionCode || '(blank)';
    excludedBreakdown[key] = (excludedBreakdown[key] || 0) + 1;
  }

  const captureDates = captureRows.map((r) => r.date).filter(Boolean).sort((a, b) => a - b);
  const firstSale = captureDates[0] || null;
  const lastSale = captureDates[captureDates.length - 1] || null;
  const period = captureDates.length ? derivePeriod(captureDates) : null;

  const memo =
    firstSale && lastSale
      ? `Sales for the period ${formatDate(firstSale)} to ${formatDate(lastSale)}`
      : 'Sales for the period';

  return {
    header,
    rows,
    columns: { actionIdx, amountIdx, dateIdx },
    counts: {
      total: rows.length,
      capture: captureRows.length,
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

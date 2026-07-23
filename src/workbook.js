// Builds the "Authorize_Sales_Entry_<Month>_<Year>.xlsx" workbook with the
// three sheets described in Express Text's SOP:
//   1. "Sales Data"     - the export loaded as-is + a formula-driven totals block
//   2. "Entry"          - QuickBooks sales-receipt view, Rate linked to the total
//   3. "SaasAnt Import" - a one-row Sales Receipt import for SaasAnt
//
// All totals are live formulas (never hardcoded numbers). Styling: Arial,
// navy (#1F3864) headers with white bold text, alternating #D9E1F2 fills,
// frozen header row, no gridlines.

import ExcelJS from 'exceljs';

const NAVY = 'FF1F3864';
const BAND = 'FFD9E1F2';
const WHITE = 'FFFFFFFF';
const MONEY_FMT = '#,##0.00';
const DATE_FMT = 'mm/dd/yyyy';
const ARIAL = { name: 'Arial', size: 10 };

function colLetter(index0) {
  // 0-based column index -> Excel column letter (0 -> A)
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function headerStyle(cell) {
  cell.font = { ...ARIAL, bold: true, color: { argb: WHITE } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  cell.alignment = { vertical: 'middle' };
}

function bandFill(cell) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
}

export function buildWorkbook(parsed) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Express Text Sales';
  wb.created = parsed.period ? parsed.period.lastDate : new Date(2026, 0, 1);

  const { header, rows, columns, totals, memo, period, dates } = parsed;
  const amountCol = colLetter(columns.amountIdx);
  const actionCol = colLetter(columns.actionIdx);
  const responseCol = colLetter(columns.responseIdx);
  const nCols = header.length;

  // ---------------------------------------------------------------- Sales Data
  const sd = wb.addWorksheet('Sales Data', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  });

  // Header row (as-is column names)
  const headerRow = sd.getRow(1);
  header.forEach((name, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = name;
    headerStyle(cell);
  });
  headerRow.commit();

  // Data rows, exactly as-is. Total Amount stored as a number so SUM works;
  // everything else kept as the raw string from the export.
  rows.forEach((r, ri) => {
    const excelRow = sd.getRow(ri + 2);
    const banded = ri % 2 === 1;
    for (let c = 0; c < nCols; c++) {
      const cell = excelRow.getCell(c + 1);
      if (c === columns.amountIdx && Number.isFinite(r.amount)) {
        cell.value = r.amount;
        cell.numFmt = MONEY_FMT;
      } else {
        cell.value = r.cells[c] !== undefined ? r.cells[c] : '';
      }
      cell.font = ARIAL;
      if (banded) bandFill(cell);
    }
    excelRow.commit();
  });

  const dataStart = 2;
  const dataEnd = rows.length + 1;
  const range = `${amountCol}${dataStart}:${amountCol}${dataEnd}`;
  const actionRange = `${actionCol}${dataStart}:${actionCol}${dataEnd}`;
  const responseRange = `${responseCol}${dataStart}:${responseCol}${dataEnd}`;

  // Totals block below the data
  const blockStart = dataEnd + 2;
  const totalAllRow = blockStart;
  const totalSalesRow = blockStart + 1;
  const excludedRow = blockStart + 2;

  const writeTotal = (rowIdx, label, formula, result) => {
    const labelCell = sd.getCell(`A${rowIdx}`);
    labelCell.value = label;
    labelCell.font = { ...ARIAL, bold: true };
    const valueCell = sd.getCell(`${amountCol}${rowIdx}`);
    valueCell.value = { formula, result };
    valueCell.numFmt = MONEY_FMT;
    valueCell.font = { ...ARIAL, bold: true };
    return valueCell;
  };

  writeTotal(
    totalAllRow,
    'Total (all rows in file)',
    `SUM(${range})`,
    totals.totalAll
  );
  const salesCell = writeTotal(
    totalSalesRow,
    'Total Sales (Response Code 1 + AUTH_CAPTURE)',
    `SUMIFS(${range},${responseRange},"1",${actionRange},"AUTH_CAPTURE")`,
    totals.totalSales
  );
  writeTotal(
    excludedRow,
    'Excluded (not approved / not captured)',
    `${amountCol}${totalAllRow}-${amountCol}${totalSalesRow}`,
    totals.totalExcluded
  );

  // Plain-language cell comment explaining the exclusion
  sd.getCell(`A${totalSalesRow}`).note = {
    texts: [
      {
        text:
          'Sales counts only rows where Response Code = 1 (Approved) AND ' +
          'Action Code = AUTH_CAPTURE (money actually collected). ' +
          'Everything else is left out: declined/error rows (Response Code not 1), ' +
          'plus approved EXPIRED $1.00 card-check auths, AUTH_ONLY, and VOID rows.',
      },
    ],
  };

  // Reasonable column widths (date + a few key columns wider)
  sd.columns.forEach((col, i) => {
    if (i === columns.dateIdx) col.width = 26;
    else if (i === columns.amountIdx) col.width = 14;
    else col.width = Math.min(Math.max((header[i] || '').length + 2, 10), 22);
  });

  const salesRef = `'Sales Data'!${amountCol}${totalSalesRow}`;

  // -------------------------------------------------------------------- Entry
  const entry = wb.addWorksheet('Entry', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  });
  entry.columns = [{ width: 22 }, { width: 46 }];

  const eHead = entry.getRow(1);
  eHead.getCell(1).value = 'Field';
  eHead.getCell(2).value = 'Value';
  headerStyle(eHead.getCell(1));
  headerStyle(eHead.getCell(2));
  eHead.commit();

  const entryFields = [
    ['Client', 'Authorize.net'],
    ['Date', period ? period.lastDate : null, 'date'],
    ['Deposit to', '1080- Authorize Clearing'],
    ['Product/Service', 'PAYG'],
    ['Description', memo],
    ['Memo', memo],
    ['Quantity', 1],
    ['Rate', { formula: salesRef, result: totals.totalSales }, 'money'],
    ['Amount', null, 'amountFormula'],
  ];

  let qtyRowIdx = null;
  let rateRowIdx = null;
  entryFields.forEach((field, i) => {
    const rowIdx = i + 2;
    if (field[0] === 'Quantity') qtyRowIdx = rowIdx;
    if (field[0] === 'Rate') rateRowIdx = rowIdx;
    const labelCell = entry.getCell(`A${rowIdx}`);
    const valueCell = entry.getCell(`B${rowIdx}`);
    labelCell.value = field[0];
    labelCell.font = { ...ARIAL, bold: true };
    bandFill(labelCell);
    valueCell.font = ARIAL;

    const type = field[2];
    if (type === 'date') {
      valueCell.value = field[1];
      valueCell.numFmt = DATE_FMT;
    } else if (type === 'money') {
      valueCell.value = field[1];
      valueCell.numFmt = MONEY_FMT;
    } else if (type === 'amountFormula') {
      valueCell.value = {
        formula: `B${qtyRowIdx}*B${rateRowIdx}`,
        result: totals.totalSales,
      };
      valueCell.numFmt = MONEY_FMT;
    } else {
      valueCell.value = field[1];
    }
  });

  // ------------------------------------------------------------- SaasAnt Import
  const saas = wb.addWorksheet('SaasAnt Import', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  });
  const saasCols = [
    'Sales Receipt No',
    'Customer',
    'Sales Receipt Date',
    'Deposit To',
    'Product/Service',
    'Description',
    'Qty',
    'Rate',
    'Amount',
    'Memo',
  ];
  saas.columns = saasCols.map((name) => {
    if (name === 'Description' || name === 'Memo') return { width: 40 };
    if (name === 'Sales Receipt Date' || name === 'Sales Receipt No') return { width: 18 };
    return { width: 18 };
  });

  const sHead = saas.getRow(1);
  saasCols.forEach((name, i) => {
    const cell = sHead.getCell(i + 1);
    cell.value = name;
    headerStyle(cell);
  });
  sHead.commit();

  const receiptNo = period ? `AUTH-${period.monthAbbr}${period.year}` : 'AUTH-';
  const dataRow = saas.getRow(2);
  const saasValues = [
    receiptNo,
    'Authorize.net',
    period ? period.lastDate : null,
    '1080- Authorize Clearing',
    'PAYG',
    memo,
    1,
    { formula: salesRef, result: totals.totalSales },
    { formula: salesRef, result: totals.totalSales },
    memo,
  ];
  saasValues.forEach((v, i) => {
    const cell = dataRow.getCell(i + 1);
    cell.value = v;
    cell.font = ARIAL;
    const name = saasCols[i];
    if (name === 'Sales Receipt Date') cell.numFmt = DATE_FMT;
    if (name === 'Rate' || name === 'Amount') cell.numFmt = MONEY_FMT;
  });
  dataRow.commit();

  return wb;
}

export function workbookFilename(parsed) {
  if (!parsed.period) return 'Authorize_Sales_Entry.xlsx';
  return `Authorize_Sales_Entry_${parsed.period.monthName}_${parsed.period.year}.xlsx`;
}

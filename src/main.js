import './styles.css';
import { parseSales, formatDate } from './parser.js';
import { buildWorkbook, workbookFilename } from './workbook.js';

const money = (n) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n) => n.toLocaleString('en-US');

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="wrap">
    <header class="app">
      <div class="logo">💳</div>
      <div>
        <h1>Express Text · Authorize.net Sales Entry</h1>
        <p>Monthly Authorize.net export → QuickBooks-ready sales workbook</p>
      </div>
    </header>
    <p class="sub">
      Upload the month's Authorize.net transaction download (tab-delimited
      <code>.txt</code>). The app totals only approved, collected sales —
      <strong>Response Code 1</strong> and <strong>AUTH_CAPTURE</strong> —
      excluding declined rows and approved-but-uncaptured EXPIRED $1.00
      card-check auths, AUTH_ONLY, and VOID rows. It builds the
      <em>Authorize_Sales_Entry</em> workbook with live formulas, the Entry
      sales-receipt, and the SaasAnt import sheet.
    </p>

    <div class="card">
      <label class="drop" id="drop">
        <input type="file" id="file" accept=".txt,.tsv,text/plain" />
        <div class="big">📄</div>
        <h2>Drop the Authorize.net export here</h2>
        <p>or click to choose a file · tab-delimited .txt</p>
        <div class="filerow hidden" id="filerow">
          <span class="pill" id="filepill"></span>
          <span id="filemeta"></span>
        </div>
      </label>
      <div class="err hidden" id="err"></div>
    </div>

    <div id="results" class="hidden"></div>

    <p class="footnote">
      All processing happens in your browser — nothing is uploaded to a server.
    </p>
  </div>
`;

const drop = document.querySelector('#drop');
const fileInput = document.querySelector('#file');
const errBox = document.querySelector('#err');
const fileRow = document.querySelector('#filerow');
const filePill = document.querySelector('#filepill');
const fileMeta = document.querySelector('#filemeta');
const results = document.querySelector('#results');

let current = null; // { parsed, filename }

function showError(msg) {
  errBox.textContent = msg;
  errBox.classList.remove('hidden');
  results.classList.add('hidden');
}
function clearError() {
  errBox.classList.add('hidden');
}

['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('hover');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove('hover');
  })
);
drop.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files?.[0];
  if (f) handleFile(f);
});
fileInput.addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) handleFile(f);
});

async function handleFile(file) {
  clearError();
  filePill.textContent = file.name;
  fileMeta.textContent = `${(file.size / 1024).toFixed(0)} KB`;
  fileRow.classList.remove('hidden');
  try {
    const text = await file.text();
    const parsed = parseSales(text);
    if (parsed.counts.sales === 0) {
      showError(
        'No approved sales were found — no rows with Response Code 1 and ' +
          'Action Code AUTH_CAPTURE.'
      );
      return;
    }
    current = { parsed, filename: workbookFilename(parsed) };
    renderResults(current);
  } catch (e) {
    console.error(e);
    showError(e.message || 'Could not read this file.');
  }
}

function renderResults({ parsed, filename }) {
  const t = parsed.totals;
  const c = parsed.counts;
  const breakdownRows = parsed.excludedBreakdown
    .map(
      (g) =>
        `<tr><td>${g.reason}</td><td class="num">${int(g.rows)}</td><td class="num">${money(g.amount)}</td></tr>`
    )
    .join('');

  const periodLabel = parsed.period
    ? `${parsed.period.monthName} ${parsed.period.year}`
    : '—';
  const lastDate = parsed.period ? formatDate(parsed.period.lastDate) : '—';
  const receiptNo = parsed.period
    ? `AUTH-${parsed.period.monthAbbr}${parsed.period.year}`
    : '—';

  results.innerHTML = `
    <div class="grid">
      <div class="stat hi">
        <div class="k">Total Sales · Response 1 + AUTH_CAPTURE</div>
        <div class="v">$${money(t.totalSales)}</div>
        <div class="note">${int(c.sales)} approved sales · used in the QuickBooks entry</div>
      </div>
      <div class="stat">
        <div class="k">Total · all rows</div>
        <div class="v">$${money(t.totalAll)}</div>
        <div class="note">${int(c.total)} rows in file</div>
      </div>
      <div class="stat">
        <div class="k">Excluded</div>
        <div class="v">$${money(t.totalExcluded)}</div>
        <div class="note">${int(c.excluded)} rows not approved / not captured</div>
      </div>
    </div>

    <div class="card">
      <div class="actions">
        <button class="primary" id="download">⬇ Download workbook</button>
        <span class="filename">${filename}</span>
        <span class="badge-ok" id="okmsg"></span>
      </div>
    </div>

    <div class="card">
      <h3 class="section">Reporting period &amp; memo</h3>
      <div class="kv">
        <div class="kk">Period</div><div class="vv">${periodLabel}</div>
        <div class="kk">Entry / receipt date</div><div class="vv">${lastDate}</div>
        <div class="kk">Sales Receipt No</div><div class="vv">${receiptNo}</div>
        <div class="kk">Deposit to</div><div class="vv">1080- Authorize Clearing</div>
        <div class="kk">Product/Service</div><div class="vv">PAYG</div>
        <div class="kk">Description &amp; Memo</div><div class="vv">${parsed.memo}</div>
      </div>
    </div>

    <div class="card">
      <h3 class="section">Excluded rows — why they don't count</h3>
      <p class="sub" style="margin:0 0 12px">
        Only rows with <strong>Response Code 1 (Approved)</strong> and
        <strong>Action Code AUTH_CAPTURE</strong> are counted as sales. The rows
        below are left out — either not approved, or approved but no money was
        captured.
      </p>
      <table class="mini">
        <thead><tr><th>Reason</th><th class="num">Rows</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${breakdownRows}
          <tr><td><strong>Total excluded</strong></td><td class="num"><strong>${int(c.excluded)}</strong></td><td class="num"><strong>${money(t.totalExcluded)}</strong></td></tr>
        </tbody>
      </table>
    </div>
  `;
  results.classList.remove('hidden');

  document.querySelector('#download').addEventListener('click', () => downloadWorkbook());
}

async function downloadWorkbook() {
  if (!current) return;
  const ok = document.querySelector('#okmsg');
  const btn = document.querySelector('#download');
  btn.disabled = true;
  ok.textContent = 'Building…';
  try {
    const wb = buildWorkbook(current.parsed);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = current.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    ok.textContent = '✓ Downloaded';
  } catch (e) {
    console.error(e);
    ok.textContent = '';
    showError('Failed to build the workbook: ' + (e.message || e));
  } finally {
    btn.disabled = false;
  }
}

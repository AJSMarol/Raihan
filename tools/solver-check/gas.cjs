// Minimal in-memory Google Apps Script stubs so Code.gs can run under Node for testing.
const fs = require('fs');
const vm = require('vm');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (rows[0] && rows[0][0]) rows[0][0] = rows[0][0].replace(/^﻿/, '');
  return rows;
}

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const src = this.sheet.data[this.r - 1 + i] || [];
      const row = [];
      for (let j = 0; j < this.nc; j++) { const v = src[this.c - 1 + j]; row.push(v === undefined ? '' : v); }
      out.push(row);
    }
    return out;
  }
  getDisplayValues() { return this.getValues().map((r) => r.map((v) => (v instanceof Date ? fmt(v) : String(v)))); }
  setValues(values) {
    values.forEach((vr, i) => {
      const t = (this.sheet.data[this.r - 1 + i] = this.sheet.data[this.r - 1 + i] || []);
      vr.forEach((v, j) => { t[this.c - 1 + j] = v; });
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  clearContent() {
    for (let i = 0; i < this.nr; i++) {
      const t = this.sheet.data[this.r - 1 + i]; if (!t) continue;
      for (let j = 0; j < this.nc; j++) t[this.c - 1 + j] = '';
    }
    this.sheet.trim();
    return this;
  }
}
class Sheet {
  constructor(name, data) { this.name = name; this.data = data || []; }
  trim() { while (this.data.length && this.data[this.data.length - 1].every((v) => v === '' || v === undefined)) this.data.pop(); }
  getLastRow() { this.trim(); return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
  appendRow(row) { this.trim(); this.data.push(row.slice()); }
  insertColumnBefore() { this.data.forEach((r) => r.unshift('')); }
  setFrozenRows() {}
}
function fmt(d) { return d.toISOString().slice(0, 10); }

function makeSpreadsheet(sheets) {
  const map = {};
  Object.keys(sheets).forEach((k) => { map[k] = new Sheet(k, sheets[k]); });
  return {
    sheets: map,
    getSheetByName: (n) => map[n] || null,
    insertSheet: (n) => (map[n] = new Sheet(n, [])),
    getSpreadsheetTimeZone: () => 'UTC',
    getSpreadsheetLocale: () => 'en_GB',
  };
}

function loadCode(codePath, spreadsheet) {
  const ctx = {
    console,
    SpreadsheetApp: { getActive: () => spreadsheet },
    Utilities: {
      parseDate: (s) => new Date(s + 'T00:00:00Z'),
      formatDate: (d) => fmt(d),
      getUuid: () => Math.random().toString(16).slice(2),
      computeDigest: () => [],
      base64EncodeWebSafe: () => '',
      DigestAlgorithm: {},
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get() {}, put() {} }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx, { filename: 'Code.gs' });
  return ctx;
}

/** Monday..Saturday of the earliest week in the CSV's Date column (dd/mm/yyyy or yyyy-mm-dd). */
function weekOfCsv(raw) {
  const col = raw[0].map((h) => h.trim().toLowerCase()).indexOf('date');
  const iso = raw.slice(1).map((r) => {
    const v = String(r[col] || '').trim();
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  }).filter(Boolean).sort();
  const first = new Date(iso[0] + 'T00:00:00Z');
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const add = (n) => { const d = new Date(first); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  return { monday: add(0), friday: add(4), saturday: add(5) };
}

module.exports = { parseCsv, makeSpreadsheet, loadCode, weekOfCsv };

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const optionNames = new Set(['--updated', '--latest-official-yoy', '--publication-date', '--accessed-date']);
const options = new Map();
const positional = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (optionNames.has(arg)) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      console.error(`${arg} requires a value`);
      process.exit(1);
    }
    options.set(arg, value);
    index += 1;
  } else if (arg.startsWith('--')) {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  } else {
    positional.push(arg);
  }
}

const [longTermCsvPath, referenceCsvPath, outputArg = 'cpi_monthly_2025base.json'] = positional;
const dateOption = (name) => {
  const value = options.get(name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must be supplied as a valid YYYY-MM-DD date`);
  }
  return value;
};

let metadata;
try {
  const latestOfficialYoy = Number(options.get('--latest-official-yoy'));
  if (!options.has('--latest-official-yoy') || !Number.isFinite(latestOfficialYoy)) {
    throw new Error('--latest-official-yoy must be supplied as a finite number');
  }
  metadata = {
    updated: dateOption('--updated'),
    latestOfficialYoy,
    publicationDate: dateOption('--publication-date'),
    accessedDate: dateOption('--accessed-date')
  };
} catch (error) {
  console.error(error.message);
  console.error('Usage: node scripts/build-cpi-monthly.mjs <e-Stat-long-term.csv> <Statistics-Bureau-3-decimal.csv> [output.json] --updated YYYY-MM-DD --latest-official-yoy NUMBER --publication-date YYYY-MM-DD --accessed-date YYYY-MM-DD');
  process.exit(1);
}

if (!longTermCsvPath || !referenceCsvPath) {
  console.error('Usage: node scripts/build-cpi-monthly.mjs <e-Stat-long-term.csv> <Statistics-Bureau-3-decimal.csv> [output.json] --updated YYYY-MM-DD --latest-official-yoy NUMBER --publication-date YYYY-MM-DD --accessed-date YYYY-MM-DD');
  process.exit(1);
}

const SERIES_NAME = '\u5168\u56fd\u30fb\u751f\u9bae\u98df\u54c1\u3092\u9664\u304f\u7dcf\u5408';
const SERIES_COLUMN = '\u751f\u9bae\u98df\u54c1\u3092\u9664\u304f\u7dcf\u5408';

function readShiftJis(filePath) {
  return new TextDecoder('shift_jis').decode(fs.readFileSync(filePath));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function extractSeries(filePath) {
  const rows = parseCsv(readShiftJis(filePath));
  const header = rows[0]?.map((cell) => cell.replace(/^\ufeff/, '').trim()) ?? [];
  const matches = header
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => cell === SERIES_COLUMN);

  if (matches.length !== 1) {
    throw new Error(`${filePath}: series column '${SERIES_COLUMN}' must occur exactly once (found ${matches.length})`);
  }

  const columnIndex = matches[0].index;
  const values = new Map();
  for (const row of rows) {
    const match = String(row[0] ?? '').trim().match(/^(\d{4})(\d{2})$/);
    if (!match) continue;
    const month = `${match[1]}-${match[2]}`;
    const value = Number(row[columnIndex]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${filePath}: invalid ${SERIES_COLUMN} index at ${month}`);
    }
    if (values.has(month)) throw new Error(`${filePath}: duplicate month ${month}`);
    values.set(month, value);
  }
  return values;
}

function nextMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

const longTerm = extractSeries(longTermCsvPath);
const reference = extractSeries(referenceCsvPath);
for (const [month, value] of reference) {
  if (!longTerm.has(month)) throw new Error(`3-decimal reference month ${month} is missing from the long-term series`);
  longTerm.set(month, value);
}

const entries = [...longTerm.entries()].sort(([a], [b]) => a.localeCompare(b));
if (entries[0]?.[0] !== '1970-01') throw new Error(`expected first month 1970-01, found ${entries[0]?.[0]}`);
for (let index = 1; index < entries.length; index += 1) {
  const expected = nextMonth(entries[index - 1][0]);
  if (entries[index][0] !== expected) throw new Error(`missing or unordered month: expected ${expected}, found ${entries[index][0]}`);
}

const latestMonth = entries.at(-1)[0];
const output = {
  schema_version: 1,
  meta: {
    updated: metadata.updated,
    publisher: '\u7dcf\u52d9\u7701\u7d71\u8a08\u5c40',
    series_name: SERIES_NAME,
    base: '2025\u5e74=100',
    series_type: '2025\u5e74\u57fa\u6e96\u63a5\u7d9a\u6307\u6570',
    precision: '1970\u5e741\u6708\uff5e2024\u5e7412\u6708\u306fe-Stat\u306e\u516c\u8868\u6307\u6570\uff08\u5c0f\u6570\u7b2c1\u4f4d\uff09\u30012025\u5e741\u6708\u4ee5\u964d\u306f\u5c0f\u6570\u7b2c3\u4f4d\u307e\u3067\u306e\u53c2\u8003\u6307\u6570',
    latest_month: latestMonth,
    latest_official_yoy: metadata.latestOfficialYoy,
    source_title: '2025\u5e74\u57fa\u6e96\u6d88\u8cbb\u8005\u7269\u4fa1\u6307\u6570 \u9577\u671f\u6642\u7cfb\u5217\u30c7\u30fc\u30bf \u4e2d\u5206\u985e\u6307\u6570\uff08\u5168\u56fd\u30fb\u6708\u6b21\uff09\uff0f\uff08\u53c2\u8003\u5024\uff09\u5c0f\u6570\u7b2c3\u4f4d\u307e\u3067\u306e\u6307\u6570\uff08\u5168\u56fd\uff09',
    publication_date: metadata.publicationDate,
    source_url: 'https://www.e-stat.go.jp/stat-search/files?layout=datalist&lid=000001488144&page=1',
    reference_precision_source_url: 'https://www.stat.go.jp/data/cpi/2025/csv/zmi2025aa.csv',
    accessed_date: metadata.accessedDate,
    note: '\u7d2f\u7a4d\u4e0a\u6607\u7387\u306f\u5404\u6708\u306e\u63a5\u7d9a\u6307\u6570\u306e\u6bd4\u3067\u8a08\u7b97\u3002\u5c0f\u6570\u7b2c3\u4f4d\u306e\u6307\u6570\u306f\u8a08\u7b97\u7528\u306e\u53c2\u8003\u5024\u3067\u3042\u308a\u3001\u516c\u5f0f\u306e\u5909\u5316\u7387\u3092\u518d\u8a08\u7b97\u3057\u3066\u4e0a\u66f8\u304d\u3057\u306a\u3044\u3002'
  },
  values: Object.fromEntries(entries)
};

const outputPath = path.resolve(outputArg);
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`wrote ${entries.length} months (${entries[0][0]} to ${latestMonth}) to ${outputPath}`);

#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const SOURCE_URL = 'https://www.stat.go.jp/data/cpi/2020/zuhyou/2020taxadj.xlsx';
const METHODOLOGY_URL = 'https://www.stat.go.jp/data/cpi/2015/pdf/2015taxadj.pdf';
const START_MONTH = '1990-01';
const END_MONTH = '2019-12';
const EXPECTED_MONTHS = 360;
const INDEX_SHEET_NAME = 'index';
const MONTHLY_INDEX_CLASSIFICATION = '月次，指数';
const TARGET_SERIES_JA = '生鮮食品を除く総合';
const TARGET_SERIES_EN = 'All items, less fresh food';

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (!arg.startsWith('--')) fail(`不明な引数です: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail(`${arg} の値がありません。`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function usage() {
  return [
    '総務省統計局の公式Excelから消費税調整済CPIを生成します。',
    '',
    '使用例:',
    '  node scripts/build-cpi-tax-adjusted.mjs --accessed-date 2026-08-11',
    '  node scripts/build-cpi-tax-adjusted.mjs --input path/to/2020taxadj.xlsx --accessed-date 2026-08-11',
    '',
    '引数:',
    '  --input <path>          取得済み公式Excel（省略時は統計局URLから取得）',
    '  --output <path>         出力先（既定: cpi_monthly_tax_adjusted.json）',
    '  --accessed-date <date>  資料確認日（YYYY-MM-DD、必須）',
  ].join('\n');
}

function validateAccessedDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    fail('--accessed-date は YYYY-MM-DD 形式で必ず指定してください。');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    fail(`実在しない確認日です: ${value}`);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  fail('ExcelファイルのZIP終端レコードを確認できません。');
}

function unzipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      fail(`ZIP中央ディレクトリの形式が不正です（entry ${index + 1}）。`);
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      fail(`ZIPローカルヘッダーの形式が不正です: ${fileName}`);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (compressionMethod === 0) content = compressed;
    else if (compressionMethod === 8) content = inflateRawSync(compressed);
    else fail(`未対応のZIP圧縮方式です（${compressionMethod}）: ${fileName}`);

    if (content.length !== uncompressedSize) {
      fail(`展開サイズが一致しません: ${fileName}`);
    }
    if (crc32(content) !== expectedCrc) {
      fail(`CRCが一致しません: ${fileName}`);
    }
    entries.set(fileName.replaceAll('\\', '/'), content);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeXml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(/([:\w.-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
}

function xmlText(source) {
  return [...source.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join('');
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => xmlText(match[1]));
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowAttrs = parseAttributes(rowMatch[1]);
    const cells = new Map();
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    for (const cellMatch of rowMatch[2].matchAll(cellPattern)) {
      const attrs = parseAttributes(cellMatch[1] || cellMatch[3] || '');
      if (!attrs.r) continue;
      const addressMatch = /^([A-Z]+)(\d+)$/.exec(attrs.r);
      if (!addressMatch) fail(`不正なセル番地です: ${attrs.r}`);
      const body = cellMatch[2] || '';
      let value = '';
      if (attrs.t === 'inlineStr') {
        value = xmlText(body);
      } else {
        const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (valueMatch) {
          const raw = decodeXml(valueMatch[1]);
          if (attrs.t === 's') {
            const stringIndex = Number(raw);
            if (!Number.isInteger(stringIndex) || sharedStrings[stringIndex] === undefined) {
              fail(`共有文字列の参照が不正です: ${attrs.r}`);
            }
            value = sharedStrings[stringIndex];
          } else {
            value = raw;
          }
        }
      }
      cells.set(addressMatch[1], value);
    }
    rows.push({ number: Number(rowAttrs.r), cells });
  }
  return rows;
}

function normalized(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[，、]/g, ',')
    .replace(/\s+/g, '')
    .trim();
}

function requireEntry(entries, name) {
  const entry = entries.get(name);
  if (!entry) fail(`Excel内の必須ファイルがありません: ${name}`);
  return entry.toString('utf8');
}

function resolveWorkbook(entries) {
  const workbookXml = requireEntry(entries, 'xl/workbook.xml');
  const relationshipsXml = requireEntry(entries, 'xl/_rels/workbook.xml.rels');
  const sharedStringsXml = requireEntry(entries, 'xl/sharedStrings.xml');
  const sharedStrings = parseSharedStrings(sharedStringsXml);

  const targets = new Map();
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attrs = parseAttributes(match[1]);
    if (attrs.Id && attrs.Target) targets.set(attrs.Id, attrs.Target);
  }

  const sheets = new Map();
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attrs = parseAttributes(match[1]);
    const target = targets.get(attrs['r:id']);
    if (!attrs.name || !target) fail('シート名とワークシートの対応を確認できません。');
    const normalizedTarget = path.posix.normalize(path.posix.join('xl', target));
    const xml = requireEntry(entries, normalizedTarget);
    sheets.set(attrs.name, parseSheetRows(xml, sharedStrings));
  }
  return sheets;
}

function locateMonthlyIndexSheet(sheets) {
  const indexRows = sheets.get(INDEX_SHEET_NAME);
  if (!indexRows) fail(`必須シート「${INDEX_SHEET_NAME}」がありません。`);

  const titleFound = indexRows.some((row) =>
    [...row.cells.values()].some((value) => normalized(value).includes('消費税調整済指数')),
  );
  if (!titleFound) fail('indexシートで「消費税調整済指数」を確認できません。');

  const classification = normalized(MONTHLY_INDEX_CLASSIFICATION);
  const catalogRow = indexRows.find((row) =>
    [...row.cells.values()].some((value) => normalized(value) === classification),
  );
  if (!catalogRow) fail(`indexシートで分類「${MONTHLY_INDEX_CLASSIFICATION}」を確認できません。`);

  const sheetName = [...catalogRow.cells.values()].find((value) => sheets.has(String(value)));
  if (!sheetName || sheetName === INDEX_SHEET_NAME) {
    fail(`分類「${MONTHLY_INDEX_CLASSIFICATION}」に対応するシート名を確認できません。`);
  }
  return String(sheetName);
}

function monthSequence(start, end) {
  const result = [];
  let [year, month] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  return result;
}

function extractSeries(rows) {
  const targetHeader = normalized(TARGET_SERIES_JA);
  let targetColumn = '';
  for (const row of rows) {
    for (const [column, value] of row.cells) {
      if (normalized(value) !== targetHeader) continue;
      if (targetColumn && targetColumn !== column) fail(`系列名「${TARGET_SERIES_JA}」が複数列にあります。`);
      targetColumn = column;
    }
  }
  if (!targetColumn) fail(`系列名「${TARGET_SERIES_JA}」を確認できません。`);

  const englishHeaderFound = rows.some(
    (row) => normalized(row.cells.get(targetColumn)) === normalized(TARGET_SERIES_EN),
  );
  if (!englishHeaderFound) {
    fail(`系列の英語名「${TARGET_SERIES_EN}」を同じ列で確認できません。`);
  }

  const values = new Map();
  let dateColumn = '';
  for (const row of rows) {
    const dateCells = [...row.cells.entries()].filter(([, value]) => /^\d{6}$/.test(String(value)));
    if (dateCells.length === 0) continue;
    if (dateCells.length !== 1) fail(`年月候補が複数ある行です: ${row.number}`);
    const [column, yyyymm] = dateCells[0];
    if (dateColumn && dateColumn !== column) fail('年月列が途中で変わっています。');
    dateColumn = column;
    const year = Number(yyyymm.slice(0, 4));
    const month = Number(yyyymm.slice(4, 6));
    if (month < 1 || month > 12) fail(`不正な年月です: ${yyyymm}`);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (key < START_MONTH || key > END_MONTH) continue;
    if (values.has(key)) fail(`年月が重複しています: ${key}`);
    const rawValue = row.cells.get(targetColumn);
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      fail(`${key} の指数が正の数値ではありません: ${rawValue}`);
    }
    values.set(key, numericValue);
  }
  if (!dateColumn) fail('YYYYMM形式の年月列を確認できません。');

  const expectedMonths = monthSequence(START_MONTH, END_MONTH);
  if (expectedMonths.length !== EXPECTED_MONTHS) fail('スクリプト内の期間定義が不正です。');
  const missing = expectedMonths.filter((month) => !values.has(month));
  const unexpected = [...values.keys()].filter((month) => !expectedMonths.includes(month));
  if (missing.length || unexpected.length || values.size !== EXPECTED_MONTHS) {
    fail(
      `月次系列が連続していません（件数=${values.size}, 欠損=${missing.join(',') || 'なし'}, ` +
        `範囲外=${unexpected.join(',') || 'なし'}）。`,
    );
  }
  return Object.fromEntries(expectedMonths.map((month) => [month, values.get(month)]));
}

async function loadWorkbook(inputPath) {
  if (inputPath) return fs.readFile(path.resolve(inputPath));
  const response = await fetch(SOURCE_URL, { redirect: 'follow' });
  if (!response.ok) fail(`公式Excelの取得に失敗しました: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('spreadsheet') && !contentType.includes('octet-stream')) {
    fail(`公式ExcelではないContent-Typeです: ${contentType || '(なし)'}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  validateAccessedDate(args['accessed-date']);

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultOutput = path.resolve(scriptDir, '..', 'cpi_monthly_tax_adjusted.json');
  const outputPath = path.resolve(args.output || defaultOutput);
  const workbookBuffer = await loadWorkbook(args.input);
  const sheets = resolveWorkbook(unzipEntries(workbookBuffer));
  const monthlySheetName = locateMonthlyIndexSheet(sheets);
  const values = extractSeries(sheets.get(monthlySheetName));

  const payload = {
    schema_version: 1,
    meta: {
      publisher: '総務省統計局',
      series_name: '全国・生鮮食品を除く総合・消費税調整済指数',
      base: '2020年=100',
      official_start_month: START_MONTH,
      official_end_month: END_MONTH,
      bridge_month: END_MONTH,
      source_title: '2020年基準 消費税調整済指数（全国）',
      source_url: SOURCE_URL,
      methodology_url: METHODOLOGY_URL,
      accessed_date: args['accessed-date'],
      status: 'official_reference_index',
      source_sheet: monthlySheetName,
      source_classification: MONTHLY_INDEX_CLASSIFICATION,
      source_series_label: TARGET_SERIES_JA,
      note:
        '消費税率改定の直接的な影響等を機械的に除いた総務省統計局の参考指数。' +
        '品目別の実際の課税措置と完全には一致せず、過剰調整又は調整不足となる場合がある。',
    },
    values,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`生成完了: ${outputPath}`);
  console.log(`シート: ${monthlySheetName}（${MONTHLY_INDEX_CLASSIFICATION}）`);
  console.log(`系列: ${TARGET_SERIES_JA} / ${TARGET_SERIES_EN}`);
  console.log(`期間: ${START_MONTH}～${END_MONTH}（${Object.keys(values).length}か月）`);
  console.log(`端点: ${START_MONTH}=${values[START_MONTH]}, ${END_MONTH}=${values[END_MONTH]}`);
}

main().catch((error) => {
  console.error(`エラー: ${error.message}`);
  process.exitCode = 1;
});

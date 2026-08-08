import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const errors = [];
const checks = [];

function check(condition, message) {
  if (condition) checks.push(message);
  else errors.push(message);
}

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  } catch (error) {
    errors.push(`${name} をJSONとして読み込めません: ${error.message}`);
    return null;
  }
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function latestYear(series) {
  const years = Object.keys(series || {}).map(Number).filter(Number.isFinite);
  return years.length ? Math.max(...years) : null;
}

function nextMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

const cost = readJson('pref_cost_data.json');
const cpi = readJson('cpi_monthly_2025base.json');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

if (cost) {
  const prefNames = Object.keys(cost.prefs || {});
  check(prefNames.length === 47, `prefsが47件である（実際: ${prefNames.length}件）`);
  check(new Set(prefNames).size === prefNames.length, 'prefsの都道府県名に重複がない');

  const byPref = cost.national?.min_wage_by_pref || {};
  const wagePrefNames = Object.keys(byPref);
  check(wagePrefNames.length === 47, `min_wage_by_prefが47件である（実際: ${wagePrefNames.length}件）`);
  check(new Set(wagePrefNames).size === wagePrefNames.length, 'min_wage_by_prefの都道府県名に重複がない');

  for (const [prefecture, record] of Object.entries(byPref)) {
    check(
      Number(record.new) - Number(record.old) === Number(record.inc),
      `${prefecture}: new - old = inc`
    );
    const history = cost.national?.min_wage_history_by_pref?.[prefecture];
    const year = latestYear(history);
    check(year !== null && Number(history[year]) === Number(record.new), `${prefecture}: 履歴最新年がmin_wage_by_pref.newと一致`);
  }

  const averageHistory = cost.national?.min_wage_history_avg || {};
  const averageLatestYear = latestYear(averageHistory);
  check(
    averageLatestYear !== null && Number(averageHistory[averageLatestYear]) === Number(cost.national?.min_wage_avg?.new),
    '全国平均の履歴最新年がmin_wage_avg.newと一致'
  );
  if (averageLatestYear === 2025) {
    check(Number(cost.national.min_wage_avg.new) === 1121, '令和7年度の全国加重平均が1,121円である');
  }

  for (const [prefecture, record] of Object.entries(cost.prefs || {})) {
    for (const key of ['cpi_yoy', 'cpi_asof', 'wage_yoy', 'wage_asof']) {
      check(record[key] === null, `${prefecture}.${key}は未確認値としてnullである`);
    }
  }

  const sources = {
    ...cost.meta?.sources,
    ...cost.national?.sources
  };
  for (const [key, source] of Object.entries(sources)) {
    check(source && typeof source === 'object', `${key}: 出典が構造化されている`);
    check(Boolean(source?.publisher), `${key}: 公表主体がある`);
    check(Boolean(source?.title), `${key}: 資料名がある`);
    check(/^https:\/\//.test(String(source?.url || '')), `${key}: 出典URLが空でない`);
    check(validDate(source?.accessed_date), `${key}: データ確認日が有効である`);
  }

  check(validDate(cost.meta?.updated), 'meta.updatedが有効な日付である');
  check(cost.national?.min_wage_guideline_2026?.used_in_calculation === false, '令和8年度最低賃金の目安は計算未使用である');

  const wageSourceText = [
    cost.national?.sources?.wage?.title,
    cost.national?.sources?.wage?.target_period,
    cost.national?.wage_asof
  ].join(' ');
  check(Number(cost.national?.wage_yoy) === 4.69, '2026年最終回答の賃上げ率が4.69%である');
  check(Number(cost.national?.wage_yoy) !== 3.51, '3.51%を定昇相当込み賃上げ率に採用していない');
  for (const term of ['第7回', '最終', '300人未満']) {
    check(wageSourceText.includes(term), `賃上げ率の資料情報に「${term}」がある`);
  }
}

if (cpi) {
  const entries = Object.entries(cpi.values || {});
  check(cpi.meta?.series_name?.includes('生鮮食品を除く総合'), 'CPI系列名が「生鮮食品を除く総合」である');
  check(cpi.meta?.base === '2025年=100', 'CPI基準が2025年基準である');
  check(entries[0]?.[0] === '1970-01', 'CPI月次データが1970年1月から始まる');
  check(new Set(entries.map(([month]) => month)).size === entries.length, 'CPI月次データに重複月がない');

  for (let index = 0; index < entries.length; index += 1) {
    const [month, value] = entries[index];
    check(/^\d{4}-\d{2}$/.test(month), `${month}: 年月形式が有効である`);
    check(Number.isFinite(value) && value > 0, `${month}: CPI指数が正の数値である`);
    if (index > 0) check(month === nextMonth(entries[index - 1][0]), `${month}: 前月から欠損なく年月順である`);
  }

  const latestMonth = entries.at(-1)?.[0];
  check(latestMonth === cpi.meta?.latest_month, 'CPI meta.latest_monthとvaluesの最終月が一致する');

  const [latestYearText, latestMonthText] = String(latestMonth || '').split('-');
  const previousYearMonth = `${Number(latestYearText) - 1}-${latestMonthText}`;
  const latestValue = Number(cpi.values?.[latestMonth]);
  const previousValue = Number(cpi.values?.[previousYearMonth]);
  if (latestValue > 0 && previousValue > 0) {
    const calculatedRounded = Math.round(((latestValue / previousValue) - 1) * 1000) / 10;
    check(calculatedRounded === Number(cpi.meta?.latest_official_yoy), '最新月の指数比（小数第1位丸め）が公式前年同月比と矛盾しない');
  }
  check(Number(cpi.meta?.latest_official_yoy) === Number(cost?.national?.cpi_yoy), 'CPI月次メタデータとpref_cost_data.jsonの公式前年同月比が一致する');
  if (latestMonth === '2026-06') {
    check(Number(cost?.national?.cpi_yoy) === 1.6, '2026年6月が最新の場合、cpi_yoyが1.6%である');
  }
}

const forbidden = [
  '2024年12月確定値（2025年以降は推計）',
  '2026年1月（前年同月比）',
  '2025年春闘（中小）',
  '2025: 1067',
  'new: 1163, old: 1113, inc: 50',
  '出典：総務省統計局 / JILPT',
  '（不明：添付Excel）',
  '本チャットにアップロードされたExcel'
];
const searchableFiles = ['index.html', 'pref_cost_data.json', 'cpi_monthly_2025base.json', 'DATA_SOURCES.md'];
const combinedText = searchableFiles
  .filter((name) => fs.existsSync(path.join(root, name)))
  .map((name) => fs.readFileSync(path.join(root, name), 'utf8'))
  .join('\n');
for (const text of forbidden) check(!combinedText.includes(text), `古い記載「${text}」が残っていない`);

check(indexHtml.includes("const TARGET_PASSWORD = 'price2026';"), 'TARGET_PASSWORDが変更されていない');
check(!indexHtml.includes('getHistoricalCpi'), '年次CPIハードコード関数を使用していない');
check(!indexHtml.includes('DEFAULT_NATIONAL_MIN_WAGE_SERIES'), '最低賃金の内蔵全国系列を使用していない');
check(!indexHtml.includes('document.lastModified'), 'フッター更新日にdocument.lastModifiedを使用していない');

const cpiFunction = indexHtml.match(/function calcCpiSince\(\)\{[\s\S]*?\n    \}\n\n    const hasCpiResult/)?.[0] || '';
check(Boolean(cpiFunction), 'calcCpiSince関数を検出できる');
check(cpiFunction.includes('meta.latest_month'), '累積CPIの比較月にmeta.latest_monthを使用している');
check(cpiFunction.includes('CPI_MONTHLY_DATA.values[base]'), '累積CPIの基準指数を月次JSONから直接取得している');
check(!cpiFunction.includes('new Date'), '累積CPIの比較月にブラウザ現在年月を使用していない');
check(!cpiFunction.includes('cpiRate'), '累積CPIを入力欄の前年同月比で外挿していない');
check(cpiFunction.includes('最新公表月より後であるため算出できません'), '最新公表月より後の入力を算出不可としている');

const releases = [...indexHtml.matchAll(/r(\d+)/g)].map((match) => Number(match[1]));
check(releases.length >= 2 && releases.every((release) => release === 43), '画面内のリリース番号がr43で統一されている');

if (errors.length) {
  console.error(`データ検証: ${errors.length}件のエラー`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`データ検証OK: ${checks.length}項目`);

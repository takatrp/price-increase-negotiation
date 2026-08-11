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

const OFFICIAL_MIN_WAGE_AVERAGE = {
  2002: 663, 2003: 664, 2004: 665, 2005: 668, 2006: 673, 2007: 687,
  2008: 703, 2009: 713, 2010: 730, 2011: 737, 2012: 749, 2013: 764,
  2014: 780, 2015: 798, 2016: 823, 2017: 848, 2018: 874, 2019: 901,
  2020: 902, 2021: 930, 2022: 961, 2023: 1004, 2024: 1055, 2025: 1121
};

function applicableMinimumWage(events, date) {
  const applicable = (events || []).filter((event) => String(event.effective_date) <= date);
  return applicable.length ? applicable.at(-1) : null;
}

const cost = readJson('pref_cost_data.json');
const cpi = readJson('cpi_monthly_2025base.json');
const taxAdjustedCpi = readJson('cpi_monthly_tax_adjusted.json');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cpiBuilder = fs.readFileSync(path.join(root, 'scripts', 'build-cpi-monthly.mjs'), 'utf8');
const taxAdjustedBuilder = fs.readFileSync(path.join(root, 'scripts', 'build-cpi-tax-adjusted.mjs'), 'utf8');
const termsHtml = fs.readFileSync(path.join(root, 'terms.html'), 'utf8');
const validationWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'validate-data.yml'), 'utf8');

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

  const effectiveByPref = cost.national?.min_wage_history_by_pref_effective || {};
  const effectivePrefNames = Object.keys(effectiveByPref);
  check(effectivePrefNames.length === 47, `発効日付き最低賃金履歴が47件である（実際: ${effectivePrefNames.length}件）`);
  check(new Set(effectivePrefNames).size === effectivePrefNames.length, '発効日付き最低賃金履歴の都道府県名に重複がない');
  for (const [prefecture, events] of Object.entries(effectiveByPref)) {
    check(Array.isArray(events) && events.length > 0, `${prefecture}: 発効日付き履歴が空でない`);
    let previousDate = '';
    const eventKeys = new Set();
    for (const event of events || []) {
      check(Number.isInteger(Number(event.fiscal_year)), `${prefecture}: 年度が整数である`);
      check(Number.isFinite(Number(event.amount)) && Number(event.amount) > 0, `${prefecture}: 最低賃金額が正の数値である`);
      check(validDate(event.effective_date), `${prefecture}: 発効日が有効である`);
      check(String(event.effective_date) >= previousDate, `${prefecture}: 発効日順に並んでいる`);
      const eventKey = `${event.effective_date}:${event.amount}`;
      check(!eventKeys.has(eventKey), `${prefecture}: 同一発効日・金額の重複がない`);
      eventKeys.add(eventKey);
      previousDate = String(event.effective_date);
    }
    const latest = events?.at(-1);
    const current = byPref[prefecture];
    check(Number(latest?.amount) === Number(current?.new), `${prefecture}: 発効日付き履歴の最新額がmin_wage_by_pref.newと一致`);
    check(String(latest?.effective_date) === String(current?.eff), `${prefecture}: 発効日付き履歴の最新発効日がmin_wage_by_pref.effと一致`);
    const prior = (events || []).find((event) => Number(event.fiscal_year) === 2024);
    check(Number(prior?.amount) === Number(current?.old), `${prefecture}: 2024年度額がmin_wage_by_pref.oldと一致`);
  }

  const hyogoEvents = effectiveByPref['兵庫'] || [];
  const hyogoLatest = hyogoEvents.at(-1);
  const hyogoJanuary = applicableMinimumWage(hyogoEvents, '2025-01-01');
  const hyogoNovember = applicableMinimumWage(hyogoEvents, '2025-11-01');
  const hyogoOctoberFirst = applicableMinimumWage(hyogoEvents, '2025-10-01');
  const hyogoOctoberLast = applicableMinimumWage(hyogoEvents, '2025-10-31');
  check(Number(hyogoJanuary?.amount) === 1052, '兵庫県2025年1月1日の基準最低賃金が1,052円である');
  check(Number(hyogoLatest?.amount) === 1116, '兵庫県の最新最低賃金が1,116円である');
  check(Math.abs(((Number(hyogoLatest?.amount) / Number(hyogoJanuary?.amount) - 1) * 100) - 6.083650190114065) < 1e-10, '兵庫県2025年1月1日基準の累積上昇率が約6.1%である');
  check(Number(hyogoNovember?.amount) === 1116, '兵庫県2025年11月1日の基準最低賃金が1,116円である');
  check(((Number(hyogoLatest?.amount) / Number(hyogoNovember?.amount) - 1) * 100) === 0, '兵庫県2025年11月1日基準の累積上昇率が0.0%である');
  check(Number(hyogoOctoberFirst?.amount) === 1052 && Number(hyogoOctoberLast?.amount) === 1116, '兵庫県2025年10月は月途中で最低賃金が改定される');

  const averageHistory = cost.national?.min_wage_history_avg || {};
  check(
    JSON.stringify(Object.keys(averageHistory).sort()) === JSON.stringify(Object.keys(OFFICIAL_MIN_WAGE_AVERAGE).sort()),
    '全国加重平均の年度キーが厚生労働省公式系列（2002～2025年度）と一致する'
  );
  for (const [year, officialValue] of Object.entries(OFFICIAL_MIN_WAGE_AVERAGE)) {
    check(Number(averageHistory[year]) === officialValue, `全国加重平均${year}年度が厚生労働省公表値${officialValue}円と一致する`);
  }
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

if (taxAdjustedCpi) {
  const meta = taxAdjustedCpi.meta || {};
  const entries = Object.entries(taxAdjustedCpi.values || {});
  check(taxAdjustedCpi.schema_version === 1, '消費税調整済CPIのschema_versionが1である');
  check(meta.publisher === '総務省統計局', '消費税調整済CPIの公表主体が総務省統計局である');
  check(meta.series_name?.includes('全国・生鮮食品を除く総合・消費税調整済指数'), '消費税調整済CPIの対象系列が正しい');
  check(meta.base === '2020年=100', '消費税調整済CPIの基準が2020年=100である');
  check(meta.official_start_month === '1990-01' && meta.official_end_month === '2019-12', '消費税調整済CPIの公式期間が1990年1月～2019年12月である');
  check(meta.bridge_month === '2019-12', '消費税調整済CPIの接続月が2019年12月である');
  check(meta.status === 'official_reference_index' && meta.note?.includes('参考指数'), '消費税調整済CPIを公式の参考指数として明示する');
  check(/^https:\/\/www\.stat\.go\.jp\//.test(meta.source_url || '') && /^https:\/\/www\.stat\.go\.jp\//.test(meta.methodology_url || ''), '消費税調整済CPIの公式資料URLがある');
  check(validDate(meta.accessed_date), '消費税調整済CPIのデータ確認日が有効である');
  check(entries.length === 360, '消費税調整済CPIが360か月である');
  check(entries[0]?.[0] === '1990-01' && entries.at(-1)?.[0] === '2019-12', '消費税調整済CPIの端点月が正しい');
  check(Number(entries[0]?.[1]) === 91.9 && Number(entries.at(-1)?.[1]) === 100.6, '消費税調整済CPIの端点指数が公式Excelと一致する');
  for (let index = 0; index < entries.length; index += 1) {
    const [month, value] = entries[index];
    check(Number.isFinite(value) && value > 0, `${month}: 消費税調整済CPI指数が正の数値である`);
    if (index > 0) check(month === nextMonth(entries[index - 1][0]), `${month}: 消費税調整済CPIが前月から欠損なく連続する`);
  }
  const bridgeAdjusted = Number(taxAdjustedCpi.values?.['2019-12']);
  const bridgeNormal = Number(cpi?.values?.['2019-12']);
  const latestNormal = Number(cpi?.values?.[cpi?.meta?.latest_month]);
  const baseAdjusted = Number(taxAdjustedCpi.values?.['1990-01']);
  const connectedMultiplier = (bridgeAdjusted / baseAdjusted) * (latestNormal / bridgeNormal);
  check(Number.isFinite(connectedMultiplier) && connectedMultiplier > 0, '税抜価格の1990～2019年は同系列内の比を2019年12月で接続できる');
}

if (cpi) {
  const entries = Object.entries(cpi.values || {});
  check(validDate(cpi.meta?.updated), 'CPI meta.updatedが有効な日付である');
  check(validDate(cpi.meta?.publication_date), 'CPI meta.publication_dateが有効な日付である');
  check(validDate(cpi.meta?.accessed_date), 'CPI meta.accessed_dateが有効な日付である');
  check(Number.isFinite(Number(cpi.meta?.latest_official_yoy)), 'CPI meta.latest_official_yoyが数値である');
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
check(indexHtml.includes("const OFFICE_PASSWORD = 'matsu20180201';"), '松本会計専用パスワードが設定されている');
check(indexHtml.includes("if(input === OFFICE_PASSWORD)") && indexHtml.includes("unlockApp(true, 'office')"), '専用パスワードで事務所モードとして認証する');
check(indexHtml.includes("sessionStorage.setItem(AUTH_MODE_KEY, authMode)") && indexHtml.includes("if(storedMode === 'office') activateOfficeMode();"), '事務所モードを同一タブ内で復元する');
check(indexHtml.includes("applyAdminPreset('matsumoto_fee', { restore:true, silent:true })"), '専用パスワードで松本会計プリセットを選択済みにする');
check(!indexHtml.includes('getHistoricalCpi'), '年次CPIハードコード関数を使用していない');
check(!indexHtml.includes('DEFAULT_NATIONAL_MIN_WAGE_SERIES'), '最低賃金の内蔵全国系列を使用していない');
check(!indexHtml.includes('document.lastModified'), 'フッター更新日にdocument.lastModifiedを使用していない');
check(indexHtml.includes('<input type="date" id="currentPriceAsOf"'), '現行価格の決定時期が年月日入力である');
check(indexHtml.includes('<input type="month" id="currentPriceMonth"'), '現行価格の決定時期を年月入力できる');
check(indexHtml.includes('name="decisionDatePrecision" value="unknown"'), '現行価格の決定時期を不明として扱える');
check(indexHtml.includes('name="priceBasis" value="exclusive"') && indexHtml.includes('name="priceBasis" value="inclusive"'), '税抜価格と税込価格を選択できる');
check(!indexHtml.includes('openCurrentPriceCalendarBtn') && !indexHtml.includes('カレンダーから選ぶ'), 'スマートフォンで機能しない重複カレンダーボタンがない');
check(!indexHtml.includes('入力例の日付は、作業日の翌々月1日に自動更新されます。'), '適用開始時期の不要な説明文がない');
check(indexHtml.includes("if(s === '北海道') return '北海道';"), '北海道を末尾正規化の前に保持している');
check(indexHtml.includes("renderAllByPref();\n          markImported(prefSelect);"), 'URLパラメータの都道府県適用後に表示を更新する');
check(indexHtml.includes('id="dataLoadAlert"') && indexHtml.includes('role="alert"'), '一般画面上部にデータ読込エラー表示がある');
check(indexHtml.includes('公的統計値を含む顧客向け文章は生成しません'), 'データ読込エラー時の顧客文抑止を明示している');
check(indexHtml.includes('function validateCostDataPayload(json)'), '基本データのランタイム構造検証がある');
check(indexHtml.includes('function validateCpiDataPayload(json)'), 'CPIデータのランタイム構造検証がある');
check(indexHtml.includes('function validateTaxAdjustedCpiDataPayload(json)'), '消費税調整済CPIのランタイム構造検証がある');
check(indexHtml.includes('賃上げ率（参考）（%）'), '4.69%の画面ラベルが「賃上げ率（参考）」である');
check(indexHtml.includes('id="actualLaborRate"'), '自社の実際の人件費上昇率が別入力欄である');
check(!indexHtml.includes('人件費（前年比 +'), '顧客文の旧「人件費（前年比）」表現が残っていない');
check(indexHtml.includes('連合の2026年春闘最終集計でも、300人未満の組合における定昇相当込みの賃上げ率が${pct2(h)}％となる'), '顧客文に賃上げ率の正確な定義を自然な接続で使用している');
check(!indexHtml.includes('連合の2026年春闘最終集計では、300人未満の組合における定昇相当込みの賃上げ率は${pct2(h)}％となっています。'), '賃上げ率を独立文として挿入する旧表現が残っていない');
check(indexHtml.includes("isFinite(h) && wageRate.dataset.origin !== 'manual'"), '手入力の参考率を連合の公式集計として表示しない');
check(indexHtml.includes("isFinite(p) && cpiRate.dataset.origin !== 'manual'"), '手入力の物価率を総務省の公式統計として表示しない');
check(indexHtml.includes("cpiRate.dataset.origin = 'manual'; cpiAsOf.dataset.origin = 'manual';"), '公的統計連動OFF時に物価率を手入力扱いにする');
check(indexHtml.includes("wageRate.dataset.origin = 'manual'; wageAsOf.dataset.origin = 'manual';"), '公的統計連動OFF時に賃上げ率を手入力扱いにする');
check(indexHtml.includes('1970年1月～2024年12月は小数第1位、2025年1月以降は小数第3位の参考指数'), 'CPI指数の表示精度説明が正確である');

const decisionFormatterSource = indexHtml.match(/const fmtDecisionDate = s => \{[\s\S]*?\n    \};/)?.[0] || '';
check(Boolean(decisionFormatterSource), '文案用の現行価格決定時期フォーマッターを検出できる');
if (decisionFormatterSource) {
  try {
    const fmtDecisionDate = Function(`return (${decisionFormatterSource.replace(/^const fmtDecisionDate = /, '').replace(/;$/, '')})`)();
    check(fmtDecisionDate('2025-01-15') === '2025年1月', '文案では現行価格の決定日を年月のみで表示する');
    check(!fmtDecisionDate('2025-01-15').includes('15日'), '文案へ現行価格決定日の「日」を出力しない');
  } catch (error) {
    errors.push(`文案用の現行価格決定時期フォーマッターを実行できません: ${error.message}`);
  }
}
check(indexHtml.includes('・最低賃金の累積上昇率（${prefLabel}）') && indexHtml.includes('発効日ベース、出典：${sourceShort(\'min_wage\')}'), '参考データに発効日ベースの最低賃金累積上昇率を表示する');
check(indexHtml.includes('officialDataReady() && decidedYM && hasMwResult(mwSince) && mwSince.cum > 0'), '最低賃金累積上昇率は正の値を正常に算出できた場合だけ参考データへ表示する');

const suggestedDateFunctionSource = indexHtml.match(/function suggestedEffectiveDateText\(now = new Date\(\)\)\{[\s\S]*?\n    \}/)?.[0] || '';
check(Boolean(suggestedDateFunctionSource), '適用開始時期の動的プレースホルダー関数を検出できる');
check(indexHtml.includes('updateEffectiveDatePlaceholder();'), '画面初期化時に適用開始時期のプレースホルダーを更新する');
if (suggestedDateFunctionSource) {
  try {
    const suggestedEffectiveDateText = Function(`return (${suggestedDateFunctionSource})`)();
    check(suggestedEffectiveDateText(new Date(2026, 7, 11)) === '2026年10月1日 ご注文分より', '2026年8月の入力例が2026年10月1日になる');
    check(suggestedEffectiveDateText(new Date(2026, 10, 30)) === '2027年1月1日 ご注文分より', '2026年11月の入力例が2027年1月1日になる');
    check(suggestedEffectiveDateText(new Date(2026, 11, 31)) === '2027年2月1日 ご注文分より', '2026年12月の入力例が2027年2月1日になる');
  } catch (error) {
    errors.push(`適用開始時期の動的プレースホルダー関数を実行できません: ${error.message}`);
  }
}

const naturalEvidenceFunctionSource = indexHtml.match(/function buildNaturalEvidencePhrase\(\)\{[\s\S]*?function buildMwCumulativeEvidenceSentence/)?.[0]
  ?.replace(/\s*function buildMwCumulativeEvidenceSentence$/, '') || '';
check(Boolean(naturalEvidenceFunctionSource), '本文へ根拠を織り込む関数を検出できる');
if (naturalEvidenceFunctionSource) {
  try {
    const makeNaturalEvidenceBuilder = Function(
      'embedNumbersInLetter', 'prefSelect', 'cpiRate', 'wageRate', 'actualLaborRate',
      'officialDataReady', 'minWageInfo', 'toNum', 'pct1', 'pct2',
      `return (${naturalEvidenceFunctionSource})`
    );
    const toTestNumber = (value) => String(value ?? '').trim() === '' ? Number.NaN : Number(value);
    const buildOfficialEvidence = makeNaturalEvidenceBuilder(
      { checked: true }, { value: '兵庫' },
      { value: '2.7', dataset: { origin: 'national' } },
      { value: '4.69', dataset: { origin: 'national' } },
      { value: '' }, () => true, () => ({ pct: 6.1 }),
      toTestNumber, (value) => Number(value).toFixed(1), (value) => Number(value).toFixed(2)
    );
    const officialEvidence = buildOfficialEvidence();
    check(officialEvidence.includes('最低賃金が前年度比 +6.1%、物価が前年同月比 +2.7%となっているほか、連合の2026年春闘最終集計でも'), '前半に直近1年間の最低賃金・物価・春闘参考値をまとめる');
    check(!officialEvidence.includes('累積上昇率'), '前半の直近1年間の説明に累積上昇率を混在させない');
    check(officialEvidence.includes('賃上げ率が4.69％となるなど、事業運営や人材確保にかかる負担は一段と高まっております。'), '春闘参考値をコスト環境の説明へ自然に接続する');
    check(!officialEvidence.includes('\n'), '本文へ織り込む根拠文に不自然な改行がない');

    const buildManualEvidence = makeNaturalEvidenceBuilder(
      { checked: true }, { value: '兵庫' },
      { value: '2.7', dataset: { origin: 'manual' } },
      { value: '8.00', dataset: { origin: 'manual' } },
      { value: '' }, () => true, () => ({ pct: 6.1 }),
      toTestNumber, (value) => Number(value).toFixed(1), (value) => Number(value).toFixed(2)
    );
    check(!buildManualEvidence().includes('連合の2026年春闘最終集計'), '手入力の賃上げ率を連合の公式集計として本文へ挿入しない');
  } catch (error) {
    errors.push(`本文へ根拠を織り込む関数を実行できません: ${error.message}`);
  }
}

const mwCumulativeEvidenceFunctionSource = indexHtml.match(/function buildMwCumulativeEvidenceSentence\(spoken = false\)\{[\s\S]*?\n    \}\n\n    function buildReferenceBlock/)?.[0]
  ?.replace(/\s*function buildReferenceBlock$/, '') || '';
check(Boolean(mwCumulativeEvidenceFunctionSource), '最低賃金累積上昇率の後半用文章関数を検出できる');
if (mwCumulativeEvidenceFunctionSource) {
  try {
    const makeMwCumulativeEvidenceBuilder = Function(
      'officialDataReady', 'calcMwSince', 'hasMwResult', 'pct1',
      `return (${mwCumulativeEvidenceFunctionSource})`
    );
    const hasMwResultForTest = (value) => Boolean(value && !value.error && Number.isFinite(value.cum));
    const buildMwIncreaseEvidence = makeMwCumulativeEvidenceBuilder(
      () => true, () => ({ baseMw: 1052, nowMw: 1116, cum: 6.083650190114065 }),
      hasMwResultForTest, (value) => Number(value).toFixed(1)
    );
    check(buildMwIncreaseEvidence() === 'また、最低賃金についても、現行価格の決定時点に適用されていた1,052円から最新の1,116円まで、累積で約6.1%上昇しております。', '後半で累積物価上昇率に続く最低賃金累積上昇率を生成する');
    check(buildMwIncreaseEvidence(true).endsWith('上昇しています。'), '面談トークでは最低賃金累積上昇率を話し言葉で生成する');

    const buildMwZeroEvidence = makeMwCumulativeEvidenceBuilder(
      () => true, () => ({ baseMw: 1116, nowMw: 1116, cum: 0 }),
      hasMwResultForTest, (value) => Number(value).toFixed(1)
    );
    check(buildMwZeroEvidence() === '', '最低賃金累積上昇率0.0%を顧客向け文書へ表示しない');

    const buildMwErrorEvidence = makeMwCumulativeEvidenceBuilder(
      () => true, () => ({ error: '算出不可' }),
      hasMwResultForTest, (value) => Number(value).toFixed(1)
    );
    check(buildMwErrorEvidence() === '', '算出できない最低賃金累積上昇率を後半へ表示しない');
  } catch (error) {
    errors.push(`最低賃金累積上昇率の後半用文章関数を実行できません: ${error.message}`);
  }
}
check(indexHtml.includes("decidedLine = [decidedLine, buildMwCumulativeEvidenceSentence()].filter(Boolean).join('\\n');"), '文案で累積物価上昇率の直後に最低賃金累積上昇率を配置する');
check(indexHtml.includes('mwCumulativeTalk ? `「${mwCumulativeTalk}」`'), '面談トークでも累積物価上昇率の直後に最低賃金累積上昇率を配置する');

for (const option of ['--updated', '--latest-official-yoy', '--publication-date', '--accessed-date']) {
  check(cpiBuilder.includes(option), `CPI生成スクリプトが${option}を必須入力として扱う`);
}
check(!/updated:\s*'\d{4}-\d{2}-\d{2}'/.test(cpiBuilder), 'CPI生成スクリプトにupdatedの固定日付がない');
check(!/latest_official_yoy:\s*\d/.test(cpiBuilder), 'CPI生成スクリプトにlatest_official_yoyの固定値がない');
check(!/publication_date:\s*'\d{4}-\d{2}-\d{2}'/.test(cpiBuilder), 'CPI生成スクリプトにpublication_dateの固定日付がない');
check(!/accessed_date:\s*'\d{4}-\d{2}-\d{2}'/.test(cpiBuilder), 'CPI生成スクリプトにaccessed_dateの固定日付がない');

const cpiFunction = indexHtml.match(/function calcCpiSince\(\)\{[\s\S]*?\n    \}\n\n    const hasCpiResult/)?.[0] || '';
check(Boolean(cpiFunction), 'calcCpiSince関数を検出できる');
check(cpiFunction.includes('meta.latest_month'), '累積CPIの比較月にmeta.latest_monthを使用している');
check(cpiFunction.includes('CPI_MONTHLY_DATA.values[baseMonth]'), '累積CPIの基準指数を決定日の月次JSONから直接取得している');
check(cpiFunction.includes('adjustedBridge / adjustedBase') && cpiFunction.includes('latestCpi / normalBridge') && cpiFunction.includes('segmentA * segmentB'), '税抜価格の過去期間は2019年12月で消費税調整済CPIと通常CPIを接続する');
check(cpiFunction.includes("baseMonth < '1990-01'") && cpiFunction.includes('公式の消費税調整済指数が1990年1月からのため算出できません。'), '税抜価格の1990年1月より前を通常CPIへフォールバックしない');
check(cpiFunction.includes("currentPriceBasis === 'inclusive' && baseMonth < '1970-01'"), '税込価格は1970年1月以降を計算対象にする');
check(!cpiFunction.includes('new Date'), '累積CPIの比較月にブラウザ現在年月を使用していない');
check(!cpiFunction.includes('cpiRate'), '累積CPIを入力欄の前年同月比で外挿していない');
check(cpiFunction.includes('最新公表月より後であるため算出できません'), '最新公表月より後の入力を算出不可としている');

check(indexHtml.includes("const APP_VERSION = 'r45';"), 'リリース番号を単一定数r45で管理する');
check((indexHtml.match(/r45/g) || []).length === 1, 'index.html内のr45リテラルが単一定数だけである');
check(indexHtml.includes("const AUTOSAVE_KEY = 'mk_autosave_v2';") && indexHtml.includes("const LEGACY_AUTOSAVE_KEY = 'mk_autosave_v1';"), '自動保存v2と旧v1移行元を分ける');
check(indexHtml.includes('if(!autoSaveEnabled || !autoSaveEnabled.checked)') && indexHtml.includes('localStorage.removeItem(AUTOSAVE_KEY)'), '自動保存OFFではv2へ保存せず解除時に削除する');
check(indexHtml.includes("legacy.decisionDatePrecision = 'month';") && indexHtml.includes('legacy.currentPriceMonth = oldDecision;') && !indexHtml.includes('`${d.currentPriceAsOf}-01`'), '旧YYYY-MMを日付へ変換せず年月として移行する');
check(indexHtml.includes('localStorage.removeItem(LEGACY_AUTOSAVE_KEY)'), '入力内容消去又は移行時に旧v1を削除する');
check(indexHtml.includes('id="adminPreset"') && indexHtml.includes('松本会計・顧問報酬改定'), '管理モードに松本会計・顧問報酬改定プリセットがある');
check(indexHtml.includes('function buildMatsumotoOutputs()') && indexHtml.includes('税務・会計顧問サービス'), '会計事務所専用テンプレートを生成する');
for (const term of ['法令改正への継続対応','会計・税務システムの整備','情報セキュリティの強化','職員研修及び専門知識の維持','巡回監査及び経営支援の品質維持・向上']) {
  check(indexHtml.includes(term), `会計事務所専用文面に「${term}」がある`);
}
check(indexHtml.includes('Math.floor(exact / unit) * unit'), 'CPI参考額を指定単位で切り下げる');
check(indexHtml.includes('この金額を改定後価格へ反映') && indexHtml.includes('入力された改定後価格は、消費税調整後の累積CPIによる参考上限額を超えています。'), 'CPI参考額の手動反映と上限超過警告がある');
check(indexHtml.includes('setExportAvailability(exportReasons)') && indexHtml.includes('契約書を確認するまで外部送付しないでください'), '必須項目不足と契約未確認時に外部出力を停止する');
check(!indexHtml.includes('事情変更の原則に基づき') && !indexHtml.includes('通知のみで可の可能性'), '契約条項の断定的な旧表現が残っていない');

check(taxAdjustedBuilder.includes("args['accessed-date']") && taxAdjustedBuilder.includes('YYYYMM形式の年月列を確認できません'), '消費税調整済CPI生成スクリプトが必須確認日と動的年月列を検証する');
check(taxAdjustedBuilder.includes('targetColumn') && taxAdjustedBuilder.includes('TARGET_SERIES_JA'), '消費税調整済CPI生成スクリプトが系列列を名称から特定する');
check(validationWorkflow.includes('node-version: 22') && validationWorkflow.includes('node scripts/validate-data.mjs'), 'GitHub ActionsがNode.js 22でデータ検証を実行する');
check(termsHtml.includes('本ツール」といいます）に固有の利用条件') && termsHtml.includes('事業上利用できます') && termsHtml.includes('自社の取引先への交付') && termsHtml.includes('商用利用である場合も許可されます'), '本ツール固有の利用条件に顧問先の業務利用と生成文書交付を許諾する');

if (errors.length) {
  console.error(`データ検証: ${errors.length}件のエラー`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`データ検証OK: ${checks.length}項目`);

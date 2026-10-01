import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'pref_cost_data.json'), 'utf8'));
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
function source(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `${name} is present`);
  const end = html.indexOf('\n    }', start);
  return html.slice(start, end + 6);
}
function harness(cost = data, instant = '2026-10-01T08:00:00Z') {
  const RealDate = Date;
  class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])); } }
  const element = (value = '') => ({ value, dataset:{}, checked:false, textContent:'', className:'', style:{}, classList:{ add(){},remove(){},toggle(){} } });
  const context = {
    Date:FixedDate, Intl, COST_DATA:structuredClone(cost), PREF_LABEL:Object.fromEntries(Object.keys(data.prefs).map(key => [key,key])),
    prefSelect:element('兵庫'), minWageTarget:element('current'), minWageTargetNote:element(), minWageView:element(), minWageBadge:element(), minWageRegionalSource:element(),
    currentPriceAsOf:element('2025-01-01'), currentPriceMonth:element('2025-01'), currentDecisionPrecision:'exact',
    cpiScopeBadge:element(), wageScopeBadge:element(), cpiRate:element('1.6'), wageRate:element('4.69'), cpiAsOf:element('2026年6月'), wageAsOf:element('2026年春闘'), actualLaborRate:element(),
    embedNumbersInLetter:{checked:true}, linkRates:{checked:false}, officialDataReady:()=>true,
    toNum:value => { const parsed=parseFloat(String(value ?? '').replace(/,/g,'')); return Number.isFinite(parsed) ? parsed : NaN; },
    pct1:value => (Math.round(value*10)/10).toFixed(1), pct2:value => value.toFixed(2),
    fmtYMD:value=>value, fmtYM:value=>value, fmtDecisionDate:value=>value,
    lastDayOfMonth:value=>new RealDate(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5)),0)).toISOString().slice(0,10),
    hasMwResult:value=>Boolean(value && !value.error && Number.isFinite(value.cum)),
    calcCpiSince:()=>({error:'unavailable for wage test'}), hasCpiResult:()=>false,
    sourceShort:()=> '厚生労働省', priceBasisLabel:()=> '税抜',
  };
  for (const id of ['autoSaveEnabled','partnerCompany','partnerPerson','partnerHonorific','partnerHonorificCustom','ownCompany','ownPerson','productName','currentPrice','newPrice','effectiveDate','extraFactors','effortFreeText','valueFreeText']) context[id]=element();
  context.autoSaveEnabled.checked=true;
  Object.assign(context, {
    currentAuthMode:'general', currentAudience:'btob', APP_VERSION:'r48',
    isOfficeMode:()=>false, getDraftPriceBasis:()=>({priceBasis:'exclusive'}),
    autosaveKeyForMode:()=> 'test-draft', getChipState:()=>[], setDecisionPrecision:value=>context.currentDecisionPrecision=value,
    applyRestoredPriceBasis:()=>{}, applyChipState:()=>{}, setAudience:()=>{}, showImportStatus:message=>context.restoreMessage=message,
    setScopeBadge:()=>{}, clearLinkedOfficialRates:()=>{}, getPrefData:key=>context.COST_DATA.prefs[key],
  });
  const storage = new Map();
  context.localStorage={setItem:(key,value)=>storage.set(key,value),getItem:key=>storage.get(key),removeItem:key=>storage.delete(key)};
  context.readDraftForRestore=()=>({data:JSON.parse(storage.get('test-draft')),migrated:false});
  vm.createContext(context);
  const names=['isIsoDate','hasFiniteNumber','validateCostDataPayload','normalizePrefKey','parseMinWageRecord','getMinWageFromJson','getMinWageEffectiveHistory','todayInJapan','fiscalYearLabel','getMinWageTarget','restoreMinWageTarget','getMinWageComparison','minWageInfo','renderMinWagePanel','getDecisionContext','calcMwSince','buildNaturalEvidencePhrase','buildMwCumulativeEvidenceSentence','buildReferenceBlock','resolveRate','applyLinkedRates','saveDraft','restoreDraft'];
  vm.runInContext(names.map(source).join('\n'),context);
  return context;
}

const h=harness();
check(h.validateCostDataPayload(h.COST_DATA) === h.COST_DATA,'shipping JSON accepted by actual runtime validator');
check(h.todayInJapan(new Date('2026-09-30T14:59:59Z'))==='2026-09-30','one second before JST effective day');
check(h.todayInJapan(new Date('2026-09-30T15:00:00Z'))==='2026-10-01','JST midnight, regardless of client timezone');
check(h.todayInJapan(new Date('2026-12-31T15:00:00Z'))==='2027-01-01','JST year boundary');
for(const [pref,record] of Object.entries(data.national.min_wage_by_pref)){
  const history=h.getMinWageEffectiveHistory(pref);
  const latest=history.at(-1);
  const before=new Date(`${record.eff}T00:00:00Z`); before.setUTCDate(before.getUTCDate()-1);
  check(h.getMinWageComparison(pref,before.toISOString().slice(0,10),'current').event.amount===record.old,`${pref}: prior day uses old rate`);
  check(h.getMinWageComparison(pref,record.eff,'current').event.amount===record.new,`${pref}: effective day uses new rate`);
  check(h.getMinWageComparison(pref,before.toISOString().slice(0,10),'announced').event.amount===record.new,`${pref}: confirmed upcoming comparison retained`);
  h.prefSelect.value=pref;h.minWageTarget.value='announced';
  const info=h.minWageInfo(pref);
  check(Math.abs(info.pct-(record.new/record.old-1)*100)<1e-10,`${pref}: increase rate uses previous final rate`);
  check(latest.fiscalYear===Number(Object.keys(data.national.min_wage_history_by_pref[pref]).at(-1)),`${pref}: latest fiscal year coherent`);
}

const evidence=JSON.parse(fs.readFileSync(path.join(root,'docs/minimum-wage-2026-sources.json'),'utf8'));
check(evidence.rows.length===47 && new Set(evidence.rows.map(row=>row.prefecture)).size===47,'47 unique official-source records');
check(evidence.rows.filter(row=>row.status==='final').length===44,'44 final source records');
check(JSON.stringify(Object.keys(data.national.min_wage_pending_by_pref))===JSON.stringify(['佐賀','熊本','沖縄']),'three final-unconfirmed prefectures retained separately');
check(data.national.min_wage_avg.fiscal_year===2025 && data.national.min_wage_avg.new===1121,'last fully final national average is explicitly FY2025');
check(data.national.min_wage_revision.weighted_average_reference.new===1177 && data.national.min_wage_revision.weighted_average_reference.used_in_calculation===false,'1177 is advisory aggregate, unused');
for(const row of evidence.rows){
  const actual=row.status==='final' ? data.national.min_wage_by_pref[row.prefecture] : data.national.min_wage_pending_by_pref[row.prefecture];
  for(const key of ['new','old','inc','eff','fiscal_year','status','source_url','publication_date','accessed_date']) check(actual[key]===row[key],`${row.prefecture}: ${key} agrees with independently verified source record`);
  h.prefSelect.value=row.prefecture;h.renderMinWagePanel();
  check(!h.minWageRegionalSource.hidden,`${row.prefecture}: final/advisory official source link is visible`);
  check(h.minWageRegionalSource.href===row.source_url,`${row.prefecture}: official source link points to correct Gazette/bureau evidence`);
  if(row.status==='advisory') check(h.getMinWageComparison(row.prefecture,'2027-12-31','announced').event.fiscalYear===2025,`${row.prefecture}: merely passing proposed date never makes advisory final`);
}
check(h.getMinWageComparison('兵庫','2026-09-30','current').event.amount===1116 && h.getMinWageComparison('兵庫','2026-10-01','current').event.amount===1172,'Hyogo October1 boundary matches official revision');
check(h.getMinWageComparison('鳥取','2026-10-01','current').event.amount===1030 && h.getMinWageComparison('鳥取','2026-10-03','current').event.amount===1090,'Tottori is not prematurely revised on October1');

// Future confirmed revision: exercise real implementation without inventing official rates.
const synthetic=structuredClone(data);
const pref='兵庫';
const old=synthetic.national.min_wage_by_pref[pref].new;
synthetic.national.min_wage_by_pref[pref]={old,new:old+50,inc:50,eff:'2027-10-03',fiscal_year:2027,status:'final'};
synthetic.national.min_wage_history_by_pref_effective[pref].push({fiscal_year:2027,amount:old+50,effective_date:'2027-10-03',status:'final'});
const future=harness(synthetic,'2027-10-01T00:00:00Z');
future.currentPriceAsOf.value='2026-10-01';
let result=future.calcMwSince();
check(result.nowMw===old && !result.comparison.pending,'current mode excludes future final revision');
future.minWageTarget.value='announced'; result=future.calcMwSince();
check(result.nowMw===old+50 && result.comparison.pending,'announced mode includes final revision');
check(future.buildMwCumulativeEvidenceSentence().includes('2027-10-03発効予定'),'cumulative letter labels future effective date');
check(!future.buildMwCumulativeEvidenceSentence().includes('上昇しております'),'future revision is not described as already effective');
check(future.buildNaturalEvidencePhrase().includes('となる予定です'),'annual evidence correctly labels future increase');
check(future.buildReferenceBlock('2026年10月').includes('判定日：2027-10-01 日本時間'),'letter, print and Word shared reference block contains comparison date');
future.renderMinWagePanel();
check(future.minWageBadge.textContent.includes('令和9年度確定・発効前'),'future panel derives year and state from data');
check(future.minWageTargetNote.textContent.includes((old+50).toLocaleString('ja-JP')),'panel comparison uses selected amount');
future.minWageTarget.value='current'; future.renderMinWagePanel();
check(future.minWageTargetNote.textContent.includes(old.toLocaleString('ja-JP')),'current panel shows active rate, with latest revision still visible');
future.currentPriceAsOf.value='2028-01-01';check(Boolean(future.calcMwSince().error),'future baseline date rejected');
future.currentPriceAsOf.value='1900-01-01';check(Boolean(future.calcMwSince().error),'before official history is uncalculable');
future.currentDecisionPrecision='month';future.currentPriceMonth.value='2025-10';check(Boolean(future.calcMwSince().error),'ambiguous historical revision month rejected');
future.currentDecisionPrecision='unknown';check(Boolean(future.calcMwSince().error),'unknown historical baseline rejected');
future.prefSelect.value='';check(future.minWageInfo('')===null,'empty region never silently takes another prefecture');
future.renderMinWagePanel();check(future.minWageBadge.textContent==='未取得','empty region has missing-data UI');

const base=harness(data);base.prefSelect.value='兵庫';base.currentPriceAsOf.value='2025-01-01';
const current=base.calcMwSince();
check(Math.abs(current.cum-(current.nowMw/1052-1)*100)<1e-10,'old historical baseline preserved');
base.currentPriceAsOf.value=current.latestEffectiveDate;
check(base.calcMwSince().cum===0,'effective-day baseline produces zero cumulative increase');
for(const [pref,proposed] of Object.entries(data.national.min_wage_pending_by_pref || {})){
  base.prefSelect.value=pref;base.minWageTarget.value='announced';base.renderMinWagePanel();
  check(base.getMinWageComparison(pref).event.fiscalYear<proposed.fiscal_year,`${pref}: advisory excluded from announced calculation`);
  check(base.minWageTargetNote.textContent.includes('答申・計算未使用'),`${pref}: advisory disclosure visible`);
  check(!base.minWageRegionalSource.hidden,`${pref}: official regional source link visible`);
}
const corrupt=structuredClone(data);corrupt.national.min_wage_history_by_pref_effective['兵庫'].at(-1).status='advisory';
assert.throws(()=>base.validateCostDataPayload(corrupt)); checks++;
const invalid=structuredClone(data);invalid.national.min_wage_by_pref['兵庫'].eff='2026-02-30';
assert.throws(()=>base.validateCostDataPayload(invalid)); checks++;

// Save/reload the new setting while preserving explicitly manual CPI/wage inputs.
const saved=harness();saved.minWageTarget.value='announced';saved.cpiRate.value='8.8';saved.wageRate.value='9.9';saved.actualLaborRate.value='12.3';
saved.saveDraft();saved.minWageTarget.value='current';saved.cpiRate.value='';saved.wageRate.value='';
check(saved.restoreDraft()===true,'actual draft restore succeeds');
check(saved.minWageTarget.value==='announced','comparison target survives save/reload');
saved.applyLinkedRates();check(saved.cpiRate.value==='8.8' && saved.wageRate.value==='9.9' && saved.actualLaborRate.value==='12.3','manual rates preserved when official linking is off');
check(saved.cpiRate.dataset.origin==='manual','restored manual values remain marked manual');
const legacy=JSON.parse(saved.localStorage.getItem('test-draft'));delete legacy.minWageTarget;saved.localStorage.setItem('test-draft',JSON.stringify(legacy));
saved.restoreDraft();check(saved.minWageTarget.value==='current' && saved.restoreMessage.includes('本日時点の発効済み額で再計算'),'old saved draft transparently defaults to effective rate');
check(saved.cpiRate.value==='8.8' && saved.wageRate.value==='9.9','old draft manual amounts remain unchanged');
const formatSource=html.match(/const fmtYMD = s => \{[\s\S]*?\n    \};/)[0];
const format=Function('z2',`${formatSource};return fmtYMD;`)(value=>String(value).padStart(2,'0'));
check(format('2026-10-01')==='2026-10-01','date-only effective values do not shift in negative UTC timezones');
new vm.Script(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);checks++;
console.log(`最低賃金回帰テストOK: ${checks}項目 (TZ=${process.env.TZ || 'system'})`);

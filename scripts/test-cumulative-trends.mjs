import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const html = read('index.html');
function source(name){
  const start = html.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, name);
  const end = html.indexOf('\n    }', start);
  return html.slice(start, end + 6);
}
const obj = value => ({value});
const cost = { national:{ min_wage_history_by_pref_effective:{ 兵庫:[
  { amount:899, effective_date:'2019-10-01', fiscal_year:2019 },
  { amount:1000, effective_date:'2025-10-01', fiscal_year:2025 },
  { amount:1050, effective_date:'2026-10-17', fiscal_year:2026 },
  { amount:1111, effective_date:'2026-12-01', fiscal_year:2027 }
] } } };
const context = vm.createContext({
  COST_DATA:cost,
  CPI_MONTHLY_DATA:JSON.parse(read('cpi_monthly_2025base.json')),
  SCHEDULED_WAGE_DATA:JSON.parse(read('scheduled_wage_index_monthly.json')),
  SCHEDULED_WAGE_ERROR:'',
  CPI_TAX_ADJUSTED_DATA:JSON.parse(read('cpi_monthly_tax_adjusted.json')),
  todayInJapan:()=> '2026-11-21',
  currentPriceBasis:'inclusive',
  currentDecisionPrecision:'exact', currentPriceAsOf:obj('2025-10-15'), currentPriceMonth:obj('2025-10'),
  prefSelect:obj('兵庫'), PREF_LABEL:{兵庫:'兵庫県'}, fmtYMD:x=>x, fmtYM:x=>x, fmtDecisionDate:x=>x,
  z2:x=>String(x).padStart(2,'0'),
  hasCpiResult:x=>Boolean(x && !x.error && Number.isFinite(x.cum)),
  hasMwResult:x=>Boolean(x && !x.error && Number.isFinite(x.cum)),
});
const names=['isIsoDate','lastDayOfMonth','getDecisionContext','getMinWageEffectiveHistory','calcMwSince','calcCpiSince','monthlyComparisonPoints','cumulativeTrendData','cumulativeTrendSvg'];
vm.runInContext(names.map(source).join('\n'), context);
const calc = (date, precision = 'exact', basis = 'inclusive', today = '2026-11-21')=>{
  context.currentDecisionPrecision=precision;
  context.currentPriceBasis=basis;
  context[precision==='month'?'currentPriceMonth':'currentPriceAsOf'].value=date;
  const cpi = context.calcCpiSince();
  return { cpi, result:context.cumulativeTrendData(cpi,context.getDecisionContext(),'兵庫',today) };
};
const e = (actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9, `${actual} vs ${expected}`);
let {cpi,result} = calc('2025-10-15');
assert.equal(result.start,'2025-10-15');
assert.equal(result.end,'2026-11-21');
assert.equal(result.cpi[0].date,result.start);
assert.equal(result.cpi[0].rate,0);
assert.equal(result.cpi.at(-1).month,cpi.latestMonth);
assert.ok(result.cpi.at(-1).date < result.end);
e(result.cpi.at(-1).rate,cpi.cum);
assert.deepEqual(Array.from(result.wage, x=>x.date),['2025-10-15','2026-10-17','2026-11-21']);
assert.equal(result.wage[0].rate,0);
e(result.wage[1].rate,5);
e(result.wage[2].rate,5);
assert.match(context.cumulativeTrendSvg(result),/stroke-dasharray="2 3"/);
assert.doesNotMatch(context.cumulativeTrendSvg(result),/NaN|Infinity/);
assert.match(context.cumulativeTrendSvg(result),/role="img"/);

({cpi,result}=calc('2019-10-30','exact','exclusive'));
assert.equal(cpi.method,'tax_adjusted_bridge');
e(result.cpi.find(p=>p.month==='2019-12').rate,(cpi.segmentA-1)*100);
e(result.cpi.at(-1).rate,cpi.cum);
assert.notEqual(result.coreCpi.at(-1).rate, cpi.cum, 'Comparison CPI and customer-facing calculation are independent');
const standardCpi = result.coreCpi.at(-1).rate;
({cpi,result}=calc('2019-10-30','exact','inclusive'));
assert.equal(cpi.method,'normal_ratio');
e(result.coreCpi.at(-1).rate,standardCpi);
e(result.cpi.at(-1).rate,cpi.cum);

({result}=calc('2026-10-17'));
assert.equal(result.wage[0].date,'2026-10-17');
assert.equal(result.wage[0].rate,0);
assert.equal(result.wage.at(-1).rate,0);
({result}=calc('2026-09','month'));
assert.equal(result.start,'2026-09-01');
assert.ok(result.notes.some(x=>x.includes('初日')));
e(result.wage.at(-1).rate,5);
({result}=calc('2026-10','month'));
assert.equal(result.wage.length,0);
assert.ok(result.notes.some(x=>x.includes('途中')));
({result}=calc('2026-10','month','inclusive','2026-10-25'));
assert.equal(result.wage.length,0);
assert.ok(result.notes.some(x=>x.includes('途中') || x.includes('終了')));
({result}=calc('2026-11-21'));
assert.equal(result.cpi.length,0);
assert.equal(result.wage.length,1);
assert.doesNotMatch(context.cumulativeTrendSvg(result),/NaN|Infinity/);
assert.ok(calc('2026-11-22').result.error);
assert.ok(calc('','unknown').result.error);
assert.ok(calc('2026-13','month').result.error);
({result}=calc('2018-01-02'));
assert.ok(result.cpi.length>1 && result.wage.length===0);
assert.ok(result.notes.some(x=>x.includes('公式履歴')));
context.CPI_MONTHLY_DATA=null;
({result}=calc('2025-10-15'));
assert.ok(result.cpi.length===0 && result.wage.length===3);
assert.ok(result.notes.some(x=>x.includes('コアCPI')));
assert.ok(result.salary.length > 1);

// Exercise DOM wiring in both user-selectable price bases, at open-table and unavailable states.
function node(){
  return { children:[], innerHTML:'', textContent:'', hidden:false, open:false,
    setAttribute(){}, append(...items){this.children.push(...items);}, replaceChildren(){this.children.length=0;} };
}
const nodes = new Map();
context.$ = id => (nodes.has(id) ? nodes.get(id) : (nodes.set(id,node()),nodes.get(id)));
context.document = {createElement:node, createTextNode:x=>x};
context.pct1 = x=>x.toFixed(1);
context.CPI_MONTHLY_DATA=JSON.parse(read('cpi_monthly_2025base.json'));
vm.runInContext('let cumulativeTrendKey = null; let lastCumulativeTrend = null;\n' +
  ['updateCumulativeTrendChart','renderCumulativeTrendTable'].map(source).join('\n'),context);
const chart = context.$('#cumulativeTrendChart');
const legend = context.$('#cumulativeTrendLegend');
const details = context.$('#cumulativeTrendDetails');
const numbers = context.$('#cumulativeTrendTable');
details.open=true;
for (const basis of ['exclusive','inclusive']){
  ({cpi}=calc('2019-10-30','exact',basis));
  context.updateCumulativeTrendChart(cpi);
  assert.ok(chart.innerHTML.includes('viewBox="0 0 408 238"'));
  assert.ok(legend.children[0].children[1].includes('コアCPI（全国）'));
  assert.ok(legend.children[1].children[1].includes('所定内給与（全国）'));
  assert.ok(legend.children[1].children[1].includes('速報'));
  assert.ok(legend.children[2].children[1].includes('本日時点'));
  assert.match(numbers.innerHTML, /<th scope="col">コアCPI<\/th>/);
  assert.ok(!details.hidden);
}
assert.match(numbers.innerHTML, /所定内給与/);
assert.match(numbers.innerHTML, /（速報）/);
({result}=calc('2015-10-01'));
e(result.coreCpi.at(-1).rate, (102.9 / 88.7 - 1)*100);
e(result.salary.at(-1).rate, (113.8 / 97.9 - 1)*100);
assert.equal(result.salary.at(-1).month, '2026-09');
assert.equal(result.salary.at(-1).date, '2026-09-30');
assert.equal(result.salary[0].rate, 0);
({result}=calc('1992-12-31'));
assert.equal(result.salary.length, 0);
assert.ok(result.coreCpi.length > 12);
assert.ok(result.notes.some(x=>x.includes('1993-01')));
({result}=calc('2026-10-01'));
assert.equal(result.salary.length, 0, 'Do not carry values from September into October');
const wageData = context.SCHEDULED_WAGE_DATA;
context.SCHEDULED_WAGE_DATA = null;
context.SCHEDULED_WAGE_ERROR = '読込不良';
({cpi}=calc('2019-10-30'));
context.updateCumulativeTrendChart(cpi);
assert.ok(legend.children[0].children[1].includes('コアCPI（全国）'));
assert.ok(legend.children[1].children[1].includes('最低賃金'));
assert.doesNotMatch(numbers.innerHTML, /（速報）/);
context.SCHEDULED_WAGE_DATA = wageData;
({cpi}=calc('','unknown'));
context.updateCumulativeTrendChart(cpi);
assert.equal(chart.innerHTML,'');
assert.ok(details.hidden);
assert.equal(legend.children.length,0);

console.log('累積上昇率グラフの回帰テストOK');

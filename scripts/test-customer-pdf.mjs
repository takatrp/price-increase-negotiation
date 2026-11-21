import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const html = read('index.html');
const script = html.match(/<script>\s*([\s\S]+)<\/script>/)[1];
new vm.Script(script); // Syntax-check the complete application.
function source(name){
  const start = html.indexOf('    function ' + name + '(');
  assert.notEqual(start, -1, name);
  return html.slice(start, html.indexOf('\n    }', start) + 6);
}
function tag(id){
  const result = html.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>'));
  assert.ok(result, id);
  return result[0];
}
assert.match(tag('includeLetterCpiChart'), /type="checkbox"/);
assert.doesNotMatch(tag('includeLetterCpiChart'), /\schecked\b/);
assert.match(tag('letterCpiChartPreview'), /\shidden\b/);
assert.doesNotMatch(tag('customerPrintBtn'), /disabled/);
assert.ok(html.indexOf('id="letterCpiChartPreview"') > html.indexOf('id="outputArea"'));
assert.ok(html.indexOf('id="printLetterCpiChart"') > html.indexOf('id="printLetter"'));
assert.match(html, /async\s*\(\)\s*=>\s*\{[\s\S]*?copyText\(outputArea\.value \|\| ''\)/);
assert.match(html, /downloadWordDocx\(outputArea\.value \|\| '',/);
assert.match(html, /#printInternalPack\s*\{\s*display:\s*none\s*!important/);
assert.match(html, /html\.printWithInternal #printInternalPack\s*\{\s*display:\s*block\s*!important/);
assert.match(html, /html\.printWithInternal #printLetterCpiChart\s*\{\s*display:\s*none\s*!important/);
assert.match(html, /html\.exportBlocked #printPack\s*\{\s*display:\s*none\s*!important/);
assert.match(html, /customerPrintBtn\.addEventListener\('click', \(\) => printOutput\(false\)\)/);
assert.match(html, /printBtn\.addEventListener\('click', \(\) => printOutput\(true\)\)/);
assert.match(html, /addEventListener\('afterprint', clearInternalPrint\)/);
assert.match(source('resetFormState'), /includeLetterCpiChart\.checked = false/);

class Element {
  constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.innerHTML='';this.hidden=false;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  cloneNode(deep){
    const copy = Object.assign(new Element(this.tag),this);
    copy.children=deep?this.children.map(x=>typeof x==='string'?x:x.cloneNode(true)):[];
    return copy;
  }
  serialize(){return this.textContent + this.innerHTML + this.children.map(x=>typeof x==='string'?x:x.serialize()).join('');}
}
const ids = new Map();
const get = id => {
  if(!ids.has(id)) ids.set(id,new Element('div'));
  return ids.get(id);
};
const classes = new Set();
const status = [];
const printed = [];
const box = {checked:false, disabled:false};
const date = new Element('div');
const memo = new Element('div');
const context = vm.createContext({
  $:get, document: {
    documentElement: {classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}},
    createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('fragment')
  },
  includeLetterCpiChart:box,
  currentOutputMode:'letter',
  officialDataReady:()=>true,
  calcCpiSince:()=>undefined,
  hasCpiResult:x=>Boolean(x && !x.error && Number.isFinite(x.cum)),
  fmtYM:x=>x,
  fmtYMD:x=>x,
  pct1:x=>x.toFixed(1),
  todayInJapan:()=> '2026-11-21',
  lastCumulativeTrend:null,
  generate:()=>true,
  canExport:()=>({ok:true,errors:[]}),
  setExportAvailability:x=>status.push(x),
  showImportStatus:x=>status.push(x),
  CACHE:{letter:'案内本文',talk:'INTERNAL_TALK_SENTINEL',memo:'INTERNAL_MEMO_SENTINEL'},
  printDate:date, printTalkMemo:memo,
  window:{print:()=>printed.push({internal:classes.has('printWithInternal'),memo:memo.textContent})}
});
vm.runInContext(['cumulativeTrendSvg','renderLetterCpiChart','clearInternalPrint','printOutput'].map(source).join('\n'),context);

function setSeries(bridge){
  const series = [
    {date:'2019-10-15',month:'2019-10',rate:0},
    {date:'2019-11-30',month:'2019-11',rate:2},
    {date:'2019-12-31',month:'2019-12',rate:4.5}
  ];
  context.calcCpiSince=()=>({baseMonth:'2019-10',latestMonth:'2019-12',cum:4.5,method:bridge?'tax_adjusted_bridge':'normal_ratio'});
  context.lastCumulativeTrend={cpi:series,wage:[{date:'2019-12-31',rate:100}]};
}
const preview=get('#letterCpiChartPreview');
const chart=get('#printLetterCpiChart');
setSeries(false);
context.renderLetterCpiChart();
assert.ok(!box.disabled && preview.hidden && chart.hidden);
box.checked=true;
context.renderLetterCpiChart();
assert.ok(!preview.hidden && !chart.hidden);
assert.match(chart.serialize(), /4\.5％/);
assert.match(chart.serialize(), /通常指数/);
assert.match(chart.serialize(), /改定率そのものを示すものではありません/);
assert.match(chart.serialize(), /role="img"/);
assert.match(chart.serialize(), /2019-10～2019-12/);
assert.doesNotMatch(chart.serialize(), /最低賃金|stroke-dasharray|100%|INTERNAL_/);
assert.equal(chart.serialize(),preview.serialize());
setSeries(true);
context.renderLetterCpiChart();
assert.match(chart.serialize(), /消費税調整済指数と通常指数を2019年12月で接続/);
assert.match(chart.serialize(), /消費税調整済指数/);
context.currentOutputMode='talk';
context.renderLetterCpiChart();
assert.ok(get('#letterCpiChartOption').hidden && preview.hidden && !chart.hidden);
assert.equal(preview.serialize(),'');
context.currentOutputMode='letter';
context.officialDataReady=()=>false;
context.renderLetterCpiChart();
assert.ok(box.disabled && preview.hidden && chart.hidden);
assert.equal(chart.serialize(),'');
context.officialDataReady=()=>true;
context.lastCumulativeTrend.cpi.pop(); // Stale timeline incompatible with the current calculation
context.renderLetterCpiChart();
assert.ok(box.disabled && chart.hidden);
assert.equal(chart.serialize(),'');

context.printOutput(false);
assert.deepEqual(printed.at(-1),{internal:false,memo:''});
assert.equal(date.textContent,'2026-11-21');
context.printOutput(true);
assert.deepEqual(printed.at(-1),{internal:true,memo:'INTERNAL_TALK_SENTINEL\n\n----------------------------------------\n\nINTERNAL_MEMO_SENTINEL'});
// Even a prior internal print that did not emit afterprint cannot leak into a dedicated customer print.
context.printOutput(false);
assert.deepEqual(printed.at(-1),{internal:false,memo:''});
context.printOutput(true);
context.clearInternalPrint();
assert.equal(memo.textContent,'');
assert.equal(classes.has('printWithInternal'),false);
let count=printed.length;
context.canExport=()=>({ok:false,errors:['契約確認不足']});
context.printOutput(false);
assert.equal(printed.length,count);
assert.match(status.at(-1),/契約確認不足/);
context.canExport=()=>({ok:true,errors:[]});
context.generate=()=>false;
context.printOutput(true);
assert.equal(printed.length,count);
assert.equal(classes.has('printWithInternal'),false);
context.generate=()=>true;
context.window.print=()=>{throw Error('printer failure');};
context.printOutput(true);
assert.equal(memo.textContent,'');
assert.equal(classes.has('printWithInternal'),false);
console.log('お客様向けPDFと累積CPIの回帰テストOK');

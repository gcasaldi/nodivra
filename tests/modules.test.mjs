import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../modules.js', import.meta.url), 'utf8');

function createWorkspace(){
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], 'HTML IDs must be unique');
  class Node{
    constructor(id){
      this.id = id;this.children = [];this.hidden = false;
      this.attributes = {};this.textContent = '';this.dataset = {};
      this.handlers = {};this.parent = null;this.tabIndex = 0;
    }
    appendChild(node){
      if(node.parent)node.parent.children = node.parent.children.filter(item => item !== node);
      this.children.push(node);node.parent = this;return node;
    }
    replaceChildren(...nodes){this.children = [];nodes.forEach(node => this.appendChild(node));}
    setAttribute(name,value){this.attributes[name] = value;}
    addEventListener(name,handler){this.handlers[name] = handler;}
    focus(){this.focused=true;}
    scrollIntoView(){}
  }
  const nodes = new Map(ids.map(id => [id,new Node(id)]));
  const tracePanel = new Node('investigation-panel');
  const nextButtons = [...html.matchAll(/data-next-module="([^"]+)"/g)].map(([,id]) => {
    const button = new Node('go-'+id);button.dataset.nextModule = id;return button;
  });
  const doc = {
    getElementById:id => nodes.get(id) || null,
    querySelector:selector => selector === '.investigation-panel' ? tracePanel : null,
    querySelectorAll:selector => selector === '[data-next-module]' ? nextButtons : [],
  };
  const window = {};
  vm.runInNewContext(script,{document:doc,window});
  return {modules:window.NodivraModules,nodes,tracePanel,nextButtons};
}
test('five modules exist, have independent tab panels and preserve original render targets',()=>{
  const {nodes,tracePanel} = createWorkspace();
  const expected = {
    results:'module-investigate-body',
    'name-results':'module-investigate-body',
    'transaction-result':'module-investigate-body',
    'chain-results':'module-correlate-body',
    'research-results':'module-correlate-body',
    'advanced-evidence':'module-correlate-body',
    'trace-leads':'module-recommend-body',
    'case-workspace':'module-report-body',
  };
  for(const [id,parent] of Object.entries(expected))assert.equal(nodes.get(id).parent?.id,parent);
  assert.equal(tracePanel.parent.id,'module-connect-body');
  assert.equal(nodes.get('module-investigate').hidden,false);
  assert.equal(nodes.get('module-report').hidden,true);
  assert.equal(nodes.get('tab-investigate').attributes['aria-selected'],'true');
});
test('a verified incident unlocks its five evidence workflow views',()=>{
  const {modules,nodes} = createWorkspace();
  const target=modules.incidentSlot('report');
  assert.equal(target.hidden,false);
  modules.complete('incident',{initial_events:[{tx_hash:'0x1'}]});
  assert.equal(nodes.get('module-badge-recommend').textContent,'Next check ready');
  assert.equal(nodes.get('module-badge-report').textContent,'Export ready');
  modules.open('report');
  assert.equal(nodes.get('module-report').hidden,false);
  assert.equal(nodes.get('tab-report').attributes['aria-selected'],'true');
  assert.equal(nodes.get('module-investigate').hidden,true);
});
test('new cases hide stale graphs, previous reports and out-of-date labels',()=>{
  const {modules,nodes} = createWorkspace();
  for(const id of ['trace-leads','case-workspace','transaction-result','chain-results'])
    nodes.get(id).hidden=false;
  modules.incidentSlot('report');
  modules.complete('incident',{initial_events:[]});
  modules.reset('wallet');
  for(const id of ['trace-leads','case-workspace','transaction-result','chain-results','advanced-evidence','incident-report-content'])
    assert.equal(nodes.get(id).hidden,true,id+' should be hidden for a fresh case');
  assert.equal(nodes.get('module-report').hidden,true);
  assert.equal(nodes.get('module-investigate').hidden,false);
  assert.equal(nodes.get('module-badge-report').textContent,'Not started');
});
test('modules expose no hidden extra collection, scoring or unsupported network claims',()=>{
  for(const phrase of ['Bitcoin/Solana address snapshots only','No verified BTC/Solana fund-flow tracing yet','Not a certified forensic chain of custody']){
    assert.ok(html.includes(phrase),'Scope disclaimer missing: '+phrase);
  }
});

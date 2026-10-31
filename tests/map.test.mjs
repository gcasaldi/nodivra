import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../map.js',import.meta.url),'utf8');
const A='0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // public smoke-test address, evidence below is synthetic
const B='0x2222222222222222222222222222222222222222';
const C='0x3333333333333333333333333333333333333333';
const hash=n=>'0x'+n.repeat(64);
const edge=(a,b,id)=>({from:a,to:b,kind:'native',asset:'ETH',amount:'0.5',
  tx_hash:hash(id),source_url:'https://eth.blockscout.com/tx/'+hash(id),timestamp:'2026-10-30T09:00:00Z'});
const report=(address,edges,partial=false)=>({address,network_id:'ethereum',
  graph:{nodes:[...new Set([address,...edges.flatMap(e=>[e.from,e.to])])].map(address=>({address,labels:[]})),edges},
  coverage:{partial},stats:{transfers:edges.length},mode:{depth_requested:1}});

function setup(respond){
  class Node{
    constructor(tag,id=''){
      this.tag=tag;this.id=id;this.children=[];this.handlers={};this.attributes={};
      this.style={};this.className='';this.hidden=false;this.disabled=false;this.textContent='';
      this.value='ethereum';this.classList={add:s=>{this.className+=' '+s;},toggle:()=>{}};
    }
    appendChild(node){this.children.push(node);return node;}
    prepend(node){this.children.unshift(node);return node;}
    get lastElementChild(){return this.children[this.children.length-1]||null;}
    remove(){}
    replaceChildren(...nodes){this.children=[...nodes];}
    setAttribute(key,val){this.attributes[key]=val;}
    addEventListener(type,fn){this.handlers[type]=fn;}
  }
  const ids=['wallet-map','map-svg-host','map-inspector','map-related','map-history','map-back',
    'map-expand','map-network','map-status','module-empty-connect','map-counter',
    'map-home','map-zoom-in','map-zoom-out','map-fit','map-export',
    'ops-feed','ops-transfers','ops-wallets','ops-coverage','ops-network','ops-activity-status','ops-status-label'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node('div',id)]));
  const calls=[];
  const states=[];
  const context={
    document:{getElementById:id=>nodes[id]||null,
      createElement:tag=>new Node(tag),
      createTextNode:value=>({textContent:String(value)}),
      createElementNS:(_,tag)=>new Node(tag)},
    window:{NodivraModules:{open:module=>states.push(module),complete:kind=>states.push(kind)}},
    navigator:{clipboard:{writeText:async()=>{}}},
    URLSearchParams,AbortController,
    fetch:async(url,options)=>{
      const u=new URL(url);calls.push(u);
      const data=await respond(u,options);
      return data?.status?{ok:false,status:data.status,json:async()=>({})}:
        {ok:true,status:200,json:async()=>data};
    }
  };
  vm.runInNewContext(source,context,{timeout:5000});
  return {map:context.window.NodivraMap,nodes,calls,states};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));

test('wallet address opens directly in CONNECT and loads source-linked graph evidence',async()=>{
  const {map,nodes,calls,states}=setup(u=>report(u.searchParams.get('address'),[edge(A,B,'a')]));
  map.start(A);await tick();
  const s=map.snapshot();
  assert.equal(s.root,A);assert.equal(s.focus,A);assert.equal(s.nodes,2);assert.equal(s.edges,1);
  assert.equal(nodes['wallet-map'].hidden,false);
  assert.equal(nodes['map-svg-host'].children[0].tag,'svg');
  assert.equal(calls[0].searchParams.get('direction'),'both');
  assert.equal(calls[0].searchParams.get('depth'),'1');
  assert.ok(states.includes('connect'));
  assert.match(nodes['map-status'].textContent,/1 observed transfer event/);
  assert.match(nodes['map-counter'].textContent,/2 visible/);
});
test('drilldown grows evidence graph without inventing edges and back preserves the trail',async()=>{
  const {map,nodes,calls}=setup(u=>u.searchParams.get('address').toLowerCase()===A.toLowerCase()?
    report(A,[edge(A,B,'a')]):report(B,[edge(B,C,'b')]));
  map.start(A);await tick();map.select(B);await tick();
  assert.equal(map.snapshot().focus,B);
  assert.equal(map.snapshot().nodes,3);
  assert.equal(map.snapshot().edges,2);
  assert.equal(calls.length,2);
  assert.equal(nodes['map-back'].disabled,false);
  assert.equal(nodes['map-related'].children.filter(x=>x.tag==='div').length,2);
  map.back();
  assert.equal(map.snapshot().focus,A);
  assert.equal(map.snapshot().edges,2);
  assert.equal(map.snapshot().history.length,0);
});
test('missing index or HTTP 429 is labelled unavailable without a fake connection',async()=>{
  const {map,nodes,states}=setup(async()=>({status:429}));
  map.start(A);await tick();
  assert.equal(map.snapshot().nodes,1); // input address only, not an invented counterparty
  assert.equal(map.snapshot().edges,0);
  assert.match(nodes['map-status'].textContent,/HTTP 429/);
  assert.ok(states.includes('graph_failed'));
});
test('changing the EVM network starts a fresh graph and does not mix chains',async()=>{
  const {map,nodes,calls}=setup(u=>report(A,[edge(A,B,'a')]));
  map.start(A);await tick();
  nodes['map-network'].value='base';
  nodes['map-network'].handlers.change();
  await tick();
  assert.equal(map.snapshot().network,'base');
  assert.equal(map.snapshot().nodes,2);
  assert.equal(map.snapshot().edges,1);
  assert.equal(calls[1].searchParams.get('network'),'base');
});
test('new wallet resets the prior investigation evidence and prevents stale cross-case links',async()=>{
  const {map}=setup(u=>report(u.searchParams.get('address'),[edge(u.searchParams.get('address'),B,'a')]));
  map.start(A);await tick();map.start(C);await tick();
  assert.equal(map.snapshot().root,C);
  assert.equal(map.snapshot().nodes,2);
  assert.equal(map.snapshot().edges,1);
  assert.equal(map.snapshot().history.length,0);
});

test('public wallet lookup can supply verified indexed edges when richer tracing is rate-limited',async()=>{
  const {map,nodes}=setup(async()=>({status:429}));
  map.start(A);await tick();
  const actual=map.ingestWalletSample(A,{transactions:[{
    hash:hash('b'),status:'ok',from:{hash:A},to:{hash:B},value:'1000000000000000000',
    block:100,timestamp:'2026-10-29T09:00:00Z'
  },{
    hash:hash('c'),status:'failed',from:{hash:A},to:{hash:C},value:'5000000000000000000',
    block:101,timestamp:'2026-10-29T09:30:00Z'
  }],token_transfers:[]});
  assert.equal(actual,1);
  assert.equal(map.snapshot().nodes,2);
  assert.equal(map.snapshot().edges,1);
  assert.match(nodes['map-counter'].textContent,/1 transfer events/);
});
test('a wallet lookup for an unrelated case cannot contaminate the current map',async()=>{
  const {map}=setup(async()=>({status:429}));
  map.start(A);await tick();
  const injected=map.ingestWalletSample(C,{transactions:[{
    hash:hash('b'),status:'ok',from:{hash:C},to:{hash:B},value:'1000000000000000000'
  }]});
  assert.equal(injected,0);
  assert.equal(map.snapshot().edges,0);
});

test('backend outage shows a clear fallback panel instead of a one-node fake relationship graph',async()=>{
  const {map,nodes}=setup(async()=>({status:503}));
  map.start(A);await tick();
  assert.equal(map.snapshot().edges,0);
  const root=nodes['map-svg-host'].children[0];
  assert.equal(root.tag,'div');
  assert.match(root.className,/map-outage/);
  assert.match(nodes['map-status'].textContent,/HTTP 503/);
});

test('dashboard shows only evidence-backed graph counts, source condition and chain',async()=>{
 const {map,nodes}=setup(u=>report(A,[edge(A,B,'c')]));
 map.start(A);await tick();
 assert.equal(nodes['ops-transfers'].textContent,'1');
 assert.equal(nodes['ops-wallets'].textContent,'2');
 assert.equal(nodes['ops-coverage'].textContent,'Indexed');
 assert.equal(nodes['ops-network'].textContent,'ETHEREUM');
 assert.equal(nodes['ops-status-label'].textContent,'READY');
 assert.equal(nodes['ops-feed'].children.length>=1,true);
 map.reset();
 assert.equal(nodes['ops-coverage'].textContent,'Not checked');
});
test('degraded HTTP 200 from all indexers is not represented as successful zero-activity result',async()=>{
 const {map,nodes,states}=setup(async u=>({
  address:A,graph:{nodes:[{address:A,labels:[]}],edges:[]},
  coverage:{data_status:'unavailable',partial:true,problems:['rate limit']},
  stats:{transfers:0},network_id:'ethereum'
 }));
 map.start(A);await tick();
 assert.equal(map.snapshot().edges,0);
 assert.equal(nodes['ops-coverage'].textContent,'Limited');
 assert.equal(nodes['ops-status-label'].textContent,'SOURCE ISSUE');
 assert.match(nodes['map-status'].textContent,/temporarily unavailable/);
 assert.ok(states.includes('graph_failed'));
});

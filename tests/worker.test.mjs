import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const originalFetch=globalThis.fetch;
const originalSource=await readFile(new URL('../worker/worker.js',import.meta.url),'utf8');
const workerModule=await import('data:text/javascript;base64,'+Buffer.from(originalSource).toString('base64'));
const worker=workerModule.default;
const root='0x1111111111111111111111111111111111111111';
const parent='0x2222222222222222222222222222222222222222';
const grandparent='0x3333333333333333333333333333333333333333';
const hash=n=>'0x'+n.repeat(64);
const native=(from,to,n)=>({
 hash:hash(n),from:{hash:from},to:{hash:to},value:'1230000000000000000',
 timestamp:'2026-10-30T11:00:00Z',status:'ok',block:100
});
function route(url){
 const target=String(url);
 if(target.includes('eth-labels.com'))return {status:404,data:{error:'not available'}};
 if(target.includes('/api/v2/addresses/')){
   const address=target.match(/0x[a-fA-F0-9]{40}/)?.[0]||root;
   if(target.includes('/token-transfers'))return {data:{items:[]}};
   if(target.includes('/transactions')){
     const items=address.toLowerCase()===root.toLowerCase()?[native(parent,root,'a')]:
       address.toLowerCase()===parent.toLowerCase()?[native(grandparent,parent,'b')]:[];
     return {data:{items}};
   }
   if(target.includes('/counters'))return {data:{transactions_count:'1',token_transfers_count:'0'}};
   if(target.includes('/internal-transactions'))return {data:{items:[]}};
   return {data:{hash:address,is_contract:false,coin_balance:'1230000000000000000',name:address===parent?'Labeled service':null}};
 }
 throw Error('Unexpected network request: '+target);
}
function fakeFetch(fn=route) {
 globalThis.fetch=async (url,config={})=>{
   const r=fn(url,config),code=r?.status||200;
   return {ok:code<400,status:code,json:async()=>r.data};
 };
}
async function request(path){
 const response=await worker.fetch(new Request('https://nodivra-api.example.test'+path));
 return {status:response.status,json:await response.json()};
}
test.after(()=>{globalThis.fetch=originalFetch;});
test('invalid addresses are rejected before provider requests', async()=>{
 fakeFetch(()=>{throw Error('Unexpected call');});
 const result=await request('/investigate?address=0x1234');
 assert.equal(result.status,400);
});
test('incoming graph has two evidenced hops with transaction hashes',async()=>{
 fakeFetch();
 const result=await request('/investigate?address='+root+'&network=ethereum&direction=in&depth=2');
 assert.equal(result.status,200);
 assert.equal(result.json.graph.edges.length,2);
 assert.equal(result.json.mode.depth_achieved,2);
 assert.deepEqual(result.json.graph.edges.map(x=>x.tx_hash).sort(),[hash('a'),hash('b')].sort());
 assert.match(result.json.identity_status,/No legal identity inferred/);
 assert.ok(result.json.graph.nodes.some(x=>x.labels.some(l=>l.name==='Labeled service')));
});
test('unavailable providers produce an error, never a fabricated empty graph',async()=>{
 fakeFetch(()=>{throw Error('Provider offline');});
 const result=await request('/investigate?address='+root);
 assert.equal(result.status,503);
 assert.ok(result.json.error);
});
test('no qualifying transfers is explicitly a sample limitation',async()=>{
 fakeFetch((url)=>{
   const response=route(url);
   if(String(url).includes('/transactions'))return {data:{items:[]}};
   return response;
 });
 const result=await request('/investigate?address='+root);
 assert.equal(result.status,200);
 assert.equal(result.json.graph.edges.length,0);
 assert.match(result.json.conclusions[0],/sample/);
});
test('unknown paths do not trigger network requests',async()=>{
 fakeFetch(()=>{throw Error('Unexpected call');});
 const result=await request('/malformed');
 assert.equal(result.status,404);
});

test('transaction evidence resolves a verified hash without guessing wallet ownership',async()=>{
 fakeFetch((url)=>{
   const text=String(url);
   if(text.includes('/api/v2/transactions/0x'))return {data:{
     hash:hash('c'),from:{hash:root},to:{hash:parent},value:'1200000000000000000',
     timestamp:'2026-10-30T15:00:00Z',status:'ok',block:567
   }};
   throw Error('Unexpected request');
 });
 const result=await request('/transaction?hash='+hash('c')+'&network=ethereum');
 assert.equal(result.status,200);
 assert.equal(result.json.from.address,root);
 assert.equal(result.json.to.address,parent);
 assert.equal(result.json.native_value,'1.2');
 assert.ok(result.json.caveats.some(s=>s.includes('legal person')));
});
test('transaction hashes without a network-confirmed index response fail clearly',async()=>{
 fakeFetch(()=>({status:404,data:{error:'not found'}}));
 const result=await request('/transaction?hash='+hash('c')+'&network=base');
 assert.equal(result.status,404);
});

test('name search returns ENS candidates without claiming a real-world owner',async()=>{
 fakeFetch(url=>{
   const text=String(url);
   if(text.includes('search-domains')){
     const term=new URL(text).searchParams.get('q');
     return {data:{results:term==='vitalik'?[{
       name:'vitalik.eth',availability_status:'registered',
       ownership:{owner:'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'}
     }]:[]}};
   }
   throw Error('Unexpected lookup');
 });
 const result=await request('/name-search?q=Vitalik%20Buterin');
 assert.equal(result.status,200);
 assert.equal(result.json.results[0].ens_name,'vitalik.eth');
 assert.equal(result.json.results[0].confidence,'ens_domain_match_only');
 assert.match(result.json.scope,/not.*identify a legal person/i);
});
test('ENS resolution can use an independent resolver source when Blockscout is rate limited',async()=>{
 fakeFetch(url=>{
   const text=String(url);
   if(text.includes('bens.services.blockscout'))return {status:429,data:{}};
   if(text.includes('/api/domain/vitalik.eth/records'))return {data:{
     records:{addresses:{'60':'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'}}
   }};
   throw Error('Unexpected resolver path');
 });
 const result=await request('/resolve?name=vitalik.eth');
 assert.equal(result.status,200);
 assert.equal(result.json.address,'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
 assert.match(result.json.identity_claim,/public ENS record only/);
});
test('HTTP 429 never becomes a fabricated empty wallet history',async()=>{
 fakeFetch(()=>({status:429,data:{error:'Rate limit'}}));
 const result=await request('/lookup?address='+root);
 assert.equal(result.status,503);
 assert.match(result.json.error,/429/);
});

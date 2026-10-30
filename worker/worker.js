const API = "https://eth.blockscout.com/api/v2";
const ALLOWED_ORIGINS = new Set(["https://gcasaldi.github.io","http://localhost:8000","http://127.0.0.1:8000"]);
const ADDR = /^0x[a-fA-F0-9]{40}$/;
function cors(req) { const o = req.headers.get("Origin"); return { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(o) ? o : "https://gcasaldi.github.io", "Vary": "Origin", "Access-Control-Allow-Methods":"GET, OPTIONS", "Access-Control-Allow-Headers":"Content-Type", "Cache-Control":"public, max-age=60" }; }
function json(req, data, status=200) { return new Response(JSON.stringify(data), {status, headers:{"Content-Type":"application/json; charset=utf-8",...cors(req)}}); }
function err(message, status=400) { const e=new Error(message);e.status=status;throw e; }
async function query(path, timeoutMs=9500) {
 const controller = new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try {
  const res=await fetch(API+path,{headers:{"Accept":"application/json","User-Agent":"NODIVRA/0.2 public blockchain intelligence"},signal:controller.signal,cf:{cacheTtl:60,cacheEverything:true}});
  if(!res.ok) err("Blockscout API returned "+res.status,502);
  return await res.json();
 } finally { clearTimeout(timer); }
}
function endpoints(address) { const a="/addresses/"+encodeURIComponent(address);return {address:a, tx:a+"/transactions",token:a+"/token-transfers",internal:a+"/internal-transactions",counters:a+"/counters"}; }
function counterparty(tx, root) {
 const f=tx.from?.hash||null,t=tx.to?.hash||null;
 return (f?.toLowerCase()===root.toLowerCase()?t:f)||null;
}
function outgoing(tx, root) { return tx.from?.hash?.toLowerCase() === root.toLowerCase(); }
function summarize(root, transactions) {
 const connections = new Map();
 for(const tx of transactions){
   const cp=counterparty(tx,root);if(!cp || !ADDR.test(cp) || cp.toLowerCase()===root.toLowerCase())continue;
   const key=cp.toLowerCase();
   const label=(outgoing(tx,root)?tx.to?.name:tx.from?.name)||null;
   const entry=connections.get(key)||{address:cp,label:null,count:0,incoming:0,outgoing:0,first_observed:null,last_observed:null};
   entry.count++;
   if(outgoing(tx,root))entry.outgoing++;else entry.incoming++;
   if(label)entry.label=label;
   if(tx.timestamp && (!entry.first_observed || tx.timestamp<entry.first_observed))entry.first_observed=tx.timestamp;
   if(tx.timestamp && (!entry.last_observed || tx.timestamp>entry.last_observed))entry.last_observed=tx.timestamp;
   connections.set(key,entry);
 }
 return [...connections.values()].sort((a,b)=>b.count-a.count).slice(0,16);
}
async function profile(req, addr) {
 const ep=endpoints(addr);
 const jobs=[["account",ep.address],["transactions",ep.tx],["tokenTransfers",ep.token],["internalTransactions",ep.internal],["counters",ep.counters]];
 const outcomes=await Promise.allSettled(jobs.map(x=>query(x[1])));
 const result={address:addr,source:"Blockscout Ethereum API v2",updated_at:new Date().toISOString(),account:null,transactions:[],token_transfers:[],internal_transactions:[],counters:null,connections:[],errors:[]};
 outcomes.forEach((o,i)=>{
  const [name]=jobs[i];
  if(o.status==="rejected"){result.errors.push(name+": "+String(o.reason?.message||"Unavailable"));return;}
  const d=o.value;
  if(name==="account" || name==="counters")result[name]=d;
  else result[name==="tokenTransfers"?"token_transfers":name==="internalTransactions"?"internal_transactions":name]=(d && Array.isArray(d.items))?d.items.slice(0,50):[];
 });
 result.connections=summarize(addr,result.transactions);
 result.coverage="Recent indexed transactions and transfers only. Not a full history or verified attribution.";
 if(!result.account && !result.transactions.length && !result.token_transfers.length && !result.internal_transactions.length)err("Public blockchain data provider unavailable",503);
 return result;
}
async function origin(addr) {
 const ep=endpoints(addr);
 let path=ep.tx;let scanned=0, pages=0, oldest=null, earliestFunding=null, complete=false;
 const seen=new Set();
 while(pages<18) {
  const batch=await query(path,11000);
  const items=Array.isArray(batch.items)?batch.items:[];
  scanned+=items.length; pages++;
  for(const tx of items){
   if(tx.timestamp && (!oldest || tx.timestamp<oldest.timestamp))oldest={hash:tx.hash,timestamp:tx.timestamp,block:tx.block,from:tx.from?.hash||null,to:tx.to?.hash||null};
   if(tx.to?.hash?.toLowerCase()===addr.toLowerCase() && tx.from?.hash?.toLowerCase()!==addr.toLowerCase() && tx.value && BigInt(tx.value)>0n) {
    if(!earliestFunding||tx.timestamp<earliestFunding.timestamp)earliestFunding={hash:tx.hash,timestamp:tx.timestamp,from:tx.from.hash,value_wei:tx.value};
   }
  }
  const next=batch.next_page_params;
  if(!next||!items.length){complete=true;break;}
  const nextQS=new URLSearchParams(Object.entries(next).filter(([,v])=>v!=null).map(([k,v])=>[k,String(v)]));
  const nextPath=ep.tx+"?"+nextQS.toString();
  if(seen.has(nextPath))break;seen.add(nextPath);path=nextPath;
 }
 return {address:addr, source:"Blockscout Ethereum API v2",pages_scanned:pages,transactions_scanned:scanned,complete,earliest_transaction_observed:oldest,earliest_native_funding_observed:earliestFunding, warning:complete?"Earliest native funding is based on indexed external transactions; token and internal transfers may predate it.":"PARTIAL SCAN: Older transactions may exist. Do not report this as the first-ever funding transaction."};
}
export default {
 async fetch(req) {
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  if(req.method!=="GET")return json(req,{error:"Read-only API."},405);
  const url=new URL(req.url);
  if(url.pathname==="/health")return json(req,{ok:true,service:"NODIVRA read-only API",source:"Blockscout"});
  if(!["/lookup","/origin"].includes(url.pathname))return json(req,{error:"Not found"},404);
  const addr=url.searchParams.get("address")||"";
  if(!ADDR.test(addr))return json(req,{error:"Provide a valid Ethereum address."},400);
  try {
   const result=url.pathname==="/origin"?await origin(addr):await profile(req,addr);
   return json(req,result);
  } catch(e) {
   return json(req,{error:e.status===503?"Public provider temporarily unavailable. Retry later.":String(e.message||"Lookup failed."), provider:"Blockscout Ethereum"},e.status||502);
  }
 }
};
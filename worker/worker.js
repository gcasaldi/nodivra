// NODIVRA public-data gateway — read-only, no wallet signing and no identity guesses.
const BLOCKSCOUT = "https://eth.blockscout.com/api/v2";
const ETH_LABELS = "https://eth-labels.com/labels/";
const PUBLIC_RPCS = ["https://ethereum-rpc.publicnode.com","https://eth.drpc.org"];
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const ORIGINS = new Set(["https://gcasaldi.github.io","http://localhost:8000","http://127.0.0.1:8000"]);
function headers(request) {
  const origin = request.headers.get("Origin");
  return {"Access-Control-Allow-Origin":ORIGINS.has(origin)?origin:"https://gcasaldi.github.io","Vary":"Origin","Access-Control-Allow-Methods":"GET, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Cache-Control":"public, max-age=45"};
}
function reply(request, obj, status=200) {
  return new Response(JSON.stringify(obj),{status,headers:{"Content-Type":"application/json; charset=utf-8",...headers(request)}});
}
function failure(message,status=400) {const e=new Error(message);e.status=status;throw e;}
async function getJson(url,ms=8500) {
  const c=new AbortController(), timer=setTimeout(()=>c.abort(),ms);
  try {
    const res=await fetch(url,{signal:c.signal,headers:{"Accept":"application/json"},cf:{cacheEverything:true,cacheTtl:45}});
    if(!res.ok)failure("HTTP "+res.status,502);
    return await res.json();
  } finally {clearTimeout(timer);}
}
async function blockscout(path,ms=8500) {return getJson(BLOCKSCOUT+path,ms);}
async function rpcRead(address,endpoint) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8500);
  const calls=[
    {jsonrpc:"2.0",id:1,method:"eth_getBalance",params:[address,"latest"]},
    {jsonrpc:"2.0",id:2,method:"eth_getTransactionCount",params:[address,"latest"]},
    {jsonrpc:"2.0",id:3,method:"eth_getCode",params:[address,"latest"]}
  ];
  try {
    const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(calls),signal:controller.signal});
    if(!response.ok)failure("RPC HTTP "+response.status,502);
    const data=await response.json();
    if(!Array.isArray(data))failure("RPC returned invalid batch",502);
    const byId=new Map(data.map(item=>[item.id,item]));
    for(const id of [1,2,3]) if(typeof byId.get(id)?.result!=="string")failure("Incomplete RPC batch",502);
    return {coin_balance:BigInt(byId.get(1).result).toString(),outgoing_nonce:BigInt(byId.get(2).result).toString(),
      is_contract:byId.get(3).result!=="0x" && byId.get(3).result!=="0x0",provider:endpoint};
  } finally {clearTimeout(timer);}
}
async function reliableRpc(address) {
  const errors=[];
  for(const endpoint of PUBLIC_RPCS) {
    try{return await rpcRead(address,endpoint);}catch(e){errors.push(endpoint+": "+String(e.message||"unavailable"));}
  }
  failure("Public RPC unavailable: "+errors.join("; "),503);
}
function statusOf(outcome) {return outcome.status==="fulfilled"?"ok":"unavailable";}
function tags(account) {
  const all=[];
  if(account?.name) all.push({name:String(account.name),kind:"Public explorer name tag",source:"Blockscout",source_url:"https://eth.blockscout.com/address/"+account.hash,confidence:"source_label"});
  if(account?.ens_domain_name) all.push({name:String(account.ens_domain_name),kind:"ENS reverse name",source:"Blockscout",source_url:"https://app.ens.domains/"+encodeURIComponent(account.ens_domain_name),confidence:"user_set_name"});
  for(const tag of Array.isArray(account?.public_tags)?account.public_tags:[]) {
    const label=tag?.label||tag?.name||tag?.display_name;
    if(label)all.push({name:String(label),kind:"Public classification",source:"Blockscout",source_url:"https://eth.blockscout.com/address/"+account.hash,confidence:"source_label"});
  }
  if(account?.is_scam===true||account?.reputation==="scam")all.push({name:"Flagged by explorer",kind:"Risk flag · not a finding of guilt",source:"Blockscout",source_url:"https://eth.blockscout.com/address/"+account.hash,confidence:"provider_flag"});
  return all;
}
function normalizeLabels(rows,address) {
  if(!Array.isArray(rows))return [];
  const entries=[];
  for(const item of rows) {
    if(typeof item!=="object"||item===null)continue;
    const hash=item.address||item.hash||item.wallet_address||item.address_hash;
    const chain=item.chainId ?? item.chain_id;
    if(typeof hash!=="string"||hash.toLowerCase()!==address.toLowerCase())continue;
    if(chain!==undefined&&String(chain)!=="1")continue;
    const title=item.nameTag||item.name_tag||item.name||item.label;
    if(typeof title==="string" && title.trim()) entries.push({name:title.trim().slice(0,100),kind:"Community label · unverified",source:"eth-labels open dataset",source_url:"https://eth-labels.com/labels/"+address,confidence:"community_label"});
    if(Array.isArray(item.labels))for(const value of item.labels.slice(0,6)) if(typeof value==="string")entries.push({name:value.slice(0,100),kind:"Community category · unverified",source:"eth-labels open dataset",source_url:"https://eth-labels.com/labels/"+address,confidence:"community_label"});
  }
  return entries;
}
function deduplicate(items) {
  const seen=new Set();
  return items.filter(item=>{const k=item.source+"|"+item.kind+"|"+item.name.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;}).slice(0,18);
}
function summarize(address,transactions) {
  const map=new Map();
  for(const tx of transactions) {
    const from=tx.from?.hash,to=tx.to?.hash;
    if(!from||!to||!ADDRESS.test(from)||!ADDRESS.test(to))continue;
    const outgoing=from.toLowerCase()===address.toLowerCase();
    const peer=outgoing?tx.to:tx.from;
    if(peer.hash.toLowerCase()===address.toLowerCase())continue;
    const key=peer.hash.toLowerCase();
    const item=map.get(key)||{address:peer.hash,label:null,source:null,count:0,incoming:0,outgoing:0,last_observed:null};
    item.count++;
    if(outgoing)item.outgoing++;else item.incoming++;
    const label=peer.name||peer.ens_domain_name||null;
    if(label){item.label=String(label);item.source="Blockscout transaction metadata";}
    if(tx.timestamp&&(!item.last_observed||tx.timestamp>item.last_observed))item.last_observed=tx.timestamp;
    map.set(key,item);
  }
  return [...map.values()].sort((a,b)=>b.count-a.count).slice(0,16);
}
async function investigate(address) {
  const base="/addresses/"+encodeURIComponent(address);
  const tasks={
    account:blockscout(base),transactions:blockscout(base+"/transactions"),
    token_transfers:blockscout(base+"/token-transfers"),internal_transactions:blockscout(base+"/internal-transactions"),
    counters:blockscout(base+"/counters"),
    labels:getJson(ETH_LABELS+encodeURIComponent(address),7000)
  };
  const keys=Object.keys(tasks);
  const outcomes=await Promise.allSettled(keys.map(k=>tasks[k]));
  const values={};const source_status={};const errors=[];
  keys.forEach((k,i)=>{
    const o=outcomes[i];
    source_status[k]=statusOf(o);
    if(o.status==="fulfilled")values[k]=o.value;
    else errors.push(k+": "+String(o.reason?.message||"unavailable"));
  });
  const account=values.account && typeof values.account==="object" && values.account.hash?.toLowerCase()===address.toLowerCase()?values.account:null;
  if(values.account && !account){source_status.account="invalid_response";errors.push("Blockscout address metadata could not be verified.");}
  const usableAccount=account && (typeof account.coin_balance==="string" || typeof account.is_contract==="boolean");
  let accountSource=usableAccount?"Blockscout":null,rpc=null;
  if(!usableAccount) {
    try {rpc=await reliableRpc(address);accountSource=rpc.provider;source_status.rpc="ok";} catch(e){source_status.rpc="unavailable";errors.push(String(e.message));}
  } else source_status.rpc="not_needed";
  const effectiveAccount=usableAccount?account:rpc?{hash:address,is_contract:rpc.is_contract,coin_balance:rpc.coin_balance,nonce:rpc.outgoing_nonce}:null;
  const indexPresent=source_status.transactions==="ok"||source_status.token_transfers==="ok"||source_status.internal_transactions==="ok";
  if(!effectiveAccount && !indexPresent)failure("Blockchain sources unavailable; no reliable result could be verified.",503);
  const indexed=name=> source_status[name]==="ok"&&Array.isArray(values[name]?.items) ? values[name].items.slice(0,50):null;
  const transactions=indexed("transactions"),tokenTransfers=indexed("token_transfers"),internal=indexed("internal_transactions");
  const community=normalizeLabels(values.labels,address);
  const publicTags=deduplicate([...tags(account),...community]);
  const traceStatus = !indexPresent ? "unavailable" : (transactions?.length || tokenTransfers?.length || internal?.length) ? "observed_activity" : "no_indexed_activity_in_sample";
  return {address,chain:"Ethereum Mainnet",chain_id:1,source:"NODIVRA · Blockscout + PublicNode/dRPC + eth-labels",
     checked_at:new Date().toISOString(),account:effectiveAccount,account_source:accountSource,
     transactions,token_transfers:tokenTransfers,internal_transactions:internal,counters:values.counters||null,
     connections:summarize(address,transactions||[]),public_attributions:publicTags,
     identity_status:publicTags.length?"public_labels_only":"no_public_attribution_found",
     trace_status:traceStatus,source_status,errors,
     notice:"An address is not a verified human identity. Explorer or community tags are clues with linked sources, not proof of legal ownership."};
}
async function origin(address) {
  const base="/addresses/"+encodeURIComponent(address)+"/transactions";
  let path=base,scanned=0,pages=0,oldest=null,funding=null,complete=false;
  const paths=new Set();
  while(pages<12) {
    const page=await blockscout(path,9500);
    if(!Array.isArray(page.items))failure("Indexer returned invalid transaction list.",502);
    scanned+=page.items.length;pages++;
    for(const t of page.items) {
      if(t.timestamp&&(!oldest||t.timestamp<oldest.timestamp))
        oldest={hash:t.hash,timestamp:t.timestamp,from:t.from?.hash||null,to:t.to?.hash||null};
      if(t.to?.hash?.toLowerCase()===address.toLowerCase()&&t.from?.hash?.toLowerCase()!==address.toLowerCase()&&t.value&&BigInt(t.value)>0n&&t.timestamp&&(!funding||t.timestamp<funding.timestamp))
        funding={hash:t.hash,timestamp:t.timestamp,from:t.from.hash,value_wei:t.value};
    }
    if(!page.items.length||!page.next_page_params){complete=true;break;}
    const params=new URLSearchParams();
    for(const [k,v] of Object.entries(page.next_page_params))if(v!==null&&v!==undefined)params.set(k,String(v));
    const next=base+"?"+params.toString();
    if(paths.has(next))break;
    paths.add(next);path=next;
  }
  return {address,source:"Blockscout",transactions_scanned:scanned,pages_scanned:pages,complete,
    earliest_transaction_observed:oldest,earliest_native_funding_observed:funding,
    warning:complete?"Oldest indexed external transactions reached. ERC-20/internal/other-chain funding not included.":"PARTIAL SCAN: Earlier funding may exist. Never treat this as proven first funding."};
}
async function resolveEns(name) {
  const safe=String(name||"").toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]{0,62}\.eth$/.test(safe))failure("Enter an ENS name ending in .eth",400);
  const result=await getJson("https://bens.services.blockscout.com/api/v1/1/domains/"+encodeURIComponent(safe));
  const address=typeof result.resolved_address==="string"?result.resolved_address:result.resolved_address?.hash||null;
  if(!ADDRESS.test(address||""))failure("No public Ethereum address record for this ENS name",404);
  return {name:safe,address,source:"Blockscout ENS"};
}
export default {
 async fetch(request) {
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:headers(request)});
  if(request.method!=="GET")return reply(request,{error:"Read-only API"},405);
  const u=new URL(request.url),path=u.pathname;
  if(path==="/health")return reply(request,{ok:true,service:"NODIVRA",providers:["Blockscout","PublicNode","dRPC","eth-labels"]});
  if(!["/lookup","/origin","/resolve"].includes(path))return reply(request,{error:"Not found"},404);
  try{
   if(path==="/resolve")return reply(request,await resolveEns(u.searchParams.get("name")));
   const address=u.searchParams.get("address")||"";
   if(!ADDRESS.test(address))failure("Provide exactly 40 hexadecimal digits after 0x",400);
   return reply(request,path==="/origin"?await origin(address):await investigate(address));
  }catch(e){return reply(request,{error:e.status===503?"Public data sources unavailable; please try again.":String(e.message||"Lookup failed")},e.status||502);}
 }
};

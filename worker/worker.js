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
    if(!res.ok)failure(res.status===429?"Public indexer rate limit (HTTP 429); transaction data temporarily unavailable.":"HTTP "+res.status,res.status===429?503:502);
    return await res.json();
  } finally {clearTimeout(timer);}
}
async function blockscout(path,ms=8500) {return getJson(BLOCKSCOUT+path,ms);}
async function rpcRead(address,endpoint,expectedChainId=1) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8500);
  const calls=[
    {jsonrpc:"2.0",id:1,method:"eth_getBalance",params:[address,"latest"]},
    {jsonrpc:"2.0",id:2,method:"eth_getTransactionCount",params:[address,"latest"]},
    {jsonrpc:"2.0",id:3,method:"eth_getCode",params:[address,"latest"]},
    {jsonrpc:"2.0",id:4,method:"eth_chainId",params:[]}
  ];
  try {
    const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(calls),signal:controller.signal});
    if(!response.ok)failure("RPC HTTP "+response.status,502);
    const data=await response.json();
    if(!Array.isArray(data))failure("RPC returned invalid batch",502);
    const byId=new Map(data.map(item=>[item.id,item]));
    for(const id of [1,2,3,4]) if(typeof byId.get(id)?.result!=="string")failure("Incomplete RPC batch",502);
    if(BigInt(byId.get(4).result)!==BigInt(expectedChainId))failure("RPC chain ID mismatch",502);
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

function provenanceFromSample(address, transactions, tokens, internals) {
 const all=[];
 for(const tx of transactions||[]) {
  if(tx?.to?.hash?.toLowerCase()!==address.toLowerCase() || tx?.from?.hash?.toLowerCase()===address.toLowerCase())continue;
  if(!tx.from?.hash || !tx.timestamp || !tx.hash)continue;
  const wei=String(tx.value||"0");if(!/^\d+$/.test(wei) || BigInt(wei)===0n)continue;
  all.push({asset:"ETH",from:tx.from.hash,from_name:tx.from.name||tx.from.ens_domain_name||null,tx_hash:tx.hash,
    timestamp:tx.timestamp,amount_base_units:wei,source:"Blockscout · recent external transactions",classification:"observed incoming transfer (not necessarily first funding)"});
 }
 for(const transfer of tokens||[]) {
   if(transfer?.to?.hash?.toLowerCase()!==address.toLowerCase() || transfer?.from?.hash?.toLowerCase()===address.toLowerCase())continue;
   if(!transfer?.from?.hash||!transfer.timestamp||!transfer.transaction_hash)continue;
   all.push({asset:String(transfer.token?.symbol||"Token").slice(0,25),from:transfer.from.hash,
    from_name:transfer.from.name||transfer.from.ens_domain_name||null,tx_hash:transfer.transaction_hash,
    timestamp:transfer.timestamp,amount_base_units:String(transfer.total?.value||""),source:"Blockscout · recent token events",
    classification:"observed token inbound (may not be original wallet funding)"});
 }
 for(const tx of internals||[]) {
   if(tx?.to?.hash?.toLowerCase()!==address.toLowerCase() || tx?.from?.hash?.toLowerCase()===address.toLowerCase())continue;
   if(!tx.from?.hash||!tx.timestamp||!tx.transaction_hash)continue;
   all.push({asset:"ETH · internal",from:tx.from.hash,from_name:tx.from.name||tx.from.ens_domain_name||null,
    tx_hash:tx.transaction_hash,timestamp:tx.timestamp,amount_base_units:String(tx.value||""),
    source:"Blockscout · internal movements",classification:"observed internal transfer (not necessarily first funding)"});
 }
 all.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 return {earliest_in_sample:all[0]||null,first_visible_funders:[...new Map(all.filter(t=>t.from).map(t=>[t.from.toLowerCase(),t])).values()].slice(0,8),
  events_examined:all.length,coverage:"Recent index pages only. Not a complete blockchain history. Use Trace Origin for bounded older external transaction scanning."};
}
function classifyEvidence(address,account,txs,tokenTransfers,internals,rawCounters,accountSource,publicLabels,sourceStatus,insights) {
 const status=sourceStatus||{};
 const readableCounts=rawCounters&&typeof rawCounters==="object"?{
  external: /^\d+$/.test(String(rawCounters.transactions_count??""))?String(rawCounters.transactions_count):null,
  tokens:/^\d+$/.test(String(rawCounters.token_transfers_count??""))?String(rawCounters.token_transfers_count):null
 }: {external:null,tokens:null};
 const indexed=[txs,tokenTransfers,internals].filter(Array.isArray);
 const activity=indexed.some(a=>a.length>0);
 const accountKnown=!!account&&typeof account.is_contract==="boolean";
 let category=accountKnown?(account.is_contract?"Smart contract":"Externally owned address (EOA)"):"Unknown account type";
 if(account?.is_contract && account?.name)category+=" · "+account.name;
 let confidence="limited";
 if(publicLabels.some(t=>t.kind==="Public explorer name tag"))confidence="public explorer tag";
 else if(publicLabels.length)confidence="public labels (unverified)";
 const observedOnly=!activity&&!publicLabels.length;
 const notices=[];
 if(observedOnly)notices.push("No indexed events or public labels were returned for this exact address. This is not evidence of a hidden owner.");
 if(account?.coin_balance===null||account?.coin_balance===undefined)notices.push("Current ETH balance could not be independently verified.");
 if(!accountSource)notices.push("Account source unavailable.");
 if(status.transactions!=="ok")notices.push("External transaction history not available; do not interpret missing rows as zero activity.");
 if(publicLabels.length)notices.push("Public labels can indicate a service or self-declared identity; they are not proof of legal ownership.");
 let summary=observedOnly?
  "No usable public activity or attribution found for this exact address in the consulted sample. Verify the address and chain before drawing conclusions.":
  publicLabels.length? "Publicly labeled Ethereum address. Review the linked source and transaction counterparties before attributing control.":
  "On-chain activity observed. Transaction counterparties and funding leads are available, but the legal owner remains unknown.";
 return {network:"Ethereum mainnet",account_category:category,owner:"Not independently identified",attribution_level:confidence,
  summary,activity_observed:activity,public_label_count:publicLabels.length,counts:readableCounts,
  sample:{external:txs?.length??null,token:tokenTransfers?.length??null,internal:internals?.length??null},
  funding_lead:insights?.earliest_in_sample||null,limitations:notices,
  verification_links:[
   {title:"Blockscout explorer",url:"https://eth.blockscout.com/address/"+address},
   {title:"Etherscan explorer",url:"https://etherscan.io/address/"+address},
   {title:"ENS lookup",url:"https://app.ens.domains/"+address},
   {title:"Arkham Intelligence (independent search)",url:"https://intel.arkm.com/explorer/address/"+address}
  ]};
}
async function peerEvidence(address,connections) {
 const candidates=connections.slice(0,4);
 const results=await Promise.allSettled(candidates.map(async item=>{
   const data=await blockscout("/addresses/"+encodeURIComponent(item.address),6000);
   const labels=tags(data);
   return {...item,account_type: typeof data.is_contract==="boolean"?(data.is_contract?"Contract":"EOA"):"Unconfirmed",
     public_label:labels[0]?.name||item.label||null,label_source:labels[0]?.source||item.source||null,
     labels:labels.slice(0,3),risk_flag:data.is_scam===true||data.reputation==="scam" ? "Explorer flag — verify independently":null};
 }));
 return results.map((r,i)=>r.status==="fulfilled"?r.value:{...candidates[i],account_type:"Unconfirmed",public_label:candidates[i].label||null,label_source:candidates[i].source||null,labels:[],enrichment_status:"Unavailable"});
}

async function investigate(address) {
  const base="/addresses/"+encodeURIComponent(address);
  const tasks={
    account:()=>blockscout(base),transactions:()=>blockscout(base+"/transactions"),
    token_transfers:()=>blockscout(base+"/token-transfers"),internal_transactions:()=>blockscout(base+"/internal-transactions"),
    counters:()=>blockscout(base+"/counters"),
    labels:()=>getJson(ETH_LABELS+encodeURIComponent(address),7000)
  };
  const keys=Object.keys(tasks);
  // Avoid a six-request burst against the same public indexer.
  const first=await Promise.allSettled(keys.slice(0,2).map(k=>tasks[k]()));
  const remaining=await Promise.allSettled(keys.slice(2).map(k=>tasks[k]()));
  const outcomes=[...first,...remaining];
  const values={};const source_status={};const errors=[];
  keys.forEach((k,i)=>{
    const o=outcomes[i];
    source_status[k]=statusOf(o);
    if(o.status==="fulfilled")values[k]=o.value;
    else errors.push(k+": "+String(o.reason?.message||"unavailable"));
  });
  const account=values.account && typeof values.account==="object" && values.account.hash?.toLowerCase()===address.toLowerCase()?values.account:null;
  if(values.account && !account){source_status.account="invalid_response";errors.push("Blockscout address metadata could not be verified.");}
  const usableAccount=account && typeof account.coin_balance==="string" && /^\d+$/.test(account.coin_balance) && typeof account.is_contract==="boolean";
  let accountSource=usableAccount?"Blockscout":null,rpc=null;
  if(!usableAccount) {
    try {rpc=await reliableRpc(address);accountSource=rpc.provider;source_status.rpc="ok";} catch(e){source_status.rpc="unavailable";errors.push(String(e.message));}
  } else source_status.rpc="not_needed";
  const effectiveAccount=usableAccount?account:rpc?{hash:address,is_contract:rpc.is_contract,coin_balance:rpc.coin_balance,nonce:rpc.outgoing_nonce}:null;
  const indexPresent=source_status.transactions==="ok"||source_status.token_transfers==="ok"||source_status.internal_transactions==="ok";
  if(!effectiveAccount && !indexPresent){
   const limited=errors.some(e=>/429|rate limit/i.test(e));
   failure(limited?"Public blockchain indexer rate limited (HTTP 429). The transaction history is temporarily unavailable.":"Blockchain sources unavailable; no reliable result could be verified.",503);
  }
  const indexed=name=> source_status[name]==="ok"&&Array.isArray(values[name]?.items) ? values[name].items.slice(0,50):null;
  const transactions=indexed("transactions"),tokenTransfers=indexed("token_transfers"),internal=indexed("internal_transactions");
  const community=normalizeLabels(values.labels,address);
  const publicTags=deduplicate([...tags(account),...community]);
  const traceStatus = !indexPresent ? "unavailable" : (transactions?.length || tokenTransfers?.length || internal?.length) ? "observed_activity" : "no_indexed_activity_in_sample";

  const provenance=provenanceFromSample(address,transactions,tokenTransfers,internal);
  const peers=summarize(address,transactions||[]);
  const enrichedPeers=peers.length?await peerEvidence(address,peers):[];
  const intelligence=classifyEvidence(address,effectiveAccount,transactions,tokenTransfers,internal,values.counters,
     accountSource,publicTags,source_status,provenance);
  return {address,chain:"Ethereum Mainnet",chain_id:1,source:"NODIVRA · Blockscout + PublicNode/dRPC + eth-labels",
     checked_at:new Date().toISOString(),account:effectiveAccount,account_source:accountSource,
     transactions,token_transfers:tokenTransfers,internal_transactions:internal,counters:values.counters||null,
     connections:peers,linked_entities:enrichedPeers,provenance,intelligence,public_attributions:publicTags,
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
 try {
  const result=await getJson("https://bens.services.blockscout.com/api/v1/1/domains/"+encodeURIComponent(safe),8000);
  const address=typeof result.resolved_address==="string"?result.resolved_address:result.resolved_address?.hash||null;
  if(ADDRESS.test(address||""))return {name:safe,address,source:"Blockscout ENS resolver",identity_claim:"public ENS record only"};
 }catch(e){} // One failed public provider does not prove the ENS record is absent.
 try{
  const result=await getJson("https://api.enswhois.com/api/domain/"+encodeURIComponent(safe)+"/records",8000);
  const addresses=result?.records?.addresses||{};
  const record=addresses["60"]||addresses.ethereum||null;
  const address=typeof record==="string"?record:record?.address||null;
  if(ADDRESS.test(address||""))return {name:safe,address,source:"ENSWhois current resolver records",identity_claim:"public ENS record only"};
 }catch(e){failure("ENS resolver unavailable or rate limited; retry later.",503);}
 failure("No public Ethereum payment address currently resolved for this ENS name.",404);
}

// Cross-chain exploration: independently sourced indexer samples, not a universal wallet database.
const NETWORKS = [
 {id:"ethereum",name:"Ethereum",symbol:"ETH",explorer:"https://eth.blockscout.com",chain_id:1},
 {id:"base",name:"Base",symbol:"ETH",explorer:"https://base.blockscout.com",chain_id:8453},
 {id:"arbitrum",name:"Arbitrum One",symbol:"ETH",explorer:"https://arbitrum.blockscout.com",chain_id:42161},
 {id:"optimism",name:"OP Mainnet",symbol:"ETH",explorer:"https://optimism.blockscout.com",chain_id:10},
 {id:"polygon",name:"Polygon PoS",symbol:"POL",explorer:"https://polygon.blockscout.com",chain_id:137}
];

const EVM_PUBLIC_RPCS={
 ethereum:["https://ethereum-rpc.publicnode.com","https://eth.drpc.org"],
 base:["https://base-rpc.publicnode.com","https://base.drpc.org"],
 arbitrum:["https://arbitrum-one-rpc.publicnode.com","https://arbitrum.drpc.org"],
 optimism:["https://optimism-rpc.publicnode.com","https://optimism.drpc.org"],
 polygon:["https://polygon-bor-rpc.publicnode.com","https://polygon.drpc.org"]
};
function formattedNative(wei){
 const n=BigInt(wei),whole=n/1000000000000000000n;
 const frac=(n%1000000000000000000n).toString().padStart(18,"0").slice(0,6).replace(/0+$/,"");
 return whole.toString()+(frac?"."+frac:"");
}
async function partialRpcFallback(answer,network,address){
 const endpoints=EVM_PUBLIC_RPCS[network.id]||[];
 for(const endpoint of endpoints){
   try {
     const verified=await rpcRead(address,endpoint,network.chain_id);
     answer.native_balance_wei=verified.coin_balance;
     answer.native_balance=formattedNative(verified.coin_balance);
     answer.account_type=verified.is_contract?"Smart contract":"EOA";
     answer.checks.rpc="ok";
     answer.rpc_provider=endpoint;
     answer.status="rpc_partial";
     answer.warnings.unshift("Explorer indexing unavailable. RPC confirms current balance and code only; transaction and token history is NOT verified.");
     return answer;
   } catch(e){answer.warnings.push("RPC backup "+endpoint+" unavailable: "+String(e.message).slice(0,70));}
 }
 answer.checks.rpc="unavailable";
 return answer;
}

const BTC = /^(?:bc1[ac-hj-np-z02-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
async function networkRequest(base,path,ms=8000) {
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),ms);
 try {
  const res=await fetch(base+path,{signal:c.signal,headers:{"Accept":"application/json"},cf:{cacheTtl:55,cacheEverything:true}});
  if(res.status===404)return {missing:true};
  if(!res.ok)throw Error("HTTP "+res.status);
  return await res.json();
 }finally{clearTimeout(timer);}
}
function normalizeAsset(row) {
 const token=row?.token||{};
 const decimals=Number(token.decimals);
 const value=String(row?.value||"0");
 const valid=/^\d+$/.test(value)&&Number.isInteger(decimals)&&decimals>=0&&decimals<=36;
 if(!valid)return null;
 if(BigInt(value)===0n)return null;
 const scale=10n**BigInt(decimals);
 const raw=BigInt(value);
 const whole=raw/scale, frac=(raw%scale).toString().padStart(decimals,"0").slice(0,6).replace(/0+$/,"");
 return {symbol:String(token.symbol||"TOKEN").slice(0,20),name:String(token.name||"Unverified token").slice(0,80),
  contract:String(token.address_hash||"").slice(0,44),type:String(token.type||"ERC-20"),
  amount:whole.toString()+(frac?"."+frac:""),source:"Blockscout indexed token balance",
  note:"Token metadata is unverified; spam tokens and misleading symbols are possible."};
}
async function scanEvmNetwork(network,address) {
 const base=network.explorer+"/api/v2",uri="/addresses/"+encodeURIComponent(address);
 const answer={id:network.id,name:network.name,chain_id:network.chain_id,symbol:network.symbol,
   explorer_url:network.explorer+"/address/"+address,status:"unavailable",native_balance_wei:null,
   native_balance:null,assets:[],transaction_count:null,recent_transactions:[],
   public_labels:[],account_type:"Unknown",checks:{account:"unavailable",tokens:"unavailable",transactions:"unavailable"},warnings:[]};
 let account=null;
 try{
   const data=await networkRequest(base,uri);
   if(data.missing){answer.status="not_indexed";answer.checks.account="not_indexed";answer.warnings.push("No public address record returned by this indexer; activity elsewhere is not excluded.");return await partialRpcFallback(answer,network,address);}
   if(data&&typeof data==="object" && data.hash?.toLowerCase()===address.toLowerCase()){account=data;answer.checks.account="ok";}
   else {answer.warnings.push("Explorer account response did not match the queried address.");return await partialRpcFallback(answer,network,address);}
 }catch(e){answer.warnings.push("Account lookup unavailable: "+String(e.message).slice(0,100));return await partialRpcFallback(answer,network,address);}
 if(typeof account.coin_balance==="string" && /^\d+$/.test(account.coin_balance)){
  answer.native_balance_wei=account.coin_balance;
  answer.native_balance=formattedNative(account.coin_balance);
 }
 if(typeof account.is_contract==="boolean")answer.account_type=account.is_contract?"Smart contract":"EOA";
 if(account.name)answer.public_labels.push({label:String(account.name),type:"Explorer name tag",source:network.explorer+"/address/"+address});
 if(account.ens_domain_name)answer.public_labels.push({label:String(account.ens_domain_name),type:"ENS name",source:network.explorer+"/address/"+address});
 const [tokenResponse,txResponse]=await Promise.allSettled([
  networkRequest(base,uri+"/token-balances",7500),networkRequest(base,uri+"/transactions",7500)
 ]);
 if(tokenResponse.status==="fulfilled"){
  const raw=tokenResponse.value;
  if(Array.isArray(raw)){answer.checks.tokens="ok";answer.assets=raw.map(normalizeAsset).filter(Boolean).slice(0,15);}
  else{answer.warnings.push("Token balances not available in the expected format.");}
 }else answer.warnings.push("Token balances temporarily unavailable.");
 if(txResponse.status==="fulfilled"&&Array.isArray(txResponse.value.items)){
  answer.checks.transactions="ok";
  answer.recent_transactions=txResponse.value.items.slice(0,8).map(tx=>({hash:tx.hash,from:tx.from?.hash||null,to:tx.to?.hash||null,timestamp:tx.timestamp||null,value_wei:String(tx.value||"0"),source:network.explorer+"/tx/"+tx.hash}));
 }else answer.warnings.push("Recent transactions unavailable from this indexer.");
 const hasActivity=BigInt(answer.native_balance_wei||"0")>0n||answer.assets.length>0||answer.recent_transactions.length>0;
 answer.status=hasActivity?"activity_observed":"indexed_no_sample_activity";
 return answer;
}
async function scanEvm(address) {
 const results=[];
 for(let i=0;i<NETWORKS.length;i+=2){
  const batch=await Promise.allSettled(NETWORKS.slice(i,i+2).map(n=>scanEvmNetwork(n,address)));
  results.push(...batch);
 }
 const networks=results.map((r,i)=>r.status==="fulfilled"?r.value:({id:NETWORKS[i].id,name:NETWORKS[i].name,
  symbol:NETWORKS[i].symbol,explorer_url:NETWORKS[i].explorer+"/address/"+address,status:"unavailable",
  assets:[],native_balance:null,transaction_count:null,recent_transactions:[],public_labels:[],warnings:[String(r.reason?.message||"Service unavailable")]}));
 const observed=networks.filter(n=>n.status==="activity_observed").map(n=>n.name);
 const tagged=networks.flatMap(n=>(n.public_labels||[]).map(tag=>({...tag,network:n.name})));
 const checked=networks.filter(n=>n.checks?.account==="ok"||n.checks?.rpc==="ok").length;
 const rpcOnly=networks.filter(n=>n.status==="rpc_partial").map(n=>n.name);
 return {address,format:"evm",network_scope:NETWORKS.map(n=>n.name),networks,
  discovery:{active_networks_observed:observed,labels:tagged,checked_networks:checked,total_networks:NETWORKS.length,
   summary:observed.length?"Observed assets or transfers on "+observed.join(", ")+".":rpcOnly.length?"Explorer indexing limited. Read-only RPC balance/type verified for "+rpcOnly.join(", ")+", but transaction activity is unknown.":"No indexed activity was returned on responding networks. Missing provider data must not be interpreted as zero activity.",
   goal:"Follow documented transfers and labels; this is not proof that one person controls every activity."},
  limitations:"This scans five supported EVM networks, not all blockchains. An EVM address is valid on multiple networks without a registration event. Native and token quantities are not an aggregate USD portfolio. Public API coverage may be incomplete.",
  checked_at:new Date().toISOString()};
}
async function scanBitcoin(address) {
 const root="https://mempool.space/api/address/"+encodeURIComponent(address);
 const [info,txs]=await Promise.allSettled([networkRequest("",root,10000),networkRequest("",root+"/txs",10000)]);
 if(info.status!=="fulfilled" || !info.value?.chain_stats)failure("Bitcoin indexer unavailable or address not recognized.",502);
 const chain=info.value.chain_stats,mempool=info.value.mempool_stats||{};
 const balance=BigInt(chain.funded_txo_sum||0)-BigInt(chain.spent_txo_sum||0)+BigInt(mempool.funded_txo_sum||0)-BigInt(mempool.spent_txo_sum||0);
 const txList=txs.status==="fulfilled"&&Array.isArray(txs.value)?txs.value:[];
 const recent=txList.slice(0,8).map(tx=>({hash:tx.txid,timestamp:tx.status?.block_time?new Date(tx.status.block_time*1000).toISOString():null,
   source:"https://mempool.space/tx/"+tx.txid,status:tx.status?.confirmed?"confirmed":"unconfirmed"}));
 return {address,format:"bitcoin",network_scope:["Bitcoin mainnet"],networks:[{
 id:"bitcoin",name:"Bitcoin",symbol:"BTC",explorer_url:"https://mempool.space/address/"+encodeURIComponent(address),
 status: Number(chain.tx_count||0)>0?"activity_observed":"indexed_no_sample_activity",
 native_balance_sats:balance.toString(),native_balance:(balance<0n?"-":"")+(balance<0n?-balance:balance)/100000000n+"."+((balance<0n?-balance:balance)%100000000n).toString().padStart(8,"0"),
 transaction_count:Number(chain.tx_count||0),recent_transactions:recent,assets:[],public_labels:[],
 warnings:["An address is not a person. Bitcoin funds belong to transaction outputs; one transaction can have multiple inputs and outputs."],
 checks:{account:"ok",transactions:txs.status==="fulfilled"?"ok":"unavailable",tokens:"not_applicable"}
 }],discovery:{active_networks_observed:chain.tx_count?["Bitcoin"]:[],labels:[],checked_networks:1,total_networks:1,
 summary:chain.tx_count?"Bitcoin transaction activity found. Explore the public transaction history to investigate spending and funding.":"No confirmed Bitcoin transactions indexed for this address.",
 goal:"Transaction-level Bitcoin analysis; no identity inference from transaction inputs alone."},
 limitations:"Bitcoin address search does not identify a whole wallet or all addresses derived from the same keys. Token balances and cross-chain identity cannot be inferred.",checked_at:new Date().toISOString()};
}


const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
async function solanaMethod(method,params) {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8500);
 try {
  const response=await fetch(SOLANA_RPC,{method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:controller.signal});
  if(!response.ok)throw Error("Solana RPC HTTP "+response.status);
  const obj=await response.json();
  if(obj.error)throw Error("Solana RPC: "+String(obj.error.message||"unavailable"));
  if(obj.result===null || obj.result===undefined)throw Error("Solana RPC empty result");
  return obj.result;
 }finally{clearTimeout(timer);}
}
async function scanSolana(address) {
 const TOKEN_PROGRAM="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
 const TOKEN_2022="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
 const calls=await Promise.allSettled([
  solanaMethod("getBalance",[address,{commitment:"confirmed"}]),
  solanaMethod("getSignaturesForAddress",[address,{limit:10,commitment:"confirmed"}]),
  solanaMethod("getTokenAccountsByOwner",[address,{programId:TOKEN_PROGRAM},{encoding:"jsonParsed",commitment:"confirmed"}]),
  solanaMethod("getTokenAccountsByOwner",[address,{programId:TOKEN_2022},{encoding:"jsonParsed",commitment:"confirmed"}])
 ]);
 const val=i=>calls[i].status==="fulfilled"?calls[i].value:null;
 const value=val(0);
 const lamports=typeof value?.value==="number" && Number.isSafeInteger(value.value)?String(value.value):null;
 const signatures=Array.isArray(val(1))?val(1):null;
 const assets=[];
 for(const i of [2,3])for(const item of Array.isArray(val(i)?.value)?val(i).value:[]) {
  const info=item?.account?.data?.parsed?.info,tokenAmount=info?.tokenAmount;
  if(!tokenAmount || !/^\d+$/.test(String(tokenAmount.amount||""))||BigInt(String(tokenAmount.amount))===0n)continue;
  assets.push({symbol:"SPL token",name:"Token mint "+String(info?.mint||"unknown").slice(0,10)+"…",
    contract:String(info?.mint||""),type:i===3?"Token-2022":"SPL",
    amount:String(tokenAmount.uiAmountString||"0"),source:"Solana RPC · on-chain token account",
    note:"No trusted token ticker mapping. Token mint must be checked independently."});
 }
 if(lamports===null && signatures===null && calls.slice(2).every(v=>v.status==="rejected"))
   failure("Solana public RPC unavailable for this address.",503);
 const observed=(lamports!==null&&BigInt(lamports)>0n)||assets.length>0||(signatures?.length||0)>0;
 const network={id:"solana",name:"Solana",symbol:"SOL",explorer_url:"https://solscan.io/account/"+address,
  status:observed?"activity_observed":"indexed_no_sample_activity",
  native_balance:lamports!==null?(BigInt(lamports)/1000000000n).toString()+"."+String(BigInt(lamports)%1000000000n).padStart(9,"0"):"Unavailable",
  native_balance_lamports:lamports,assets:assets.slice(0,20),transaction_count:null,
  recent_transactions:(signatures||[]).map(s=>({hash:s.signature,timestamp:s.blockTime?new Date(s.blockTime*1000).toISOString():null,source:"https://solscan.io/tx/"+s.signature})),
  public_labels:[],checks:{account:lamports===null?"unavailable":"ok",transactions:signatures===null?"unavailable":"ok",tokens:calls[2].status==="fulfilled"||calls[3].status==="fulfilled"?"partial_or_ok":"unavailable"},
  warnings:["Public Solana RPC is rate-limited. On-chain SPL mint addresses are not validated token brands. The query is not a complete wallet history."]};
 return {address,format:"solana",network_scope:["Solana mainnet"],networks:[network],
  discovery:{active_networks_observed:observed?["Solana"]:[],labels:[],checked_networks:lamports!==null?1:0,total_networks:1,
   summary:observed?"Solana balances, token accounts or recent signatures observed.":"No activity observed in the public sample; check source status.",
   goal:"Trace public transactions and token mints; a Solana address has no public mandatory owner registration."},
  limitations:"Solana RPC samples current balance, SPL token account holdings and recent signatures, not every past transaction. No verified name or legal owner is inferred.",
  checked_at:new Date().toISOString()};
}


// Evidence-limited multihop tracing: public transfers only, max 2 hops, no identity inference.
const TRACE_LIMITS={max_depth:2,max_peers:4,max_edges:50,max_nodes:20,per_page:35};
function traceValue(raw,decimals){
 const rawString=String(raw??"");
 if(!/^\d+$/.test(rawString))return null;
 const value=BigInt(rawString),d=Number(decimals);
 if(!Number.isInteger(d)||d<0||d>36)return {base_units:rawString,display:rawString+" base units"};
 const base=10n**BigInt(d),f=(value%base).toString().padStart(d,"0").slice(0,8).replace(/0+$/,"");
 return {base_units:rawString,display:(value/base).toString()+(f?"."+f:"")};
}
function extractEvidence(root,txs,tokens,network,direction){
 const result=[],lookup=root.toLowerCase(),seen=new Set();
 const accept=(from,to)=> direction==="in"?to===lookup : direction==="out"?from===lookup : from===lookup||to===lookup;
 const add=(item)=>{
  if(!ADDRESS.test(item.from)||!ADDRESS.test(item.to)||item.from.toLowerCase()===item.to.toLowerCase())return;
  if(!accept(item.from.toLowerCase(),item.to.toLowerCase()))return;
  if(item.value_base_units==="0")return;
  const key=[item.tx_hash,item.from.toLowerCase(),item.to.toLowerCase(),item.asset_contract||"native",item.event_index??"native"].join("|");
  if(seen.has(key))return;seen.add(key);result.push(item);
 };
 for(const tx of txs||[]){
  if(!ADDRESS.test(tx?.from?.hash||"")||!ADDRESS.test(tx?.to?.hash||"")||!/^0x[a-fA-F0-9]{64}$/.test(tx?.hash||""))continue;
  if(tx.status==="error"||tx.status==="failed")continue;
  const val=traceValue(tx.value,18);
  if(!val)continue;
  add({from:tx.from.hash,to:tx.to.hash,from_name:tx.from.name||tx.from.ens_domain_name||null,
    to_name:tx.to.name||tx.to.ens_domain_name||null,tx_hash:tx.hash,timestamp:tx.timestamp||null,
    block:tx.block??null,asset:network.symbol,asset_contract:null,value_base_units:val.base_units,amount:val.display,
    kind:"native",event_index:null,source_url:network.explorer+"/tx/"+tx.hash});
 }
 for(const tr of tokens||[]){
  if(!ADDRESS.test(tr?.from?.hash||"")||!ADDRESS.test(tr?.to?.hash||"")||!/^0x[a-fA-F0-9]{64}$/.test(tr?.transaction_hash||""))continue;
  const token=tr.token||{}, raw=tr.total?.value??tr.value;
  const amount=traceValue(raw,token.decimals);
  if(!amount)continue;
  const contract=token.address_hash||token.address||null;
  add({from:tr.from.hash,to:tr.to.hash,from_name:tr.from.name||null,to_name:tr.to.name||null,
    tx_hash:tr.transaction_hash,timestamp:tr.timestamp||null,block:tr.block_number??null,
    asset:String(token.symbol||"Token").slice(0,25),asset_contract:ADDRESS.test(contract||"")?contract:null,
    value_base_units:amount.base_units,amount:amount.display,kind:"token",
    event_index:tr.log_index??tr.index??null,source_url:network.explorer+"/tx/"+tr.transaction_hash});
 }
 return result.sort((a,b)=>String(b.timestamp||"").localeCompare(String(a.timestamp||""))).slice(0,TRACE_LIMITS.per_page);
}
// Secondary index: Routescan's keyless Etherscan-compatible API (2 req/s free tier).
// These are verified external transfer records, never inferred links or user identities.
// "No transactions found" is a distinct valid response; provider failures are not.
const ROUTESCAN="https://api.routescan.io/v2/network/mainnet/evm/";
function routescanTxUrl(network,action,address) {
 const query=new URLSearchParams({module:"account",action,address,startblock:"0",endblock:"99999999",
   page:"1",offset:"25",sort:"desc"});
 return ROUTESCAN+network.chain_id+"/etherscan/api?"+query;
}
async function routescanRows(network,action,address){
 const url=routescanTxUrl(network,action,address);
 const json=await networkRequest("",url,9000);
 if(Array.isArray(json?.result)&&json.status==="1")return json.result;
 if(json.status==="0"&&Array.isArray(json.result)&&json.result.length===0)return [];
 if(json.status==="0"&&/no transactions found/i.test(String(json.message||json.result||"")))return [];
 throw Error("Routescan "+action+" "+String(json?.message||"unavailable").slice(0,95));
}
function parseRoutescanTx(row,network){
 const hash=row.hash,from=row.from,to=row.to;
 if(!/^0x[a-fA-F0-9]{64}$/.test(hash||"")||!ADDRESS.test(from||"")||!ADDRESS.test(to||""))return null;
 if(!/^\d+$/.test(String(row.value||""))||row.isError==="1"||row.txreceipt_status==="0"||
    (row.isError!=="0"&&row.txreceipt_status!=="1"))return null;
 const when=Number(row.timeStamp),block=Number(row.blockNumber);
 if(!Number.isSafeInteger(when)||when<1||!Number.isSafeInteger(block)||block<1)return null;
 return {hash,from:{hash:from},to:{hash:to},status:"ok",value:row.value,
   timestamp:new Date(when*1000).toISOString(),block};
}
function parseRoutescanToken(row){
 if(!ADDRESS.test(row.from||"")||!ADDRESS.test(row.to||"")||!ADDRESS.test(row.contractAddress||"")||
     !/^0x[a-fA-F0-9]{64}$/.test(row.hash||"")||!/^\d+$/.test(String(row.value??""))||
     row.isError==="1"||row.txreceipt_status==="0")return null;
 const decimals=Number(row.tokenDecimal),when=Number(row.timeStamp),block=Number(row.blockNumber);
 if(!Number.isSafeInteger(decimals)||decimals<0||decimals>36||
     !Number.isSafeInteger(when)||when<1||!Number.isSafeInteger(block)||block<1)return null;
 return {from:{hash:row.from},to:{hash:row.to},transaction_hash:row.hash,
   timestamp:new Date(when*1000).toISOString(),block_number:block,
   token_type:"ERC-20",token:{type:"ERC-20",address_hash:row.contractAddress,
     decimals:String(decimals),symbol:String(row.tokenSymbol||"ERC-20").slice(0,24)},
   total:{value:row.value},log_index:row.logIndex??null};
}
async function routescanTracePage(address,network,direction){
 const failures=[];
 const load=async(action,convert)=>{
   try{
     const rows=await routescanRows(network,action,address);
     return rows.map(row=>convert(row,network)).filter(Boolean).filter(item=>{
       const from=typeof item.from==="string"?item.from:item.from?.hash;
       const to=typeof item.to==="string"?item.to:item.to?.hash;
       return direction==="in"?to?.toLowerCase()===address.toLowerCase():
         direction==="out"?from?.toLowerCase()===address.toLowerCase():true;
     });
   }catch(e){failures.push(action+": "+e.message);return null;}
 };
 // Sequential to respect Routescan keyless 2 request/sec budget as closely as practical.
 const native=await load("txlist",parseRoutescanTx);
 await new Promise(r=>setTimeout(r,600));
 const tokens=await load("tokentx",parseRoutescanToken);
 if(native===null&&tokens===null)return null;
 return {edges:extractEvidence(address,native,tokens,network,direction),
   status:{native:native===null?"unavailable":"ok",token:tokens===null?"unavailable":"ok"},
   providers:{native:native===null?"unavailable":"routescan",token:tokens===null?"unavailable":"routescan"},
   warnings:failures,source:"Routescan Etherscan-compatible API"};
}
// Conservative, last-resort Ethereum-only historical lookup from Ethplorer.
// The public "freekey" is for development, not a guaranteed production feed.
// A valid response is a time-bounded sample, never a comprehensive on-chain history.
async function ethplorerTracePage(address,network,direction) {
 if(network.id!=="ethereum")return null;
 const url="https://api.ethplorer.io/getAddressTransactions/"+encodeURIComponent(address)+"?"+
   new URLSearchParams({apiKey:"freekey",limit:"20",showZeroValues:"false"}).toString();
 try{
  const raw=await networkRequest("",url,6500);
  if(!Array.isArray(raw))return null;
  const native=[];
  for(const x of raw.slice(0,20)){
   if(!ADDRESS.test(x?.from||"")||!ADDRESS.test(x?.to||"")||!/^0x[a-fA-F0-9]{64}$/.test(x?.hash||""))continue;
   if(x.success!==true&&x.success!==1&&x.success!=="true")continue;
   // rawValue is expressed in wei; do not guess if only a floating-point
   // display value is available.
   const value=String(x.rawValue??"");
   if(!/^\d+$/.test(value)||BigInt(value)===0n)continue;
   const seconds=Number(x.timestamp);
   if(!Number.isSafeInteger(seconds)||seconds<=0)continue;
   native.push({hash:x.hash,from:{hash:x.from},to:{hash:x.to},value,status:"ok",
     timestamp:new Date(seconds*1000).toISOString(),block:null});
  }
  return {edges:extractEvidence(address,native,null,network,direction),
    status:{native:"ok",token:"unavailable"},providers:{native:"ethplorer",token:"unavailable"},
    warnings:["Ethplorer public freekey is development-only, limited to recent indexed transactions. Token and block-height evidence are not provided by this fallback."],
    source:"Ethplorer Ethereum development fallback (limited recent native transfers)",
    source_url:"https://ethplorer.io/address/"+address};
 }catch(_){return null;}
}

async function tracePage(address,network,direction){
 const base=network.explorer+"/api/v2/addresses/"+encodeURIComponent(address);
 const filter=direction==="in"?"?filter=to":direction==="out"?"?filter=from":"";
 const results=await Promise.allSettled([
   networkRequest("",base+"/transactions"+filter,4500),
   networkRequest("",base+"/token-transfers"+filter,4500)
 ]);
 const native=results[0].status==="fulfilled"&&Array.isArray(results[0].value?.items)?results[0].value.items:null;
 const tokens=results[1].status==="fulfilled"&&Array.isArray(results[1].value?.items)?results[1].value.items:null;
 if(native===null&&tokens===null){
   const alternative=await routescanTracePage(address,network,direction);
   if(alternative)return alternative;
   const experimental=await ethplorerTracePage(address,network,direction);
   if(experimental)return experimental;
 }
 return {edges:extractEvidence(address,native,tokens,network,direction),
   status:{native:native===null?"unavailable":"ok",token:tokens===null?"unavailable":"ok"},
   providers:{native:native===null?"unavailable":"blockscout",token:tokens===null?"unavailable":"blockscout"},
   warnings:[],source:"Blockscout API v2"};
}
function traceNode(address,hop,viaTx){
 return {address,hop,via_transaction:viaTx||null,entity_type:"unknown",labels:[],owner_status:"unknown",
  note:"Observed transfer endpoint, not a verified owner."};
}
function evidenceLabel(name,category,source,url){
 return {name:String(name).slice(0,100),category,source,source_url:url,confidence:"public_label_only"};
}
async function traceEnrich(node,network){
 const url=network.explorer+"/address/"+node.address;
 try{
  const raw=await networkRequest(network.explorer+"/api/v2","/addresses/"+encodeURIComponent(node.address),6800);
  if(raw&&raw.hash?.toLowerCase()===node.address.toLowerCase()){
   node.entity_type=raw.is_contract===true?"smart_contract":raw.is_contract===false?"EOA":"unknown";
   if(raw.name)node.labels.push(evidenceLabel(raw.name,"Explorer tag","Blockscout",url));
   if(raw.ens_domain_name)node.labels.push(evidenceLabel(raw.ens_domain_name,"ENS reverse record","Blockscout",url));
   if(Array.isArray(raw.public_tags))for(const tag of raw.public_tags.slice(0,5)){
     const label=tag?.label||tag?.name||tag?.display_name;
     if(label)node.labels.push(evidenceLabel(label,"Public classification","Blockscout",url));
   }
   if(raw.is_scam===true)node.labels.push(evidenceLabel("Explorer warning flag","Risk label (not proof)","Blockscout",url));
  }
 }catch(e){node.note+=" Public explorer enrichment unavailable.";}
 if(network.id==="ethereum") {
  try{
   const rows=await getJson(ETH_LABELS+encodeURIComponent(node.address),5000);
   for(const label of normalizeLabels(rows,node.address).slice(0,4))
     node.labels.push(evidenceLabel(label.name,label.kind,"eth-labels",label.source_url));
  }catch(e){} // Optional community dataset: absence does not imply no label elsewhere.
 }
 const seen=new Set();
 node.labels=node.labels.filter(l=>{const k=l.source+"|"+l.name.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;}).slice(0,7);
 node.owner_status=node.labels.length?"public_tags_only":"not_identified";
 return node;
}

function buildActionableLeads(subject,nodes,edges,network){
 const root=subject.toLowerCase(), grouped=new Map();
 for(const edge of edges) {
  if(edge.hop!==1)continue;
  const from=edge.from.toLowerCase(),to=edge.to.toLowerCase();
  const input=to===root && from!==root;
  const output=from===root && to!==root;
  if(!input&&!output)continue;
  const peer=input?from:to, direction=input?"incoming":"outgoing";
  const key=direction+"|"+peer;
  const entry=grouped.get(key)||{counterparty:peer,direction,hop:1,observed_transfers:0,
    assets:new Set(),evidence:[],source_label:null,source_category:null};
  entry.observed_transfers++;
  entry.assets.add(edge.asset);
  if(entry.evidence.length<4)entry.evidence.push({hash:edge.tx_hash,url:edge.source_url,asset:edge.asset,
    amount:edge.amount,timestamp:edge.timestamp,kind:edge.kind});
  grouped.set(key,entry);
 }
 const findings=[];
 for(const item of grouped.values()){
  const node=nodes.find(n=>n.address.toLowerCase()===item.counterparty);
  const labels=(node?.labels||[]).filter(l=>l.category!=="Transaction index label");
  const best=labels[0]||null;
  item.source_label=best?.name||null;
  item.source_category=best?.category||null;
  const isTag=!!best;
  const action=isTag?
    "Review the original transaction and verify this public label. If it is a regulated custodian, subscriber records would require proper legal process.":
    "Open the transfer evidence, inspect the counterparty and check older transfers or contract calls. Owner is unknown.";
  findings.push({
    lead_id:"lead-"+(findings.length+1),kind:isTag?"publicly_labeled_counterparty":"unattributed_counterparty",
    priority:isTag?"source_verification":"transaction_review",
    target_address:item.counterparty,
    direction:item.direction,
    public_label:item.source_label,
    label_provenance:best?{source:best.source,url:best.source_url,category:best.category,confidence:best.confidence}:null,
    observed_transfers:item.observed_transfers,assets:[...item.assets],
    evidence:item.evidence,why_it_matters:item.direction==="incoming"?
      "Observed incoming transfers may provide a starting point to examine funding. They are not proof of the wallet's original source.":
      "Observed outgoing transfers provide destinations to examine. They do not establish who controls the recipient.",
    next_action:action,
    certainty:{transfer:"on-chain indexed evidence (verify hash)",entity:"public tag only, if present",owner:"unknown"}
  });
 }
 findings.sort((a,b)=>(b.public_label?1:0)-(a.public_label?1:0)||b.observed_transfers-a.observed_transfers);
 findings.forEach((f,i)=>f.lead_id="lead-"+(i+1));
 const serviceTouches=findings.filter(x=>x.public_label).length;
 const unknownTouches=findings.length-serviceTouches;
 const observation=edges.length?
  "I found "+edges.length+" sampled transfers connecting "+findings.length+" first-hop counterparties. Follow each transaction hash to check the evidence.":
  "The index returned no qualifying transfers in this sample. It is not evidence that the address has no history.";
 const focus=serviceTouches?
  "Start with the publicly labelled counterparties. Verify those names against the cited source before drawing conclusions.":
  unknownTouches?
  "Start with the observed counterparties and work backwards or forwards from the linked transfers. Attribution is still unknown.":
  "First verify the address, network and provider coverage. No supported owner attribution is available.";
 return {summary:observation,first_action:focus,top_leads:findings.slice(0,6),
   labeled_counterparties:serviceTouches,unattributed_counterparties:unknownTouches,
   owner:"unknown",method:"bounded on-chain transfers and cited public labels; no private records",
   next_steps:["Verify each transaction hash in a public explorer.",
               "Check public counterparty tags and distinguish exchange custody from individual ownership.",
               "For a confirmed service, request private account records only through lawful procedures."],
   caveat:"Two-hop address links do not prove that the same cryptocurrency units flowed through every intermediary."};
}

async function investigateFlows(address,options) {
 const chain=NETWORKS.find(n=>n.id===options.network)||NETWORKS[0];
 const direction=["in","out","both"].includes(options.direction)?options.direction:"in";
 const depth=Math.max(1,Math.min(TRACE_LIMITS.max_depth,Number(options.depth)||2));
 const nodes=new Map([[address.toLowerCase(),traceNode(address,0,null)]]);
 const seen=new Set(); const edges=[],problems=[];
 function pushEvidence(item,hop,discoveredFrom){
  const key=[item.tx_hash,item.from.toLowerCase(),item.to.toLowerCase(),item.kind,item.event_index??"",item.asset_contract||""].join("|");
  if(seen.has(key)||edges.length>=TRACE_LIMITS.max_edges)return;
  seen.add(key);
  const fromKey=item.from.toLowerCase(),toKey=item.to.toLowerCase();
  for(const keyOf of [fromKey,toKey])if(!nodes.has(keyOf)&&nodes.size<TRACE_LIMITS.max_nodes){
    const name=keyOf===fromKey?item.from_name:item.to_name;
    const newNode=traceNode(keyOf===fromKey?item.from:item.to,hop,item.tx_hash);
    if(name)newNode.labels.push(evidenceLabel(name,"Transaction index label","Blockscout",chain.explorer+"/address/"+newNode.address));
    nodes.set(keyOf,newNode);
  }
  if(!nodes.has(fromKey)||!nodes.has(toKey))return;
  edges.push({...item,hop,observed_via:discoveredFrom,evidence_type:"on_chain_indexed_transfer"});
 }
 const root=await tracePage(address,chain,direction);
 if(root.status.native!=="ok" && root.status.token!=="ok") {
  // A source outage is not an empty wallet. Return an explicit, machine-readable
  // unavailable state so the app can offer retry and independent source links.
  const empty=traceNode(address,0,null);
  return {version:"0.6.0-beta",address,network:chain.name,network_id:chain.id,
    chain_id:chain.chain_id,asset:chain.symbol,queried_at:new Date().toISOString(),
    mode:{direction,depth_requested:depth,depth_achieved:0},
    graph:{nodes:[empty],edges:[]},
    investigator_leads:{first_action:"Public transaction index unavailable — retry later or check the independent explorer.",top_leads:[]},
    stats:{nodes:1,transfers:0,entities_with_public_labels:0,expanded_peers:0,
      observed_counterparties:0,source_warnings:2,publicly_tagged_entities:0},
    coverage:{data_status:"unavailable",root:root.status,primary_source:"none",
      primary_providers:root.providers,problems:root.warnings||[],
      partial:true,sample:"No indexed transfer data was returned. No activity assessment is possible."},
    osint:{public_labels:[],sources:[{name:"Independent explorer",
      url:chain.explorer+"/address/"+address,kind:"manual verification"}]},
    conclusions:["Sources unavailable — no determination about transactions or wallet activity was made."],
    limitations:["No network or identity conclusion can be drawn from this outage."]};
 }

 for(const e of root.edges.slice(0,24))pushEvidence(e,1,address);
 const rootPeers=edges.map(e=>e.from.toLowerCase()===address.toLowerCase()?e.to:e.from);
 const peerCount=new Map();
 for(const peer of rootPeers)if(peer.toLowerCase()!==address.toLowerCase())peerCount.set(peer.toLowerCase(),(peerCount.get(peer.toLowerCase())||0)+1);
 const candidates=[...peerCount].sort((a,b)=>b[1]-a[1]).slice(0,root.source==="Blockscout API v2"?TRACE_LIMITS.max_peers:1).map(([a])=>a);
 const expanded=[];
 if(depth===2&&candidates.length) {
  const results=await Promise.allSettled(candidates.map(peer=>tracePage(peer,chain,direction)));
  for(let i=0;i<results.length;i++){
    const item=results[i],peer=candidates[i];
    if(item.status!=="fulfilled"){problems.push("Second-hop query failed for "+peer);continue;}
    const p=item.value; expanded.push({address:peer,...p.status});
    if(p.status.native!=="ok"&&p.status.token!=="ok")continue;
    // Only expand the directly connected peer once. Loops can exist but do not imply shared control.
    let included=0;
    for(const edge of p.edges){
      const other=edge.from.toLowerCase()===peer?edge.to.toLowerCase():edge.from.toLowerCase();
      if(other===address.toLowerCase()||other===peer||nodes.has(other))continue;
      if(included>=3||edges.length>=TRACE_LIMITS.max_edges||nodes.size>=TRACE_LIMITS.max_nodes)break;
      pushEvidence(edge,2,peer);included++;
    }
  }
 }
 // Enrich just the subject and first-hop peers; avoid uncontrolled OSINT API fanout.
 const primary=[address.toLowerCase(),...candidates].filter((v,i,a)=>a.indexOf(v)===i);
 if(root.source==="Blockscout API v2")await Promise.allSettled(primary.slice(0,2).map(id=>traceEnrich(nodes.get(id),chain)));
 const finalNodes=[...nodes.values()];
 const investigator_leads=buildActionableLeads(address,finalNodes,edges,chain);
 const sources=[{name:"Blockscout public indexed transfers",url:chain.explorer+"/address/"+address,
   kind:"primary on-chain observation",method:"API v2 address transactions and token transfers"},
  {name:"Public intelligence tags",url:chain.explorer+"/address/"+address,kind:"explorer and opt-in names"}];
 if(chain.id==="ethereum") sources.push({name:"Etherscan cross-check",url:"https://etherscan.io/address/"+address,kind:"independent explorer"});
 const attributed=finalNodes.filter(n=>n.labels?.length);
 const flags=finalNodes.filter(n=>n.labels?.some(l=>l.category?.startsWith("Risk")));
 const issueCount=problems.length+expanded.filter(p=>p.native!=="ok"||p.token!=="ok").length+
     (root.status.native!=="ok"?1:0)+(root.status.token!=="ok"?1:0);
 const observedCounterparties=[...new Set(edges.flatMap(e=>[e.from.toLowerCase(),e.to.toLowerCase()]))]
  .filter(k=>k!==address.toLowerCase()).length;
 const publicEntities=finalNodes.filter(n=>n.labels?.some(l=>l.confidence==="public_label_only")).length;
 return {version:"0.5.0-beta",address,network:chain.name,network_id:chain.id,chain_id:chain.chain_id,asset:chain.symbol,
  queried_at:new Date().toISOString(),mode:{direction,depth_requested:depth,depth_achieved:edges.some(e=>e.hop===2)?2:edges.length?1:0},
  graph:{nodes:finalNodes,edges},investigator_leads,stats:{nodes:finalNodes.length,transfers:edges.length,entities_with_public_labels:attributed.length,
   risk_flags_reported_by_explorer:flags.length,expanded_peers:expanded.length,observed_counterparties:observedCounterparties,source_warnings:issueCount,publicly_tagged_entities:publicEntities},
  coverage:{root:root.status,primary_source:root.source,primary_providers:root.providers,expanded,problems,partial:issueCount>0,has_observed_transfers:edges.length>0,limit:TRACE_LIMITS,
   sample:"At most one recent API page per visited address. Depth 2; max four first-hop peers and three second-hop links each. Token and native transfers are distinct evidence types."},
  osint:{public_labels:attributed.map(n=>({address:n.address,labels:n.labels})),sources},
  conclusions:[
   edges.length?"Recent indexed transfers were found. A flow graph is a map of observed transfers, not proof that each intermediate wallet forwarded the same funds.":"No qualifying transfers observed in the returned sample. This does not prove that the address has no history.",
   attributed.length?"Some nodes have public explorer, ENS or community labels; none proves the legal owner.":"No public attributed entities were confirmed in the enriched nodes.",
   "A chain of transfers is not proof of common wallet ownership or criminal involvement."
  ],
  identity_status:"No legal identity inferred; any public labels must be verified independently.",
  limitations:["This is a bounded sample, not a complete historical multi-chain financial flow reconstruction.",
   "Contracts, exchange hot wallets, bridges, token swaps, internal calls and mixers can break naive transfer-chain assumptions.",
   "Amounts and timing do not prove conservation of a particular asset across multiple hops; the graph depicts address interactions only.",
   "Source labels are public claims, not legal identities. No private KYC data is accessed.",
   "No person-level identification, geolocation or guilt conclusions are generated."]};
}


async function inspectTransaction(hash,networkId) {
 const network=NETWORKS.find(n=>n.id===networkId);
 if(!network)failure("Unsupported EVM network for transaction lookup.",400);
 const fetched=await networkRequest(network.explorer+"/api/v2","/transactions/"+hash,10000);
 if(fetched?.missing)failure("This transaction is not indexed on "+network.name+". Check the network or transaction hash.",404);
 if(!fetched || fetched.hash?.toLowerCase()!==hash.toLowerCase())failure("Transaction data could not be verified from the explorer.",502);
 const from=fetched.from?.hash||null,to=fetched.to?.hash||null;
 const value=typeof fetched.value==="string"&&/^\d+$/.test(fetched.value)?fetched.value:null;
 const native=value===null?null:traceValue(value,18);
 const failureFlag=fetched.status==="error"||fetched.status==="failed";
 return {network:network.name,network_id:network.id,hash,source:"Blockscout API v2",
   source_url:network.explorer+"/tx/"+hash,checked_at:new Date().toISOString(),
   from:ADDRESS.test(from||"")?{address:from,public_tag:fetched.from?.name||null}:null,
   to:ADDRESS.test(to||"")?{address:to,public_tag:fetched.to?.name||null}:null,
   native_value:native?.display||null,native_symbol:network.symbol,
   timestamp:fetched.timestamp||null,block:fetched.block??null,
   execution:failureFlag?"failed":fetched.status||"unconfirmed",contract_call:fetched.method||null,
   caveats:["A sender or recipient address is not a verified legal person.",
      "The transaction may contain token transfers, internal calls, swap routes or contract executions not represented by the native value.",
      "This record is only a public explorer observation. Cross-check the hash independently."]};
}


function safeNameQuery(query) {
 const name=String(query||"").replace(/\s+/g," ").trim();
 if(name.length<3||name.length>72||!/^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u.test(name))failure("Enter a name, surname or public ENS alias (3–72 characters).",400);
 return name;
}
async function discoverPublicEnsNames(raw) {
 const query=safeNameQuery(raw);
 const parts=query.toLowerCase().split(/\s+/).filter(s=>s.length>=3);
 const terms=[...new Set(parts.length>1?[parts[0],parts[parts.length-1]]:[query.toLowerCase()])].slice(0,2);
 const records=[],seen=new Set(),errors=[];
 for(const term of terms) {
  try {
   const searchUrl="https://api.enswhois.com/api/search-domains?"+new URLSearchParams({
    q:term,availability_status:"registered",page:"1"
   }).toString();
   const data=await getJson(searchUrl,7000);
   const results=Array.isArray(data?.results)?data.results:Array.isArray(data?.domains)?data.domains:[];
   for(const entry of results.slice(0,15)){
     const ens=String(entry?.name||entry?.full_name||"").toLowerCase();
     if(!/^[a-z0-9][a-z0-9.-]{1,251}\.eth$/.test(ens)||seen.has(ens)||!ens.includes(term))continue;
     seen.add(ens);
     const owned=entry.ownership?.owner||entry.effective_owner_address||null;
     const holder=ADDRESS.test(owned||"")?owned:null;
     records.push({ens_name:ens,ens_registrant:holder,registration_status:entry.availability_status||"unconfirmed",
       evidence_url:"https://app.ens.domains/"+encodeURIComponent(ens),
       source:"ENSWhois public ENS domain index",confidence:"ens_domain_match_only",
       note:"This is a matching ENS domain, not proof that the named person uses or controls its wallet."});
   }
  } catch(e){errors.push(term+": "+String(e.message||"provider unavailable").slice(0,120));}
 }
 if(errors.length===terms.length)failure("ENS name search provider unavailable or rate limited. Try again later.",503);
 records.sort((a,b)=>{
   const norm=s=>s.replace(/[^a-z0-9]/g,"");
   const aa=norm(a.ens_name.split(".")[0]),bb=norm(b.ens_name.split(".")[0]);
   const tgt=norm(query),aExact=aa===tgt?1:0,bExact=bb===tgt?1:0;
   return bExact-aExact||aa.length-bb.length;
 });
 return {query,results:records.slice(0,10),checked_terms:terms,source:"ENSWhois public domain index",
  warnings:errors,found:records.length>0,
  scope:"Public ENS name matches only. Does not search private KYC records, identify a legal person or prove ownership.",
  next_step:"Open the ENS name, inspect current public resolver records and verify any identity claim against independently authenticated public sources.",
  independent_research:[
    {title:"Search public wallet disclosures",url:"https://www.google.com/search?q="+encodeURIComponent('"'+query+'" ethereum wallet ENS')},
    {title:"Search public GitHub references",url:"https://github.com/search?q="+encodeURIComponent('"'+query+'" ethereum')+"&type=code"}
  ]};
}


// Historical research labels are never legal attribution or a live fraud verdict.
// FuseChain, MIT licensed, 2017–2021 sample, ~35k Ethereum addresses.
// No arbitrary SQL input: the wallet address is regex-validated before query construction.
async function historicalResearch(address) {
 if(!ADDRESS.test(address))failure("Valid EVM address required.",400);
 const source="https://huggingface.co/datasets/Nileshka/fusechain-data";
 const query=new URLSearchParams({dataset:"Nileshka/fusechain-data",config:"default",split:"train",
   where:'"address"=\''+address.toLowerCase()+'\'',offset:"0",length:"1"});
 const api="https://datasets-server.huggingface.co/filter?"+query.toString();
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),11000);
 try {
  const response=await fetch(api,{headers:{Accept:"application/json"},signal:controller.signal,
    cf:{cacheTtl:3600,cacheEverything:true}});
  if(!response.ok){
   const kind=response.status===429?"rate_limited":response.status===422||response.status===404?"not_indexed":"provider_error";
   return {address,status:"unavailable",source,source_id:"FuseChain historical dataset",issue:kind,
     detail:"Historical dataset query unavailable (HTTP "+response.status+"); this is NOT a negative classification.",
     label:null,source_period:"2017–2021"};
  }
  const payload=await response.json();
  const record=(Array.isArray(payload?.rows)?payload.rows:[]).map(x=>x?.row||x)
    .find(x=>typeof x?.address==="string"&&x.address.toLowerCase()===address.toLowerCase());
  const partial=payload?.partial===true;
  if(!record){
   return {address,status:partial?"partial_index":"not_in_dataset",source,source_id:"FuseChain historical dataset",
     label:null,source_period:"2017–2021",
     detail:partial?"Dataset filter only indexed a partial slice; absence has no meaning.":
       "Not present in the indexed research sample. This does NOT mean safe or clean."};
  }
  const label=Number(record.is_scam)===1?"historically_labeled_scam":
              Number(record.is_scam)===0?"historically_labeled_normal":null;
  const days=Number(record.active_days);
  const features={active_days:Number.isFinite(days)&&days>=0?Math.floor(days):null};
  return {address,status:"dataset_match",source,source_id:"FuseChain historical dataset",
    label,source_period:"2017–2021",dataset_license:"MIT",features,
    reliability:"unverified historical research annotation — NOT proof of criminality or current risk",
    alert:label==="historically_labeled_scam"?
      "A historical research dataset flagged this address. Confirm with dated primary evidence before any investigative conclusion.":
      "Research classification is not an endorsement, exoneration or identity verification.",
    detail:"Social indicators in FuseChain are global market/community aggregates, not wallet owner behavior. No real-world identity is inferred."};
 }catch(e){
  return {address,status:"unavailable",source,source_id:"FuseChain historical dataset",label:null,source_period:"2017–2021",
    issue:"network_or_provider_error",detail:"Research provider unavailable or timed out. No classification can be made."};
 }finally{clearTimeout(timer);}
}


const INCIDENT_HASH=/^0x[a-fA-F0-9]{64}$/;
// Narrow, evidence-first incident triage: reported funds are NOT automatically traced by adjacent wallet activity.
function incidentSeeds(tx,tokenRows,chain){
 const rows=[],from=tx.from?.hash,to=tx.to?.hash,val=traceValue(tx.value,18);
 if(ADDRESS.test(from||"")&&ADDRESS.test(to||"")&&from.toLowerCase()!==to.toLowerCase()&&val&&BigInt(val.base_units)>0n)
  rows.push({kind:"native",from,to,asset:chain.symbol,asset_contract:null,amount:val.display,
   tx_hash:tx.hash,source_url:chain.explorer+"/tx/"+tx.hash,base_units:val.base_units});
 for(const t of (tokenRows||[]).slice(0,80)){
  if(t?.token_type!=="ERC-20"&&t?.token?.type!=="ERC-20")continue;
  if(t.transaction_hash?.toLowerCase()!==tx.hash.toLowerCase())continue;
  const a=t.from?.hash,b=t.to?.hash,contract=t.token?.address_hash||t.token?.address;
  const value=traceValue(t.total?.value??t.value,t.token?.decimals??t.total?.decimals);
  if(!ADDRESS.test(a||"")||!ADDRESS.test(b||"")||!ADDRESS.test(contract||"")||!value||BigInt(value.base_units)===0n)continue;
  rows.push({kind:"token",from:a,to:b,asset:String(t.token?.symbol||"ERC-20").slice(0,24),
   asset_contract:contract,amount:value.display,tx_hash:tx.hash,base_units:value.base_units,
   event_index:t.log_index??null,source_url:chain.explorer+"/tx/"+tx.hash});
 }
 return rows.slice(0,10);
}
function incidentLater(tx,item){
 const a=Number(tx.block??tx.block_number),b=Number(item.block);
 if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<=0||b<=a)return false;
 // A missing or invalid time means we cannot establish the 30-day follow-up window.
 if(!tx.timestamp||!item.timestamp)return false;
 const t0=Date.parse(tx.timestamp),t1=Date.parse(item.timestamp);
 if(!Number.isFinite(t0)||!Number.isFinite(t1)||t1<t0||t1-t0>30*86400000)return false;
 return true;
}
function incidentNextMoves(seeds,tx,observed,chain){
 const rows=[],seen=new Set();
 for(const seed of seeds){
  for(const item of observed.get(seed.to.toLowerCase())?.edges||[]){
   if(item.from.toLowerCase()!==seed.to.toLowerCase()||item.kind!==seed.kind||!incidentLater(tx,item))continue;
   if(seed.kind==="token"&&(seed.asset_contract?.toLowerCase()!==item.asset_contract?.toLowerCase()))continue;
   const key=[item.tx_hash,item.from.toLowerCase(),item.to.toLowerCase(),item.kind,item.asset_contract||"",item.event_index??""].join("|");
   if(seen.has(key))continue;seen.add(key);
   rows.push({kind:item.kind,from:item.from,to:item.to,asset:item.asset,asset_contract:item.asset_contract,
    amount:item.amount,tx_hash:item.tx_hash,block:item.block,timestamp:item.timestamp,source_url:item.source_url,
    recipient_public_label:item.to_name||null,
    public_label_source:item.to_name?chain.explorer+"/address/"+item.to:null,
    evidence_type:"observed_later_same_asset_transfer_not_proven_continuation"});
  }
 }
 return rows.sort((a,b)=>Number(a.block)-Number(b.block)).slice(0,10);
}
async function triageIncident(hash,networkId){
 if(!INCIDENT_HASH.test(hash))failure("Enter an EVM transaction hash (0x followed by 64 hexadecimal digits).",400);
 const chain=NETWORKS.find(n=>n.id===networkId);
 if(!chain)failure("Unsupported EVM network.",400);
 const root=chain.explorer+"/api/v2",tx=await networkRequest(root,"/transactions/"+hash,10000);
 if(tx?.missing)failure("Transaction not indexed on this network; check the hash and blockchain.",404);
 if(!tx||tx.hash?.toLowerCase()!==hash.toLowerCase())failure("Transaction cannot be verified from public index.",502);
 const failed=tx.status==="error"||tx.status==="failed",successful=["ok","success"].includes(tx.status);
 const issue=[],providers={transaction:"ok",erc20:"not_checked",recipient_history:"not_checked"};
 let tokens=null;
 if(successful){
  try{
   const p=await networkRequest(root,"/transactions/"+hash+"/token-transfers",8000);
   if(Array.isArray(p?.items)){tokens=p.items;providers.erc20="ok";if(p.next_page_params)issue.push("ERC-20 event index is paginated; only first page was checked.");}
   else{providers.erc20="unavailable";issue.push("ERC-20 events unavailable, so contract/token movements may be missing.");}
  }catch(e){providers.erc20="unavailable";issue.push("ERC-20 events unavailable: "+String(e.message).slice(0,80));}
 }
 const seeds=successful?incidentSeeds(tx,tokens,chain):[],history=new Map();
 if(seeds.length){
  const recipients=[...new Set(seeds.map(t=>t.to.toLowerCase()))].slice(0,2);
  for(const address of recipients){
   try{
    const page=await tracePage(address,chain,"out");
    history.set(address,page);
    if(page.status.native!=="ok"||page.status.token!=="ok")issue.push("Recipient history is partially unavailable for "+address+".");
   }catch(e){issue.push("Recipient history unavailable for "+address+".");}
  }
  providers.recipient_history=history.size?"sampled":"unavailable";
 }
 const later=incidentNextMoves(seeds,tx,history,chain);
 const tagMap=new Map();
 for(const x of later)if(x.recipient_public_label&&!tagMap.has(x.to.toLowerCase()))
   tagMap.set(x.to.toLowerCase(),{address:x.to,label:x.recipient_public_label,source:x.public_label_source,
     supporting_tx:x.tx_hash,tx_url:x.source_url,certainty:"unverified explorer name tag"});
 const labels=[...tagMap.values()];
 const observation=failed?"Execution failed. This transaction is not evidence of a completed transfer.":
   !successful?"Successful execution is not confirmed by this indexer. No completed transfer is claimed.":
   seeds.length?seeds.length+" transfer(s) observed in the original transaction; "+later.length+
     " later same-asset outward transfer(s) found from first recipients in bounded index samples.":
   "Execution succeeded, but no external native/ERC-20 transfer was established in the returned index. Internal transfers or contract calls may require other evidence.";
 const next=!successful?{title:"Verify execution and select the correct transaction",reason:"Review the source explorer, contract logs or a separate withdrawal transaction.",basis:"execution_status"}:
   labels.length?{title:"Verify the publicly tagged destination",reason:"Cross-check this label against the linked transaction and independent sources. If it is a regulated service, the next step may require lawful preservation or disclosure processes.",basis:"public_tag_plus_tx"}:
   later.length?{title:"Examine the first observed next recipient",reason:"Open the linked transaction and review the next address. A later transfer of the same asset is NOT proof that the reported funds were forwarded.",basis:"confirmed_later_event"}:
   seeds.length?{title:"Inspect the full recipient history",reason:"No qualifying later transfer appeared in the recent sample. Check historical pages, swaps and internal calls before drawing conclusions.",basis:"incomplete_recent_sample"}:
   {title:"Check token and internal events",reason:"There was no directly indexed transfer in this sample. Verify contract execution, logs and internal transaction paths.",basis:"unresolved_transfer"};
 if(seeds.length)issue.push("At most two recipient addresses and one recent outgoing page per address were sampled; older history can be missed.");
 if(later.length)issue.push("Chronology and same-asset matching do not prove the identical reported funds were forwarded.");
 if(!successful)issue.push("No onward tracing without confirmed successful execution.");
 return {schema:"nodivra.incident.v1",generated_at:new Date().toISOString(),network:chain.name,network_id:chain.id,
  incident:{tx_hash:hash,tx_url:chain.explorer+"/tx/"+hash,status:tx.status||"unknown",
   sender:ADDRESS.test(tx.from?.hash||"")?tx.from.hash:null,
   recipient:ADDRESS.test(tx.to?.hash||"")?tx.to.hash:null,
   block:tx.block??tx.block_number??null,timestamp:tx.timestamp||null,method:tx.method||null},
  finding:{state:failed?"failed":!successful?"not_confirmed":!seeds.length?"no_direct_transfer":"observed_transfer",
   summary:observation,initial_transfers:seeds.length,later_observations:later.length},
  initial_events:seeds,later_observed_events:later,public_label_leads:labels,first_next_action:next,
  coverage:{providers,partial:issue.length>0,issues:issue,
   sampling:"One recent API page per recipient (max two recipients), same network/asset, later block, max 30 days.",
   source:"Blockscout public API v2"},
  limitations:["This is first-response triage, not proof of stolen asset continuity or of who owns a wallet.",
   "Swaps, internal calls, bridge activity, mixers and paginated older transactions may not be represented.",
   "No person identification, criminality inference, fund recovery promise or legal chain-of-custody certification."]};
}

export default {
 async fetch(request,env,context) {
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:headers(request)});
  if(request.method!=="GET")return reply(request,{error:"Read-only API"},405);
  const u=new URL(request.url),path=u.pathname;
  // Cache public lookups at the edge so retries and repeated searches do not hammer upstream indexers.
  const cacheable=new Set(["/lookup","/resolve","/multichain","/name-search","/research-labels","/investigate"]);
  const cache=typeof caches!=="undefined"&&caches?.default?caches.default:null;
  if(cacheable.has(path)&&cache){
    try {const hit=await cache.match(request);if(hit)return hit;}catch(e){}
  }
  const send=(data,status=200)=>{
    const response=reply(request,data,status);
    if(status===200&&data?.coverage?.data_status!=="unavailable"&&cacheable.has(path)&&cache){
      response.headers.set("Cache-Control","public, max-age="+(path==="/name-search"?900:path==="/research-labels"?3600:path==="/investigate"?240:180));
      try {
        const task=cache.put(request,response.clone());
        if(context?.waitUntil)context.waitUntil(task);else task.catch(()=>{});
      }catch(e){}
    }
    return response;
  };
  if(path==="/health")return reply(request,{ok:true,service:"NODIVRA",providers:["Blockscout","Routescan (secondary index)","Ethplorer (Ethereum development-only native fallback)","PublicNode","dRPC","eth-labels"]});
  if(!["/lookup","/origin","/resolve","/multichain","/investigate","/transaction","/name-search","/research-labels","/incident"].includes(path))return reply(request,{error:"Not found"},404);
  try{
   if(path==="/name-search")return send(await discoverPublicEnsNames(u.searchParams.get("q")));
   if(path==="/research-labels"){const address=u.searchParams.get("address")||"";return send(await historicalResearch(address));}
   if(path==="/resolve")return send(await resolveEns(u.searchParams.get("name")));
   if(path==="/incident")return reply(request,await triageIncident(u.searchParams.get("hash")||"",u.searchParams.get("network")||"ethereum"));
   if(path==="/transaction"){const hash=u.searchParams.get("hash")||"";if(!/^0x[a-fA-F0-9]{64}$/.test(hash))failure("Valid 0x + 64-digit transaction hash required.",400);return reply(request,await inspectTransaction(hash,u.searchParams.get("network")||"ethereum"));}
   if(path==="/investigate") {const address=u.searchParams.get("address")||"";if(!ADDRESS.test(address))failure("Valid EVM address required for transfer tracing.",400);return send(await investigateFlows(address,{network:u.searchParams.get("network"),direction:u.searchParams.get("direction"),depth:u.searchParams.get("depth")}));}
   if(path==="/multichain"){const address=u.searchParams.get("address")||"";if(ADDRESS.test(address))return send(await scanEvm(address));if(BTC.test(address))return send(await scanBitcoin(address));if(SOLANA_ADDRESS.test(address))return send(await scanSolana(address));failure("Enter a valid EVM, Bitcoin or Solana mainnet address.",400);}
   const address=u.searchParams.get("address")||"";
   if(!ADDRESS.test(address))failure("Provide exactly 40 hexadecimal digits after 0x",400);
   return path==="/origin"?reply(request,await origin(address)):send(await investigate(address));
  }catch(e){return reply(request,{error:e.status===503?"Public data sources unavailable; please try again.":String(e.message||"Lookup failed")},e.status||502);}
 }
};

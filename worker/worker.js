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
  const usableAccount=account && typeof account.coin_balance==="string" && /^\d+$/.test(account.coin_balance) && typeof account.is_contract==="boolean";
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
  const result=await getJson("https://bens.services.blockscout.com/api/v1/1/domains/"+encodeURIComponent(safe));
  const address=typeof result.resolved_address==="string"?result.resolved_address:result.resolved_address?.hash||null;
  if(!ADDRESS.test(address||""))failure("No public Ethereum address record for this ENS name",404);
  return {name:safe,address,source:"Blockscout ENS"};
}

// Cross-chain exploration: independently sourced indexer samples, not a universal wallet database.
const NETWORKS = [
 {id:"ethereum",name:"Ethereum",symbol:"ETH",explorer:"https://eth.blockscout.com",chain_id:1},
 {id:"base",name:"Base",symbol:"ETH",explorer:"https://base.blockscout.com",chain_id:8453},
 {id:"arbitrum",name:"Arbitrum One",symbol:"ETH",explorer:"https://arbitrum.blockscout.com",chain_id:42161},
 {id:"optimism",name:"OP Mainnet",symbol:"ETH",explorer:"https://optimism.blockscout.com",chain_id:10},
 {id:"polygon",name:"Polygon PoS",symbol:"POL",explorer:"https://polygon.blockscout.com",chain_id:137}
];
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
   if(data.missing){answer.status="not_indexed";answer.checks.account="not_indexed";answer.warnings.push("No public address record returned by this indexer; activity elsewhere is not excluded.");return answer;}
   if(data&&typeof data==="object" && data.hash?.toLowerCase()===address.toLowerCase()){account=data;answer.checks.account="ok";}
   else {answer.warnings.push("Explorer account response did not match the queried address.");return answer;}
 }catch(e){answer.warnings.push("Account lookup unavailable: "+String(e.message).slice(0,100));return answer;}
 if(typeof account.coin_balance==="string" && /^\d+$/.test(account.coin_balance)){
  answer.native_balance_wei=account.coin_balance;
  const x=BigInt(account.coin_balance),whole=x/1000000000000000000n;
  const frac=(x%1000000000000000000n).toString().padStart(18,"0").slice(0,6).replace(/0+$/,"");
  answer.native_balance=whole.toString()+(frac?"."+frac:"");
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
 const results=await Promise.allSettled(NETWORKS.map(n=>scanEvmNetwork(n,address)));
 const networks=results.map((r,i)=>r.status==="fulfilled"?r.value:({id:NETWORKS[i].id,name:NETWORKS[i].name,
  symbol:NETWORKS[i].symbol,explorer_url:NETWORKS[i].explorer+"/address/"+address,status:"unavailable",
  assets:[],native_balance:null,transaction_count:null,recent_transactions:[],public_labels:[],warnings:[String(r.reason?.message||"Service unavailable")]}));
 const observed=networks.filter(n=>n.status==="activity_observed").map(n=>n.name);
 const tagged=networks.flatMap(n=>(n.public_labels||[]).map(tag=>({...tag,network:n.name})));
 const checked=networks.filter(n=>n.checks?.account==="ok").length;
 return {address,format:"evm",network_scope:NETWORKS.map(n=>n.name),networks,
  discovery:{active_networks_observed:observed,labels:tagged,checked_networks:checked,total_networks:NETWORKS.length,
   summary:observed.length?"Observed assets or transfers on "+observed.join(", ")+".":"No activity detected in the indexed samples on the networks that responded. Verify the address before inferring inactivity.",
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
 native_balance_sats:balance.toString(),native_balance:(Number(balance)/1e8).toFixed(8),
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

export default {
 async fetch(request) {
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:headers(request)});
  if(request.method!=="GET")return reply(request,{error:"Read-only API"},405);
  const u=new URL(request.url),path=u.pathname;
  if(path==="/health")return reply(request,{ok:true,service:"NODIVRA",providers:["Blockscout","PublicNode","dRPC","eth-labels"]});
  if(!["/lookup","/origin","/resolve","/multichain"].includes(path))return reply(request,{error:"Not found"},404);
  try{
   if(path==="/resolve")return reply(request,await resolveEns(u.searchParams.get("name")));
   if(path==="/multichain"){const address=u.searchParams.get("address")||"";if(ADDRESS.test(address))return reply(request,await scanEvm(address));if(BTC.test(address))return reply(request,await scanBitcoin(address));if(SOLANA_ADDRESS.test(address))return reply(request,await scanSolana(address));failure("Enter a valid EVM, Bitcoin or Solana mainnet address.",400);}
   const address=u.searchParams.get("address")||"";
   if(!ADDRESS.test(address))failure("Provide exactly 40 hexadecimal digits after 0x",400);
   return reply(request,path==="/origin"?await origin(address):await investigate(address));
  }catch(e){return reply(request,{error:e.status===503?"Public data sources unavailable; please try again.":String(e.message||"Lookup failed")},e.status||502);}
 }
};

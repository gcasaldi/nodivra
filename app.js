"use strict";
(() => {
  const API = "https://nodivra-api.gcasaldi.workers.dev";
  const DIRECT = "https://eth.blockscout.com/api/v2";
  const ETHERSCAN = "https://etherscan.io/address/";
  const BLOCKSCOUT = "https://eth.blockscout.com/address/";
  const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
  const $ = id => document.getElementById(id);
  const input = $("wallet"), form = $("lookup-form"), button = $("lookup-button");
  const status = $("status"), results = $("results"), txList = $("transactions");
  const originBtn = $("origin-button");
  let activeRequest = null;
  let activeAddress = "";

  function element(tag, cls, text) {
    const x = document.createElement(tag);
    if (cls) x.className = cls;
    if (text !== undefined && text !== null) x.textContent = String(text);
    return x;
  }
  function setStatus(message, error=false) {
    status.textContent=message;
    status.classList.toggle("error",error);
  }
  function trimHash(s) {
    if(!s)return "Unknown";
    return s.length>22?s.slice(0,10)+"…"+s.slice(-8):s;
  }
  function normalize(raw) {
    const value=String(raw||"").trim();
    const match=value.match(/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/);
    return match?match[0]:null;
  }
  function parseWalletInput(raw) {
    const value=String(raw||"").trim();
    const exact=normalize(value);
    if(exact) return {address:exact};
    const ens=value.match(/(?:^|[^a-z0-9-])([a-z0-9][a-z0-9-]{0,62}\.eth)(?=$|[^a-z0-9.-])/i);
    if(ens) return {ens:ens[1].toLowerCase()};
    const fragment=value.match(/0x([a-fA-F0-9]+)/);
    if(fragment) {
      const n=fragment[1].length;
      return {error:"Incomplete Ethereum address: found "+n+" hexadecimal characters after 0x; exactly 40 are required. Copy the full address or enter its ENS name. NODIVRA will not guess missing characters."};
    }
    return {error:"Paste a complete Ethereum address, an Etherscan link, or an ENS name ending in .eth."};
  }
    function showWei(wei,decimals=6) {
    if(wei===null||wei===undefined||wei==="")return "Unavailable";
    try {
      const n=BigInt(wei),unit=1000000000000000000n;
      const whole=n/unit, frac=(n<0n?-n:n)%unit;
      const digits=frac.toString().padStart(18,"0").slice(0,decimals);
      if(n>0n&&whole===0n&&Number(digits)===0)return "<0."+ "0".repeat(decimals-1)+"1 ETH";
      return (n<0n?"-":"")+ (whole<0n?-whole:whole).toString()+"."+digits+" ETH";
    } catch(_) {return "Unavailable";}
  }
  function link(href,text) {
    const a=element("a","",text);
    a.href=href;a.target="_blank";a.rel="noopener noreferrer";return a;
  }
  async function fetchJson(url,signal,timeout=13000) {
    const c=new AbortController();
    const timer=setTimeout(()=>c.abort(),timeout);
    const abort=()=>c.abort();
    if(signal)signal.addEventListener("abort",abort,{once:true});
    try {
      const response=await fetch(url,{signal:c.signal,headers:{"Accept":"application/json"}});
      if(!response.ok) {
        const data=await response.json().catch(()=>({}));
        throw new Error(data.error||"HTTP "+response.status);
      }
      return await response.json();
    } finally {clearTimeout(timer);if(signal)signal.removeEventListener("abort",abort);}
  }
  function valOK(jobs) {return jobs[0]?.status==="fulfilled" || jobs.slice(1).some(j=>j.status==="fulfilled" && Array.isArray(j.value?.items));}
  async function lookupData(address,signal) {
    try {
      const data=await fetchJson(API+"/lookup?address="+encodeURIComponent(address),signal,16000);
      return {data,provider:"NODIVRA gateway · Blockscout"};
    } catch(e) {
      if(signal.aborted)throw e;
      const root=DIRECT+"/addresses/"+encodeURIComponent(address);
      const jobs=await Promise.allSettled([fetchJson(root,signal,10000),fetchJson(root+"/transactions",signal,10000),fetchJson(root+"/token-transfers",signal,10000),fetchJson(root+"/internal-transactions",signal,10000)]);
      if(!valOK(jobs))throw new Error("Gateway unavailable ("+e.message+"); direct API also blocked or unavailable.");
      const val=i=>jobs[i].status==="fulfilled"?jobs[i].value:null;
      const tx=val(1)?.items||[];
      return {data:{address,account:val(0),transactions:val(1)?.items||null,token_transfers:val(2)?.items||null,internal_transactions:val(3)?.items||null,connections:connectionsFrom(tx,address),source_status:{account:val(0)?"ok":"unavailable",transactions:val(1)?"ok":"unavailable",token_transfers:val(2)?"ok":"unavailable",internal_transactions:val(3)?"ok":"unavailable"},account_source:val(0)?"Blockscout":null,public_attributions:[],errors:jobs.filter(j=>j.status==="rejected").map(j=>j.reason.message)},provider:"Blockscout · direct fallback"};
    }
  }
  function connectionsFrom(txs,address) {
    const items=new Map(), addr=address.toLowerCase();
    for(const t of txs) {
      const outgoing=(t.from?.hash||"").toLowerCase()===addr;
      const peer=outgoing?t.to:t.from;
      if(!peer?.hash||!ADDRESS_RE.test(peer.hash)||peer.hash.toLowerCase()===addr)continue;
      const key=peer.hash.toLowerCase(),item=items.get(key)||{address:peer.hash,label:null,count:0,incoming:0,outgoing:0};
      item.count++;
      if(outgoing)item.outgoing++;else item.incoming++;
      if(peer.name||peer.ens_domain_name)item.label=peer.name||peer.ens_domain_name;
      items.set(key,item);
    }
    return [...items.values()].sort((a,b)=>b.count-a.count).slice(0,16);
  }
  function renderConnections(data,address) {
    const target=$("connections");
    const peers=data.connections?.length?data.connections:connectionsFrom(data.transactions||[],address);
    target.replaceChildren();
    if(!peers.length){target.hidden=true;return;}
    target.hidden=false;
    target.appendChild(element("h3","","Connected addresses · recent sample"));
    target.appendChild(element("p","minor","Direct transaction counterparties only. Interaction does not prove common ownership."));
    const grid=element("div","conn-grid");
    for(const peer of peers.slice(0,12)) {
      const b=element("button","conn-item");b.type="button";
      b.appendChild(element("strong","",peer.label||trimHash(peer.address)));
      b.appendChild(element("span","",(peer.count||0)+" observed transfers · IN "+(peer.incoming||0)+" / OUT "+(peer.outgoing||0)));
      b.title=peer.address;b.addEventListener("click",()=>{input.value=peer.address;lookup(peer.address);});
      grid.appendChild(b);
    }
    target.appendChild(grid);
  }


  let evidenceSnapshot=null;
  function safeLink(url,title) {
    if(typeof url!=="string" || !/^https:\/\//.test(url))return null;
    return link(url,title);
  }
  function evidenceLine(parent,title,value) {
    const line=element("div","evidence-line");
    line.appendChild(element("span","",title));
    line.appendChild(element("strong","",value||"Unknown"));
    parent.appendChild(line);
  }
  function intelligenceBrief(data,address) {
    const root=$("intelligence");
    if(!root)return;
    root.replaceChildren();root.hidden=false;
    const insight=data.intelligence;
    const p=data.provenance;
    const v=document.createDocumentFragment();
    v.appendChild(element("div","tiny-label","INTELLIGENCE BRIEF  ·  ETHEREUM MAINNET"));
    v.appendChild(element("h3","","What can we establish about this address?"));
    if(!insight) {
      v.appendChild(element("p","minor","Only a basic transaction sample is available from the fallback provider. Evidence-based intelligence enrichment is unavailable."));
      root.appendChild(v);return;
    }
    v.appendChild(element("p","intel-summary",insight.summary));
    const grid=element("div","evidence-grid");
    evidenceLine(grid,"On-chain classification",insight.account_category);
    evidenceLine(grid,"Identified legal owner",insight.owner);
    evidenceLine(grid,"Attribution evidence",insight.attribution_level);
    evidenceLine(grid,"Indexed external transactions",insight.counts?.external??"Not available");
    evidenceLine(grid,"Indexed token events",insight.counts?.tokens??"Not available");
    evidenceLine(grid,"Earliest incoming in sample",p?.earliest_in_sample ? new Date(p.earliest_in_sample.timestamp).toLocaleString()+" · "+p.earliest_in_sample.asset : "Not observed");
    v.appendChild(grid);
    if(p?.first_visible_funders?.length){
      const section=element("div","intel-subsection");
      section.appendChild(element("h4","","Observed funding leads"));
      section.appendChild(element("p","minor","These are incoming transfers in the returned sample, not proven first-ever funders or wallet owners."));
      for(const item of p.first_visible_funders.slice(0,6)){
        const entry=element("div","source-entry");
        const meta=element("div","");
        meta.appendChild(element("strong","",item.from_name||trimHash(item.from)));
        meta.appendChild(element("span","",item.asset+" · "+new Date(item.timestamp).toLocaleString()));
        entry.appendChild(meta);
        const a=link(BLOCKSCOUT+item.from,"Trace source →");
        a.title=item.from;a.addEventListener("click",e=>{e.preventDefault();input.value=item.from;lookup(item.from);});
        entry.appendChild(a);section.appendChild(entry);
      }
      v.appendChild(section);
    }
    if(Array.isArray(data.linked_entities)&&data.linked_entities.length){
      const section=element("div","intel-subsection");
      section.appendChild(element("h4","","Direct connections · enriched public tags"));
      section.appendChild(element("p","minor","These addresses interacted with the target. This does not establish that the same person controls them."));
      for(const peer of data.linked_entities.slice(0,4)){
        const row=element("div","source-entry");
        const details=element("div","");
        details.appendChild(element("strong","",peer.public_label||trimHash(peer.address)));
        details.appendChild(element("span","",peer.account_type+" · "+peer.count+" interactions"+(peer.label_source?" · "+peer.label_source:"")));
        row.appendChild(details);
        const button=element("button","trace-button","Investigate →");
        button.type="button";button.addEventListener("click",()=>{input.value=peer.address;lookup(peer.address);});
        row.appendChild(button);
        section.appendChild(row);
      }
      v.appendChild(section);
    }
    if(insight.limitations?.length){
      const section=element("div","intel-subsection");
      section.appendChild(element("h4","","What remains unverified"));
      for(const note of insight.limitations.slice(0,5))section.appendChild(element("p","minor","• "+note));
      v.appendChild(section);
    }
    const sources=element("div","intel-sources");
    sources.appendChild(element("h4","","Cross-check public sources"));
    for(const item of insight.verification_links||[]){
      const a=safeLink(item.url,item.title+" ↗");if(a)sources.appendChild(a);
    }
    v.appendChild(sources);
    root.appendChild(v);
  }
  function exportEvidence(){
    if(!evidenceSnapshot){setStatus("Investigate a wallet before exporting an evidence report.",true);return;}
    const report={title:"NODIVRA · Public intelligence brief",generated_at:new Date().toISOString(),
      address:evidenceSnapshot.address,chain:"Ethereum mainnet",source:"Public indexers / RPC / labels",
      intelligence:evidenceSnapshot.intelligence||null,provenance:evidenceSnapshot.provenance||null,
      public_attributions:evidenceSnapshot.public_attributions||[],
      linked_entities:evidenceSnapshot.linked_entities||[],
      data_coverage:evidenceSnapshot.source_status||{},
      note:"Read-only public intelligence. No ownership inference from transaction adjacency. Confirm critical findings using primary sources."};
    const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"});
    const temp=URL.createObjectURL(blob);
    const anchor=document.createElement("a");anchor.href=temp;anchor.download="nodivra-evidence-"+evidenceSnapshot.address.slice(0,12)+".json";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(temp),2000);
  }

  function renderAttribution(data) {
    const target=$("attribution");
    if(!target)return;
    target.replaceChildren();
    const title=element("h3","","Public attribution & identity evidence");
    target.appendChild(title);
    const disclaimer=element("p","minor","A label is not proof of legal ownership. ENS names, public explorer tags and community labels have different evidence strengths.");
    target.appendChild(disclaimer);
    const labels=Array.isArray(data.public_attributions)?data.public_attributions:[];
    if(!labels.length){
      target.appendChild(element("p","attr-unknown","Unknown — no public identity or organization attribution was found in the consulted sources."));
    }else {
      for(const tag of labels.slice(0,12)) {
        const row=element("div","attr-item");
        row.appendChild(element("strong","",tag.name||"Unspecified"));
        row.appendChild(element("span","",tag.kind||"Public source label"));
        if(typeof tag.source_url==="string"&&tag.source_url.startsWith("https://"))
          row.appendChild(link(tag.source_url,"Source: "+(tag.source||"public dataset")+" ↗"));
        target.appendChild(row);
      }
    }
    const from=data.account_source ? "Balance/type: "+data.account_source+". " : "Balance/type source unavailable. ";
    const status=data.source_status||{};
    target.appendChild(element("p","minor",from+"Index status: external "+(status.transactions||"unavailable")+", token "+(status.token_transfers||"unavailable")+", internal "+(status.internal_transactions||"unavailable")+", labels "+(status.labels||"unavailable")+"."));
  }
  function renderTokens(data) {
    const box=$("tokens");
    box.replaceChildren();
    const items=Array.isArray(data.token_transfers)?data.token_transfers:[];
    if(!items.length){box.hidden=true;return;}
    box.hidden=false;
    box.appendChild(element("h3","","Recent token transfers"));
    box.appendChild(element("p","minor","Token events are separate from regular ETH transactions. Displayed symbols and labels are unverified metadata."));
    const list=element("div","token-list");
    for(const t of items.slice(0,15)) {
      const symbol=t.token?.symbol||t.token?.name||"Token";
      const typ=t.token?.type||"";
      list.appendChild(element("span","token-pill",String(symbol).slice(0,22)+(typ?" · "+typ:"")));
    }
    box.appendChild(list);
  }
  function renderTransactions(data,address) {
    txList.replaceChildren();
    const txs=Array.isArray(data.transactions)?data.transactions.slice(0,15):[];
    for(const tx of txs) {
      const row=element("div","tx-item"),info=element("div","tx-main"),amount=element("div","tx-amount");
      const from=tx.from?.hash||"",to=tx.to?.hash||"";
      const direction=from.toLowerCase()===address.toLowerCase()?"OUT":to.toLowerCase()===address.toLowerCase()?"IN":"OTHER";
      info.appendChild(link("https://eth.blockscout.com/tx/"+encodeURIComponent(tx.hash||""),trimHash(tx.hash)));
      const when=tx.timestamp?new Date(tx.timestamp).toLocaleString():"Unknown date";
      info.appendChild(element("div","tx-sub",when+" · "+trimHash(from)+" → "+trimHash(to)));
      amount.appendChild(element("span","tx-dir"+(direction==="OUT"?" out":""),direction));
      amount.appendChild(element("div","",showWei(tx.value)));
      row.appendChild(info);row.appendChild(amount);txList.appendChild(row);
    }
    if(!Array.isArray(data.transactions))txList.appendChild(element("p","disclaimer","External transaction index unavailable — activity is unknown, not zero."));
    else if(!txs.length)txList.appendChild(element("p","disclaimer","No indexed external transactions returned for this address. Other activity may exist."));
  }
  function setUrl(address) {
    try {const url=new URL(location.href);url.searchParams.set("address",address);history.replaceState(null,"",url);}catch(_){}
  }

  const BTC_ADDRESS_RE = /^(?:bc1[ac-hj-np-z02-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
  function isBitcoin(value){return BTC_ADDRESS_RE.test(String(value||"").trim());}
  function chainResult(data) {
    const root=$("chain-results");root.replaceChildren();root.hidden=false;
    if(!data || !Array.isArray(data.networks)){root.appendChild(element("p","minor","Cross-chain evidence is unavailable."));return;}
    const head=element("div","chain-header");
    head.appendChild(element("div","tiny-label","NODIVRA · CROSS-CHAIN DISCOVERY"));
    head.appendChild(element("h3","","Where does this address appear?"));
    head.appendChild(element("p","minor",data.discovery?.summary||"Network coverage available below."));
    root.appendChild(head);
    const n=element("div","chain-grid");
    for(const network of data.networks){
      const card=element("article","chain-card");
      const top=element("div","chain-card-head");
      top.appendChild(element("strong","",network.name));
      top.appendChild(element("span","chain-status",network.status==="activity_observed"?"OBSERVED":network.status==="indexed_no_sample_activity"?"NO INDEXED ACTIVITY":network.status==="not_indexed"?"NOT INDEXED":"UNAVAILABLE"));
      card.appendChild(top);
      const balance=network.native_balance===null||network.native_balance===undefined?"Balance unavailable":network.native_balance+" "+network.symbol;
      card.appendChild(element("div","chain-balance",balance));
      const tokens=Array.isArray(network.assets)?network.assets:[];
      if(tokens.length){
        const body=element("div","chain-tokens");
        body.appendChild(element("div","tiny-label","TOKEN BALANCES · INDEXED"));
        for(const asset of tokens.slice(0,7)) {
          const row=element("div","chain-token");
          row.appendChild(element("span","",asset.symbol));
          row.appendChild(element("strong","",asset.amount));
          body.appendChild(row);
        }
        card.appendChild(body);
      }
      const tx=network.transaction_count??(Array.isArray(network.recent_transactions)&&network.checks?.transactions==="ok"?network.recent_transactions.length:null);
      card.appendChild(element("p","minor",tx===null?"Transaction count unavailable":String(tx)+(network.transaction_count===null?" recent transactions shown":" confirmed transactions")));
      if(network.public_labels?.length){
        const labels=element("div","chain-labels");
        for(const tag of network.public_labels.slice(0,2))labels.appendChild(element("p","minor",tag.type+": "+tag.label+" · public explorer label"));
        card.appendChild(labels);
      }
      if(network.warnings?.length && network.status!=="activity_observed")card.appendChild(element("p","minor",network.warnings[0]));
      if(network.explorer_url?.startsWith("https://"))card.appendChild(link(network.explorer_url,"Verify on explorer ↗"));
      n.appendChild(card);
    }
    root.appendChild(n);
    const notes=element("p","minor chain-notes",data.limitations||"Public indexed data only.");
    root.appendChild(notes);
  }
  async function scanAllNetworks(address,controller){
    const root=$("chain-results");
    root.hidden=false;root.replaceChildren();
    root.appendChild(element("p","minor","Checking supported networks and indexed crypto assets…"));
    try{
      const data=await fetchJson(API+"/multichain?address="+encodeURIComponent(address),controller.signal,30000);
      if(activeRequest!==controller)return;
      chainResult(data);
      if(data.format==="bitcoin"){
        results.hidden=true;
        setStatus("Bitcoin investigation: "+(data.networks?.[0]?.transaction_count??"unavailable")+" confirmed transactions in the indexed address history. Use the linked explorer to inspect individual transfers.");
      }
    }catch(e){
      if(activeRequest!==controller)return;
      root.replaceChildren();root.appendChild(element("p","minor","Cross-chain lookup unavailable: "+e.message+". No portfolio or identity claim can be made from this response."));
    }
  }

  async function lookup(address) {
    if(isBitcoin(address)){
      if(activeRequest)activeRequest.abort();
      const bitcoinController=new AbortController();
      activeRequest=bitcoinController;activeAddress=String(address).trim();
      input.value=activeAddress;results.hidden=true;
      button.disabled=true;button.textContent="Investigating…";
      setStatus("Searching the Bitcoin address and its confirmed transactions…");
      try {await scanAllNetworks(activeAddress,bitcoinController);}
      finally {if(activeRequest===bitcoinController){button.disabled=false;button.textContent="Investigate →";}}
      return;
    }
    const parsed=parseWalletInput(address);
    if(parsed.error) {
      $("chain-results").hidden=true;
      results.hidden=true;
      setStatus(parsed.error,true);
      return;
    }
    if(activeRequest)activeRequest.abort();
    const controller=new AbortController();activeRequest=controller;
    button.disabled=true;button.textContent="Investigating…";
    results.hidden=true;$("origin-result").hidden=true;
    evidenceSnapshot=null;
    let normalized=parsed.address;
    try {
      if(parsed.ens) {
        setStatus("Resolving ENS name "+parsed.ens+" through the public registry…");
        const resolved=await fetchJson(API+"/resolve?name="+encodeURIComponent(parsed.ens),controller.signal,15000);
        if(!ADDRESS_RE.test(resolved.address||"")) throw new Error("The ENS name has no valid Ethereum address record.");
        normalized=resolved.address;
      }
      if(activeRequest!==controller)return;
      activeAddress=normalized;
      input.value=normalized;
      scanAllNetworks(normalized,controller);
      $("explorer-link").href=BLOCKSCOUT+normalized;
      $("result-address").textContent=normalized;
      $("balance").textContent="—";$("shown").textContent="—";$("account-type").textContent="—";
      setStatus("Retrieving on-chain evidence for "+trimHash(normalized)+"…");
      const {data,provider}=await lookupData(normalized,controller.signal);
      if(activeRequest!==controller)return;
      const account=data.account||{};
      $("balance").textContent=showWei(account.coin_balance);
      $("shown").textContent=Array.isArray(data.transactions)?String(data.transactions.length):"Unavailable";
      $("account-type").textContent=account.is_contract===true?"Contract":account.is_contract===false?"EOA (technical type)":"Unverified";
      $("coverage").textContent=provider+" · recent activity";
      evidenceSnapshot=data;
      intelligenceBrief(data,normalized);
      renderAttribution(data);
      renderConnections(data,normalized);
      renderTokens(data);
      renderTransactions(data,normalized);
      results.hidden=false;
      setUrl(normalized);
      const internalCount=data.internal_transactions?.length||0, tokenCount=data.token_transfers?.length||0;
      const hasIndexedTx=Array.isArray(data.transactions);
      if(!hasIndexedTx) setStatus("Partial data only: transaction index unavailable. A missing history is not proof of zero transactions.",true);
      else if(!data.transactions.length && !tokenCount && !internalCount) setStatus("No indexed activity found for this exact address in the returned samples. Please double-check every character; a different last digit is a different wallet.");
      else setStatus("Found "+data.transactions.length+" recent external transactions, "+tokenCount+" token events and "+internalCount+" internal movements. These are observations, not identity proof.");
      if(data.errors?.length) {
        const note=element("span","error-details","Some evidence is unavailable: "+data.errors.slice(0,2).join("; "));
        status.appendChild(note);
      }
    }catch(e) {
      if(activeRequest!==controller)return;
      if(!normalized) {
        results.hidden=true;
        setStatus("Could not resolve ENS name: "+e.message+". Please verify the name or paste the address directly.",true);
      } else {
        results.hidden=false;
        $("connections").hidden=true;$("tokens").hidden=true;
        txList.replaceChildren();
        $("coverage").textContent="Provider unavailable — explorer links remain available";
        setStatus("Could not retrieve public data: "+e.message+". You can still inspect the address on Blockscout or Etherscan.",true);
        status.appendChild(document.createTextNode(" "));
        status.appendChild(link(ETHERSCAN+normalized,"Open Etherscan ↗"));
      }
    }finally {
      if(activeRequest===controller){button.disabled=false;button.textContent="Investigate →";}
    }
  }
  async function traceOrigin() {
    if(!activeAddress)return;
    const address=activeAddress;
    originBtn.disabled=true;originBtn.textContent="Scanning older transactions…";
    const box=$("origin-result");box.hidden=false;box.replaceChildren();
    box.appendChild(element("p","minor","Scanning the indexed Ethereum transaction history (bounded to 18 pages)."));
    try {
      const data=await fetchJson(API+"/origin?address="+encodeURIComponent(address),null,40000);
      if(address!==activeAddress)return;
      box.replaceChildren();
      box.appendChild(element("h3","","Origin investigation"));
      box.appendChild(element("p","origin-line","Transactions scanned: "+data.transactions_scanned+" · Pages: "+data.pages_scanned+" · "+(data.complete?"Index history reached":"Partial scan")));
      if(data.earliest_transaction_observed) {
        const line=element("p","origin-line","Oldest observed transaction: "+new Date(data.earliest_transaction_observed.timestamp).toLocaleString()+" · ");
        line.appendChild(link("https://eth.blockscout.com/tx/"+data.earliest_transaction_observed.hash,trimHash(data.earliest_transaction_observed.hash)));box.appendChild(line);
      }
      if(data.earliest_native_funding_observed) {
        const f=data.earliest_native_funding_observed;
        const line=element("p","origin-line","Earliest observed incoming ETH: "+showWei(f.value_wei)+" from ");
        line.appendChild(link(BLOCKSCOUT+f.from,trimHash(f.from)));box.appendChild(line);
      }else box.appendChild(element("p","minor","No incoming native ETH transfer found in the scanned external transactions."));
      box.appendChild(element("p","minor",data.warning||"Attribution requires additional evidence."));
    }catch(e) {
      box.replaceChildren();box.appendChild(element("p","minor","Origin scan unavailable: "+e.message+". Recent evidence above remains accessible."));
    }finally{originBtn.disabled=false;originBtn.textContent="Trace earliest funding →";}
  }
  form.addEventListener("submit",e=>{e.preventDefault();lookup(input.value);});
  $("example").addEventListener("click",()=>lookup("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"));
  originBtn.addEventListener("click",traceOrigin);
  $("export-evidence").addEventListener("click",exportEvidence);
  const initial=new URLSearchParams(location.search).get("address");
  if(initial&&(normalize(initial)||isBitcoin(initial)))lookup(initial);
  function background(){
    const canvas=$("bg-canvas");
    if(!canvas||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const ctx=canvas.getContext("2d");if(!ctx)return;
    let w,h,pts=[],raf=0,last=0;
    function size(){
      const dpr=Math.min(devicePixelRatio||1,2);
      w=innerWidth;h=innerHeight;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      pts=Array.from({length:Math.min(65,Math.max(20,Math.floor(w/24)))},()=>({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-.5)*.34,vy:(Math.random()-.5)*.34}));
    }
    function step(time){
      raf=requestAnimationFrame(step);
      if(document.hidden||time-last<35)return;last=time;
      ctx.clearRect(0,0,w,h);
      for(let i=0;i<pts.length;i++){
        const p=pts[i];p.x+=p.vx;p.y+=p.vy;
        if(p.x<0||p.x>w)p.vx*=-1;if(p.y<0||p.y>h)p.vy*=-1;
        ctx.fillStyle="rgba(112,249,197,.6)";
        ctx.beginPath();ctx.arc(p.x,p.y,1.3,0,Math.PI*2);ctx.fill();
        for(let j=i+1;j<pts.length;j++){
          const q=pts[j],dx=p.x-q.x,dy=p.y-q.y;
          const d2=dx*dx+dy*dy;
          if(d2<19000){ctx.strokeStyle="rgba(58,184,255,"+(.15*(1-d2/19000))+")";ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();}
        }
      }
    }
    size();addEventListener("resize",size,{passive:true});raf=requestAnimationFrame(step);
  }
  background();
})();

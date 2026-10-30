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
  async function lookupData(address,signal) {
    try {
      const data=await fetchJson(API+"/lookup?address="+encodeURIComponent(address),signal,16000);
      return {data,provider:"NODIVRA gateway · Blockscout"};
    } catch(e) {
      if(signal.aborted)throw e;
      const root=DIRECT+"/addresses/"+encodeURIComponent(address);
      const jobs=await Promise.allSettled([fetchJson(root,signal,10000),fetchJson(root+"/transactions",signal,10000),fetchJson(root+"/token-transfers",signal,10000),fetchJson(root+"/internal-transactions",signal,10000)]);
      if(jobs.every(j=>j.status==="rejected"))throw new Error("Gateway unavailable ("+e.message+"); direct API also blocked or unavailable.");
      const val=i=>jobs[i].status==="fulfilled"?jobs[i].value:null;
      const tx=val(1)?.items||[];
      return {data:{address,account:val(0),transactions:tx,token_transfers:val(2)?.items||[],internal_transactions:val(3)?.items||[],connections:connectionsFrom(tx,address),errors:jobs.filter(j=>j.status==="rejected").map(j=>j.reason.message)},provider:"Blockscout · direct fallback"};
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
    if(!txs.length)txList.appendChild(element("p","disclaimer","No external transactions returned. This does not exclude token or internal activity."));
  }
  function setUrl(address) {
    try {const url=new URL(location.href);url.searchParams.set("address",address);history.replaceState(null,"",url);}catch(_){}
  }
  async function lookup(address) {
    const normalized=normalize(address);
    if(!normalized) {
      results.hidden=true;
      setStatus("Please paste an Ethereum address (0x + 40 hexadecimal characters), or an explorer link containing one.",true);
      return;
    }
    if(activeRequest)activeRequest.abort();
    const controller=new AbortController();activeRequest=controller;activeAddress=normalized;
    input.value=normalized;button.disabled=true;button.textContent="Investigating…";
    results.hidden=true;$("origin-result").hidden=true;
    $("explorer-link").href=BLOCKSCOUT+normalized;
    $("result-address").textContent=normalized;
    $("balance").textContent="—";$("shown").textContent="—";$("account-type").textContent="—";
    setStatus("Retrieving on-chain evidence for "+trimHash(normalized)+"…");
    try {
      const {data,provider}=await lookupData(normalized,controller.signal);
      if(activeRequest!==controller)return;
      const account=data.account||{};
      $("balance").textContent=showWei(account.coin_balance);
      $("shown").textContent=String(data.transactions?.length||0);
      $("account-type").textContent=account.is_contract===true?"Contract":account.is_contract===false?"Wallet / EOA":"Unconfirmed";
      $("coverage").textContent=provider+" · recent activity";
      renderConnections(data,normalized);
      renderTokens(data);
      renderTransactions(data,normalized);
      results.hidden=false;
      setUrl(normalized);
      const internalCount=data.internal_transactions?.length||0, tokenCount=data.token_transfers?.length||0;
      setStatus("Loaded "+(data.transactions?.length||0)+" transactions, "+tokenCount+" token events and "+internalCount+" internal movements. Select a connected address or trace the origin.");
      if(data.errors?.length) {
        const note=element("span","error-details","Some evidence is unavailable: "+data.errors.slice(0,2).join("; "));
        status.appendChild(note);
      }
    }catch(e) {
      if(activeRequest!==controller)return;
      results.hidden=false;
      $("connections").hidden=true;$("tokens").hidden=true;
      txList.replaceChildren();
      $("coverage").textContent="Provider unavailable — explorer links remain available";
      setStatus("Could not retrieve public data: "+e.message+". You can still inspect the address on Blockscout or Etherscan.",true);
      const a=link(ETHERSCAN+normalized,"Open Etherscan ↗");
      status.appendChild(document.createTextNode(" "));status.appendChild(a);
    }finally{
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
  const initial=new URLSearchParams(location.search).get("address");
  if(initial&&normalize(initial))lookup(initial);
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

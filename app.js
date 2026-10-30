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


  let flowEvidence=null;
  let investigationSequence=0;
  function traceText(parent,text,style="minor"){parent.appendChild(element("p",style,text));}
  function graphAddress(address){return "https://eth.blockscout.com/address/"+encodeURIComponent(address);}

  function renderInteractiveNetwork(report,nodes) {
    const graph=report.graph||{}, edges=(graph.edges||[]).slice(0,50);
    if(!edges.length)return null;
    const byId=new Map((graph.nodes||[]).map(n=>[n.address.toLowerCase(),n]));
    const subject=report.address.toLowerCase();
    const direction=report.mode?.direction||"in";
    const layout=new Map(),columns=[[],[],[]];
    const root=byId.get(subject);
    if(!root)return null;
    const rootColumn=direction==="in"?2:direction==="out"?0:1;
    columns[rootColumn].push(root);
    layout.set(subject,rootColumn);
    for(const edge of edges) {
      for(const address of [edge.from,edge.to]) {
        const key=address.toLowerCase();
        if(key===subject||layout.has(key)||!byId.has(key))continue;
        const column= direction==="in"?Math.max(0,2-edge.hop):
          direction==="out"?Math.min(2,edge.hop):
          edge.from.toLowerCase()===subject?2:edge.to.toLowerCase()===subject?0:
          edge.from.toLowerCase()===edge.observed_via?.toLowerCase()?2:0;
        layout.set(key,column);columns[column].push(byId.get(key));
      }
    }
    // Nodes only observed in an evidence edge; root is kept even if a provider returns extra metadata.
    const maxCount=Math.max(1,...columns.map(c=>c.length));
    const height=Math.max(320,Math.min(1300,maxCount*72+90)),width=960;
    const positions=new Map();
    columns.forEach((list,i)=>{
      const yGap=(height-80)/(list.length+1);
      list.forEach((n,j)=>positions.set(n.address.toLowerCase(),{x:120+i*355,y:40+(j+1)*yGap}));
    });
    const shell=element("div","network-shell");
    shell.appendChild(element("div","tiny-label","INTERACTIVE NETWORK · CLICK ANY ADDRESS TO INVESTIGATE"));
    const scroll=element("div","network-scroll");
    const namespace="http://www.w3.org/2000/svg";
    const svg=document.createElementNS(namespace,"svg");
    svg.setAttribute("viewBox","0 0 "+width+" "+height);
    svg.setAttribute("width",String(width));
    svg.setAttribute("height",String(height));
    svg.setAttribute("role","img");
    svg.setAttribute("aria-label","Evidence network showing observed address relationships. A readable list with transaction hashes follows.");
    svg.classList.add("network-svg");
    const make=(name,attrs={})=>{
      const item=document.createElementNS(namespace,name);
      for(const [k,v] of Object.entries(attrs))item.setAttribute(k,String(v));
      return item;
    };
    const defs=make("defs");
    const marker=make("marker",{id:"nodivra-arrow",viewBox:"0 0 10 10",refX:9,refY:5,markerWidth:5,markerHeight:5,orient:"auto-start-reverse"});
    marker.appendChild(make("path",{d:"M0 0 L10 5 L0 10 Z",fill:"#4c9382"}));
    defs.appendChild(marker);svg.appendChild(defs);
    const edgeKeys=new Set();
    for(const e of edges){
      const a=positions.get(e.from.toLowerCase()),b=positions.get(e.to.toLowerCase());
      if(!a||!b)continue;
      const edgeKey=e.from.toLowerCase()+"|"+e.to.toLowerCase()+"|"+e.hop;
      if(edgeKeys.has(edgeKey))continue;edgeKeys.add(edgeKey);
      const bend=Math.abs(b.x-a.x)<5?45:0;
      const path=make("path",{d:"M "+a.x+" "+a.y+" Q "+((a.x+b.x)/2+bend)+" "+((a.y+b.y)/2-18)+" "+b.x+" "+b.y,
        fill:"none",stroke:e.hop===1?"#5bba9d":"#497783","stroke-width":e.hop===1?2:1.3,
        "marker-end":"url(#nodivra-arrow)",opacity:e.hop===1?0.8:0.5});
      const t=make("title");t.textContent="Observed "+e.asset+" transfer · "+e.tx_hash;
      path.appendChild(t);svg.appendChild(path);
    }
    for(const [key,p] of positions){
      const node=byId.get(key),isRoot=key===subject,tagged=(node.labels||[]).length>0;
      const g=make("g",{transform:"translate("+p.x+" "+p.y+")",tabindex:"0",role:"button",
        "aria-label":"Investigate "+node.address});
      g.style.cursor="pointer";
      const bg=make("rect",{x:-100,y:-23,width:200,height:46,rx:9,fill:isRoot?"#145744":tagged?"#17443f":"#102731",
        stroke:isRoot?"#91f8ca":tagged?"#56ac91":"#335d66","stroke-width":isRoot?2:1});
      g.appendChild(bg);
      const title=make("text",{x:0,y:-3,"text-anchor":"middle",fill:"#e8f5f1","font-size":12,"font-weight":700});
      const name=node.labels?.[0]?.name;
      const short=typeof name==="string"&&name.length?name.slice(0,24):node.address.slice(0,8)+"…"+node.address.slice(-6);
      title.textContent=short;g.appendChild(title);
      const sub=make("text",{x:0,y:13,"text-anchor":"middle",fill:"#89aba6","font-size":10});
      sub.textContent=isRoot?"TARGET":tagged?"PUBLIC LABEL · CHECK SOURCE":"UNKNOWN OWNER";
      g.appendChild(sub);
      const tooltip=make("title");tooltip.textContent=node.address;g.appendChild(tooltip);
      const go=()=>{input.value=node.address;lookup(node.address);$("explore").scrollIntoView({behavior:"smooth"});};
      g.addEventListener("click",go);
      g.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();go();}});
      svg.appendChild(g);
    }
    scroll.appendChild(svg);shell.appendChild(scroll);
    shell.appendChild(element("p","minor","The lines show observed transactions, not proven ownership or a continuous path for the same coins. See the hashes below for evidence."));
    return shell;
  }


  function renderInvestigationLeads(report) {
    const root=$("trace-leads");
    root.replaceChildren();root.hidden=false;
    const leads=report.investigator_leads;
    if(!leads) {
      root.appendChild(element("p","case-attention","The API returned transaction evidence but no investigator lead summary. Inspect the graph and hashes before reaching any conclusion."));
      return;
    }
    const topline=element("div","lead-topline");
    topline.appendChild(element("strong","","INVESTIGATION LEADS"));
    topline.appendChild(element("span","",report.stats.transfers+" transfers · "+leads.top_leads.length+" leads"));
    root.appendChild(topline);
    root.appendChild(element("p","lead-summary",leads.first_action));
    if(report.coverage?.partial)root.appendChild(element("p","case-attention","Partial coverage: one or more sources did not respond. Missing data is not evidence of an inactive address."));
    if(!leads.top_leads.length)root.appendChild(element("p","case-attention","No linked counterparty was observed in the returned sample. Verify the address and try a different network or direction."));
    for(const lead of (leads.top_leads||[]).slice(0,5)) {
      const item=element("article","lead-item");
      const info=element("div","lead-info");
      const title=lead.public_label?lead.public_label:trimHash(lead.target_address);
      info.appendChild(element("strong","",title));
      info.appendChild(element("span","lead-type",lead.public_label?"PUBLIC TAG · VERIFY SOURCE":"OWNER UNKNOWN"));
      info.appendChild(element("span","",lead.direction+" · "+lead.observed_transfers+" observed transfer(s) · "+lead.assets.slice(0,4).join(", ")));
      item.appendChild(info);
      const actions=element("div","lead-actions");
      const first=lead.evidence?.[0];
      if(first?.url?.startsWith("https://"))actions.appendChild(link(first.url,"Verify tx ↗"));
      if(lead.label_provenance?.url?.startsWith("https://"))actions.appendChild(link(lead.label_provenance.url,"Label source ↗"));
      const explore=element("button","trace-button","Follow →");
      explore.type="button";explore.title="Investigate "+lead.target_address;
      explore.addEventListener("click",()=>{
        input.value=lead.target_address;
        lookup(lead.target_address);
        $("explore").scrollIntoView({behavior:"smooth"});
      });
      actions.appendChild(explore);item.appendChild(actions);
      const note=element("p","lead-note",lead.next_action);
      item.appendChild(note);root.appendChild(item);
    }
    root.appendChild(element("p","lead-disclaimer","Public tags are investigation leads, not verified owners. Transfer links are not proof of shared control."));
  }
  function exportCaseDossier(){
    if(!flowEvidence){$("trace-state").textContent="Run a trace before exporting a dossier.";return;}
    const note=$("case-notes").value.trim(),caseRef=$("case-reference").value.trim();
    const selectedNetwork=$("trace-network").value;
    const caseData={
      title:"NODIVRA · public evidence investigation dossier",
      case_reference:caseRef||null,
      created_at:new Date().toISOString(),
      investigator_notes:note||null,
      network:selectedNetwork,
      subject:flowEvidence.address,
      findings:flowEvidence.investigator_leads||null,
      observed_graph:flowEvidence.graph,
      sources:flowEvidence.osint?.sources||[],
      source_coverage:flowEvidence.coverage,
      limits:flowEvidence.limitations,
      warning:"Read-only public data. This file is not a certified chain-of-custody record, a legal identification, or proof of criminal involvement."
    };
    const contents=JSON.stringify(caseData,null,2);
    const blob=new Blob([contents],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download="nodivra-case-"+flowEvidence.address.slice(0,12)+"-"+Date.now()+".json";
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  function renderFlowGraph(report) {
    const root=$("trace-output");root.replaceChildren();root.hidden=false;
    const top=element("div","trace-summary");
    top.appendChild(element("div","tiny-label","EVIDENCE GRAPH · "+report.network.toUpperCase()+" · "+report.mode.direction.toUpperCase()));
    top.appendChild(element("h4","",report.stats.transfers+" observed transfers · "+report.stats.nodes+" connected addresses"));
    traceText(top,"Depth reached: "+report.mode.depth_achieved+" of "+report.mode.depth_requested+" hops · Publicly labelled nodes: "+report.stats.entities_with_public_labels);
    root.appendChild(top);
    if(report.coverage?.partial)root.appendChild(element("p","trace-warning","Partial evidence: at least one provider failed or returned an incomplete response. Do not interpret missing transfers as zero."));
    const nodes=new Map((report.graph.nodes||[]).map(n=>[n.address.toLowerCase(),n]));
    const visual=renderInteractiveNetwork(report,nodes);
    if(visual)root.appendChild(visual);
    const graph=element("div","flow-rows");
    for(const hop of [1,2]){
      const group=(report.graph.edges||[]).filter(e=>e.hop===hop);
      if(!group.length)continue;
      const section=element("div","flow-section");
      section.appendChild(element("h4","","Hop "+hop+" · "+group.length+" indexed transfers"));
      for(const edge of group.slice(0,35)){
        const row=element("div","flow-edge");
        const title=element("div","flow-path");
        const from=nodes.get(edge.from.toLowerCase()),to=nodes.get(edge.to.toLowerCase());
        const name=(n,id)=>n?.labels?.[0]?.name||id.slice(0,8)+"…"+id.slice(-6);
        title.appendChild(element("span","",name(from,edge.from)));
        title.appendChild(element("span","flow-arrow","→"));
        title.appendChild(element("span","",name(to,edge.to)));
        row.appendChild(title);
        const details=element("div","flow-meta");
        details.appendChild(element("span","",edge.amount+" "+edge.asset+(edge.kind==="token"?" (token)":"")));
        details.appendChild(element("span","",edge.timestamp?new Date(edge.timestamp).toLocaleString():"time unknown"));
        if(edge.source_url?.startsWith("https://"))details.appendChild(link(edge.source_url,"Transaction evidence ↗"));
        row.appendChild(details);
        section.appendChild(row);
      }
      graph.appendChild(section);
    }
    if(!report.graph.edges?.length)traceText(graph,"No qualifying transfers were found in the returned sample. Check the address, choose another direction, or inspect the explorer.", "trace-empty");
    root.appendChild(graph);
    const tags=report.osint?.public_labels||[];
    const tagsBox=element("div","trace-osint");
    tagsBox.appendChild(element("h4","","Open-source attribution leads"));
    if(!tags.length)traceText(tagsBox,"No public labels found for the enriched nodes. Owner identity remains unknown.");
    for(const item of tags.slice(0,12)){
      const line=element("div","source-entry");
      line.appendChild(element("span","",item.address.slice(0,12)+"…"));
      const labels=element("div","");
      for(const t of item.labels.slice(0,5)){
        labels.appendChild(element("strong","",t.name+" · "+t.category));
        if(t.source_url?.startsWith("https://"))labels.appendChild(link(t.source_url,"Source: "+t.source+" ↗"));
      }
      line.appendChild(labels);tagsBox.appendChild(line);
    }
    root.appendChild(tagsBox);
    const limits=element("div","trace-limitations");
    limits.appendChild(element("h4","","Investigation limits and source coverage"));
    traceText(limits,report.coverage.sample);
    for(const note of report.limitations.slice(0,4))traceText(limits,"• "+note);
    for(const error of report.coverage.problems.slice(0,5))traceText(limits,"Provider note: "+error);
    root.appendChild(limits);
    const exports=element("div","trace-export");
    const exportBtn=element("button","button secondary","Export investigation dossier (JSON) ↗");
    exportBtn.type="button";exportBtn.addEventListener("click",()=>downloadInvestigation());
    exports.appendChild(exportBtn);root.appendChild(exports);
  }
  function downloadInvestigation(){
    if(!flowEvidence){$("trace-state").textContent="Run an investigation first.";return;}
    const content=JSON.stringify({report_type:"NODIVRA investigation dossier",generated_at:new Date().toISOString(),
      ...flowEvidence,disclaimer:"Public on-chain evidence and openly documented labels only. Transfer links do not identify people or establish guilt."},null,2);
    const blob=new Blob([content],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download="nodivra-investigation-"+flowEvidence.network.toLowerCase()+"-"+flowEvidence.address.slice(0,12)+".json";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  async function runInvestigation(){
    const address=activeAddress;
    const state=$("trace-state"),button=$("trace-button"),output=$("trace-output");
    if(!ADDRESS_RE.test(address)){
      state.textContent="Enter an Ethereum-format (0x...) wallet address first. Bitcoin and Solana tracing need different flow models.";return;
    }
    const sequence=++investigationSequence;
    flowEvidence=null;output.hidden=true;output.replaceChildren();
    $("trace-leads").hidden=true;$("trace-details").hidden=true;$("case-workspace").hidden=true;
    button.disabled=true;button.textContent="Tracing…";
    state.textContent="Querying public transfers, tracing counterparties and checking available public labels…";
    const network=$("trace-network").value,direction=$("trace-direction").value,depth=$("trace-depth").value;
    try {
      const query=new URLSearchParams({address,network,direction,depth});
      const report=await fetchJson(API+"/investigate?"+query.toString(),null,40000);
      if(address!==activeAddress||sequence!==investigationSequence){return;}
      flowEvidence=report;renderInvestigationLeads(report);renderFlowGraph(report);
      $("trace-details").hidden=false;
      $("case-workspace").hidden=false;
      $("trace-details").open=false;
      $("case-workspace").open=false;
      state.textContent="Investigation completed. Review the leads and verify the linked transactions.";
    }catch(e){if(sequence===investigationSequence)state.textContent="Investigation unavailable: "+e.message+". This is not evidence of an empty wallet.";}
    finally{if(sequence===investigationSequence){button.disabled=false;button.textContent="Trace ↗";}}
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
  const SOLANA_ADDRESS_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  function isSolana(value){return SOLANA_ADDRESS_RE.test(String(value||"").trim())&&!isBitcoin(value);}
  function chainResult(data) {
    const root=$("chain-results");root.replaceChildren();root.hidden=false;
    if(!data||!Array.isArray(data.networks)){
      root.appendChild(element("p","minor","Cross-chain evidence unavailable."));return;
    }
    const networks=data.networks;
    const observed=networks.filter(n=>n.status==="activity_observed");
    const rpcOnly=networks.filter(n=>n.status==="rpc_partial");
    const unavailable=networks.filter(n=>n.status==="unavailable");
    const summary=element("div","network-overview");
    const headline=element("div","network-headline");
    headline.appendChild(element("strong","",data.format==="bitcoin"?"Bitcoin address":data.format==="solana"?"Solana address":"Cross-chain overview"));
    headline.appendChild(element("span","network-count",observed.length+" indexed · "+rpcOnly.length+" RPC-only · "+unavailable.length+" unavailable"));
    summary.appendChild(headline);
    const chipRow=element("div","network-chips");
    for(const network of networks) {
      const chip=element("span","network-chip "+(network.status==="activity_observed"?"is-active":network.status==="rpc_partial"?"is-partial":network.status==="unavailable"?"is-unavailable":"is-empty"));
      chip.appendChild(element("strong","",network.name));
      chip.appendChild(element("span","",network.status==="activity_observed"?"Activity":network.status==="rpc_partial"?"Balance only":network.status==="unavailable"?"Unavailable":network.status==="not_indexed"?"Not indexed":"No index activity"));
      chipRow.appendChild(chip);
    }
    summary.appendChild(chipRow);
    root.appendChild(summary);
    const details=element("details","network-details");
    const title=element("summary","","Network balances & source details");
    details.appendChild(title);
    const list=element("div","network-lines");
    for(const network of networks) {
      const row=element("div","network-line");
      const heading=element("div","network-line-heading");
      heading.appendChild(element("strong","",network.name));
      const text=network.status==="unavailable"?"Provider unavailable":network.native_balance===null||network.native_balance===undefined?"Balance unknown":network.native_balance+" "+network.symbol;
      heading.appendChild(element("span","",text));
      row.appendChild(heading);
      const tokens=Array.isArray(network.assets)?network.assets:[];
      if(tokens.length) {
        const tokenRow=element("div","network-tokenline",tokens.slice(0,8).map(t=>t.amount+" "+t.symbol).join(" · "));
        row.appendChild(tokenRow);
      }
      if(network.warnings?.length)row.appendChild(element("p","minor",network.warnings[0]));
      if(network.explorer_url?.startsWith("https://"))row.appendChild(link(network.explorer_url,"Verify ↗"));
      list.appendChild(row);
    }
    details.appendChild(list);
    root.appendChild(details);
    root.appendChild(element("p","network-disclaimer","Unavailable ≠ zero. Public labels and balances are not identity evidence."));
  }

  async function scanAllNetworks(address,controller){
    const root=$("chain-results");
    root.hidden=false;root.replaceChildren();
    root.appendChild(element("p","minor","Checking supported networks and indexed crypto assets…"));
    try{
      const data=await fetchJson(API+"/multichain?address="+encodeURIComponent(address),controller.signal,30000);
      if(activeRequest!==controller)return;
      chainResult(data);
      if(data.format==="bitcoin"||data.format==="solana"){
        results.hidden=true;
        setStatus(data.format==="bitcoin"?"Bitcoin address investigation: "+(data.networks?.[0]?.transaction_count??"unavailable")+" confirmed transactions in the indexed address history.":"Solana address investigation: current balances and indexed recent signatures. Use the linked explorer for full details.");
      }
    }catch(e){
      if(activeRequest!==controller)return;
      root.replaceChildren();root.appendChild(element("p","minor","Cross-chain lookup unavailable: "+e.message+". No portfolio or identity claim can be made from this response."));
    }
  }


  async function investigateTransaction(raw,network="ethereum"){
    const hash=String(raw||"").trim();
    if(!/^0x[a-fA-F0-9]{64}$/.test(hash))return false;
    if(activeRequest)activeRequest.abort();
    const controller=new AbortController();activeRequest=controller;
    activeAddress="";evidenceSnapshot=null;flowEvidence=null;
    const box=$("transaction-result"),networkBox=$("chain-results");
    results.hidden=true;networkBox.hidden=true;box.hidden=false;box.replaceChildren();
    input.value=hash;button.disabled=true;button.textContent="Searching…";
    setStatus("Looking up transaction evidence on "+network+"…");
    const header=element("div","tx-head");
    header.appendChild(element("strong","","Transaction evidence"));
    const select=element("select","tx-network-select");
    select.setAttribute("aria-label","Blockchain network for transaction hash");
    const chains=[["ethereum","Ethereum"],["base","Base"],["arbitrum","Arbitrum"],["optimism","Optimism"],["polygon","Polygon"]];
    for(const [id,name] of chains){
      const option=element("option","",name);option.value=id;option.selected=id===network;select.appendChild(option);
    }
    select.addEventListener("change",()=>investigateTransaction(hash,select.value));
    header.appendChild(select);box.appendChild(header);
    try {
      const data=await fetchJson(API+"/transaction?"+new URLSearchParams({hash,network}).toString(),controller.signal,15000);
      if(activeRequest!==controller)return true;
      const verified=element("div","tx-evidence");
      verified.appendChild(element("div","tiny-label","PUBLIC BLOCKCHAIN RECORD · "+data.network.toUpperCase()));
      verified.appendChild(element("p","tx-hash",data.hash));
      const meta=element("div","tx-facts");
      for(const [label,value] of [["Native transfer",data.native_value===null?"Unknown":data.native_value+" "+data.native_symbol],["Execution",data.execution],["Timestamp",data.timestamp||"Unavailable"],["Block",data.block??"Unavailable"]]){
        const row=element("div","");
        row.appendChild(element("span","",label));row.appendChild(element("strong","",value));meta.appendChild(row);
      }
      verified.appendChild(meta);
      for(const [kind,party] of [["Sender",data.from],["Recipient",data.to]]){
        if(!party)continue;
        const line=element("div","tx-counterparty");
        const info=element("div","");
        info.appendChild(element("span","",kind));
        info.appendChild(element("strong","",party.public_tag||trimHash(party.address)));
        if(party.public_tag)info.appendChild(element("span","",party.address+" · public tag, not verified owner"));
        line.appendChild(info);
        const act=element("button","trace-button","Investigate →");
        act.type="button";act.addEventListener("click",()=>lookup(party.address));
        line.appendChild(act);verified.appendChild(line);
      }
      const citation=link(data.source_url,"Check source transaction ↗");
      verified.appendChild(citation);
      verified.appendChild(element("p","minor","A transaction proves an observed on-chain event, not the legal identity of a sender or recipient."));
      box.appendChild(verified);
      setStatus("Transaction record found. Follow the sender or recipient to investigate related public transfers.");
    }catch(err){
      if(activeRequest!==controller)return true;
      box.appendChild(element("p","case-attention","No verified result on "+network+": "+err.message+". Choose another network or verify the hash with its original explorer."));
      setStatus("This transaction could not be verified on the selected network.",true);
    }finally{if(activeRequest===controller){button.disabled=false;button.textContent="Search →";}}
    return true;
  }

  async function lookup(address) {
    if(/^0x[a-fA-F0-9]{64}$/.test(String(address||"").trim())){await investigateTransaction(address);return;}
    $("transaction-result").hidden=true;
    if(isBitcoin(address)||isSolana(address)){
      if(activeRequest)activeRequest.abort();
      const bitcoinController=new AbortController();
      activeRequest=bitcoinController;activeAddress=String(address).trim();
      input.value=activeAddress;results.hidden=true;
      ++investigationSequence;flowEvidence=null;evidenceSnapshot=null;
      $("trace-output").hidden=true;
      $("trace-leads").hidden=true;$("trace-details").hidden=true;$("case-workspace").hidden=true;
      button.disabled=true;button.textContent="Searching…";
      setStatus("Searching public activity on "+(isBitcoin(address)?"Bitcoin":"Solana")+"…");
      try {await scanAllNetworks(activeAddress,bitcoinController);}
      finally {if(activeRequest===bitcoinController){button.disabled=false;button.textContent="Search →";}}
      return;
    }
    const parsed=parseWalletInput(address);
    if(parsed.error) {
      ++investigationSequence;flowEvidence=null;evidenceSnapshot=null;
      $("chain-results").hidden=true;
      results.hidden=true;
      setStatus(parsed.error,true);
      return;
    }
    if(activeRequest)activeRequest.abort();
    const controller=new AbortController();activeRequest=controller;
    button.disabled=true;button.textContent="Searching…";
    results.hidden=true;$("origin-result").hidden=true;
    evidenceSnapshot=null;
    ++investigationSequence;
    flowEvidence=null;
    $("trace-leads").hidden=true;$("trace-details").hidden=true;$("case-workspace").hidden=true;
    $("trace-output").hidden=true;
    $("trace-state").textContent="Run an investigation to build an evidence-backed flow graph.";
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
      setStatus("Checking public data for "+trimHash(normalized)+"…");
      const {data,provider}=await lookupData(normalized,controller.signal);
      if(activeRequest!==controller)return;
      const account=data.account||{};
      $("balance").textContent=showWei(account.coin_balance);
      $("shown").textContent=Array.isArray(data.transactions)?String(data.transactions.length):"Unavailable";
      $("account-type").textContent=account.is_contract===true?"Contract":account.is_contract===false?"EOA (technical type)":"Unverified";
      $("coverage").textContent=provider+" · recent activity";
      evidenceSnapshot=data;
      intelligenceBrief(data,normalized);
      const summary=$("brief-summary");
      const labels=Array.isArray(data.public_attributions)?data.public_attributions:[];
      const edges=Array.isArray(data.transactions)?data.transactions.length:null;
      const description=data.intelligence?.summary;
      summary.textContent=description ||
        (labels.length?"Public labels found · verify sources in More evidence":
          edges===null?"Activity index unavailable · no ownership can be inferred":
          edges>0?edges+" recent transfers observed · owner not identified":
          "No activity observed in this index sample · owner unknown");
      $("advanced-evidence").open=false;
      renderAttribution(data);
      renderConnections(data,normalized);
      renderTokens(data);
      renderTransactions(data,normalized);
      results.hidden=false;
      setUrl(normalized);
      const internalCount=data.internal_transactions?.length||0, tokenCount=data.token_transfers?.length||0;
      const hasIndexedTx=Array.isArray(data.transactions);
      if(!hasIndexedTx) setStatus("Partial data only: transaction index unavailable. A missing history is not proof of zero transactions.",true);
      else if(!data.transactions.length && !tokenCount && !internalCount) setStatus("No activity in the indexed sample for this exact address. Check all characters.");
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
      if(activeRequest===controller){button.disabled=false;button.textContent="Search →";}
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
  $("trace-button").addEventListener("click",runInvestigation);
  $("case-report").addEventListener("click",exportCaseDossier);
  $("export-evidence").addEventListener("click",exportEvidence);
  const initial=new URLSearchParams(location.search).get("address");
  if(initial&&(normalize(initial)||isBitcoin(initial)||isSolana(initial)||/^0x[a-fA-F0-9]{64}$/.test(initial)))lookup(initial);
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

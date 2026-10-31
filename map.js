/* NODIVRA · source-backed, graph-first wallet investigation. No third-party graph SDK. */
"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const VALID=/^0x[a-fA-F0-9]{40}$/;
  const API="https://nodivra-api.gcasaldi.workers.dev";
  const COLORS={subject:"#83f7c7",tagged:"#d9b77d",normal:"#82b8d1"};
  const graph={nodes:new Map(),edges:new Map()};
  let root="",focus="",network="ethereum",depth=1,history=[],controller=null,serial=0;
  let busy=false,zoom=1,onReport=()=>{},onClear=()=>{},lastError="";
  const short=s=>!s?"Unknown":s.slice(0,7)+"…"+s.slice(-5);
  const safeUrl=u=>typeof u==="string"&&/^https:\/\//.test(u)?u:null;
  const el=(name,className,text)=>{
    const e=document.createElement(name);if(className)e.className=className;
    if(text!==undefined)e.textContent=String(text);return e;
  };
  const link=(url,title)=>{
    const a=el("a","",title);a.href=url;a.target="_blank";a.rel="noopener noreferrer";return a;
  };
  function state(text,isError=false){
    const e=$("map-status");if(!e)return;
    e.textContent=text;e.classList.toggle("error",isError);
  }
  function clear(){
    if(controller)controller.abort();
    onClear();
    controller=null;++serial;
    graph.nodes.clear();graph.edges.clear();
    root="";focus="";history=[];busy=false;zoom=1;lastError="";
    $("wallet-map").hidden=true;
    $("map-svg-host").replaceChildren();
    $("map-inspector").replaceChildren();
    $("map-related").replaceChildren();
    $("map-history").replaceChildren();
    $("map-back").disabled=true;
    $("map-expand").disabled=false;
    $("map-expand").textContent="Expand 2 hops";
    state("Enter an EVM address to load an evidence map.");
  }
  function edgeKey(edge){
    return [edge.tx_hash?.toLowerCase(),edge.from?.toLowerCase(),edge.to?.toLowerCase(),
      edge.kind,edge.asset_contract?.toLowerCase()||"native",edge.event_index??"none"].join("|");
  }
  function merge(report){
    for(const node of report.graph?.nodes||[]){
      if(!VALID.test(node.address||""))continue;
      const key=node.address.toLowerCase(),before=graph.nodes.get(key);
      graph.nodes.set(key,{...before,...node,
        labels:(node.labels?.length?node.labels:before?.labels)||[]});
    }
    for(const edge of report.graph?.edges||[]){
      if(!VALID.test(edge.from||"")||!VALID.test(edge.to||"")||
          !/^0x[a-fA-F0-9]{64}$/.test(edge.tx_hash||"")||!safeUrl(edge.source_url))continue;
      graph.edges.set(edgeKey(edge),edge);
    }
    if(!graph.nodes.has(focus.toLowerCase()))graph.nodes.set(focus.toLowerCase(),{address:focus,labels:[]});
    // Bound the browser graph; keep transaction provenance, never infer new transfers.
    if(graph.edges.size>180){
      for(const key of [...graph.edges.keys()].slice(0,graph.edges.size-180))graph.edges.delete(key);
    }
    if(graph.nodes.size>100){
      const attached=new Set([...graph.edges.values()].flatMap(e=>[e.from.toLowerCase(),e.to.toLowerCase()]));
      for(const key of [...graph.nodes.keys()])
        if(graph.nodes.size>100&&!attached.has(key)&&key!==root.toLowerCase()&&key!==focus.toLowerCase())graph.nodes.delete(key);
    }
  }
  function positions(){
    const subject=focus.toLowerCase(),incoming=[],outgoing=[],rootNode=graph.nodes.get(subject);
    const edges=[...graph.edges.values()];
    const peers=new Map();
    for(const e of edges){
      const f=e.from.toLowerCase(),t=e.to.toLowerCase();
      if(f!==subject&&t!==subject)continue;
      const p=f===subject?t:f;
      if(!graph.nodes.has(p))continue;
      const item=peers.get(p)||{address:p,side:f===subject?"out":"in",count:0};
      item.count++;if(f===subject)item.side="out";
      peers.set(p,item);
    }
    const relevant=[...peers.values()].sort((a,b)=>b.count-a.count||a.address.localeCompare(b.address)).slice(0,30);
    for(const p of relevant)(p.side==="out"?outgoing:incoming).push(p);
    const maximum=Math.max(incoming.length,outgoing.length,1);
    const height=Math.max(520,maximum*84+115),width=1070;
    const xy=new Map([[subject,{x:535,y:height/2,focus:true}]]);
    for(const [list,x] of [[incoming,172],[outgoing,898]]){
      list.forEach((item,i)=>xy.set(item.address,{x,y:height*(i+1)/(list.length+1)}));
    }
    return {xy,rootNode,height,width,visible:[...xy.keys()],totalPeers:peers.size};
  }
  const SVG="http://www.w3.org/2000/svg";
  function svgEl(type,attrs={}){
    const node=document.createElementNS(SVG,type);
    for(const [name,val] of Object.entries(attrs))node.setAttribute(name,String(val));
    return node;
  }
  function makeSvg(layout){
    const svg=svgEl("svg",{viewBox:"0 0 "+layout.width+" "+layout.height,role:"group",
      "aria-label":"Observed wallet transfer graph, with selectable addresses and transaction evidence"});
    svg.classList.add("wallet-graph-svg");
    svg.style.width=Math.round(100*zoom)+"%";
    svg.style.minWidth=Math.round(710*zoom)+"px";
    const defs=svgEl("defs");
    const marker=svgEl("marker",{id:"wallet-map-arrow",viewBox:"0 0 10 10",refX:"9",refY:"5",
      markerWidth:"6",markerHeight:"6",orient:"auto"});
    marker.appendChild(svgEl("path",{d:"M0 0L10 5L0 10Z",fill:"#69beaf"}));
    defs.appendChild(marker);svg.appendChild(defs);
    const observedEdges=[...graph.edges.values()].filter(e=>layout.xy.has(e.from.toLowerCase())&&layout.xy.has(e.to.toLowerCase()));
    const pairs=new Set();
    for(const edge of observedEdges){
      const key=edge.from.toLowerCase()+"-"+edge.to.toLowerCase();
      if(pairs.has(key))continue;pairs.add(key);
      const from=layout.xy.get(edge.from.toLowerCase()),to=layout.xy.get(edge.to.toLowerCase());
      const midX=(from.x+to.x)/2,midY=(from.y+to.y)/2;
      const bend=from.x===to.x?60:0;
      const path=svgEl("path",{d:"M"+from.x+" "+from.y+" Q"+(midX+bend)+" "+(midY-18)+" "+to.x+" "+to.y,
        fill:"none",stroke:"#69beaf","stroke-width":"2","stroke-opacity":".73",
        "marker-end":"url(#wallet-map-arrow)"});
      const tip=svgEl("title");tip.textContent="Observed "+edge.asset+" transaction "+edge.tx_hash;
      path.appendChild(tip);svg.appendChild(path);
    }
    for(const [address,p] of layout.xy){
      const n=graph.nodes.get(address)||{address,labels:[]},tagged=!!n.labels?.length,selected=address===focus.toLowerCase();
      const g=svgEl("g",{transform:"translate("+p.x+" "+p.y+")",tabindex:"0",role:"button",
        "aria-label":"Inspect "+n.address+(tagged?" — public label, verify independently":"")});
      g.classList.add("wallet-map-node");
      const rectangle=svgEl("rect",{x:"-116",y:"-31",width:"232",height:"62",rx:"11",
        fill:selected?"#125142":tagged?"#403326":"#122c36",
        stroke:selected?COLORS.subject:tagged?COLORS.tagged:COLORS.normal,
        "stroke-width":selected?3:1.5});
      g.appendChild(rectangle);
      const label=el("span");
      const publicName=n.labels?.[0]?.name;
      const title=svgEl("text",{x:"0",y:"-6","text-anchor":"middle",
        fill:"#f0fff8","font-size":"13","font-weight":"700"});
      title.textContent=typeof publicName==="string"&&publicName.length?publicName.slice(0,27):short(n.address);
      g.appendChild(title);
      const description=svgEl("text",{x:"0",y:"14","text-anchor":"middle",
        fill:selected?"#90f3c4":"#9cbbb3","font-size":"10"});
      description.textContent=selected?"SELECTED · DRILL DOWN":tagged?"PUBLIC TAG · UNVERIFIED":"ADDRESS · OWNER UNKNOWN";
      g.appendChild(description);
      const tip=svgEl("title");tip.textContent=n.address;g.appendChild(tip);
      const act=()=>select(n.address);
      g.addEventListener("click",act);
      g.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();act();}});
      svg.appendChild(g);
    }
    return svg;
  }
  function incidentDetails(address){
    const pane=$("map-inspector");pane.replaceChildren();
    const node=graph.nodes.get(address.toLowerCase())||{address,labels:[]};
    pane.appendChild(el("div","tiny-label","SELECTED WALLET"));
    pane.appendChild(el("h4","map-inspector-title",node.labels?.[0]?.name||"Unknown owner"));
    const code=el("code","map-address",address);
    pane.appendChild(code);
    const actions=el("div","map-details-actions");
    const copy=el("button","map-small-button","Copy address");
    copy.type="button";
    copy.addEventListener("click",async()=>{try{
      if(!navigator.clipboard?.writeText)throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(address);copy.textContent="Copied ✓";
    }catch(e){copy.textContent="Select the address above to copy";}});
    actions.appendChild(copy);
    actions.appendChild(link("https://"+(network==="ethereum"?"eth":network)+".blockscout.com/address/"+encodeURIComponent(address),"Open explorer ↗"));
    pane.appendChild(actions);
    const connected=[...graph.edges.values()].filter(e=>e.from.toLowerCase()===address.toLowerCase()||e.to.toLowerCase()===address.toLowerCase());
    pane.appendChild(el("p","map-facts",connected.length+
      " indexed transfer(s) involving this address in the displayed investigation."));
    if(node.labels?.length){
      pane.appendChild(el("p","map-uncertainty","Public labels are unverified tags, not proof of legal identity."));
      for(const label of node.labels.slice(0,3)){
        if(safeUrl(label.source_url))pane.appendChild(link(label.source_url,"Check label: "+label.name+" ↗"));
      }
    }
    if(lastError)pane.appendChild(el("p","map-uncertainty",lastError));
    const actions2=el("div","map-details-actions");
    const drill=el("button","map-explore-button","Expand this wallet →");
    drill.disabled=busy||!VALID.test(address);
    drill.type="button";drill.addEventListener("click",()=>drillInto(address));
    actions2.appendChild(drill);pane.appendChild(actions2);
    const related=$("map-related");related.replaceChildren();
    const headline=el("h4","map-related-title","Observed transfer evidence");
    related.appendChild(headline);
    if(!connected.length){
      related.appendChild(el("p","map-uncertainty",busy?"Loading public transfers…":
        "No verified transfer in the retrieved sample. This may reflect partial indexing, not inactivity."));
    }
    for(const edge of connected.slice(0,20)){
      const row=el("div","map-evidence-row");
      row.appendChild(el("strong","",short(edge.from)+" → "+short(edge.to)));
      row.appendChild(el("span","",edge.amount+" "+edge.asset+
        (edge.timestamp?" · "+String(edge.timestamp).slice(0,10):"")));
      if(safeUrl(edge.source_url))row.appendChild(link(edge.source_url,"Verify tx ↗"));
      related.appendChild(row);
    }
  }
  function paint(){
    if(!focus)return;
    const layout=positions();
    const rootPane=$("map-svg-host");rootPane.replaceChildren();
    rootPane.appendChild(makeSvg(layout));
    const total=graph.nodes.size;
    $("map-counter").textContent=layout.visible.length+" visible · "+total+" indexed addresses · "+graph.edges.size+" transfer events";
    $("map-expand").disabled=busy||depth===2;
    $("map-expand").textContent=depth===2?"2-hop mode":"Expand 2 hops";
    $("map-back").disabled=!history.length||busy;
    const crumbs=$("map-history");crumbs.replaceChildren();
    crumbs.appendChild(el("span","tiny-label","PATH"));
    const addresses=[root,...history.filter((x,i)=>i===0||history[i-1]!==x),focus].filter(Boolean);
    const compact=addresses.filter((a,i)=>i===0||a.toLowerCase()!==addresses[i-1].toLowerCase()).slice(-7);
    for(const [i,address] of compact.entries()){
      const part=el("button","map-crumb",i===0?"START":short(address));
      part.type="button";part.addEventListener("click",()=>select(address,{breadcrumb:true}));
      crumbs.appendChild(part);
    }
    incidentDetails(focus);
  }
  function setLoading(v){
    busy=v;
    $("map-network").disabled=v;
    $("map-expand").disabled=v;
    $("map-back").disabled=v||!history.length;
  }
  async function fetchTrace(address){
    if(!VALID.test(address))return;
    if(controller)controller.abort();
    controller=new AbortController();const ticket=++serial;
    setLoading(true);
    lastError="";state("Reading public transaction evidence for "+short(address)+"…");
    paint();
    try{
      const query=new URLSearchParams({address,network,direction:"both",depth:String(depth)});
      const response=await fetch(API+"/investigate?"+query.toString(),{signal:controller.signal,headers:{Accept:"application/json"}});
      if(!response.ok)throw Error("Provider HTTP "+response.status);
      const report=await response.json();
      if(ticket!==serial)return;
      if(!report?.graph||!Array.isArray(report.graph.edges)||report.address?.toLowerCase()!==address.toLowerCase())throw Error("Unexpected or incomplete evidence response");
      merge(report);
      onReport(report);
      const observed=report.stats?.transfers??report.graph.edges.length;
      const partial=report.coverage?.partial;
      state(observed+" indexed transfer event(s) · "+(partial?"some data sources incomplete":"sample loaded")+
        " · tap a wallet to inspect its evidence.");
      if(partial)lastError="Some sources were partial. Absence of activity in this sample proves nothing.";
    }catch(err){
      if(ticket!==serial||err?.name==="AbortError")return;
      window.NodivraModules.complete("graph_failed");
      lastError="Could not verify transfers for this wallet: "+(err?.message||"provider unavailable")+
        ". The displayed map contains only evidence loaded earlier; no new links were inferred.";
      state(lastError,true);
    }finally{
      if(ticket===serial){setLoading(false);paint();}
    }
  }
  function select(address,{breadcrumb=false}={}){
    if(!VALID.test(address)||busy)return;
    if(address.toLowerCase()===focus.toLowerCase()){incidentDetails(address);return;}
    if(breadcrumb){
      const match=history.findIndex(v=>v.toLowerCase()===address.toLowerCase());
      if(address.toLowerCase()===root.toLowerCase())history=[];
      else if(match>=0)history=history.slice(0,match);
    }else history.push(focus);
    focus=address;
    paint();
    fetchTrace(address);
  }
  function drillInto(address){
    if(!VALID.test(address)||busy)return;
    if(address.toLowerCase()!==focus.toLowerCase()){select(address);return;}
    fetchTrace(address);
  }
  function start(address,opts={}){
    if(!VALID.test(address))return false;
    clear();
    root=address;focus=address;network=opts.network||"ethereum";depth=1;
    $("map-network").value=network;
    graph.nodes.set(address.toLowerCase(),{address,labels:[]});
    $("wallet-map").hidden=false;
    $("module-empty-connect").hidden=true;
    window.NodivraModules.complete("graph_loading");
    window.NodivraModules.open("connect");
    state("Building your map from public transaction evidence…");
    paint();
    fetchTrace(address);
    return true;
  }
  function focusBack(){
    if(!history.length||busy)return;
    focus=history.pop();
    paint(); // previously observed evidence is retained; no fabricated fresh lookup.
    state("Returned to a previously examined wallet. Existing links are from indexed public transactions.");
  }
  function resetView(){
    if(!root)return;
    history=[];focus=root;zoom=1;paint();
    state("Back at the starting wallet. Tap another observed wallet to drill down.");
  }
  $("map-back").addEventListener("click",focusBack);
  $("map-home").addEventListener("click",resetView);
  $("map-expand").addEventListener("click",()=>{if(!focus||busy)return;depth=2;fetchTrace(focus);});
  $("map-network").addEventListener("change",()=>{if(root&&!busy)start(root,{network:$("map-network").value});});
  $("map-zoom-in").addEventListener("click",()=>{zoom=Math.min(2,Math.round((zoom+.25)*100)/100);paint();});
  $("map-zoom-out").addEventListener("click",()=>{zoom=Math.max(.75,Math.round((zoom-.25)*100)/100);paint();});
  $("map-fit").addEventListener("click",()=>{zoom=1;paint();});
  window.NodivraMap=Object.freeze({
    start,reset:clear,select,back:focusBack,expand:()=>{if(focus&&!busy){depth=2;return fetchTrace(focus);}},
    onReport(fn){if(typeof fn==="function")onReport=fn;},
    onClear(fn){if(typeof fn==="function")onClear=fn;},
    snapshot:()=>({root,focus,network,depth,history:[...history],nodes:graph.nodes.size,edges:graph.edges.size,busy})
  });
})();

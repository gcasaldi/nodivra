/* NODIVRA investigator workspace · five focused modules.
   Navigation is presentation-only: never invents evidence or a completed investigation. */
"use strict";
(() => {
  const STEPS=["investigate","correlate","connect","recommend","report"];
  const $=id=>document.getElementById(id);
  const state=Object.fromEntries(STEPS.map(step=>[step,"Not started"]));
  let current="investigate",scenario="none";
  const panes=Object.fromEntries(STEPS.map(step=>[step,$("module-"+step)]));
  const buttons=Object.fromEntries(STEPS.map(step=>[step,$("tab-"+step)]));
  function move(id,where){
    const el=$(id),destination=$(where);
    if(!el||!destination)throw new Error("Missing modular workspace target: "+id+" / "+where);
    destination.appendChild(el);
  }
  // Keep every existing render target and event handler. Move actual DOM nodes, not copies.
  move("name-results","module-investigate-body");
  move("transaction-result","module-investigate-body");
  move("results","module-investigate-body");
  move("research-results","module-correlate-body");
  move("chain-results","module-correlate-body");
  move("advanced-evidence","module-correlate-body");
  const trace=document.querySelector(".investigation-panel");
  if(!trace)throw new Error("The existing trace module is missing");
  $("module-connect-body").appendChild(trace);
  move("trace-leads","module-recommend-body");
  move("case-workspace","module-report-body");
  $("advanced-evidence").hidden=true;
  function update(){
    for(const step of STEPS){
      const active=step===current,button=buttons[step],pane=panes[step];
      button.setAttribute("aria-selected",String(active));
      button.tabIndex=active?0:-1;
      pane.hidden=!active;
      $("module-badge-"+step).textContent=state[step];
    }
  }
  function open(step,focus=false){
    if(!STEPS.includes(step))return;
    current=step;update();
    if(focus)buttons[step].focus({preventScroll:true});
  }
  for(let i=0;i<STEPS.length;i++){
    const step=STEPS[i],btn=buttons[step];
    btn.addEventListener("click",()=>open(step));
    btn.addEventListener("keydown",event=>{
      const n=event.key==="ArrowRight"?1:event.key==="ArrowLeft"?-1:event.key==="Home"?"home":
        event.key==="End"?"end":0;
      if(!n)return;
      event.preventDefault();
      const target=n==="home"?0:n==="end"?STEPS.length-1:(i+n+STEPS.length)%STEPS.length;
      open(STEPS[target],true);
    });
  }
  document.querySelectorAll("[data-next-module]").forEach(btn=>{
    btn.addEventListener("click",()=>{open(btn.dataset.nextModule,true);$("module-"+btn.dataset.nextModule).scrollIntoView({behavior:"smooth",block:"start"});});
  });
  function clearIncident(){
    for(const id of ["incident-connect-content","incident-correlate-content",
      "incident-recommend-content","incident-report-content"]){
      const target=$(id);
      if(target){target.replaceChildren();target.hidden=true;}
    }
  }
  function setEmpty(step,empty){
    const target=$("module-empty-"+step);
    if(target)target.hidden=!empty;
  }
  function reset(kind="wallet"){
    scenario=kind;
    for(const step of STEPS){state[step]="Not started";setEmpty(step,true);}
    state.investigate="Ready";
    // A new case must never inherit visible findings from the previous one.
    for(const id of ["results","name-results","transaction-result","research-results","chain-results",
       "trace-leads","trace-details","case-workspace"]){
      const el=$(id);if(el)el.hidden=true;
    }
    const traceStatus=$("trace-state");
    if(traceStatus)traceStatus.textContent="Enter an EVM wallet and run Trace to inspect verified transfer links.";
    $("advanced-evidence").hidden=true;
    clearIncident();open("investigate");
    update();
  }
  function complete(type,data){
    if(type==="incident"){
      scenario="incident";
      state.investigate="Verified source";
      state.correlate="Source review";
      state.connect=data.initial_events?.length?"Evidence available":"Limited";
      state.recommend="Next check ready";
      state.report="Export ready";
      setEmpty("investigate",false);
      for(const step of ["correlate","connect","recommend","report"])setEmpty(step,false);
    }else if(type==="wallet"){
      scenario="wallet";
      state.investigate="Wallet result";
      state.correlate="Evidence available";
      state.connect="Trace available";
      state.recommend="Run a trace";
      state.report="Run a trace";
      $("advanced-evidence").hidden=false;
      for(const step of ["investigate","correlate","connect"])setEmpty(step,false);
    }else if(type==="name"){
      scenario="name";
      state.investigate="Public name leads";
      state.correlate="ENS only";
      setEmpty("investigate",false);
    }else if(type==="scan"){
      state.correlate=data?.format==="bitcoin"||data?.format==="solana"?"Wallet snapshot":"Network scan";
      setEmpty("correlate",false);
      if(data?.format==="bitcoin"||data?.format==="solana"){
        state.investigate="Address received";
        setEmpty("investigate",false);
        open("correlate");
      }
    }else if(type==="research"){
      state.correlate=data?.status==="dataset_match"?"Research label":"Research checked";
      setEmpty("correlate",false);
    }else if(type==="trace"){
      state.connect="Graph ready";
      state.recommend="Leads ready";
      state.report="Export ready";
      for(const step of ["connect","recommend","report"])setEmpty(step,false);
    }
    update();
  }
  function incidentSlot(which){
    const e=$("incident-"+which+"-content");
    if(!e)throw Error("Missing incident slot "+which);
    e.hidden=false;
    return e;
  }
  update();
  window.NodivraModules=Object.freeze({open,reset,complete,incidentSlot});
})();

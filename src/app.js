import {icon,hydrateIcons} from './icons.js';
import {DemoSimulator} from './simulator.js';
import {LiveController, validateLiveRecipe, API_BASE} from './live-controller.js';
import {loadRecipes,saveRecipes,blankRecipe,validate,duration} from './recipes.js';
import {escapeHTML as esc,safeDownload,csvTable} from './storage.js';
import {lineChart,microSpark} from './charts.js';

const $=id=>document.getElementById(id);
const demo=new DemoSimulator(),live=new LiveController();
let recipes=loadRecipes(),selected=recipes[0]?.id||null,draft=structuredClone(recipes[0]||blankRecipe());
let route='welcome',dirty=false,busy=false,selectedMode='none',connectionInterrupted=false;
const isLive=()=>selectedMode==='live'&&live.connected&&live.paired;
const active=()=>isLive()?live:demo;
const state=()=>active().state;
const fmt=t=>Number.isFinite(Number(t))&&t!==null?`${Number(t).toFixed(1)}°C`:'—';
const durationText=x=>x>=60?`${Math.floor(x/60)}m ${Math.round(x%60)}s`:`${Math.round(x)}s`;
const dt=x=>x?new Date(x).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const timestamp=x=>x?new Date(x).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}):'—';
const b=(label,action,cls='secondary',extra='')=>`<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${label}</button>`;
const tabIcon=(name,size=18)=>icon(name,size);
const label=(word)=>`<span class="eyebrow">${word}</span>`;
const errorMessage=e=>e?.message||'Something went wrong.';
const escapeAttr=esc;

function toast(message,type='info'){
  const item=document.createElement('div');item.className=`toast ${type}`;item.textContent=message;
  $('toast-root').appendChild(item);setTimeout(()=>item.remove(),4500);
}
function setTheme(next){
  document.documentElement.dataset.theme=next;
  try{localStorage.setItem('autolab-theme',next)}catch{}
  const glyph=tabIcon(next==='dark'?'sun':'moon',19);
  for(const holder of document.querySelectorAll('#theme-toggle,[data-action="toggle-theme"]')){
    holder.innerHTML=glyph;holder.title=next==='dark'?'Use light appearance':'Use dark appearance';
  }
}
function statusText(){return live.connected?'SYSTEM LIVE':live.backendOnline?'ARDUINO OFFLINE':'DEMO READY';}
function statusSub(){return live.connected?'Arduino detected · '+(isLive()?'Live controls unlocked':'Private code required'):live.backendOnline?'Backend online · Check Arduino USB':live.everConnected?'Connection lost · Check physical outputs':'Demo is available · No hardware detected';}
function topStatus(){
  const pill=$('system-pill'),side=$('sidebar-info'),footer=$('footer-source');
  const cls=live.connected?'online':live.backendOnline?'warning':'demo';
  pill.className=`system-pill ${cls}`;pill.innerHTML=`<span class="status-lamp"></span><span>${statusText()}</span>`;
  side.className=`sidebar-info ${cls}`;side.innerHTML=`<span class="status-lamp"></span><span>${statusSub()}</span>`;
  footer.textContent=isLive()?'Live Arduino readings · Relay states are commanded':connectionInterrupted?'Simulation · Last hardware state not verified':'Demo data is simulated · No equipment controlled';
  $('breadcrumb').textContent={welcome:'Welcome',dashboard:'Overview',recipes:'Recipes',history:'Run history'}[route];
  document.querySelectorAll('[data-route]').forEach(el=>{const on=el.dataset.route===route;el.classList.toggle('selected',on);el.classList.toggle('active',on)});
}
function pageHeader(kicker,title,sub,action=''){
  return `<div class="page-header"><div>${label(kicker)}<h1>${title}</h1><p class="subheading">${sub}</p></div>${action?`<div class="header-action">${action}</div>`:''}</div>`;
}
function sourceFlag(){return isLive()?`<span class="mini-pill live">LIVE DATA</span>`:`<span class="mini-pill">SIMULATION</span>`;}
function sensorCard(title,key,alias,ico){
  const s=state(),current=s[key];return `<div class="metric card"><div class="metric-top"><span>${title}</span><span class="metric-icon">${tabIcon(ico,19)}</span></div><div class="metric-main"><div class="metric-reading"><div class="metric-number">${fmt(current)}</div><div class="metric-bottom"><span class="tiny-circle"></span>${isLive()?'Measured channel':'Simulated channel'}</div></div><div class="metric-chart"><div class="metric-spark">${microSpark(s.telemetry,key,key==='contact'?'var(--teal-strong)':'var(--ocean)')}</div><span class="metric-alias">${alias}</span></div></div></div>`;
}
function controlTile(channel,title,ico){
  const s=state(),on=!!s[channel],locked=isLive()&&!live.paired,disabled=!!s.run||!!s.fault||busy;
  return `<div class="output-tile"><div class="output-left"><span class="output-icon">${tabIcon(ico,21)}</span><div><strong>${title}</strong><small>${isLive()?'Arduino relay command':'Demo output'}</small></div></div><div class="output-right"><span class="output-state ${on?'active':''}">${on?'ON':'OFF'}</span><button type="button" class="switch ${on?'on':''}" role="switch" aria-label="${title}" aria-checked="${on}" title="${locked?'Pair this browser to use hardware controls':`Toggle ${title}`}" data-action="toggle-${channel}" ${disabled||locked?'disabled':''}></button></div></div>`;
}
function controlPanel(){
  const s=state(),locked=isLive()&&!live.paired;
  return `<section class="card control-card"><div class="panel-top"><div><h2>Device controls</h2><p>${isLive()?'Control your connected Arduino':'Try the controls safely in simulation'}</p></div>${isLive()?`<span class="mini-pill ${locked?'locked':'live'}">${locked?'LOCKED':'PAIRED'}</span>`:sourceFlag()}</div>
    ${s.fault?`<div class="pair-callout"><div><strong>Controller fault detected</strong><p>Outputs are disabled until the Arduino fault is resolved.</p></div>${isLive()&&live.paired?b('Reset fault','reset-fault','secondary'):''}</div>`:''}
    ${locked?`<div class="pair-callout"><div><strong>Ready to control your Arduino?</strong><p>Enter your private operator code to unlock hardware controls.</p></div>${b('Unlock controls','unlock','primary')}</div>`:''}
    <div class="output-list">${controlTile('motor','DC motor','zap')}${controlTile('fan','Cooling fan','fan')}</div>
    <div class="control-footer">${b(`${tabIcon('stop',17)} Stop all outputs`,'stop','stop-btn',locked?'disabled':'')}<span>${isLive()?'Physical power cutoff must remain accessible.':'Motor and fan cannot run together.'}</span></div>
    </section>`;
}
function runPanel(){
  const r=state().run;
  if(!r)return `<section class="card run-card"><div class="panel-top"><h2>Current recipe</h2><span class="mini-pill">IDLE</span></div><div class="empty-small"><span class="empty-icon">${tabIcon('layers',24)}</span><strong>Nothing running right now</strong><p>Build a recipe to automate a simple motor and fan sequence.</p>${b('Go to recipes →','go-recipes','secondary')}</div></section>`;
  const step=r.recipe.steps[r.stepIndex]||r.recipe.steps[0];const n=r.stepIndex+1,progress=step?Math.min(100,(r.stepTime||0)/step.duration*100):0;
  return `<section class="card run-card"><div class="panel-top"><h2>Current recipe</h2><span class="mini-pill live">${r.paused?'PAUSED':'RUNNING'}</span></div><div class="active-run"><div class="run-summary"><strong>${esc(r.name)}</strong><small>Cycle ${r.repeatIndex+1} of ${r.repeats}</small></div><div class="run-step-title">Step ${n} · ${esc(step?.label||'Timed output')}</div><div class="progress"><div style="width:${progress}%"></div></div><div class="progress-notes"><span>${(r.stepTime||0).toFixed(0)}s elapsed</span><span>${step?.duration||0}s</span></div><div class="run-actions">${r.paused?b('Resume','resume','secondary'):b('Pause','pause','secondary')}${b('Stop recipe','stop','quiet-danger')}</div></div></section>`;
}
function recentActivity(){const events=state().events.slice(0,4);
  return `<section class="card activity-card"><div class="panel-top"><h2>Recent activity</h2>${b('Full history →','go-history','text-btn')}</div>
    ${events.length?`<div class="activity-list">${events.map(e=>`<div class="activity-item"><span class="event-marker ${e.type==='ERROR'?'danger':''}"></span><div><strong>${esc(e.message)}</strong><small>${esc(e.detail||'')}</small></div><time>${timestamp(e.time)}</time></div>`).join('')}</div>`:`<div class="empty-activity">Events will appear here as the process runs.</div>`}</section>`;
}
function dashboard(){
  const s=state(),source=isLive()?'HARDWARE':'SIMULATED';
  return `${connectionInterrupted&&!live.connected?`<div class="connection-alert">${tabIcon('alert',18)}<span>Connection to your Arduino was lost. This is now a simulation. Verify real outputs physically before reconnecting.</span></div>`:''}
  ${pageHeader('CONTROL DESK','Your lab, in focus.',isLive()?'Live Arduino telemetry and authorized controls.':'Explore the complete process safely, with simulated signals.',b(`${tabIcon('layers',16)} Open recipe studio`,'go-recipes','secondary'))}
  <section class="overview-strip"><div class="overview-strip-copy"><span class="eyebrow">${isLive()?'CONNECTED HARDWARE':'SIMULATION SPACE'}</span><h2>${isLive()?'The system is online.':'Everything ready for a trial run.'}</h2><p>${isLive()?'Readings come from your connected Arduino. Relay states indicate commanded outputs.':'Experiment with control sequences—nothing you do here operates physical equipment.'}</p></div><div class="strip-side"><div class="strip-indicator"><span class="status-lamp"></span>${isLive()?'LIVE TELEMETRY':'SIMULATED DATA'}</div>${isLive()?b('Open recipes '+tabIcon('arrow',15),'go-recipes','light-outline'):b(`${tabIcon('play',15)} 15-sec demo run`,'sample-demo','light-outline')}</div></section>
  <div class="section-heading"><div><h2>Live readings</h2><p>${isLive()?'From your physical sensors':'From the browser simulation'}</p></div><span class="data-source">${tabIcon('database',14)} ${source}</span></div>
  <div class="sensor-grid">${sensorCard('Contact temperature','contact','DS18B20','thermometer')}${sensorCard('Infrared temperature','infrared','MLX90614','activity')}</div>
  <div class="dashboard-grid">${controlPanel()}${runPanel()}</div>
  <div class="dashboard-bottom"><section class="card chart-card"><div class="panel-top"><div><h2>Temperature trend</h2><p>Recent contact and infrared readings</p></div><button type="button" class="chart-download" data-action="export-trace">${tabIcon('download',14)} Download CSV</button></div><div class="legend"><span><i class="legend-dot mint"></i>Contact</span><span><i class="legend-dot blue"></i>Infrared</span></div><div class="graph">${lineChart(s.telemetry.slice(-100))}</div><div class="graph-note">${isLive()?'Measured sensor values':'Synthetic illustrative values · Not a physical measurement'}</div></section>${recentActivity()}</div>
  <div class="help-row">${tabIcon('shield',17)}<span>${isLive()?'Browser STOP is not an emergency stop. Keep a physical power disconnect available.':'Explore without hardware. To unlock your Arduino, exit this workspace and enter your private pairing code.'}</span></div>`;
}
function welcomePage(){
  const ready=live.connected,offline=live.backendOnline&&!ready;
  return `<div class="entry-hero"><div class="entry-copy"><span class="eyebrow">INTELLIGENT LAB MONITORING</span><h1>Clarity for every <em>signal.</em></h1><p>One purposeful space to monitor temperature, control outputs, and run repeatable processes. Start in a risk-free demo, or securely connect your own Arduino.</p><div class="hero-micro"><span>${tabIcon('activity',17)} Live telemetry</span><span>${tabIcon('layers',17)} Timed recipes</span><span>${tabIcon('database',17)} Run history</span></div></div><div class="hero-instrument" aria-hidden="true"><div class="instrument-head"><span><i></i><i></i><i></i></span><span>PROCESS SIGNAL / PREVIEW</span></div><div class="instrument-body"><div class="instrument-reading"><small>CONTACT TEMPERATURE</small><strong>29.8<span>°C</span></strong><span class="instrument-live">●  DEMONSTRATION</span></div><svg viewBox="0 0 420 156" preserveAspectRatio="none"><defs><linearGradient id="traceFill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#A49BD5" stop-opacity=".28"/><stop offset="1" stop-color="#A49BD5" stop-opacity="0"/></linearGradient></defs><path d="M0 120H420M0 80H420M0 40H420" stroke="#FFFFFF" stroke-opacity=".10" stroke-dasharray="4 8"/><path d="M0 114C48 112 61 95 103 101S154 48 198 61 260 87 303 52 365 80 420 32L420 156H0Z" fill="url(#traceFill)"/><path d="M0 114C48 112 61 95 103 101S154 48 198 61 260 87 303 52 365 80 420 32" fill="none" stroke="#F5D5E0" stroke-width="3.3" stroke-linecap="round"/><circle cx="420" cy="32" r="6" fill="#C18CCF" stroke="#122E33" stroke-width="4"/></svg><div class="instrument-footer"><span>SENSOR CHANNEL 01</span><span>MONITORING · READY</span></div></div></div></div>
  ${connectionInterrupted?`<div class="connection-alert">${tabIcon('alert',18)}<span>Previous hardware connection was lost. Physical output states must be checked separately.</span></div>`:''}
  <section class="entry-paths"><div class="paths-head"><div><span class="eyebrow">GET STARTED</span><h2>Choose your workspace.</h2></div><p>Two ways in. One simple control experience.</p></div><div class="entry-grid">
  <article class="entry-card demo-entry"><span class="path-index">01 / NO SETUP NEEDED</span><div class="path-icon">${tabIcon('play',23)}</div><h3>Explore the demo</h3><p>Try motor and fan switches, build timed recipes, and watch sample signals. No hardware is touched.</p><div class="path-bottom"><span>${tabIcon('shield',16)} Safe simulation</span>${b(`Open demo ${tabIcon('arrow',17)}`,'enter-demo','primary')}</div></article>
  <article class="entry-card live-entry"><span class="path-index">02 / PRIVATE HARDWARE ACCESS</span><div class="path-icon">${tabIcon('lock',23)}</div><h3>Enter control room</h3><p>Enter the 6-digit code configured on the Arduino host computer to unlock authorized control.</p>
  <form id="landing-pair-form" class="access-form"><label for="landing-pair-code">PAIRING CODE</label><div class="access-line"><input id="landing-pair-code" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" minlength="6" autocomplete="off" placeholder="6-digit code" aria-label="Private six digit pairing code" ${ready?'':'disabled'} required/><button type="submit" class="btn primary" ${ready?'':'disabled'}>Unlock ${tabIcon('arrow',17)}</button></div></form>
  <div class="access-note ${ready?'ready':''}"><span class="status-lamp"></span>${ready?'Arduino is online · Pairing available':offline?'Backend online · Arduino offline':'Controller offline · Demo available'} ${ready&&live.paired?`· ${b('Continue session','enter-live','text-btn')}`:''}</div>
  ${!ready?`<button type="button" class="small-route-link" data-action="show-setup">How to connect your Arduino ${tabIcon('arrow',13)}</button>`:''}
  </article></div></section>
  <div class="entry-footnote">${tabIcon('lock',15)} Control requires your private code. GitHub Pages never stores the code; only temporary sessions are kept in your browser.</div>`;
}
function recipeItem(r){const chosen=r.id===selected;return `<button class="recipe-choice ${chosen?'chosen':''}" data-action="choose-recipe" data-id="${esc(r.id)}"><div class="choice-top"><strong>${esc(r.name)}</strong>${chosen?tabIcon('check',16):''}</div><p>${esc(r.description||'Custom sequence')}</p><small>${r.steps.length} steps <span>·</span> ${durationText(duration(r))}</small></button>`}
function recipeStepRow(step,index){return `<div class="step-card"><div class="step-card-head"><strong><span class="step-number">${index+1}</span> Step ${index+1}</strong><button class="plain-icon" type="button" data-action="delete-step" data-index="${index}" title="Remove step" ${draft.steps.length===1?'disabled':''}>${tabIcon('trash',16)}</button></div><div class="step-inputs"><div class="field step-name"><label for="step-label-${index}">Step name</label><input id="step-label-${index}" data-index="${index}" data-step-key="label" value="${esc(step.label||'')}" maxlength="45" placeholder="e.g. Motor run"/></div><div class="field time-field"><label for="step-sec-${index}">Seconds</label><input id="step-sec-${index}" data-index="${index}" data-step-key="duration" type="number" min="2" max="${isLive()?120:180}" value="${Number(step.duration)}"/></div><label class="checkbox-label"><input type="checkbox" data-index="${index}" data-step-key="motor" ${step.motor?'checked':''}/>Motor</label><label class="checkbox-label"><input type="checkbox" data-index="${index}" data-step-key="fan" ${step.fan?'checked':''}/>Fan</label></div></div>`}
function recipesPage(){
  return `${pageHeader('AUTOMATION','Make a recipe.','Choose a saved process or create your own timed sequence.',b(`${tabIcon('plus',16)} New recipe`,'new-recipe','primary'))}
  <div class="recipe-layout"><section class="card recipe-library"><div class="panel-top"><div><h2>Saved recipes</h2><p>Stored in this browser</p></div><span class="count-chip">${recipes.length}</span></div><div class="recipe-choices">${recipes.map(recipeItem).join('')}</div></section>
  <section class="card recipe-editor"><div class="panel-top"><div><h2>Recipe builder</h2><p>A few steps, one repeatable process</p></div>${sourceFlag()}</div>
  <div class="field"><label for="recipe-name">Recipe name</label><input id="recipe-name" data-field="name" maxlength="62" value="${esc(draft.name)}" placeholder="Your recipe name"/></div>
  <div class="editor-row"><div class="field"><label for="recipe-description">Description <span>(optional)</span></label><input id="recipe-description" data-field="description" maxlength="150" value="${esc(draft.description||'')}"/></div><div class="field repeats"><label for="recipe-repeats">Repeat cycles</label><input id="recipe-repeats" data-field="repeats" type="number" min="1" max="${isLive()?20:5}" value="${Number(draft.repeats)}"/></div></div>
  <div class="editor-section-head"><div><h3>Process steps</h3><p>Motor and fan are interlocked.</p></div>${b(`${tabIcon('plus',16)} Add step`,'add-step','secondary',draft.steps.length>=(isLive()?8:12)?'disabled':'')}</div>
  <div class="step-cards">${draft.steps.map(recipeStepRow).join('')}</div>
  <div class="recipe-summary"><span>${tabIcon('clock',17)} Planned duration</span><strong id="recipe-duration">${durationText(duration(draft))}</strong></div>
  <div class="editor-actions">${b('Save recipe','save-recipe','secondary')}${b(`${tabIcon('play',16)} Save & start`,'run-recipe','primary')}${b('Delete','delete-recipe','text-danger')}</div>
  <p class="field-footnote">${isLive()?'Live hardware: up to 8 steps, 2–120 seconds each, 1–20 cycles.':'Demo: up to 12 steps, 2–180 seconds each, 1–5 cycles.'} ${isLive()&&!live.paired?'Pair the browser to start a hardware recipe.':''}</p>
  </section></div>`;
}
function historyPage(){const all=state().runs||[];return `${pageHeader('YOUR RECORDS','Run history.',isLive()?'Completed and recent processes stored in your local SQLite database.':'Your simulation sessions are stored in this browser.',b(`${tabIcon('download',16)} Export records`,'export-history','secondary'))}
  <section class="card history-card"><div class="panel-top"><div><h2>Process log</h2><p>${all.length} ${isLive()?'hardware':'demo'} records</p></div>${sourceFlag()}</div>
    ${all.length?`<div class="table-scroller"><table class="records"><thead><tr><th>Recipe</th><th>Started</th><th>Status</th><th>Runtime</th><th></th></tr></thead><tbody>${all.map(run=>`<tr><td><strong>${esc(run.name)}</strong></td><td>${dt(run.startedAt)}</td><td><span class="table-status ${run.status==='COMPLETED'?'ok':run.status==='FAULTED'?'fault':''}">${esc(run.status)}</span></td><td>${run.activeSeconds==null?'—':durationText(run.activeSeconds)}</td><td><button class="text-action" data-action="view-run" data-id="${esc(run.id)}">Details →</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="history-empty">${tabIcon('history',32)}<h3>No runs yet</h3><p>Start a recipe and its results will show up here.</p>${b('Create a recipe →','go-recipes','primary')}</div>`}</section>
  <section class="history-helper"><span>${tabIcon('shield',18)}</span><p>${isLive()?'Timing comes from Arduino event timestamps; actual relay motion is not measured.':'Demo records contain simulated timings, not measured hardware results.'}</p></section>`;}
function render(){
  const match=location.hash.match(/^#\/(welcome|dashboard|recipes|history)/);route=match?.[1]||'welcome';
  if(route!=='welcome'&&selectedMode==='none') {location.hash='#/welcome';route='welcome';}
  document.body.classList.toggle('welcome-view',route==='welcome');
  document.body.classList.toggle('workspace-view',route!=='welcome');
  topStatus();
  if(route==='welcome'){$('entry-content').innerHTML=welcomePage();hydrateIcons($('entry-frame'));}
  else{$('page').innerHTML=route==='recipes'?recipesPage():route==='history'?historyPage():dashboard();hydrateIcons($('page'));}
}

function openDialog(markup){$('dialog-content').innerHTML=markup;hydrateIcons($('dialog-content'));$('dialog').showModal();}
function closeDialog(){if($('dialog').open)$('dialog').close();}
function pairingDialog(){openDialog(`<div class="dialog-head"><span class="dialog-badge">${tabIcon('lock',17)} PRIVATE CONNECTION</span><button class="plain-icon" data-action="close-dialog" aria-label="Close">${tabIcon('x',19)}</button></div><h2>Unlock Arduino controls</h2><p class="dialog-desc">Your Arduino is online. For safety, enter the <strong>6-digit pairing code</strong> shown in the PowerShell window running your backend. This is needed once per backend session.</p><form id="pair-form"><div class="field"><label for="pair-code">Pairing code</label><input type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" pattern="[0-9]{6}" maxlength="6" id="pair-code" required autofocus/></div><button class="btn primary full" type="submit">Unlock controls</button></form><p class="dialog-note">Keep the Arduino host online. Never post your PIN publicly. Temporary access lasts up to two hours and ends if this browser stops communicating.</p>`);$('pair-code').focus()}
function runDetail(r){const steps=r.recordedSteps||[];return `<div class="dialog-head"><span class="dialog-badge">${isLive()?'HARDWARE RECORD':'DEMO RECORD'}</span><button class="plain-icon" data-action="close-dialog" aria-label="Close">${tabIcon('x',19)}</button></div><h2>${esc(r.name)}</h2><p class="dialog-desc">${dt(r.startedAt)} · ${esc(r.status)}</p><div class="detail-stats"><div><small>Active time</small><strong>${r.activeSeconds==null?'—':durationText(r.activeSeconds)}</strong></div><div><small>Completed steps</small><strong>${steps.length}/${r.stepsPlanned||steps.length}</strong></div></div><h3>Step timings</h3><div class="detail-steps">${steps.length?steps.map(x=>`<div><span>Cycle ${x.cycle}: ${esc(x.label)}</span><strong>${x.observed==null?'—':Number(x.observed).toFixed(2)+' s'} <small>/ ${x.planned}s</small></strong></div>`).join(''):'No completed steps recorded.'}</div><div class="dialog-actions">${b('Download JSON','download-run','secondary',`data-id="${esc(r.id)}"`)}${b('Download CSV','download-csv','secondary',`data-id="${esc(r.id)}"`)}</div><p class="dialog-note">${isLive()?'Firmware timing is not a measurement of the physical relay contacts.':'All values are produced by browser simulation.'}</p>`;}
async function ensurePaired(){if(!isLive())return true;if(live.paired)return true;pairingDialog();return false;}
async function execCommand(fn,success){if(busy)return;busy=true;try{await fn();if(success)toast(success,'success')}catch(e){toast(errorMessage(e),'error');if(e.status===401)pairingDialog();}finally{busy=false;render()}}
function saveDraft(silent=false){const err=!String(draft.name||'').trim()?'Recipe needs a name.':isLive()?validateLiveRecipe(draft):validate(draft);if(err){toast(err,'error');return false;}const idx=recipes.findIndex(r=>r.id===draft.id);if(idx<0)recipes.unshift(structuredClone(draft));else recipes[idx]=structuredClone(draft);selected=draft.id;saveRecipes(recipes);dirty=false;if(!silent)toast('Recipe saved','success');return true;}
function navigate(target){location.hash='#/'+target;if(route===target)render();}
function enterDemo(){
  if(isLive()&&(live.state.motor||live.state.fan||live.state.run)){toast('Stop the real motor, fan or running recipe before switching to Demo.','error');return;}
  if(live.paired)live.logout().catch(()=>{});
  selectedMode='demo';connectionInterrupted=false;navigate('dashboard');
}
function enterLive(){
  if(!live.connected){toast('Arduino is offline. Start the bridge and connect your board.','error');return;}
  if(!live.paired){toast('Enter your private code to unlock Live Control.','error');return;}
  if(demo.state.run||demo.state.motor||demo.state.fan)demo.stop('Entering live workspace');
  connectionInterrupted=false;selectedMode='live';navigate('dashboard');
}
function setupDialog(){openDialog(`<div class="dialog-head"><span class="dialog-badge">LOCAL SETUP</span><button class="plain-icon" data-action="close-dialog">${tabIcon('x',19)}</button></div><h2>Connect your Arduino</h2><p class="dialog-desc">Connect your USB Arduino and keep its Serial Monitor closed. On the same computer, open PowerShell in the project's <code>backend</code> folder and run:</p><div class="run-step" style="padding:12px;background:var(--surface-soft);border-radius:10px;overflow-wrap:anywhere"><code>python -m uvicorn main:app --host 127.0.0.1 --port 8000</code></div><p class="dialog-desc" style="margin-top:16px">Leave the server running. When SYSTEM LIVE appears, enter your operator PIN. For access from another device, configure Tailscale Funnel only after installing the secure backend update. Keep a physical power cutoff accessible.</p>`);}

async function action(button){const kind=button.dataset.action,id=button.dataset.id,idx=Number(button.dataset.index);
  if(kind==='close-dialog'){closeDialog();return}
  if(kind==='toggle-theme'){setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');return}
  if(kind==='enter-demo'){enterDemo();return}
  if(kind==='sample-demo'){if(isLive()){toast('This shortcut is for simulation only.');return}if(demo.state.run){toast('A demo recipe is already running.');return}const result=demo.start({id:'sample-'+Date.now(),name:'Quick sample · 15 seconds',description:'Short motor, fan and idle demonstration',repeats:1,steps:[{label:'Motor test',duration:5,motor:true,fan:false},{label:'Fan test',duration:5,motor:false,fan:true},{label:'Idle',duration:5,motor:false,fan:false}]});if(result.ok){toast('15-second simulation started','success');render()}else toast(result.message,'error');return}
  if(kind==='enter-live'){enterLive();return}
  if(kind==='show-setup'){setupDialog();return}
  if(kind==='go-welcome'){if(busy){toast('Wait for the previous command to finish.','error');return}if(isLive()&&(live.state.run||live.state.motor||live.state.fan)){toast('Stop physical outputs before leaving the control room.','error');return}if(live.paired)live.logout().catch(()=>{});selectedMode='none';navigate('welcome');return}
  if(kind==='export-trace'){const rows=state().telemetry||[];if(!rows.length){toast('No readings to export yet.');return}safeDownload(`autolab-${isLive()?'live':'demo'}-trace.csv`,csvTable(rows,['time','contact','infrared','motor','fan','mode','sequence','source']),'text/csv');toast('Temperature trace exported','success');return}
  if(kind.startsWith('go-')){navigate(kind.slice(3));return}
  if(kind==='unlock'){pairingDialog();return}
  if(kind==='toggle-motor'||kind==='toggle-fan'){
    const channel=kind.slice(7);if(!await ensurePaired())return;
    if(isLive())await execCommand(()=>live.manual(channel,!live.state[channel]),`${channel==='motor'?'Motor':'Fan'} command sent`);
    else{const result=demo.manual(channel,!demo.state[channel]);if(!result.ok)toast(result.message,'error');else render()}
    return;
  }
  if(['stop','pause','resume','reset-fault'].includes(kind)){
    if(!await ensurePaired())return;
    if(isLive())await execCommand(()=>kind==='reset-fault'?live.resetFault():live[kind](),kind==='stop'?'STOP command sent':'Command sent');
    else{const res=kind==='reset-fault'?demo.resetFault():demo[kind]();if(res?.ok===false)toast(res.message,'error');render()}return;
  }
  if(kind==='choose-recipe'){if(dirty&&!confirm('Discard unsaved recipe edits?'))return;const chosen=recipes.find(x=>x.id===id);if(chosen){selected=id;draft=structuredClone(chosen);dirty=false;render()}return}
  if(kind==='new-recipe'){draft=blankRecipe();selected=draft.id;dirty=true;render();return}
  if(kind==='add-step'){if(draft.steps.length>=(isLive()?8:12))return;draft.steps.push({label:`Step ${draft.steps.length+1}`,duration:5,motor:false,fan:false});dirty=true;render();return}
  if(kind==='delete-step'){if(draft.steps.length>1){draft.steps.splice(idx,1);dirty=true;render()}return}
  if(kind==='save-recipe'){if(saveDraft())render();return}
  if(kind==='run-recipe'){
    const err=isLive()?validateLiveRecipe(draft):validate(draft);if(err){toast(err,'error');return}
    if(!await ensurePaired())return;
    if(!saveDraft(true))return;
    if(isLive()){await execCommand(()=>live.start(draft),'Hardware recipe started');navigate('dashboard')}
    else{const result=demo.start(draft);if(result.ok){navigate('dashboard');toast('Demo recipe started','success')}else toast(result.message,'error')}
    return;
  }
  if(kind==='delete-recipe'){if(!confirm(`Delete “${draft.name}”?`))return;recipes=recipes.filter(r=>r.id!==draft.id);if(!recipes.length)recipes=[blankRecipe()];saveRecipes(recipes);draft=structuredClone(recipes[0]);selected=draft.id;dirty=false;render();return}
  if(kind==='export-history'){const data={application:'AutoLab SCADA',source:isLive()?'HARDWARE':'SIMULATED',exportedAt:new Date().toISOString(),runs:state().runs};safeDownload(`autolab-${isLive()?'hardware':'demo'}-runs.json`,JSON.stringify(data,null,2));return}
  if(kind==='view-run'){
    let r=state().runs.find(x=>String(x.id)===id);if(!r)return;
    if(isLive())try{r=await live.runDetail(id)}catch(e){toast(errorMessage(e),'error');return}
    openDialog(runDetail(r));return;
  }
  if(kind==='download-run'||kind==='download-csv'){
    let r=state().runs.find(x=>String(x.id)===id);if(!r)return;
    if(isLive())try{r=await live.runDetail(id)}catch(e){toast(errorMessage(e),'error');return}
    if(kind==='download-run')safeDownload(`autolab-run-${id}.json`,JSON.stringify(r,null,2));
    else safeDownload(`autolab-run-${id}.csv`,csvTable(r.samples||[],['time','sec','contact','infrared','motor','fan','mode','sequence','source']),'text/csv');
    return;
  }
}
document.addEventListener('click',e=>{const btn=e.target.closest('[data-action]');if(btn&&!btn.disabled){e.preventDefault();action(btn).catch(err=>toast(errorMessage(err),'error'))}});
document.addEventListener('input',e=>{
  if(route!=='recipes')return;const target=e.target;
  if(target.dataset.field){const k=target.dataset.field;draft[k]=k==='repeats'?Number(target.value):target.value;dirty=true;}
  if(target.dataset.stepKey){const s=draft.steps[Number(target.dataset.index)];if(!s)return;const key=target.dataset.stepKey;s[key]=target.type==='checkbox'?target.checked:key==='duration'?Number(target.value):target.value;dirty=true;}
  if($('recipe-duration'))$('recipe-duration').textContent=durationText(duration(draft));
});
document.addEventListener('change',e=>{if(route==='recipes'&&e.target.dataset.stepKey&&e.target.type==='checkbox'){
  const idx=Number(e.target.dataset.index),s=draft.steps[idx];if(s.motor&&s.fan){const opposite=s===undefined?'':e.target.dataset.stepKey==='motor'?'fan':'motor';s[opposite]=false;render()}
}});
document.addEventListener('submit',async e=>{
  if(!['pair-form','landing-pair-form'].includes(e.target.id))return;e.preventDefault();const onLanding=e.target.id==='landing-pair-form';const code=$(onLanding?'landing-pair-code':'pair-code').value.trim();try{await live.pair(code);if(!onLanding)closeDialog();enterLive();toast('Private live session unlocked','success')}catch(error){toast(errorMessage(error),'error')}
});
$('dialog').addEventListener('click',e=>{if(e.target===$('dialog'))closeDialog()});
$('theme-toggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
window.addEventListener('hashchange',render);
let lastDemoPaint=0;demo.subscribe(()=>{if(!isLive()&&route==='dashboard'&&performance.now()-lastDemoPaint>750){lastDemoPaint=performance.now();render()}});
let lastConnectivity='';
live.subscribe(()=>{
  const key=[live.connected,live.backendOnline,live.paired,live.state.fault].join('|');
  if(selectedMode==='live'&&!live.connected){connectionInterrupted=true;selectedMode='demo';toast('Arduino connection lost. Physical outputs must be checked.','error');}
  else if(selectedMode==='live'&&!live.paired){connectionInterrupted=true;selectedMode='none';toast('Private session ended. Verify physical outputs before reconnecting.','error');navigate('welcome');return;}
  if(route==='welcome'){if(key!==lastConnectivity)render();}
  else if(route==='dashboard')render();
  else if(key!==lastConnectivity)topStatus();
  lastConnectivity=key;
});
document.querySelectorAll('.site-year').forEach(y=>y.textContent=new Date().getFullYear());setTheme(document.documentElement.dataset.theme==='dark'?'dark':'light');hydrateIcons(document);render();
async function discover(){await live.poll();}
await discover();setInterval(discover,1800);
window.__autolabDebug={demo,live,getSource:()=>isLive()?'HARDWARE':'SIMULATED',getMode:()=>selectedMode,apiBase:API_BASE};

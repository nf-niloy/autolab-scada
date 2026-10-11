/** Public GitHub Pages frontend; private control requires a local or HTTPS tunnel backend. */
import {duration} from './recipes.js';
import {REMOTE_API_URL} from './remote-config.js';

export const API_BASE = (typeof location !== 'undefined' && ['localhost','127.0.0.1'].includes(location.hostname) && location.port==='8000')
  ? location.origin : (REMOTE_API_URL || 'http://127.0.0.1:8000');
const iso=()=>new Date().toISOString();
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const unique=(data,key)=>Array.from(new Map(data.map(v=>[v[key],v])).values());
const eventMessage=row=>{
  const bits=(row.raw||'').split(','),kind=bits[0]==='EVENT'?bits[2]||'EVENT':bits[0];
  const titles={RUN_START:'Recipe started',RUN_COMPLETE:'Recipe completed',RUN_PAUSED:'Recipe paused',RUN_RESUMED:'Recipe resumed',STEP:`Step ${bits[3]||'?'} · Cycle ${bits[4]||'?'}`,STOPPED:'All outputs stopped',FAULT:`Controller fault: ${bits[3]||'unknown'}`,BOOT:'Arduino restarted',RESET:'Controller reset'};
  return {id:String(row.id),time:row.time||iso(),message:titles[kind]||kind.replaceAll('_',' '),type:kind==='FAULT'?'ERROR':kind==='STEP'?'STEP':'INFO',detail:row.raw||''};
};
export function validateLiveRecipe(recipe){
  if(!recipe||!Array.isArray(recipe.steps)||recipe.steps.length<1||recipe.steps.length>8)return 'Live recipes support 1–8 steps.';
  if(!Number.isInteger(Number(recipe.repeats))||recipe.repeats<1||recipe.repeats>20)return 'Live recipes support 1–20 cycles.';
  for(const [i,s] of recipe.steps.entries()){
    if(!Number.isInteger(Number(s.duration))||s.duration<2||s.duration>120)return `Step ${i+1}: choose 2–120 seconds.`;
    if(s.motor&&s.fan)return `Step ${i+1}: motor and fan cannot run together.`;
  }
  return null;
}
export class LiveController {
  constructor(){
    this.listeners=new Set();this.lastPacket=0;this.seq=0;this.connected=false;this.backendOnline=false;this.everConnected=false;
    this.token=sessionStorage.getItem('autolab-control-session')||'';
    this.paired=!!this.token;this.lastError='';this.fetching=false;this.lastHistory=0;this.lastRuns=0;
    this.state={mode:'IDLE',status:'DISCONNECTED',contact:null,infrared:null,motor:false,fan:false,fault:false,uptime:0,run:null,telemetry:[],events:[],runs:[]};
  }
  subscribe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn)}
  emit(){for(const fn of this.listeners)try{fn(this.state)}catch(e){console.error(e)}}
  async request(path, method='GET', body, useToken=false, timeout=3000){
    const abort=new AbortController(),t=setTimeout(()=>abort.abort(),timeout);
    try{
      const headers=body===undefined?{}:{'Content-Type':'application/json'};
      if(useToken&&this.token)headers.Authorization=`Bearer ${this.token}`;
      const init={method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:abort.signal,cache:'no-store',mode:'cors'};
      if(API_BASE.startsWith('http://127.0.0.1')||API_BASE.startsWith('http://localhost'))init.targetAddressSpace='loopback';
      const response=await fetch(`${API_BASE}${path}`,init);
      const data=await response.json().catch(()=>({}));
      if(!response.ok){const error=new Error(typeof data.detail==='string'?data.detail:`Request failed (${response.status})`);error.status=response.status;throw error;}
      return data;
    }finally{clearTimeout(t)}
  }
  async poll(){
    if(this.fetching)return;
    this.fetching=true;
    try{
      const reply=await this.request('/api/status','GET',undefined,!!this.token);
      const ready=!!(reply.serial_connected&&reply.telemetry_fresh&&reply.telemetry);
      this.backendOnline=true;this.lastError='';this.apply(reply,ready);
      if(ready&&this.token){
        if(Date.now()-this.lastHistory>10000){this.lastHistory=Date.now();this.history().catch(()=>{});}
        if(Date.now()-this.lastRuns>8000){this.lastRuns=Date.now();this.runs().catch(()=>{});}
      }
    }catch(e){
      if(e.status===401){this.unpair();this.lastError='Private session expired. Please log in again.';
        this.backendOnline=true;this.apply(null,false);}
      else{this.backendOnline=false;this.lastError=e.name==='AbortError'?'Backend timed out':e.message;
        this.apply(null,false);}
    }finally{this.fetching=false;this.emit()}
  }
  apply(response,ready){
    this.connected=ready;
    if(ready)this.everConnected=true;
    const s=this.state;
    if(!ready){s.mode='IDLE';s.status='DISCONNECTED';s.motor=false;s.fan=false;s.contact=null;s.infrared=null;s.run=null;return;}
    const t=response.telemetry;
    s.mode=t.mode;s.status=t.mode==='AUTO'?'RUNNING':t.mode==='PAUSED'?'PAUSED':t.mode==='FAULT'?'FAULT':t.mode==='IDLE'?'READY':'MANUAL';
    s.motor=!!t.motor;s.fan=!!t.fan;s.fault=t.mode==='FAULT'||t.fault!=='NONE';s.contact=t.ds18b20_c;s.infrared=t.mlx90614_c;s.uptime=t.uptime_ms/1000;
    const last=s.telemetry.at(-1);
    if(!last||last.sequence!==t.sequence||last.sec!==s.uptime){
      s.telemetry.push({time:t.recorded_at||iso(),sec:s.uptime,contact:s.contact,infrared:s.infrared,motor:+s.motor,fan:+s.fan,mode:t.mode,sequence:t.sequence,source:'HARDWARE'});
      if(s.telemetry.length>1500)s.telemetry.splice(0,s.telemetry.length-1500);
      this.seq++;
    }
    const r=response.active_run;
    if(r&&['AUTO','PAUSED'].includes(t.mode)&&Array.isArray(r.recipe?.steps)){
      const steps=r.recipe.steps.map(v=>({duration:v.seconds,motor:v.motor,fan:v.fan,label:v.label||''}));
      const index=clamp((t.step||1)-1,0,steps.length-1);
      const paused=(r.current_step?.paused_ms||0)+(t.mode==='PAUSED'&&r.pause_started_ms!=null?Math.max(0,t.uptime_ms-r.pause_started_ms):0);
      const elapsed=r.current_step?.uptime_ms!=null?clamp((t.uptime_ms-r.current_step.uptime_ms-paused)/1000,0,steps[index].duration):0;
      s.run={id:String(r.id),name:r.name||'Hardware recipe',recipe:{steps},repeats:r.recipe.cycles||1,repeatIndex:Math.max(0,(t.cycle||1)-1),stepIndex:index,stepTime:elapsed,paused:t.mode==='PAUSED'};
    }else{s.run=null;}
    s.events=unique([...(response.recent_events||[]).map(eventMessage),...s.events],'id').sort((a,b)=>new Date(b.time)-new Date(a.time)).slice(0,70);
  }
  async history(){const data=await this.request('/api/history?limit=180','GET',undefined,true);if(!Array.isArray(data))return;
    const mapped=data.map(t=>({time:t.recorded_at,sec:(t.uptime_ms||0)/1000,contact:t.ds18b20_c,infrared:t.mlx90614_c,motor:t.motor,fan:t.fan,mode:t.mode,sequence:t.sequence,source:'HARDWARE'}));
    const last=this.state.telemetry.at(-1);
    this.state.telemetry=unique([...mapped,...(last?[last]:[])],'sequence').slice(-180);this.seq++;this.emit();}
  async runs(){const data=await this.request('/api/runs?limit=60','GET',undefined,true);this.state.runs=data;this.emit();return data;}
  async runDetail(id){return this.request(`/api/runs/${encodeURIComponent(id)}`,'GET',undefined,true)}
  async pair(code){
    const answer=await this.request('/api/pair','POST',{code},false,6000);
    if(!answer.token)throw new Error('Pairing token missing');
    this.token=answer.token;this.paired=true;sessionStorage.setItem('autolab-control-session',this.token);await this.poll();this.emit();
  }
  unpair(){this.token='';this.paired=false;sessionStorage.removeItem('autolab-control-session');this.emit()}
  async logout(){try{if(this.token)await this.request('/api/logout','POST',undefined,true,2000)}catch{}finally{this.unpair()}}
  async command(path,body){
    if(!this.connected)throw new Error('Arduino offline. Controls are unavailable.');
    if(!this.paired)throw new Error('Unlock controls using your private pairing code first.');
    try{const response=await this.request(path,'POST',body,true,7000);await this.poll();return response;}
    catch(e){if(e.status===401)this.unpair();throw e;}
  }
  manual(channel,on){return this.command(`/api/${channel}`,{on})}
  stop(){return this.command('/api/stop')}
  resetFault(){return this.command('/api/reset')}
  pause(){return this.command('/api/recipe/pause')}
  resume(){return this.command('/api/recipe/resume')}
  start(recipe){const err=validateLiveRecipe(recipe);if(err)return Promise.reject(new Error(err));
    return this.command('/api/recipe/run',{name:recipe.name,cycles:Number(recipe.repeats),steps:recipe.steps.map(s=>({seconds:Number(s.duration),label:s.label||'',motor:!!s.motor,fan:!!s.fan}))});}
  getStats(){const runs=this.state.runs,completed=runs.filter(x=>x.status==='COMPLETED');return {count:runs.length,completed:completed.length,completionRate:runs.length?100*completed.length/runs.length:0}}
}

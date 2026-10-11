/* AutoLab Live adapter. Can only be activated from local FastAPI's same origin.
   No direct browser USB, no public GitHub Pages hardware control. */
import {duration} from './recipes.js';

const stamp=()=>new Date().toISOString();
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const typeFromLine=line=>line.includes(',FAULT,')?'ERROR':line.includes(',STEP,')?'STEP':line.includes('STOP')?'WARNING':'INFO';
const asEvent=e=>{
  const bits=e.raw.split(',');
  const event=bits[0]==='EVENT'?(bits[2]||'EVENT'):bits[0];
  const descriptions={STEP:`Step ${bits[3]||'?'} · Cycle ${bits[4]||'?'}`,RUN_START:'Hardware recipe started',RUN_COMPLETE:'Hardware recipe completed',RUN_PAUSED:'Hardware recipe paused',RUN_RESUMED:'Hardware recipe resumed',STOPPED:'All hardware outputs stopped',FAULT:`Hardware fault: ${bits[3]||'unknown'}`,BOOT:'Arduino restarted',RESET:'Arduino controller reset',MANUAL_OUTPUT:'Hardware output command applied'};
  return {id:String(e.id),time:e.time,message:descriptions[event]||event.replaceAll('_',' '),type:typeFromLine(e.raw),detail:e.raw};
};
export const localBridgeAvailable=()=>['127.0.0.1','localhost'].includes(location.hostname)&&location.port==='8000'&&location.protocol==='http:';

export function validateLiveRecipe(recipe){
  if(!recipe || !Array.isArray(recipe.steps) || !recipe.steps.length || recipe.steps.length>8)return 'Live mode supports 1–8 steps.';
  if(!Number.isInteger(Number(recipe.repeats))||recipe.repeats<1||recipe.repeats>20)return 'Live mode supports 1–20 cycles.';
  for(let i=0;i<recipe.steps.length;i++){
    const st=recipe.steps[i];
    if(!Number.isInteger(Number(st.duration))||st.duration<2||st.duration>120)return `Step ${i+1}: live duration must be 2–120 seconds.`;
    if(st.motor&&st.fan)return `Step ${i+1}: simultaneous motor and fan is not allowed.`;
  }
  return null;
}

export class LiveController{
  constructor(){
    this.listeners=new Set();this.seq=0;this.socket=null;this.reconnectTimer=null;this.tickTimer=null;
    this.enabled=false;this.ready=false;this.eventIds=new Set();this.lastPacket=0;
    this.state={mode:'IDLE',status:'DISCONNECTED',motor:false,fan:false,fault:false,contact:null,infrared:null,ambient:null,uptime:0,commandCount:0,run:null,telemetry:[],events:[],runs:[],lastAction:'Awaiting hardware connection'};
  }
  subscribe(cb){this.listeners.add(cb);return()=>this.listeners.delete(cb)}
  emit(){for(const cb of this.listeners){try{cb(this.state)}catch(e){console.error(e)}}}
  async request(path,method='GET',body){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),6000);
    try{
      const response=await fetch(path,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:ctrl.signal,cache:'no-store'});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.detail?typeof result.detail==='string'?result.detail:JSON.stringify(result.detail):`HTTP ${response.status}`);
      return result;
    }finally{clearTimeout(timer)}
  }
  async connect(){
    if(!localBridgeAvailable())throw new Error('Live control is available only at http://127.0.0.1:8000/ on the Arduino laptop.');
    const response=await this.request('/api/status');
    if(!response.telemetry_fresh||!response.serial_connected)throw new Error('Arduino telemetry is not ready. Start the FastAPI backend and check COM6.');
    this.enabled=true;
    await this.refreshHistory().catch(()=>{});
    await this.refreshRuns().catch(()=>{});
    this.apply(response);
    this.openWebSocket();
    this.tickTimer=setInterval(()=>{
      if(!this.enabled)return;
      if(Date.now()-this.lastPacket>3500){this.ready=false;this.state.status='CONNECTION LOST';this.state.motor=false;this.state.fan=false;this.state.run=null;this.emit()}
      else if(this.state.run&&!this.state.run.paused){this.updateProgress();this.emit()}
    },500);
  }
  async disconnect(){
    if(this.enabled&&this.ready){
      // Switching to demo always requests a real STOP first.
      await this.request('/api/stop','POST');
    } else if(this.enabled){
      throw new Error('Connection unavailable. Hardware state is unknown. Physically isolate power before leaving Live Mode.');
    }
    this.enabled=false;this.ready=false;
    if(this.reconnectTimer)clearTimeout(this.reconnectTimer);
    if(this.tickTimer)clearInterval(this.tickTimer);
    this.socket?.close();this.socket=null;
  }
  openWebSocket(){
    if(!this.enabled)return;
    const protocol=location.protocol==='https:'?'wss:':'ws:';
    this.socket=new WebSocket(`${protocol}//${location.host}/ws/live`);
    this.socket.onmessage=e=>{try{this.apply(JSON.parse(e.data))}catch(error){console.error(error)}};
    this.socket.onclose=()=>{
      if(!this.enabled)return;
      this.ready=false;this.state.status='CONNECTION LOST';this.emit();
      this.reconnectTimer=setTimeout(()=>this.openWebSocket(),1500);
    };
    this.socket.onerror=()=>this.socket?.close();
  }
  async refreshHistory(){
    const data=await this.request('/api/history?limit=180');
    this.state.telemetry=data.map(t=>({time:t.recorded_at,sec:(t.uptime_ms||0)/1000,contact:t.ds18b20_c,infrared:t.mlx90614_c,ambient:null,motor:t.motor,fan:t.fan,mode:t.mode,sequence:t.sequence,source:'HARDWARE'}));
    this.seq++;
  }
  async refreshRuns(){
    const data=await this.request('/api/runs?limit=50');
    this.state.runs=data;this.emit();
  }
  async getRun(id){return this.request(`/api/runs/${encodeURIComponent(id)}`)}
  apply(message){
    if(!this.enabled)return;
    this.lastPacket=Date.now();
    const s=this.state,t=message.telemetry;
    const wasRunning=!!s.run;
    const oldMode=s.mode;
    this.ready=!!(message.serial_connected&&message.telemetry_fresh&&t);
    if(this.ready){
      s.mode=t.mode;s.status=t.mode==='AUTO'?'RUNNING':t.mode==='PAUSED'?'PAUSED':t.mode==='FAULT'?'FAULT':t.mode==='IDLE'?'READY':'MANUAL';
      s.motor=!!t.motor;s.fan=!!t.fan;s.fault=t.mode==='FAULT';
      s.contact=t.ds18b20_c;s.infrared=t.mlx90614_c;s.uptime=t.uptime_ms/1000;
      const current=s.telemetry.at(-1);
      if(!current||current.sequence!==t.sequence||Math.abs(current.sec-s.uptime)>2){
        s.telemetry.push({time:t.recorded_at,sec:s.uptime,contact:t.ds18b20_c,infrared:t.mlx90614_c,ambient:null,motor:+s.motor,fan:+s.fan,mode:t.mode,sequence:t.sequence,source:'HARDWARE'});
        if(s.telemetry.length>1800)s.telemetry.splice(0,s.telemetry.length-1800);
        this.seq++;
      }
      if(message.active_run&&(t.mode==='AUTO'||t.mode==='PAUSED')){
        const r=message.active_run,steps=r.recipe.steps.map(v=>({duration:v.seconds,motor:v.motor,fan:v.fan,label:v.label||''}));
        if(!s.run||s.run.id!==String(r.id)){
          s.run={id:String(r.id),name:r.name,recipe:{name:r.name,steps},stepIndex:0,repeatIndex:0,repeats:r.recipe.cycles,paused:false,stepTime:0,stepStartUptime:null,startedAt:stamp()};
        }
        s.run.stepIndex=clamp((t.step||1)-1,0,steps.length-1);
        s.run.repeatIndex=clamp((t.cycle||1)-1,0,r.recipe.cycles-1);
        s.run.paused=t.mode==='PAUSED';
        s.run.stepStartUptime=r.current_step?.uptime_ms??null;
        const pausedMs=(r.current_step?.paused_ms||0)+(t.mode==='PAUSED'&&r.pause_started_ms!=null?Math.max(0,t.uptime_ms-r.pause_started_ms):0);
        s.run.stepBase=s.run.stepStartUptime==null?0:clamp((t.uptime_ms-s.run.stepStartUptime-pausedMs)/1000,0,steps[s.run.stepIndex].duration);
        s.run.stepTime=s.run.stepBase;
      }else{s.run=null;}
    }else{
      s.status='DISCONNECTED';s.motor=false;s.fan=false;s.run=null;
      // Do not display stale readings as if they were live.
      s.contact=null;s.infrared=null;
    }
    for(const row of message.recent_events||[]){
      if(this.eventIds.has(String(row.id)))continue;
      this.eventIds.add(String(row.id));
      s.events.unshift(asEvent(row));
      if(s.events.length>100)s.events.length=100;
    }
    if(this.eventIds.size>500)this.eventIds=new Set([...this.eventIds].slice(-200));
    if(wasRunning&&!s.run||oldMode==='AUTO'&&s.mode==='FAULT')this.refreshRuns().catch(()=>{});
    this.emit();
  }
  updateProgress(){const r=this.state.run;if(!r||r.stepStartUptime==null)return;const step=r.recipe.steps[r.stepIndex];const elapsed=(r.stepBase||0)+(Date.now()-this.lastPacket)/1000;r.stepTime=clamp(elapsed,0,step.duration)}
  async perform(path,payload){
    if(!this.ready)return {ok:false,message:'Hardware data is stale. Control is disabled.'};
    try{const reply=await this.request(path,'POST',payload);this.state.commandCount++;return {ok:true,reply}}
    catch(e){return {ok:false,message:e.message}}
  }
  manual(channel,on){if(!['fan','motor'].includes(channel))return Promise.resolve({ok:false,message:'Unknown channel'});return this.perform(`/api/${channel}`,{on})}
  stop(){return this.perform('/api/stop')}
  resetFault(){return this.perform('/api/reset')}
  pause(){return this.perform('/api/recipe/pause')}
  resume(){return this.perform('/api/recipe/resume')}
  async start(recipe){const err=validateLiveRecipe(recipe);if(err)return {ok:false,message:err};return this.perform('/api/recipe/run',{name:recipe.name,cycles:recipe.repeats,steps:recipe.steps.map(s=>({seconds:s.duration,label:s.label||'',motor:s.motor,fan:s.fan}))})}
  injectFault(){return {ok:false,message:'Physical fault injection is not available.'}}
  clearRuns(){return {ok:false,message:'Hardware records cannot be cleared from the dashboard.'}}
  getStats(){const runs=this.state.runs;const completed=runs.filter(x=>x.status==='COMPLETED'),all=runs.flatMap(x=>x.recordedSteps||[]),errors=all.filter(x=>Number.isFinite(x.timingError)).map(x=>Math.abs(x.timingError));const durations=runs.map(x=>x.activeSeconds).filter(Number.isFinite);return {count:runs.length,completed:completed.length,completionRate:runs.length?100*completed.length/runs.length:null,steps:all.length,mae:errors.length?errors.reduce((a,b)=>a+b,0)/errors.length:null,meanDuration:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null}}
}

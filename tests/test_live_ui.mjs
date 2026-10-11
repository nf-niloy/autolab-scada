// End-to-end-ish UI smoke test with mocked API/WebSocket (no real actuator control).
import assert from 'node:assert/strict';
globalThis.location={hostname:'127.0.0.1',port:'8000',protocol:'http:',host:'127.0.0.1:8000',hash:'#/overview'};
const elements=new Map();
class StubElement{
 constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.hidden=false;this.classList={remove(){},add(){},toggle(){}};this.dataset={};this.style={};}
 addEventListener(){}appendChild(){}remove(){}querySelector(){return null}querySelectorAll(){return []}setAttribute(){}removeAttribute(){}
}
const getId=id=>{if(!elements.has(id))elements.set(id,new StubElement(id));return elements.get(id)};
const handlers=new Map();
globalThis.document={createElement(tag){return new StubElement(tag)},getElementById:getId,querySelector(){return null},querySelectorAll(){return []},addEventListener(name,cb){handlers.set(name,cb)},title:''};
globalThis.window={addEventListener(name,cb){handlers.set(name,cb)},__autolabDebug:null};
globalThis.localStorage={getItem(){return null},setItem(){}};
globalThis.confirm=()=>true;
const status={serial_connected:true,telemetry_fresh:true,telemetry:{sequence:100,uptime_ms:100000,ds18b20_c:30.5,mlx90614_c:30.6,motor:false,fan:false,mode:'IDLE',step:0,cycle:0,fault:'NONE',recorded_at:'2026-10-11T06:00:00+00:00'},active_run:null,recent_events:[],last_error:null};
const requested=[];
globalThis.fetch=async(path,options={})=>{requested.push([path,options.method||'GET']);return {ok:true,json:async()=>path==='/api/status'?status:path.startsWith('/api/history')||path.startsWith('/api/runs')?[]:{ok:true,message:'OK'}}};
globalThis.WebSocket=class{constructor(url){this.url=url;this.onmessage=null;this.onclose=null}close(){}};
await import('../src/app.js');
const click=action=>handlers.get('click')({target:{closest(){return {dataset:{action},disabled:false}}},preventDefault(){}});
click('toggle-mode');
await new Promise(resolve=>setTimeout(resolve,50));
assert.match(getId('page').innerHTML,/Arduino/);
assert.match(getId('page').innerHTML,/30.5°/);
assert.match(getId('page').innerHTML,/HARDWARE/);
assert.equal(getId('mode-switch').textContent.includes('LIVE'),true);
window.__autolabDebug.go('control');handlers.get('hashchange')();
assert.match(getId('page').innerHTML,/Hardware connected/);
assert.match(getId('page').innerHTML,/MEASURED/);
click('switch-motor');await new Promise(resolve=>setTimeout(resolve,50));
assert.ok(requested.some(([url,method])=>url==='/api/motor'&&method==='POST'));
click('toggle-mode');await new Promise(resolve=>setTimeout(resolve,50));
assert.ok(requested.some(([url,method])=>url==='/api/stop'&&method==='POST'));
assert.match(getId('page').innerHTML,/Simulation only/);
console.log('Demo → Live → Demo mocked UI flow PASSED');
process.exit(0);

// Minimal headless DOM smoke check without a browser executable.
import assert from 'node:assert/strict';
globalThis.location={hostname:'127.0.0.1',port:'8000',protocol:'http:',host:'127.0.0.1:8000',hash:'#/overview'};
const elements=new Map();
class StubElement{
 constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.hidden=false;this.classList={remove(){},add(){},toggle(){}};this.dataset={};this.style={};}
 addEventListener(){}
 querySelector(){return null}
 querySelectorAll(){return []}
 setAttribute(){}
 removeAttribute(){}
}
const getId=id=>{if(!elements.has(id))elements.set(id,new StubElement(id));return elements.get(id)};
globalThis.document={getElementById:getId,querySelector(){return null},querySelectorAll(){return []},addEventListener(){},title:''};
globalThis.window={addEventListener(name,cb){if(name==='hashchange')this.hashHandler=cb},__autolabDebug:null};
globalThis.localStorage={getItem(){return null},setItem(){}};
await import('../src/app.js');
assert.match(getId('page').innerHTML,/Your control room, simplified/);
assert.match(getId('page').innerHTML,/SIMULATED/);
assert.equal(getId('mode-switch').hidden,false);
window.__autolabDebug.go('recipes');window.hashHandler();
assert.match(getId('page').innerHTML,/Recipe configuration/);
window.__autolabDebug.go('control');window.hashHandler();
assert.match(getId('page').innerHTML,/Simulation only/);
assert.match(document.title,/Control room/);
console.log('Frontend DOM smoke test PASSED');
process.exit(0);

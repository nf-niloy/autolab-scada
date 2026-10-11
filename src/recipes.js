import {readStore,writeStore,uid} from './storage.js';
export const exampleRecipes=[
 {id:'cycle-01',name:'Standard operation cycle',description:'Alternate motor, fan and idle stages for sequence timing.',tags:['SEQUENCE'],repeats:2,steps:[{motor:true,fan:false,duration:8,label:'Motor cycle'},{motor:false,fan:true,duration:6,label:'Fan cycle'},{motor:false,fan:false,duration:4,label:'Settling period'}]},
 {id:'cycle-02',name:'Cooling duty cycle',description:'Demonstrate timed fan actuation using existing relay hardware.',tags:['ACTUATION'],repeats:2,steps:[{motor:false,fan:true,duration:10,label:'Active fan'},{motor:false,fan:false,duration:5,label:'Idle interval'}]},
 {id:'cycle-03',name:'Relay switching validation',description:'Repeat short, spaced transitions to evaluate commanded timing.',tags:['VALIDATION'],repeats:3,steps:[{motor:true,fan:false,duration:4,label:'Output A'},{motor:false,fan:false,duration:3,label:'Interlock dwell'},{motor:false,fan:true,duration:4,label:'Output B'},{motor:false,fan:false,duration:3,label:'Interlock dwell'}]}
];
const deep=x=>JSON.parse(JSON.stringify(x));
export function loadRecipes(){const v=readStore('recipes',null);return Array.isArray(v)?v:deep(exampleRecipes)}
export function saveRecipes(v){writeStore('recipes',v)}
export function duration(recipe){return recipe.steps.reduce((s,v)=>s+Number(v.duration||0),0)*Number(recipe.repeats||1)}
export function validate(recipe){if(!recipe||!String(recipe.name||'').trim())return 'Recipe needs a name.';if(!Array.isArray(recipe.steps)||!recipe.steps.length||recipe.steps.length>12)return 'Use between 1 and 12 steps.';if(!Number.isInteger(Number(recipe.repeats))||Number(recipe.repeats)<1||Number(recipe.repeats)>5)return 'Repeat count must be 1–5.';for(const [i,s] of recipe.steps.entries()){if(!Number.isInteger(Number(s.duration))||s.duration<2||s.duration>180)return `Step ${i+1}: duration must be 2–180 seconds.`;if(s.motor&&s.fan)return `Step ${i+1}: simultaneous motor and fan is disabled in this conservative demo profile.`;}if(duration(recipe)>1800)return 'Total runtime cannot exceed 30 minutes.';return null}
export function blankRecipe(){return {id:uid('recipe'),name:'Untitled recipe',description:'Custom process sequence',tags:['CUSTOM'],repeats:1,steps:[{motor:true,fan:false,duration:6,label:'Motor operation'},{motor:false,fan:false,duration:4,label:'Idle'}]}}

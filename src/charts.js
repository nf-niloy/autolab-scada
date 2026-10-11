import {escapeHTML} from './storage.js';
const fmtTime=iso=>new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
export function lineChart(points,opts={}){
 const width=880,height=296,ml=48,mr=18,mt=18,mb=38,iw=width-ml-mr,ih=height-mt-mb;
 if(!points?.length)return `<div class="empty-chart">No telemetry yet.</div>`;
 const series=opts.series||[{key:'contact',color:'#56dec7',label:'Contact sensor'},{key:'infrared',color:'#8fa8ff',label:'IR sensor'}];
 const minVal=Math.min(...points.flatMap(p=>series.map(s=>Number(p[s.key])).filter(Number.isFinite)))-.35;
 const maxVal=Math.max(...points.flatMap(p=>series.map(s=>Number(p[s.key])).filter(Number.isFinite)))+.35;
 const range=Math.max(2,maxVal-minVal),low=Math.floor(minVal-.4),high=Math.ceil(low+range+.5),span=high-low;
 const x=i=>ml+(points.length===1?0:i/(points.length-1)*iw), y=v=>mt+(high-v)/span*ih;
 const axis=Array.from({length:5},(_,i)=>{const n=low+span*i/4;const yy=y(n);return `<line x1="${ml}" y1="${yy}" x2="${width-mr}" y2="${yy}" stroke="#233848" stroke-dasharray="3 6"/><text x="${ml-12}" y="${yy+4}" text-anchor="end" font-size="12" fill="#8ea4ae">${n.toFixed(1)}°</text>`}).join('');
 const vlines=Array.from({length:5},(_,i)=>{const idx=Math.round((points.length-1)*i/4),xx=x(idx);return `<text x="${xx}" y="${height-8}" text-anchor="middle" font-size="12" fill="#8ea4ae">${escapeHTML(fmtTime(points[idx].time))}</text>`}).join('');
 const paths=series.map(s=>{const path=points.map((p,i)=>`${i===0?'M':'L'}${x(i).toFixed(2)} ${y(Number(p[s.key])).toFixed(2)}`).join(' ');const last=points.at(-1);return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${x(points.length-1)}" cy="${y(Number(last[s.key]))}" r="4.2" fill="${s.color}" stroke="#0f1f2c" stroke-width="2"/>`}).join('');
 return `<div class="chart-outer"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Simulated temperature trends"><defs><clipPath id="chartclip"><rect x="${ml}" y="${mt}" width="${iw}" height="${ih}"/></clipPath></defs>${axis}${vlines}<g clip-path="url(#chartclip)">${paths}</g></svg></div>`;
}
export function microSpark(points,key='contact',color='#56dec7'){
 const data=points.slice(-45);if(data.length<2)return '';
 const values=data.map(p=>Number(p[key]));const min=Math.min(...values)-.2,max=Math.max(...values)+.2;const coord=values.map((v,i)=>`${(i/(values.length-1)*160).toFixed(1)},${(48-(v-min)/(max-min)*40).toFixed(1)}`).join(' ');
 return `<svg class="spark" viewBox="0 0 160 56" aria-hidden="true" preserveAspectRatio="none"><polyline points="${coord}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
export function barChart(items){
 if(!items.length)return '<div class="empty-chart">Complete a simulation run to see a timing comparison.</div>';
 const max=Math.max(...items.flatMap(v=>[v.planned,v.observed]),1);return `<div class="bar-list">${items.slice(0,10).map((v,i)=>`<div class="bar-row"><span class="bar-label">${escapeHTML(v.label||'Step '+(i+1))} <small>cycle ${v.cycle||1}</small></span><div class="bar-comparison"><div class="bar-plan" style="width:${Math.min(100,v.planned/max*100)}%"></div><div class="bar-observed" style="width:${Math.min(100,v.observed/max*100)}%"></div></div><span class="bar-value">${Number(v.observed).toFixed(2)}s</span></div>`).join('')}<div class="chart-legend"><span><i class="legend-dot blue"></i>Programmed</span><span><i class="legend-dot green"></i>Simulated observed</span></div></div>`;
}

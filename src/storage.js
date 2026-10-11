const PREFIX='autolab-scada-v1-';
export function readStore(key,fallback){try{const val=localStorage.getItem(PREFIX+key);return val===null?fallback:JSON.parse(val)}catch{return fallback}}
export function writeStore(key,value){try{localStorage.setItem(PREFIX+key,JSON.stringify(value));return true}catch{return false}}
export function safeDownload(filename,data,mime='application/json'){const blob=new Blob([data],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500)}
export function csvCell(v){const s=String(v??'');return '"'+s.replace(/"/g,'""')+'"'}
export function csvTable(rows,columns){return [columns.join(','),...rows.map(r=>columns.map(k=>csvCell(r[k])).join(','))].join('\r\n')}
export function escapeHTML(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
export function uid(prefix='id'){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7)}

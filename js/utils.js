import { state } from './state.js';

export const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));

export function addLog(msg){
  const el = document.getElementById('log');
  if(!el) return;
  const p = document.createElement('p'); p.innerHTML = msg; el.prepend(p);
}

export function itemById(id){
  return (window.ITEM_BY_ID||{})[id] || null;
}

// petit formatter commun aux events
export function formatLeft(ms){
  if (ms <= 0) return '0s';
  const s = Math.ceil(ms/1000);
  if (s < 60) return s+'s';
  const m = Math.floor(s/60), r = s%60;
  return m + ':' + String(r).padStart(2,'0');
}

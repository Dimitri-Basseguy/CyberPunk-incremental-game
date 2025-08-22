import './config.js';
import { state, ensureSkillsState } from './state.js';
import { persist, restore } from './persist.js';
import { renderAll } from './ui.js';
import { programMods, upgradeMods } from './compute.js';
import { tickEventTicker, spawnSecurityEvent } from './events.js';

// Boutons sauvegarde/reset
window.addEventListener('DATA_READY', ()=>{
  document.getElementById('saveBtn').onclick=()=>{ persist(); const p=document.createElement('p'); p.textContent='💾 Sauvegardé'; document.getElementById('log').prepend(p); };
  document.getElementById('resetBtn').onclick=()=>{
    const KEY = (typeof SAVE_KEY !== 'undefined' ? SAVE_KEY : (window.SAVE_KEY || 'cyber_netrunner_save_v6'));
    ['cyber_netrunner_save_v4','cyber_netrunner_save_v5', KEY, 'open_targets_v1','open_missions_v1','open_upgrades_v1']
      .forEach(k=>localStorage.removeItem(k));
    location.reload();
  };

  restore();
  ensureSkillsState();
  renderAll();

  // Passive income
  setInterval(()=>{
    const pm = programMods();
    if(pm.passiveIncome){ state.creds += pm.passiveIncome; document.getElementById('kpi-creds').textContent = state.creds+'₵'; }
  },1000);

  // Heat decay
  setInterval(()=>{
    if(state.heat>0){
      const extra = (upgradeMods().heatDecayPerSec || 0);
      state.heat = Math.max(0, state.heat - (1 + extra));
      // petit refresh ciblé (KPIs)
      document.getElementById('kpi-heat').textContent = Math.round(state.heat)+'%';
      const hb = document.getElementById('kpi-heatbar'); if(hb) hb.style.width = Math.min(100, Math.round(state.heat)) + '%';
    }
  }, 1500);

  // Ticker UI (événements actifs)
  setInterval(tickEventTicker, 300);

  // Events aléatoires
  const EVENT_PERIOD = 12000;
  setInterval(()=>{
    const pBase = Math.min(0.35, 0.05 + state.heat/300);
    const p = pBase * ( (upgradeMods().eventProbMul || 1) );
    if(Math.random()<p){ spawnSecurityEvent(); }
  }, EVENT_PERIOD);

  const p = document.createElement('p'); p.textContent='Bienvenue, runner. Upgrades disponibles dans le nouveau panneau.'; document.getElementById('log').prepend(p);
});

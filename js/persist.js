import { state } from './state.js';

export function persist(){
  const o = {
    ...state,
    gearOwned:[...state.gearOwned],
    programsOwned:[...state.programsOwned],
    upgrades:[...state.upgrades],
    hardening: state.hardening
  };
  const KEY = (typeof SAVE_KEY !== 'undefined' ? SAVE_KEY : (window.SAVE_KEY || 'cyber_netrunner_save_v6'));
  localStorage.setItem(KEY, JSON.stringify(o));
}

export function restore(){
  try{
    const KEY = (typeof SAVE_KEY !== 'undefined' ? SAVE_KEY : (window.SAVE_KEY || 'cyber_netrunner_save_v6'));
    const raw = localStorage.getItem(KEY); if(!raw) return;
    const o = JSON.parse(raw);
    state.creds=o.creds; state.rep=o.rep; state.heat=o.heat; state.xp=o.xp; state.sp=o.sp; state.skills=o.skills;
    state.gearOwned=new Set(o.gearOwned||[]);
    state.gearInstalled=o.gearInstalled||state.gearInstalled;
    state.programsOwned=new Set(o.programsOwned||[]);
    state.activePrograms=o.activePrograms||[];
    state.discovered=o.discovered||{};
    state.events=o.events||[];
    state.missions=o.missions||{active:null,progress:{}};
    state.upgrades=new Set(o.upgrades||[]);
    state._bypassReadyAt=o._bypassReadyAt||0;
    state.farmHistory = o.farmHistory || {};
    state.attemptHistory = o.attemptHistory || {};
    state.scanHistory = o.scanHistory || {};
    state.hardening   = o.hardening || {};
  }catch(e){ console.warn(e); }
}
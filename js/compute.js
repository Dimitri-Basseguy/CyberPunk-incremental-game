import { state } from './state.js';
import { itemById, clamp } from './utils.js';
import { TRACE, ADAPTIVE } from './config.js';

// ---- Upgrades aggregation
function upgradeMods(){
  const base = {
    heatFailMul:1, avoidHeatOnFailPct:0, heatCapMinus:0, heatDecayPerSec:0,
    eventProbMul:1, cloakExtraHeatMul:1,
    successAdd:0, vsBlackAdaptAdd:0, rewardMul:1, showScanExact:false, scanLatencyMul:1, bypassCooldownMs:0,
    latencyCpuMul:1, slotAdd:0, cpuAdd:0, lockoutMul:1, extraAttemptPct:0
  };
  const getNode = (id)=> (window.UPGRADE_NODE_BY_ID||{})[id];
  for (const id of state.upgrades){
    const n = getNode(id); if(!n) continue;
    const eff = n.effect||{};
    for (const [k,v] of Object.entries(eff)){
      if (k.endsWith('Mul')) base[k] *= v;
      else if (typeof base[k] === 'number') base[k] += v;
      else if (typeof base[k] === 'boolean') base[k] = base[k] || !!v;
      else base[k] = v;
    }
  }
  return base;
}

function gearBonuses(){
  const ids = new Set([state.gearInstalled.deck, state.gearInstalled.console, state.gearInstalled.implant, ...state.gearInstalled.mods, ...state.gearInstalled.tools].filter(Boolean));
  const res = { netrun:0, stealth:0, decrypt:0, speed:0, heatReduce:0, successAdd:0 };
  for (const id of ids){
    const it = itemById(id); if(!it) continue;
    for (const [k,v] of Object.entries(it.bonuses||{})) res[k]=(res[k]||0)+v;
  }
  return res;
}
function programSlots(){
  let s = 0; const d=itemById(state.gearInstalled.deck), c=itemById(state.gearInstalled.console);
  if(d?.slots) s += d.slots; if(c?.slots) s += c.slots;
  s += upgradeMods().slotAdd||0;
  return s;
}
function cpuCapacity(){
  const d=itemById(state.gearInstalled.deck), c=itemById(state.gearInstalled.console);
  return (d?.cpu||0) + (c?.cpu||0) + (upgradeMods().cpuAdd||0);
}
function cpuUsed(){
  return state.activePrograms.reduce((sum,pid)=> sum + ((window.PROGRAMS||[]).find(p=>p.id===pid)?.cpu||0), 0);
}
function renderSystemLoad(){
  const cap = cpuCapacity(); const used = cpuUsed();
  const pct = cap? Math.min(100, Math.round(used/cap*100)) : 0;
  const t = `${used} / ${cap} CPU`;
  document.getElementById('kpi-load').textContent = t;
  document.getElementById('kpi-loadbar').style.width = pct+'%';
}

function programMods(){
  const mods = { successMul:1, heatOnFailMul:1, rewardMul:1, successAdd:0, vsBlackAdapt:0, cityBonusSuccess:0, cityRep:0, passiveIncome:0, extraAttemptOnSuccess:0 };
  for(const pid of state.activePrograms){
    const m = (window.PROGRAMS||[]).find(p=>p.id===pid)?.mods||{};
    if(m.successMul) mods.successMul *= m.successMul;
    if(m.heatOnFailMul) mods.heatOnFailMul *= m.heatOnFailMul;
    if(m.rewardMul) mods.rewardMul *= m.rewardMul;
    if(m.successAdd) mods.successAdd += m.successAdd;
    if(m.vsBlackAdapt) mods.vsBlackAdapt += m.vsBlackAdapt;
    if(m.cityBonusSuccess) mods.cityBonusSuccess += m.cityBonusSuccess;
    if(m.cityRep) mods.cityRep += m.cityRep;
    if(m.passiveIncome) mods.passiveIncome += m.passiveIncome;
    if(m.extraAttemptOnSuccess) mods.extraAttemptOnSuccess = 1;
  }
  return mods;
}

function activeEventMods(target){
  const now = Date.now();
  state.events = state.events.filter(e => !e.ends || e.ends > now);

  const mods = { iceBonus:0, heatFailAdd:0, rewardMul:1, chanceAdd:0, heatAttemptAdd:0 };
  const map = window.EVENT_DEFS_BY_ID || {};

  // ✅ Fallback si pas de defs JSON
  if (!Object.keys(map).length){
    for (const e of state.events){
      if(e.type==='audit' && (target.kind==='corp') && (!e.corp || e.corp===target.id)){
        mods.iceBonus += 10;
      }
      if(e.type==='city_sweep' && target.kind==='city'){
        mods.heatFailAdd += 6;
      }
      if(e.type==='bounty' && (target.kind==='corp') && (!e.corp || e.corp===target.id)){
        mods.rewardMul *= 1.25;
        mods.heatAttemptAdd += 2;
      }
      if (e.type === 'trace') {
        // scope: corp ciblée OU ville
        const match = (target.kind==='corp' && e.corp===target.id) || (target.kind==='city' && !e.corp);
        if (match){
          const L = e.level || 1;
          mods.iceBonus       += (TRACE.effects.icePerLevel||0) * L;
          mods.chanceAdd      -= (TRACE.effects.chanceMinusPerLevel||0) * L;
          mods.heatAttemptAdd += (TRACE.effects.heatAttemptAddPerLevel||0) * L;
        }
      }
    }
    return mods;
  }

  // JSON-driven (ta version actuelle)
  for (const e of state.events){
    const def = map[e.type] || map[e.id]; if(!def) continue;
    const eff = def.effects || {};
    const scope = def.scope || 'any';
    const match =
      scope === 'any' ||
      (scope === 'city' && target.kind === 'city') ||
      (scope === 'corp' && target.kind === 'corp' && (!e.corp || e.corp === target.id));
    if(!match) continue;

    if (typeof eff.iceBonus === 'number')       mods.iceBonus      += eff.iceBonus;
    if (typeof eff.heatFailAdd === 'number')    mods.heatFailAdd   += eff.heatFailAdd;
    if (typeof eff.rewardMul === 'number')      mods.rewardMul     *= eff.rewardMul;
    if (typeof eff.chanceAdd === 'number')      mods.chanceAdd     += eff.chanceAdd;
    if (typeof eff.heatAttemptAdd === 'number') mods.heatAttemptAdd+= eff.heatAttemptAdd;
  }
  return mods;
}

function computeSuccess(server, target, bypassStrength=0){
  const ICE = window.ICE||{};
  const g = gearBonuses();
  const um = upgradeMods();

  // ==== Skills depuis JSON ====
  const defs = (window.SKILLS && window.SKILLS.skills) || null;
  const denom = (window.SKILLS && window.SKILLS.compute && window.SKILLS.compute.denominator) || 120;

  let base=0, gearScore=0;
  if (defs && defs.length){
    for (const s of defs){
      const w  = (typeof s.weight==='number') ? s.weight : 0;
      const gw = (typeof s.gearWeight==='number') ? s.gearWeight : 0;
      base      += (state.skills[s.id] || 0) * w;
      gearScore += (g[s.id] || 0) * gw;
    }
  } else {
    // fallback (ta formule d’origine)
    base = state.skills.netrun*8 + state.skills.decrypt*7 + state.skills.stealth*5 + state.skills.speed*4;
    gearScore = (g.netrun||0)*6 + (g.decrypt||0)*5 + (g.stealth||0)*4 + (g.speed||0)*3;
  }

  const iceBaseNoBypass = server.level*12 + server.ice.reduce((s,n)=>s+(ICE[n]?.strength||0),0);
  const iceBase = Math.max(0, iceBaseNoBypass - (bypassStrength||0));
  const ev = activeEventMods(target);
  const hardLvl   = (state.hardening[server.id]?.lvl || 0);
  const extraHard = hardLvl * (ADAPTIVE.icePerLevel || 0);
  const iceScore  = iceBase + (ev.iceBonus||0) + extraHard;

  let diff = base + gearScore - iceScore;
  let chance = 0.5 + diff / denom;

  const pm = programMods();
  if(pm.successMul) chance *= pm.successMul;
  if(pm.successAdd) chance += pm.successAdd;
  if(um.successAdd) chance += um.successAdd;

  const vsBlackAdaptTotal = (pm.vsBlackAdapt||0)/100 + (um.vsBlackAdaptAdd||0);
  if(vsBlackAdaptTotal && server.ice.some(n=>n==='Noire' || n==='Adaptative')) chance += vsBlackAdaptTotal;
  if(pm.cityBonusSuccess && target.kind==='city') chance += (pm.cityBonusSuccess/100);

  return clamp(chance, 0.05, 0.95);
}

function heatOnFail(eventMods={}){
  const g = gearBonuses();
  const pm = programMods();
  const um = upgradeMods();
  const base = 14 - (g.stealth||0) - (g.heatReduce? g.heatReduce*100:0);
  const mul = (pm.heatOnFailMul || 1) * (um.cloakExtraHeatMul || 1) * (um.heatFailMul || 1);
  const add = eventMods.heatFailAdd||0;
  let h = Math.max(4, Math.round(base*mul) + add);
  // chance d'éviter totalement
  if(Math.random()*100 < (um.avoidHeatOnFailPct||0)) h = 0;
  return h;
}

function rewardMul(target, server){
  const pm = programMods();
  const g  = gearBonuses();
  const um = upgradeMods();

  // base + différentiel ville/corpo
  let m = ECONOMY.base * (target.kind === 'city' ? ECONOMY.cityMul : ECONOMY.corpMul);

  // multiplicateurs existants (programmes/ups + réputation)
  m *= (pm.rewardMul || 1) * (um.rewardMul || 1) * (1 + (state.rep * 0.02));
  if (g.successAdd) m *= (1 + g.successAdd * 0.2);

  // taxe de chaleur (linéaire selon la chaleur actuelle)
  const heatTax = 1 - (state.heat / 100) * ECONOMY.heatTaxMax;
  const minHeatFloor = 1 - ECONOMY.heatTaxMax; // ne descend jamais sous ce plancher via la taxe
  m *= Math.max(minHeatFloor, heatTax);

  // anti-farm : malus sur hacks répétés du même serveur dans la fenêtre
  const now = Date.now();
  const list = (state.farmHistory[server.id] || []).filter(ts => now - ts < ECONOMY.repeatWindowMs);
  const count = list.length; // 1er = 0 malus, puis -18%, -36%, etc. (borné par repeatMin)
  if (count > 0) {
    const decay = 1 - (ECONOMY.repeatDecay * count);
    m *= Math.max(ECONOMY.repeatMin, decay);
  }

  return m;
}

export {
  // mods & gear
  upgradeMods, gearBonuses, programSlots, cpuCapacity, cpuUsed, renderSystemLoad,
  // programmes
  programMods,
  // événements qui modifient les chances
  activeEventMods,
  // maths
  computeSuccess, heatOnFail, rewardMul
};
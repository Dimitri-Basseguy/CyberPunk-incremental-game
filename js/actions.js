import { state } from './state.js';
import { addLog, clamp } from './utils.js';
import { RETALIATION, ECONOMY, ADAPTIVE } from './config.js';
import { upgradeMods, programMods, activeEventMods, computeSuccess, heatOnFail, rewardMul } from './compute.js';
import { renderEventTicker, maybeTraceOnScan, maybeRetaliation } from './events.js';

// ====== Actions ======
function scan(targetId, serverId){
  const t = (window.TARGETS||[]).find(t=>t.id===targetId);
  const s = t.servers.find(s=>s.id===serverId);
  const um = upgradeMods();
  const btns = document.querySelectorAll('[data-scan], [data-action="hack"]');
  btns.forEach(b=>b.disabled=true);
  const delay = Math.round(350 * (um.scanLatencyMul||1));
  setTimeout(()=>{
    const c = computeSuccess(s,t); // bypass ne s'applique pas au scan
    state.discovered[serverId] = c;
    addLog(`Scan <span class="text-slate-400">${t.name} › ${s.name}</span> → chance ${Math.round(c*100)}%`);
    renderTargets();
    // Si le scan révèle ≥95 %, chance de fortifier immédiatement
    if (c >= ADAPTIVE.scanTriggerAt && Math.random() < ADAPTIVE.onScanChance){
      bumpHardeningIfNeeded(t, s, c, 'suite au scan');
    }

    // ✅ AJOUT : pression de scan & éventuel "trace"
    maybeTraceOnScan(t);

    btns.forEach(b=>b.disabled=false);
  }, delay);
}

function maybeBypass(server){
  const um = upgradeMods();
  if(!um.bypassCooldownMs) return 0;
  const now = Date.now();
  if(state._bypassReadyAt && state._bypassReadyAt > now) return 0;
  // calcule la plus forte GLACE
  const ICE = window.ICE||{};
  const maxStr = Math.max(0, ...server.ice.map(n=>ICE[n]?.strength||0));
  state._bypassReadyAt = now + um.bypassCooldownMs;
  return maxStr;
}

function hack(targetId, serverId){
  const t = (window.TARGETS||[]).find(t=>t.id===targetId);
  const s = t.servers.find(s=>s.id===serverId);
  const um = upgradeMods();
  const delayBase = 300;
  const delay = (delayBase + cpuUsed()*150) * (um.latencyCpuMul || 1);
  const buttons = document.querySelectorAll('[data-action="hack"]');
  buttons.forEach(b=>b.disabled=true);
  setTimeout(()=>{ doHack(t,s); buttons.forEach(b=>b.disabled=false); }, delay);
}

function doHack(t, s){
  const nowTs = Date.now();
  (state.attemptHistory[t.id] ||= []).push(nowTs);
  state.attemptHistory[t.id] = state.attemptHistory[t.id].filter(ts => nowTs - ts < RETALIATION.pressureWindowMs);
  const tmods = activeEventMods(t);
  // appliquer bypass éventuel
  const bypass = maybeBypass(s);
  const baseChance = computeSuccess(s, t, bypass);
  let chance = baseChance + (tmods.chanceAdd||0);
  chance = clamp(chance, 0.05, 0.95);
  const roll = Math.random();
  const um = upgradeMods();
  if(tmods.heatAttemptAdd) state.heat = clamp(state.heat + tmods.heatAttemptAdd, 0, 100);

  if(roll <= chance){
    const rm = rewardMul(t, s) * (tmods.rewardMul || 1);
    const cred = Math.round(s.reward.cred*rm);
    const repGain = s.reward.rep + (programMods().cityRep && t.kind==='city' ? programMods().cityRep : 0);
    state.creds += cred;
    state.rep += repGain;
    state.xp += 8 + s.level*3;
    // tentative bonus (programme ou upgrade)
    (state.farmHistory[s.id] ||= []).push(nowTs);
    state.farmHistory[s.id] = state.farmHistory[s.id].filter(ts => nowTs - ts < ECONOMY.repeatWindowMs);

    const extra = (programMods().extraAttemptOnSuccess ? 1 : 0) || (Math.random()*100 < (upgradeMods().extraAttemptPct||0) ? 1 : 0);
    addLog(`✔️ Succès: <b>${t.name} › ${s.name}</b> +<b>${cred}₵</b>, +<b>${repGain} Rep</b>, <span class="text-slate-400">${s.reward.loot}</span>${extra? ' — tentative bonus':''}`);

    // --- FORTIFICATION ADAPTATIVE ---
    // Si la chance observée frôle 95 %, la cible se "renforce" (GLACE virtuelle +L)
    // Utilise la meilleure des deux valeurs (chance affichée vs. base du calcul)
    if (typeof bumpHardeningIfNeeded === 'function') {
      const observed = Math.max(chance, baseChance);
      bumpHardeningIfNeeded(t, s, observed, 'après succès');
    }

    // Gains data-driven depuis data/skills.json
    const defs = (window.SKILLS && window.SKILLS.skills) || [];
    for (const s of defs){
      const delta = Number(s.gainOnSuccess||0);
      const p     = Number(s.gainChance||0);
      if(delta > 0 && Math.random() < p){
        state.skills[s.id] = (state.skills[s.id]||0) + delta;
      }
    }
    if(state.xp>=100){ state.xp-=100; state.sp++; addLog('⬆️ Point de compétence obtenu'); }
    onHackSuccess(t.id, s.id);
    // ⬇️ nouveau : chance de représailles
    maybeRetaliation(t, s, cred);
    if(extra){ renderAll(); return; }
  } else {
    const h = heatOnFail(tmods);
    const loss = s.ice.includes('Noire') ? Math.min( Math.round(state.creds*0.05), 120) : 0;
    const heatCap = 100 - (upgradeMods().heatCapMinus||0);
    state.heat = Math.min(heatCap, state.heat + h);
    state.creds = Math.max(0, state.creds - loss);
    addLog(`💀 Échec: <b>${t.name} › ${s.name}</b> — chaleur +${h}%${loss?`, perte ${loss}₵`:''}`);
  }
  if(state.heat>=100 - (upgradeMods().heatCapMinus||0)){
    const ms = 10000 * (upgradeMods().lockoutMul || 1);
    lockout(ms);
  }
  renderAll();
}

let lockTimer=null;
function lockout(ms){
  const buttons = document.querySelectorAll('[data-action="hack"]');
  buttons.forEach(b=>b.disabled=true);

  // 🔥 Ajout/MAJ de l’événement "lockout"
  const now = Date.now();
  const existing = state.events.find(e => e.type === 'lockout');
  if (existing){
    existing.start = existing.start || now;
    existing.ends  = now + ms;            // prolonge si déjà présent
  } else {
    state.events.push({ type:'lockout', start: now, ends: now + ms });
  }
  // log plus explicite + rafraîchit le panneau
  addLog(`🔥 Surcharge de chaleur — 🔒 verrou de ${Math.round(ms/1000)}s`);
  renderEventTicker?.();

  clearTimeout(lockTimer);
  lockTimer = setTimeout(()=>{
    buttons.forEach(b=>b.disabled=false);
    state.heat = Math.max(0, state.heat-30);
    renderAll();
    addLog('🧊 Verrou levé, chaleur -30%');
  }, ms);
}

// ====== Boutique/programmation ======
function buy(itemId){
  const it = itemById(itemId); if(!it) return;
  if(it.requires && !it.requires.every(r=>state.gearOwned.has(r))){ addLog('⛔ Pré-requises manquantes.'); return; }
  if(state.creds < it.cost){ addLog('⛔ Crédits insuffisants.'); return; }
  state.creds -= it.cost; state.gearOwned.add(it.id);
  const type = it.type;
  if(['deck','console','implant'].includes(type)){
    state.gearInstalled[type] = it.id;
  } else if(type==='mod'){
    state.gearInstalled.mods.push(it.id);
  } else if(type==='tool'){
    state.gearInstalled.tools.push(it.id);
  }
  addLog(`🛒 Acheté: <b>${it.name}</b>`);
  renderAll();
}

function learnProgram(pId){
  const p = (window.PROGRAMS||[]).find(p=>p.id===pId); if(!p) return;
  if(state.creds < p.cost){ addLog('⛔ Crédits insuffisants.'); return; }
  state.creds -= p.cost; state.programsOwned.add(p.id); addLog(`📦 Programme acquis: <b>${p.name}</b>`); renderAll();
}

function equipProgram(pId){
  if(!state.programsOwned.has(pId)) return;
  if(state.activePrograms.includes(pId)) return;
  const p = (window.PROGRAMS||[]).find(x=>x.id===pId); if(!p) return;
  if(state.activePrograms.length >= programSlots()){ addLog('⛔ Slots de programme pleins.'); return; }
  if(cpuUsed()+p.cpu > cpuCapacity()){ addLog('⛔ CPU insuffisant.'); return; }
  state.activePrograms.push(pId);
  addLog(`💾 Programme chargé: <b>${p.name}</b>`);
  renderPrograms(); persist();
}
function unequipProgram(pId){
  const i = state.activePrograms.indexOf(pId);
  if(i>=0){ state.activePrograms.splice(i,1); addLog(`⏏️ Programme retiré: <b>${(window.PROGRAMS||[]).find(p=>p.id===pId)?.name}</b>`); renderPrograms(); persist(); }
}

function spendPoint(skill){ if(state.sp<=0) return; state.sp--; state.skills[skill]+=1; addLog(`🧠 ${skill.toUpperCase()} +1`); renderAll(); }

// ====== Missions ======
function currentMission() { return state.missions.active || null; }
function acceptChain(corpId) { state.missions.active = { corp: corpId, index: 0 }; addLog(`📝 Mission acceptée — <b>${(window.TARGETS || []).find(t => t.id === corpId)?.name}</b>: ${(window.MISSION_CHAINS || {})[corpId][0].name}`); renderMissions(); persist(); }
function abandonMission() { if (state.missions.active) { addLog('🗑️ Mission abandonnée'); state.missions.active = null; renderMissions(); persist(); } }
function missionStep() { const m = currentMission(); if (!m) return null; return (window.MISSION_CHAINS || {})[m.corp][m.index] || null; }
function onHackSuccess(tid, sid) {
  const step = missionStep();
  if (!step) return;
  if (step.objective.target === tid && step.objective.server === sid) {
    const rw = step.reward;

    // ↓ multiplicateur missions (réglable via ECONOMY.missionMul)
    const missionMul = (typeof ECONOMY !== 'undefined' && ECONOMY.missionMul != null) ? ECONOMY.missionMul : 0.85;
    const credGain = Math.max(0, Math.round(rw.cred * missionMul));
    const repGain = rw.rep;

    state.creds += credGain;
    state.rep += repGain;

    addLog(`🏁 Mission accomplie: <b>${step.name}</b> +<b>${credGain}₵</b> <span class="text-slate-400 text-xs">×${missionMul}</span> (+${repGain} Rep)`);

    state.missions.active.index++;
    const chain = (window.MISSION_CHAINS || {})[state.missions.active.corp] || [];
    if (state.missions.active.index >= chain.length) {
      addLog('🎖️ Chaîne terminée — toutes les missions complétées !');
      state.missions.active = null;
    }
    renderMissions();
    persist();
  }
}

// expose pour que l’UI puisse les binder sans import (évite un cycle)
Object.assign(window, { scan, hack, buy, learnProgram, equipProgram, unequipProgram, spendPoint });

export {
  scan, hack, buy, learnProgram, equipProgram, unequipProgram, spendPoint, lockout,
  currentMission, acceptChain, abandonMission, missionStep, onHackSuccess
};
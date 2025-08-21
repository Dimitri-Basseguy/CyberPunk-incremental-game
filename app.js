// app_json.js — data-driven version + Upgrades UI/effects
const BTN = 'inline-flex items-center px-2 py-1 rounded-lg border border-white/15  hover:bg-white/15 font-semibold';
const BTN_PRIMARY = BTN + ' ring-1 ring-cyan-400/40 hover:ring-cyan-300/60';
const BTN_SUCCESS = BTN + ' ring-1 ring-emerald-400/60 hover:ring-emerald-300/70 bg-emerald-500/20'; // ✅ vert si achetable
const CARD = 'rounded-xl border border-white/10 bg-white/5 p-3';
const PILL = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 text-sm';
const PROGRESS_OUTER = 'h-2 bg-white/10 rounded-full overflow-hidden mt-1.5';
const PROGRESS_INNER = 'block h-full bg-gradient-to-r from-neon-cyan to-neon-fuchsia';

// Storage keys
const OPEN_TARGETS_KEY = 'open_targets_v1';
const OPEN_MISSIONS_KEY = 'open_missions_v1';
const OPEN_UPGRADES_KEY = 'open_upgrades_v1';
const SAVE_KEY = 'cyber_netrunner_save_v6';

// — Économie globale (tunable sans toucher aux JSON)
const ECONOMY = {
  base: 0.60,             // ↓ multiplicateur de base (ex: 0.60 = -40% de gains)
  heatTaxMax: 0.45,       // jusqu’à -45% de gains à 100% de chaleur
  repeatWindowMs: 10*60*1000, // fenêtre anti-farm (10 min)
  repeatDecay: 0.18,      // -18% par hack supplémentaire sur le même serveur dans la fenêtre
  repeatMin: 0.35,        // plancher du malus (jamais < 35% du montant)
  cityMul: 0.90,          // la ville paye un peu moins que les corpos
  corpMul: 1.00,          // corpos neutre
  missionMul: 0.85,       // missions un peu moins généreuses
farmHistory: {},          // { serverId: [timestamps] }
};

// ====== State ======
const state = {
  creds: 120,
  rep: 0,
  heat: 0,
  xp: 0,
  sp: 0,
  skills: { netrun: 1, stealth: 1, decrypt: 1, speed: 1 },
  gearOwned: new Set(['deck_mk1']),
  gearInstalled: { deck:'deck_mk1', console:null, implant:null, mods:[], tools:[] },
  programsOwned: new Set(['brute']),
  activePrograms: [],
  discovered: { },
  events: [],
  missions: { active:null, progress:{} },
  upgrades: new Set(), // ids de nœuds débloqués
  _bypassReadyAt: 0,   // cooldown pour l'upgrade bypass
  farmHistory: {},
};

// ====== Helpers ======
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const itemById=(id)=> (window.ITEM_BY_ID||{})[id] || null;

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
  const base = state.skills.netrun*8 + state.skills.decrypt*7 + state.skills.stealth*5 + state.skills.speed*4;
  const gearScore = (g.netrun||0)*6 + (g.decrypt||0)*5 + (g.stealth||0)*4 + (g.speed||0)*3;
  const iceBaseNoBypass = server.level*12 + server.ice.reduce((s,n)=>s+(ICE[n]?.strength||0),0);
  const iceBase = Math.max(0, iceBaseNoBypass - (bypassStrength||0));
  const ev = activeEventMods(target);
  const iceScore = iceBase + (ev.iceBonus||0);
  let diff = base + gearScore - iceScore;
  let chance = 0.5 + diff/120;
  const pm = programMods();
  if(pm.successMul) chance *= pm.successMul;
  if(pm.successAdd) chance += pm.successAdd;
  if(um.successAdd) chance += um.successAdd;
  const vsBlackAdaptTotal = (pm.vsBlackAdapt||0)/100 + (um.vsBlackAdaptAdd||0);
  if(vsBlackAdaptTotal && server.ice.some(n=>n==='Noire' || n==='Adaptative')) chance += vsBlackAdaptTotal;
  if(pm.cityBonusSuccess && target.kind==='city') chance += (pm.cityBonusSuccess/100);
  chance = clamp(chance, 0.05, 0.95);
  return chance;
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

function addLog(msg){
  const el = document.getElementById('log');
  const p = document.createElement('p'); p.innerHTML = msg; el.prepend(p);
}

// === Ticker d'événements (UI) ===
function formatLeft(ms){
  if (ms <= 0) return '0s';
  const s = Math.ceil(ms/1000);
  if (s < 60) return s+'s';
  const m = Math.floor(s/60), r = s%60;
  return m + ':' + String(r).padStart(2,'0');
}
function eventStart(e){
  if (e.start) return e.start;
  const defs = window.EVENT_DEFS_BY_ID || {};
  const d = defs[e.type] || defs[e.id];
  if (d && d.duration_ms) return e.ends - d.duration_ms;
  if (e.type === 'city_sweep') return e.ends - 25000;
  return e.ends - 30000;
}
function eventMeta(e){
  const defs = window.EVENT_DEFS_BY_ID || {};
  const d = defs[e.type] || defs[e.id];
  const name = d?.name || (e.type==='audit' ? 'Audit sécurité'
                    : e.type==='city_sweep' ? 'Sweep réseau municipal'
                    : e.type==='bounty' ? 'Prime temporaire'
                    : 'Événement');
  const icon = d?.icon || (e.type==='audit' ? '📊'
                    : e.type==='city_sweep' ? '🚨'
                    : e.type==='bounty' ? '💰'
                    : '🛰️');
  const scope = d?.scope || 'any';
  let who = '';
  if (scope==='corp' || e.corp){
    const corp = (window.TARGETS||[]).find(t=>t.id===e.corp);
    if (corp) who = ' — ' + corp.name;
  }
  return { name: name + who, icon };
}
function renderEventTicker(){
  const root = document.getElementById('eventsTicker');
  if (!root) return;

  const now = Date.now();
  // purge visuelle (activeEventMods purge déjà logiquement)
  state.events = state.events.filter(e => !e.ends || e.ends > now);

  root.innerHTML = '';
  if (!state.events.length){
    const p = document.createElement('p');
    p.className = 'text-slate-400 text-sm';
    p.textContent = '— Aucun événement en cours —';
    root.appendChild(p);
    return;
  }

  const list = [...state.events].sort((a,b)=> (a.ends||0) - (b.ends||0));
  for (const e of list){
    const { icon, name } = eventMeta(e);
    const start = eventStart(e);
    const total = Math.max(1, (e.ends - start));
    const left  = Math.max(0, (e.ends - now));
    const pct   = Math.max(0, Math.min(100, Math.round((left/total)*100)));

    const row = document.createElement('div');
    row.className = 'rounded-lg border border-white/10 bg-white/5 p-2';
    row.setAttribute('data-ev-ends', String(e.ends));
    row.setAttribute('data-ev-start', String(start));

    row.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <div class="font-medium">${icon} ${name}</div>
        <div class="text-slate-400 text-sm font-mono" data-left>${formatLeft(left)}</div>
      </div>
      <div class="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <span class="block h-full bg-gradient-to-r from-neon-cyan to-neon-fuchsia" data-bar style="width:${pct}%"></span>
      </div>
    `;
    root.appendChild(row);
  }
}
// Tick léger (anime le temps restant & la barre; redessine si expiré)
function tickEventTicker(){
  const root = document.getElementById('eventsTicker');
  if (!root) return;

  // Si des events existent mais aucune carte n'est affichée → construire une fois
  if (state.events.length && !root.querySelector('[data-ev-ends]')){
    renderEventTicker();
    return;
  }

  const now = Date.now();
  let needsRerender = false;
  root.querySelectorAll('[data-ev-ends]').forEach(card=>{
    const ends  = Number(card.getAttribute('data-ev-ends'));
    const start = Number(card.getAttribute('data-ev-start')) || (ends - 30000);
    const total = Math.max(1, ends - start);
    const left  = Math.max(0, ends - now);
    const pct   = Math.max(0, Math.min(100, Math.round((left/total)*100)));

    const timeEl = card.querySelector('[data-left]');
    const barEl  = card.querySelector('[data-bar]');
    if (timeEl) timeEl.textContent = formatLeft(left);
    if (barEl)  barEl.style.width = pct + '%';
    if (left <= 0) needsRerender = true;
  });

  if (needsRerender) renderEventTicker();
}

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
  const tmods = activeEventMods(t);
  // appliquer bypass éventuel
  const bypass = maybeBypass(s);
  const baseChance = state.discovered[s.id] ?? computeSuccess(s,t,bypass);
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
    const nowTs = Date.now();
    (state.farmHistory[s.id] ||= []).push(nowTs);
    state.farmHistory[s.id] = state.farmHistory[s.id].filter(ts => nowTs - ts < ECONOMY.repeatWindowMs);

    const extra = (programMods().extraAttemptOnSuccess ? 1 : 0) || (Math.random()*100 < (upgradeMods().extraAttemptPct||0) ? 1 : 0);
    addLog(`✔️ Succès: <b>${t.name} › ${s.name}</b> +<b>${cred}₵</b>, +<b>${repGain} Rep</b>, <span class="text-slate-400">${s.reward.loot}</span>${extra? ' — tentative bonus':''}`);

    if(Math.random()<0.5){ state.skills.netrun += 0.02; state.skills.decrypt += 0.015; state.skills.speed += 0.01; }
    if(state.xp>=100){ state.xp-=100; state.sp++; addLog('⬆️ Point de compétence obtenu'); }
    onHackSuccess(t.id, s.id);
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
    addLog(`🔥 Surcharge de chaleur — 🔒 verrou de ${Math.round(ms/1000)}s`);
    lockout(ms);
  }
  renderAll();
}

let lockTimer=null;
function lockout(ms){
  const buttons = document.querySelectorAll('[data-action="hack"]');
  buttons.forEach(b=>b.disabled=true);
  clearTimeout(lockTimer);
  lockTimer = setTimeout(()=>{ buttons.forEach(b=>b.disabled=false); state.heat = Math.max(0, state.heat-30); renderAll(); addLog('🧊 Verrou levé, chaleur -30%'); }, ms);
}

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

// Passive / cooldown
setInterval(()=>{
  const pm = programMods();
  if(pm.passiveIncome){ state.creds += pm.passiveIncome; renderKPIs(); }
},1000);
setInterval(()=>{
  if(state.heat>0){
    const extra = upgradeMods().heatDecayPerSec || 0;
    state.heat = Math.max(0, state.heat - (1 + extra));
    renderKPIs();
  }
}, 1500);

// Ticker UI (événements actifs)
setInterval(tickEventTicker, 300);

// Events
const EVENT_PERIOD = 12000;
setInterval(()=>{
  const pBase = Math.min(0.35, 0.05 + state.heat/300);
  const p = pBase * (upgradeMods().eventProbMul || 1);
  if(Math.random()<p){ spawnSecurityEvent(); }
}, EVENT_PERIOD);
function spawnSecurityEvent(){
  const defs = window.EVENT_DEFS || [];
  const now  = Date.now();

  // Fallback : ancien comportement si pas de JSON chargé
  if(!defs.length){
    const roll = Math.random();
    const corps = (window.TARGETS||[]).filter(t=>t.kind==='corp');
    if(roll<0.34){
      const c = corps[Math.floor(Math.random()*corps.length)];
      pushEvent(
        { type:'audit', corp:c.id, ends: now + 30000 },
        `📊 Audit sécurité chez <b>${c.name}</b> — GLACE renforcée (+10) pendant 30s`
      );
    } else if(roll<0.67){
      pushEvent(
        { type:'city_sweep', ends: now + 25000 },
        '🚨 Sweep réseau municipal — chaleur en cas d’échec +6 pendant 25s'
      );
    } else {
      const c = corps[Math.floor(Math.random()*corps.length)];
      pushEvent(
        { type:'bounty', corp:c.id, ends: now + 30000 },
        `💰 Prime temporaire sur <b>${c.name}</b> — récompenses x1.25, +2 chaleur par tentative, 30s`
      );
    }
    return;
  }

  // Tirage pondéré par "weight"
  let totalW = 0;
  for(const d of defs) totalW += Math.max(1, d.weight || 1);
  let r = Math.random() * totalW, chosen = defs[0];
  for (const d of defs){
    r -= Math.max(1, d.weight || 1);
    if(r <= 0){ chosen = d; break; }
  }

  const ends = now + (chosen.duration_ms || 30000);
  const ev = { id: chosen.id, type: chosen.id, ends };

  // Si scope "corp", lier une corpo et logger le message {corp}
  if(chosen.scope === 'corp'){
    const corps = (window.TARGETS||[]).filter(t=>t.kind==='corp');
    if(corps.length){
      const c = corps[Math.floor(Math.random()*corps.length)];
      ev.corp = c.id;
      const msg = (chosen.scope === 'corp')
      ? ((chosen.log && chosen.log.corp) ? chosen.log.corp.replace('{corp}', c.name) : `Événement ${chosen.name} chez ${c.name}`)
      : ((chosen.log && chosen.log.default) ? chosen.log.default : `Événement ${chosen.name}`);
    pushEvent(ev, msg); // ✅
    return;
    }
  }

  // Sinon (city/any)
  state.events.push(ev);
  const msg = (chosen.log && chosen.log.default)
    ? chosen.log.default
    : `Événement ${chosen.name}`;
  addLog(msg);
}

// Missions
function currentMission(){ return state.missions.active || null; }
function acceptChain(corpId){ state.missions.active = { corp: corpId, index:0 }; addLog(`📝 Mission acceptée — <b>${(window.TARGETS||[]).find(t=>t.id===corpId)?.name}</b>: ${(window.MISSION_CHAINS||{})[corpId][0].name}`); renderMissions(); persist(); }
function abandonMission(){ if(state.missions.active){ addLog('🗑️ Mission abandonnée'); state.missions.active=null; renderMissions(); persist(); } }
function missionStep(){ const m=currentMission(); if(!m) return null; return (window.MISSION_CHAINS||{})[m.corp][m.index]||null; }
function onHackSuccess(tid, sid){
  const step = missionStep(); 
  if(!step) return;
  if(step.objective.target===tid && step.objective.server===sid){
    const rw = step.reward;

    // ↓ multiplicateur missions (réglable via ECONOMY.missionMul)
    const missionMul = (typeof ECONOMY !== 'undefined' && ECONOMY.missionMul != null) ? ECONOMY.missionMul : 0.85;
    const credGain = Math.max(0, Math.round(rw.cred * missionMul));
    const repGain  = rw.rep;

    state.creds += credGain;
    state.rep   += repGain;

    addLog(`🏁 Mission accomplie: <b>${step.name}</b> +<b>${credGain}₵</b> <span class="text-slate-400 text-xs">×${missionMul}</span> (+${repGain} Rep)`);

    state.missions.active.index++;
    const chain = (window.MISSION_CHAINS||{})[state.missions.active.corp] || [];
    if(state.missions.active.index >= chain.length){
      addLog('🎖️ Chaîne terminée — toutes les missions complétées !');
      state.missions.active = null;
    }
    renderMissions();
    persist();
  }
}

// ====== Upgrades UI ======
function hasAllReq(node){
  const req = node.req||[];
  for(const id of req){ if(!state.upgrades.has(id)) return false; }
  return true;
}
function canUnlock(node){
  return !state.upgrades.has(node.id) && hasAllReq(node) && state.sp >= (node.sp||1);
}
function unlock(nodeId){
  const node = (window.UPGRADE_NODE_BY_ID||{})[nodeId]; if(!node) return;
  if(!canUnlock(node)) return;
  state.sp -= (node.sp||1);
  state.upgrades.add(node.id);
  addLog(`🔧 Upgrade débloqué: <b>${node.name}</b> (${(node.sp||1)} SP)`);
  renderAll(); persist();
}

function renderUpgrades(){
  const root = document.getElementById('upgrades'); if(!root) return;
  root.innerHTML='';

  const branches = window.UPGRADES || {};
  const container = document.createElement('div');
  container.className = 'grid grid-cols-1 md:grid-cols-3 gap-3';

  for(const [bid, branch] of Object.entries(branches)){
    const card = document.createElement('div'); card.className = CARD;
    const title = document.createElement('div');
    title.className = 'font-semibold text-cyan-300 mb-2';
    title.textContent = branch.name;
    card.appendChild(title);

    // group by tiers
    const tiers = window.getUpgradeTiers ? window.getUpgradeTiers(bid) : [];
    const col = document.createElement('div');
    col.className = 'space-y-2';

    tiers.forEach(({tier, nodes})=>{
      const box = document.createElement('div'); box.className='rounded-lg border border-white/10 p-2';
      const head = document.createElement('div'); head.className='text-slate-400 text-sm mb-1'; head.textContent = `Tier ${tier}`; box.appendChild(head);

      nodes.forEach(n=>{
        const owned = state.upgrades.has(n.id);
        const locked = !hasAllReq(n);
        const unlockable = canUnlock(n);
        const row = document.createElement('div'); row.className='flex items-start justify-between gap-3 rounded-md border border-white/10 bg-white/5 p-2';
        const left = document.createElement('div');
        left.innerHTML = `<b>${n.name}</b><div class="text-slate-400 text-sm">${n.desc}</div>`;
        const right = document.createElement('div'); right.className = 'flex items-center gap-2';
        const cost = document.createElement('span'); cost.className=PILL; cost.textContent = `${n.sp||1} SP`;
        right.appendChild(cost);
        const btn = document.createElement('button');
        btn.className = unlockable ? BTN_PRIMARY : BTN + ' opacity-60';
        btn.textContent = owned ? '✅' : (locked ? '🔐' : '💰');
        btn.disabled = !unlockable || owned;
        btn.onclick = ()=> unlock(n.id);
        right.appendChild(btn);
        row.appendChild(left); row.appendChild(right);

        if(owned){ row.classList.add('ring-1','ring-emerald-500'); }
        if(locked && !owned){ row.classList.add('opacity-70'); }
        box.appendChild(row);
      });

      col.appendChild(box);
    });

    card.appendChild(col);
    container.appendChild(card);
  }

  root.appendChild(container);
}

// ====== Render ======
function renderKPIs(){
  document.getElementById('kpi-creds').textContent = state.creds+'₵';
  document.getElementById('kpi-rep').textContent = Math.floor(state.rep);
  document.getElementById('kpi-heat').textContent = Math.round(state.heat)+'%';
  document.getElementById('kpi-sp').textContent = state.sp;
  renderSystemLoad();
  // refresh anneaux verts sans rerender complet
  updateStoreAffordability?.();
  updateProgramAffordability?.();

  // === Barre de chaleur animée ===
  const hb = document.getElementById('kpi-heatbar');
  if (hb) {
    const pct = clamp(Math.round(state.heat), 0, 100);
    hb.style.width = pct + '%';

    // Effet visuel selon seuils (glow/pulse quand c’est chaud)
    if (pct >= 90) {
      hb.style.boxShadow = '0 0 14px 4px rgba(239,68,68,.55)'; // rouge fort
      hb.classList.add('animate-pulse');
    } else if (pct >= 70) {
      hb.style.boxShadow = '0 0 10px 2px rgba(234,179,8,.45)'; // jaune
      hb.classList.remove('animate-pulse');
    } else {
      hb.style.boxShadow = 'none';
      hb.classList.remove('animate-pulse');
    }
  }
}

function renderSkills(){
  const root = document.getElementById('skills');
  root.innerHTML='';
  const canSpend = state.sp > 0;

  for (const [k,v] of Object.entries(state.skills)){
    const title = k.charAt(0).toUpperCase()+k.slice(1);

    const card = document.createElement('div');
    // carte “clippe” tout ce qui dépasse et sert d’ancre au bouton
    card.className = 'relative rounded-xl border border-white/10 bg-white/5 p-3 overflow-hidden min-h-[80px]';

    // contenu avec padding à droite pour laisser la place au +1 absolu
    card.innerHTML = `
      <div class="pr-16 min-w-0">
        <b class="block">${title}</b>
        <div class="text-slate-400 text-sm">lvl <span class="font-mono">${v.toFixed(2)}</span></div>
      </div>
      <button
        class="inline-flex items-center px-3 py-2 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 font-semibold whitespace-nowrap
               absolute right-2 top-1/2 -translate-y-1/2 ${canSpend ? '' : 'opacity-50 cursor-not-allowed'}"
        ${canSpend ? '' : 'disabled'}
        title="${canSpend ? '+1 point' : '0 point de compétence disponible'}"
        data-skill="${k}"
      >+1</button>
    `;

    card.querySelector('button').onclick = ()=>{ if(canSpend) spendPoint(k); };
    root.appendChild(card);
  }
}

function updateProgramAffordability(){
  document.querySelectorAll('#programs [data-buyprog]').forEach(btn=>{
    const pid = btn.getAttribute('data-buyprog');
    const p = (window.PROGRAMS||[]).find(x=>x.id===pid);
    if(!p) return;
    const affordable = state.creds >= (p.cost||0);
    btn.className = affordable ? BTN_SUCCESS : BTN_PRIMARY;
  });
}

function renderPrograms(){
  const cap = programSlots();
  const capEl = document.getElementById('progCap');
  if(capEl) capEl.textContent = `(${state.activePrograms.length}/${cap} slots)`;

  const apRoot = document.getElementById('activePrograms');
  apRoot.innerHTML='';
  if(state.activePrograms.length===0){
    const span=document.createElement('span'); span.className='text-slate-400'; span.textContent='—'; apRoot.appendChild(span);
  } else {
    state.activePrograms.forEach(pid=>{
      const p = (window.PROGRAMS||[]).find(x=>x.id===pid);
      const chip=document.createElement('div'); chip.className=PILL;
      chip.innerHTML = `${p?.name||pid} <button class="${BTN} ml-1" data-un="${pid}">Retirer</button>`;
      apRoot.appendChild(chip);
      chip.querySelector('[data-un]')?.addEventListener('click',()=>unequipProgram(pid));
    });
  }

  const root = document.getElementById('programs'); root.innerHTML='';
  (window.PROGRAMS||[]).forEach(p=>{
    const owned = state.programsOwned.has(p.id);
    const equipped = state.activePrograms.includes(p.id);
    const full = state.activePrograms.length >= cap;
    const el = document.createElement('div'); el.className=CARD;
    el.innerHTML = `<div><b>${p.name}</b> <div class="text-slate-400 text-sm">CPU ${p.cpu} — ${p.desc}</div></div>
      <div class="flex gap-2 mt-2">
        ${owned ? (
          equipped
            ? `<button class="${BTN}" data-un="${p.id}">Retirer</button>`
            : `<button class="${BTN_PRIMARY}" ${(full|| (cpuUsed()+p.cpu>cpuCapacity()))? 'disabled':''} data-eq="${p.id}">Charger</button>`
        ) : `<button class="${BTN_PRIMARY}" data-buyprog="${p.id}">💰 (${p.cost}₵)</button>`}
      </div>`;
    if(owned){
      if(equipped) el.querySelector('[data-un]')?.addEventListener('click',()=>unequipProgram(p.id));
      else el.querySelector('[data-eq]')?.addEventListener('click',()=>equipProgram(p.id));
    } else {
      el.querySelector('[data-buyprog]')?.addEventListener('click',()=>learnProgram(p.id));
    }
    root.appendChild(el);
  });
}

function renderGearInstalled(){
  const root = document.getElementById('gearInstalled'); root.innerHTML='';
  const slots = [ ['deck','Deck'], ['console','Console'], ['implant','Implant'] ];
  for (const [key,label] of slots){
    const id = state.gearInstalled[key];
    const item = itemById(id);
    const div = document.createElement('div'); div.className=PILL;
    div.innerHTML = `<span class="text-slate-400">${label}:</span> ${item? item.name:'—'}`;
    root.appendChild(div);
  }
  const mods = state.gearInstalled.mods.map(id=>itemById(id)?.name).filter(Boolean);
  const tools = state.gearInstalled.tools.map(id=>itemById(id)?.name).filter(Boolean);
  const divMods = document.createElement('div'); divMods.className=PILL; divMods.innerHTML = `<span class="text-slate-400">Mods:</span> ${mods.join(', ')||'—'}`; root.appendChild(divMods);
  const divTools = document.createElement('div'); divTools.className=PILL; divTools.innerHTML = `<span class="text-slate-400">Outils:</span> ${tools.join(', ')||'—'}`; root.appendChild(divTools);
}

function serverLine(t, s){
  const wrap = document.createElement('div');
  wrap.className = 'grid grid-cols-[1fr_auto] gap-2 items-center';
  const known = state.discovered[s.id];
  const um = upgradeMods();
  const pct = known? (um.showScanExact? ( (known*100).toFixed(1) + '%' ) : (Math.round(known*100)+'%') ) : '?';
  wrap.innerHTML = `<div>
      <div><b>${s.name}</b> <span class="text-slate-400 text-sm">lvl ${s.level}</span></div>
      <div class="text-slate-400 text-sm">GLACE: ${s.ice.join(', ')}</div>
      <div class="${PROGRESS_OUTER}"><span class="${PROGRESS_INNER}" style="width:${known? Math.round(known*100):0}%"></span></div>
    </div>
    <div class="flex gap-2">
      <button class="${BTN}" data-scan>Scanner</button>
      <button class="${BTN_PRIMARY}" data-action="hack">Pirater (${pct})</button>
    </div>`;
  wrap.querySelector('[data-scan]').onclick = ()=>scan(t.id, s.id);
  wrap.querySelector('[data-action="hack"]').onclick = ()=>hack(t.id, s.id);
  return wrap;
}

function renderTargets(){
  const root = document.getElementById('targets');

  if(!document.getElementById('targetsToolbar')){
    const bar = document.createElement('div');
    bar.id='targetsToolbar'; bar.className='flex flex-wrap gap-2 mb-2';
    const openBtn=document.createElement('button'); openBtn.className=BTN; openBtn.textContent='Tout ouvrir';
    const closeBtn=document.createElement('button'); closeBtn.className=BTN; closeBtn.textContent='Tout fermer';
    openBtn.onclick=()=>{ root.querySelectorAll('details[data-id]').forEach(d=>d.open=true); saveOpenTargets(); };
    closeBtn.onclick=()=>{ root.querySelectorAll('details[data-id]').forEach(d=>d.open=false); saveOpenTargets(); };
    root.parentElement.insertBefore(bar, root);
    bar.appendChild(openBtn); bar.appendChild(closeBtn);
  }

  const prevOpen = new Set();
  root.querySelectorAll('details[data-id]')?.forEach(det=>{ if(det.open) prevOpen.add(det.dataset.id); });
  const stored = (()=>{ try { return new Set(JSON.parse(localStorage.getItem(OPEN_TARGETS_KEY)||'[]')); } catch(e){ return new Set(); } })();
  const baseOpen = prevOpen.size ? prevOpen : stored;

  root.innerHTML='';
  (window.TARGETS||[]).forEach(t=>{
    const det = document.createElement('details');
    det.dataset.id = t.id;
    det.open = baseOpen.size ? baseOpen.has(t.id) : (t.id==='city');
    det.className = CARD + ' [&_summary]:cursor-pointer [&_summary]:text-cyan-300 [&_summary]:font-semibold';
    const sum = document.createElement('summary'); sum.textContent = `${t.name}`; det.appendChild(sum);
    const box = document.createElement('div'); box.className='mt-2 space-y-2';
    t.servers.forEach(s=> box.appendChild( serverLine(t,s) ));
    det.appendChild(box);
    det.addEventListener('toggle', saveOpenTargets);
    root.appendChild(det);
  });
  saveOpenTargets();

  function saveOpenTargets(){
    const ids=[...root.querySelectorAll('details[data-id]')].filter(d=>d.open).map(d=>d.dataset.id);
    localStorage.setItem(OPEN_TARGETS_KEY, JSON.stringify(ids));
  }
}

function renderMissions(){
  const root = document.getElementById('missions'); if(!root) return;

  if(!document.getElementById('missionsToolbar')){
    const bar = document.createElement('div');
    bar.id='missionsToolbar'; bar.className='flex flex-wrap gap-2 mb-2';
    const openBtn=document.createElement('button'); openBtn.className=BTN; openBtn.textContent='Tout ouvrir';
    const closeBtn=document.createElement('button'); closeBtn.className=BTN; closeBtn.textContent='Tout fermer';
    openBtn.onclick=()=>{ root.querySelectorAll('details[data-id]').forEach(d=>d.open=true); saveOpenMissions(); };
    closeBtn.onclick=()=>{ root.querySelectorAll('details[data-id]').forEach(d=>d.open=false); saveOpenMissions(); };
    root.parentElement.insertBefore(bar, root);
    bar.appendChild(openBtn); bar.appendChild(closeBtn);
  }

  const prevOpen = new Set();
  root.querySelectorAll('details[data-id]')?.forEach(det=>{ if(det.open) prevOpen.add(det.dataset.id); });
  const stored = (()=>{ try { return new Set(JSON.parse(localStorage.getItem(OPEN_MISSIONS_KEY)||'[]')); } catch(e){ return new Set(); } })();
  const baseOpen = prevOpen.size ? prevOpen : stored;

  root.innerHTML='';
  const m = currentMission();
  for (const cid of Object.keys(window.MISSION_CHAINS||{})){
    const det = document.createElement('details');
    det.dataset.id = cid;
    det.open = baseOpen.size ? baseOpen.has(cid) : (!m || (m && m.corp===cid));
    det.className = CARD + ' [&_summary]:cursor-pointer [&_summary]:text-cyan-300 [&_summary]:font-semibold';
    const corp = (window.TARGETS||[]).find(t=>t.id===cid);
    const sum = document.createElement('summary'); sum.textContent = corp?.name || cid; det.appendChild(sum);
    const box = document.createElement('div'); box.className='mt-2 space-y-2';
    const chain = (window.MISSION_CHAINS||{})[cid];
    const li = document.createElement('div'); li.className='space-y-1';
    chain.forEach((step,i)=>{
      const status = m && m.corp===cid && m.index>i ? '✅' : (m && m.corp===cid && m.index===i ? '▶️' : '•');
      const row = document.createElement('div'); row.className='flex gap-2';
      row.innerHTML = `<div>${status} <b>${step.name}</b> — <span class="text-slate-400 text-sm">objectif: ${step.objective.server}</span> <span class="${PILL}">${step.reward.cred}₵ · +${step.reward.rep} Rep</span></div>`;
      li.appendChild(row);
    });
    box.appendChild(li);
    const controls = document.createElement('div'); controls.className='flex gap-2 mt-2';
    if(!m){
      const btn=document.createElement('button'); btn.className=BTN + ' ring-1 ring-cyan-400/40'; btn.textContent='Accepter la chaîne'; btn.onclick=()=>acceptChain(cid); controls.appendChild(btn);
    } else if(m && m.corp===cid){
      const btn=document.createElement('button'); btn.className=BTN; btn.textContent='Abandonner'; btn.onclick=()=>abandonMission(); controls.appendChild(btn);
    }
    box.appendChild(controls);
    det.appendChild(box);
    det.addEventListener('toggle', saveOpenMissions);
    root.appendChild(det);
  }
  saveOpenMissions();

  function saveOpenMissions(){
    const ids=[...root.querySelectorAll('details[data-id]')].filter(d=>d.open).map(d=>d.dataset.id);
    localStorage.setItem(OPEN_MISSIONS_KEY, JSON.stringify(ids));
  }
}

function updateStoreAffordability(){
  document.querySelectorAll('#store [data-buy]').forEach(btn=>{
    const id = btn.getAttribute('data-buy');
    const it = itemById(id); if(!it) return;
    const owned   = state.gearOwned.has(id);
    const blocked = it.requires && !it.requires.every(r=>state.gearOwned.has(r));
    const affordable = !owned && !blocked && state.creds >= (it.cost||0);

    btn.className = owned
      ? BTN + ' opacity-60 cursor-default'
      : blocked
      ? BTN + ' opacity-60 cursor-not-allowed'
      : (affordable ? BTN_SUCCESS : BTN_PRIMARY);

    // synchro de l’anneau de l’image si présente
    const cardEl = btn.closest('.rounded-xl') || btn.closest('[data-card]') || btn.closest('div')?.parentElement;
    const img = cardEl?.querySelector(`[data-itemimg="${id}"]`);
    if(img){
      img.classList.remove('ring-emerald-500','ring-emerald-400/60','ring-cyan-400/40');
      img.classList.add( owned ? 'ring-emerald-500' : (affordable ? 'ring-emerald-400/60' : 'ring-cyan-400/40') );
    }
  });
}

function renderStore(){
  const root = document.getElementById('store'); root.innerHTML='';
  (window.STORE_ITEMS||[]).forEach(it=>{
    const owned = state.gearOwned.has(it.id);
    const blocked = it.requires && !it.requires.every(r=>state.gearOwned.has(r));
    const affordable = !owned && !blocked && state.creds >= (it.cost||0);

    const card = document.createElement('div'); card.className = CARD;
    const bonuses = Object.entries(it.bonuses||{}).map(([k,v])=>`${k}${v>=0?'+':''}${v}`).join(' · ');
    const type = it.type.toUpperCase();

    const imgRing = owned
      ? 'ring-emerald-500'
      : (affordable ? 'ring-emerald-400/60' : 'ring-cyan-400/40');

    const btnClass = owned
      ? BTN + ' opacity-60 cursor-default'
      : blocked
      ? BTN + ' opacity-60 cursor-not-allowed'
      : (affordable ? BTN_SUCCESS : BTN_PRIMARY);

    const btnLabel = owned ? '✅' : (blocked ? 'Requis' : '💰');

    card.innerHTML = `<div class="text-slate-400 text-sm">${type}</div>
      <div class="flex items-center justify-between">
        <p>${it.name}</p>
        ${it.image ? `<img src="${it.image}" alt="${it.name}"
             class="max-w-[64px] rounded ring-1 mx-2 ${imgRing}" data-itemimg="${it.id}">` : ''}
      </div>
      <div class="text-slate-400 text-sm">${bonuses||'—'}</div>
      <div class="flex items-center justify-between mt-2">
        <span class="font-mono">${it.cost||0}₵</span>
        <button class="${btnClass}" ${owned||blocked? 'disabled':''}
                data-buy="${it.id}" data-cost="${it.cost||0}">${btnLabel}</button>
      </div>`;

    card.querySelector('[data-buy]')?.addEventListener('click',()=>buy(it.id));
    root.appendChild(card);
  });
}

function renderAll(){
  renderKPIs(); renderSkills(); renderPrograms(); renderGearInstalled();
  renderStore(); renderTargets(); renderMissions(); renderUpgrades();
  renderEventTicker(); // ✅ AJOUT
  persist();
}

// ====== Save/Load ======
function persist(){
  const o = { ...state, gearOwned:[...state.gearOwned], programsOwned:[...state.programsOwned], upgrades:[...state.upgrades] };
  localStorage.setItem(SAVE_KEY, JSON.stringify(o));
}
function restore(){
  try{
    const raw = localStorage.getItem(SAVE_KEY); if(!raw) return;
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
    state.farmHistory    = o.farmHistory || {};
    addLog('💾 Sauvegarde chargée');
  }catch(e){ console.warn(e); }
}

// ====== Boot (attend DATA_READY) ======
window.addEventListener('DATA_READY', ()=>{
  document.getElementById('saveBtn').onclick=()=>{ persist(); addLog('💾 Sauvegardé'); };
  document.getElementById('resetBtn').onclick=()=>{ ['cyber_netrunner_save_v4','cyber_netrunner_save_v5', SAVE_KEY, OPEN_TARGETS_KEY, OPEN_MISSIONS_KEY, OPEN_UPGRADES_KEY].forEach(k=>localStorage.removeItem(k)); location.reload(); };
  restore();
  renderAll();
  addLog('Bienvenue, runner. Upgrades disponibles dans le nouveau panneau.');
});

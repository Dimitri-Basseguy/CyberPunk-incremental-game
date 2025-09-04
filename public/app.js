// app_json.js — data-driven version + Upgrades UI/effects
const BTN = 'inline-flex items-center px-2 py-1 rounded-lg border border-white/15  hover:bg-white/15 font-semibold cursor-pointer transition ease-in-out';
const BTN_SMALL = 'inline-flex items-center px-1 py-1 rounded-lg border border-white/15  hover:bg-white/15 font-semibold cursor-pointer transition ease-in-out';
const BTN_PRIMARY = BTN + ' ring-1 ring-cyan-400/40 hover:ring-cyan-300/60';
const BTN_SUCCESS = BTN + ' ring-1 ring-emerald-400/60 hover:ring-green-400/70 bg-emerald-500/20 hover:ring-2 shadow-lg shadow-green-400/80'; // ✅ vert si achetable
const BTN_SUCCESS_SMALL = BTN_SMALL + ' ring-1 ring-emerald-400/60 hover:ring-green-400/70 bg-emerald-500/20 hover:ring-2 shadow-lg shadow-green-400/80'; // ✅ vert si achetable
const CARD = 'rounded-xl border border-white/10 bg-white/5 p-2';
const PILL = 'inline-flex items-center gap-1.5 px-1 py-0.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 text-xs';
const PROGRESS_OUTER = 'h-2 bg-white/10 rounded-full overflow-hidden mt-1.5';
const PROGRESS_INNER = 'block h-full bg-gradient-to-r from-neon-cyan to-neon-fuchsia';

// === i18n (FR/EN) minimal ===
const SUPPORTED_LANGS = ['fr','en'];
const DEFAULT_LANG = 'fr';
const I18N_PATH = './i18n';

let I18N = { lang: DEFAULT_LANG, dict: {} };

function _browserLang(){
  const l = (navigator.language||'fr').slice(0,2).toLowerCase();
  return SUPPORTED_LANGS.includes(l) ? l : DEFAULT_LANG;
}

async function loadDict(lang){
  try{
    const res = await fetch(`${I18N_PATH}/${lang}.json`, { cache:'no-store' });
    const json = await res.json();
    I18N.dict = json;
    I18N.lang = lang;
    document.documentElement.setAttribute('lang', lang);
  }catch(e){
    I18N.dict = {};
    I18N.lang = lang;
  }
}
/**
 * Traduire une clé i18n en fonction de la langue active
 * @param {*} key 
 * @param {*} vars 
 * @returns 
 */
function t(key, vars={}){
  let cur = I18N.dict;
  for(const part of key.split('.')) cur = cur?.[part];
  let s = (typeof cur === 'string') ? cur : key;
  s = s.replace(/\{(\w+)\}/g, (_,k)=> (k in vars ? String(vars[k]) : `{${k}}`));
  return s;
}

// Accepte :
//  - string "texte brut"
//  - string "@clé.i18n" (traduction via dictionnaire)
//  - { fr: "...", en: "..." } (objet multilingue)
//  - fallback => valeur brute
function i18nText(v){
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const lang = (I18N?.lang || DEFAULT_LANG);
    return v[lang] ?? v[DEFAULT_LANG] ?? Object.values(v)[0] ?? '';
  }
  if (typeof v === 'string') {
    if (v.startsWith('@')) return tr(v.slice(1));
    return v;
  }
  return (v==null) ? '' : String(v);
}

async function setLang(lang){
  if(!SUPPORTED_LANGS.includes(lang)) lang = DEFAULT_LANG;
  await loadDict(lang);
  try{ localStorage.setItem('lang', lang); }catch(e){}
  applyI18nToDom();
  renderLangSwitch();
  // Re-render pour textes générés côté JS
  renderAll?.();
}

async function initI18n(){
  const fromUrl = new URLSearchParams(location.search).get('lang');
  const fromLS  = (()=>{ try{ return localStorage.getItem('lang'); }catch(e){ return null; }})();
  const first = fromUrl || fromLS || _browserLang();
  await loadDict(first);
}

function applyI18nToDom(){
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    el.textContent = t(el.getAttribute('data-i18n'));
  });
}

function renderLangSwitch(){
  let host = document.getElementById('langSwitch');
  if(!host){
    host = document.createElement('div');
    host.id = 'langSwitch';
    host.className = 'fixed top-2 right-2 z-50';
    document.body.appendChild(host);
  }
  // 🇫🇷 🇬🇧
  host.innerHTML = `
    <div class="inline-flex gap-2 p-1">
      <button class="${BTN} ${I18N.lang==='fr'?'ring-1 ring-cyan-400/60':''}" data-lang="fr">🇫🇷</button>
      <button class="${BTN} ${I18N.lang==='en'?'ring-1 ring-cyan-400/60':''}" data-lang="en">🇬🇧</button>
    </div>
  `;
  host.querySelectorAll('[data-lang]').forEach(b=>{
    b.onclick = ()=> setLang(b.getAttribute('data-lang'));
  });
}

// Storage keys
const OPEN_TARGETS_KEY = 'open_targets_v1';
const OPEN_MISSIONS_KEY = 'open_missions_v1';
const OPEN_UPGRADES_KEY = 'open_upgrades_v1';

// — Représailles (chance + dégâts)
const RETALIATION = {
  // Probabilité de base
  base: 0.20,            // 20% de base
  perLevel: 0.04,        // +4% par niveau de serveur
  heatBonusFrom: 30,     // bonus si chaleur > 30%
  heatBonusPer20: 0.06,  // +6% par tranche de 20% au-dessus du seuil
  corpMul: 1.15,         // corpos +15%
  cityMul: 1.00,         // ville neutre
  stealthMitigationPerLvl: 0.008, // -0.8% par point de Stealth
  min: 0.08,             // plancher 8%
  max: 0.75,             // plafond 75%

  // Dégâts
  heatDmg: { base: 8, perLevel: 3, cityMul: 1.10, corpMul: 1.00 },
  credDmg: { asPctOfGainMin: 0.35, asPctOfGainMax: 0.65, floor: 15, capPctOfWallet: 0.20 },
  repDmg:  { city: 0, corpMin: 1 }, // corpMin + floor(level/3)

  // Pression d’activité (augmente chance & dégâts selon le SPAM récent)
  pressureWindowMs: 5*60*1000,   // regarde les tentatives de hack des x dernières minutes
  pressurePerAttempt: 0.02,       // +2% de chance par tentative récente sur la même cible
  streakThreshold: 5,             // à partir de 5 tentatives dans la fenêtre…
  streakBonus: 0.10,              // …+10% de chance en plus (one-shot)
  dmgPressureMulPerAttempt: 0.03  // dégâts ×(1 + 3% * nb tentatives récentes) (capé plus bas)
};

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

// — Traceur (représailles liées aux SCANS répétés)
const TRACE = {
  windowMs: 8*60*1000,     // on observe les scans sur 8 min
  base: 0.10,              // 10% de base
  perScan: 0.06,           // +6% par scan récent (même cible)
  heatBonusFrom: 35,       // bonus de proba au-dessus de 35% chaleur
  heatPer20Bonus: 0.05,    // +5% par tranche de 20% au-dessus du seuil
  corpMul: 1.10,           // corpos un peu + agressives
  cityMul: 0.90,           // ville un peu – agressive
  maxP: 0.80,              // plafonné à 80%

  // sévérité par volume de scans récents (≈ escalade)
  levelByAttempts: [0,1,1,2,2,3,3,3], // indexé par nb de scans récents
  durationsMs: {1:45000, 2:70000, 3:100000}, // durée par niveau

  // effets de trace (appliqués via activeEventMods)
  effects: {
    icePerLevel: 5,               // +5 GLACE par niveau
    chanceMinusPerLevel: 0.05,    // -5 pts de % par niveau
    heatAttemptAddPerLevel: 2     // +2% chaleur par tentative par niveau
  },

  // “contre-mesure” immédiate quand on scanne sous trace
  scanPanic: {
    p: 0.20,                       // 20% de chance
    heatSpike: {1:6, 2:10, 3:14},  // pic de chaleur
    lockoutMs: {1:2000, 2:3500, 3:5000} // mini-verrou
  }
};

// — Fortification adaptative (quand on frôle 95 %)
const ADAPTIVE = {
  triggerAt: 0.90,          // seuil pour fortifier (chance observée)
  scanTriggerAt: 0.95,      // seuil via scan
  onScanChance: 0.70,       // 60% de chances de fortifier dès un scan à 95%
  icePerLevel: 10,          // +GLACE par niveau de fortification
  cooldownMs: 5*60*1000,    // au max 1 up toutes les 5 min par serveur
  maxLevels: 10,            // plafond
  minDrop: 0.05,            // viser au moins -2 pts en sortie de rafale
  maxBurstLevels: 3,        // max niveaux d'un coup
  maxBurstLevels: 4,        // rafales possibles plus longues
  mulPerLevel: 0.94,        // pénalité multiplicative sur la réussite par niveau
  capDropPerLevel: 0.03,    // baisse du plafond max par niveau (ex: L5 => -15 pts)
  log: true,
};

// === INCREMENTAL: config des générateurs “ticks” ===
const INC = {
  gens: [
    { id:'cron',    name:'Cron job',                base: 10,     mul: 1.15, tps: 0.10 },
    { id:'microbot',name:'Micro-bot',               base: 60,     mul: 1.15, tps: 0.50 },
    { id:'botnet',  name:'Nœud botnet',             base: 400,    mul: 1.15, tps: 1 },
    { id:'daemon',  name:'Daemon planificateur',    base: 2600,   mul: 1.15, tps: 2.5 },
    { id:'quantum', name:'Planif. quantique',       base: 4100,  mul: 1.15, tps: 5 }
  ]
};

const RP_PER_TOKEN = 0.1;     // 1 token => 0.1 RP
const INC_CONVERT_DEFAULT = 5; // quantité par défaut dans les inputs de conversion

// === INCREMENTAL: type de loot créé lors de la conversion ===
const TOKEN_LOOT = {
  id: 'loot_tokens',
  name: 'Tokens minés',
  base: 0.01 // 0.01$ / unité (les fractions s'agrègent à la vente)
};

// — Marché noir (prix = base × (1 + rep*coef), plafonné)
const BLACK_MARKET = {
  repBonusPerPoint: 0.02,   // +2% par point de Réputation
  repBonusCap: 1.00         // bonus max +100%
};

// ====== State ======
const state = {
  creds: 120,
  rep: 0,
  heat: 0,
  xp: 0,
  sp: 0,
  rp: 0, // points de recherche
  researched: new Set(),     // nœuds d'upgrade déjà "recherchés"
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
  attemptHistory: {}, // { targetId: [timestamps] }
  scanHistory: {}, // { targetId: [timestamps] }
  hardening: {}, // { serverId: { lvl:number, last:timestamp } }
  loot: {}, // { lootId: { name:string, base:number, qty:number } }
};

// ====== Helpers ======
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const itemById=(id)=> (window.ITEM_BY_ID||{})[id] || null;

function getHardeningLvl(serverId){
  const h = state.hardening?.[serverId];
  return h ? (h.lvl||0) : 0;
}

function bumpHardeningIfNeeded(target, server, observedChance, reason='mise à jour'){
  const now = Date.now();
  const id  = server.id;
  const h   = state.hardening[id] || { lvl:0, last:0 };

  if (observedChance < (ADAPTIVE.triggerAt - 1e-6)) return false;
  if (h.lvl >= ADAPTIVE.maxLevels)                 return false;
  if (now - h.last < ADAPTIVE.cooldownMs)          return false;

  let applied = 0;
  do {
    h.lvl += 1;
    applied += 1;
    state.hardening[id] = h; // appliquer temporairement pour mesurer l'effet réel
    const newChance = computeSuccess(server, target);
    // on arrête si on est passé sous (95% - minDrop) ou si on a atteint les limites
    if (newChance < (ADAPTIVE.triggerAt - (ADAPTIVE.minDrop||0.02))) break;
  } while (applied < (ADAPTIVE.maxBurstLevels||1) && h.lvl < ADAPTIVE.maxLevels);

  h.last = now;

  if (ADAPTIVE.log){
    addLog(`🛡️ <b>${target.name} › ${server.name}</b> — ${t('logs.fortification')} ${reason} (${t('logs.ice_text')} +${ADAPTIVE.icePerLevel*applied}, L${h.lvl})`);
  }

  // re-calcul immédiat de la chance connue (si scannée)
  if (server.id in state.discovered){
    state.discovered[server.id] = computeSuccess(server, target);
  }
  renderTargets?.();
  return true;
}

function ensureSkillsState(){
  const defs = (window.SKILLS && window.SKILLS.skills) || [];
  if (!defs.length) return;
  const next = {};
  defs.forEach(s=>{
    const start = (typeof s.start === 'number') ? s.start : 1;
    next[s.id] = (state.skills && typeof state.skills[s.id]==='number') ? state.skills[s.id] : start;
  });
  state.skills = next;
}

function repSellMultiplier(){
  const b = BLACK_MARKET;
  const bonus = Math.min(b.repBonusCap, (state.rep || 0) * b.repBonusPerPoint);
  return 1 + Math.max(0, bonus);
}

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

  const hardLvl = getHardeningLvl(server.id);
  const iceBaseNoBypass = server.level*12 + server.ice.reduce((s,n)=>s+(ICE[n]?.strength||0),0);  
  const iceBase = Math.max(0, iceBaseNoBypass - (bypassStrength||0));
  const ev = activeEventMods(target);
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

  
  if (ADAPTIVE.mulPerLevel) {
    chance *= Math.pow(ADAPTIVE.mulPerLevel, hardLvl);
  }
  const maxCap = 0.95 - (hardLvl * (ADAPTIVE.capDropPerLevel || 0));
  const cap = Math.max(0.65, (isFinite(maxCap) ? maxCap : 0.95));
  return clamp(chance, 0.05, cap);
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

// ====== LOOT ======
function rollLoot(target, server){
  const table = (server?.reward?.loot) || [];
  const out = [];
  for (const e of table){
    const p = (typeof e.p === 'number') ? e.p : 1;
    if (Math.random() < p){
      const q = Array.isArray(e.q) ? e.q : [1,1];
      const min = Math.max(0, Math.floor(q[0]||1));
      const max = Math.max(min, Math.floor(q[1]||min));
      const qty = min === max ? min : (min + Math.floor(Math.random()*(max-min+1)));
      out.push({ id:e.id, name:e.name, base:e.base||1, qty });
    }
  }
  return out;
}

function addLootItem(id, name, base, qty){
  if(!state.loot) state.loot = {};
  const cur = state.loot[id] || { id, name, base: Number(base)||1, qty:0 };
  cur.qty += qty;
  state.loot[id] = cur;
}

function lootUnitPrice(base, asFloat=false){
  // autorise les valeurs < 1$ ; la réputation s'applique aussi
  const repMul = 1 + Math.max(0, state.rep)*0.02;
  const val = (Number(base)||1) * repMul;
  return asFloat ? val : Math.round(val); // version entière si besoin ailleurs
}
function lootUnitText(base){
  const v = lootUnitPrice(base, true);
  const txt = v.toFixed(2);
  return txt + '$';
}

function sellLoot(id, qty=null){
  const it = state.loot?.[id]; if(!it) return;
  const n = (qty==null) ? it.qty : Math.max(0, Math.min(it.qty, qty));
  if(n<=0) return;

  // prix unitaire en float (peut être < 1)
  const unit = lootUnitPrice(it.base, true);
  const gain = Math.round((unit * n) * 100) / 100; // arrondi 2 décimales

  state.creds = Math.round((state.creds + gain) * 100) / 100;
  it.qty -= n;
  if(it.qty<=0) delete state.loot[id];

  addLog(`🧾 ${t('logs.sell_text')}: ${n}× <b>${it.name}</b> → <b>${gain}$</b> <span class="text-slate-400 text-xs">(${lootUnitText(it.base)}/u)</span>`);
  renderAll();
}

function sellAllLoot(){
  if(!state.loot) return;
  let gain=0, parts=[];
  for (const [id,it] of Object.entries(state.loot)){
    const unit = lootUnitPrice(it.base, true);
    gain += unit * it.qty;
    parts.push(`${it.qty}× ${it.name}`);
  }
  gain = Math.round(gain * 100) / 100;
  if(gain<=0){ addLog('— Rien à vendre —'); return; }
  state.creds = Math.round((state.creds + gain) * 100) / 100;
  state.loot = {};
  addLog(`🧾 ${t('logs.sell_all_text')}: ${parts.join(', ')} → <b>${gain}$</b>`);
  renderAll();
}


function renderLoot(){
  const root = document.getElementById('loot');
  if(!root) return; // si le conteneur n’existe pas dans le HTML, on ne fait rien
  root.innerHTML = '';

  const items = Object.values(state.loot||{});
  const card = document.createElement('div');
  card.className = 'rounded-xl border border-white/10 bg-white/5 p-2';

  const head = document.createElement('div');
  head.className = 'flex items-center justify-between mb-1';
  head.innerHTML = `<b class="text-cyan-300">${t('ui.loot')}</b>
    <div class="flex gap-2">
      <button class="${BTN}" data-sellall>${t('ui.sell_all')}</button>
    </div>`;
  card.appendChild(head);

  if(items.length===0){
    const p = document.createElement('p');
    p.className = 'text-slate-400 text-xs';
    p.textContent = '— Vide —';
    card.appendChild(p);
  } else {
    const list = document.createElement('div');
    // Grille responsive + toutes les rangées ont la même hauteur
    list.className = 'grid grid-cols-3 md:grid-cols-6 gap-2 auto-rows-[minmax(0,1fr)] text-xs';
    // Fallback au cas où ta version de Tailwind n’accepte pas l’arbitrary value
    list.style.gridAutoRows = 'minmax(0,1fr)';

    for (const it of items){
      const unitText = lootUnitText(it.base);
      const row = document.createElement('div');
      // Tuile qui occupe toute la hauteur de sa rangée
      row.className = 'h-full flex flex-col justify-between items-center rounded border border-white/10 bg-white/5 p-2';

      row.innerHTML = `
        <div class="flex-1 min-h-0">
          <b class="block leading-tight">${it.name}</b>
          <div class="text-slate-400 text-sm">x${it.qty} · ${unitText}/u</div>
        </div>
        <div class="mt-2">
          <button class="${BTN} w-full" data-sell="${it.id}">Vendre</button>
        </div>
      `;

      row.querySelector('[data-sell]')?.addEventListener('click',()=>sellLoot(it.id, it.qty));
      list.appendChild(row);
    }
    card.appendChild(list);
  }

  card.querySelector('[data-sellall]')?.addEventListener('click', sellAllLoot);
  root.appendChild(card);
}

function addLog(msg){
  const el = document.getElementById('log');
  const p = document.createElement('p'); p.innerHTML = msg; el.prepend(p);
}

function pushEvent(ev, logMsg){
  state.events.push(ev);
  if (logMsg) {
    // Si le logMsg ressemble à une clé d'événement, on le traduit
    if (logMsg.startsWith('events.')) {
      // On tente de passer le nom de la corpo si présent dans l'événement
      let corpName = '';
      if (ev.corp) {
        const corp = (window.TARGETS||[]).find(t => t.id === ev.corp);
        if (corp) corpName = corp.name;
      }
      addLog(t(logMsg, { corp: corpName }));
    } else {
      addLog(t(logMsg));
    }
  }
  // force un refresh immédiat du ticker pour éviter le libellé générique
  if (typeof renderEventTicker === 'function') renderEventTicker();
}

// Pression des événements (audit/sweep/bounty) sur représailles
function maybeTraceOnScan(target){
  const now = Date.now();
  // mémoriser le scan et purger la fenêtre
  (state.scanHistory[target.id] ||= []).push(now);
  state.scanHistory[target.id] = state.scanHistory[target.id].filter(ts => now - ts < TRACE.windowMs);

  const attempts = state.scanHistory[target.id].length;
  // probabilité d’armement du traceur
  let p = TRACE.base + Math.max(0, attempts-1) * TRACE.perScan;
  if(state.heat > TRACE.heatBonusFrom){
    const blocks = Math.floor((state.heat - TRACE.heatBonusFrom)/20)+1;
    p += blocks * TRACE.heatPer20Bonus;
  }
  p *= (target.kind==='corp') ? TRACE.corpMul : TRACE.cityMul;
  p = clamp(p, 0, TRACE.maxP);

  if(Math.random() < p){
    // déterminer/mettre à jour le niveau et la durée
    const lvl = Math.min(3, TRACE.levelByAttempts[Math.min(attempts, TRACE.levelByAttempts.length-1)] || 1);
    const ends = now + (TRACE.durationsMs[lvl] || 60000);

    // chercher un traceur existant pour cette cible
    const existing = state.events.find(e =>
      e.type==='trace' && (
        (target.kind==='corp' && e.corp===target.id) ||
        (target.kind==='city' && !e.corp)
      )
    );

    if(existing){
      existing.level = Math.max(existing.level||1, lvl);
      existing.start = existing.start || now;
      existing.ends  = Math.max(existing.ends, ends);
    } else {
      const ev = { type:'trace', start: now, ends, level: lvl };
      if(target.kind==='corp') ev.corp = target.id;
      state.events.push(ev);
    }

    addLog(`🎯 ${t('logs.tracer_active_text')} <b>${t(target.name)}</b> — ${t('logs.level_text')} ${lvl}. ${t('logs.scan_risk_text')}.`);
    renderEventTicker?.();

    // contre-mesure instantanée (pic de chaleur + mini-verrou) : conditionnelle
    const panic = TRACE.scanPanic;
    if(Math.random() < panic.p){
      const L = (existing?.level) || lvl;
      const spike = panic.heatSpike[L] || 6;
      const heatCap = 100 - (upgradeMods().heatCapMinus||0);
      state.heat = Math.min(heatCap, state.heat + spike);
      addLog(`⚡ ${t('logs.countermeasure_detected_text')} — +${spike}% ${t('logs.heat_text')}`);
      if(typeof lockout === 'function'){ lockout(panic.lockoutMs[L] || 2000); }
    }
  }
}

function _retaliationEventPressure(target){
  const now = Date.now();
  let chanceAdd = 0, heatMul = 1, credMul = 1;

  for (const e of state.events){
    if (e.ends && e.ends <= now) continue;
    if (e.type === 'audit' && target.kind==='corp' && (!e.corp || e.corp===target.id)){
      chanceAdd += 0.12; heatMul *= 1.15;
    }
    if (e.type === 'city_sweep' && target.kind==='city'){
      chanceAdd += 0.12; heatMul *= 1.40;
    }
    if (e.type === 'bounty' && target.kind==='corp' && (!e.corp || e.corp===target.id)){
      chanceAdd += 0.10; credMul *= 1.20;
    }
  }
  return { chanceAdd, heatMul, credMul };
}

// Probabilité de représailles (inclut pression d’activité)
function _retaliationChance(target, server){
  const R = RETALIATION;
  const um = upgradeMods?.() || {};
  let p = R.base + server.level * R.perLevel;

  // bonus si chaleur élevée
  if (state.heat > R.heatBonusFrom){
    const blocks = Math.floor((state.heat - R.heatBonusFrom)/20) + 1;
    p += blocks * R.heatBonusPer20;
  }

  // ville/corpo
  p *= (target.kind === 'corp') ? R.corpMul : R.cityMul;

  // mitigation par Stealth
  p -= (state.skills.stealth || 0) * R.stealthMitigationPerLvl;

  // pression d’événements
  const ev = _retaliationEventPressure(target);
  p += ev.chanceAdd;

  // pression d’activité (tentatives récentes sur CETTE cible)
  const now = Date.now();
  const attempts = (state.attemptHistory[target.id] || []).filter(ts => now - ts < R.pressureWindowMs).length;
  p += attempts * R.pressurePerAttempt;
  if (attempts >= R.streakThreshold) p += R.streakBonus;

  // hook upgrade futur (si tu ajoutes un mod : retaliationChanceMul)
  p *= (um.retaliationChanceMul || 1);

  // bonus via fortification
  const hardLvl = getHardeningLvl(server.id);
  p *= (1 + hardLvl*0.05);

  return clamp(p, R.min, R.max);
}

// Dégâts des représailles (échelle avec pression d’activité)
function _retaliationDamage(target, server, lastCredGain){
  const R = RETALIATION;
  const um = upgradeMods?.() || {};
  const ev = _retaliationEventPressure(target);

  // base heat
  let heat = Math.round((R.heatDmg.base + server.level * R.heatDmg.perLevel) *
    (target.kind === 'city' ? R.heatDmg.cityMul : R.heatDmg.corpMul) *
    ev.heatMul);

  // base credits
  const pct = R.credDmg.asPctOfGainMin + Math.random()*(R.credDmg.asPctOfGainMax - R.credDmg.asPctOfGainMin);
  let credLoss = Math.round(lastCredGain * pct * ev.credMul);
  credLoss = Math.max(R.credDmg.floor, credLoss);
  credLoss = Math.min( Math.round(state.creds * R.credDmg.capPctOfWallet), credLoss, state.creds );

  // base reputation
  let repLoss = (target.kind==='city') ? R.repDmg.city : (R.repDmg.corpMin + Math.floor(server.level/3));

  // pression d’activité → multiplier dégâts (cap 8 tentatives pour éviter l’explosion)
  const now = Date.now();
  const attempts = Math.min(8, (state.attemptHistory[target.id] || []).filter(ts => now - ts < R.pressureWindowMs).length);
  const pressMul = 1 + attempts * R.dmgPressureMulPerAttempt;

  heat     = Math.round(heat * pressMul);
  credLoss = Math.round(credLoss * pressMul);
  // la réputation peut rester non-scalée pour éviter de descendre trop vite
  // repLoss = Math.round(repLoss * (1 + attempts*0.01));

  // hook upgrade futur (si tu ajoutes : retaliationDmgMul)
  const dmgMul = (um.retaliationDmgMul || 1);
  heat     = Math.round(heat * dmgMul);
  credLoss = Math.round(credLoss * dmgMul);
  const hardLvl = getHardeningLvl(server.id);
  const hardMul = 1 + hardLvl*0.10;
  heat     = Math.round(heat * hardMul);
  credLoss = Math.round(credLoss * hardMul);
  // repLoss = Math.round(repLoss * dmgMul);

  return { heat, credLoss, repLoss, attempts };
}

// Appliquer potentiellement des représailles après un succès
function maybeRetaliation(target, server, lastCredGain){
  const p = _retaliationChance(target, server);
  if (Math.random() < p){
    const { heat, credLoss, repLoss, attempts } = _retaliationDamage(target, server, lastCredGain);
    const heatCap = 100 - (upgradeMods().heatCapMinus || 0);

    state.heat = Math.min(heatCap, state.heat + heat);
    state.creds = Math.max(0, state.creds - credLoss);
    state.rep   = Math.max(0, state.rep   - repLoss);
    
    addLog(`⚠️ ${t('logs.retaliation_text')}: <b>${target.name}</b> — +${heat}% ${t('logs.heat_text')}, -${credLoss}$, -${repLoss} Rep <span class="text-slate-400 text-xs">(p≈${Math.round(p*100)}% • ${attempts} ${t('logs.attempts_text')}/${RETALIATION.pressureWindowMs/60000}min)</span>`);
  }
}

// === INCREMENTAL: état, helpers, UI ===
function ensureIncState(){
  if(!window.state) window.state = {};
  if(!state.inc){
    const counts = {};
    INC.gens.forEach(g => counts[g.id] = 0);
    state.inc = {
      ticks: 0,
      clickPower: 1,
      counts,
      tps: 0
    };
  }
  return state.inc;
}

// === LOOT helpers ===
function ensureLootState(){
  if(!window.state) window.state = {};
  if(!state.loot) state.loot = {};
  return state.loot;
}

function grantTokenLoot(qty){
  ensureLootState();
  const base = (typeof TOKEN_LOOT.base === 'number') ? TOKEN_LOOT.base : 1;
  addLootItem(TOKEN_LOOT.id, TOKEN_LOOT.name, base, qty);
  if(typeof renderLoot === 'function') renderLoot();
  if(typeof save === 'function') save();
}

function incGetCost(id){
  const g = INC.gens.find(x => x.id === id);
  const inc = ensureIncState();
  const owned = inc.counts[id] || 0;
  return Math.round(g.base * Math.pow(g.mul, owned));
}

function incRecomputeTps(){
  const inc = ensureIncState();
  inc.tps = INC.gens.reduce((sum, g) => sum + (inc.counts[g.id] * g.tps), 0);
}

function incTick(dt=1){
  const inc = ensureIncState();
  inc.ticks += inc.tps * dt;
  saveInc();
  renderIncremental();
}

function incPulse(){
  const inc = ensureIncState();
  inc.ticks += inc.clickPower;
  saveInc();
  renderIncremental();
}

function buyGen(id){
  const inc = ensureIncState();
  const cost = incGetCost(id);
  if(inc.ticks >= cost){
    inc.ticks -= cost;
    inc.counts[id] = (inc.counts[id] || 0) + 1;
    incRecomputeTps();
    saveInc();
    renderIncremental();
  }
}

function fmtTicks(n){
  return (n < 1000) ? n.toFixed(0) : Math.floor(n).toLocaleString('fr-FR');
}

function renderIncremental(){
  const inc = ensureIncState();
  let root = document.getElementById('inc');
  if(!root){
    root = document.createElement('section');
    root.id = 'inc';
    root.className = 'max-w-5xl mx-auto p-4 md:p-6';
    document.body.prepend(root);
  }

  // UI (style aligné sur l'app : CARD / PILL / BTN)
  root.innerHTML = `
    <div class="${CARD}">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div class="flex items-center justify-between gap-3 rounded-lg border border-white/10 p-2 mb-2">
          <div class="flex flex-col">
            <div class="text-2xl font-bold">
              <span id="incTicks">${fmtTicks(inc.ticks)}</span>
              <span class="text-slate-400 text-base">${t('inc.tokens')}</span>
            </div>
            <div class="text-slate-400 text-sm mt-1">
              ${t('inc.production')}&nbsp;: <span id="incTps" class="text-cyan-300 font-semibold">${inc.tps.toFixed(2)}</span> TPS
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="${PILL}">+${inc.clickPower} ${t('inc.per_click')}</span>
            <button id="incPulse" class="${BTN_PRIMARY}">${t('inc.mine')}</button>
          </div>
        </div>

        <!-- Conversion Tokens -> Loot -->
        <div class="flex items-center justify-between gap-3 rounded-lg border border-white/10 p-2 mb-2">
          <div class="text-slate-400 text-sm">
            ${t('inc.to_loot')} </br>
            <span class="text-slate-300/80">·</span>
            <span class="text-cyan-200"><span id="incUnit">0.01$</span>/u</span>
          </div>
          <div class="flex items-center gap-2">
            <button id="incConvert" class="${BTN_PRIMARY}">${t('inc.convert')}</button>
          </div>
        </div>

        <!-- Conversion Tokens -> RP -->
        <div class="flex items-center justify-between gap-3 rounded-lg border border-white/10 p-2 mb-2">
          <div class="text-slate-400 text-sm">
            ${t('inc.to_rp')}</br>
            <span class="text-slate-300/80">·</span>
            <span class="text-cyan-200"><span id="rpRatio">${RP_PER_TOKEN}</span> RP</span>/token
          </div>
          <div class="flex items-center gap-2">
            <button id="incConvertRP" class="${BTN_PRIMARY}">${t('inc.convert')}</button>
          </div>
        </div>
      </div>
      <div class="space-y-2 grid grid-cols-1 md:grid-cols-3 gap-3">
        ${INC.gens.map(g => {
          const owned = inc.counts[g.id] || 0;
          const cost = incGetCost(g.id);
          const affordable = inc.ticks >= cost;
          const rowCls = [
            'flex','items-start','justify-between','gap-3',
            'rounded-md','border','border-white/10','bg-white/5','p-2',
          ].join(' ').trim();

          return `
            <div class="${rowCls}">
              <div>
                <b>${g.name}</b>
                <div class="text-slate-400 text-sm">x${owned} • ${g.tps} TPS</div>
              </div>
              <div class="flex items-center gap-2">
                <span class="${PILL}">${fmtTicks(cost)} tokens</span>
                <button data-buy="${g.id}" class="${affordable ? BTN_SUCCESS : BTN + ' opacity-60'}" ${affordable ? '' : 'disabled'}>
                  📟​
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  root.querySelector('#incPulse')?.addEventListener('click', incPulse);
  root.querySelector('#incConvert')?.addEventListener('click', () => {
    const inc = ensureIncState();
    const input = root.querySelector('#incConvQty');
    const qty = Math.max(1, parseInt(Math.floor(inc.ticks) || '0', 10) || 0);
    if (inc.ticks < qty) return;
    inc.ticks -= qty;
    grantTokenLoot(qty);
    saveInc?.();
    renderIncremental();
  });

  root.querySelector('#incConvertRP')?.addEventListener('click', () => {
    const inc = ensureIncState();
    const input = root.querySelector('#incConvQtyRP');
    const qty = Math.max(1, parseInt(Math.floor(inc.ticks) || '0', 10) || 0);
    if (inc.ticks < qty) return;
    inc.ticks -= qty;
    const rpGain = Math.round(qty * RP_PER_TOKEN * 100) / 100;
    state.rp = Math.round((state.rp + rpGain) * 100) / 100;
    addLog(`📚 ${t('logs.search_text')}: +<b>${rpGain}</b> RP`);
    saveInc?.();
    renderIncremental();
    renderKPIs?.();
    updateRPBadges?.();   // <-- met à jour tous les badges RP sans tout re-render
    renderUpgrades?.();   // (conserve quand même un re-render si tu veux rafraîchir les états de nœuds)
    persist?.();
  });
  root.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', () => buyGen(btn.getAttribute('data-buy')));
  });
}

function saveInc(){
  try{ localStorage.setItem('inc', JSON.stringify(state.inc)); }catch(e){}
}
function loadInc(){
  try{
    const raw = localStorage.getItem('inc');
    if(raw){
      const parsed = JSON.parse(raw);
      // Migration/validation
      ensureIncState();
      Object.assign(state.inc, parsed);
    }else{
      ensureIncState();
    }
  }catch(e){
    ensureIncState();
  }
  incRecomputeTps();
}

function initIncremental(){
  loadInc();
  renderIncremental();
  if(!window._incTicker){
    window._incTicker = setInterval(()=>incTick(1), 1000);
  }
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
  // ➋ eventStart(e) — fallback si jamais "start" manquait
  if (e.type === 'lockout') return e.ends - 10000; // 10s par défaut
  if (e.type === 'trace') {
    const L = e.level || 1;
    const d = (TRACE.durationsMs && TRACE.durationsMs[L]) || 60000;
    return (e.start ? e.start : (e.ends - d));
  }
  return e.ends - 30000;
}
function eventMeta(e){
  // lookup robuste
  const byId = window.EVENT_DEFS_BY_ID || {};
  let d = byId[e.type] || byId[e.id];
  if(!d && Array.isArray(window.EVENT_DEFS)){
    d = window.EVENT_DEFS.find(x => x.id === e.type || x.id === e.id) || null;
  }

  const nameFallback =
      (e.type==='audit' ? 'Audit sécurité'
    : e.type==='city_sweep' ? 'Sweep réseau municipal'
    : e.type==='bounty' ? 'Prime temporaire'
    : 'Événement');

  const name = d?.nameKey ? t(d.nameKey) : nameFallback;
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
  if (e.type === 'lockout') {
    return { name: `${t('logs.heat_overload_text')}`, icon: '🔥' };
  }
  if (e.type === 'trace') {
    const L = e.level || 1;
    let who2 = '';
      if (e.corp) {
        const corp = (window.TARGETS||[]).find(t => t.id === e.corp);
        
        // Si la corpo du traceur est la même que la cible active, on simplifie le message
        if (corp && window.CURRENT_TARGET && corp.id === window.CURRENT_TARGET.id) {
          who2 = '';
        } else if (corp) {
          who2 = ' — ' + corp.name;
        } else {
          who2 = ` — [corpo inconnue: ${e.corp}]`;
        }
      } else {
        who2 = `${t('logs.municipal_network_text')}`;
      }
      return { name: `${t('ui.activ_tracer')}${L}${who2}`, icon: '🎯' };
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
    p.textContent = `${t('logs.no_active_events_text')}`;
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
    // Forcer le rafraîchissement du ticker à chaque tick si des événements sont actifs
    if (state.events.length) {
      renderEventTicker();
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

// === Console Dock (always visible, collapsible) ===
function setupConsoleDock(){
  const log = document.getElementById('log');
  const height = '21vh';
  if(!log) return; // rien à faire si #log n'existe pas encore

  // dock existant ?
  let dock = document.getElementById('consoleDock');
  if(!dock){
    dock = document.createElement('section');
    dock.id = 'consoleDock';
    dock.className = 'fixed bottom-2 left-2 right-2 md:left-4 md:right-4 z-50 pointer-events-none'; // bordures cliquables désactivées hors chrome
    document.body.appendChild(dock);

    const chrome = document.createElement('div');
    chrome.id = 'consoleChrome';
    chrome.className = 'pointer-events-auto rounded-xl border border-white/10 bg-slate-900/80 backdrop-blur-xl opacity-90 shadow-2xl';
    dock.appendChild(chrome);

    const head = document.createElement('div');
    head.id = 'consoleHeader';
    head.className = 'flex items-center justify-between gap-2 p-2 select-none cursor-pointer';
    head.innerHTML = `
      <div class="flex items-center gap-2">
        <span>📟</span>
        <b>Console</b>
        <span class="text-slate-400 text-xs hidden sm:inline">(tape pour réduire/agrandir)</span>
      </div>
      <button type="button" id="consoleToggle"
        class="${BTN}">▼</button>
    `;
    chrome.appendChild(head);

    const scroller = document.createElement('div');
    scroller.id = 'consoleScroll';
    scroller.className = `px-2 pb-2 h-[${height}] overflow-y-auto`;
    chrome.appendChild(scroller);

    // Déplacer le #log existant dans le dock (on le "transplante")
    log.classList.add('space-y-1','text-sm');
    scroller.appendChild(log);

    // état initial (mobile => replié par défaut si jamais pas encore stocké)
    const key = 'console_collapsed_v1';
    let collapsed = localStorage.getItem(key);
    if(collapsed === null){
      collapsed = (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) ? '1' : '0';
      try{ localStorage.setItem(key, collapsed); }catch(e){}
    }
    toggleConsoleCollapsed(collapsed === '1');

    // interactions
    head.addEventListener('click', ()=> toggleConsoleCollapsed());
    document.getElementById('consoleToggle').addEventListener('click', (e)=>{ e.stopPropagation(); toggleConsoleCollapsed(); });
  }
}

function toggleConsoleCollapsed(force=null){
  const height = '21vh';
  const key = 'console_collapsed_v1';
  const dock = document.getElementById('consoleDock');
  const chrome = document.getElementById('consoleChrome');
  const scroll = document.getElementById('consoleScroll');
  const btn = document.getElementById('consoleToggle');
  if(!dock || !chrome || !scroll || !btn) return;

  // lire l'état courant
  let collapsed = (dock.getAttribute('data-collapsed') === '1');
  if(force !== null){ collapsed = !!force; }
  else { collapsed = !collapsed; }

  // appliquer classes/styles
  dock.setAttribute('data-collapsed', collapsed ? '1' : '0');
  if(collapsed){
    scroll.classList.add('h-0','opacity-0','pointer-events-none');
    scroll.classList.remove(`h-[${height}]`,'opacity-100');
    btn.textContent = '▲';
  }else{
    scroll.classList.remove('h-0','opacity-0','pointer-events-none');
    scroll.classList.add(`h-[${height}]`,'opacity-100');
    btn.textContent = '▼';
  }

  // mémoriser
  try{ localStorage.setItem(key, collapsed ? '1' : '0'); }catch(e){}
}

// ====== Actions ======
function scan(targetId, serverId){
  const target = (window.TARGETS||[]).find(t=>t.id===targetId);
  const s = target.servers.find(s=>s.id===serverId);
  const um = upgradeMods();
  const btns = document.querySelectorAll('[data-scan], [data-action="hack"]');
  btns.forEach(b=>b.disabled=true);
  const delay = Math.round(350 * (um.scanLatencyMul||1));
  setTimeout(()=>{
    const c = computeSuccess(s,target); // bypass ne s'applique pas au scan
    state.discovered[serverId] = c;
    addLog(`Scan <span class="text-slate-400">${target.name} › ${t(s.name)}</span> → ${t('logs.luck_text')} ${Math.round(c*100)}%`);
    renderTargets();
    // Si le scan révèle ≥95 %, chance de fortifier immédiatement
    if (c >= ADAPTIVE.scanTriggerAt && Math.random() < ADAPTIVE.onScanChance){
      bumpHardeningIfNeeded(target, s, c, `${t('logs.scan_text')}`);
    }

    // ✅ AJOUT : pression de scan & éventuel "trace"
    maybeTraceOnScan(target);

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
  const target = (window.TARGETS||[]).find(t=>t.id===targetId);
  const s = target.servers.find(s=>s.id===serverId);
  const um = upgradeMods();
  const delayBase = 300;
  const delay = (delayBase + cpuUsed()*150) * (um.latencyCpuMul || 1);
  const buttons = document.querySelectorAll('[data-action="hack"]');
  buttons.forEach(b=>b.disabled=true);
  setTimeout(()=>{ doHack(target,s); buttons.forEach(b=>b.disabled=false); }, delay);
}
function doHack(target, s){
  const nowTs = Date.now();
  (state.attemptHistory[target.id] ||= []).push(nowTs);
  state.attemptHistory[target.id] = state.attemptHistory[target.id].filter(ts => nowTs - ts < RETALIATION.pressureWindowMs);
  const tmods = activeEventMods(target);
  // appliquer bypass éventuel
  const bypass = maybeBypass(s);
  const baseChance = computeSuccess(s, target, bypass);
  let chance = baseChance + (tmods.chanceAdd||0);
  const hardLvl = getHardeningLvl(s.id);
  const maxCap = 0.95 - (hardLvl * (ADAPTIVE.capDropPerLevel || 0));
  const cap = Math.max(0.65, (isFinite(maxCap) ? maxCap : 0.95));
  chance = clamp(chance, 0.05, cap);
  const roll = Math.random();
  const um = upgradeMods();
  if(tmods.heatAttemptAdd) state.heat = clamp(state.heat + tmods.heatAttemptAdd, 0, 100);

  if(roll <= chance){
    const rm = rewardMul(target, s) * (tmods.rewardMul || 1);
    const cred = Math.round(s.reward.cred*rm);
    const repGain = s.reward.rep + (programMods().cityRep && t.kind==='city' ? programMods().cityRep : 0);
    state.creds += cred;
    state.rep += repGain;
    state.xp += 8 + s.level*3;
    // tentative bonus (programme ou upgrade)
    (state.farmHistory[s.id] ||= []).push(nowTs);
    state.farmHistory[s.id] = state.farmHistory[s.id].filter(ts => nowTs - ts < ECONOMY.repeatWindowMs);

    const extra = (programMods().extraAttemptOnSuccess ? 1 : 0) || (Math.random()*100 < (upgradeMods().extraAttemptPct||0) ? 1 : 0);
    const lootHint = (s.reward && typeof s.reward.loot === 'string')
    ? `, <span class="text-slate-400">${s.reward.loot}</span>`
    : '';

    addLog(`✔️ ${t('logs.success_text')}: <b>${t(target.name)} › ${t(s.name)}</b> +<b>${cred}$</b>, +<b>${repGain} Rep</b>${extra? ' — ' + t('logs.attempts_bonus_text'):''}`);
    // 🎁 LOOT (succès)
    const loot = rollLoot(target, s);
    if (loot.length){
      const parts = [];
      for (const d of loot){
        addLootItem(d.id, t(d.name), d.base, d.qty);
        parts.push(`${d.qty}× ${t(d.name)}`);
      }
      addLog(`🎁 ${t('logs.loot_text')}: <span class="text-slate-300">${parts.join(', ')}</span>`);
    }

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
    if(state.xp>=100){ state.xp-=100; state.sp++; addLog(`⬆️ ${t('logs.xp_gain_text')}`); }
    onHackSuccess(target.id, s.id);
    // ⬇️ nouveau : chance de représailles
    maybeRetaliation(target, s, cred);
    if(extra){ renderAll(); return; }
  } else {
    const hardLvl = getHardeningLvl(s.id);
    const h = Math.round(heatOnFail(tmods) * (1 + hardLvl*0.25));
    const loss = s.ice.includes('Noire') ? Math.min( Math.round(state.creds*0.05), 120) : 0;
    const heatCap = 100 - (upgradeMods().heatCapMinus||0);
    state.heat = Math.min(heatCap, state.heat + h);
    state.creds = Math.max(0, state.creds - loss);
    addLog(`💀 ${t('logs.fail_text')}: <b>${target.name} › ${t(s.name)}</b> — ${t('logs.heat_text')} +${h}%${loss?`, ${t('logs.loss_text')} ${loss}$`:''}`);
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
  addLog(`🔥 ${t('logs.heat_overload_text')} ${Math.round(ms/1000)}s`);
  renderEventTicker?.();

  clearTimeout(lockTimer);
  lockTimer = setTimeout(()=>{
    buttons.forEach(b=>b.disabled=false);
    state.heat = Math.max(0, state.heat-30);
    renderAll();
    addLog(`🧊 ${t('logs.heat_unlocked_text')}`);
  }, ms);
}

function buy(itemId){
  const it = itemById(itemId); if(!it) return;
  if(it.requires && !it.requires.every(r=>state.gearOwned.has(r))){ addLog(`⛔ ${t('missing_prerequisites_text')}`); return; }
  if(state.creds < it.cost){ addLog(`⛔ ${t('insufficient_credits_text')}`); return; }
  state.creds -= it.cost; state.gearOwned.add(it.id);
  const type = it.type;
  if(['deck','console','implant'].includes(type)){
    state.gearInstalled[type] = it.id;
  } else if(type==='mod'){
    state.gearInstalled.mods.push(it.id);
  } else if(type==='tool'){
    state.gearInstalled.tools.push(it.id);
  }
  addLog(`🛒 ${t('purchased_text')}: <b>${it.name}</b>`);
  renderAll();
}

function learnProgram(pId){
  const p = (window.PROGRAMS||[]).find(p=>p.id===pId); if(!p) return;
  if(state.creds < p.cost){ addLog(`⛔ ${t('insufficient_credits_text')}`); return; }
  state.creds -= p.cost; state.programsOwned.add(p.id); addLog(`📦 ${t('logs.acquired_text')} <b>${p.name}</b>`); renderAll();
}

function equipProgram(pId){
  if(!state.programsOwned.has(pId)) return;
  if(state.activePrograms.includes(pId)) return;
  const p = (window.PROGRAMS||[]).find(x=>x.id===pId); if(!p) return;
  if(state.activePrograms.length >= programSlots()){ addLog(`⛔ ${t('logs.full_slots_text')}`); return; }
  if(cpuUsed()+p.cpu > cpuCapacity()){ addLog(`⛔ ${t('logs.insufficient_cpu_text')}`); return; }
  state.activePrograms.push(pId);
  addLog(`💾 ${t('logs.loaded_text')} <b>${p.name}</b>`);
  renderPrograms(); persist();
}
function unequipProgram(pId){
  const i = state.activePrograms.indexOf(pId);
  if(i>=0){ state.activePrograms.splice(i,1); addLog(`⏏️ ${t('logs.unloaded_text')} <b>${(window.PROGRAMS||[]).find(p=>p.id===pId)?.name}</b>`); renderPrograms(); persist(); }
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

  // Fallback si pas de JSON
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

  // Tirage pondéré
  let totalW = 0;
  for(const d of defs) totalW += Math.max(1, d.weight || 1);
  let r = Math.random() * totalW, chosen = defs[0];
  for (const d of defs){
    r -= Math.max(1, d.weight || 1);
    if(r <= 0){ chosen = d; break; }
  }

  const ends = now + (chosen.duration_ms || 30000);
  const ev = { id: chosen.id, type: chosen.id, ends };

  // Message de log depuis JSON (corp vs défaut)
  let msg = '';
  if (chosen.scope === 'corp'){
    const corps = (window.TARGETS||[]).filter(t=>t.kind==='corp');
    if(corps.length){
      const c = corps[Math.floor(Math.random()*corps.length)];
      ev.corp = c.id;
      msg = (chosen.log && chosen.log.corp)
        ? chosen.log.corp.replace('{corp}', c.name)
        : `Événement ${t(chosen.nameKey)} chez ${c.name}`;
    } else {
      msg = `Événement ${t(chosen.nameKey)}`;
    }
  } else {
    msg = (chosen.log && chosen.log.default)
      ? chosen.log.default
      : `Événement ${t(chosen.nameKey)}`;
  }

  pushEvent(ev, msg);
}


// Missions
function currentMission(){ return state.missions.active || null; }
function acceptChain(corpId){ state.missions.active = { corp: corpId, index:0 }; addLog(`📝 ${t('logs.accepted_mission_text')} — <b>${(window.TARGETS||[]).find(t=>t.id===corpId)?.name}</b>: ${(window.MISSION_CHAINS||{})[corpId][0].name}`); renderMissions(); persist(); }
function abandonMission(){ if(state.missions.active){ addLog(`🗑️ ${t('logs.abandoned_mission_text')}`); state.missions.active=null; renderMissions(); persist(); } }
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

    addLog(`🏁 ${t('logs.completed_mission_text')} <b>${t(step.nameKey)}</b> +<b>${credGain}$</b> <span class="text-slate-400 text-xs">×${missionMul}</span> (+${repGain} Rep)`);

    state.missions.active.index++;
    const chain = (window.MISSION_CHAINS||{})[state.missions.active.corp] || [];
    if(state.missions.active.index >= chain.length){
      addLog(`🎖️ ${t('logs.chain_finish')}`);
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
function hasResearched(nodeId){
  return !!state.researched && state.researched.has(nodeId);
}
function canResearch(node){
  const cost = node.rp || 0;
  if (cost <= 0) return false;            // rien à rechercher
  if (state.upgrades.has(node.id)) return false; // déjà acheté
  if (hasResearched(node.id)) return false;      // déjà recherché
  return state.rp >= cost;
}
function research(nodeId){
  const node = (window.UPGRADE_NODE_BY_ID||{})[nodeId]; if(!node) return;
  const cost = node.rp || 0;
  if (cost>0 && state.rp < cost) return;
  // payer le coût RP (arrondi 2 déc.)
  if (cost>0){
    state.rp = Math.max(0, Math.round((state.rp - cost)*100)/100);
  }
  state.researched.add(node.id);
  addLog(`🔬 ${t('logs.research_completed_text')} <b>${node.name}</b>${cost?` (-${cost} RP)`:''}`);
  renderAll(); persist();
}
function canUnlock(node){
  const needSp = node.sp || 1;
  const researched = hasResearched(node.id) || (node.rp||0)===0;
  return !state.upgrades.has(node.id) && hasAllReq(node) && researched && state.sp >= needSp;
}
function unlock(nodeId){
  const node = (window.UPGRADE_NODE_BY_ID||{})[nodeId]; if(!node) return;
  if(!canUnlock(node)) return;
  const spCost = (node.sp||1);
  state.sp -= spCost;
  state.upgrades.add(node.id);
  addLog(`🔧 ${t('logs.upgrade_unlocked_text')} <b>${node.name}</b> (${spCost} SP)`);
  renderAll(); persist();
}

function renderUpgrades(){
  const root = document.getElementById('upgrades'); if(!root) return;
  root.innerHTML='';

  const branches = window.UPGRADES || {};
  const container = document.createElement('div');
  container.className = 'grid grid-cols-1 md:grid-cols-3 gap-3';

  // Barre RP (visible dans le bloc Upgrades)
  const rpbar = document.createElement('div');
  rpbar.className = 'flex items-center justify-between mb-2';
  rpbar.innerHTML = `<span class="${PILL}">RP: <span class="font-mono" data-rpval>${(Math.round((state.rp||0)*10)/10).toFixed(1)}</span></span>`;
  root.appendChild(rpbar);

  for(const [bid, branch] of Object.entries(branches)){
    const card = document.createElement('div'); card.className = CARD;
    const title = document.createElement('div');
    title.className = 'font-semibold text-cyan-300 mb-2';
    title.textContent = t(branch.name);
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
        const prereqOk = hasAllReq(n);
        const researched = hasResearched(n.id) || (n.rp||0)===0;

        const canR = canResearch(n);
        const canU = canUnlock(n);

        const row = document.createElement('div'); 
        row.className='flex items-start justify-between gap-3 rounded-md border border-white/10 bg-white/5 p-2';

        const left = document.createElement('div');
        left.innerHTML = `<b>${t(n.name)}</b><div class="text-slate-400 text-sm">${t(n.desc)}</div>`;
        // Coûts
        if (n.rp){
          const pillRp = document.createElement('span');
          pillRp.className = PILL + ' mr-2';
          pillRp.textContent = researched ? 'RP ✓' : `${n.rp} RP`;
          left.appendChild(pillRp);
        }
        const pillSp = document.createElement('span'); 
        pillSp.className = PILL; 
        pillSp.textContent = `${n.sp||1} SP`;
        left.appendChild(pillSp);

        const right = document.createElement('div'); 
        right.className = 'flex items-center gap-2';

        // Bouton RECHERCHER
        if (!researched && (n.rp||0)>0){
          const btnR = document.createElement('button');
          btnR.className = canR ? BTN_SUCCESS : BTN + ' opacity-60';
          btnR.textContent = '🔎';
          btnR.disabled = !canR;
          btnR.onclick = ()=> research(n.id);
          right.appendChild(btnR);
        }

        // Bouton ACHETER
        const btnU = document.createElement('button');
        btnU.className = canU ? BTN_PRIMARY : BTN + ' opacity-60';
        btnU.textContent = owned ? '✅' : ( !prereqOk ? '🔐' : '💰' );
        btnU.disabled = !canU || owned;
        btnU.onclick = ()=> unlock(n.id);
        right.appendChild(btnU);

        row.appendChild(left); 
        row.appendChild(right);

        // Styles d’état
        if(owned){ row.classList.add('ring-1','ring-emerald-500'); }
        else if(researched){ row.classList.add('ring-1','ring-cyan-400/60'); }
        if(!prereqOk && !owned){ row.classList.add('opacity-70'); }

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
  document.getElementById('kpi-creds').textContent = state.creds+'$';
  document.getElementById('kpi-rep').textContent = Math.floor(state.rep);
  document.getElementById('kpi-heat').textContent = Math.round(state.heat)+'%';
  document.getElementById('kpi-sp').textContent = state.sp;
  const rpEl = document.getElementById('kpi-rp');
  if (rpEl) rpEl.textContent = (Math.round(state.rp * 10) / 10).toFixed(1);
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
  // === Progression vers le prochain SP (100 XP) ===
  const XP_NEED = 100;
  const cur = Math.max(0, Math.min(XP_NEED, state.xp % XP_NEED));
  const xpText = document.getElementById('kpi-xptext');
  const xpBar  = document.getElementById('kpi-xpbar');
  if (xpText) xpText.textContent = `${Math.floor(cur)} / ${XP_NEED}`;

  if (xpBar) {
    const pct = Math.round((cur / XP_NEED) * 100);
    xpBar.style.width = pct + '%';

    // petit feedback visuel quand on est proche
    if (pct >= 90) {
      xpBar.style.boxShadow = '0 0 10px 3px rgba(34,211,238,.45)';
      xpBar.classList.add('animate-pulse');
    } else {
      xpBar.style.boxShadow = 'none';
      xpBar.classList.remove('animate-pulse');
    }
  }
}

function updateRPBadges(){
  const val = (Math.round((state.rp||0)*10)/10).toFixed(1);
  { const n = document.getElementById('kpi-rp'); if (n) n.textContent = val; }       // KPI global (si présent)
  { const n = document.getElementById('kpi-rp-head'); if (n) n.textContent = val; }  // dans le <h2> (si tu l'as ajouté)
  document.querySelectorAll('[data-rpval]').forEach(el=> el.textContent = val); // badge du bloc Upgrades
}

function renderSkills(){
  const root = document.getElementById('skills');
  root.innerHTML='';
  const canSpend = state.sp > 0;
  const g = gearBonuses();

  const order = (window.SKILL_ORDER && window.SKILL_ORDER.length)
    ? window.SKILL_ORDER
    : Object.keys(state.skills);

  for (const id of order){
    const meta = (window.SKILL_BY_ID && window.SKILL_BY_ID[id]) || { name:id, desc:[] };
    const title = meta.name || id.charAt(0).toUpperCase()+id.slice(1);
    const baseVal = Number(state.skills[id]||0);
    const gear = Number(g[id]||0);
    const total = baseVal + gear;

    const infoLines = (meta.desc||[]).map(l=>`<li>${l}</li>`).join('');

    const card = document.createElement('div');
    card.className = 'relative rounded-xl border border-white/10 bg-white/5 p-3 overflow-visible min-h-[88px]';

    card.innerHTML = `
      <div class="pr-16 min-w-0">
        <div class="flex items-center gap-2">
          <b class="block">${title}</b>
          <button class="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-full
                         border border-cyan-400/40 text-cyan-300 hover:bg-white/10 text-[11px] leading-none"
                  title="Infos" aria-label="Infos ${title}" data-infobtn="${id}">i</button>
        </div>

        <div class="text-slate-300">
          lvl <span class="font-mono text-base">${total.toFixed(2)}</span>
        </div>

        <div class="text-slate-500 text-xs mt-0.5">
          base <span class="font-mono">${baseVal.toFixed(2)}</span>
          ${gear ? ` · équipement <span class="font-mono ${gear>0?'text-emerald-400':'text-rose-400'}">${gear>=0?'+':''}${Number.isInteger(gear)?gear:gear.toFixed(2)}</span>` : ''}
        </div>
      </div>

      <button
        class="inline-flex items-center px-3 py-2 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 font-semibold whitespace-nowrap
               absolute right-2 top-1/2 -translate-y-1/2 ${canSpend ? '' : 'opacity-50 cursor-not-allowed'}"
        ${canSpend ? '' : 'disabled'}
        title="${canSpend ? '+1 point' : '0 point de compétence disponible'}"
        data-skill="${id}"
      >+1</button>

      <!-- panneau d’infos -->
      <div class="hidden absolute z-20 left-2 top-2 mt-8 max-w-xs border border-white/15 bg-slate-900/95 backdrop-blur-sm
                  rounded-lg p-3 shadow-lg text-sm" data-infopanel="${id}">
        <div class="text-cyan-300 font-semibold mb-1">${title}</div>
        ${infoLines ? `<ul class="list-disc pl-4 space-y-1 text-slate-200">${infoLines}</ul>` : '<div class="text-slate-400">Aucune description.</div>'}
      </div>
    `;

    card.querySelector('[data-skill]').onclick = ()=>{ if(canSpend) spendPoint(id); };

    // tooltip (hover + clic)
    const btn = card.querySelector(`[data-infobtn="${id}"]`);
    const panel = card.querySelector(`[data-infopanel="${id}"]`);
    let hideTimer=null, show=()=>{clearTimeout(hideTimer);panel.classList.remove('hidden');}, hide=()=>{hideTimer=setTimeout(()=>panel.classList.add('hidden'),150);};
    btn.addEventListener('click', e=>{e.stopPropagation(); panel.classList.toggle('hidden');});
    btn.addEventListener('mouseenter', show); btn.addEventListener('mouseleave', hide);
    panel.addEventListener('mouseenter', ()=>clearTimeout(hideTimer)); panel.addEventListener('mouseleave', hide);

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
      chip.innerHTML = `${p?.name||pid} <button class="${BTN} ml-1" data-un="${pid}">${t('programs.btn-unload')}</button>`;
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
    el.innerHTML = `<div><b>${p.name}</b> <div class="text-slate-400 text-sm">CPU ${p.cpu} — ${t(p.descKey)}</div></div>
      <div class="flex gap-2 mt-2">
        ${owned ? (
          equipped
            ? `<button class="${BTN}" data-un="${p.id}">${t('programs.btn-unload')}</button>`
            : `<button class="${BTN_PRIMARY}" ${(full|| (cpuUsed()+p.cpu>cpuCapacity()))? 'disabled':''} data-eq="${p.id}">${t('ui.load')}</button>`
        ) : `<button class="${BTN_PRIMARY}" data-buyprog="${p.id}">💰 (${p.cost}$)</button>`}
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

function serverLine(target, s){
  const wrap = document.createElement('div');
  wrap.className = 'grid grid-cols-[1fr_auto] gap-2 items-center';
  const known = state.discovered[s.id];
  // si connu, on recalcule live pour intégrer hardening & events récents
  const um = upgradeMods();
  const live = known ? computeSuccess(s, target) : null;
  const pct = known
    ? (um.showScanExact ? ((live*100).toFixed(1) + '%') : (Math.round(live*100) + '%'))
    : '?';
  
  const hardLv = getHardeningLvl(s.id);
  const fortBadge = hardLv ? ` <span class="ml-1 text-fuchsia-300">Fortifié L${hardLv}</span>` : '';
  const iceNames = s.icenameKey.map(key => t(key)).join(', ');
  wrap.innerHTML = `<div>
      <div><b>${t(s.name)}</b> <span class="text-slate-400 text-sm">lvl ${s.level}</span></div>
      <div class="text-slate-400 text-sm">${t('targets.defense')}: ${iceNames}${fortBadge}</div>
      <div class="${PROGRESS_OUTER}"><span class="${PROGRESS_INNER}" style="width:${known? Math.round(known*100):0}%"></span></div>
    </div>
    <div class="flex gap-2">
      <button class="${BTN}" data-scan>${t('targets.scan')}</button>
      <button class="${BTN_PRIMARY}" data-action="hack">${t('targets.hack')} (${pct})</button>
    </div>`;
  wrap.querySelector('[data-scan]').onclick = ()=>scan(target.id, s.id);
  wrap.querySelector('[data-action="hack"]').onclick = ()=>hack(target.id, s.id);
  return wrap;
}

function renderTargets(){
  const root = document.getElementById('targets');

  if(!document.getElementById('targetsToolbar')){
    const bar = document.createElement('div');
    bar.id='targetsToolbar'; bar.className='flex flex-wrap gap-2 mb-2';
    const openBtn=document.createElement('button'); openBtn.className=BTN; openBtn.textContent = t('ui.open_all');
    const closeBtn=document.createElement('button'); closeBtn.className=BTN; closeBtn.textContent = t('ui.close_all');
    openBtn.onclick=()=>{ root.querySelectorAll('details[data-id]').forEach(d=>d.open=true); saveOpenTargets(); };
    closeBtn.onclick=()=>{ root.querySelectorAll('details[data-id]').forEach(d=>d.open=false); saveOpenTargets(); };
    root.parentElement.insertBefore(bar, root);
    bar.appendChild(openBtn); bar.appendChild(closeBtn);
  }

  // --- préférences d’ouverture : DOM courant + localStorage (même si vide)
  const prevOpen = new Set();
  root.querySelectorAll('details[data-id]')?.forEach(det=>{
    if(det.open) prevOpen.add(det.dataset.id);
  });

  let storedSet = new Set();
  let hasStored = false;
  try {
    const raw = localStorage.getItem(OPEN_TARGETS_KEY);
    if (raw !== null) {               // <- clé présente, même si "[]"
      storedSet = new Set(JSON.parse(raw));
      hasStored = true;
    }
  } catch(e){ /* ignore */ }

  const prefer = prevOpen.size ? prevOpen : storedSet;
  const havePreference = (prevOpen.size > 0) || hasStored;

  root.innerHTML='';
  (window.TARGETS||[]).forEach(target=>{
    const det = document.createElement('details');
    det.dataset.id = target.id;
    // si une préférence existe, on l’applique; sinon on garde ton défaut (ville ouverte)
    det.open = havePreference ? prefer.has(target.id) : (target.id==='city');

    det.className = CARD + ' [&_summary]:cursor-pointer [&_summary]:text-cyan-300 [&_summary]:font-semibold transition ease-in-out hover:ring-1 hover:ring-cyan-400/50';
    const sum = document.createElement('summary');
    sum.className = 'flex items-center justify-between gap-2 text-cyan-300 font-semibold';
    
    sum.innerHTML = `
      <span class="summary-head">${t(target.name)}${t(target.kind)==='city' ? ' — Métropole' : ' — Corpo'}</span>
      ${target.image ? `
        <img src="${target.image}" alt="${t(target.name)}"
            class="w-12 h-12 object-cover rounded ring-1 ring-cyan-400/40">
      ` : ''}
    `;
    det.appendChild(sum);
    
    const box = document.createElement('div'); box.className='mt-2 space-y-2';
    target.servers.forEach(s=> box.appendChild( serverLine(target,s) ));
    det.appendChild(box);

    det.addEventListener('toggle', saveOpenTargets);
    root.appendChild(det);
  });

  saveOpenTargets();

  function saveOpenTargets(){
    const ids=[...root.querySelectorAll('details[data-id]')]
      .filter(d=>d.open)
      .map(d=>d.dataset.id);
    localStorage.setItem(OPEN_TARGETS_KEY, JSON.stringify(ids));
  }
}

function renderMissions(){
  const root = document.getElementById('missions'); if(!root) return;

  if(!document.getElementById('missionsToolbar')){
    const bar = document.createElement('div');
    bar.id='missionsToolbar'; bar.className='flex flex-wrap gap-2 mb-2';
    const openBtn=document.createElement('button'); openBtn.className=BTN; openBtn.textContent = t('ui.open_all');
    const closeBtn=document.createElement('button'); closeBtn.className=BTN; closeBtn.textContent = t('ui.close_all');
    openBtn.onclick=()=>{ root.querySelectorAll('details[data-id]').forEach(d=>d.open=true); saveOpenMissions(); };
    closeBtn.onclick=()=>{ root.querySelectorAll('details[data-id]').forEach(d=>d.open=false); saveOpenMissions(); };
    root.parentElement.insertBefore(bar, root);
    bar.appendChild(openBtn); bar.appendChild(closeBtn);
  }

  const prevOpen = new Set();
  root.querySelectorAll('details[data-id]')?.forEach(det=>{
    if (det.open) prevOpen.add(det.dataset.id);
  });

  let stored = new Set();
  let hasStored = false;
  try {
    const raw = localStorage.getItem(OPEN_MISSIONS_KEY);
    if (raw !== null) { stored = new Set(JSON.parse(raw)); hasStored = true; }
  } catch(e){}

  const prefer = prevOpen.size ? prevOpen : stored;
  const havePreference = (prevOpen.size > 0) || hasStored;

  root.innerHTML='';
  const m = currentMission();
  for (const cid of Object.keys(window.MISSION_CHAINS||{})){
    const det = document.createElement('details');
    det.dataset.id = cid;
    det.open = havePreference
      ? prefer.has(cid)
      : (!m || (m && m.corp === cid));
    det.className = CARD + ' [&_summary]:cursor-pointer [&_summary]:text-cyan-300 [&_summary]:font-semibold';
    const corp = (window.TARGETS||[]).find(t=>t.id===cid);
    const sum = document.createElement('summary'); sum.textContent = corp?.name || cid; det.appendChild(sum);
    const box = document.createElement('div'); box.className='mt-2 space-y-2';
    const chain = (window.MISSION_CHAINS||{})[cid];
    const li = document.createElement('div'); li.className='space-y-1';
    chain.forEach((step,i)=>{
      const status = m && m.corp===cid && m.index>i ? '✅' : (m && m.corp===cid && m.index===i ? '▶️' : '•');
      const title  = step.nameKey ? t(step.nameKey) : i18nText(step.name);
      const row = document.createElement('div'); row.className='flex gap-2';
      row.innerHTML = `<div>${status} <b>${title}</b> — <span class="text-slate-400 text-sm">${t('missions.objective')}: ${step.objective.server}</span> <span class="${PILL}">${step.reward.cred}$ · +${step.reward.rep} Rep</span></div>`;
      li.appendChild(row);
    });
    box.appendChild(li);
    const controls = document.createElement('div'); controls.className='flex gap-2 mt-2';
    if(!m){
      const btn=document.createElement('button'); btn.className=BTN + ' ring-1 ring-cyan-400/40'; btn.textContent = t('ui.accept_chain');; btn.onclick=()=>acceptChain(cid); controls.appendChild(btn);
    } else if(m && m.corp===cid){
      const btn=document.createElement('button'); btn.className=BTN; btn.textContent = t('ui.abandon'); btn.onclick=()=>abandonMission(); controls.appendChild(btn);
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
             class="max-w-[40px] rounded ring-1 mx-2 ${imgRing}" data-itemimg="${it.id}">` : ''}
      </div>
      <div class="text-slate-400 text-sm">${bonuses||'—'}</div>
      <div class="flex items-center justify-between mt-2">
        <span class="font-mono">${it.cost||0}$</span>
        <button class="${btnClass}" ${owned||blocked? 'disabled':''}
                data-buy="${it.id}" data-cost="${it.cost||0}">${btnLabel}</button>
      </div>`;

    card.querySelector('[data-buy]')?.addEventListener('click',()=>buy(it.id));
    root.appendChild(card);
  });
}

function renderAll(){
  renderKPIs(); renderSkills(); renderPrograms(); renderGearInstalled(); renderLoot();
  renderStore(); renderTargets(); renderMissions(); renderUpgrades();
  renderEventTicker(); 
  persist();
}

// ====== Save/Load ======
function persist() {
const o = { 
...state,
gearOwned:[...state.gearOwned],
programsOwned:[...state.programsOwned],
upgrades:[...state.upgrades],
researched:[...state.researched],   // <-- NEW
hardening: state.hardening,
loot: state.loot
};  
  const KEY = (typeof SAVE_KEY !== 'undefined' ? SAVE_KEY : (window.SAVE_KEY || 'cyber_netrunner_save_v6'));
  localStorage.setItem(KEY, JSON.stringify(o));
}
function restore(){
  try{
    const KEY = (typeof SAVE_KEY !== 'undefined' ? SAVE_KEY : (window.SAVE_KEY || 'cyber_netrunner_save_v6'));
    const raw = localStorage.getItem(KEY); if(!raw) return;
    const o = JSON.parse(raw);
    state.creds=o.creds; state.rep=o.rep; state.heat=o.heat; state.xp=o.xp; state.sp=o.sp; state.rp = o.rp || 0; state.skills=o.skills;
    state.gearOwned=new Set(o.gearOwned||[]);
    state.researched = new Set(o.researched || []);
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
    state.loot = o.loot || {};
    addLog('💾 Sauvegarde chargée');
  }catch(e){ console.warn(e); }
}

// ====== Boot (attend DATA_READY) ======
window.addEventListener('DATA_READY', async ()=>{
  await initI18n();
  renderLangSwitch();
  document.getElementById('saveBtn').onclick=()=>{ persist(); addLog(`💾 ${t('logs.save_text')}`); };
  document.getElementById('resetBtn').onclick=()=>{
    const KEY = (typeof SAVE_KEY !== 'undefined' ? SAVE_KEY : (window.SAVE_KEY || 'cyber_netrunner_save_v6'));
    ['cyber_netrunner_save_v4','cyber_netrunner_save_v5', KEY, OPEN_TARGETS_KEY, OPEN_MISSIONS_KEY, OPEN_UPGRADES_KEY, 'inc']
    .forEach(k=>localStorage.removeItem(k));
    location.reload();
  };
  initIncremental();
  restore();
  ensureSkillsState();
  renderAll();
  setupConsoleDock();
  addLog(`💾 ${t('logs.welcome')}`);
});

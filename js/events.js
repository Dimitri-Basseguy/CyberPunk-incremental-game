import { state } from './state.js';
import { addLog, formatLeft, clamp } from './utils.js';
import { TRACE, RETALIATION } from './config.js';

// util pour centraliser l’ajout d’un event + log + refresh
export function pushEvent(ev, msg){
  state.events.push(ev);
  if(msg) addLog(msg);
  renderEventTicker?.();
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

  const name = d?.name || nameFallback;
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
    return { name: 'Surcharge de chaleur — 🔒 verrou', icon: '🔥' };
  }
  if (e.type === 'trace') {
    const L = e.level || 1;
    let who2 = '';
    if (e.corp){
      const corp = (window.TARGETS||[]).find(t=>t.id===e.corp);
      if (corp) who2 = ' — ' + corp.name;
    } else {
      who2 = ' — Réseau municipal';
    }
    return { name: `Traceur actif L${L}${who2}`, icon: '🎯' };
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

    addLog(`🎯 Traceur activé sur <b>${target.name}</b> — niveau ${lvl}. Scans/hacks plus risqués temporairement.`);
    renderEventTicker?.();

    // contre-mesure instantanée (pic de chaleur + mini-verrou) : conditionnelle
    const panic = TRACE.scanPanic;
    if(Math.random() < panic.p){
      const L = (existing?.level) || lvl;
      const spike = panic.heatSpike[L] || 6;
      const heatCap = 100 - (upgradeMods().heatCapMinus||0);
      state.heat = Math.min(heatCap, state.heat + spike);
      addLog(`⚡ Contre-mesure détectée — +${spike}% chaleur`);
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

    addLog(`⚠️ Représailles: <b>${target.name}</b> — +${heat}% chaleur, -${credLoss}₵, -${repLoss} Rep <span class="text-slate-400 text-xs">(p≈${Math.round(p*100)}% • ${attempts} tentatives/12min)</span>`);
  }
}

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
        : `Événement ${chosen.name} chez ${c.name}`;
    } else {
      msg = `Événement ${chosen.name}`;
    }
  } else {
    msg = (chosen.log && chosen.log.default)
      ? chosen.log.default
      : `Événement ${chosen.name}`;
  }

  pushEvent(ev, msg);
}

export {
  renderEventTicker, tickEventTicker, maybeTraceOnScan, maybeRetaliation, spawnSecurityEvent
};
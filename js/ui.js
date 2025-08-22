import { state, ensureSkillsState } from './state.js';
import {
  BTN, BTN_PRIMARY, BTN_SUCCESS, CARD, PILL, PROGRESS_OUTER, PROGRESS_INNER,
  OPEN_TARGETS_KEY, OPEN_MISSIONS_KEY, ADAPTIVE
} from './config.js';
import { clamp, addLog, itemById } from './utils.js';
import { currentMission } from './actions.js';
import {
  computeSuccess, gearBonuses,
  programSlots, cpuCapacity, cpuUsed, renderSystemLoad,
  upgradeMods // ← keep this here
} from './compute.js';

// ====== Upgrades UI helpers + action ======
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
  renderAll();      // défini plus bas dans ui.js (OK grâce au hoisting)
  persist();
}

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
  // si connu, on recalcule live pour intégrer hardening & events récents
  const um = upgradeMods();
  const live = known ? computeSuccess(s, t) : null;
  const pct = known
    ? (um.showScanExact ? ((live*100).toFixed(1) + '%') : (Math.round(live*100) + '%'))
    : '?';
  
  const hardLv = getHardeningLvl(s.id);
  const fortBadge = hardLv ? ` <span class="ml-1 text-fuchsia-300">Fortifié L${hardLv}</span>` : '';
  wrap.innerHTML = `<div>
      <div><b>${s.name}</b> <span class="text-slate-400 text-sm">lvl ${s.level}</span></div>
      <div class="text-slate-400 text-sm">GLACE: ${s.ice.join(', ')}${fortBadge}</div>
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
    det.className = CARD + ' [&_summary]:cursor-pointer [&_summary]:text-cyan-300 [&_summary]:font-semibold transition ease-in-out hover:ring-1 hover:ring-cyan-400/50';
    const sum = document.createElement('summary');
    sum.className = 'flex items-center justify-between gap-2 text-cyan-300 font-semibold';

    sum.innerHTML = `
      <span class="summary-head">${t.name}${t.kind==='city' ? ' — Métropole' : ''}</span>
      ${t.image ? `
        <img src="${t.image}" alt="${t.name}"
            class="w-12 h-12 object-cover rounded ring-1 ring-cyan-400/40">
      ` : ''}
    `;
    det.appendChild(sum);
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

function renderAll(){
  renderKPIs(); renderSkills(); renderPrograms(); renderGearInstalled();
  renderStore(); renderTargets(); renderMissions(); renderUpgrades();
  renderEventTicker(); // ✅ AJOUT
  persist();
}

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
    addLog(`🛡️ <b>${target.name} › ${server.name}</b> — fortification ${reason} (GLACE +${ADAPTIVE.icePerLevel*applied}, L${h.lvl})`);
  }

  // re-calcul immédiat de la chance connue (si scannée)
  if (server.id in state.discovered){
    state.discovered[server.id] = computeSuccess(server, target);
  }
  renderTargets?.();
  return true;
}

export {
  renderKPIs, renderSkills, updateProgramAffordability, renderPrograms,
  renderGearInstalled, renderTargets, renderMissions, updateStoreAffordability,
  renderStore, renderUpgrades, renderAll, getHardeningLvl, bumpHardeningIfNeeded
};
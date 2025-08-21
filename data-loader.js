// data-loader.js — charge le contenu JSON (items, programs, targets, missions, ice, upgrades)
// Expose sur window : STORE_ITEMS, PROGRAMS, TARGETS, MISSION_CHAINS, ICE, UPGRADES
// Indices : ITEM_BY_ID, UPGRADE_NODE_BY_ID
// Évènement : DATA_READY

(async function(){
  async function getJSON(path){
    const res = await fetch(path, { cache:'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    return res.json();
  }

  const base = 'data';
  const [items, programs, targets, missions, ice, upgrades, events] = await Promise.all([
    getJSON(`${base}/items.json`),
    getJSON(`${base}/programs.json`),
    getJSON(`${base}/targets.json`),
    getJSON(`${base}/missions.json`),
    getJSON(`${base}/ice.json`),
    getJSON(`${base}/upgrades.json`),
    getJSON(`${base}/events.json`),
    
  ]);

  // Aplatit les items par type pour coller à l’API interne existante
  const flattenItems = (itemsJson)=>{
    const out = [];
    for (const type of ['decks','consoles','implants','mods','tools']){
      (itemsJson[type]||[]).forEach(it=> out.push({ ...it, type: type.replace(/s$/,'') }));
    }
    return out;
  };

  // Expose global data
  window.ICE = ice.ice;
  window.STORE_ITEMS = flattenItems(items);
  window.PROGRAMS = programs.programs;
  window.TARGETS = targets.targets;
  window.MISSION_CHAINS = missions.missions;
  window.UPGRADES = upgrades.branches;

  // ⬇️ Normalisation + exposition des events (supporte array direct OU { events: [...] })
  const ev = Array.isArray(events?.events) ? events.events : (Array.isArray(events) ? events : []);
  window.EVENT_DEFS = ev;
  window.EVENT_DEFS_BY_ID = Object.fromEntries(ev.map(e => [e.id, e]));

  // Indices rapides
  window.ITEM_BY_ID = Object.fromEntries(window.STORE_ITEMS.map(i=>[i.id, i]));
  const nodes = Object.entries(window.UPGRADES).flatMap(([branchId, b]) =>
    (b.nodes||[]).map(n => ({ ...n, branch: branchId, branchName: b.name }))
  );
  window.UPGRADE_NODE_BY_ID = Object.fromEntries(nodes.map(n=>[n.id, n]));

  // Helper optionnel
  window.getUpgradeTiers = function(branchId){
    const b = window.UPGRADES[branchId]; if(!b) return [];
    const map = new Map();
    for(const n of (b.nodes||[])){ if(!map.has(n.tier)) map.set(n.tier, []); map.get(n.tier).push(n); }
    return [...map.entries()].sort((a,b)=>a[0]-b[0]).map(([tier, nodes])=>({ tier, nodes }));
  };

  window.DATA_READY = true;
  window.dispatchEvent(new Event('DATA_READY'));
})().catch(err=>{
  console.error('Erreur de chargement des données:', err);
  alert('Erreur de chargement des données JSON. Voir console.');
});

export const state = {
  creds: 120, rep: 0, heat: 0, xp: 0, sp: 0,
  skills: { netrun: 1, stealth: 1, decrypt: 1, speed: 1 },
  gearOwned: new Set(['deck_mk1']),
  gearInstalled: { deck:'deck_mk1', console:null, implant:null, mods:[], tools:[] },
  programsOwned: new Set(['brute']),
  activePrograms: [],
  discovered: {},
  events: [],
  missions: { active:null, progress:{} },
  upgrades: new Set(),
  _bypassReadyAt: 0,
  farmHistory: {},
  attemptHistory: {},
  scanHistory: {},
  hardening: {},
};

// expose pour debug console si utile
window.state = state;

export function ensureSkillsState(){
  const defs = (window.SKILLS && window.SKILLS.skills) || [];
  if (!defs.length) return;
  const next = {};
  defs.forEach(s=>{
    const start = (typeof s.start === 'number') ? s.start : 1;
    next[s.id] = (state.skills && typeof state.skills[s.id]==='number') ? state.skills[s.id] : start;
  });
  state.skills = next;
}

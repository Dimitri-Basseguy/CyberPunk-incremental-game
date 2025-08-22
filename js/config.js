// UI classes
export const BTN = 'inline-flex items-center px-2 py-1 rounded-lg border border-white/15  hover:bg-white/15 font-semibold';
export const BTN_PRIMARY = BTN + ' ring-1 ring-cyan-400/40 hover:ring-cyan-300/60';
export const BTN_SUCCESS = BTN + ' ring-1 ring-emerald-400/60 hover:ring-emerald-300/70 bg-emerald-500/20';
export const CARD = 'rounded-xl border border-white/10 bg-white/5 p-2';
export const PILL = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 text-sm';
export const PROGRESS_OUTER = 'h-2 bg-white/10 rounded-full overflow-hidden mt-1.5';
export const PROGRESS_INNER = 'block h-full bg-gradient-to-r from-neon-cyan to-neon-fuchsia';

// Storage keys
export const OPEN_TARGETS_KEY  = 'open_targets_v1';
export const OPEN_MISSIONS_KEY = 'open_missions_v1';
export const OPEN_UPGRADES_KEY = 'open_upgrades_v1';

// Économie / sécurité / traceur
export const RETALIATION = {
  base: 0.20, perLevel: 0.04, heatBonusFrom: 30, heatBonusPer20: 0.06,
  corpMul: 1.15, cityMul: 1.00, stealthMitigationPerLvl: 0.008, min: 0.08, max: 0.75,
  heatDmg: { base: 8, perLevel: 3, cityMul: 1.10, corpMul: 1.00 },
  credDmg: { asPctOfGainMin: 0.35, asPctOfGainMax: 0.65, floor: 15, capPctOfWallet: 0.20 },
  repDmg:  { city: 2, corpMin: 3 },
  pressureWindowMs: 12*60*1000, pressurePerAttempt: 0.02, streakThreshold: 5, streakBonus: 0.10,
  dmgPressureMulPerAttempt: 0.03
};

export const ECONOMY = {
  base: 0.60, heatTaxMax: 0.45,
  repeatWindowMs: 10*60*1000, repeatDecay: 0.18, repeatMin: 0.35,
  cityMul: 0.90, corpMul: 1.00, missionMul: 0.85,
  farmHistory: {}
};

export const TRACE = {
  windowMs: 8*60*1000, base: 0.10, perScan: 0.06,
  heatBonusFrom: 35, heatPer20Bonus: 0.05,
  corpMul: 1.10, cityMul: 0.90, maxP: 0.80,
  levelByAttempts: [0,1,1,2,2,3,3,3],
  durationsMs: {1:45000, 2:70000, 3:100000},
  effects: { icePerLevel: 5, chanceMinusPerLevel: 0.05, heatAttemptAddPerLevel: 2 },
  scanPanic: { p: 0.20, heatSpike: {1:6,2:10,3:14}, lockoutMs: {1:2000,2:3500,3:5000} }
};

export const ADAPTIVE = {
  triggerAt: 0.95, scanTriggerAt: 0.95, onScanChance: 0.60,
  icePerLevel: 6, cooldownMs: 5*60*1000, maxLevels: 5, log: true
};

// Pour tweaker à chaud si besoin
window.tune = { RETALIATION, ECONOMY, TRACE, ADAPTIVE };
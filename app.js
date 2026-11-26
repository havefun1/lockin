'use strict';
/* Lock In — personal workout web app. Everything is saved on this device only. */

const LIB = window.LOCKIN_LIB;
const EX = Object.fromEntries(LIB.exercises.map(e => [e.id, e]));

const FOCUS = {
  arms:      { title: 'Arms',         short: 'Arms',  icon: '💪', color: '#ff8c33' },
  legs:      { title: 'Legs',         short: 'Legs',  icon: '🦵', color: '#4d99ff' },
  shoulders: { title: 'Shoulders',    short: 'Delts', icon: '🏋️', color: '#b87aff' },
  abs:       { title: 'Abs & Core',   short: 'Abs',   icon: '🎯', color: '#40d9bf' },
  chestBack: { title: 'Chest & Back', short: 'Chest', icon: '🛡️', color: '#ff616b' },
  fullBody:  { title: 'Full Body',    short: 'Full',  icon: '⚡', color: '#ffcc40' },
  rest:      { title: 'Rest Day',     short: 'Rest',  icon: '😴', color: '#8c8c8c' }
};
const FOCUS_KEYS = Object.keys(FOCUS);
const TRAINABLE = FOCUS_KEYS.filter(k => k !== 'rest');
const DEFAULT_SCHEDULE = ['arms', 'legs', 'shoulders', 'abs', 'chestBack', 'fullBody', 'rest'];
const EXPERIENCE = {
  beginner:     { title: 'New to lifting',  detail: "Never really trained, or it's been a long time. We start light and nail form." },
  intermediate: { title: 'Some experience', detail: "You've lifted on and off for a few months." },
  experienced:  { title: 'Experienced',     detail: 'You train regularly and know the main lifts.' }
};
const FEEDBACK = {
  tooEasy: { label: 'Too easy',   color: 'var(--ok)',     hint: 'Got it — this one goes up a step next time.' },
  good:    { label: 'Just right', color: 'var(--accent)', hint: 'Perfect. Progress continues as planned.' },
  tooHard: { label: 'Too hard',   color: 'var(--bad)',    hint: 'Got it — this one drops a step next time. Form first.' }
};
const CHIP_WEIGHTS = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 30, 35, 40, 45, 50, 60];
const EXCUSE_REASONS = ['Waiting on dumbbells', 'Sick', 'Sore or hurt', 'Busy day', 'Traveling', 'Other'];

// ---------------------------------------------------------------- helpers
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => (n < 10 ? '0' : '') + n;
const num = v => (Math.abs(v - Math.round(v)) < 0.01 ? String(Math.round(v)) : v.toFixed(1));
const lb = v => num(v) + ' lb';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
function hm(sec) {
  const mins = Math.max(0, Math.floor(sec / 60));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// ---------------------------------------------------------------- dates
// A "workout day" runs 3:00 AM → 3:00 AM, so a 1:30 AM session counts for the day before.
const CUTOFF = 3;
const WD_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WD_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dkey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function kdate(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const wIdx = d => (d.getDay() + 6) % 7; // Monday = 0
const wStart = d => addDays(d, -wIdx(d));
function workoutDay(now) {
  const s = new Date(now.getTime());
  s.setHours(s.getHours() - CUTOFF);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate());
}
const deadline = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, CUTOFF, 0, 0);
const wdName = d => d.toLocaleDateString('en-US', { weekday: 'long' });
const TODAY = () => workoutDay(new Date());

// ---------------------------------------------------------------- saving
const STORE_KEY = 'lockin.data.v1';

function freshData() {
  return {
    onboarded: false,
    profile: { name: '', age: 18, weightLb: 150, experience: 'beginner' },
    equipment: { hasDumbbells: true, kind: 'fixedPairs', fixedWeights: [5, 10, 15], adjustableMin: 5, adjustableMax: 25, adjustableStep: 2.5 },
    settings: { schedule: DEFAULT_SCHEDULE.slice(), weeklyGoal: null, maxExcusesPerWeek: 2, restSeconds: 60 },
    startDayKey: null,
    records: {},
    overrides: {},
    weekPlans: {},
    noDumbbellDays: [],
    feedbackOffsets: {},
    personalBests: {},
    pinnedVideos: {},
    bodyweightLog: [],
    inProgress: null,
    lastBackup: null
  };
}

// Fills in anything missing so older saves keep working after updates.
function mergeDefaults(def, val) {
  if (val === undefined) return def;
  if (def === null || typeof def !== 'object' || Array.isArray(def)) return val;
  if (val === null || typeof val !== 'object' || Array.isArray(val)) return def;
  const out = {};
  for (const k of Object.keys(def)) out[k] = mergeDefaults(def[k], val[k]);
  for (const k of Object.keys(val)) if (!(k in out)) out[k] = val[k];
  return out;
}

function normalize(d) {
  const out = mergeDefaults(freshData(), d);
  const s = out.settings.schedule;
  if (!Array.isArray(s) || s.length !== 7 || s.some(f => !FOCUS[f])) out.settings.schedule = DEFAULT_SCHEDULE.slice();
  if (!Array.isArray(out.noDumbbellDays)) out.noDumbbellDays = [];
  if (!Array.isArray(out.bodyweightLog)) out.bodyweightLog = [];
  return out;
}

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    try { if (raw) localStorage.setItem(STORE_KEY + '.unreadable.' + Date.now(), raw); } catch (_) { /* ignore */ }
  }
  return freshData();
}

let D = load();
let streakCache = null;

function persist() {
  streakCache = null;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(D));
  } catch (e) {
    toast("⚠️ Couldn't save — is your phone storage full?");
  }
}
function commit() { persist(); render(); }

// ---------------------------------------------------------------- the rules
const startDay = () => (D.startDayKey ? kdate(D.startDayKey) : null);

function focusFor(day) {
  const k = dkey(day);
  if (D.records[k]) return D.records[k].focus;
  if (D.overrides[k]) return D.overrides[k];
  const plan = D.weekPlans[dkey(wStart(day))];
  const i = wIdx(day);
  if (Array.isArray(plan) && plan.length === 7) return plan[i];
  return D.settings.schedule[i] || DEFAULT_SCHEDULE[i];
}

function weekStatus(ws, today) {
  const st = { training: 0, required: 0, completed: 0, excused: 0, remaining: 0 };
  if (D.startDayKey) {
    const tk = dkey(today);
    for (let i = 0; i < 7; i++) {
      const day = addDays(ws, i);
      const k = dkey(day);
      if (k < D.startDayKey) continue;
      const rec = D.records[k];
      const f = focusFor(day);
      if (rec) rec.status === 'completed' ? st.completed++ : st.excused++;
      if (f !== 'rest' || rec) st.training++;
      if (!rec && f !== 'rest' && k >= tk) st.remaining++;
    }
  }
  st.required = st.training;
  const goal = D.settings.weeklyGoal;
  if (goal && goal > 0) st.required = Math.min(goal, st.training);
  st.done = st.completed + st.excused;
  st.consistent = st.required > 0 && st.done >= st.required;
  st.possible = st.done + st.remaining >= st.required;
  return st;
}

function streak() {
  const today = TODAY();
  const tk = dkey(today);
  if (streakCache && streakCache.k === tk) return streakCache.v;
  const tws = wStart(today);
  const thisWeek = weekStatus(tws, today);
  let run = 0, best = 0, consistentWeeks = 0;
  if (D.startDayKey) {
    let ws = wStart(startDay());
    let guard = 0;
    while (dkey(ws) < dkey(tws) && guard++ < 1500) {
      const w = weekStatus(ws, today);
      if (w.required > 0) {
        if (w.consistent) { run++; consistentWeeks++; best = Math.max(best, run); } else run = 0;
      }
      ws = addDays(ws, 7);
    }
  }
  let current = run;
  if (thisWeek.consistent) current++;
  else if (thisWeek.required > 0 && !thisWeek.possible) current = 0;
  best = Math.max(best, current);
  const v = { current, best, consistentWeeks, thisWeek };
  streakCache = { k: tk, v };
  return v;
}
const level = () => streak().consistentWeeks;

// Progressive overload: every consistent week = +1 level. Weight goes up a step every
// 2 levels (reps climb in between), slowing to every 3 levels after ~3 months.
const bumps = l => (l <= 12 ? Math.floor(l / 2) : 6 + Math.floor((l - 12) / 3));
function weeksUntilBump(l) { const n = bumps(l); let k = 1; while (bumps(l + k) === n && k < 10) k++; return k; }

function variantFor(day) {
  if (!D.startDayKey) return 0;
  const days = Math.round((wStart(day) - wStart(startDay())) / 86400000);
  return Math.abs(Math.floor(days / 7)) % 2;
}

function strengthFactor(p) {
  let f = { beginner: 1, intermediate: 1.3, experienced: 1.6 }[p.experience] || 1;
  if (p.age < 16) f *= 0.8; else if (p.age >= 60) f *= 0.75; else if (p.age >= 45) f *= 0.9;
  if (p.weightLb < 120) f *= 0.85; else if (p.weightLb > 210) f *= 1.1;
  return f;
}
const headStart = p => ({ beginner: 0, intermediate: 2, experienced: 4 }[p.experience] || 0);
const proteinRange = p => [Math.round(p.weightLb * 0.6 / 5) * 5, Math.round(p.weightLb * 0.8 / 5) * 5];
const waterOz = p => Math.max(48, Math.round(p.weightLb / 2 / 8) * 8);
const sleepTarget = p => (p.age < 13 ? '9–12 hours' : p.age < 18 ? '8–10 hours' : '7–9 hours');
const firstName = () => (D.profile.name || '').trim().split(/\s+/)[0] || '';

function availableWeights(eq) {
  if (eq.kind === 'adjustable') {
    const out = [];
    if (!(eq.adjustableStep > 0) || eq.adjustableMax < eq.adjustableMin) return out;
    for (let w = eq.adjustableMin; w <= eq.adjustableMax + 0.001; w += eq.adjustableStep) out.push(Math.round(w * 100) / 100);
    return out;
  }
  return [...new Set(eq.fixedWeights)].sort((a, b) => a - b);
}
function snapWeight(eq, target) {
  const o = availableWeights(eq);
  if (!o.length) return null;
  let best = null;
  for (const w of o) if (w <= target + 0.01) best = w;
  return best ?? o[0];
}
function nextWeight(eq, cur, up) {
  let o = availableWeights(eq);
  if (!o.length) { o = []; for (let w = 2.5; w <= 150; w += 2.5) o.push(w); }
  if (up) return o.find(w => w > cur + 0.01) ?? cur;
  let r = cur;
  for (const w of o) if (w < cur - 0.01) r = w;
  return r;
}

function rx(ex, lvl, offset) {
  const b = bumps(lvl);
  if (ex.usesDumbbell) {
    const steps = Math.max(-2, b + offset);
    const target = Math.max(2.5, ex.baseWeight * strengthFactor(D.profile) + steps * ex.step);
    let reps = lvl % 2 === 0 ? ex.low : ex.high;
    let weight = Math.floor(target / 2.5) * 2.5;
    let needsHeavier = false;
    const snapped = snapWeight(D.equipment, target);
    if (snapped != null) {
      weight = snapped;
      const gap = target - snapped;
      if (gap > 0.01) {
        // You don't own that exact weight, so make up for it with reps.
        const missing = Math.max(1, Math.round(gap / ex.step));
        reps += Math.min(6, missing * 2);
        const top = availableWeights(D.equipment).slice(-1)[0];
        if (top != null && snapped >= top - 0.01 && missing >= 2) needsHeavier = true;
      }
    }
    return { ex, sets: 3, target: reps, weight, needsHeavier };
  }
  const steps = Math.max(0, b + offset + headStart(D.profile));
  const inc = ex.isTimed ? 5 : ex.repStep;
  return { ex, sets: 3, target: Math.min(ex.cap, ex.low + steps * inc), weight: null, needsHeavier: false };
}

function exerciseIDs(focus, variant, noDB) {
  const versions = LIB.plans[focus];
  if (!versions) return [];
  const ids = versions[Math.abs(variant) % versions.length];
  if (!noDB) return ids.slice();
  const out = [];
  for (const id of ids) {
    const e = EX[id];
    const use = e && e.usesDumbbell && e.alt ? e.alt : id;
    if (!out.includes(use)) out.push(use);
  }
  return out;
}
const usesBW = day => !D.equipment.hasDumbbells || D.noDumbbellDays.includes(dkey(day));
function rxList(focus, variant, noDB) {
  const lvl = level();
  return exerciseIDs(focus, variant, noDB).filter(id => EX[id]).map(id => rx(EX[id], lvl, D.feedbackOffsets[id] || 0));
}
const planForDay = day => rxList(focusFor(day), variantFor(day), usesBW(day));
const estMinutes = plan => Math.round(plan.reduce((a, r) => a + r.sets, 0) * (40 + D.settings.restSeconds) / 60) + 4;
function amountText(ex, target) {
  if (ex.isTimed) return ex.perSide ? `${target}s each side` : `${target}s`;
  return ex.perSide ? `${target} each side` : `${target} reps`;
}
const summary = r => `${r.sets} × ${amountText(r.ex, r.target)}${r.weight != null ? ' · ' + lb(r.weight) : ''}`;
const shortSummary = r => `${r.sets}×${r.ex.isTimed ? r.target + 's' : r.target}${r.weight != null ? ' · ' + lb(r.weight) : ''}`;

function excusesUsed(day) {
  const ws = wStart(day);
  let n = 0;
  for (let i = 0; i < 7; i++) { const r = D.records[dkey(addDays(ws, i))]; if (r && r.status === 'excused') n++; }
  return n;
}
const excusesLeft = () => Math.max(0, D.settings.maxExcusesPerWeek - excusesUsed(TODAY()));

function dayState(day) {
  const k = dkey(day);
  const r = D.records[k];
  if (r) return r.status === 'completed' ? 'completed' : 'excused';
  if (!D.startDayKey || k < D.startDayKey) return 'before';
  const tk = dkey(TODAY());
  if (k === tk) return 'today';
  if (focusFor(day) === 'rest') return 'rest';
  return k < tk ? 'missed' : 'upcoming';
}

function lockItems() {
  const p = D.profile;
  const [lo, hi] = proteinRange(p);
  return [
    { id: 'stretch', icon: '🧘', title: 'Cool down & stretch (5 min)', detail: 'Do the stretches below while your muscles are still warm. Helps with soreness and keeps you flexible.' },
    { id: 'water', icon: '💧', title: 'Drink 16–24 oz of water now', detail: `Aim for roughly ${waterOz(p)} oz across the whole day — more if you sweated a lot.` },
    { id: 'protein', icon: '🍗', title: 'Get 20–40 g of protein in the next 2 hours', detail: `Your daily target is about ${lo}–${hi} g. Easy wins: eggs, chicken, Greek yogurt, milk, tuna, beans, or a shake.` },
    { id: 'meal', icon: '🍚', title: 'Eat a real meal: protein + carbs + something green', detail: 'Carbs refill the energy you just burned, protein rebuilds the muscle. Rice, potatoes or pasta + meat, eggs or beans + veggies.' },
    { id: 'sleep', icon: '🌙', title: `Sleep ${sleepTarget(p)} tonight`, detail: 'Muscle is built while you sleep, not during the workout. This is where the gains actually lock in.' },
    { id: 'walk', icon: '🚶', title: 'Easy 10-minute walk later (bonus)', detail: "Light movement keeps blood flowing and makes tomorrow's soreness easier." }
  ];
}

// Short how-to videos for warm-up moves and stretches.
function moveVideoURL(name) {
  const q = name.replace(/\s*\(.*?\)/g, '').trim();
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(`${q} how to #shorts`);
}
function videoURL(ex) {
  const pinned = D.pinnedVideos[ex.id];
  if (pinned && /^https?:\/\//i.test(pinned)) return pinned;
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(`${ex.name} proper form #shorts`);
}

// ---------------------------------------------------------------- progress report (to paste into Claude)
function progressReport() {
  const p = D.profile, eq = D.equipment, st = streak(), today = TODAY();
  const fmtDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const lines = [];
  lines.push(`LOCK IN PROGRESS REPORT — ${fmtDay(today)}`);
  lines.push(`Me: ${p.name || '—'}, ${p.age}, ${num(p.weightLb)} lb, ${EXPERIENCE[p.experience] ? EXPERIENCE[p.experience].title : p.experience}`);
  lines.push(`Dumbbells: ${!eq.hasDumbbells ? 'none right now (no-dumbbell mode)' : eq.kind === 'adjustable' ? `adjustable ${lb(eq.adjustableMin)}–${lb(eq.adjustableMax)} in ${num(eq.adjustableStep)} lb steps` : 'pairs of ' + availableWeights(eq).map(num).join(', ') + ' lb'}`);
  lines.push(`Streak: ${plural(st.current, 'week')} (best ${st.best}) · Level ${st.consistentWeeks} · This week ${st.thisWeek.done}/${st.thisWeek.required}${D.startDayKey ? ' · Started ' + fmtDay(kdate(D.startDayKey)) : ''}`);
  lines.push(`Plan: ${D.settings.schedule.map((f, i) => WD_SHORT[i] + ' ' + FOCUS[f].short).join(', ')} · rest ${D.settings.restSeconds}s · ${D.settings.maxExcusesPerWeek} excuses/wk`);
  lines.push('');
  lines.push('LAST 14 DAYS');
  for (let i = 13; i >= 0; i--) {
    const day = addDays(today, -i);
    const k = dkey(day);
    if (D.startDayKey && k < D.startDayKey) continue;
    const rec = D.records[k], f = focusFor(day), state = dayState(day);
    let line = `- ${fmtDay(day)} · ${FOCUS[f].title}: `;
    if (rec && rec.status === 'completed') line += `DONE${rec.durationSeconds ? ` (${Math.max(1, Math.round(rec.durationSeconds / 60))} min)` : ''}${rec.noDumbbells ? ' no-dumbbell version' : ''}${rec.lockIn && rec.lockIn.length ? ` · lock-in ${rec.lockIn.length}/6` : ''}`;
    else if (rec) line += `EXCUSED (${rec.excuseReason || 'no reason'})`;
    else line += { rest: 'rest day', today: 'not done yet', missed: 'MISSED', upcoming: 'upcoming', before: '—' }[state] || state;
    lines.push(line);
    if (rec && rec.exercises) for (const e of rec.exercises) {
      lines.push(`    ${e.name}: ${e.setsDone}/${e.totalSets} sets × ${e.isTimed ? e.target + 's' : e.target}${e.weight != null ? ' @ ' + lb(e.weight) : ''}${e.feedback ? ' — ' + FEEDBACK[e.feedback].label : ''}`);
    }
  }
  const prs = Object.entries(D.personalBests).filter(([id]) => EX[id]).map(([id, w]) => `${EX[id].name} ${lb(w)}`);
  if (prs.length) { lines.push(''); lines.push('PERSONAL BESTS: ' + prs.join(' · ')); }
  const tweaks = Object.entries(D.feedbackOffsets).filter(([id, v]) => EX[id] && v).map(([id, v]) => `${EX[id].name} ${v > 0 ? '+' : ''}${v}`);
  if (tweaks.length) lines.push('AUTO-ADJUSTMENTS (steps): ' + tweaks.join(' · '));
  const log = D.bodyweightLog.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  if (log.length) lines.push('BODY WEIGHT: ' + log.slice(-6).map(e => `${num(e.weightLb)} (${new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`).join(' → '));
  const upcoming = planForDay(addDays(today, D.records[dkey(today)] ? 1 : 0));
  lines.push('');
  lines.push(`NEXT WORKOUT (${FOCUS[focusFor(addDays(today, D.records[dkey(today)] ? 1 : 0))].title}): ` + (upcoming.length ? upcoming.map(r => `${r.ex.name} ${shortSummary(r)}`).join(' · ') : 'rest day'));
  return lines.join('\n');
}

// ---------------------------------------------------------------- data changes
function ensureWeekPlans() {
  if (!D.startDayKey) return false;
  let ws = wStart(startDay());
  const cur = dkey(wStart(TODAY()));
  let changed = false, guard = 0;
  while (dkey(ws) <= cur && guard++ < 1500) {
    const k = dkey(ws);
    if (!Array.isArray(D.weekPlans[k])) { D.weekPlans[k] = D.settings.schedule.slice(); changed = true; }
    ws = addDays(ws, 7);
  }
  return changed;
}

function updateSchedule(s) {
  D.settings.schedule = s;
  D.weekPlans[dkey(wStart(TODAY()))] = s.slice(); // applies to this week too; past weeks keep their plan
  commit();
}

// Change one day's workout. If that workout is planned later this week, the two days swap.
function switchFocus(day, nf) {
  const orig = focusFor(day);
  if (nf === orig) return null;
  const ws = wStart(day);
  let partner = null;
  for (let i = 0; i < 7; i++) {
    const other = addDays(ws, i);
    if (dkey(other) <= dkey(day)) continue;
    if (!D.records[dkey(other)] && focusFor(other) === nf) { partner = other; break; }
  }
  if (partner) D.overrides[dkey(partner)] = orig;
  D.overrides[dkey(day)] = nf;
  if (D.inProgress && D.inProgress.dayKey === dkey(day)) D.inProgress = null;
  commit();
  return partner;
}

function setNoDumbbells(day, on) {
  const k = dkey(day);
  D.noDumbbellDays = D.noDumbbellDays.filter(x => x !== k);
  if (on) D.noDumbbellDays.push(k);
  if (D.inProgress && D.inProgress.dayKey === k) D.inProgress = null;
  commit();
}

function excuseDay(day, reason) {
  const k = dkey(day);
  D.records[k] = { key: k, focus: focusFor(day), status: 'excused', excuseReason: reason, finishedAt: new Date().toISOString(), durationSeconds: null, noDumbbells: false, exercises: [], lockIn: [] };
  if (D.inProgress && D.inProgress.dayKey === k) D.inProgress = null;
  commit();
}
function markDone(day) {
  const k = dkey(day);
  D.records[k] = { key: k, focus: focusFor(day), status: 'completed', excuseReason: null, finishedAt: new Date().toISOString(), durationSeconds: null, noDumbbells: false, exercises: [], lockIn: [] };
  commit();
}
function clearDay(day) { delete D.records[dkey(day)]; commit(); }

function getSession(day) {
  const k = dkey(day);
  if (D.inProgress && D.inProgress.dayKey === k) return D.inProgress;
  const items = planForDay(day).map(r => ({
    id: r.ex.id, sets: r.sets, target: r.target, prescribedTarget: r.target,
    weight: r.weight, prescribedWeight: r.weight, setsDone: 0, feedback: null
  }));
  D.inProgress = { dayKey: k, focus: focusFor(day), startedAt: new Date().toISOString(), noDumbbells: usesBW(day), items, warmupDone: false };
  persist();
  return D.inProgress;
}

function finishWorkout() {
  const s = D.inProgress;
  if (!s) return;
  const logged = [];
  for (const it of s.items) {
    const ex = EX[it.id];
    if (!ex) continue;
    logged.push({ id: it.id, name: ex.name, weight: it.weight, target: it.target, isTimed: ex.isTimed, oneDumbbell: ex.oneDumbbell, setsDone: it.setsDone, totalSets: it.sets, feedback: it.feedback });
    // Learn from how it went so next time fits you better.
    let delta = 0;
    if (it.feedback === 'tooEasy') delta++;
    if (it.feedback === 'tooHard') delta--;
    if (ex.usesDumbbell && ex.step > 0 && it.weight != null && it.prescribedWeight != null) delta += Math.round((it.weight - it.prescribedWeight) / ex.step);
    if (!ex.usesDumbbell) delta += Math.trunc((it.target - it.prescribedTarget) / (ex.isTimed ? 5 : Math.max(1, ex.repStep)));
    if (delta) D.feedbackOffsets[it.id] = Math.max(-4, Math.min(8, (D.feedbackOffsets[it.id] || 0) + delta));
    if (it.weight != null && it.setsDone > 0 && it.weight > (D.personalBests[it.id] || 0)) D.personalBests[it.id] = it.weight;
  }
  const duration = Math.min(3 * 3600, Math.max(0, Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000)));
  const prev = D.records[s.dayKey];
  D.records[s.dayKey] = { key: s.dayKey, focus: s.focus, status: 'completed', excuseReason: null, finishedAt: new Date().toISOString(), durationSeconds: duration, noDumbbells: s.noDumbbells, exercises: logged, lockIn: (prev && prev.lockIn) || [] };
  D.inProgress = null;
  ui.timer = null;
  if (ui.workout) ui.workout.finished = true;
  ui.resetScroll = 'workout';
  commit();
}

// ---------------------------------------------------------------- UI state
const ui = {
  tab: 'today',
  ob: 0,
  sheets: [],
  workout: null, // { dayKey, finished }
  timer: null,   // { end, total, hold, idx }
  calOffset: 0,
  dayOffset: 0,   // 0 = today, -1 = yesterday ...
  reorder: false,
  skipInstall: false
};
const topSheet = () => ui.sheets[ui.sheets.length - 1];
function openSheet(s) { ui.sheets.push(s); ui.animateSheet = true; render(); }
function closeSheet() { ui.sheets.pop(); render(); }

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

let toastTimer = null;
function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ---------------------------------------------------------------- sound + screen
let audioCtx = null;
function unlockAudio() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'transient';
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* sound is optional */ }
}
function beep(times) {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = i === times - 1 ? 1175 : 880;
      o.connect(g); g.connect(audioCtx.destination);
      const s = t0 + i * 0.22;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.35, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
      o.start(s); o.stop(s + 0.2);
    }
  } catch (e) { /* ignore */ }
}
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { wakeLock = null; }
}

// ---------------------------------------------------------------- small pieces of HTML
const sh = (title, right = '') => `<div class="sh"><span>${esc(title)}</span>${right}</div>`;
const pill = t => `<span class="pill">${esc(t)}</span>`;
function bar(value, total, color) {
  const pct = total > 0 ? Math.min(100, Math.round(value / total * 100)) : 0;
  return `<div class="bar"><i style="width:${pct}%;${color ? 'background:' + color : ''}"></i></div>`;
}
const stateColor = { completed: 'var(--ok)', excused: 'var(--warn)', missed: 'rgba(255,82,82,.35)', rest: 'rgba(255,255,255,.07)', today: 'rgba(255,107,26,.22)', upcoming: 'var(--card2)', before: 'transparent' };

// ---------------------------------------------------------------- screens
function render() {
  const app = document.getElementById('app');
  const scrolls = {};
  document.querySelectorAll('[data-scroll]').forEach(el => { scrolls[el.dataset.scroll] = el.scrollTop; });

  if (isIOS && !isStandalone && !D.onboarded && !ui.skipInstall) app.innerHTML = installHTML();
  else app.innerHTML = D.onboarded ? mainHTML() : onboardingHTML();

  document.querySelectorAll('[data-scroll]').forEach(el => {
    const key = el.dataset.scroll;
    if (ui.resetScroll === key) el.scrollTop = 0;
    else if (scrolls[key] != null) el.scrollTop = scrolls[key];
  });
  ui.resetScroll = null;
  ui.animateSheet = false;
  document.body.classList.toggle('locked', ui.sheets.length > 0 || !!ui.workout);
}

function installHTML() {
  return `<div class="screen center">
    <div class="hero-flame">🔥</div>
    <h1 class="mega">LOCK IN</h1>
    <p class="muted lead">One step before you start: add Lock In to your Home Screen. That's what makes it a real app — it opens full screen, works offline, and keeps your progress saved.</p>
    <div class="card steps">
      <div class="step"><b>1</b><span>Tap the <strong>Share</strong> button <span class="shareglyph">⬆︎</span> in Safari's toolbar</span></div>
      <div class="step"><b>2</b><span>Scroll down and tap <strong>Add to Home Screen</strong></span></div>
      <div class="step"><b>3</b><span>Tap <strong>Add</strong>, then open <strong>Lock In</strong> from your Home Screen</span></div>
    </div>
    <p class="muted sm">Your progress lives inside the Home Screen app, so set it up there — not in this Safari tab.</p>
    <button class="link sm" data-a="skipInstall">Continue in Safari anyway</button>
  </div>`;
}

// ---------- onboarding
function onboardingHTML() {
  const steps = [obWelcome, obAbout, obExperience, obDumbbells, obWeek];
  const last = steps.length - 1;
  return `<div class="screen ob">
    <div class="dots">${steps.map((_, i) => `<i class="${i <= ui.ob ? 'on' : ''}"></i>`).join('')}</div>
    ${steps[ui.ob]()}
    <div class="ob-nav">
      ${ui.ob > 0 ? '<button class="btn ghost" data-a="obBack">Back</button>' : ''}
      <button class="btn primary" data-a="obNext">${ui.ob === last ? "Let's lock in" : 'Next'}</button>
    </div>
  </div>`;
}
function obHead(title, sub) { return `<h1>${esc(title)}</h1><p class="muted lead">${esc(sub)}</p>`; }
function obWelcome() {
  return `<div class="hero-flame">🔥</div><h1 class="mega">LOCK IN</h1>
    <p class="muted lead">Your own training plan. A new muscle group every day, weights that grow as you stay consistent, and a weekly streak to protect.</p>
    <label class="field"><span>What should I call you?</span>
      <input type="text" placeholder="Your name" autocomplete="given-name" autocapitalize="words" value="${esc(D.profile.name)}" data-in="name"></label>`;
}
function obAbout() {
  return `${obHead('About you', 'Used to set your starting weights plus protein, water and sleep targets. It never leaves this phone.')}
    <div class="card"><label class="field"><span>Age</span>${selectHTML('age', range(10, 90), D.profile.age, v => v + ' years')}</label></div>
    <div class="card"><label class="field"><span>Weight</span>${selectHTML('weight', range(70, 400), Math.round(D.profile.weightLb), v => v + ' lb')}</label></div>`;
}
function obExperience() {
  return `${obHead('Lifting experience', 'Everyone starts light here on purpose — form first, then the weights climb as you stay consistent.')}
    ${Object.entries(EXPERIENCE).map(([k, e]) => `<button class="card choice ${D.profile.experience === k ? 'sel' : ''}" data-a="setExp" data-v="${k}">
      <span class="radio">${D.profile.experience === k ? '●' : ''}</span><span><strong>${e.title}</strong><span class="muted sm block">${e.detail}</span></span></button>`).join('')}`;
}
function obDumbbells() {
  return `${obHead('Dumbbells', "Tell me what you've got. If they're still on the way, you can start today with no-dumbbell versions and keep your streak going.")}
    <div class="card">${dumbbellEditorHTML()}</div>
    ${!D.equipment.hasDumbbells ? `<div class="card note">📦 No problem. Every workout has a bodyweight version. When your dumbbells arrive, flip the switch on in the Me tab.</div>` : ''}`;
}
function obWeek() {
  return `${obHead('Your week', 'A new focus every day. You can move days around or add break days anytime in the Plan tab.')}
    <div class="card list">${D.settings.schedule.map((f, i) => `<div class="li static"><span class="wd">${WD_SHORT[i]}</span><span class="fi">${FOCUS[f].icon}</span><span class="grow"><strong>${FOCUS[f].title}</strong></span></div>`).join('')}</div>
    <p class="muted sm">🕒 Each day stays open until 3:00 AM, so a late-night session still counts.</p>`;
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
function selectHTML(name, values, current, label, extra = '') {
  return `<select data-ch="${name}" ${extra}>${values.map(v => `<option value="${v}" ${String(v) === String(current) ? 'selected' : ''}>${esc(label ? label(v) : v)}</option>`).join('')}</select>`;
}
function dumbbellEditorHTML() {
  const eq = D.equipment;
  let html = `<div class="toggle-row"><span>I have dumbbells right now</span>${toggleHTML('hasDB', eq.hasDumbbells)}</div>`;
  if (eq.hasDumbbells) {
    html += `<div class="seg">${[['fixedPairs', 'Fixed pairs'], ['adjustable', 'Adjustable']].map(([k, l]) => `<button class="${eq.kind === k ? 'on' : ''}" data-a="setKind" data-v="${k}">${l}</button>`).join('')}</div>`;
    if (eq.kind === 'fixedPairs') {
      html += `<p class="muted sm">Tap every pair you own (lb)</p><div class="chips">${CHIP_WEIGHTS.map(w => `<button class="chip ${eq.fixedWeights.includes(w) ? 'on' : ''}" data-a="chip" data-v="${w}">${num(w)}</button>`).join('')}</div>`;
    } else {
      html += stepperHTML('Lightest', lb(eq.adjustableMin), 'adjMin') + stepperHTML('Heaviest', lb(eq.adjustableMax), 'adjMax');
      html += `<div class="seg">${[[2.5, '2.5 lb jumps'], [5, '5 lb jumps']].map(([v, l]) => `<button class="${eq.adjustableStep === v ? 'on' : ''}" data-a="adjStep" data-v="${v}">${l}</button>`).join('')}</div>`;
    }
  }
  return html;
}
const toggleHTML = (act, on) => `<button class="switch ${on ? 'on' : ''}" data-a="${act}" role="switch" aria-checked="${on}"><i></i></button>`;
const stepperHTML = (label, value, act) => `<div class="stepper"><span>${esc(label)}</span><div class="stepbtns"><button data-a="${act}" data-d="-1">−</button><b>${esc(value)}</b><button data-a="${act}" data-d="1">+</button></div></div>`;

// ---------- main
function mainHTML() {
  const tabs = { today: todayHTML, plan: planHTML, progress: progressHTML, me: meHTML };
  const banner = isIOS && !isStandalone ? `<div class="card note warnnote">📲 You're in a Safari tab. Add Lock In to your Home Screen (Share → Add to Home Screen) — progress saved in this tab won't carry over.</div>` : '';
  return `<div class="screen">${banner}${tabs[ui.tab]()}</div>
    <nav class="tabbar">${[['today', '🔥', 'Today'], ['plan', '📅', 'Plan'], ['progress', '📈', 'Progress'], ['me', '👤', 'Me']]
      .map(([k, ic, l]) => `<button class="tab ${ui.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}"><span>${ic}</span>${l}</button>`).join('')}</nav>
    ${ui.workout ? workoutHTML() : ''}
    ${ui.sheets.length ? sheetHTML(topSheet()) : ''}`;
}

// ---------- today
function greeting() {
  const h = new Date().getHours();
  const part = h < 3 || h >= 22 ? 'Late night grind' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const n = firstName();
  return n ? `${part}, ${esc(n)}` : part;
}
function dayWord(day) {
  const diff = Math.round((TODAY() - day) / 86400000);
  return diff === 0 ? 'TODAY' : diff === 1 ? 'YESTERDAY' : diff === -1 ? 'TOMORROW' : wdName(day).toUpperCase();
}
function dayNavHTML(day) {
  const prev = addDays(day, -1);
  const canBack = D.startDayKey && dkey(prev) >= D.startDayKey && ui.dayOffset > -6;
  const label = ui.dayOffset === 0 ? 'Today' : ui.dayOffset === -1 ? 'Yesterday' : ui.dayOffset === 1 ? 'Tomorrow' : wdName(day);
  const date = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `<div class="daynav"><button class="mini" data-a="dayNav" data-d="-1" ${canBack ? '' : 'disabled'}>‹</button>
    <span><strong>${label}</strong> <span class="muted sm">· ${date}</span></span>
    <button class="mini" data-a="dayNav" data-d="1" ${ui.dayOffset >= 6 ? 'disabled' : ''}>›</button></div>`;
}
function todayHTML() {
  const day = addDays(TODAY(), ui.dayOffset);
  const f = focusFor(day);
  const rec = D.records[dkey(day)];
  let card;
  if (rec) card = rec.status === 'completed' ? completedCardHTML(rec, day) : excusedCardHTML(rec, day);
  else if (f === 'rest') card = restCardHTML(day);
  else card = workoutCardHTML(day, f);
  const backupNag = shouldNagBackup() ? `<button class="card note" data-a="tab" data-v="me">💾 It's been a while since your last backup. Tap to save one in the Me tab.</button>` : '';
  return `<div class="greet">${greeting()}</div><h1>Lock In</h1>
    ${streakCardHTML()}
    ${dayNavHTML(day)}
    ${!D.equipment.hasDumbbells ? `<div class="card note">📦 <strong>No-dumbbell mode.</strong> Waiting on dumbbells? Every workout uses bodyweight versions until you turn dumbbells on in the Me tab.</div>` : ''}
    ${card}
    ${weekStripHTML()}
    ${backupNag}`;
}
function shouldNagBackup() {
  const workouts = Object.values(D.records).filter(r => r.status === 'completed').length;
  if (workouts < 5) return false;
  if (!D.lastBackup) return true;
  return Date.now() - new Date(D.lastBackup).getTime() > 21 * 86400000;
}
function streakCardHTML() {
  const s = streak();
  const w = s.thisWeek;
  let line;
  if (w.required === 0) line = 'No workouts left to count this week. Fresh week starts Monday.';
  else if (w.consistent) line = `This week is locked in ✓ ${w.done}/${w.required}. Streak +1.`;
  else if (!w.possible) line = 'Missed a day this week, so the streak resets. Fresh start Monday — your weights stay.';
  else {
    const left = excusesLeft(), b = weeksUntilBump(s.consistentWeeks);
    line = `This week: ${w.done}/${w.required} · ${plural(left, 'excuse')} left · weights go up in ${plural(b, 'consistent week')}`;
  }
  return `<div class="card">
    <div class="row"><div class="flame ${s.current > 0 ? 'on' : ''}">🔥</div>
      <div class="grow"><div class="big">${plural(s.current, 'week')}</div><div class="muted sm">streak · best ${s.best}</div></div>
      <div class="lvl"><span>LEVEL</span><b>${s.consistentWeeks}</b></div></div>
    ${bar(Math.min(w.done, Math.max(w.required, 1)), Math.max(w.required, 1), w.consistent ? 'var(--ok)' : '')}
    <div class="muted xs">${line}</div></div>`;
}
function deadlineHTML(day) {
  if (dkey(day) > dkey(TODAY())) return `<div class="deadline">⏩ Coming up — doing it now counts for ${wdName(day)}, ${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.</div>`;
  if (dkey(day) < dkey(TODAY())) return `<div class="deadline warn">⏪ Catching up — this counts for ${wdName(day)}, ${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.</div>`;
  const now = new Date();
  const left = (deadline(day) - now) / 1000;
  const after = dkey(now) !== dkey(day);
  return after
    ? `<div class="deadline warn">🕒 Past midnight — this still counts for ${wdName(day)}. ${hm(left)} left until 3 AM.</div>`
    : `<div class="deadline">🕒 Counts until 3:00 AM · ${hm(left)} left</div>`;
}
function workoutCardHTML(day, f) {
  const k = dkey(day);
  const plan = planForDay(day);
  const resuming = D.inProgress && D.inProgress.dayKey === k;
  const bw = usesBW(day);
  const F = FOCUS[f];
  return `<div class="card">
    <div class="row top"><div class="grow">
      <div class="eyebrow" style="color:${F.color}">${dayWord(day) === 'TODAY' ? 'TODAY · ' + wdName(day).toUpperCase() : dayWord(day)}</div>
      <div class="title">${F.title}</div>
      <div class="muted sm">${plan.length} exercises · ~${estMinutes(plan)} min${bw ? ' · no dumbbells' : ''}</div></div>
      <div class="ficon">${F.icon}</div></div>
    ${deadlineHTML(day)}
    <div class="list">${plan.map(r => `<button class="li" data-a="ex" data-id="${r.ex.id}"><span class="grow">${esc(r.ex.name)}</span><span class="muted sm">${shortSummary(r)}</span><span class="play">▶</span></button>`).join('')}</div>
    <button class="btn primary" data-a="start" data-k="${k}">▶ ${resuming ? 'Resume workout' : 'Start workout'}</button>
    <div class="actions">
      <button class="act" data-a="switchSheet" data-k="${k}"><b>⇄</b>Switch</button>
      ${D.equipment.hasDumbbells ? `<button class="act" data-a="toggleBW" data-k="${k}"><b>${bw ? '🏋️' : '🤸'}</b>${bw ? 'Use dumbbells' : 'No dumbbells'}</button>` : ''}
      <button class="act" data-a="excuseSheet" data-k="${k}"><b>⏸</b>Excuse</button>
    </div></div>`;
}
function restCardHTML(day) {
  return `<div class="card">
    <div class="row top"><div class="grow">
      <div class="eyebrow">${dayWord(day) === 'TODAY' ? 'TODAY · ' + wdName(day).toUpperCase() : dayWord(day)}</div><div class="title">Rest day</div>
      <div class="muted sm">Recovery is when muscle actually grows. Your streak is safe.</div></div><div class="ficon">😴</div></div>
    ${sh('Optional active recovery')}
    <ul class="plain">${LIB.restIdeas.map(t => `<li>✓ ${esc(t)}</li>`).join('')}</ul>
    <button class="btn ghost" data-a="switchSheet" data-k="${dkey(day)}">⇄ Train anyway (swaps days)</button></div>`;
}
function completedCardHTML(rec, day) {
  const items = lockItems();
  const done = items.filter(i => rec.lockIn.includes(i.id)).length;
  const all = done >= items.length;
  const parts = [];
  if (rec.durationSeconds) parts.push(`${Math.max(1, Math.round(rec.durationSeconds / 60))} min`);
  const sets = (rec.exercises || []).reduce((a, e) => a + e.setsDone, 0);
  if (sets) parts.push(`${sets} sets`);
  const tomorrow = focusFor(addDays(day, 1));
  return `<div class="card">
    <div class="row"><div class="ficon ok">✅</div><div class="grow"><div class="title sm">${FOCUS[rec.focus].title} — done</div><div class="muted sm">${parts.join(' · ') || 'Logged'}</div></div></div>
    <button class="btn ${all ? 'okbtn' : 'primary'}" data-a="lockinSheet" data-k="${rec.key}">${all ? '🔒 Locked in' : `🔓 Lock it in · ${done}/${items.length}`}</button>
    <div class="muted sm">${tomorrow === 'rest' ? 'Tomorrow: rest day. You earned it.' : `Tomorrow: ${FOCUS[tomorrow].title}.`}</div></div>`;
}
function excusedCardHTML(rec, day) {
  return `<div class="card">
    <div class="row"><div class="ficon">⏸️</div><div class="grow"><div class="title sm">Excused</div><div class="muted sm">${esc(rec.excuseReason || 'Taking the day')}</div></div></div>
    <div class="muted sm">Your streak is safe. Rest up and come back strong.</div>
    <button class="btn ghost" data-a="undoExcuse" data-k="${dkey(day)}">↩ Changed my mind — I'll train</button></div>`;
}
function weekStripHTML() {
  const ws = wStart(TODAY());
  const tk = dkey(TODAY());
  const icon = { completed: '✓', excused: '⏸', missed: '✕', rest: '😴', before: '–' };
  return `<div class="card">${sh('This week')}<div class="week">${range(0, 6).map(i => {
    const d = addDays(ws, i), st = dayState(d), f = focusFor(d);
    const isToday = dkey(d) === tk;
    return `<button class="wday" data-a="daySheet" data-k="${dkey(d)}"><span class="${isToday ? 'acc' : 'muted'}">${WD_LETTER[i]}</span>
      <i class="bub ${isToday ? 'ring' : ''}" style="background:${stateColor[st]}">${icon[st] || FOCUS[f].icon}</i>
      <small class="muted">${FOCUS[f].short}</small></button>`;
  }).join('')}</div></div>`;
}

// ---------- workout player
function workoutHTML() {
  const w = ui.workout;
  if (w.finished) {
    return `<div class="overlay" data-scroll="workout"><div class="ov-top"><span></span><span class="muted sm">Workout saved ✓</span><button class="link" data-a="closeWorkout">Done</button></div>
      <div class="pad">${lockInBodyHTML(w.dayKey, true)}<button class="btn primary" data-a="closeWorkout">Done</button></div></div>`;
  }
  const s = getSession(kdate(w.dayKey));
  const F = FOCUS[s.focus];
  const total = s.items.reduce((a, it) => a + it.sets, 0);
  const done = s.items.reduce((a, it) => a + Math.min(it.setsDone, it.sets), 0);
  const all = total > 0 && done >= total;
  return `<div class="overlay" data-scroll="workout">
    <div class="ov-top"><button class="link" data-a="closeWorkout">Close</button><span class="muted xs">Progress is saved</span><span id="elapsed" class="mono muted sm">${clock((Date.now() - new Date(s.startedAt)) / 1000)}</span></div>
    <div class="pad">
      <div class="eyebrow" style="color:${F.color}">${F.icon} ${F.title.toUpperCase()} ${s.noDumbbells ? pill('No dumbbells') : ''}</div>
      <div class="big">${done}/${total} sets</div>
      ${bar(done, total, F.color)}
      ${warmupHTML(s)}
      ${s.items.map((it, i) => exerciseCardHTML(it, i)).join('')}
      <button class="btn ${all ? 'okbtn' : 'primary'}" data-a="finish">🏁 Finish workout</button>
      <div class="timer-space ${ui.timer ? '' : 'hidden'}"></div>
    </div>
    ${timerBarHTML()}
  </div>`;
}
function warmupHTML(s) {
  const moves = LIB.warmups[s.focus] || LIB.warmups.fullBody;
  return `<div class="card">${sh('Warm-up · ~3 min', `<button class="link sm ${s.warmupDone ? 'okc' : ''}" data-a="warmupDone">${s.warmupDone ? 'Done ✓' : 'Mark done'}</button>`)}
    ${s.warmupDone ? '' : `<div class="list">${moves.map(([n, sec]) => `<button class="li" data-a="warmMove" data-v="${sec}"><span class="grow">${esc(n)}</span><span class="muted sm">${sec}s</span><span class="play">▶</span></button>`).join('')}</div>
    <div class="muted xs">Tap a move to start its timer. Warm muscles lift more and get hurt less.</div>`}</div>`;
}
function exerciseCardHTML(it, i) {
  const ex = EX[it.id];
  if (!ex) return '';
  const fin = it.setsDone >= it.sets;
  const amountLabel = ex.isTimed ? (ex.perSide ? 'sec / side' : 'seconds') : (ex.perSide ? 'reps / side' : 'reps');
  let html = `<div class="card ${fin ? 'dim' : ''}">
    <div class="row top"><div class="grow"><div class="ex-name ${fin ? 'struck' : ''}">${i + 1}. ${esc(ex.name)}</div><div class="muted xs">${esc(ex.muscles)}</div></div>
      <button class="formbtn" data-a="ex" data-id="${ex.id}">▶ Form</button></div>
    <div class="adjs">`;
  if (ex.usesDumbbell && it.weight != null) html += adjusterHTML(ex.oneDumbbell ? '1 dumbbell' : 'each hand', lb(it.weight), 'wt', i);
  html += adjusterHTML(amountLabel, String(it.target), 'tg', i) + `</div>
    <div class="sets">${range(0, it.sets - 1).map(n => `<button class="setb ${n < it.setsDone ? 'done' : ''}" data-a="set" data-i="${i}" data-n="${n}">${n < it.setsDone ? '✓' : (n + 1) + (ex.isTimed ? '<small>⏱</small>' : '')}</button>`).join('')}</div>`;
  if (ex.isTimed && !fin) html += `<div class="muted xs">Tap a set to start the ${it.target}s timer.</div>`;
  if (fin) {
    html += `<div class="fb"><div class="sm"><strong>How did that feel?</strong></div><div class="fbrow">${Object.entries(FEEDBACK).map(([k, f]) =>
      `<button class="${it.feedback === k ? 'on' : ''}" style="${it.feedback === k ? 'background:' + f.color + ';color:#000' : ''}" data-a="fb" data-i="${i}" data-v="${k}">${f.label}</button>`).join('')}</div>
      <div class="muted xs">${it.feedback ? FEEDBACK[it.feedback].hint : 'Your answer fine-tunes this exercise for next time.'}</div></div>`;
  }
  return html + '</div>';
}
const adjusterHTML = (label, value, act, i) => `<div class="adj"><div class="adjbox"><button data-a="${act}" data-i="${i}" data-d="-1">−</button><b>${esc(value)}</b><button data-a="${act}" data-i="${i}" data-d="1">+</button></div><small class="muted">${esc(label)}</small></div>`;
function timerBarHTML() {
  const t = ui.timer;
  if (!t) return '<div id="timerbar" class="timerbar hidden"></div>';
  const rem = Math.max(0, Math.ceil((t.end - Date.now()) / 1000));
  const color = t.hold ? 'var(--accent)' : 'var(--ok)';
  return `<div id="timerbar" class="timerbar">
    <div class="row"><div class="tlabel" style="color:${color}">${t.hold ? 'GO — HOLD IT' : 'REST'}</div>
      <div id="tval" class="tval mono">${rem}s</div>
      ${t.hold ? '' : '<button class="tbtn" data-a="timerAdd">+15s</button>'}
      <button class="tbtn solid" style="background:${color}" data-a="timerSkip">${t.hold ? 'Done' : 'Skip'}</button></div>
    <div class="bar thin"><i id="tprog" style="width:${Math.min(100, rem / t.total * 100)}%;background:${color}"></i></div></div>`;
}

// ---------- lock it in
function lockInBodyHTML(k, justFinished) {
  const rec = D.records[k];
  const f = rec ? rec.focus : 'fullBody';
  const items = lockItems();
  const checked = rec ? rec.lockIn : [];
  const s = streak();
  const sets = rec ? rec.exercises.reduce((a, e) => a + e.setsDone, 0) : 0;
  const mins = rec && rec.durationSeconds ? Math.max(1, Math.round(rec.durationSeconds / 60)) : 0;
  let volume = 0;
  if (rec) for (const e of rec.exercises) if (e.weight != null && !e.isTimed) volume += e.weight * e.target * e.setsDone * (e.oneDumbbell ? 1 : 2);
  const next = focusFor(addDays(kdate(k), 1));
  const cooldown = LIB.cooldowns[f] || LIB.cooldowns.fullBody;
  return `<div class="card">
      <div class="row"><div class="flame on">🔥</div><div class="grow"><div class="title sm">${justFinished ? 'Workout complete' : FOCUS[f].title + ' — done'}</div>
      <div class="muted sm">${plural(s.current, 'week')} streak · this week ${s.thisWeek.done}/${s.thisWeek.required}</div></div></div>
      <div class="minis"><div><b>${mins || '—'}</b><small>min</small></div><div><b>${sets}</b><small>sets</small></div><div><b>${volume ? num(volume) : '—'}</b><small>lb moved</small></div></div></div>
    ${sh(`Lock it in · ${items.filter(i => checked.includes(i.id)).length}/${items.length}`)}
    <p class="muted sm">What you do in the next few hours decides how much of today's work sticks. Tap each one as you do it.</p>
    ${items.map(it => `<button class="card lock ${checked.includes(it.id) ? 'on' : ''}" data-a="lockToggle" data-k="${k}" data-v="${it.id}">
      <span class="check">${checked.includes(it.id) ? '✓' : ''}</span><span class="grow"><strong>${it.icon} ${esc(it.title)}</strong><span class="muted sm block">${esc(it.detail)}</span></span></button>`).join('')}
    <div class="card">${sh('Cool-down stretches')}<div class="list">${cooldown.map(([n, sec]) => `<a class="li" href="${esc(moveVideoURL(n))}" target="_blank" rel="noopener"><span class="grow">🧘 ${esc(n)}</span><span class="muted sm">${sec}s</span><span class="play">▶</span></a>`).join('')}</div>
      <div class="muted xs">Tap a stretch to watch a quick video on how to do it. Breathe slowly and ease in — it should feel like a pull, never pain.</div></div>
    <div class="card"><div class="row top"><div class="ficon">${FOCUS[next].icon}</div><div class="grow"><strong>${next === 'rest' ? 'Tomorrow: Rest day' : 'Tomorrow: ' + FOCUS[next].title}</strong>
      <div class="muted sm">${next === 'rest' ? "Recovery day. Walk, stretch, eat well and sleep — that's where today's work turns into muscle." : "Get to bed on time and have water ready. If you're sore, the warm-up will loosen you up."}</div></div></div></div>
    <div class="card"><div class="row top"><div class="ficon">🩹</div><div class="grow"><strong>Sore tomorrow?</strong>
      <div class="muted sm">A dull ache for 1–3 days is normal, especially with new moves. Sharp pain, joint pain, or pain that gets worse when you move is not — skip that exercise, rest it, and check with a doctor if it doesn't improve.</div></div></div></div>`;
}

// ---------- plan
function planHTML() {
  const s = D.settings.schedule;
  const tIdx = wIdx(TODAY());
  const training = s.filter(f => f !== 'rest').length;
  const goal = Math.min(D.settings.weeklyGoal || 0, training);
  return `<h1>Plan</h1>
    <div class="card">${sh('Your week', `<button class="link sm" data-a="reorder">${ui.reorder ? 'Done' : 'Reorder'}</button>`)}
      <div class="list">${s.map((f, i) => `<div class="li static"><span class="wd ${i === tIdx ? 'acc' : ''}">${WD_SHORT[i]}</span><span class="fi">${FOCUS[f].icon}</span>
        ${ui.reorder
          ? `<span class="grow"><strong>${FOCUS[f].title}</strong></span><button class="mini" data-a="move" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''}>▲</button><button class="mini" data-a="move" data-i="${i}" data-d="1" ${i === 6 ? 'disabled' : ''}>▼</button>`
          : `<span class="grow">${selectHTML('dayFocus', FOCUS_KEYS, f, k => FOCUS[k].title, `data-i="${i}"`)}</span>`}</div>`).join('')}</div>
      <div class="muted xs">Tap a day to change it — set any day to Rest to add a break day. Use Reorder to move workouts between days. Need to change just today? Use Switch on the Today tab.</div></div>
    <div class="card">${sh('Streak rules')}
      <label class="field"><span>A consistent week is</span><select data-ch="goal"><option value="0" ${goal === 0 ? 'selected' : ''}>Every workout day</option>
        ${range(1, Math.max(1, training)).map(n => `<option value="${n}" ${goal === n ? 'selected' : ''}>${plural(n, 'workout')}</option>`).join('')}</select></label>
      ${stepperHTML('Excuses per week', String(D.settings.maxExcusesPerWeek), 'maxEx')}
      <div class="muted xs">Your streak counts weeks in a row where you hit this. Excused days never break it. Each day stays open until 3:00 AM the next morning.</div></div>
    <div class="card">${sh('Workouts & form videos')}<div class="list">${TRAINABLE.map(f => `<button class="li" data-a="preview" data-v="${f}"><span class="fi">${FOCUS[f].icon}</span><span class="grow">${FOCUS[f].title}</span><span class="muted">›</span></button>`).join('')}</div>
      <div class="muted xs">Each workout has two versions that alternate every week so it doesn't get stale.</div></div>
    <div class="card">${sh('How progress works')}<ol class="how">
      <li>Every week you stay consistent = +1 level.</li>
      <li>Reps go up first (10 → 12), then the weight goes up and reps reset.</li>
      <li>Tap Too easy / Too hard after each exercise and that move adjusts on its own.</li>
      <li>Changing the weight during a workout teaches the app too.</li>
      <li>Miss a week? The streak resets, but your weights never go backwards.</li></ol></div>`;
}

// ---------- progress
function progressHTML() {
  const s = streak();
  const total = Object.values(D.records).filter(r => r.status === 'completed').length;
  const b = weeksUntilBump(s.consistentWeeks);
  return `<h1>Progress</h1>
    <button class="btn primary" data-a="shareProgress" style="margin-bottom:14px">🤖 Send progress to Claude</button>
    <div class="tiles">
      <div class="card tile"><span>🔥</span><b>${s.current}</b><small>WEEKS</small><em>Current streak</em></div>
      <div class="card tile"><span>🏆</span><b>${s.best}</b><small>WEEKS</small><em>Best streak</em></div>
      <div class="card tile"><span>✅</span><b>${total}</b><small>TOTAL</small><em>Workouts done</em></div>
      <div class="card tile"><span>⚡</span><b>${s.consistentWeeks}</b><small>CONSISTENT WEEKS</small><em>Strength level</em></div></div>
    <div class="card">${sh('Next level-up')}<strong>Weights go up after ${plural(b, 'more consistent week')}</strong>
      <div class="muted sm">Every consistent week adds a level. Reps climb first, then the weight. Your Too easy / Too hard taps fine-tune each exercise on top of that.</div></div>
    ${calendarHTML()}
    ${bodyweightHTML()}
    ${weightsHTML()}`;
}
function calendarHTML() {
  const today = TODAY();
  const first = new Date(today.getFullYear(), today.getMonth() + ui.calOffset, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = wIdx(first);
  const tk = dkey(today);
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const day = new Date(first.getFullYear(), first.getMonth(), d);
    const st = dayState(day);
    const dark = st === 'completed' || st === 'excused';
    cells += `<button class="cal ${dkey(day) === tk ? 'ring' : ''}" style="background:${stateColor[st]};${dark ? 'color:#000;font-weight:700' : ''}" data-a="daySheet" data-k="${dkey(day)}">${d}</button>`;
  }
  return `<div class="card">
    <div class="calhead"><button class="mini" data-a="cal" data-d="-1">‹</button><strong>${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong><button class="mini" data-a="cal" data-d="1" ${ui.calOffset >= 0 ? 'disabled' : ''}>›</button></div>
    <div class="calgrid head">${WD_LETTER.map(l => `<span>${l}</span>`).join('')}</div>
    <div class="calgrid">${cells}</div>
    <div class="legend"><span><i style="background:var(--ok)"></i>Done</span><span><i style="background:var(--warn)"></i>Excused</span><span><i style="background:rgba(255,82,82,.6)"></i>Missed</span><span><i style="background:var(--card2)"></i>Rest / ahead</span></div>
    <div class="muted xs">Tap any day to see what you did, fix a day you forgot to log, or change an upcoming workout.</div></div>`;
}
function bodyweightHTML() {
  const log = D.bodyweightLog.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  let chart = '<div class="muted sm">Log your weight every week or two and your trend shows up here.</div>';
  if (log.length >= 2) {
    const ws = log.map(e => e.weightLb);
    const lo = Math.min(...ws) - 3, hi = Math.max(...ws) + 3;
    const t0 = new Date(log[0].date).getTime(), t1 = new Date(log[log.length - 1].date).getTime();
    const x = e => 10 + (t1 > t0 ? (new Date(e.date).getTime() - t0) / (t1 - t0) : 0.5) * 280;
    const y = e => 10 + (1 - (e.weightLb - lo) / (hi - lo)) * 100;
    const pts = log.map(e => `${x(e).toFixed(1)},${y(e).toFixed(1)}`).join(' ');
    chart = `<svg viewBox="0 0 300 120" class="chart"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${log.map(e => `<circle cx="${x(e).toFixed(1)}" cy="${y(e).toFixed(1)}" r="3.5" fill="var(--accent)"/>`).join('')}
      <text x="296" y="16" text-anchor="end">${num(hi - 3)} lb</text><text x="296" y="114" text-anchor="end">${num(lo + 3)} lb</text></svg>`;
  }
  const last = log[log.length - 1];
  return `<div class="card">${sh('Body weight', '<button class="link sm" data-a="weightSheet">＋ Log</button>')}${chart}
    ${last ? `<div class="muted xs">Latest: ${lb(last.weightLb)} · ${new Date(last.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>` : ''}</div>`;
}
function weightsHTML() {
  if (!D.equipment.hasDumbbells) return `<div class="card">${sh('Your working weights')}<div class="muted sm">Turn dumbbells on in the Me tab and your starting weights will show up here.</div></div>`;
  const lvl = level();
  const ids = [];
  for (const f of TRAINABLE) for (const v of LIB.plans[f]) for (const id of v) if (EX[id] && EX[id].usesDumbbell && !ids.includes(id)) ids.push(id);
  const rows = ids.map(id => rx(EX[id], lvl, D.feedbackOffsets[id] || 0));
  const top = availableWeights(D.equipment).slice(-1)[0];
  return `<div class="card">${sh('Your working weights')}<div class="list">${rows.map(r => `<div class="li static"><span class="grow sm">${esc(r.ex.name)}</span>
    ${D.personalBests[r.ex.id] ? `<span class="muted xs">PR ${lb(D.personalBests[r.ex.id])}</span>` : ''}<strong class="acc">${lb(r.weight)}</strong></div>`).join('')}</div>
    ${rows.some(r => r.needsHeavier) && top != null ? `<div class="warnc xs">⬆️ Some moves have outgrown your ${lb(top)} max. Heavier dumbbells would help — until then you get extra reps instead.</div>` : ''}</div>`;
}

// ---------- me
function meHTML() {
  const p = D.profile;
  const [lo, hi] = proteinRange(p);
  return `<h1>Me</h1>
    <div class="card">${sh('You')}
      <label class="field"><span>Name</span><input type="text" value="${esc(p.name)}" autocapitalize="words" data-in="name"></label>
      ${stepperHTML('Age', String(p.age), 'age')}
      <label class="field"><span>Weight (lb)</span><input type="number" inputmode="decimal" value="${num(p.weightLb)}" data-ch="weightInput"></label>
      <label class="field"><span>Experience</span>${selectHTML('exp', Object.keys(EXPERIENCE), p.experience, k => EXPERIENCE[k].title)}</label>
      <div class="muted xs">Your targets: ${lo}–${hi} g protein, ~${waterOz(p)} oz water, ${sleepTarget(p)} of sleep a day.</div></div>
    <div class="card">${sh('Dumbbells')}${dumbbellEditorHTML()}
      <div class="muted xs">Ordering dumbbells? Turn the switch off until they arrive — workouts swap to no-dumbbell versions so your streak keeps going. The app picks the closest weight you own and adds reps when it's between sizes.</div></div>
    <div class="card">${sh('Workouts')}${stepperHTML('Rest between sets', D.settings.restSeconds + 's', 'rest')}</div>
    <div class="card">${sh('Check-in with Claude')}<button class="btn ghost" data-a="shareProgress">🤖 Send progress to Claude</button>
      <div class="muted xs">Makes a short text report of your streak, workouts, weights and feedback. Share or paste it into your chat with Claude for a review.</div></div>
    <div class="card">${sh('Backup')}
      <button class="btn ghost" data-a="exportBackup">💾 Save a backup file</button>
      <label class="btn ghost filebtn">📂 Restore from a backup<input type="file" accept=".json,application/json" data-ch="importBackup"></label>
      <div class="muted xs">Everything is stored only on this phone, inside the Home Screen app. Save a backup to Files every few weeks so you can never lose your streak.${D.lastBackup ? ' Last backup: ' + new Date(D.lastBackup).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '.' : ''}</div></div>
    <div class="card"><button class="btn danger" data-a="resetSheet">Reset everything</button></div>
    <div class="muted xs center">Lock In · works offline · your data never leaves this phone</div>`;
}

// ---------- sheets
function sheetHTML(s) {
  const views = { report: () => ['Your progress report', `<p class="muted sm">Copy this and paste it into your chat with Claude.</p><textarea readonly style="width:100%;height:50vh;background:var(--card2);color:var(--text);border:0;border-radius:14px;padding:12px;font:13px/1.4 ui-monospace,monospace">${esc(progressReport())}</textarea>`], ex: exSheet, excuse: excuseSheet, switch: switchSheet, lockin: lockinSheet, confirmFinish: confirmFinishSheet, preview: previewSheet, day: daySheet, weight: weightSheet, reset: resetSheet };
  const [title, body] = views[s.t](s);
  return `<div class="sheet-wrap ${ui.animateSheet ? 'anim' : ''}"><div class="backdrop" data-a="closeSheet"></div>
    <div class="sheet" data-scroll="sheet-${s.t}"><div class="grabber"></div>
      <div class="sheet-head"><strong>${esc(title)}</strong><button class="link" data-a="closeSheet">Done</button></div>${body}</div></div>`;
}
function exSheet(s) {
  const ex = EX[s.id];
  const pinned = D.pinnedVideos[ex.id];
  return ['', `<div class="eyebrow acc">${esc(ex.muscles.toUpperCase())}</div><div class="title">${esc(ex.name)}</div>
    <div class="pills">${pill(ex.usesDumbbell ? (ex.oneDumbbell ? '1 dumbbell' : '2 dumbbells') : 'No equipment')}${ex.perSide ? pill('Each side') : ''}${ex.isTimed ? pill('Timed') : ''}</div>
    <a class="btn primary" href="${esc(videoURL(ex))}" target="_blank" rel="noopener">▶ ${pinned ? 'Watch your pinned video' : 'Watch quick form videos'}</a>
    <div class="card inset">${sh('How to do it')}${ex.cues.map((c, i) => `<div class="cue"><b>${i + 1}</b><span>${esc(c)}</span></div>`).join('')}</div>
    <div class="card inset"><strong class="warnc">⚠️ Avoid this</strong><div>${esc(ex.mistake)}</div></div>
    <div class="card inset">${sh('Pin a favorite video')}
      <div class="muted sm">Found a short you like? In YouTube tap Share → Copy link, paste it here, and this exercise will always open it.</div>
      <input id="pinInput" type="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="Paste a YouTube link" value="${esc(pinned || '')}">
      <div class="row gap"><button class="btn small primary" data-a="pinSave" data-id="${ex.id}">Save pin</button>${pinned ? `<button class="btn small ghost" data-a="pinRemove" data-id="${ex.id}">Remove pin</button>` : ''}</div></div>`];
}
function excuseSheet(s) {
  const day = kdate(s.k);
  const left = excusesLeft();
  const isDB = s.reason === 'Waiting on dumbbells';
  return ['Take the day off', `
    <div class="sh"><span>What's going on?</span></div>
    <div class="list card inset">${EXCUSE_REASONS.map(r => `<button class="li" data-a="excuseReason" data-v="${esc(r)}"><span class="grow">${esc(r)}</span>${s.reason === r ? '<span class="acc">✓</span>' : ''}</button>`).join('')}</div>
    ${isDB ? (D.equipment.hasDumbbells
      ? `<button class="btn ghost" data-a="useBW" data-k="${s.k}">🤸 Do the no-dumbbell version instead</button><div class="muted xs">Same muscles, bodyweight moves. Keeps your progress climbing.</div>`
      : `<div class="card note">Good news: while you wait, your workouts already use no-dumbbell versions — so you can still train today.</div>`) : ''}
    <input type="text" placeholder="Note (optional)" value="${esc(s.note || '')}" data-in="excuseNote">
    <button class="btn primary" data-a="excuseConfirm" data-k="${s.k}" ${left === 0 ? 'disabled' : ''}>Excuse ${wdName(day)}</button>
    <div class="muted xs">${left === 0 ? "You've used all your excuses this week. You can change the limit in Plan → Streak rules." : `Excused days don't break your streak. ${left} of ${D.settings.maxExcusesPerWeek} excuses left this week.`}</div>`];
}
function switchSheet(s) {
  const day = kdate(s.k);
  const cur = focusFor(day);
  return ['Switch workout', `<div class="muted sm">If you pick a workout that's planned later this week, the two days swap so you still hit everything.</div>
    <div class="list card inset">${FOCUS_KEYS.filter(f => f !== cur).map(f => `<button class="li" data-a="switchTo" data-k="${s.k}" data-v="${f}"><span class="fi">${FOCUS[f].icon}</span><span class="grow">${FOCUS[f].title}</span></button>`).join('')}</div>`];
}
function lockinSheet(s) { return ['Lock it in', lockInBodyHTML(s.k, false)]; }
function confirmFinishSheet() {
  const sess = D.inProgress;
  const total = sess ? sess.items.reduce((a, it) => a + it.sets, 0) : 0;
  const done = sess ? sess.items.reduce((a, it) => a + Math.min(it.setsDone, it.sets), 0) : 0;
  return ['Finish workout?', `<p class="muted">You've done ${done} of ${total} sets. It still counts — but finishing every set is how your weights go up.</p>
    <button class="btn primary" data-a="finishConfirm">Finish & lock it in</button><button class="btn ghost" data-a="closeSheet">Keep going</button>`];
}
function previewSheet(s) {
  const noDB = s.bw || !D.equipment.hasDumbbells;
  const list = rxList(s.f, s.v, noDB);
  const thisWeek = variantFor(TODAY()) === 0 ? 'A' : 'B';
  return [FOCUS[s.f].title, `<div class="seg">${[0, 1].map(v => `<button class="${s.v === v ? 'on' : ''}" data-a="pvVariant" data-v="${v}">Version ${v ? 'B' : 'A'}</button>`).join('')}</div>
    ${D.equipment.hasDumbbells ? `<div class="toggle-row"><span>Show no-dumbbell version</span>${toggleHTML('pvBW', s.bw)}</div>` : ''}
    <div class="muted xs">This week is Version ${thisWeek}. Weights shown are what you'd do right now at level ${level()}.</div>
    ${sh('Exercises · tap for form + video')}
    <div class="list card inset">${list.map(r => `<button class="li" data-a="ex" data-id="${r.ex.id}"><span class="grow"><span class="block">${esc(r.ex.name)}</span><span class="muted xs">${summary(r)}</span></span><span class="play">▶</span></button>`).join('')}</div>
    ${sh('Warm-up · tap for video')}<div class="list card inset">${(LIB.warmups[s.f] || []).map(([n, sec]) => `<a class="li" href="${esc(moveVideoURL(n))}" target="_blank" rel="noopener"><span class="grow">${esc(n)}</span><span class="muted sm">${sec}s</span><span class="play">▶</span></a>`).join('')}</div>
    ${sh('Cool-down stretches · tap for video')}<div class="list card inset">${(LIB.cooldowns[s.f] || []).map(([n, sec]) => `<a class="li" href="${esc(moveVideoURL(n))}" target="_blank" rel="noopener"><span class="grow">${esc(n)}</span><span class="muted sm">${sec}s</span><span class="play">▶</span></a>`).join('')}</div>`];
}
function daySheet(s) {
  const day = kdate(s.k);
  const rec = D.records[s.k];
  const f = focusFor(day);
  const st = dayState(day);
  const tk = dkey(TODAY());
  const statusText = { completed: 'Done ✓', excused: 'Excused', missed: 'Missed', rest: 'Rest', today: 'Today', upcoming: 'Coming up', before: 'Before you started' }[st];
  const canFix = D.startDayKey && s.k >= D.startDayKey && s.k <= tk;
  let body = `<div class="card inset"><div class="row"><span class="fi">${FOCUS[f].icon}</span><strong class="grow">${FOCUS[f].title}</strong><span class="muted">${statusText}</span></div>
    ${rec && rec.excuseReason ? `<div class="muted sm">Reason: ${esc(rec.excuseReason)}</div>` : ''}
    ${rec && rec.durationSeconds ? `<div class="muted sm">Duration: ${clock(rec.durationSeconds)}</div>` : ''}</div>`;
  if (rec && rec.exercises && rec.exercises.length) {
    body += sh('Logged') + `<div class="list card inset">${rec.exercises.map(e => `<div class="li static"><span class="grow sm">${esc(e.name)}</span><span class="muted xs">${e.setsDone}/${e.totalSets} × ${e.isTimed ? e.target + 's' : e.target}${e.weight != null ? ' @ ' + lb(e.weight) : ''}</span></div>`).join('')}</div>`;
  }
  if (canFix) {
    body += sh('Fix this day');
    if (!rec || rec.status !== 'completed') body += `<button class="btn ghost" data-a="dayDone" data-k="${s.k}">✓ Mark as done</button>`;
    if ((!rec || rec.status !== 'excused') && f !== 'rest') body += `<button class="btn ghost" data-a="dayExcuse" data-k="${s.k}">⏸ Mark as excused</button>`;
    if (rec) body += `<button class="btn danger" data-a="dayClear" data-k="${s.k}">Clear this day</button>`;
    body += `<div class="muted xs">Forgot to log a workout? Fix it here — your streak updates right away.</div>`;
  }
  if (s.k >= tk && !rec) {
    body += sh("Change this day's workout") + `<div class="list card inset">${FOCUS_KEYS.map(k => `<button class="li" data-a="daySwitch" data-k="${s.k}" data-v="${k}"><span class="fi">${FOCUS[k].icon}</span><span class="grow">${FOCUS[k].title}</span>${k === f ? '<span class="acc">✓</span>' : ''}</button>`).join('')}</div>
      <div class="muted xs">If you pick a workout that's later this week, the two days swap.</div>`;
  }
  return [day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }), body];
}
function weightSheet() {
  return ['Log body weight', `<input id="weightInput" type="number" inputmode="decimal" placeholder="Weight in lb" value="">
    <button class="btn primary" data-a="weightSave">Save</button>
    <div class="muted xs">This also updates your profile weight, which sets your protein and water targets.</div>`];
}
function resetSheet() {
  return ['Erase all your data?', `<p class="muted">Your streak, history and settings will be deleted from this phone. This can't be undone. Save a backup first if you might want it back.</p>
    <button class="btn danger" data-a="resetConfirm">Erase everything</button><button class="btn ghost" data-a="closeSheet">Cancel</button>`];
}

// ---------------------------------------------------------------- workout timer
function startTimer(seconds, hold, idx) {
  unlockAudio();
  const sec = Math.max(1, seconds);
  ui.timer = { end: Date.now() + sec * 1000, total: sec, hold, idx };
  render();
}
function timerDone(early) {
  const t = ui.timer;
  ui.timer = null;
  if (!t) return;
  if (!early) beep(t.hold ? 3 : 2);
  if (t.hold && t.idx != null) completeSet(t.idx);
  else render();
}
function completeSet(i) {
  const s = D.inProgress;
  if (!s || !s.items[i]) return;
  s.items[i].setsDone = Math.min(s.items[i].sets, s.items[i].setsDone + 1);
  persist();
  const everything = s.items.every(it => it.setsDone >= it.sets);
  if (everything) { ui.timer = null; render(); toast('💥 Every set done! Hit Finish to lock it in.'); }
  else startTimer(D.settings.restSeconds, false, null);
}
function tickTimer() {
  if (ui.workout && !ui.workout.finished && D.inProgress) {
    const el = document.getElementById('elapsed');
    if (el) el.textContent = clock((Date.now() - new Date(D.inProgress.startedAt)) / 1000);
  }
  const t = ui.timer;
  if (!t) return;
  const rem = Math.max(0, Math.ceil((t.end - Date.now()) / 1000));
  if (rem <= 0) { timerDone(false); return; }
  const v = document.getElementById('tval');
  const p = document.getElementById('tprog');
  if (v) v.textContent = rem + 's';
  if (p) p.style.width = Math.min(100, rem / t.total * 100) + '%';
}

// ---------------------------------------------------------------- actions
const A = {
  skipInstall() { ui.skipInstall = true; render(); },
  closeSheet() { closeSheet(); },
  tab(d) { ui.tab = d.v; ui.sheets = []; ui.dayOffset = 0; render(); window.scrollTo(0, 0); },
  dayNav(d) { ui.dayOffset = Math.min(6, Math.max(-6, ui.dayOffset + Number(d.d))); render(); },

  // onboarding
  obNext() {
    if (ui.ob < 4) { ui.ob++; render(); window.scrollTo(0, 0); return; }
    D.onboarded = true;
    if (!D.startDayKey) D.startDayKey = dkey(TODAY());
    D.weekPlans[dkey(wStart(TODAY()))] = D.settings.schedule.slice();
    if (!D.bodyweightLog.length) D.bodyweightLog.push({ id: String(Date.now()), date: new Date().toISOString(), weightLb: D.profile.weightLb });
    ui.tab = 'today';
    commit();
    window.scrollTo(0, 0);
  },
  obBack() { ui.ob = Math.max(0, ui.ob - 1); render(); },
  setExp(d) { D.profile.experience = d.v; commit(); },
  hasDB() { D.equipment.hasDumbbells = !D.equipment.hasDumbbells; if (D.inProgress) D.inProgress = null; commit(); },
  setKind(d) { D.equipment.kind = d.v; D.inProgress = null; commit(); },
  chip(d) {
    const w = Number(d.v);
    const list = D.equipment.fixedWeights;
    D.equipment.fixedWeights = list.includes(w) ? list.filter(x => x !== w) : [...list, w].sort((a, b) => a - b);
    D.inProgress = null;
    commit();
  },
  adjMin(d) { D.equipment.adjustableMin = Math.min(50, Math.max(2.5, D.equipment.adjustableMin + 2.5 * Number(d.d))); D.inProgress = null; commit(); },
  adjMax(d) { D.equipment.adjustableMax = Math.min(150, Math.max(5, D.equipment.adjustableMax + 2.5 * Number(d.d))); D.inProgress = null; commit(); },
  adjStep(d) { D.equipment.adjustableStep = Number(d.v); D.inProgress = null; commit(); },

  // today
  start(d) { unlockAudio(); ui.workout = { dayKey: d.k, finished: false }; getSession(kdate(d.k)); render(); keepAwake(true); },
  ex(d) { openSheet({ t: 'ex', id: d.id }); },
  switchSheet(d) { openSheet({ t: 'switch', k: d.k }); },
  excuseSheet(d) { openSheet({ t: 'excuse', k: d.k, reason: EXCUSE_REASONS[0], note: '' }); },
  lockinSheet(d) { openSheet({ t: 'lockin', k: d.k }); },
  toggleBW(d) { const day = kdate(d.k); setNoDumbbells(day, !usesBW(day)); },
  undoExcuse(d) { clearDay(kdate(d.k)); },
  switchTo(d) {
    const day = kdate(d.k);
    const old = focusFor(day);
    ui.sheets = [];
    const partner = switchFocus(day, d.v);
    toast(partner ? `${FOCUS[old].title} moved to ${wdName(partner)}` : `${wdName(day)} is now ${FOCUS[d.v].title}`);
  },
  excuseReason(d) { topSheet().reason = d.v; render(); },
  useBW(d) { ui.sheets = []; setNoDumbbells(kdate(d.k), true); toast('Switched to the no-dumbbell version'); },
  excuseConfirm(d) {
    const s = topSheet();
    const note = (s.note || '').trim();
    ui.sheets = [];
    excuseDay(kdate(d.k), note ? `${s.reason} — ${note}` : s.reason);
    toast('Excused. Your streak is safe.');
  },
  lockToggle(d) {
    const rec = D.records[d.k];
    if (!rec) return;
    rec.lockIn = rec.lockIn.includes(d.v) ? rec.lockIn.filter(x => x !== d.v) : [...rec.lockIn, d.v];
    commit();
  },

  // workout
  closeWorkout() { ui.workout = null; ui.timer = null; keepAwake(false); render(); },
  warmupDone() { const s = D.inProgress; if (s) { s.warmupDone = !s.warmupDone; commit(); } },
  warmMove(d) { startTimer(Number(d.v), true, null); },
  set(d) {
    unlockAudio();
    const s = D.inProgress;
    const i = Number(d.i), n = Number(d.n);
    const it = s && s.items[i];
    if (!it) return;
    if (n < it.setsDone) { it.setsDone = n; commit(); return; } // tap a finished set to undo
    if (EX[it.id].isTimed) startTimer(it.target, true, i);
    else completeSet(i);
  },
  wt(d) {
    const it = D.inProgress && D.inProgress.items[Number(d.i)];
    if (!it || it.weight == null) return;
    it.weight = nextWeight(D.equipment, it.weight, d.d === '1');
    commit();
  },
  tg(d) {
    const it = D.inProgress && D.inProgress.items[Number(d.i)];
    if (!it) return;
    const step = EX[it.id].isTimed ? 5 : 1;
    it.target = Math.max(1, it.target + step * Number(d.d));
    commit();
  },
  fb(d) { const it = D.inProgress && D.inProgress.items[Number(d.i)]; if (it) { it.feedback = d.v; commit(); } },
  finish() {
    const s = D.inProgress;
    if (!s) return;
    const all = s.items.every(it => it.setsDone >= it.sets);
    if (all) finishWorkout(); else openSheet({ t: 'confirmFinish' });
  },
  finishConfirm() { ui.sheets = []; finishWorkout(); },
  timerSkip() { timerDone(true); },
  timerAdd() { if (ui.timer) { ui.timer.end += 15000; ui.timer.total += 15; tickTimer(); } },

  // videos
  pinSave(d) {
    const el = document.getElementById('pinInput');
    let v = (el ? el.value : '').trim();
    if (!v) { delete D.pinnedVideos[d.id]; commit(); return; }
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try {
      const u = new URL(v);
      if (!u.hostname.includes('.')) throw new Error('bad');
      D.pinnedVideos[d.id] = u.href;
      commit();
      toast('📌 Video pinned');
    } catch (e) { toast("That doesn't look like a link"); }
  },
  pinRemove(d) { delete D.pinnedVideos[d.id]; commit(); toast('Back to searching YouTube'); },

  // plan
  reorder() { ui.reorder = !ui.reorder; render(); },
  move(d) {
    const i = Number(d.i), j = i + Number(d.d);
    const s = D.settings.schedule.slice();
    if (j < 0 || j > 6) return;
    [s[i], s[j]] = [s[j], s[i]];
    updateSchedule(s);
  },
  maxEx(d) { D.settings.maxExcusesPerWeek = Math.min(7, Math.max(0, D.settings.maxExcusesPerWeek + Number(d.d))); commit(); },
  preview(d) { openSheet({ t: 'preview', f: d.v, v: variantFor(TODAY()), bw: false }); },
  pvVariant(d) { topSheet().v = Number(d.v); render(); },
  pvBW() { const s = topSheet(); s.bw = !s.bw; render(); },

  // progress
  cal(d) { ui.calOffset = Math.min(0, ui.calOffset + Number(d.d)); render(); },
  daySheet(d) { openSheet({ t: 'day', k: d.k }); },
  dayDone(d) { ui.sheets = []; markDone(kdate(d.k)); toast('Marked as done ✓'); },
  dayExcuse(d) { ui.sheets = []; excuseDay(kdate(d.k), 'Marked later'); },
  dayClear(d) { ui.sheets = []; clearDay(kdate(d.k)); },
  daySwitch(d) {
    const day = kdate(d.k);
    const old = focusFor(day);
    ui.sheets = [];
    const partner = switchFocus(day, d.v);
    if (partner) toast(`${FOCUS[old].title} moved to ${wdName(partner)}`);
  },
  weightSheet() { openSheet({ t: 'weight' }); setTimeout(() => { const el = document.getElementById('weightInput'); if (el) el.focus(); }, 300); },
  weightSave() {
    const el = document.getElementById('weightInput');
    const v = parseFloat(String(el ? el.value : '').replace(',', '.'));
    if (!(v > 50 && v < 700)) { toast('Enter your weight in lb'); return; }
    D.bodyweightLog.push({ id: String(Date.now()), date: new Date().toISOString(), weightLb: v });
    D.profile.weightLb = v;
    ui.sheets = [];
    commit();
    toast('Logged ' + lb(v));
  },

  // me
  age(d) { D.profile.age = Math.min(90, Math.max(10, D.profile.age + Number(d.d))); commit(); },
  rest(d) { D.settings.restSeconds = Math.min(180, Math.max(30, D.settings.restSeconds + 15 * Number(d.d))); commit(); },
  async exportBackup() {
    const name = `LockIn-Backup-${dkey(TODAY())}.json`;
    const json = JSON.stringify(D, null, 2);
    const markSaved = () => { D.lastBackup = new Date().toISOString(); commit(); };
    try {
      const file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Lock In backup' });
        markSaved();
        toast('💾 Backup saved');
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    markSaved();
  },
  async shareProgress() {
    const text = progressReport();
    try {
      if (navigator.share) { await navigator.share({ text, title: 'Lock In progress' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('📋 Copied — paste it into your chat with Claude'); }
    catch (e) { openSheet({ t: 'report' }); }
  },
  resetSheet() { openSheet({ t: 'reset' }); },
  resetConfirm() {
    D = freshData();
    ui.sheets = []; ui.workout = null; ui.timer = null; ui.ob = 0; ui.tab = 'today';
    commit();
  }
};

const INPUT = {
  name(v) { D.profile.name = v; persist(); },
  excuseNote(v) { const s = topSheet(); if (s) s.note = v; }
};

const CHANGE = {
  age(v) { D.profile.age = Number(v); commit(); },
  weight(v) { D.profile.weightLb = Number(v); commit(); },
  weightInput(v) { const n = parseFloat(String(v).replace(',', '.')); if (n > 50 && n < 700) { D.profile.weightLb = n; } commit(); },
  exp(v) { D.profile.experience = v; commit(); },
  dayFocus(v, el) { const s = D.settings.schedule.slice(); s[Number(el.dataset.i)] = v; updateSchedule(s); },
  goal(v) { const n = Number(v); D.settings.weeklyGoal = n > 0 ? n : null; commit(); },
  importBackup(v, el) {
    const file = el.files && el.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || !parsed.onboarded || !parsed.profile) throw new Error('not a backup');
        D = normalize(parsed);
        ensureWeekPlans();
        ui.sheets = []; ui.workout = null; ui.timer = null;
        commit();
        toast('✅ Backup restored');
      } catch (e) {
        toast("That file isn't a Lock In backup");
      }
    };
    reader.readAsText(file);
    el.value = '';
  }
};

// ---------------------------------------------------------------- wiring
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.a];
  if (!fn) return;
  e.preventDefault();
  fn(el.dataset, el, e);
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.in && INPUT[el.dataset.in]) INPUT[el.dataset.in](el.value, el);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset && el.dataset.ch && CHANGE[el.dataset.ch]) CHANGE[el.dataset.ch](el.value, el);
});

function isBusy() {
  const a = document.activeElement;
  return a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName);
}

let lastDay = dkey(TODAY());
let lastSlow = Date.now();
setInterval(() => {
  tickTimer();
  // Every 30 s refresh countdowns, and roll over to the new day at 3 AM.
  if (Date.now() - lastSlow > 30000) {
    lastSlow = Date.now();
    const k = dkey(TODAY());
    if (k !== lastDay) { lastDay = k; streakCache = null; if (ensureWeekPlans()) persist(); }
    if (!isBusy()) render();
  }
}, 500);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (ui.workout && !ui.workout.finished) keepAwake(true);
  if (!ui.workout && !ui.sheets.length) ui.dayOffset = 0;
  streakCache = null;
  if (ensureWeekPlans()) persist();
  tickTimer();
  if (!isBusy()) render();
});

// Ask iOS to treat our saved data as important (never cleared to free space).
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

if (ensureWeekPlans()) persist();
render();

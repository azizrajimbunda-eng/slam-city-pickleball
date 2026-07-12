// Headless rules harness for SLAM CITY pickleball.
// Extracts the game script from index.html, stubs the DOM/canvas, drives the
// loop frame-by-frame, and asserts the authentic-rules invariants.
//   node rules-harness.js         — AI-vs-AI full game
//   node rules-harness.js human   — bot drives the human player (serve meter, swings)
const fs = require('fs');
const mode = process.argv[2] === 'human' ? 'human' : 'ai';

const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('no script found'); process.exit(1); }
let src = m[1];

// expose internals for the harness before the IIFE closes
const dbgExport = `
  // wrap doReturn to record exact contact-time state (bounce count, hitter position)
  globalThis.__hits = [];
  const __origDoReturn = doReturn;
  doReturn = function(rt, p, forcedType, quality){
    globalThis.__hits.push({ shot: shotCount+1, bounced: ball.bounced, cy: p.cy, team: p.team, human: p===HUMAN });
    return __origDoReturn(rt, p, forcedType, quality);
  };
  globalThis.__dbg = {
    state: () => ({
      score: [...score], servingTeam, serverNum, firstTurn, phase, phaseTimer,
      shotCount, rally, maxRally, matchOver, lastReason, controlMode, handBattle,
      ball: { cx: ball.cx, cy: ball.cy, cz: ball.cz, tcx: ball.tcx, tcy: ball.tcy,
              active: ball.active, bounced: ball.bounced, lastTeam: ball.lastTeam },
      players: players.map(p => ({ team: p.team, lane: p.lane, cx: p.cx, cy: p.cy })),
      KN, KF
    }),
    scoreCall: () => scoreCall(),
    keys, setControl, doSwing, lockServe, meterPos,
  };
})();`;
const closer = src.lastIndexOf('})();');
if (closer === -1) { console.error('IIFE closer not found'); process.exit(1); }
src = src.slice(0, closer) + dbgExport + src.slice(closer + 5);

// ---- DOM / canvas stubs ----
const gradStub = { addColorStop() {} };
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'createLinearGradient') return () => gradStub;
    return () => undefined;
  },
  set(t, k, v) { t[k] = v; return true; }
});
function elStub(id) {
  return {
    id, style: {}, textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, focus() {},
    getContext: () => ctxStub,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 118, height: 118 }),
    setPointerCapture() {},
  };
}
const els = {};
global.document = {
  getElementById: id => (els[id] ||= elStub(id)),
  addEventListener() {},
  documentElement: elStub('root'),
};
global.window = global;
global.addEventListener = () => {};
global.matchMedia = () => ({ matches: false });
global.navigator = { maxTouchPoints: 0 };
let rafCb = null;
global.requestAnimationFrame = cb => { rafCb = cb; return 1; };
global.cancelAnimationFrame = () => { rafCb = null; };

// ---- run the game ----
eval(src);
const dbg = global.__dbg;

// ---- simple bot that plays the human seat ----
function humanBot(s) {
  if (!s.controlMode) dbg.setControl(true);
  const h = s.players[0];
  if (s.phase === 'serveMeter') {
    if (Math.abs(dbg.meterPos() - 0.5) < 0.08) dbg.lockServe();
    return;
  }
  if (s.phase === 'play' && s.ball.active && s.ball.lastTeam === 1) {
    dbg.keys['a'] = s.ball.tcx < h.cx - 0.03;
    dbg.keys['d'] = s.ball.tcx > h.cx + 0.03;
    dbg.keys['w'] = h.cy < 0.28;               // hold just outside the kitchen line
    dbg.keys['s'] = h.cy > 0.33;
    const close = Math.abs(s.ball.cy - h.cy) < 0.10 && Math.abs(s.ball.cx - h.cx) < 0.2;
    const legal = !(s.ball.bounced === 0 && (s.shotCount <= 2 || h.cy > s.KN));
    if (close && legal) dbg.doSwing(h.cy < 0.40 ? 'dink' : 'drive');
  } else {
    dbg.keys['a'] = dbg.keys['d'] = dbg.keys['w'] = dbg.keys['s'] = false;
  }
}

// ---- drive frames + assert invariants ----
const KN = dbg.state().KN, KF = dbg.state().KF;
let prev = dbg.state();
const violations = [];
const events = [];
let sideOuts = 0, secondServers = 0, pointsScored = 0, maxShot = 0;
let meterServes = 0, handBattles = 0, humanShots = 0;

const MAX_FRAMES = 200000;
let f = 0;
for (; f < MAX_FRAMES; f++) {
  if (!rafCb) { violations.push(`frame ${f}: loop died (rafCb null)`); break; }
  if (mode === 'human') humanBot(prev);
  rafCb();
  const s = dbg.state();

  if (s.phase === 'serveMeter' && prev.phase !== 'serveMeter') meterServes++;
  if (s.handBattle > 0 && prev.handBattle <= 0) handBattles++;
  if (s.shotCount === prev.shotCount + 1 && s.ball.lastTeam === 0 && prev.shotCount >= 1 && s.controlMode) humanShots++;

  // --- invariant: only the serving team scores ---
  for (const t of [0, 1]) {
    if (s.score[t] > prev.score[t]) {
      pointsScored++;
      if (prev.servingTeam !== t) violations.push(`frame ${f}: team ${t} scored while team ${prev.servingTeam} was serving (side-out scoring violated)`);
      if (s.score[t] - prev.score[t] > 1) violations.push(`frame ${f}: score jumped by ${s.score[t] - prev.score[t]}`);
    }
  }

  // --- rotation bookkeeping ---
  if (s.servingTeam !== prev.servingTeam && !s.matchOver && !prev.matchOver) {
    sideOuts++;
    if (s.serverNum !== 1) violations.push(`frame ${f}: side-out but new serverNum=${s.serverNum} (should be 1)`);
    if (prev.firstTurn === false && prev.serverNum !== 2) violations.push(`frame ${f}: side-out happened while serverNum=${prev.serverNum} and not first turn`);
  }
  if (s.servingTeam === prev.servingTeam && s.serverNum === 2 && prev.serverNum === 1) secondServers++;

  maxShot = Math.max(maxShot, s.maxRally + 1, s.shotCount);

  if (s.matchOver && !prev.matchOver) {
    events.push(`frame ${f}: GAME — score ${s.score.join('-')}`);
    break;
  }
  prev = s;
}

// --- exact-contact checks from the doReturn instrumentation ---
// hit.shot is the NEW shot number; it returns ball (shot-1). Returning balls 1 or 2
// (i.e. new shot 2 or 3) requires a bounce first; any volley must be from outside the kitchen.
for (const h of global.__hits) {
  if (h.shot <= 3 && h.bounced === 0) {
    violations.push(`hit(shot ${h.shot}${h.human ? ', HUMAN' : ''}): volleyed ball ${h.shot - 1} before its bounce (two-bounce rule)`);
  }
  if (h.bounced === 0) {
    const inK = h.team === 0 ? h.cy > KN + 0.001 : h.cy < KF - 0.001;
    if (inK) violations.push(`hit(shot ${h.shot}${h.human ? ', HUMAN' : ''}): volley from inside kitchen (cy=${h.cy.toFixed(3)})`);
  }
}

const s = dbg.state();
console.log(`--- SIM RESULT (${mode} mode) after`, f, 'frames ---');
console.log('final score:', s.score.join('-'), '| call:', dbg.scoreCall(), '| matchOver:', s.matchOver);
console.log('points:', pointsScored, '| side-outs:', sideOuts, '| 2nd-servers:', secondServers, '| longest rally:', maxShot, 'shots');
console.log('hand battles:', handBattles, '| meter serves:', meterServes, '| human shots landed:', humanShots);
console.log(events.join('\n'));
if (mode === 'human' && meterServes === 0) violations.push('human mode: serve meter never engaged');
if (violations.length) {
  console.log('\nVIOLATIONS (' + violations.length + '):');
  for (const v of violations.slice(0, 20)) console.log(' -', v);
  process.exit(1);
} else {
  console.log('\nALL RULE INVARIANTS HELD ✓');
}

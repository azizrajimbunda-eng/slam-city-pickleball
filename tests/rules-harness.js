// Headless rules harness for SLAM CITY pickleball.
// Extracts the game script from index.html, stubs the DOM/canvas, drives the
// loop frame-by-frame, and asserts the authentic-rules invariants.
const fs = require('fs');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('no script found'); process.exit(1); }
let src = m[1];

// expose internals for the harness before the IIFE closes
const dbgExport = `
  globalThis.__dbg = {
    state: () => ({
      score: [...score], servingTeam, serverNum, firstTurn, phase, phaseTimer,
      shotCount, rally, matchOver, lastReason,
      ball: { cx: ball.cx, cy: ball.cy, cz: ball.cz, active: ball.active, bounced: ball.bounced, lastTeam: ball.lastTeam },
      players: players.map(p => ({ team: p.team, lane: p.lane, cx: p.cx, cy: p.cy })),
      KN, KF
    }),
    scoreCall: () => scoreCall(),
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
    classList: { add() {}, remove() {}, contains: () => false },
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

// ---- drive frames + assert invariants ----
const KN = dbg.state().KN, KF = dbg.state().KF;
let prev = dbg.state();
const violations = [];
const events = [];
let sideOuts = 0, secondServers = 0, pointsScored = 0, rallies = 0, maxShot = 0;

const MAX_FRAMES = 200000;
let f = 0;
for (; f < MAX_FRAMES; f++) {
  if (!rafCb) { violations.push(`frame ${f}: loop died (rafCb null) — check console above for error`); break; }
  rafCb();
  const s = dbg.state();

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

  // --- two-bounce + kitchen: check at the moment a new shot is struck ---
  if (s.shotCount === prev.shotCount + 1 && prev.shotCount >= 1) {
    rallies = Math.max(rallies, s.shotCount);
    if (prev.shotCount <= 2 && prev.ball.bounced === 0 && prev.ball.active) {
      violations.push(`frame ${f}: shot ${s.shotCount} volleyed shot ${prev.shotCount} before its bounce (two-bounce rule)`);
    }
    if (prev.ball.bounced === 0 && prev.ball.active) {
      // volley: hitter must be outside the kitchen. hitter team = s.ball.lastTeam
      const ht = s.ball.lastTeam;
      const cand = s.players.filter(p => p.team === ht)
        .sort((a, b) => Math.abs(a.cx - prev.ball.cx) - Math.abs(b.cx - prev.ball.cx))[0];
      const inK = ht === 0 ? cand.cy > KN + 0.001 : cand.cy < KF - 0.001;
      if (inK) violations.push(`frame ${f}: team ${ht} volleyed from inside kitchen (cy=${cand.cy.toFixed(3)})`);
    }
  }
  maxShot = Math.max(maxShot, s.shotCount);

  if (s.matchOver && !prev.matchOver) {
    events.push(`frame ${f}: GAME — score ${s.score.join('-')}`);
    break;
  }
  prev = s;
}

const s = dbg.state();
console.log('--- SIM RESULT after', f, 'frames ---');
console.log('final score:', s.score.join('-'), '| call:', dbg.scoreCall(), '| matchOver:', s.matchOver);
console.log('points:', pointsScored, '| side-outs:', sideOuts, '| 2nd-servers:', secondServers, '| longest rally:', maxShot, 'shots');
console.log(events.join('\n'));
if (violations.length) {
  console.log('\nVIOLATIONS (' + violations.length + '):');
  for (const v of violations.slice(0, 20)) console.log(' -', v);
  process.exit(1);
} else {
  console.log('\nALL RULE INVARIANTS HELD ✓');
}

// Headless POSITIONING harness for SLAM CITY pickleball.
//
// WHY THIS EXISTS, SEPARATELY FROM rules-harness.js:
// The rules harness cannot catch this class of bug. Every rule invariant held both
// BEFORE and AFTER each of the three positioning fixes below — rule-correct is not the
// same as well-positioned. Three times a playtester reported the AI "not going into the
// kitchen" / "standing on top of each other" while the harness printed a clean pass.
//
// All three bugs had one shape: a QUANTISED CONSTANT pinning the AI somewhere no real
// pickleball player would stand, showing up as a histogram spike whose neighbouring
// depths were near-empty (a park, not a transit).
//   1. netCy was a flat 0.30 = 1.8ft BEHIND the kitchen line -> a hard attractor the AI
//      snapped back to. Time at the line was 14-23%; median AND p90 were both 1.80ft.
//   2. The hitting team's advance ramp was a 3-step staircase whose middle step (0.5)
//      parked them ~9ft back — dead centre of no-man's land — for a full shot cycle.
//      26.2% of live frames at exactly 9ft while neighbouring depths saw ~0.2% each.
//   3. The defending partner ran tx = -ball.tcx*0.5, so on a ball down the middle BOTH
//      defenders converged on cx~0 and stacked: spread p10 was 1.2ft.
//
// Thresholds are set with wide margins on both sides — each metric separates the pass
// and fail states by a factor of 3 or more, so this should not go flaky on sim RNG.
//   node positioning-harness.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('no script found'); process.exit(1); }
let src = m[1];

const dbgExport = `
  globalThis.__dbg = {
    state: () => ({
      phase, matchOver, score: [...score],
      ball: { active: ball.active, lastTeam: ball.lastTeam, tcx: ball.tcx },
      resp: responsible ? { team: responsible.team, lane: responsible.lane } : null,
      players: players.map(p => ({ team: p.team, lane: p.lane, cx: p.cx, cy: p.cy })),
      KN, KF,
    }),
  };
})();`;
const closer = src.lastIndexOf('})();');
if (closer === -1) { console.error('IIFE closer not found'); process.exit(1); }
src = src.slice(0, closer) + dbgExport + src.slice(closer + 5);

// ---- DOM / canvas stubs (kept in sync with rules-harness.js) ----
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
    querySelector: () => elStub('sub'),
  };
}
const els = {};
global.document = {
  getElementById: id => (els[id] ||= elStub(id)),
  querySelector: sel => (els[sel] ||= elStub(sel)),
  addEventListener() {},
  documentElement: elStub('root'),
  body: elStub('body'),
};
global.window = global;
global.addEventListener = () => {};
global.matchMedia = () => ({ matches: false });
global.navigator = { maxTouchPoints: 0 };
let rafCb = null;
global.requestAnimationFrame = cb => { rafCb = cb; return 1; };
global.cancelAnimationFrame = () => { rafCb = null; };

eval(src);
const dbg = global.__dbg;

const s0 = dbg.state();
const KN = s0.KN, KF = s0.KF;
const LFT = 44;  // cy 0..1 == baseline to baseline == 44ft
const WFT = 10;  // cx -1..1 == 20ft wide, so 1 cx unit == 10ft

// signed distance behind the player's OWN kitchen line, in feet (negative == inside NVZ)
const behindFt = p => (p.team === 0 ? (KN - p.cy) : (p.cy - KF)) * LFT;

const N = s0.players.length;
const liveFrames = new Array(N).fill(0);
const atLine = new Array(N).fill(0);      // <= 1ft: on the line, where doubles is played
const deadZone = new Array(N).fill(0);    // 1-3ft: where netCy used to park them
// depth histogram for the team that just STRUCK the ball — they should be travelling
// to the line, never parking in the transition zone on the way
const hitDwell = new Map();
let hitFrames = 0;
const spreads = [];                       // ft between the two defenders

let f = 0, loopDied = false;
const MAX_FRAMES = 200000;
for (; f < MAX_FRAMES; f++) {
  if (!rafCb) { loopDied = true; break; }
  rafCb();
  const s = dbg.state();

  if (s.phase === 'play' && s.ball.active) {
    s.players.forEach((p, i) => {
      liveFrames[i]++;
      const b = behindFt(p);
      if (b <= 1.0) atLine[i]++;
      else if (b <= 3.0) deadZone[i]++;
    });

    for (const p of s.players.filter(p => p.team === s.ball.lastTeam)) {
      hitFrames++;
      const bucket = Math.round(behindFt(p));
      hitDwell.set(bucket, (hitDwell.get(bucket) || 0) + 1);
    }

    if (s.resp) {
      const rt = 1 - s.ball.lastTeam;
      const def = s.players.filter(p => p.team === rt);
      const resp = def.find(p => p.lane === s.resp.lane && p.team === s.resp.team);
      const partner = def.find(p => p !== resp);
      if (resp && partner && s.resp.team === rt) spreads.push(Math.abs(resp.cx - partner.cx) * WFT);
    }
  }
  if (s.matchOver) break;
}

// ---- report ----
const pct = (n, d) => d ? 100 * n / d : 0;
const final = dbg.state();
console.log(`--- POSITIONING RESULT after ${f} frames ---`);
console.log('final score:', final.score.join('-'), '| matchOver:', final.matchOver);

const violations = [];
// guard the measurements themselves: a partial game would make every share below
// meaningless, and must never be reported as a pass
if (loopDied) violations.push(`frame ${f}: loop died (rafCb null) — measurements are from a partial game`);
else if (!final.matchOver) violations.push(`game never finished in ${f} frames — measurements are from a partial game`);

// 1. LINE PRESENCE — catches the netCy attractor (was 14-23%, now 76-81%)
console.log('\nline presence (share of live frames within 1ft of own kitchen line):');
s0.players.forEach((p, i) => {
  const share = pct(atLine[i], liveFrames[i]);
  console.log(`  team${p.team} lane${String(p.lane).padEnd(2)}  ${share.toFixed(1).padStart(5)}%`);
  if (share < 50) violations.push(`team${p.team} lane${p.lane}: only ${share.toFixed(1)}% of live frames at the kitchen line (want >50%) — the AI is not holding the line`);
});

// 2. DEAD ZONE — catches an attractor parked just behind the line (was 52-60%, now 2.7-5.0%)
console.log('\ndead zone (share parked 1-3ft behind the line — where netCy used to pin them):');
s0.players.forEach((p, i) => {
  const share = pct(deadZone[i], liveFrames[i]);
  console.log(`  team${p.team} lane${String(p.lane).padEnd(2)}  ${share.toFixed(1).padStart(5)}%`);
  if (share > 25) violations.push(`team${p.team} lane${p.lane}: ${share.toFixed(1)}% of live frames parked 1-3ft behind the line (want <25%) — smells like a netCy-style attractor`);
});

// 3. NO-MAN'S-LAND PARK — catches the adv staircase (was 26.2% at 9ft, now <=0.4% per bucket)
// Only the HITTING team is checked: the receiving team legitimately sits deep during the
// two-bounce phase (the responsible scrambles behind a deep serve/return at ~12ft).
console.log('\nhitting-team transition zone (3-15ft back — must be TRANSIT ONLY, no bucket parked):');
const transit = [...hitDwell.entries()].filter(([ft]) => ft >= 3 && ft <= 15).sort((a, b) => b[1] - a[1]);
if (!transit.length) console.log('  (none — never in the zone)');
transit.slice(0, 4).forEach(([ft, c]) => {
  const share = pct(c, hitFrames);
  console.log(`  ${String(ft).padStart(3)}ft  ${share.toFixed(1).padStart(5)}%`);
  if (share > 10) violations.push(`hitting team parks at ${ft}ft for ${share.toFixed(1)}% of live frames (want <10% per bucket) — no-man's-land park, the adv-staircase bug`);
});

// 4. SPREAD — catches the partner stack (was p10 1.2ft, now p10 ~4.5ft)
if (spreads.length) {
  const a = spreads.sort((x, y) => x - y);
  const q = k => a[Math.floor(k * (a.length - 1))];
  const p10 = q(0.10);
  console.log(`\ndefender spread (ft apart): p10=${p10.toFixed(1)}  median=${q(0.5).toFixed(1)}  p90=${q(0.9).toFixed(1)}`);
  if (p10 < 3.0) violations.push(`defender spread p10 is ${p10.toFixed(1)}ft (want >3.0ft) — the pair is stacking on the same spot`);
} else {
  violations.push('no defender-spread samples collected — probe wiring is broken, not the game');
}

if (violations.length) {
  console.log('\nVIOLATIONS (' + violations.length + '):');
  for (const v of violations.slice(0, 20)) console.log(' -', v);
  process.exit(1);
} else {
  console.log('\nALL POSITIONING INVARIANTS HELD ✓');
}

# SLAM CITY — 8-Bit Pickleball

Broadcast-view doubles pickleball, 8-bit canvas style, authentic rules. Single-file game.

## Links
- **Live (play here / test on phone):** https://azizrajimbunda-eng.github.io/slam-city-pickleball/
- **Repo:** https://github.com/azizrajimbunda-eng/slam-city-pickleball (Pages auto-deploys `main`, ~30-60s)
- **Artifact mirror:** https://claude.ai/code/artifact/3f224f7d-95c5-4b67-b2c1-fee2fe3ff3ea — update by publishing `index.html` with the Artifact tool passing this URL as `url`; favicon 🏓.
- Dev server: `.claude/launch.json` config `slam-city` → localhost:8642 (never run servers via Bash).

## Architecture (deliberate decisions — don't relitigate without cause)
- **Single-file `index.html`** (~1300 lines): the artifact host requires a self-contained file, and no build step keeps deploys trivial. Split only if scope doubles again.
- **The sim is true 3D** (`cx, cy, cz` + gravity `GZ`, net height `NET_H`), and since 2026-07-15 the renderer is a **true perspective camera** (`proj()` = pinhole camera `CAM` behind the near baseline + `camPanX` ball-follow pan; wall/crowd stay screen-space for parallax). The whole game draws through `proj()`'s `{sx, sy, gy, sc}` contract — camera changes never touch game logic. Camera constants (`CAM.back`/`CAM.f`) were tuned via headless sweep over every legal position: re-run that sweep (zero off-canvas overflow) after any camera change. `WHGT 0.42` keeps ball arcs at the old broadcast proportions — dinks read flat, raising it makes every arc taller.
- **One tuned pace** (`TUNE`, pace 0.45): patient dink base; `paceBoost` surges toward `FAST_PACE` on drives/smashes/hand battles, then decays. No difficulty modes (removed by user request).
- **Virtual input layer**: keyboard `keys{}` + joystick `touchVec` merge in `applyHumanMovement()`; all swings go through `doSwing(type)`. Gamepad API would be a ~30-line add here.
- **Phase state machine** in `update()`: `serve`, `serveMeter` (human serve timing), `play`, `dead` (settle beat + result banner).
- **`body.mobile` app mode** (set when touch detected): full-bleed canvas, no page chrome, deck hidden behind ⚙ menu, controls sized via CSS vars on `.padDeck` (`--tb` button diameter, `--pad` = 2.6×tb diamond box, `--sz/--sb/--sn` stick). Portrait-first; landscape overlays controls on the side bars. Desktop page untouched — everything scoped to `body.mobile`.
- Diamond button anchors are **19.5%/80.5% of a 2.6×tb box** = exactly tb/2 from the edge. Off-screen bleed happened twice before; verify `getBoundingClientRect` vs viewport after any control-layout change.

## Game systems (where things live in index.html)
- Rules: side-out scoring + 3-number call (`scoreCall()`, 0-0-2 opening) in `scorePoint()`/`startPoint()`; two-bounce + kitchen (NVZ) faults enforced in `stepBall()` hit checks; ball may bounce once on any shot (dink battles play off the bounce).
- Shots: `launch(fromTeam, type, quality, aim)` — types serve/return/drop/dink/drive/smash/lob/atp. Human aim = direction held at contact. `bestShot(cz, cy)` recommends what the incoming ball calls for (bracket text + button glow + hint bar); wrong choice costs accuracy (TOO LOW!/NET RISK!/SITTER!).
- Specials: ATP (wide ball + wide player; `ball.atp` skips the net-cord check), Erne (volley from `|cx|>0.85` beside the kitchen is legal), speed-up hand battles (`handBattle` frames pin pace high, `hbCount` ramps AI miss pressure).
- Announcer: `say()` via speechSynthesis — only speaks in `controlMode` (guarantees user gesture, keeps attract mode quiet); utterances queue (never cancel-then-speak: drops lines on iOS) and are ref-held in `curUtter` (Chrome GC bug).
- Fullscreen: `goFullscreen()` + `autoFullscreen()` on first control touch, skipped when installed standalone. PWA: `manifest.json` + `sw.js` (network-first, cache fallback — cache-first previously served stale builds; bump `CACHE` version on SW changes).

## Verification (do this before every commit)
1. `node tests/rules-harness.js` and `node tests/rules-harness.js human` — headless full games asserting rule invariants (side-out scoring, rotation, two-bounce, kitchen) with exact contact-time checks via a wrapped `doReturn`. Both must print `ALL RULE INVARIANTS HELD`.
2. Browser pane: **RAF is throttled to zero when the pane is hidden** (`document.hidden`) — a frozen canvas is NOT a game bug. Initial frames still render for screenshots. For mobile layout checks: force `document.body.classList.add('mobile')` + `padDeck.classList.add('on')` (the pane reports a fine pointer), resize to 375×812 / 812×375, assert rects inside viewport + no scroll.
3. Harness DOM stubs live in `tests/rules-harness.js` — new `document.*` usage in the game needs a matching stub.
4. Ship: commit → `git push` → poll `curl` the Pages URL for a new marker string → redeploy artifact.

## Ways of working (user preferences, established over the project)
- Filipino/English casual tone ("bro" is fine). User playtests on iPhone and gives feel-based feedback; translate it into mechanics/UX root causes and confirm the diagnosis with AskUserQuestion when ambiguous.
- Resource efficiency matters: work inline (whole file fits in context); no subagent fan-outs or workflows for routine changes. Sonnet is fine for CSS/layout stages; verification fan-outs at Haiku/low if ever needed; `/code-review` low–medium after big milestones. A 48-agent ultracode review was tried once — overkill; findings were adjudicated inline instead.
- Commit every milestone with a detailed message; the git log is the project history.

## Current state / open threads (2026-07-15)
- **3D perspective camera merged to main** (branch `3d-renderer`, now merged): pinhole camera, ball-follow pan, wind-up swing phase, arc heights at old proportions. User verdict on phone: pan/cinematic feel good.
- AI-passivity fix batch shipped and validated on phone: 2D responsible assignment, tighter contact reach (0.12), missCap 0.22, chase spdMul 1.5, paddle tracking while waiting, ready-stance idle bounce, MINE callout over the AI partner, whiff swings on scripted misses, hit-stop → 30% slow-mo. Key insight: most "AI is passive" reports were *legibility* problems (legal waiting looked like freezing), not logic bugs.
- Next up (user-agreed order): POP UP! callout + floaty trail on mishits (mechanic exists, isn't legible); second colleague playtest round; tiers/progression scoping (user open to it now that tuning holds — the old "no difficulty modes" removal was because mechanics weren't tuned yet); multiplayer (online + co-op — connection architecture question parked: P2P room codes vs relay server).
- The `3d-renderer` branch can be deleted after a few days of stable main; its test artifact (🎥 https://claude.ai/code/artifact/ba0d8de2-f239-484b-bb9b-ee13524bd9e0) is now redundant with the main mirror.
- Debug technique that keeps paying off: extract the game script headless (pattern in `tests/rules-harness.js`), instrument, drive frames, measure — the browser pane can't observe live gameplay (`document.hidden` throttling). Also: ffmpeg frame-extraction of user screen recordings (transpose=2 for iPhone portrait) traces feel-reports to exact frames.
- Known env quirks: `gh` CLI authed as `azizrajimbunda-eng`; session shell resets cwd between Bash calls (use absolute paths / `cd` per command).

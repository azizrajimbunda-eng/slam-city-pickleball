# Slam City — 8-Bit Pickleball

Broadcast-view doubles pickleball with authentic rules, rendered in an 8-bit canvas style. True 3D sim under the hood (real ball physics, perspective camera), single-file game, no build step.

**Play it:** https://azizrajimbunda-eng.github.io/slam-city-pickleball/

Works on desktop (keyboard) and mobile (touch — joystick + swing buttons). Best on phone in portrait.

## What this is

A solo project, still in active development. Rules-accurate doubles pickleball: side-out scoring, two-bounce rule, kitchen (NVZ) faults, ATP shots, Ernes, hand battles at the net. The AI plays both the opposing team and your partner.

## Controls

- **Desktop:** arrow keys / WASD to move, shown-on-screen buttons (or shortcuts) for shot type — the game highlights which shot it recommends for the ball you're facing.
- **Mobile:** on-screen joystick to move, swing buttons around it. Aim is whatever direction you're holding at contact.

## Known rough edges

This is a playtest build, not a finished game. Things you might run into:
- AI difficulty is untuned (no difficulty modes yet)
- No multiplayer — local/single-player only for now
- Some touch layouts haven't been tested on every device size

## Feedback

Easiest way: the **💡 Suggest button in the game itself** (behind the ⚙ gear menu on mobile) — it sends your suggestion straight to my inbox, no account needed.

For bugs — a shot that shouldn't have worked, a control that didn't respond, a rule that seems wrong — please [open an issue](https://github.com/azizrajimbunda-eng/slam-city-pickleball/issues). Screenshots or a quick screen recording help a lot.

## Running locally

It's a single `index.html` with no dependencies or build step — clone the repo and open the file in a browser, or serve the directory with any static file server.

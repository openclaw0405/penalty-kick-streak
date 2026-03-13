# Penalty Shootout Streak

A mobile-first browser game built with pure HTML, CSS, and JavaScript (no frameworks).

## How to Play

1. Open `index.html` in any modern browser
2. Click **KICK OFF** to start
3. Choose your **control mode** and **shooter** in ⚙ Settings
4. Take aim and shoot — a **colored trajectory arc** (tinted to your shooter) previews the ball path
5. Miss or get saved and your streak resets. No time limit — aim at your own pace!

## Control Modes (FC Mobile-style A / B / C)

| Mode | Label | How it works |
|------|-------|-------------|
| Swipe | **A** | Drag from ball toward goal; drag length = power; direction = aim |
| Charge | **B** | Move cursor/finger to aim; press & hold to charge power; release to shoot |
| Zones | **C** | Tap any of the 3×3 goal zones for an instant shot |

## Shooters

| Shooter | Accuracy | Power | Curve | Style |
|---------|----------|-------|-------|-------|
| Clinical (green) | 93% | 72% | Low | Precise & consistent |
| Rocket (red) | 70% | 100% | Med | Raw power, lower accuracy |
| Magician (purple) | 82% | 80% | High | Curve master & flair |

Stat bars for the selected shooter are displayed live in the ⚙ Settings panel. The trajectory arc is tinted in the shooter's color so you always know who is taking the kick.

## In-Game Settings (⚙ button)

| Setting | Options | Effect |
|---------|---------|--------|
| Control | A Swipe / B Charge / C Zones | Input style (see above) |
| Shooter | Clinical / Rocket / Magician | Accuracy, power & curve profile |
| Pace | Normal / Slow | Normal = 720ms flight; Slow = 1150ms — easier on mobile |
| Keeper | Standard / Relaxed | Relaxed cuts keeper dive & patrol speed by ~38% |

## Game Levels

| Level | Name | Reaction Delay | Special | Goals to Advance |
|-------|------|----------------|---------|-----------------|
| 1 | Rookie Keeper | 650ms | — | 3 |
| 2 | Pro Keeper | 460ms | — | 4 |
| 3 | Elite Keeper | 310ms | Fake moves | 5 |
| 4 | World Class | 200ms | Fake moves | Endless |

## Features

- **FC Mobile-style A/B/C control modes** — Swipe, Charge, Zones selectable in settings
- **Shooter stat bars** — live ACC / PWR / CRV bars update when you switch shooters
- **Shooter-colored trajectory** — dashed arc and target ring tinted to your shooter's color
- **No time pressure** — aim at your own pace, no countdown timer
- **Live trajectory guide** — quadratic bezier arc with target circle previews exact ball path
- **Smooth keeper AI** — lerp-based easing, fake moves at higher levels, zero jitter
- **Goal flash** — brief yellow canvas overlay on score
- **Mode badge** — current control mode shown in level badge (A · Swipe etc.)
- Streak counter + best streak saved in `localStorage`
- Ball arc animation with perspective scaling and shine
- Fully responsive canvas — works on desktop and mobile
- Touch support with `preventDefault` for smooth mobile UX

## Files

```
index.html   — markup & screens
styles.css   — layout, HUD, screens, animations
script.js    — game engine, canvas rendering, AI, physics
README.md    — this file
```

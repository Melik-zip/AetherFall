# AETHERFALL — Realistic WebGL2 Ocean & Sky-Action Game

A zero-dependency, hardware-accelerated 3D WebGL2 ocean-and-sky action game featuring a **Gerstner Ocean Water Shader**, **Multi-Biome Sculpted Islands**, **Smooth Lofted Organic Meshes**, **Dynamic Climate Engine**, **3 Hangar Craft**, **Naval Gunboat Patrols**, **Sector Boss Titans**, **Ring Race Ghost Replay**, **Tactical Radio Comms**, and a **Procedural Web Audio Soundtrack**.

## How to Run

1. **Instant Launch**: Open [index.html](index.html) directly in Chrome, Edge, Firefox, or Safari — works completely offline with zero build step.
2. **Or Local HTTP Server**: Run `play.bat` (or `python -m http.server 8765`) and open `http://localhost:8765`.

## Controls

| Action | Input |
|---|---|
| Flight Move / Bank Turn | `W` `A` `S` `D` |
| Aim / Steer | `Mouse` (click viewport to lock, or drag) / `Arrow Keys` |
| Climb / Glide | `Space` (hold to climb/glide smoothly over peaks) |
| Hyper-Dash & Hydro-Skim | `Shift` (skim close over waves for speed boost & spray!) |
| Evasive Barrel Roll | `Z` / `C` (brief invulnerability & Phantom Dodge window) |
| Primary Weapon | `Left Click` / `J` / `Enter` (Cannons / Arc-Lightning / Solar Rail) |
| Homing Star-Missiles | `Right Click` / `E` |
| Solar Nova (at 100%) | `Q` / `F` |
| Cycle Climate Live | `V` (Golden Sunset / Emerald Noon / Aurora Twilight / Tempest Surge) |
| Pilot Codex & Achievements | `K` (from Title or Pause menu) |
| Pause / Quality / Audio | `P` / `Tab` |

## WebGL2 Architecture (`src/`)

- `src/shaders.js` — GLSL 300 es Physical Sky, Aurora, Gerstner 4-Wave Ocean Water (Fresnel reflections, turquoise depth absorption, shoreline foam), Multi-Biome Terrain, GGX PBR, Crepuscular God-Rays, Storm Lens Raindrops, and 3-tier Pyramid Bloom.
- `src/meshes.js` — 100% smooth lofted airfoils, curved Corsair patrol gunboats, multi-segment Abyssal Leviathan geometry, coconut palms, lighthouses, birds, and boulders.
- `src/webgl.js` — Custom WebGL2 renderer with 2048/1024 PCF shadow mapping, ocean blend pass, MRT glow extraction, instancing, horizon banking roll, and ribbon trails.
- `src/world.js`, `src/wildlife.js`, `src/atmosphere.js`, `src/weather_fx.js` — Continuous `208x208` island seabed terrain, animated coastal palms, flapping seagulls, swimming manta rays, and 3D rain/lightning storms.
- `src/hangar.js`, `src/naval.js`, `src/ghost.js`, `src/entities.js` — 3 selectable craft (`VALKYRIE-IX`, `TEMPEST-RX`, `SOLARIS TITAN`), naval surface gunboats, 3 Boss Titans (`OBELISK WARDEN`, `ABYSSAL LEVIATHAN`, `ECLIPSE SERAPH`), and Ring Race Ghost recorder/interpolator.
- `src/comms.js`, `src/codex.js`, `src/ui.js`, `src/audio.js`, `src/game.js` — Radio comms feed, Pilot Codex & Achievement registry, mini-radar HUD, and adaptive Web Audio synth.

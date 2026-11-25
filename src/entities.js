// src/entities.js — Player Physics, Relics, Enemies, Bosses, Projectiles & Combat Logic
(function (AF) {
  'use strict';

  const {
    clamp, lerp, damp, dampAngle, wrapAngle, randRange,
    Vec3, Mat4, distPointSegmentSq
  } = AF.Math;

  const RELIC_POOL = [
    {
      id: 'multishot',
      name: 'Prism Splitter',
      tag: 'WEAPON',
      desc: 'Primary pulse cannons fire +2 angled solar bolts per volley.',
      color: '#5cf2ff'
    },
    {
      id: 'fireRate',
      name: 'Solar Overclock',
      tag: 'WEAPON',
      desc: '+28% pulse cannon fire rate and faster missile lock recharge.',
      color: '#ffba52'
    },
    {
      id: 'damage',
      name: 'Radiant Core',
      tag: 'POWER',
      desc: '+30% weapon, missile, and Nova damage.',
      color: '#ff6e91'
    },
    {
      id: 'chain',
      name: 'Arc Conduit',
      tag: 'ELEMENTAL',
      desc: 'Bolts arc high-voltage lightning to nearby enemies on impact.',
      color: '#80bfff'
    },
    {
      id: 'drones',
      name: 'Orbital Wingmen',
      tag: 'COMPANION',
      desc: 'Deploys 2 autonomous combat drones orbiting your craft.',
      color: '#7cffb2'
    },
    {
      id: 'vampire',
      name: 'Aether Siphon',
      tag: 'SURVIVAL',
      desc: 'Takedowns restore +9 Shield and boost Flow decay resistance.',
      color: '#b48bff'
    },
    {
      id: 'dashShock',
      name: 'Kinetic Aftershock',
      tag: 'MOBILITY',
      desc: '-30% Dash cooldown and dashes detonate a damaging shockwave.',
      color: '#ffe066'
    },
    {
      id: 'thruster',
      name: 'Zephyr Thrusters',
      tag: 'MOBILITY',
      desc: '+20% cruise & boost speed, +35% Energy recovery & smoother glide.',
      color: '#4deeea'
    }
  ];

  class Player {
    constructor() {
      this.shipId = 'valkyrie';
      this.reset();
    }

    setShip(shipId) {
      this.shipId = AF.SHIPS && AF.SHIPS[shipId] ? shipId : 'valkyrie';
      const spec = AF.SHIPS[this.shipId];
      this.maxHp = spec.maxHp;
      this.hp = Math.min(this.hp, this.maxHp);
    }

    getShipSpec() {
      return (AF.SHIPS && AF.SHIPS[this.shipId]) || {
        id: 'valkyrie',
        hullMesh: 'playerHull',
        wingLMesh: 'playerWingL',
        wingRMesh: 'playerWingR',
        maxHp: 120,
        speedMult: 1.0,
        fireCd: 0.135,
        weaponType: 'pulse',
        missileCount: 4,
        trailColor: [0.45, 0.94, 1.0],
        flameColor: [0.38, 0.94, 1.0],
        dashColor: [1.0, 0.85, 0.40],
        nozzles: [-0.48, 0.48],
        nozzleZ: -1.42
      };
    }

    reset() {
      const spec = this.getShipSpec();
      this.pos = Vec3.create(32, 3.6, 36);
      this.vel = Vec3.create(0, 0, 0);
      this.aimYaw = -0.18;
      this.aimPitch = -0.04;
      this.shipYaw = Math.PI - 0.18;
      this.shipPitch = 0;
      this.bankRoll = 0.06;
      this.wingSweep = 0;
      this.hydroSkimming = false;
      this.hydroTime = 0;

      this.maxHp = spec.maxHp;
      this.hp = spec.maxHp;
      this.maxEnergy = 100;
      this.energy = 100;
      this.nova = 40;
      this.outOfCombatTimer = 0;

      this.flow = 1.0;
      this.flowTimer = 0;
      this.peakFlow = 1.0;

      this.grounded = false;
      this.gliding = false;
      this.dashTimer = 0;
      this.dashCooldown = 0;
      this.rollTimer = 0;
      this.rollCooldown = 0;
      this.rollDir = 1;
      this.rollCount = 0;
      this.invulnTimer = 0;
      this.ringBoostTimer = 0;
      this.shootTimer = 0;
      this.missileTimer = 0;
      this.hitFlash = 0;
      this.shieldFlash = 0;
      this.perfectDodgeCd = 0;

      this.relics = {};
      this.droneAngle = 0;
      this.droneFireTimer = 0;

      this.trailL = new AF.RibbonTrail(28, 0.16, 0.34);
      this.trailR = new AF.RibbonTrail(28, 0.16, 0.34);
    }

    hasRelic(id) {
      return this.relics[id] || 0;
    }

    addRelic(id) {
      this.relics[id] = (this.relics[id] || 0) + 1;
      if (id === 'vampire') {
        this.maxHp += 15;
        this.hp = Math.min(this.maxHp, this.hp + 25);
      }
    }

    getSpeedMult() {
      return this.getShipSpec().speedMult * (1 + 0.2 * this.hasRelic('thruster'));
    }

    getDamageMult() {
      return 1 + 0.3 * this.hasRelic('damage') + (this.flow - 1) * 0.04;
    }

    getFireRateMult() {
      return 1 + 0.28 * this.hasRelic('fireRate');
    }

    getForwardDir(out = Vec3.create()) {
      const cp = Math.cos(this.aimPitch);
      out[0] = Math.sin(this.aimYaw) * cp;
      out[1] = Math.sin(this.aimPitch);
      out[2] = -Math.cos(this.aimYaw) * cp;
      return out;
    }
  }

  // Main Combat & Simulation Director
  class Simulation {
    constructor(world, particles, floatingText, sound) {
      this.world = world;
      this.particles = particles;
      this.floatingText = floatingText;
      this.sound = sound;

      this.player = new Player();
      this.enemies = [];
      this.pylons = [];
      this.projectiles = [];
      this.beams = [];      // active warning/damage lasers
      this.telegraphs = []; // ground explosion warning circles
      this.boss = null;
      this.naval = new AF.NavalDirector(this.world, this.particles);
      this.comms = null;
      this.ghost = null;

      this.mode = 'expedition'; // 'expedition' | 'endless' | 'race' | 'zen'
      this.sector = 1;
      this.maxSectors = 5;
      this.raceIndex = 0;
      this.unlockedAchievements = {};
      this.onAchievement = null;
      this.onSectorChange = null;
      this.score = 0;
      this.kills = 0;
      this.shotsFired = 0;
      this.shotsHit = 0;
      this.shardsCollected = 0;
      this.runTime = 0;
      this.sectorClearDelay = 0;
      this.awaitingRelic = false;
      this.victory = false;
      this.gameOver = false;
      this.deathCause = 'combat';

      this.spawnTimer = 0;
      this.screenShake = 0;
      this.hitStop = 0;
      this.damageFlash = 0;
      this.calloutText = '';
      this.calloutTimer = 0;

      // Temporary reusable vectors/matrices
      this._m = Mat4.create();
      this._v1 = Vec3.create();
      this._v2 = Vec3.create();
      this._aimTarget = Vec3.create();
    }

    startRun(mode, startSector = 1) {
      this.mode = mode;
      this.sector = Math.max(1, startSector);
      this.score = 0;
      this.kills = 0;
      this.shotsFired = 0;
      this.shotsHit = 0;
      this.shardsCollected = 0;
      this.runTime = 0;
      this.sectorClearDelay = 0;
      this.awaitingRelic = false;
      this.victory = false;
      this.gameOver = false;
      this.deathCause = 'combat';

      this.enemies.length = 0;
      this.pylons.length = 0;
      this.projectiles.length = 0;
      this.beams.length = 0;
      this.telegraphs.length = 0;
      this.boss = null;
      this.naval.clear();

      this.player.reset();
      this.world.respawnShards();
      this.particles.activeCount = 0;
      this.floatingText.items.length = 0;
      this.raceIndex = 0;
      if (this.ghost) this.ghost.resetRun();
      if (this.comms) this.comms.clear();

      for (const r of this.world.rings) r.cooldown = 0;

      if (mode === 'zen') {
        this.showCallout('OCEAN FREE FLIGHT — EXPLORE ARCHES & WATERFALLS', 3.0);
        if (this.comms) this.comms.push('zenStart');
      } else if (mode === 'race') {
        this.showCallout('RING RACE — FLY THROUGH ALL 14 CHECKPOINTS!', 3.2);
        if (this.comms) this.comms.push('raceStart');
      } else {
        const startSec = Math.max(1, startSector);
        if (startSec > 1) {
          const starterRelics = ['fireRate', 'damage', 'multishot', 'thruster'];
          for (let i = 0; i < Math.min(3, startSec - 1); i++) {
            this.player.addRelic(starterRelics[i]);
          }
        }
        this._setupSector(startSec);
      }
    }

    unlockAchievement(id, title, desc) {
      if (this.unlockedAchievements[id]) return;
      this.unlockedAchievements[id] = true;
      try {
        const saved = JSON.parse(localStorage.getItem('aetherfall_achievements') || '{}');
        saved[id] = true;
        localStorage.setItem('aetherfall_achievements', JSON.stringify(saved));
      } catch (_) {}
      if (this.onAchievement) this.onAchievement(title, desc);
    }

    showCallout(msg, dur = 2.2) {
      this.calloutText = msg;
      this.calloutTimer = dur;
    }

    _setupSector(sec) {
      this.sector = sec;
      if (this.onSectorChange) this.onSectorChange(sec);
      this.enemies.length = 0;
      this.pylons.length = 0;
      this.projectiles.length = 0;
      this.beams.length = 0;
      this.telegraphs.length = 0;
      this.boss = null;
      this.naval.clear();
      this.world.respawnShards();

      if (this.mode === 'expedition') {
        if (sec === 3) {
          this._spawnBoss('warden');
          this.showCallout('SECTOR 3 // OBELISK WARDEN AWAKENS', 3.2);
          if (this.comms) this.comms.push('sector3');
          return;
        }
        if (sec === 4) {
          this._spawnBoss('leviathan');
          this.showCallout('SECTOR 4 // ABYSSAL LEVIATHAN SURFACES!', 3.4);
          if (this.comms) this.comms.push('sector4');
          return;
        }
        if (sec === 5) {
          this._spawnBoss('seraph');
          this.showCallout('FINAL SECTOR // THE ECLIPSE SERAPH', 3.6);
          if (this.comms) this.comms.push('sector5');
          return;
        }
      } else if (this.mode === 'endless' && sec % 4 === 0) {
        this._spawnBoss('leviathan');
        this.showCallout(`SURGE WAVE ${sec} // ABYSSAL LEVIATHAN SURFACES!`, 3.4);
        if (this.comms) this.comms.push('sector4');
        return;
      } else if (this.mode === 'endless' && sec % 3 === 0) {
        const type = (sec % 6 === 0) ? 'seraph' : 'warden';
        this._spawnBoss(type);
        this.showCallout(`SURGE WAVE ${sec} // BOSS MANIFESTED`, 3.2);
        return;
      }

      // Spawn Resonance Pylons
      const pylonCount = Math.min(4, 1 + Math.ceil(sec * 0.65));
      const anchors = this.world.pylonAnchors;
      for (let i = 0; i < pylonCount; i++) {
        const a = anchors[(i + sec) % anchors.length];
        const g = this.world.getGroundAt(a.x, a.z);
        this.pylons.push({
          x: a.x,
          y: Math.max(g.height, this.world.seaLevel + 0.4),
          z: a.z,
          hp: 210 + sec * 55,
          maxHp: 210 + sec * 55,
          hitFlash: 0,
          pulseTimer: randRange(1.0, 3.0),
          mortarTimer: randRange(2.2, 4.5)
        });
      }

      // Initial defender wave & naval surface patrol gunboats
      const initialEnemies = 4 + sec * 2;
      for (let i = 0; i < initialEnemies; i++) {
        this._spawnEnemyAroundPlayer(sec);
      }
      this.naval.spawnPatrolSquad(sec);

      this.spawnTimer = 4.0;
      this.showCallout(
        this.mode === 'expedition'
          ? `SECTOR ${sec} // SHATTER ${pylonCount} RESONANCE PYLONS`
          : `SURGE WAVE ${sec} // CLEAR HOSTILES & PYLONS`,
        3.0
      );
      if (this.comms && this.mode === 'expedition') {
        if (sec === 1) this.comms.push('sector1');
        else if (sec === 2) this.comms.push('sector2');
      }
    }

    _spawnEnemyAroundPlayer(sec) {
      // Pick anchor island or ring around player
      const pylon = this.pylons.length > 0
        ? this.pylons[Math.floor(Math.random() * this.pylons.length)]
        : { x: 0, y: 4, z: 0 };
      const ang = Math.random() * Math.PI * 2;
      const rad = randRange(16, 36);
      const ex = pylon.x + Math.cos(ang) * rad;
      const ez = pylon.z + Math.sin(ang) * rad;
      const g = this.world.getGroundAt(ex, ez);
      const ey = Math.max(g.height, this.world.seaLevel) + randRange(5.0, 12.0);

      const roll = Math.random();
      let type = 'scout';
      if (sec >= 2 && roll > 0.72) type = 'sniper';
      else if (sec >= 2 && roll > 0.45) type = 'sentinel';

      const hpScale = 1 + (sec - 1) * 0.25;
      if (type === 'scout') {
        this.enemies.push({
          type: 'scout', x: ex, y: ey, z: ez,
          vx: 0, vy: 0, vz: 0, yaw: 0,
          hp: Math.round(52 * hpScale), maxHp: Math.round(52 * hpScale),
          radius: 1.55, hitFlash: 0,
          fireCd: randRange(1.2, 2.8), strafeDir: Math.random() < 0.5 ? 1 : -1,
          hoverBase: ey
        });
      } else if (type === 'sentinel') {
        this.enemies.push({
          type: 'sentinel', x: ex, y: ey + 1.5, z: ez,
          vx: 0, vy: 0, vz: 0, yaw: 0,
          hp: Math.round(135 * hpScale), maxHp: Math.round(135 * hpScale),
          radius: 2.0, hitFlash: 0,
          fireCd: randRange(1.8, 3.2), shieldAngle: Math.random() * 6.28,
          hoverBase: ey + 1.5
        });
      } else {
        this.enemies.push({
          type: 'sniper', x: ex, y: ey + 4.5, z: ez,
          vx: 0, vy: 0, vz: 0, yaw: 0,
          hp: Math.round(80 * hpScale), maxHp: Math.round(80 * hpScale),
          radius: 1.7, hitFlash: 0,
          chargeTime: 0, lockDir: [0, 0, 1],
          fireCd: randRange(2.4, 4.0), hoverBase: ey + 4.5
        });
      }
    }

    _spawnBoss(kind) {
      this.sound.playBossWarn();
      this.screenShake = Math.max(this.screenShake, 0.7);
      const hp = kind === 'warden'
        ? (1650 + this.sector * 250)
        : (kind === 'leviathan' ? (2300 + this.sector * 300) : (2600 + this.sector * 350));
      const names = {
        warden: 'OBELISK WARDEN',
        leviathan: 'ABYSSAL LEVIATHAN',
        seraph: 'ECLIPSE SERAPH'
      };
      const isLev = kind === 'leviathan';
      const sx = isLev ? 42 : 0;
      const sy = isLev ? 3.5 : 15;
      const sz = isLev ? -42 : -18;
      const trail = [];
      if (isLev) {
        for (let k = 0; k < 78; k++) {
          trail.push({ x: sx - k * 0.48, y: 2.0 - k * 0.02, z: sz, yaw: Math.PI * 0.5, pitch: 0 });
        }
      }
      this.boss = {
        kind,
        name: names[kind] || 'GUARDIAN TITAN',
        x: sx, y: sy, z: sz,
        vx: 0, vy: 0, vz: 0,
        yaw: 0, pitch: 0,
        hp, maxHp: hp,
        radius: isLev ? 4.6 : (kind === 'warden' ? 3.8 : 4.4),
        hitFlash: 0,
        phase: 1,
        state: isLev ? 'swim' : 'orbit', // 'orbit' | 'sweep' | 'barrage' | 'dive' | 'swim' | 'breach'
        stateTimer: 4.0,
        attackCd: 1.6,
        sweepAngle: 0,
        breachTimer: 4.5,
        breachArc: 0,
        trail,
        nodes: kind === 'warden'
          ? [0, 1, 2, 3].map(i => ({ angle: (i / 4) * Math.PI * 2, hp: 180, maxHp: 180, flash: 0 }))
          : []
      };
      this.particles.shockwave(sx, sy, sz, isLev ? [0.22, 0.92, 1.0] : [1.0, 0.35, 0.55], 1.5, 28, 0.8);
    }

    getRelicChoices() {
      // Pick 3 distinct relics weighted toward ones not maxed
      const shuffled = [...RELIC_POOL].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, 3);
    }

    applyRelicChoice(id) {
      this.player.addRelic(id);
      this.awaitingRelic = false;
      this.sound.playUpgrade();
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
      this._setupSector(this.sector + 1);
    }

    update(dt, input, camForward, camRight) {
      if (this.gameOver || this.victory || this.awaitingRelic) return;
      if (this.hitStop > 0) {
        this.hitStop -= dt;
        return;
      }

      this.runTime += dt;
      this.screenShake = Math.max(0, this.screenShake - dt * 2.4);
      this.damageFlash = Math.max(0, this.damageFlash - dt * 2.5);
      if (this.calloutTimer > 0) this.calloutTimer -= dt;

      // Delayed transition to Relic Draft / Victory after sector clear
      if (this.sectorClearDelay > 0) {
        this.sectorClearDelay -= dt;
        if (this.sectorClearDelay <= 0) {
          if (this.mode === 'expedition' && this.sector >= this.maxSectors) {
            this.victory = true;
          } else if (this.mode === 'expedition' || this.sector % 2 === 0) {
            this.awaitingRelic = true;
          } else {
            this._setupSector(this.sector + 1);
          }
        }
      }

      this._updatePlayer(dt, input, camForward, camRight);
      this._updateWorldInteractions(dt);
      if (this.mode !== 'zen' && this.mode !== 'race') {
        this._updatePylons(dt);
        this._updateEnemies(dt);
        this.naval.update(dt, this.runTime, this);
        this._updateBoss(dt);
        this._checkSectorClear();
      } else if (this.mode === 'race' && this.ghost) {
        this.ghost.update(dt, this.runTime, this.player);
      }
      this._updateProjectiles(dt);
      this._updateBeams(dt);
      this._updateTelegraphs(dt);
      this.particles.update(dt);
      this.floatingText.update(dt);
    }

    _updatePlayer(dt, input, camForward, camRight) {
      const p = this.player;
      p.hitFlash = Math.max(0, p.hitFlash - dt * 5.0);
      p.shieldFlash = Math.max(0, p.shieldFlash - dt * 3.5);
      p.dashTimer = Math.max(0, p.dashTimer - dt);
      p.dashCooldown = Math.max(0, p.dashCooldown - dt);
      p.rollTimer = Math.max(0, p.rollTimer - dt);
      p.rollCooldown = Math.max(0, p.rollCooldown - dt);
      p.invulnTimer = Math.max(0, p.invulnTimer - dt);
      p.ringBoostTimer = Math.max(0, p.ringBoostTimer - dt);
      p.shootTimer = Math.max(0, p.shootTimer - dt);
      p.missileTimer = Math.max(0, p.missileTimer - dt);
      p.perfectDodgeCd = Math.max(0, p.perfectDodgeCd - dt);
      p.outOfCombatTimer += dt;
      if (p.outOfCombatTimer > 4.5 && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + 2.5 * dt);
      }

      // Flow decay
      if (p.flow > 1.0) {
        p.flowTimer -= dt;
        if (p.flowTimer <= 0) {
          const decayRate = 0.35 / (1 + 0.3 * p.hasRelic('vampire'));
          p.flow = Math.max(1.0, p.flow - decayRate * dt);
        }
      }

      // Compute camera-planar movement direction
      let fx = camForward[0], fz = camForward[2];
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl; fz /= fl;
      let rx = camRight[0], rz = camRight[2];
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;

      let moveX = fx * input.moveZ + rx * input.moveX;
      let moveZ = fz * input.moveZ + rz * input.moveX;
      const moveLen = Math.hypot(moveX, moveZ);
      if (moveLen > 1e-4) {
        moveX /= moveLen;
        moveZ /= moveLen;
      }

      const speedMult = p.getSpeedMult();
      const hydroMult = p.hydroSkimming ? 1.18 : 1.0;
      const baseCruise = (p.ringBoostTimer > 0 ? 46 : 30) * speedMult * hydroMult;

      // Hyper-Dash trigger
      if (input.dashPressed && p.dashCooldown <= 0 && p.energy >= 24) {
        input.dashPressed = false;
        p.energy -= 24;
        const dashCdMul = Math.pow(0.7, p.hasRelic('dashShock'));
        p.dashCooldown = 1.05 * dashCdMul;
        p.dashTimer = 0.24;
        p.invulnTimer = 0.34;
        const dx = moveLen > 0.05 ? moveX : fx;
        const dz = moveLen > 0.05 ? moveZ : fz;
        p.vel[0] = dx * 56 * speedMult;
        p.vel[2] = dz * 56 * speedMult;
        if (p.vel[1] < 2) p.vel[1] = 2.5;
        this.sound.playDash();
        this.particles.shockwave(p.pos[0], p.pos[1], p.pos[2], [0.35, 0.95, 1.0], 1.1, 8.0, 0.35);
        this.particles.shockwave(p.pos[0], p.pos[1], p.pos[2], [1.0, 0.85, 0.35], 0.5, 4.5, 0.24);
        this.particles.burst(p.pos[0], p.pos[1], p.pos[2], 26, [0.4, 0.95, 1.0], 18, 0.32, 0.42, 'spark', 2);

        // Kinetic Aftershock relic damage
        if (p.hasRelic('dashShock') > 0) {
          this._radialDamage(p.pos[0], p.pos[1], p.pos[2], 12, 42 * p.hasRelic('dashShock') * p.getDamageMult());
        }
      }
      input.dashPressed = false;

      // Horizontal acceleration & smooth inertia
      if (p.dashTimer <= 0) {
        const accel = p.grounded ? 11.0 : 6.2;
        const targetVx = moveX * baseCruise;
        const targetVz = moveZ * baseCruise;
        p.vel[0] = damp(p.vel[0], targetVx, accel, dt);
        p.vel[2] = damp(p.vel[2], targetVz, accel, dt);
      }

      // Ground + Ocean Surface Hover/Hydro-Skim Suspension
      const ground = this.world.getGroundAt(p.pos[0], p.pos[2]);
      const seaY = this.world.seaLevel;
      const floorY = Math.max(ground.height, seaY);
      const overWater = ground.height < seaY;
      const hoverHeight = 1.95;
      const distAbove = p.pos[1] - floorY;
      const horizSpeed = Math.hypot(p.vel[0], p.vel[2]);

      p.grounded = distAbove <= hoverHeight + 0.9 && p.vel[1] <= 7.5;
      p.hydroSkimming = overWater && distAbove < 4.5 && horizSpeed > 10;

      // Barrel Roll Acrobatics (Z / C) — 360° evasive spin with projectile deflection & Flow boost!
      if (input.rollPressed && p.rollCooldown <= 0 && p.energy >= 15) {
        input.rollPressed = false;
        p.energy -= 15;
        p.rollTimer = 0.44;
        p.rollCooldown = 0.85;
        p.rollDir = input.moveX < -0.1 ? -1 : 1;
        p.invulnTimer = Math.max(p.invulnTimer, 0.42);
        p.rollCount++;
        this._bumpFlow(0.25);
        this.sound.playBarrelRoll();
        this.particles.shockwave(p.pos[0], p.pos[1], p.pos[2], [0.55, 0.94, 1.0], 0.8, 4.8, 0.28);
        if (p.rollCount >= 3) {
          this.unlockAchievement('acrobat', 'SKY ACROBAT', 'Performed 3 Barrel Rolls in a flight');
        }
      }
      input.rollPressed = false;

      // Hydro-skim bonus speed & energy recharge when skimming low over waves!
      if (p.hydroSkimming) {
        p.energy = Math.min(p.maxEnergy, p.energy + 22 * dt);
        p.hydroTime += dt;
        if (p.hydroTime >= 5.0) {
          this.unlockAchievement('waverider', 'WAVE RIDER', 'Hydro-skimmed across ocean swells for 5s');
        }
      }

      // Climb / Launch smoothly (holding Space rises smoothly over mountains & waterfalls!)
      if (input.jumpPressed && p.grounded) {
        p.vel[1] = 17.5;
        p.grounded = false;
        this.particles.shockwave(p.pos[0], floorY + 0.15, p.pos[2], overWater ? [0.85, 0.96, 1.0] : [0.55, 0.9, 1.0], 0.7, 5.2, 0.34);
      }
      input.jumpPressed = false;

      // Updraft geysers
      let inUpdraft = false;
      for (const u of this.world.updrafts) {
        const d2 = (p.pos[0] - u.x) ** 2 + (p.pos[2] - u.z) ** 2;
        if (d2 < u.r * u.r && p.pos[1] >= u.y - 2 && p.pos[1] <= u.topY) {
          p.vel[1] = damp(p.vel[1], u.force, 5.5, dt);
          p.energy = Math.min(p.maxEnergy, p.energy + 28 * dt);
          inUpdraft = true;
        }
      }

      // Vertical hover spring OR fluid 3D ascent/glide
      if (p.grounded && !inUpdraft && !input.jumpHeld) {
        const targetY = floorY + hoverHeight;
        const err = targetY - p.pos[1];
        p.vel[1] += err * 85 * dt;
        p.vel[1] *= Math.exp(-12 * dt);
        p.gliding = false;
        p.energy = Math.min(p.maxEnergy, p.energy + (28 + 10 * p.hasRelic('thruster')) * dt);
      } else {
        if (input.jumpHeld && p.energy > 2 && !inUpdraft) {
          p.gliding = true;
          // Smooth flight climb/glide following aim pitch or gentle upward lift
          const desiredVy = clamp(Math.sin(p.aimPitch) * 26 + 5.5, -2.5, 19.5);
          p.vel[1] = damp(p.vel[1], desiredVy, 6.5, dt);
          p.energy = Math.max(0, p.energy - 8 * dt);
        } else {
          p.gliding = false;
          p.vel[1] -= 25.0 * dt;
          p.energy = Math.min(p.maxEnergy, p.energy + (14 + 5 * p.hasRelic('thruster')) * dt);
        }
      }

      // Integrate position
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      p.pos[2] += p.vel[2] * dt;

      // World outer sea boundary soft turnback (keep inside 295m archipelago)
      const radOut = Math.hypot(p.pos[0], p.pos[2]);
      if (radOut > 285) {
        p.pos[0] *= 285 / radOut;
        p.pos[2] *= 285 / radOut;
        p.vel[0] *= -0.4;
        p.vel[2] *= -0.4;
      }

      // Prevent penetrating terrain or ocean floor
      const groundPost = this.world.getGroundAt(p.pos[0], p.pos[2]);
      const floorPost = Math.max(groundPost.height, seaY);
      if (p.pos[1] < floorPost + 1.15 && p.vel[1] < 0) {
        p.pos[1] = floorPost + 1.15;
        p.vel[1] = Math.max(0, p.vel[1]);
      }

      // Solid pillar collision pushout
      for (const pil of this.world.pillars) {
        if (p.pos[1] > pil.y && p.pos[1] < pil.y + 7.2) {
          const dx = p.pos[0] - pil.x;
          const dz = p.pos[2] - pil.z;
          const minR = pil.r + 1.3;
          const dSq = dx * dx + dz * dz;
          if (dSq < minR * minR && dSq > 1e-4) {
            const d = Math.sqrt(dSq);
            p.pos[0] = pil.x + (dx / d) * minR;
            p.pos[2] = pil.z + (dz / d) * minR;
          }
        }
      }

      // Craft visual orientation (mesh nose points along +Z -> (sin(shipYaw), -sin(shipPitch), cos(shipYaw)))
      const firing = input.fireHeld || input.missilePressed;
      let targetShipYaw = wrapAngle(p.aimYaw + Math.PI);
      if (!firing && moveLen > 0.15) {
        targetShipYaw = Math.atan2(moveX, moveZ);
      }
      const prevYaw = p.shipYaw;
      p.shipYaw = dampAngle(p.shipYaw, targetShipYaw, 11.5, dt);
      const yawVel = wrapAngle(p.shipYaw - prevYaw) / Math.max(dt, 0.001);

      // Dynamic banking roll & pitch (positive roll dips -X world / turns right smoothly)
      const sy = Math.sin(p.shipYaw), cy = Math.cos(p.shipYaw);
      const rightWorld = -cy * p.vel[0] + sy * p.vel[2];
      const targetBank = clamp(-yawVel * 0.12 + rightWorld * 0.015, -0.62, 0.62);
      p.bankRoll = damp(p.bankRoll, targetBank, 10, dt);

      const targetPitch = p.grounded
        ? -clamp(p.vel[1] * 0.025, -0.25, 0.3)
        : -clamp(p.vel[1] * 0.028 + (p.gliding ? 0.12 : 0), -0.45, 0.48);
      p.shipPitch = damp(p.shipPitch, targetPitch, 9, dt);

      const targetSweep = (p.dashTimer > 0 || p.ringBoostTimer > 0) ? 0.34 : (p.gliding ? -0.14 : 0);
      p.wingSweep = damp(p.wingSweep, targetSweep, 12, dt);

      // Update wingtip ribbon trails using exact column-major basis vectors
      const sr = Math.sin(p.bankRoll), cr = Math.cos(p.bankRoll);
      const wingSpan = 1.68;
      // Local +X (col0) = (cy*cr, sr, -sy*cr), Local -Z (tail) = (-sy, 0, -cy)
      const rxLocal = cy * cr, ryLocal = sr, rzLocal = -sy * cr;
      const bx = -sy * 1.05, bz = -cy * 1.05;
      const boostW = (p.dashTimer > 0 || p.ringBoostTimer > 0) ? 1.85 : 1.0;

      p.trailL.push(
        p.pos[0] - rxLocal * wingSpan + bx,
        p.pos[1] - ryLocal * wingSpan + 0.15,
        p.pos[2] - rzLocal * wingSpan + bz,
        boostW
      );
      p.trailR.push(
        p.pos[0] + rxLocal * wingSpan + bx,
        p.pos[1] + ryLocal * wingSpan + 0.15,
        p.pos[2] + rzLocal * wingSpan + bz,
        boostW
      );
      p.trailL.update(dt);
      p.trailR.update(dt);

      // Ocean Hydro-Skim Water Spray & Ground Wake Sparks (NO soap-bubble orbs!)
      if (p.hydroSkimming) {
        for (const s of [-1.2, 1.2]) {
          if (Math.random() < 0.72) {
            this.particles.spawn({
              x: p.pos[0] + cy * s + randRange(-0.25, 0.25),
              y: seaY + 0.18,
              z: p.pos[2] - sy * s + randRange(-0.25, 0.25),
              vx: -p.vel[0] * 0.12 + cy * s * 4.5 + randRange(-1.5, 1.5),
              vy: randRange(2.4, 6.2),
              vz: -p.vel[2] * 0.12 - sy * s * 4.5 + randRange(-1.5, 1.5),
              r: 0.88, g: 0.96, b: 1.0,
              size: 0.22, endSize: 0.02, life: 0.42, gravity: 11, kind: 'spark'
            });
          }
        }
      } else if (p.grounded && horizSpeed > 15 && Math.random() < 0.4) {
        this.particles.spawn({
          x: p.pos[0] + randRange(-1.1, 1.1),
          y: floorY + 0.15,
          z: p.pos[2] + randRange(-1.1, 1.1),
          vx: -p.vel[0] * 0.12 + randRange(-2.2, 2.2),
          vy: randRange(1.5, 3.8),
          vz: -p.vel[2] * 0.12 + randRange(-2.2, 2.2),
          r: 0.92, g: 0.85, b: 0.65,
          size: 0.16, endSize: 0.01, life: 0.34, gravity: 8, kind: 'spark'
        });
      }

      // Weapons (allowed in combat modes & even playful target shooting in Zen!)
      if (input.fireHeld && p.shootTimer <= 0) {
        this._firePrimary();
      }
      if (input.missilePressed) {
        input.missilePressed = false;
        if (p.missileTimer <= 0 && p.energy >= 20) {
          this._fireMissiles();
        }
      }
      if (input.novaPressed) {
        input.novaPressed = false;
        if (p.nova >= 100) {
          this._fireSolarNova();
        }
      }

      // Autonomous Orbital Wingmen Drones
      const dronePairs = p.hasRelic('drones');
      if (dronePairs > 0 && this.mode !== 'zen') {
        p.droneAngle += dt * 2.8;
        p.droneFireTimer -= dt;
        if (p.droneFireTimer <= 0) {
          p.droneFireTimer = 0.48 / Math.max(1, dronePairs * 0.75);
          const nearest = this._findNearestTarget(p.pos[0], p.pos[1], p.pos[2], 62);
          if (nearest) {
            const count = dronePairs * 2;
            for (let i = 0; i < count; i++) {
              const a = p.droneAngle + (i / count) * Math.PI * 2;
              const dx = p.pos[0] + Math.cos(a) * 2.8;
              const dy = p.pos[1] + 0.9;
              const dz = p.pos[2] + Math.sin(a) * 2.8;
              const dir = Vec3.normalize(Vec3.create(), [nearest.x - dx, nearest.y - dy, nearest.z - dz]);
              this._spawnPlayerBolt(dx, dy, dz, dir[0], dir[1], dir[2], 14 * p.getDamageMult(), [0.45, 1.0, 0.72]);
            }
          }
        }
      }
    }

    _computeAimPoint(out) {
      const p = this.player;
      const fwd = p.getForwardDir(this._v1);
      // Raycast gently toward nearest target inside crosshair cone for fluid 3D dogfighting
      let bestTarget = null;
      let bestScore = 0.965; // cos(~15 deg) generous smart-aim cone
      const maxRange = 135;

      const consider = (tx, ty, tz) => {
        const dx = tx - p.pos[0], dy = ty - p.pos[1], dz = tz - p.pos[2];
        const d = Math.hypot(dx, dy, dz);
        if (d < 2 || d > maxRange) return;
        const dot = (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / d;
        if (dot > bestScore) {
          bestScore = dot;
          bestTarget = { x: tx, y: ty, z: tz };
        }
      };

      for (const e of this.enemies) consider(e.x, e.y, e.z);
      for (const py of this.pylons) consider(py.x, py.y + 3.5, py.z);
      if (this.boss) {
        consider(this.boss.x, this.boss.y, this.boss.z);
        for (const n of this.boss.nodes) {
          if (n.hp > 0) {
            consider(this.boss.x + Math.cos(n.angle) * 5.8, this.boss.y + 0.5, this.boss.z + Math.sin(n.angle) * 5.8);
          }
        }
      }

      if (bestTarget) {
        out[0] = bestTarget.x;
        out[1] = bestTarget.y;
        out[2] = bestTarget.z;
      } else {
        out[0] = p.pos[0] + fwd[0] * 85;
        out[1] = p.pos[1] + fwd[1] * 85;
        out[2] = p.pos[2] + fwd[2] * 85;
      }
      return out;
    }

    _firePrimary() {
      const p = this.player;
      const spec = p.getShipSpec();
      p.shootTimer = spec.fireCd / p.getFireRateMult();

      const aim = this._computeAimPoint(this._aimTarget);
      const baseDir = Vec3.normalize(Vec3.create(), [
        aim[0] - p.pos[0],
        aim[1] - p.pos[1],
        aim[2] - p.pos[2]
      ]);

      const sy = Math.sin(p.shipYaw), cy = Math.cos(p.shipYaw);
      const dmg = 22 * p.getDamageMult();

      if (spec.weaponType === 'arc') {
        // Tempest-RX: Instantaneous Chaining Arc-Lightning Lance!
        this.sound.playArc();
        this.shotsFired++;
        const muzzleX = p.pos[0] + baseDir[0] * 1.4;
        const muzzleY = p.pos[1] + 0.1 + baseDir[1] * 1.4;
        const muzzleZ = p.pos[2] + baseDir[2] * 1.4;
        const endPt = [muzzleX + baseDir[0] * 92, muzzleY + baseDir[1] * 92, muzzleZ + baseDir[2] * 92];

        // Snap directly to locked target if close in cone
        let hitObj = null;
        let bestDist = 96;
        const checkSnap = (obj, tx, ty, tz, rad) => {
          const dSq = distPointSegmentSq([tx, ty, tz], [muzzleX, muzzleY, muzzleZ], endPt);
          const dist = Math.hypot(tx - muzzleX, ty - muzzleY, tz - muzzleZ);
          if (dSq <= (rad + 2.4) ** 2 && dist < bestDist) {
            bestDist = dist;
            hitObj = { obj, x: tx, y: ty, z: tz };
          }
        };
        for (const e of this.enemies) checkSnap(e, e.x, e.y, e.z, e.radius);
        for (const py of this.pylons) checkSnap(py, py.x, py.y + 3.5, py.z, 2.5);
        for (const boat of this.naval.boats) checkSnap(boat, boat.x, boat.y + 1.0, boat.z, 3.0);
        if (this.boss) {
          checkSnap(this.boss, this.boss.x, this.boss.y, this.boss.z, this.boss.radius);
          if (this.boss.kind === 'leviathan' && this.boss.trail.length > 10) {
            for (let s = 0; s < 5; s++) {
              const seg = this.boss.trail[Math.min(this.boss.trail.length - 1, (s + 1) * 9)];
              checkSnap(this.boss, seg.x, seg.y, seg.z, 3.2 - s * 0.25);
            }
          }
        }

        const targetPos = hitObj ? [hitObj.x, hitObj.y, hitObj.z] : endPt;
        this.beams.push({
          ax: muzzleX, ay: muzzleY, az: muzzleZ,
          bx: targetPos[0], by: targetPos[1], bz: targetPos[2],
          life: 0.12, maxLife: 0.12, radius: 0.32, dmg: 0,
          col: [0.48, 0.86, 1.0], hitApplied: true
        });
        if (hitObj) {
          this.shotsHit++;
          const arcDmg = 34 * p.getDamageMult();
          if (hitObj.obj === this.boss) this._damageBoss(arcDmg, hitObj.x, hitObj.y, hitObj.z);
          else {
            const ei = this.enemies.indexOf(hitObj.obj);
            if (ei >= 0) this._damageEnemy(hitObj.obj, arcDmg, ei);
            else {
              const pi = this.pylons.indexOf(hitObj.obj);
              if (pi >= 0) this._damagePylon(hitObj.obj, arcDmg, pi);
              else {
                const bi = this.naval.boats.indexOf(hitObj.obj);
                if (bi >= 0) this._damageBoat(hitObj.obj, arcDmg, bi);
              }
            }
          }
          this._chainLightning(hitObj.x, hitObj.y, hitObj.z, arcDmg * 0.65, hitObj.obj);
          this.particles.burst(hitObj.x, hitObj.y, hitObj.z, 8, [0.55, 0.9, 1.0], 14, 0.22, 0.28, 'spark', 2);
        }
        return;
      }

      if (spec.weaponType === 'rail') {
        // Solaris Titan: High-velocity piercing heavy Solar Railgun Slug!
        this.sound.playRailgun();
        this.shotsFired++;
        this.projectiles.push({
          friendly: true,
          homing: false,
          rail: true,
          x: p.pos[0] + baseDir[0] * 1.8,
          y: p.pos[1] + 0.12 + baseDir[1] * 1.8,
          z: p.pos[2] + baseDir[2] * 1.8,
          vx: baseDir[0] * 168,
          vy: baseDir[1] * 168,
          vz: baseDir[2] * 168,
          dmg: 62 * p.getDamageMult(),
          radius: 1.45,
          life: 1.5,
          col: [1.0, 0.82, 0.34],
          chain: p.hasRelic('chain')
        });
        this.particles.burst(p.pos[0] + baseDir[0] * 2.2, p.pos[1] + 0.12, p.pos[2] + baseDir[2] * 2.2, 6, [1.0, 0.85, 0.35], 12, 0.2, 0.2, 'spark', 0);
        return;
      }

      // Valkyrie-IX: Twin rapid-fire plasma bolts
      this.sound.playShoot(0.95 + Math.random() * 0.12);
      for (const side of [-0.75, 0.75]) {
        const sx = p.pos[0] + cy * side;
        const sz = p.pos[2] - sy * side;
        this._spawnPlayerBolt(sx, p.pos[1] + 0.05, sz, baseDir[0], baseDir[1], baseDir[2], dmg, [0.32, 0.95, 1.0]);
        this.shotsFired++;
      }

      const splits = p.hasRelic('multishot');
      if (splits > 0) {
        for (let k = 1; k <= splits; k++) {
          const ang = 0.095 * k;
          for (const sgn of [-1, 1]) {
            const a = ang * sgn;
            const c = Math.cos(a), s = Math.sin(a);
            const dx = baseDir[0] * c - baseDir[2] * s;
            const dz = baseDir[0] * s + baseDir[2] * c;
            this._spawnPlayerBolt(p.pos[0], p.pos[1] + 0.1, p.pos[2], dx, baseDir[1], dz, dmg * 0.72, [1.0, 0.85, 0.35]);
            this.shotsFired++;
          }
        }
      }
    }

    _spawnPlayerBolt(x, y, z, dx, dy, dz, dmg, col) {
      const speed = 108;
      this.projectiles.push({
        friendly: true,
        homing: false,
        x, y, z,
        vx: dx * speed, vy: dy * speed, vz: dz * speed,
        dmg,
        radius: 0.9,
        life: 1.5,
        col,
        chain: this.player.hasRelic('chain')
      });
    }

    _fireMissiles() {
      const p = this.player;
      p.energy -= 20;
      p.missileTimer = 1.6 / p.getFireRateMult();
      this.sound.playMissile();

      const spec = p.getShipSpec();
      const mCount = spec.missileCount || 4;
      const targets = this.getLockedTargets(mCount);
      const dmg = 52 * p.getDamageMult();
      for (let i = 0; i < mCount; i++) {
        const side = (i % 2 === 0 ? -1 : 1) * (1.0 + Math.floor(i / 2) * 0.45);
        const sy = Math.sin(p.shipYaw), cy = Math.cos(p.shipYaw);
        const fwd = p.getForwardDir(this._v1);
        const tgt = targets.length > 0 ? targets[i % targets.length] : null;
        this.projectiles.push({
          friendly: true,
          homing: true,
          target: tgt,
          x: p.pos[0] + cy * side,
          y: p.pos[1] + 0.45,
          z: p.pos[2] - sy * side,
          vx: (fwd[0] + cy * side * 0.55) * 32,
          vy: (fwd[1] + 0.38) * 32,
          vz: (fwd[2] - sy * side * 0.55) * 32,
          dmg,
          radius: 1.35,
          life: 3.4,
          col: [1.0, 0.78, 0.25],
          chain: p.hasRelic('chain')
        });
      }
    }

    _fireSolarNova() {
      const p = this.player;
      p.nova = 0;
      p.invulnTimer = Math.max(p.invulnTimer, 1.0);
      this.sound.playNova();
      this.screenShake = 0.85;
      this.particles.shockwave(p.pos[0], p.pos[1], p.pos[2], [1.0, 0.88, 0.35], 1.5, 36, 0.65);
      this.particles.burst(p.pos[0], p.pos[1], p.pos[2], 65, [1.0, 0.82, 0.32], 28, 0.5, 0.75, 'spark', 4);
      this.showCallout('SOLAR NOVA UNLEASHED!', 1.8);

      // Vaporize enemy projectiles within 42 units
      this.projectiles = this.projectiles.filter(pr => {
        if (!pr.friendly && Vec3.dist([pr.x, pr.y, pr.z], p.pos) < 42) {
          this.particles.burst(pr.x, pr.y, pr.z, 3, [1.0, 0.85, 0.4], 8, 0.2, 0.25, 'orb', 0);
          return false;
        }
        return true;
      });

      this._radialDamage(p.pos[0], p.pos[1], p.pos[2], 36, 240 * p.getDamageMult());
    }

    _radialDamage(cx, cy, cz, radius, dmg) {
      const rSq = radius * radius;
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if ((e.x - cx) ** 2 + (e.y - cy) ** 2 + (e.z - cz) ** 2 <= rSq) {
          this._damageEnemy(e, dmg, i);
        }
      }
      for (let i = this.pylons.length - 1; i >= 0; i--) {
        const py = this.pylons[i];
        if ((py.x - cx) ** 2 + (py.y + 3 - cy) ** 2 + (py.z - cz) ** 2 <= rSq) {
          this._damagePylon(py, dmg, i);
        }
      }
      for (let i = this.naval.boats.length - 1; i >= 0; i--) {
        const b = this.naval.boats[i];
        if ((b.x - cx) ** 2 + (b.y + 1.0 - cy) ** 2 + (b.z - cz) ** 2 <= (radius + 2.5) ** 2) {
          this._damageBoat(b, dmg, i);
        }
      }
      if (this.boss) {
        if ((this.boss.x - cx) ** 2 + (this.boss.y - cy) ** 2 + (this.boss.z - cz) ** 2 <= (radius + 5) ** 2) {
          this._damageBoss(dmg, cx, cy, cz);
        }
      }
    }

    getLockedTargets(limit = 4) {
      const p = this.player;
      const fwd = p.getForwardDir(this._v1);
      const list = [];
      const addIfFront = (obj, x, y, z) => {
        const dx = x - p.pos[0], dy = y - p.pos[1], dz = z - p.pos[2];
        const d = Math.hypot(dx, dy, dz);
        if (d > 125 || d < 2) return;
        const dot = (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / d;
        if (dot > 0.65) list.push({ obj, score: dot - d * 0.002 });
      };
      for (const e of this.enemies) addIfFront(e, e.x, e.y, e.z);
      for (const py of this.pylons) addIfFront(py, py.x, py.y + 3.5, py.z);
      for (const b of this.naval.boats) addIfFront(b, b.x, b.y + 1.0, b.z);
      if (this.boss) addIfFront(this.boss, this.boss.x, this.boss.y, this.boss.z);
      list.sort((a, b) => b.score - a.score);
      return list.slice(0, limit).map(x => x.obj);
    }

    _findNearestTarget(x, y, z, maxDist) {
      let best = null;
      let bestSq = maxDist * maxDist;
      for (const e of this.enemies) {
        const d2 = (e.x - x) ** 2 + (e.y - y) ** 2 + (e.z - z) ** 2;
        if (d2 < bestSq) { bestSq = d2; best = e; }
      }
      if (this.boss) {
        const d2 = (this.boss.x - x) ** 2 + (this.boss.y - y) ** 2 + (this.boss.z - z) ** 2;
        if (d2 < bestSq) { bestSq = d2; best = this.boss; }
      }
      return best;
    }

    _updateWorldInteractions(dt) {
      const p = this.player;
      // Sky Boost Rings (Sequential Race mode OR Free Boost rings)
      for (let ri = 0; ri < this.world.rings.length; ri++) {
        const ring = this.world.rings[ri];
        if (ring.cooldown > 0) ring.cooldown -= dt;
        if (this.mode === 'race' && ri !== this.raceIndex) continue;

        const dSq = (p.pos[0] - ring.x) ** 2 + (p.pos[1] - ring.y) ** 2 + (p.pos[2] - ring.z) ** 2;
        if (ring.cooldown <= 0 && dSq < (ring.r + 2.2) ** 2) {
          ring.cooldown = this.mode === 'race' ? 0 : 4.0;
          p.ringBoostTimer = 1.9;
          p.energy = Math.min(p.maxEnergy, p.energy + 45);
          p.hp = Math.min(p.maxHp, p.hp + 10);
          p.nova = Math.min(100, p.nova + 12);
          this._bumpFlow(0.5);
          this.score += Math.round(200 * p.flow);
          this.sound.playRingBoost();
          const fwd = p.getForwardDir(this._v1);
          p.vel[0] += fwd[0] * 18;
          p.vel[1] += Math.max(3, fwd[1] * 12);
          p.vel[2] += fwd[2] * 18;
          this.particles.shockwave(ring.x, ring.y, ring.z, [0.3, 0.95, 1.0], ring.r * 0.7, ring.r * 1.9, 0.38);

          if (this.mode === 'race') {
            if (this.ghost) this.ghost.recordGateSplit(this.runTime, this.raceIndex);
            this.raceIndex++;
            this.floatingText.spawn(ring.x, ring.y + 1.8, ring.z, `GATE ${this.raceIndex}/${this.world.rings.length}`, '#ffcf5c', 18);
            if (this.raceIndex >= this.world.rings.length) {
              this.victory = true;
              this.sound.playUpgrade();
              const isNewBest = this.ghost ? this.ghost.finishRun(this.runTime, this.player.shipId) : false;
              this.showCallout(isNewBest ? 'NEW GHOST RECORD!' : 'RING RACE COMPLETE!', 3.2);
            }
          } else {
            this.floatingText.spawn(ring.x, ring.y + 1.5, ring.z, 'RING BOOST!', '#5cf2ff', 17);
          }
        }
      }

      // Collectible Aether Shards
      for (const s of this.world.shards) {
        if (s.collected) continue;
        const dSq = (p.pos[0] - s.x) ** 2 + (p.pos[1] - s.y) ** 2 + (p.pos[2] - s.z) ** 2;
        if (dSq < 3.4 * 3.4) {
          s.collected = true;
          this.shardsCollected++;
          p.hp = Math.min(p.maxHp, p.hp + 6);
          p.nova = Math.min(100, p.nova + 10);
          this._bumpFlow(0.35);
          this.score += Math.round(100 * p.flow);
          this.sound.playHit(true);
          this.particles.burst(s.x, s.y, s.z, 14, [1.0, 0.92, 0.42], 12, 0.22, 0.45, 'spark', 4);
          this.floatingText.spawn(s.x, s.y + 1, s.z, '+SHARD', '#ffe066', 14);
        }
      }
    }

    _updatePylons(dt) {
      const p = this.player;
      for (const py of this.pylons) {
        py.hitFlash = Math.max(0, py.hitFlash - dt * 5);
        py.mortarTimer -= dt;
        if (py.mortarTimer <= 0) {
          py.mortarTimer = Math.max(2.6, 5.2 - this.sector * 0.35);
          const d = Math.hypot(p.pos[0] - py.x, p.pos[2] - py.z);
          if (d < 95) {
            this._spawnTelegraph(p.pos[0] + p.vel[0] * 0.55, p.pos[2] + p.vel[2] * 0.55, 5.5, 1.35, 18);
          }
        }
      }

      // Reinforcement spawning while pylons stand
      if (this.pylons.length > 0 && this.enemies.length < 7 + this.sector * 2) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = Math.max(2.6, 5.5 - this.sector * 0.45);
          this._spawnEnemyAroundPlayer(this.sector);
        }
      }
    }

    _updateEnemies(dt) {
      const p = this.player;
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        e.hitFlash = Math.max(0, e.hitFlash - dt * 5);

        const dx = p.pos[0] - e.x;
        const dy = p.pos[1] - e.y;
        const dz = p.pos[2] - e.z;
        const dist = Math.hypot(dx, dy, dz) || 1;
        const targetYaw = Math.atan2(dx, dz);
        e.yaw = dampAngle(e.yaw, targetYaw, 6, dt);

        if (e.type === 'scout') {
          const desiredDist = 22;
          const radPull = clamp((dist - desiredDist) * 0.65, -14, 16);
          const tx = -dz / dist * e.strafeDir * 12 + (dx / dist) * radPull;
          const tz = dx / dist * e.strafeDir * 12 + (dz / dist) * radPull;
          e.vx = damp(e.vx, tx, 3.5, dt);
          e.vz = damp(e.vz, tz, 3.5, dt);
          e.vy = damp(e.vy, (p.pos[1] + 2.5 - e.y) * 1.4 + Math.sin(this.runTime * 3 + i) * 2.5, 4, dt);
          e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;

          e.fireCd -= dt;
          if (e.fireCd <= 0 && dist < 85) {
            e.fireCd = randRange(2.1, 3.3);
            this._spawnEnemyBolt(e.x, e.y, e.z, dx / dist, dy / dist, dz / dist, 32, 8 + this.sector, [1.0, 0.28, 0.42]);
          }
        } else if (e.type === 'sentinel') {
          e.shieldAngle += dt * 1.9;
          const desiredDist = 28;
          const radPull = clamp((dist - desiredDist) * 0.4, -8, 10);
          e.vx = damp(e.vx, (dx / dist) * radPull - (dz / dist) * 5, 2.5, dt);
          e.vz = damp(e.vz, (dz / dist) * radPull + (dx / dist) * 5, 2.5, dt);
          e.vy = damp(e.vy, (p.pos[1] + 3.2 - e.y) * 1.0, 3, dt);
          e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;

          e.fireCd -= dt;
          if (e.fireCd <= 0 && dist < 95) {
            e.fireCd = 2.6;
            for (let k = -2; k <= 2; k++) {
              const a = Math.atan2(dx, dz) + k * 0.16;
              this._spawnEnemyBolt(e.x, e.y, e.z, Math.sin(a), clamp(dy / dist, -0.3, 0.3), Math.cos(a), 28, 12, [1.0, 0.52, 0.18]);
            }
          }
        } else if (e.type === 'sniper') {
          const desiredDist = 48;
          const radPull = clamp((dist - desiredDist) * 0.45, -10, 12);
          e.vx = damp(e.vx, (dx / dist) * radPull, 2.2, dt);
          e.vz = damp(e.vz, (dz / dist) * radPull, 2.2, dt);
          e.vy = damp(e.vy, (p.pos[1] + 5.5 - e.y) * 1.1, 3, dt);
          e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;

          if (e.chargeTime > 0) {
            e.chargeTime -= dt;
            // Track slowly during early lock, then freeze just before shot!
            if (e.chargeTime > 0.32) {
              Vec3.normalize(e.lockDir, [dx, dy, dz]);
            }
            if (e.chargeTime <= 0) {
              // Fire blazing sniper beam!
              this.beams.push({
                ax: e.x, ay: e.y, az: e.z,
                bx: e.x + e.lockDir[0] * 115,
                by: e.y + e.lockDir[1] * 115,
                bz: e.z + e.lockDir[2] * 115,
                life: 0.22, maxLife: 0.22,
                radius: 1.5, dmg: 22,
                col: [1.0, 0.24, 0.85],
                hitApplied: false
              });
              e.fireCd = 3.2;
            }
          } else {
            e.fireCd -= dt;
            if (e.fireCd <= 0 && dist < 105) {
              e.chargeTime = 1.25;
              Vec3.normalize(e.lockDir, [dx, dy, dz]);
            }
          }
        }
      }
    }

    _updateBoss(dt) {
      const b = this.boss;
      if (!b) return;
      b.hitFlash = Math.max(0, b.hitFlash - dt * 5);
      const p = this.player;

      if (b.hp < b.maxHp * 0.55 && b.phase === 1) {
        b.phase = 2;
        this.showCallout(`${b.name} ENTERS PHASE II — SOLAR OVERDRIVE!`, 2.6);
        this.particles.shockwave(b.x, b.y, b.z, [1.0, 0.28, 0.48], 2.0, 32, 0.7);
        this.sound.playBossWarn();
      }

      // Spin Warden nodes
      for (const n of b.nodes) {
        n.angle += dt * (b.phase === 2 ? 2.1 : 1.35);
        n.flash = Math.max(0, n.flash - dt * 5);
      }

      const dx = p.pos[0] - b.x;
      const dy = p.pos[1] - b.y;
      const dz = p.pos[2] - b.z;
      const dist = Math.hypot(dx, dy, dz) || 1;

      if (b.kind === 'leviathan') {
        const spd = b.phase === 2 ? 0.56 : 0.40;
        const t = this.runTime * spd;
        const targetX = Math.sin(t) * 62 + Math.cos(t * 0.5) * 18;
        const targetZ = Math.sin(t * 2.0) * 38 - 10;

        b.breachTimer -= dt;
        if (b.breachTimer <= 0) {
          b.breachTimer = b.phase === 2 ? 4.6 : 6.2;
          b.breachArc = 2.4;
          this.sound.playThunder();
          this.particles.shockwave(b.x, 0.35, b.z, [0.35, 0.95, 1.0], 1.5, 22, 0.65);
          this.particles.burst(b.x, 0.8, b.z, 36, [0.85, 0.96, 1.0], 24, 0.42, 0.72, 'spark', 14);
        }
        let targetY = 2.6 + Math.sin(this.runTime * 2.6) * 2.1;
        if (b.breachArc > 0) {
          b.breachArc = Math.max(0, b.breachArc - dt);
          const u = 1.0 - b.breachArc / 2.4;
          targetY = 1.6 + Math.sin(u * Math.PI) * 16.5;
          if (b.breachArc <= dt) {
            this.particles.shockwave(b.x, 0.35, b.z, [0.45, 0.95, 1.0], 1.2, 20, 0.55);
            this.particles.burst(b.x, 0.6, b.z, 28, [0.88, 0.98, 1.0], 20, 0.38, 0.65, 'spark', 14);
          }
        }

        const stepDx = targetX - b.x;
        const stepDz = targetZ - b.z;
        const stepDy = targetY - b.y;
        b.x = damp(b.x, targetX, 2.4, dt);
        b.y = damp(b.y, targetY, 2.8, dt);
        b.z = damp(b.z, targetZ, 2.4, dt);
        if (Math.hypot(stepDx, stepDz) > 0.05) {
          b.yaw = dampAngle(b.yaw, Math.atan2(stepDx, stepDz), 5.2, dt);
        }
        b.pitch = damp(b.pitch || 0, clamp(-stepDy * 0.09, -0.58, 0.58), 5.5, dt);

        b.trail.unshift({ x: b.x, y: b.y, z: b.z, yaw: b.yaw, pitch: b.pitch });
        if (b.trail.length > 96) b.trail.pop();

        // Ocean surface splashes along dorsal spine
        if (b.y < 3.0 && Math.random() < 0.65) {
          this.particles.spawn({
            x: b.x + randRange(-2, 2), y: 0.25, z: b.z + randRange(-2, 2),
            vx: randRange(-4, 4), vy: randRange(3, 8), vz: randRange(-4, 4),
            r: 0.85, g: 0.96, b: 1.0, a: 0.78,
            size: 0.38, endSize: 0.05, life: 0.52, gravity: 11, kind: 'spark'
          });
        }

        b.attackCd -= dt;
        if (b.attackCd <= 0) {
          b.attackCd = b.phase === 2 ? 1.15 : 1.65;
          const bolts = b.phase === 2 ? 5 : 3;
          const aimA = Math.atan2(dx, dz);
          for (let k = -Math.floor(bolts / 2); k <= Math.floor(bolts / 2); k++) {
            const a = aimA + k * 0.17;
            this._spawnEnemyBolt(b.x, b.y + 0.8, b.z, Math.sin(a), dy / dist, Math.cos(a), 36, 14, [0.25, 0.95, 1.0]);
          }
          if (b.phase === 2 && Math.random() < 0.45) {
            this._spawnTelegraph(p.pos[0] + p.vel[0] * 0.55, p.pos[2] + p.vel[2] * 0.55, 6.2, 1.25, 18);
          }
        }
        return;
      }

      b.yaw = dampAngle(b.yaw, Math.atan2(dx, dz), 4, dt);

      // Hover & orbit smoothly above Citadel
      const orbitA = this.runTime * (b.phase === 2 ? 0.55 : 0.36);
      const targetX = Math.cos(orbitA) * (b.kind === 'seraph' ? 28 : 16);
      const targetZ = Math.sin(orbitA) * (b.kind === 'seraph' ? 28 : 16);
      const targetY = (b.kind === 'seraph' ? 16 : 13) + Math.sin(this.runTime * 1.4) * 2.2;
      b.x = damp(b.x, targetX, 1.8, dt);
      b.y = damp(b.y, targetY, 2.2, dt);
      b.z = damp(b.z, targetZ, 1.8, dt);

      b.stateTimer -= dt;
      b.attackCd -= dt;

      if (b.kind === 'warden') {
        if (b.state === 'orbit') {
          if (b.attackCd <= 0) {
            b.attackCd = b.phase === 2 ? 1.15 : 1.55;
            // Radial ring volley + mortar telegraph
            const shots = b.phase === 2 ? 12 : 8;
            for (let i = 0; i < shots; i++) {
              const a = (i / shots) * Math.PI * 2 + this.runTime;
              this._spawnEnemyBolt(b.x, b.y, b.z, Math.sin(a), -0.18, Math.cos(a), 26, 13, [1.0, 0.35, 0.25]);
            }
            this._spawnTelegraph(p.pos[0] + p.vel[0] * 0.45, p.pos[2] + p.vel[2] * 0.45, 6.2, 1.25, 20);
          }
          if (b.stateTimer <= 0) {
            b.state = 'sweep';
            b.stateTimer = 4.2;
            b.sweepAngle = Math.atan2(dx, dz) - 1.3;
          }
        } else if (b.state === 'sweep') {
          b.sweepAngle += dt * (b.phase === 2 ? 1.05 : 0.78);
          const bLen = 85;
          const bx = b.x + Math.sin(b.sweepAngle) * bLen;
          const bz = b.z + Math.cos(b.sweepAngle) * bLen;
          this.beams.push({
            ax: b.x, ay: b.y - 1.5, az: b.z,
            bx, by: 3.5, bz,
            life: 0.04, maxLife: 0.04,
            radius: 1.9, dmg: 16,
            col: [1.0, 0.45, 0.18],
            hitApplied: false
          });
          if (b.stateTimer <= 0) {
            b.state = 'orbit';
            b.stateTimer = 4.5;
          }
        }
      } else {
        // Eclipse Seraph attacks
        if (b.attackCd <= 0) {
          b.attackCd = b.phase === 2 ? 1.0 : 1.45;
          if (Math.random() < 0.55) {
            // Aimed burst fan
            const count = b.phase === 2 ? 7 : 5;
            for (let k = -Math.floor(count / 2); k <= Math.floor(count / 2); k++) {
              const a = Math.atan2(dx, dz) + k * 0.16;
              this._spawnEnemyBolt(b.x, b.y, b.z, Math.sin(a), dy / dist, Math.cos(a), 36, 14, [1.0, 0.25, 0.55]);
            }
          } else {
            // Dual sky telegraphs
            this._spawnTelegraph(p.pos[0], p.pos[2], 6.5, 1.15, 22);
            this._spawnTelegraph(p.pos[0] + p.vel[0] * 0.8, p.pos[2] + p.vel[2] * 0.8, 5.5, 1.35, 18);
          }
        }
        if (b.stateTimer <= 0) {
          b.stateTimer = 4.5;
          // Summon 2 escort scouts if low
          if (this.enemies.length < 4) {
            this._spawnEnemyAroundPlayer(this.sector);
          }
        }
      }
    }

    _spawnEnemyBolt(x, y, z, dx, dy, dz, speed, dmg, col) {
      const l = Math.hypot(dx, dy, dz) || 1;
      this.projectiles.push({
        friendly: false,
        homing: false,
        x, y, z,
        vx: (dx / l) * speed,
        vy: (dy / l) * speed,
        vz: (dz / l) * speed,
        dmg,
        radius: 0.95,
        life: 3.8,
        col
      });
    }

    _spawnTelegraph(x, z, radius, delay, dmg) {
      const g = this.world.getGroundAt(x, z);
      this.telegraphs.push({
        x, y: Math.max(g.height, this.world.seaLevel) + 0.22, z,
        radius, timer: delay, maxTimer: delay, dmg
      });
    }

    _updateProjectiles(dt) {
      const p = this.player;
      let i = 0;
      while (i < this.projectiles.length) {
        const pr = this.projectiles[i];
        pr.life -= dt;
        if (pr.life <= 0) {
          this.projectiles.splice(i, 1);
          continue;
        }

        // Homing missile steering
        if (pr.homing && pr.target) {
          const tx = pr.target.x;
          const ty = pr.target.cx !== undefined
            ? pr.target.y + 1.0
            : (pr.target.hp !== undefined && pr.target.maxHp !== undefined && pr.target.radius === undefined
              ? pr.target.y + 3.5 : pr.target.y);
          const tz = pr.target.z;
          const dx = tx - pr.x, dy = ty - pr.y, dz = tz - pr.z;
          const d = Math.hypot(dx, dy, dz);
          if (d > 0.1 && (pr.target.hp === undefined || pr.target.hp > 0)) {
            const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
            const desiredVx = (dx / d) * sp * 1.04;
            const desiredVy = (dy / d) * sp * 1.04;
            const desiredVz = (dz / d) * sp * 1.04;
            pr.vx = damp(pr.vx, desiredVx, 7.5, dt);
            pr.vy = damp(pr.vy, desiredVy, 7.5, dt);
            pr.vz = damp(pr.vz, desiredVz, 7.5, dt);
          }
          if (Math.random() < 0.7) {
            this.particles.spawn({
              x: pr.x, y: pr.y, z: pr.z,
              r: pr.col[0], g: pr.col[1], b: pr.col[2],
              size: 0.22, endSize: 0.02, life: 0.22, kind: 'orb'
            });
          }
        }

        const prevX = pr.x, prevY = pr.y, prevZ = pr.z;
        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;
        pr.z += pr.vz * dt;

        // Terrain or ocean splash collision
        const g = this.world.getGroundAt(pr.x, pr.z);
        const surfY = Math.max(g.height, this.world.seaLevel);
        if (pr.y <= surfY + 0.15) {
          const hitWater = g.height < this.world.seaLevel;
          this.particles.burst(pr.x, surfY + 0.2, pr.z, 6, hitWater ? [0.85, 0.96, 1.0] : pr.col, 9, 0.20, 0.28, 'spark', 8);
          this.projectiles.splice(i, 1);
          continue;
        }

        let consumed = false;
        if (pr.friendly) {
          // Check Enemies
          for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
            const e = this.enemies[ei];
            const hitR = e.radius + pr.radius;
            if (distPointSegmentSq([e.x, e.y, e.z], [prevX, prevY, prevZ], [pr.x, pr.y, pr.z]) <= hitR * hitR) {
              this.shotsHit++;
              this._damageEnemy(e, pr.dmg, ei);
              if (pr.chain > 0) this._chainLightning(e.x, e.y, e.z, pr.dmg * 0.45 * pr.chain, e);
              consumed = true;
              break;
            }
          }
          // Check Pylons
          if (!consumed) {
            for (let pi = this.pylons.length - 1; pi >= 0; pi--) {
              const py = this.pylons[pi];
              const hitR = 2.4 + pr.radius;
              if (distPointSegmentSq([py.x, py.y + 3.4, py.z], [prevX, prevY, prevZ], [pr.x, pr.y, pr.z]) <= hitR * hitR ||
                  distPointSegmentSq([py.x, py.y + 1.4, py.z], [prevX, prevY, prevZ], [pr.x, pr.y, pr.z]) <= hitR * hitR) {
                this.shotsHit++;
                this._damagePylon(py, pr.dmg, pi);
                consumed = true;
                break;
              }
            }
          }
          // Check Naval Patrol Gunboats
          if (!consumed) {
            for (let bi = this.naval.boats.length - 1; bi >= 0; bi--) {
              const boat = this.naval.boats[bi];
              const hitR = 3.0 + pr.radius;
              if (distPointSegmentSq([boat.x, boat.y + 1.0, boat.z], [prevX, prevY, prevZ], [pr.x, pr.y, pr.z]) <= hitR * hitR) {
                this.shotsHit++;
                this._damageBoat(boat, pr.dmg, bi);
                consumed = true;
                break;
              }
            }
          }
          // Check Boss & Boss Shield Nodes / Leviathan Segments
          if (!consumed && this.boss) {
            const b = this.boss;
            let hitNode = false;
            for (const n of b.nodes) {
              if (n.hp <= 0) continue;
              const nx = b.x + Math.cos(n.angle) * 5.8;
              const ny = b.y + 0.5;
              const nz = b.z + Math.sin(n.angle) * 5.8;
              if ((pr.x - nx) ** 2 + (pr.y - ny) ** 2 + (pr.z - nz) ** 2 <= (2.1 + pr.radius) ** 2) {
                n.hp -= pr.dmg;
                n.flash = 1.0;
                this.shotsHit++;
                this.sound.playHit(false);
                this.floatingText.spawn(nx, ny + 1, nz, `${Math.round(pr.dmg)}`, '#ffd166', 14);
                if (n.hp <= 0) {
                  this.sound.playExplosion(1.1);
                  this.particles.burst(nx, ny, nz, 22, [1.0, 0.72, 0.25], 16, 0.35, 0.5, 'spark', 6);
                  this._damageBoss(160, nx, ny, nz);
                }
                hitNode = true;
                consumed = true;
                break;
              }
            }
            if (!hitNode) {
              const hitR = b.radius + pr.radius;
              if (distPointSegmentSq([b.x, b.y, b.z], [prevX, prevY, prevZ], [pr.x, pr.y, pr.z]) <= hitR * hitR) {
                this.shotsHit++;
                const activeNodes = b.nodes.filter(n => n.hp > 0).length;
                const dmgMult = activeNodes > 0 ? 0.35 : 1.0;
                this._damageBoss(pr.dmg * dmgMult, pr.x, pr.y, pr.z);
                consumed = true;
              } else if (b.kind === 'leviathan' && b.trail.length > 10) {
                for (let s = 0; s < 7; s++) {
                  const seg = b.trail[Math.min(b.trail.length - 1, (s + 1) * 9)];
                  const segR = (3.4 - s * 0.25) + pr.radius;
                  if (distPointSegmentSq([seg.x, seg.y, seg.z], [prevX, prevY, prevZ], [pr.x, pr.y, pr.z]) <= segR * segR) {
                    this.shotsHit++;
                    this._damageBoss(pr.dmg * 0.85, pr.x, pr.y, pr.z);
                    consumed = true;
                    break;
                  }
                }
              }
            }
          }
        } else {
          // Enemy projectile vs Player (with Phantom Dodge detection!)
          const dSq = distPointSegmentSq(p.pos, [prevX, prevY, prevZ], [pr.x, pr.y, pr.z]);
          if (dSq <= (1.35 + pr.radius) ** 2) {
            if (p.invulnTimer > 0) {
              this._triggerPhantomDodge(pr.x, pr.y, pr.z);
              consumed = true;
            } else {
              this.damagePlayer(pr.dmg);
              consumed = true;
            }
          }
        }

        if (consumed) {
          this.particles.burst(pr.x, pr.y, pr.z, 5, pr.col, 10, 0.16, 0.22, 'spark', 2);
          this.projectiles.splice(i, 1);
          continue;
        }
        i++;
      }
    }

    _updateBeams(dt) {
      const p = this.player;
      let i = 0;
      while (i < this.beams.length) {
        const b = this.beams[i];
        b.life -= dt;
        if (!b.hitApplied) {
          const dSq = distPointSegmentSq(p.pos, [b.ax, b.ay, b.az], [b.bx, b.by, b.bz]);
          if (dSq <= (b.radius + 1.1) ** 2) {
            b.hitApplied = true;
            if (p.invulnTimer > 0) {
              this._triggerPhantomDodge(p.pos[0], p.pos[1], p.pos[2]);
            } else {
              this.damagePlayer(b.dmg);
            }
          }
        }
        if (b.life <= 0) {
          this.beams.splice(i, 1);
          continue;
        }
        i++;
      }
    }

    _updateTelegraphs(dt) {
      const p = this.player;
      let i = 0;
      while (i < this.telegraphs.length) {
        const tg = this.telegraphs[i];
        tg.timer -= dt;
        if (tg.timer <= 0) {
          // Detonate!
          this.sound.playExplosion(0.8);
          this.particles.shockwave(tg.x, tg.y + 0.2, tg.z, [1.0, 0.38, 0.2], 0.8, tg.radius * 1.15, 0.35);
          this.particles.burst(tg.x, tg.y + 0.6, tg.z, 18, [1.0, 0.55, 0.2], 18, 0.34, 0.45, 'spark', 10);
          const dSq = (p.pos[0] - tg.x) ** 2 + (p.pos[2] - tg.z) ** 2;
          if (dSq <= tg.radius * tg.radius && Math.abs(p.pos[1] - tg.y) < 4.5) {
            if (p.invulnTimer > 0) {
              this._triggerPhantomDodge(p.pos[0], p.pos[1], p.pos[2]);
            } else {
              this.damagePlayer(tg.dmg);
            }
          }
          this.telegraphs.splice(i, 1);
          continue;
        }
        i++;
      }
    }

    _triggerPhantomDodge(x, y, z) {
      const p = this.player;
      if (p.perfectDodgeCd > 0) return;
      p.perfectDodgeCd = 0.7;
      p.nova = Math.min(100, p.nova + 30);
      p.energy = Math.min(p.maxEnergy, p.energy + 35);
      this._bumpFlow(1.0);
      this.score += Math.round(250 * p.flow);
      this.sound.playPerfectDodge();
      this.floatingText.spawn(x, y + 1.8, z, 'PHANTOM DODGE!', '#5cf2ff', 18, 1.1);
      this.unlockAchievement('phantom', 'PHANTOM ACE', 'Evaded an attack at the exact moment of impact');
    }

    _chainLightning(x, y, z, dmg, excludeObj) {
      let jumps = 2;
      for (let i = this.enemies.length - 1; i >= 0 && jumps > 0; i--) {
        const e = this.enemies[i];
        if (e === excludeObj) continue;
        if ((e.x - x) ** 2 + (e.y - y) ** 2 + (e.z - z) ** 2 < 24 * 24) {
          this.beams.push({
            ax: x, ay: y, az: z, bx: e.x, by: e.y, bz: e.z,
            life: 0.14, maxLife: 0.14, radius: 0.2, dmg: 0,
            col: [0.5, 0.85, 1.0], hitApplied: true
          });
          this._damageEnemy(e, dmg, i);
          jumps--;
        }
      }
    }

    _damageEnemy(e, dmg, index) {
      e.hp -= dmg;
      e.hitFlash = 1.0;
      const p = this.player;
      p.nova = Math.min(100, p.nova + 2.5);
      this.floatingText.spawn(e.x, e.y + 1.2, e.z, `${Math.round(dmg)}`, '#fff3b0', 14, 0.55);

      if (e.hp <= 0) {
        this.enemies.splice(index, 1);
        this.kills++;
        this._bumpFlow(0.45);
        this.score += Math.round((e.type === 'sentinel' ? 350 : 180) * p.flow);
        p.nova = Math.min(100, p.nova + 8);
        if (p.hasRelic('vampire') > 0) {
          p.hp = Math.min(p.maxHp, p.hp + 9 * p.hasRelic('vampire'));
        }
        this.sound.playExplosion(e.type === 'sentinel' ? 1.15 : 0.75);
        this.screenShake = Math.max(this.screenShake, 0.28);
        this.particles.spawn({ x: e.x, y: e.y, z: e.z, r: 1.0, g: 0.95, b: 0.75, size: 0.8, endSize: 4.2, life: 0.22, kind: 'orb' });
        this.particles.shockwave(e.x, e.y, e.z, [1.0, 0.65, 0.35], 0.5, 7.5, 0.35);
        this.particles.burst(e.x, e.y, e.z, 32, [1.0, 0.55, 0.3], 22, 0.36, 0.6, 'spark', 8);
        this.particles.burst(e.x, e.y, e.z, 12, [1.0, 0.85, 0.45], 12, 0.42, 0.5, 'orb', 2);
      } else {
        this.sound.playHit(false);
      }
    }

    _damagePylon(py, dmg, index) {
      py.hp -= dmg;
      py.hitFlash = 1.0;
      this.player.nova = Math.min(100, this.player.nova + 1.8);
      this.floatingText.spawn(py.x, py.y + 5.5, py.z, `${Math.round(dmg)}`, '#ff9bb3', 15, 0.55);
      if (py.hp <= 0) {
        this.pylons.splice(index, 1);
        this._bumpFlow(1.0);
        this.score += Math.round(600 * this.player.flow);
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 20);
        this.player.nova = Math.min(100, this.player.nova + 22);
        this.sound.playExplosion(1.4);
        this.screenShake = Math.max(this.screenShake, 0.55);
        this.hitStop = 0.04;
        this.particles.shockwave(py.x, py.y + 2, py.z, [0.4, 0.95, 1.0], 1.0, 18.0, 0.55);
        this.particles.burst(py.x, py.y + 3.5, py.z, 40, [1.0, 0.45, 0.65], 24, 0.45, 0.7, 'spark', 9);
        this.floatingText.spawn(py.x, py.y + 7, py.z, 'PYLON SHATTERED!', '#5cf2ff', 20, 1.2);
      } else {
        this.sound.playHit(false);
      }
    }

    _damageBoat(boat, dmg, index) {
      boat.hp -= dmg;
      boat.hitFlash = 1.0;
      const p = this.player;
      p.nova = Math.min(100, p.nova + 2.4);
      this.floatingText.spawn(boat.x, boat.y + 2.0, boat.z, `${Math.round(dmg)}`, '#ffd166', 14, 0.55);

      if (boat.hp <= 0) {
        this.naval.boats.splice(index, 1);
        this.kills++;
        this._bumpFlow(0.55);
        this.score += Math.round(300 * p.flow);
        p.nova = Math.min(100, p.nova + 12);
        if (p.hasRelic('vampire') > 0) {
          p.hp = Math.min(p.maxHp, p.hp + 9 * p.hasRelic('vampire'));
        }
        this.sound.playExplosion(1.25);
        this.screenShake = Math.max(this.screenShake, 0.38);
        this.particles.shockwave(boat.x, boat.y + 0.5, boat.z, [1.0, 0.62, 0.25], 0.8, 12.0, 0.45);
        this.particles.burst(boat.x, boat.y + 1.2, boat.z, 36, [1.0, 0.55, 0.25], 24, 0.42, 0.65, 'spark', 10);
        this.floatingText.spawn(boat.x, boat.y + 2.6, boat.z, 'GUNBOAT SUNK!', '#5cf2ff', 17, 1.0);
      } else {
        this.sound.playHit(false);
      }
    }

    _damageBoss(dmg, hx, hy, hz) {
      const b = this.boss;
      if (!b) return;
      b.hp -= dmg;
      b.hitFlash = 1.0;
      this.player.nova = Math.min(100, this.player.nova + 1.6);
      this.floatingText.spawn(hx, hy + 1.2, hz, `${Math.round(dmg)}`, '#ffdf70', 16, 0.6);

      if (b.hp <= 0) {
        this.sound.playExplosion(1.9);
        this.screenShake = 1.0;
        this.hitStop = 0.07;
        this._bumpFlow(2.0);
        this.score += Math.round(2500 * this.player.flow);
        this.particles.shockwave(b.x, b.y, b.z, [1.0, 0.85, 0.4], 2.0, 42, 0.85);
        this.particles.burst(b.x, b.y, b.z, 80, [1.0, 0.65, 0.35], 30, 0.55, 0.9, 'spark', 6);
        this.floatingText.spawn(b.x, b.y + 3, b.z, `${b.name} VANQUISHED!`, '#ffe066', 24, 1.8);
        this.boss = null;
        this.enemies.length = 0;
        this.beams.length = 0;
        this.telegraphs.length = 0;
        this.unlockAchievement('slayer', 'TITAN SLAYER', 'Vanquished a colossal Guardian Titan');
      } else {
        this.sound.playHit(false);
      }
    }

    damagePlayer(dmg, cause = 'combat') {
      const p = this.player;
      if (p.invulnTimer > 0 || this.gameOver) return;
      p.hp = Math.max(0, p.hp - dmg);
      p.invulnTimer = 0.48;
      p.outOfCombatTimer = 0;
      p.hitFlash = 1.0;
      p.shieldFlash = 1.0;
      p.flow = Math.max(1.0, p.flow - 1.0);
      this.damageFlash = 1.0;
      this.screenShake = Math.max(this.screenShake, 0.45);
      this.sound.playDamage();
      if (p.hp <= 0) {
        this.deathCause = cause;
        this.gameOver = true;
        this.sound.playExplosion(1.6);
      }
    }

    _bumpFlow(amount) {
      const p = this.player;
      p.flow = Math.min(8.0, p.flow + amount);
      p.flowTimer = 4.2;
      if (p.flow > p.peakFlow) p.peakFlow = p.flow;
      if (p.flow >= 5.0) {
        this.unlockAchievement('flow5', 'RING MASTER', 'Reached 5.0x Flow Multiplier');
      }
    }

    _checkSectorClear() {
      if (this.sectorClearDelay > 0) return;
      if (this.boss === null && this.pylons.length === 0 && this.enemies.length === 0) {
        this.sectorClearDelay = 2.0;
        this.sound.playUpgrade();
        this.showCallout(
          this.mode === 'expedition' && this.sector >= this.maxSectors
            ? 'THE SKY IS FREED — SECTOR COMPLETE!'
            : `SECTOR ${this.sector} CLEARED!`,
          2.2
        );
      }
    }

    renderEntities(renderer, time) {
      const m = this._m;
      const p = this.player;
      const spec = p.getShipSpec();
      const rollSpin = p.rollTimer > 0 ? p.rollDir * (1 - p.rollTimer / 0.44) * Math.PI * 2 : 0;

      // 1. Player Craft (Dynamic Ship from Hangar: Valkyrie / Tempest / Solaris Titan + Barrel Roll!)
      Mat4.composeYXZ(m, p.pos[0], p.pos[1], p.pos[2], p.shipYaw, p.shipPitch, p.bankRoll + rollSpin, 1, 1, 1);
      renderer.addHeroDraw(spec.hullMesh, m, [1, 1, 1], p.dashTimer > 0 ? 0.32 : 0.06, spec.trailColor, 2.6, p.hitFlash, true);

      const wingMat = Mat4.create();
      const localWingL = Mat4.create();
      const localWingR = Mat4.create();
      Mat4.composeYXZ(localWingL, 0, 0, 0, p.wingSweep, 0, 0, 1, 1, 1);
      Mat4.composeYXZ(localWingR, 0, 0, 0, -p.wingSweep, 0, 0, 1, 1, 1);
      Mat4.multiply(wingMat, m, localWingL);
      renderer.addHeroDraw(spec.wingLMesh, wingMat, [1, 1, 1], 0.06, [1.0, 0.78, 0.35], 2.8, p.hitFlash, true);
      Mat4.multiply(wingMat, m, localWingR);
      renderer.addHeroDraw(spec.wingRMesh, wingMat, [1, 1, 1], 0.06, [1.0, 0.78, 0.35], 2.8, p.hitFlash, true);

      // Twin smooth tapered thruster afterburner cones per ship nozzle profile
      const sy = Math.sin(p.shipYaw), cy = Math.cos(p.shipYaw);
      const speedN = clamp(Math.hypot(p.vel[0], p.vel[2]) / 34, 0.25, 1.6);
      const flameLen = (p.dashTimer > 0 ? 2.1 : (p.ringBoostTimer > 0 ? 1.6 : 0.85)) * speedN;
      const fMat = Mat4.create();
      const lCone = Mat4.create();
      const fCol = p.dashTimer > 0 ? spec.dashColor : spec.flameColor;
      for (const side of spec.nozzles) {
        Mat4.composeYXZ(lCone, side, 0.04, spec.nozzleZ, 0, 0, 0, 0.58, 0.54, flameLen);
        Mat4.multiply(fMat, m, lCone);
        renderer.vfxBatches.thrusterCone.push(fMat, fCol[0], fCol[1], fCol[2], 0.90);
      }
      // Sonic Mach-Cone when Hyper-Dashing or Ring Boosting
      if (p.dashTimer > 0 || p.ringBoostTimer > 0.4) {
        Mat4.composeYXZ(m, p.pos[0] + sy * 1.2, p.pos[1] + 0.05, p.pos[2] + cy * 1.2, p.shipYaw, Math.PI / 2 + p.shipPitch, time * 6, 2.4, 1.0, 2.4);
        renderer.vfxBatches.flatRing.push(m, fCol[0], fCol[1], fCol[2], p.dashTimer > 0 ? 0.72 : 0.38);
      }

      // Wingtip trails
      const trCol = p.dashTimer > 0 ? spec.dashColor : spec.trailColor;
      p.trailL.draw(renderer, trCol[0], trCol[1], trCol[2], 0.78);
      p.trailR.draw(renderer, trCol[0], trCol[1], trCol[2], 0.78);

      // Player energy shield flash bubble
      if (p.shieldFlash > 0.02 || p.invulnTimer > 0.05) {
        const sAlpha = Math.max(p.shieldFlash * 0.65, p.invulnTimer > 0.05 ? 0.25 : 0);
        Mat4.composeYXZ(m, p.pos[0], p.pos[1], p.pos[2], 0, 0, 0, 2.2, 1.5, 2.5);
        renderer.fresnelBatch.push(m, 0.35, 0.92, 1.0, sAlpha);
      }

      // Orbital Wingmen Drones
      const dronePairs = p.hasRelic('drones');
      if (dronePairs > 0) {
        const count = dronePairs * 2;
        for (let i = 0; i < count; i++) {
          const a = p.droneAngle + (i / count) * Math.PI * 2;
          Mat4.composeYXZ(m, p.pos[0] + Math.cos(a) * 2.8, p.pos[1] + 0.9, p.pos[2] + Math.sin(a) * 2.8, -a, 0, 0, 0.45, 0.45, 0.45);
          renderer.litBatches.scout.push(m, 0.45, 1.0, 0.72, 0.45, 0, 1.0);
        }
      }

      // 2. Resonance Pylons
      for (const py of this.pylons) {
        Mat4.composeYXZ(m, py.x, py.y, py.z, 0, 0, 0, 1, 1, 1);
        renderer.litBatches.pylon.push(m, 1.0, 0.88, 0.92, 0.25, py.hitFlash, 1.2);
        // Floating orbital ring around pylon top
        Mat4.composeYXZ(m, py.x, py.y + 6.4, py.z, time * 1.4, 1.25, time * 0.9, 2.2, 2.2, 2.2);
        renderer.litBatches.torus.push(m, 1.0, 0.24, 0.42, 0.85, py.hitFlash);
      }

      // 3. Enemies
      for (const e of this.enemies) {
        if (e.type === 'scout') {
          Mat4.composeYXZ(m, e.x, e.y, e.z, e.yaw, 0, Math.sin(time * 4 + e.x) * 0.25, 1.05, 1.05, 1.05);
          renderer.litBatches.scout.push(m, 1, 1, 1, 0.16, e.hitFlash, 1.2);
        } else if (e.type === 'sentinel') {
          Mat4.composeYXZ(m, e.x, e.y, e.z, time * 0.9, 0, 0, 1.2, 1.2, 1.2);
          renderer.litBatches.sentinel.push(m, 1, 1, 1, 0.2, e.hitFlash, 1.3);
          for (let k = 0; k < 3; k++) {
            const sa = e.shieldAngle + (k / 3) * Math.PI * 2;
            Mat4.composeYXZ(m, e.x + Math.cos(sa) * 2.1, e.y, e.z + Math.sin(sa) * 2.1, -sa + Math.PI / 2, 0, 0, 1, 1, 1);
            renderer.litBatches.shieldPlate.push(m, 1, 0.9, 0.8, 0.18, e.hitFlash);
          }
        } else if (e.type === 'sniper') {
          Mat4.composeYXZ(m, e.x, e.y, e.z, e.yaw, 0, 0, 1.15, 1.15, 1.15);
          renderer.litBatches.sniper.push(m, 1, 1, 1, 0.28, e.hitFlash, 1.4);
          // Telegraph warning laser sight
          if (e.chargeTime > 0) {
            const p0 = [e.x, e.y, e.z];
            const p1 = [e.x + e.lockDir[0] * 100, e.y + e.lockDir[1] * 100, e.z + e.lockDir[2] * 100];
            this._pushBeamBox(renderer, p0, p1, 0.08 + (1.25 - e.chargeTime) * 0.12, [1.0, 0.2, 0.85], 0.75);
          }
        }
      }

      // 4. Boss
      if (this.boss) {
        const b = this.boss;
        if (b.kind === 'leviathan') {
          Mat4.composeYXZ(m, b.x, b.y, b.z, b.yaw, b.pitch || 0, Math.sin(time * 2.4) * 0.14, 1.65, 1.65, 1.65);
          renderer.addHeroDraw('leviathanHead', m, [1, 1, 1], b.phase === 2 ? 0.35 : 0.15, [0.22, 0.92, 1.0], 2.5, b.hitFlash, true);

          for (let s = 0; s < 7; s++) {
            const tIdx = Math.min(b.trail.length - 1, (s + 1) * 9);
            const pt = b.trail[tIdx];
            if (!pt) continue;
            const taper = 1.48 - s * 0.13;
            const sway = Math.sin(time * 4.5 + s * 0.75) * 0.18;
            Mat4.composeYXZ(m, pt.x, pt.y + sway, pt.z, pt.yaw, pt.pitch || 0, sway * 0.5, taper, taper, taper);
            renderer.litBatches.leviathanSeg.push(m, 1, 1, 1, b.phase === 2 ? 0.32 : 0.14, b.hitFlash, 1.5);
          }
        } else {
          const meshName = b.kind === 'warden' ? 'bossWarden' : 'bossSeraph';
          const scale = b.kind === 'warden' ? 1.35 : 1.5;
          Mat4.composeYXZ(m, b.x, b.y, b.z, b.yaw, Math.sin(time * 1.6) * 0.08, 0, scale, scale, scale);
          renderer.addHeroDraw(meshName, m, [1, 1, 1], b.phase === 2 ? 0.35 : 0.14, [1.0, 0.35, 0.55], 2.4, b.hitFlash, true);

          // Boss halo ring
          Mat4.composeYXZ(m, b.x, b.y + 1.2, b.z, time * 0.8, 1.3, 0, 5.2, 5.2, 5.2);
          renderer.litBatches.torus.push(m, 1.0, 0.55, 0.22, 0.75, b.hitFlash);

          // Warden shield nodes
          const activeNodes = b.nodes.filter(n => n.hp > 0);
          for (const n of activeNodes) {
            const nx = b.x + Math.cos(n.angle) * 5.8;
            const ny = b.y + 0.5;
            const nz = b.z + Math.sin(n.angle) * 5.8;
            Mat4.composeYXZ(m, nx, ny, nz, -n.angle, time * 2, 0, 1.2, 1.2, 1.2);
            renderer.litBatches.shard.push(m, 1.0, 0.45, 0.25, 0.9, n.flash);
          }
          if (activeNodes.length > 0) {
            Mat4.composeYXZ(m, b.x, b.y, b.z, 0, 0, 0, 4.6, 5.2, 4.6);
            renderer.fresnelBatch.push(m, 1.0, 0.42, 0.22, 0.35);
          }
        }
      }

      // 4b. Naval Patrol Gunboats & Ring Race Ghost
      this.naval.pushVisuals(renderer, time);
      if (this.mode === 'race' && this.ghost) {
        this.ghost.pushGhostVisual(renderer, this.runTime);
      }

      // 5. Projectiles (enlarged bolts + extra-bright Solaris Rail slugs!)
      for (const pr of this.projectiles) {
        if (pr.friendly) {
          const w = pr.rail ? 0.58 : 0.38;
          const len = pr.rail ? 3.8 : (pr.homing ? 1.5 : 2.3);
          Mat4.aimMatrix(m, [pr.x, pr.y, pr.z], [pr.vx, pr.vy, pr.vz], w, w, len, 0);
          renderer.vfxBatches.spark.push(m, pr.col[0], pr.col[1], pr.col[2], 0.98);
        } else {
          const sz = 0.56 + 0.08 * Math.sin(time * 16 + pr.x);
          Mat4.composeYXZ(m, pr.x, pr.y, pr.z, 0, 0, 0, sz, sz, sz);
          renderer.vfxBatches.sphere.push(m, pr.col[0], pr.col[1], pr.col[2], 0.95);
        }
      }

      // 6. Active Damage Beams
      for (const b of this.beams) {
        const a = clamp(b.life / b.maxLife, 0, 1);
        this._pushBeamBox(renderer, [b.ax, b.ay, b.az], [b.bx, b.by, b.bz], b.radius * 0.5, b.col, a);
      }

      // 7. Ground Telegraph Warning Circles
      for (const tg of this.telegraphs) {
        const prog = 1 - clamp(tg.timer / tg.maxTimer, 0, 1);
        // Outer boundary ring
        Mat4.composeYXZ(m, tg.x, tg.y, tg.z, 0, 0, 0, tg.radius, 1, tg.radius);
        renderer.vfxBatches.flatRing.push(m, 1.0, 0.22, 0.28, 0.85);
        // Filling inner ring
        const innerR = Math.max(0.2, tg.radius * prog);
        Mat4.composeYXZ(m, tg.x, tg.y + 0.04, tg.z, 0, 0, 0, innerR, 1, innerR);
        renderer.vfxBatches.flatRing.push(m, 1.0, 0.65, 0.25, 0.72);
      }

      // 8. Pooled 3D Particles
      this.particles.pushToRenderer(renderer);
    }

    _pushBeamBox(renderer, a, b, thickness, col, alpha) {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.01) return;
      const mid = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];
      Mat4.aimMatrix(this._m, mid, [dx, dy, dz], thickness, thickness, len, 0);
      renderer.vfxBatches.box.push(this._m, col[0], col[1], col[2], alpha);
    }
  }

  AF.RELIC_POOL = RELIC_POOL;
  AF.Simulation = Simulation;
})(window.AF = window.AF || {});

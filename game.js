// ASTEROIDS — Classic Atari Recreation
// Browser Game with HTML5 Canvas

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Responsive canvas
function resize() {
  const size = Math.min(window.innerWidth, window.innerHeight) - 20;
  canvas.width = size;
  canvas.height = size;
}
resize();
window.addEventListener('resize', resize);

// ─── Constants ───────────────────────────────────────────────────────────────
const W = () => canvas.width;
const H = () => canvas.height;

const SHIP_SIZE        = 20;
const TURN_SPEED       = 3.5;   // degrees per frame
const THRUST           = 0.12;
const FRICTION         = 0.99;
const BULLET_SPEED     = 8;
const BULLET_LIFE      = 55;    // frames
const MAX_BULLETS      = 4;
const SHOOT_COOLDOWN   = 10;    // frames
const ASTEROID_SPEED   = { large: 1.2, medium: 1.8, small: 2.8 };
const ASTEROID_PTS     = { large: 20,  medium: 50,  small: 100 };
const UFO_SPEED        = 2.0;
const UFO_SHOOT_INTERVAL = 90; // frames
const UFO_PTS          = { large: 200, small: 1000 };
const INVINCIBLE_TIME  = 180;  // frames after respawn
const EXTRA_LIFE_SCORE = 10000;

// ─── State ───────────────────────────────────────────────────────────────────
let state, ship, bullets, asteroids, ufo, particles;
let score, lives, level, hiScore;
let keys = {};
let shootCooldown = 0;
let ufoTimer = 0;
let extraLifeThreshold;
let gameState = 'title'; // 'title' | 'playing' | 'dead' | 'gameover'
let deadTimer = 0;
let frameCount = 0;

// ─── Input ───────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (gameState === 'title' && e.code === 'Space') startGame();
  if (gameState === 'gameover' && e.code === 'Space') gameState = 'title';
  // Hyperspace
  if (gameState === 'playing' && e.code === 'ShiftLeft') hyperspace();
  e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ─── Math helpers ─────────────────────────────────────────────────────────────
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function deg2rad(d) { return d * Math.PI / 180; }
function wrap(v, max) { return ((v % max) + max) % max; }

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx*dx + dy*dy);
}

// ─── Ship ────────────────────────────────────────────────────────────────────
function createShip() {
  return {
    x: W() / 2, y: H() / 2,
    vx: 0, vy: 0,
    angle: -90, // pointing up
    thrusting: false,
    invincible: INVINCIBLE_TIME,
    alive: true
  };
}

function drawShip(s) {
  if (!s.alive) return;
  if (s.invincible > 0 && Math.floor(s.invincible / 6) % 2 === 0) return;

  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(deg2rad(s.angle));
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(SHIP_SIZE, 0);
  ctx.lineTo(-SHIP_SIZE * 0.6, -SHIP_SIZE * 0.6);
  ctx.lineTo(-SHIP_SIZE * 0.3, 0);
  ctx.lineTo(-SHIP_SIZE * 0.6, SHIP_SIZE * 0.6);
  ctx.closePath();
  ctx.stroke();

  // Thruster flame
  if (s.thrusting && Math.random() > 0.3) {
    ctx.strokeStyle = '#f80';
    ctx.beginPath();
    ctx.moveTo(-SHIP_SIZE * 0.3, -SHIP_SIZE * 0.25);
    ctx.lineTo(-SHIP_SIZE * 0.7 - Math.random() * SHIP_SIZE * 0.5, 0);
    ctx.lineTo(-SHIP_SIZE * 0.3, SHIP_SIZE * 0.25);
    ctx.stroke();
  }
  ctx.restore();
}

function updateShip(s) {
  if (!s.alive) return;
  if (s.invincible > 0) s.invincible--;

  if (keys['ArrowLeft']  || keys['KeyA']) s.angle -= TURN_SPEED;
  if (keys['ArrowRight'] || keys['KeyD']) s.angle += TURN_SPEED;

  s.thrusting = keys['ArrowUp'] || keys['KeyW'];
  if (s.thrusting) {
    s.vx += Math.cos(deg2rad(s.angle)) * THRUST;
    s.vy += Math.sin(deg2rad(s.angle)) * THRUST;
    spawnThrusterParticles(s);
  }

  s.vx *= FRICTION;
  s.vy *= FRICTION;
  s.x = wrap(s.x + s.vx, W());
  s.y = wrap(s.y + s.vy, H());
}

function hyperspace() {
  if (!ship.alive) return;
  ship.x = rand(50, W() - 50);
  ship.y = rand(50, H() - 50);
  ship.vx = 0;
  ship.vy = 0;
  // Small risk: sometimes end up in asteroid
  spawnExplosion(ship.x, ship.y, '#88f', 8);
}

// ─── Bullets ─────────────────────────────────────────────────────────────────
function shoot() {
  if (!ship.alive || bullets.length >= MAX_BULLETS || shootCooldown > 0) return;
  const angle = deg2rad(ship.angle);
  bullets.push({
    x: ship.x + Math.cos(angle) * SHIP_SIZE,
    y: ship.y + Math.sin(angle) * SHIP_SIZE,
    vx: Math.cos(angle) * BULLET_SPEED + ship.vx,
    vy: Math.sin(angle) * BULLET_SPEED + ship.vy,
    life: BULLET_LIFE,
    fromShip: true
  });
  shootCooldown = SHOOT_COOLDOWN;
  playSound('shoot');
}

function drawBullet(b) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
  ctx.fill();
}

function updateBullet(b) {
  b.x = wrap(b.x + b.vx, W());
  b.y = wrap(b.y + b.vy, H());
  b.life--;
}

// ─── Asteroids ───────────────────────────────────────────────────────────────
const SIZES = ['large', 'medium', 'small'];
const SIZE_RADIUS = { large: 48, medium: 24, small: 12 };

function createAsteroid(x, y, size) {
  const angle = rand(0, Math.PI * 2);
  const speed = ASTEROID_SPEED[size];
  const numVerts = randInt(7, 13);
  const verts = [];
  for (let i = 0; i < numVerts; i++) {
    const a = (i / numVerts) * Math.PI * 2;
    const r = SIZE_RADIUS[size] * rand(0.7, 1.3);
    verts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return {
    x, y,
    vx: Math.cos(angle) * speed * rand(0.5, 1.5),
    vy: Math.sin(angle) * speed * rand(0.5, 1.5),
    spin: rand(-1.5, 1.5),
    angle: 0,
    size,
    radius: SIZE_RADIUS[size],
    verts
  };
}

function spawnAsteroids(count) {
  for (let i = 0; i < count; i++) {
    // Spawn away from ship center
    let x, y;
    do {
      x = rand(0, W());
      y = rand(0, H());
    } while (dist({ x, y }, { x: W()/2, y: H()/2 }) < 120);
    asteroids.push(createAsteroid(x, y, 'large'));
  }
}

function drawAsteroid(a) {
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(deg2rad(a.angle));
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(a.verts[0].x, a.verts[0].y);
  for (let i = 1; i < a.verts.length; i++) ctx.lineTo(a.verts[i].x, a.verts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function updateAsteroid(a) {
  a.x = wrap(a.x + a.vx, W());
  a.y = wrap(a.y + a.vy, H());
  a.angle += a.spin;
}

function splitAsteroid(a) {
  const idx = SIZES.indexOf(a.size);
  if (idx < SIZES.length - 1) {
    const nextSize = SIZES[idx + 1];
    for (let i = 0; i < 2; i++) {
      asteroids.push(createAsteroid(a.x, a.y, nextSize));
    }
  }
  spawnExplosion(a.x, a.y, '#fff', a.size === 'large' ? 20 : a.size === 'medium' ? 12 : 6);
  playSound('explode');
}

// ─── UFO ─────────────────────────────────────────────────────────────────────
function createUfo() {
  const small = level >= 3 && Math.random() > 0.5;
  const side = Math.random() > 0.5 ? 0 : W();
  return {
    x: side, y: rand(H() * 0.1, H() * 0.9),
    vx: (side === 0 ? 1 : -1) * UFO_SPEED,
    vy: 0,
    small,
    radius: small ? 12 : 22,
    shootTimer: UFO_SHOOT_INTERVAL,
    zigTimer: randInt(60, 120)
  };
}

function drawUfo(u) {
  if (!u) return;
  const r = u.radius;
  ctx.save();
  ctx.translate(u.x, u.y);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  // Body
  ctx.beginPath();
  ctx.ellipse(0, 2, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Top dome
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.2, r * 0.55, r * 0.45, 0, Math.PI, 0);
  ctx.stroke();
  // Bottom flat line
  ctx.beginPath();
  ctx.moveTo(-r, 2); ctx.lineTo(r, 2);
  ctx.stroke();
  ctx.restore();
}

function updateUfo(u) {
  if (!u) return;

  u.x += u.vx;
  u.y += u.vy;
  u.x = wrap(u.x, W());
  u.y = wrap(u.y + u.vy, H());

  u.zigTimer--;
  if (u.zigTimer <= 0) {
    u.vy = rand(-1.5, 1.5) * UFO_SPEED;
    u.zigTimer = randInt(60, 120);
  }

  u.shootTimer--;
  if (u.shootTimer <= 0) {
    ufoShoot(u);
    u.shootTimer = UFO_SHOOT_INTERVAL;
  }

  // UFO exits the screen horizontally → respawn later
  if (u.x < -u.radius * 2 || u.x > W() + u.radius * 2) {
    ufo = null;
    ufoTimer = randInt(400, 700);
  }
}

function ufoShoot(u) {
  let angle;
  if (u.small && ship.alive) {
    // Small UFO aims at ship
    angle = Math.atan2(ship.y - u.y, ship.x - u.x);
    angle += rand(-0.2, 0.2);
  } else {
    angle = rand(0, Math.PI * 2);
  }
  bullets.push({
    x: u.x, y: u.y,
    vx: Math.cos(angle) * BULLET_SPEED,
    vy: Math.sin(angle) * BULLET_SPEED,
    life: BULLET_LIFE,
    fromShip: false
  });
  playSound('ufoShoot');
}

// ─── Particles ───────────────────────────────────────────────────────────────
function spawnExplosion(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(0.5, 4);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: randInt(20, 50),
      maxLife: 50,
      color
    });
  }
}

function spawnThrusterParticles(s) {
  const angle = deg2rad(s.angle + 180);
  particles.push({
    x: s.x + Math.cos(angle) * SHIP_SIZE * 0.4,
    y: s.y + Math.sin(angle) * SHIP_SIZE * 0.4,
    vx: Math.cos(angle) * rand(1, 3) + s.vx,
    vy: Math.sin(angle) * rand(1, 3) + s.vy,
    life: randInt(5, 15),
    maxLife: 15,
    color: '#f80'
  });
}

function drawParticle(p) {
  const alpha = p.life / p.maxLife;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function updateParticle(p) {
  p.x += p.vx;
  p.y += p.vy;
  p.vx *= 0.97;
  p.vy *= 0.97;
  p.life--;
}

// ─── Sound (Web Audio API) ────────────────────────────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, type, duration, gainVal = 0.3, start = 0) {
  try {
    const ac = getAudio();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime + start);
    gain.gain.setValueAtTime(gainVal, ac.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + start + duration);
    osc.start(ac.currentTime + start);
    osc.stop(ac.currentTime + start + duration);
  } catch(e) {}
}

function playSound(name) {
  switch(name) {
    case 'shoot':
      playTone(600, 'square', 0.08, 0.2);
      break;
    case 'explode':
      playTone(80,  'sawtooth', 0.3, 0.4);
      playTone(50,  'sawtooth', 0.5, 0.3, 0.05);
      break;
    case 'ufoShoot':
      playTone(400, 'sawtooth', 0.1, 0.15);
      break;
    case 'die':
      playTone(200, 'sawtooth', 0.2, 0.5);
      playTone(100, 'sawtooth', 0.4, 0.4, 0.1);
      playTone(60,  'sawtooth', 0.6, 0.3, 0.2);
      break;
    case 'extraLife':
      playTone(440, 'square', 0.1, 0.3);
      playTone(660, 'square', 0.1, 0.3, 0.12);
      playTone(880, 'square', 0.15, 0.3, 0.24);
      break;
  }
}

// Background "heartbeat" (low thump alternating)
let beatTimer = 0;
let beatFast = false;
function playBeat() {
  beatTimer++;
  const interval = Math.max(20, 80 - asteroids.length * 3);
  if (beatTimer >= interval) {
    beatTimer = 0;
    beatFast = !beatFast;
    playTone(beatFast ? 80 : 55, 'sine', 0.08, 0.5);
  }
}

// ─── Collision detection ──────────────────────────────────────────────────────
function circleCollide(a, b, ar, br) {
  return dist(a, b) < ar + br;
}

function checkCollisions() {
  // Bullets vs Asteroids
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    for (let ai = asteroids.length - 1; ai >= 0; ai--) {
      const a = asteroids[ai];
      if (circleCollide(b, a, 2, a.radius * 0.75)) {
        if (b.fromShip) {
          score += ASTEROID_PTS[a.size];
          checkExtraLife();
        }
        splitAsteroid(a);
        asteroids.splice(ai, 1);
        bullets.splice(bi, 1);
        break;
      }
    }
  }

  // Bullets vs UFO
  if (ufo) {
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      if (b.fromShip && circleCollide(b, ufo, 2, ufo.radius * 0.8)) {
        score += UFO_PTS[ufo.small ? 'small' : 'large'];
        checkExtraLife();
        spawnExplosion(ufo.x, ufo.y, '#ff0', 16);
        playSound('explode');
        ufo = null;
        ufoTimer = randInt(400, 700);
        bullets.splice(bi, 1);
        break;
      }
    }
  }

  // Ship vs Asteroids
  if (ship.alive && ship.invincible <= 0) {
    for (const a of asteroids) {
      if (circleCollide(ship, a, SHIP_SIZE * 0.7, a.radius * 0.75)) {
        killShip();
        return;
      }
    }
    // Ship vs UFO bullets
    for (const b of bullets) {
      if (!b.fromShip && circleCollide(ship, b, SHIP_SIZE * 0.7, 2)) {
        killShip();
        return;
      }
    }
    // Ship vs UFO
    if (ufo && circleCollide(ship, ufo, SHIP_SIZE * 0.7, ufo.radius * 0.8)) {
      killShip();
    }
  }
}

function killShip() {
  spawnExplosion(ship.x, ship.y, '#fff', 25);
  playSound('die');
  ship.alive = false;
  lives--;
  gameState = 'dead';
  deadTimer = 120;
}

function checkExtraLife() {
  if (score >= extraLifeThreshold) {
    lives++;
    extraLifeThreshold += EXTRA_LIFE_SCORE;
    playSound('extraLife');
  }
}

// ─── Level management ─────────────────────────────────────────────────────────
function nextLevel() {
  level++;
  asteroids = [];
  bullets = [];
  ufo = null;
  ufoTimer = randInt(400, 700);
  spawnAsteroids(Math.min(3 + level, 9));
  ship.x = W() / 2;
  ship.y = H() / 2;
  ship.vx = 0; ship.vy = 0;
  ship.angle = -90;
  ship.invincible = INVINCIBLE_TIME;
  ship.alive = true;
}

// ─── Game init ────────────────────────────────────────────────────────────────
function startGame() {
  score = 0;
  lives = 3;
  level = 0;
  hiScore = hiScore || 0;
  extraLifeThreshold = EXTRA_LIFE_SCORE;
  bullets = [];
  particles = [];
  asteroids = [];
  ufo = null;
  ufoTimer = randInt(400, 700);
  ship = createShip();
  gameState = 'playing';
  beatTimer = 0;
  nextLevel();
}

// ─── Draw HUD ─────────────────────────────────────────────────────────────────
function drawHUD() {
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.floor(W() * 0.035)}px 'Courier New'`;
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE  ${score}`, W() * 0.03, H() * 0.05);
  ctx.textAlign = 'center';
  ctx.fillText(`HI  ${Math.max(score, hiScore)}`, W() / 2, H() * 0.05);

  // Lives as mini ships
  for (let i = 0; i < lives; i++) {
    drawMiniShip(W() * 0.03 + i * 22, H() * 0.09);
  }

  // Level indicator (dots)
  ctx.textAlign = 'right';
  ctx.fillText(`LVL ${level}`, W() * 0.97, H() * 0.05);
}

function drawMiniShip(x, y) {
  const s = 8;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(deg2rad(-90));
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s * 0.6, -s * 0.6);
  ctx.lineTo(-s * 0.3, 0);
  ctx.lineTo(-s * 0.6, s * 0.6);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// ─── Title / Game Over screens ────────────────────────────────────────────────
function drawTitle() {
  // Animated asteroids in background
  ctx.clearRect(0, 0, W(), H());
  for (const a of asteroids) {
    updateAsteroid(a);
    drawAsteroid(a);
  }
  for (const p of particles) {
    updateParticle(p);
    drawParticle(p);
  }
  particles = particles.filter(p => p.life > 0);

  const cx = W() / 2, cy = H() / 2;
  const titleSize = Math.floor(W() * 0.1);
  const subSize   = Math.floor(W() * 0.035);

  ctx.fillStyle = '#fff';
  ctx.font = `bold ${titleSize}px 'Courier New'`;
  ctx.textAlign = 'center';
  ctx.fillText('ASTEROIDS', cx, cy - titleSize * 0.5);

  ctx.font = `${subSize}px 'Courier New'`;
  if (Math.floor(frameCount / 30) % 2 === 0) {
    ctx.fillText('PRESS SPACE TO START', cx, cy + subSize * 2);
  }

  ctx.font = `${Math.floor(subSize * 0.8)}px 'Courier New'`;
  ctx.fillStyle = '#aaa';
  ctx.fillText('WASD / ARROWS — BEWEGEN   SPACE — SCHIESSEN   SHIFT — HYPERRAUM', cx, cy + subSize * 4);

  if (hiScore > 0) {
    ctx.fillStyle = '#ff0';
    ctx.font = `${subSize}px 'Courier New'`;
    ctx.fillText(`HIGH SCORE: ${hiScore}`, cx, cy + subSize * 6);
  }
}

function drawGameOver() {
  const cx = W() / 2, cy = H() / 2;
  const titleSize = Math.floor(W() * 0.08);
  const subSize   = Math.floor(W() * 0.04);

  ctx.fillStyle = '#fff';
  ctx.font = `bold ${titleSize}px 'Courier New'`;
  ctx.textAlign = 'center';
  ctx.fillText('GAME OVER', cx, cy);

  ctx.font = `${subSize}px 'Courier New'`;
  ctx.fillText(`SCORE: ${score}`, cx, cy + titleSize * 0.9);

  if (Math.floor(frameCount / 30) % 2 === 0) {
    ctx.fillText('SPACE — WEITER', cx, cy + titleSize * 1.8);
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────
function loop() {
  frameCount++;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, W(), H());

  if (gameState === 'title') {
    // Ensure demo asteroids exist
    if (asteroids.length < 4) spawnAsteroids(4 - asteroids.length);
    drawTitle();
    requestAnimationFrame(loop);
    return;
  }

  if (gameState === 'gameover') {
    drawGameOver();
    requestAnimationFrame(loop);
    return;
  }

  // ── Update ──
  if (shootCooldown > 0) shootCooldown--;
  if (keys['Space']) shoot();

  updateShip(ship);
  bullets = bullets.filter(b => b.life > 0);
  for (const b of bullets) updateBullet(b);
  for (const a of asteroids) updateAsteroid(a);
  updateUfo(ufo);

  particles = particles.filter(p => p.life > 0);
  for (const p of particles) updateParticle(p);

  // UFO spawn
  if (!ufo && gameState === 'playing') {
    ufoTimer--;
    if (ufoTimer <= 0) ufo = createUfo();
  }

  checkCollisions();

  // Dead → respawn or game over
  if (gameState === 'dead') {
    deadTimer--;
    if (deadTimer <= 0) {
      if (lives <= 0) {
        hiScore = Math.max(hiScore, score);
        gameState = 'gameover';
      } else {
        ship = createShip();
        ship.alive = true;
        gameState = 'playing';
      }
    }
  }

  // Level clear
  if (asteroids.length === 0 && !ufo && gameState === 'playing') {
    nextLevel();
  }

  // ── Draw ──
  for (const a of asteroids) drawAsteroid(a);
  for (const b of bullets) drawBullet(b);
  drawUfo(ufo);
  drawShip(ship);
  for (const p of particles) drawParticle(p);
  drawHUD();

  if (gameState === 'playing') playBeat();

  requestAnimationFrame(loop);
}

// ─── Init title screen ───────────────────────────────────────────────────────
hiScore = 0;
asteroids = [];
bullets = [];
particles = [];
ufo = null;
ufoTimer = 0;
ship = { alive: false };
spawnAsteroids(5);
loop();

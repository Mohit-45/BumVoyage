import { Net, claimSession, readSession, writeSession } from './net.js';
import { World } from './scene.js';
import { AnimalPreview } from './preview.js';
import { InputController } from './input.js';
import { Sfx } from './audio.js';
import { Course } from '../shared/course.js';
import { LEVELS } from '../shared/levels.js';
import { ANIMALS, animalById } from '../shared/animals.js';
import { BOAT, FART, MAX_PLAYERS, sectorLayout } from '../shared/config.js';

const $ = (id) => document.getElementById(id);
const NAME_KEY = 'bumvoyage.name';
// How long Create/Join may wait for the server before the player is told it is not answering.
const REPLY_TIMEOUT_MS = 8000;
// After this long without a connection the status line admits it is struggling.
const SLOW_CONNECT_MS = 8000;

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable */
  }
}

function buzz(pattern) {
  if (navigator.userActivation?.hasBeenActive && navigator.vibrate) navigator.vibrate(pattern);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function sectorDiagram(layout, seatInfo, mySeat) {
  const r = 26;
  const pt = (angle) => `${(Math.sin(angle) * r).toFixed(2)} ${(-Math.cos(angle) * r).toFixed(2)}`;
  const parts = layout.map((sector, i) => {
    const color = seatInfo[i] ? seatInfo[i].color : '#999';
    const mine = i === mySeat;
    const stroke = mine ? '#fff' : 'rgb(0 0 0 / 35%)';
    const width = mine ? 2.6 : 1.2;
    if (sector.full) return `<circle r="${r}" fill="${color}" stroke="${stroke}" stroke-width="${width}"/>`;
    const a0 = sector.center - sector.half;
    const a1 = sector.center + sector.half;
    const large = sector.half * 2 > Math.PI ? 1 : 0;
    return `<path d="M0 0 L${pt(a0)} A${r} ${r} 0 ${large} 1 ${pt(a1)} Z" fill="${color}" fill-opacity="${mine ? 1 : 0.55}" stroke="${stroke}" stroke-width="${width}"/>`;
  });
  return (
    '<svg viewBox="-32 -32 64 64" width="56" height="56" aria-hidden="true">' +
    '<circle r="29" fill="#a8743a" stroke="#ff8a3d" stroke-width="4"/>' +
    parts.join('') +
    '<path d="M0 -29 L-4 -22 L4 -22 Z" fill="#fff"/>' +
    '</svg>'
  );
}

class App {
  constructor() {
    this.net = new Net();
    this.sfx = new Sfx();
    this.world = new World($('stage'));
    this.preview = new AnimalPreview($('preview'));
    this.input = new InputController({
      stick: $('stick'),
      knob: $('stick-knob'),
      button: $('toot'),
      onStick: (a, m) => this.net.send({ t: 'stick', a, m }, true),
      onCharge: (on) => this.net.send({ t: 'charge', on }, true),
    });
    this.screen = 'home';
    this.me = null;
    this.code = null;
    this.levels = LEVELS;
    this.players = [];
    this.hostId = null;
    this.levelIndex = 0;
    this.phase = 'lobby';
    this.courses = new Map();
    this.mySeat = -1;
    this.racing = false;
    this.countdownEnd = 0;
    this.countdownShown = -1;
    this.bannerTimer = 0;
    this.tipTimer = 0;
    this.toastTimer = 0;
    this.pending = '';
    this.pendingTimer = 0;
    this.offlineTimer = 0;
    this.offlineSlow = false;
    // Camera shake is applied inside World.render(); frame() zeroes it while this matches.
    this.reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.lastHeatSore = false;
    this.hud = { hull: -1, timer: '', progress: -1, gas: -1, heat: -1, label: '' };
    this.lastFinish = null;
    this.sinks = 0;
    this.buildAnimalGrid();
    this.bindUi();
    this.bindNet();
    this.boot();
    requestAnimationFrame((t) => this.frame(t));
  }

  buildAnimalGrid() {
    const grid = $('animal-grid');
    for (const animal of ANIMALS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'animal-btn';
      btn.dataset.id = animal.id;
      btn.title = animal.name;
      btn.setAttribute('aria-label', animal.name);
      btn.textContent = animal.emoji;
      btn.addEventListener('click', () => {
        this.net.send({ t: 'animal', id: animal.id });
        this.showAnimal(animal.id);
      });
      grid.append(btn);
    }
  }

  showAnimal(id) {
    const animal = animalById(id);
    this.preview.setAnimal(animal.id);
    $('animal-blurb').textContent = `${animal.name}. ${animal.blurb}`;
    for (const btn of $('animal-grid').children) btn.classList.toggle('selected', btn.dataset.id === animal.id);
  }

  boot() {
    $('name-input').value = readName();
    const params = new URLSearchParams(location.search);
    const room = (params.get('room') ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (room) $('code-input').value = room;
    $('btn-mute').textContent = this.sfx.muted ? 'Sound off' : 'Sound on';
    const session = readSession();
    if (!session) {
      this.net.connect();
    } else {
      // A duplicated tab inherits the session of the tab it was copied from. Only the page that
      // holds the lock may resume that seat; the copy starts as a fresh player instead.
      claimSession(session.token).then((owned) => {
        if (!owned) writeSession(null);
        this.net.connect();
        this.refreshConnection();
      });
    }
    this.refreshConnection();
  }

  show(screen) {
    this.screen = screen;
    document.body.dataset.screen = screen;
    for (const id of ['home', 'lobby', 'game']) $(`screen-${id}`).classList.toggle('active', id === screen);
    if (screen === 'game') this.world.resize();
    if (screen === 'lobby') this.preview.resize();
  }

  toast(text, ms = 2600) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  banner(text, sub = '', ms = 0) {
    const el = $('banner');
    el.innerHTML = '';
    el.append(document.createTextNode(text));
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      el.append(small);
    }
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    if (ms) this.bannerTimer = setTimeout(() => this.hideBanner(), ms);
  }

  hideBanner() {
    $('banner').classList.remove('show');
  }

  tip(text, ms = 0) {
    const el = $('tip');
    el.textContent = text;
    el.classList.toggle('show', Boolean(text));
    clearTimeout(this.tipTimer);
    if (ms && text) this.tipTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  get isHost() {
    return this.me !== null && this.hostId === this.me;
  }

  bindUi() {
    this.sfx.bindUnlock();
    $('btn-create').addEventListener('click', () => {
      if (this.canEnterRoom()) this.enterRoom({ t: 'create' }, 'Creating your room...');
    });
    $('join-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.canEnterRoom()) return;
      const code = $('code-input').value.toUpperCase().replace(/[^A-Z]/g, '');
      if (code.length !== 4) {
        this.setHomeMessage('Room codes have 4 letters.');
        return;
      }
      this.enterRoom({ t: 'join', code }, `Joining room ${code}...`);
    });
    $('code-input').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
    });
    for (const id of ['btn-help', 'btn-help-lobby']) $(id).addEventListener('click', () => $('help').classList.remove('hidden'));
    $('btn-help-close').addEventListener('click', () => $('help').classList.add('hidden'));
    $('help').addEventListener('click', (e) => {
      if (e.target === $('help')) $('help').classList.add('hidden');
    });
    $('btn-leave').addEventListener('click', () => this.leave());
    $('btn-copy').addEventListener('click', () => this.copyInvite());
    $('btn-start').addEventListener('click', () => this.net.send({ t: 'start' }));
    $('btn-next').addEventListener('click', () => {
      this.net.send({ t: 'level', i: this.lastFinish.level + 1 });
      this.net.send({ t: 'start' });
    });
    $('btn-retry').addEventListener('click', () => this.net.send({ t: 'start' }));
    $('btn-lobby').addEventListener('click', () => this.net.send({ t: 'lobby' }));
    $('btn-mute').addEventListener('click', () => {
      this.sfx.unlock();
      this.sfx.setMuted(!this.sfx.muted);
      $('btn-mute').textContent = this.sfx.muted ? 'Sound off' : 'Sound on';
    });
    const rename = $('rename-input');
    const sendRename = () => {
      const name = rename.value.trim();
      if (!name) return;
      saveName(name);
      this.net.send({ t: 'rename', name });
    };
    rename.addEventListener('change', sendRename);
    rename.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sendRename();
        rename.blur();
      }
    });
    $('preview').addEventListener('click', () => {
      this.sfx.unlock();
      const power = 0.35 + Math.random() * 0.6;
      this.preview.toot(power);
      this.sfx.toot(power);
    });
  }

  // A boot-time resume is in flight: a session exists but the server has not seated us yet.
  get resuming() {
    return this.me === null && readSession() !== null;
  }

  // Create and Join need a live connection, and no earlier request still waiting for its answer.
  canEnterRoom() {
    return this.net.online && !this.pending && !this.resuming;
  }

  enterRoom(msg, pendingText) {
    const name = $('name-input').value.trim();
    saveName(name);
    this.setHomeMessage('');
    this.setPending(pendingText);
    this.net.send({ ...msg, name });
  }

  // Marks a Create/Join as waiting for the server. It has a deadline so a dead socket cannot hang the page.
  setPending(text) {
    clearTimeout(this.pendingTimer);
    this.pending = text;
    if (text) {
      this.pendingTimer = setTimeout(() => {
        this.pending = '';
        this.setHomeMessage('The server did not answer. Check your connection and try again.');
        this.net.reconnect();
        this.refreshConnection();
      }, REPLY_TIMEOUT_MS);
    }
    this.refreshConnection();
  }

  setHomeMessage(text, status = false) {
    const el = $('home-error');
    el.textContent = text;
    el.classList.toggle('status', status);
  }

  // Keeps the Reconnecting banner, the Create/Join buttons and the home status line in step with the socket.
  refreshConnection() {
    const online = this.net.online;
    const seated = this.me !== null;
    const resuming = this.resuming;
    if (online) {
      clearTimeout(this.offlineTimer);
      this.offlineTimer = 0;
      this.offlineSlow = false;
    } else if (!this.offlineTimer) {
      this.offlineTimer = setTimeout(() => {
        this.offlineSlow = true;
        this.refreshConnection();
      }, SLOW_CONNECT_MS);
    }
    const banner = $('reconnect');
    banner.classList.toggle('hidden', online || !(seated || resuming));
    banner.textContent = this.offlineSlow ? 'Still trying to reconnect. Check your connection.' : 'Reconnecting...';
    const locked = !online || resuming || Boolean(this.pending);
    $('btn-create').disabled = locked;
    $('btn-join').disabled = locked;
    let status = '';
    if (this.pending) status = this.pending;
    else if (!online && !seated) {
      if (this.offlineSlow) status = 'Still trying to connect. Check your connection.';
      else status = resuming ? 'Reconnecting to your room...' : 'Connecting...';
    } else if (resuming) status = 'Rejoining your room...';
    // Errors stay until the next action; only status lines are replaced or cleared here.
    const showingError = $('home-error').textContent !== '' && !$('home-error').classList.contains('status');
    if (!showingError) this.setHomeMessage(status, status !== '');
  }

  leave() {
    this.net.send({ t: 'leave' }, true);
    this.resetToHome();
  }

  resetToHome(message = '') {
    writeSession(null);
    this.net.clearQueue();
    this.me = null;
    this.code = null;
    this.phase = 'lobby';
    this.input.setEnabled(false);
    $('result').classList.add('hidden');
    history.replaceState(null, '', location.pathname);
    this.setHomeMessage(message);
    this.show('home');
    this.refreshConnection();
  }

  async copyInvite() {
    const link = `${location.origin}/?room=${this.code}`;
    try {
      await navigator.clipboard.writeText(link);
      this.toast('Invite link copied');
    } catch {
      this.toast(`Share this code: ${this.code}`);
    }
  }

  bindNet() {
    const net = this.net;
    net.on('status', () => this.refreshConnection());
    net.on('joined', (msg) => {
      this.me = msg.you;
      this.code = msg.code;
      this.levels = msg.levels;
      writeSession({ code: msg.code, token: msg.token });
      history.replaceState(null, '', `?room=${msg.code}`);
      this.setHomeMessage('');
      this.setPending('');
      this.buildLevels();
    });
    net.on('lobby', (msg) => this.onLobby(msg));
    net.on('start', (msg) => this.onStart(msg));
    net.on('go', () => this.onGo());
    net.on('s', (snap) => this.world.push(snap));
    net.on('ev', (msg) => this.onEvents(msg.list));
    net.on('finish', (msg) => this.onFinish(msg));
    net.on('err', (msg) => {
      this.setPending('');
      if (msg.code === 'resume-failed') {
        // A plain disconnect never lands here: the player stays put under the Reconnecting banner until the
        // server answers. Only a refused resume sends them home, and it says why.
        const code = this.code ?? readSession()?.code ?? '';
        const reason = msg.msg || 'Could not rejoin your room.';
        this.resetToHome(reason);
        if (code) $('code-input').value = code;
        this.toast(reason, 6000);
        return;
      }
      if (this.screen === 'home') this.setHomeMessage(msg.msg);
      else this.toast(msg.msg);
    });
  }

  buildLevels() {
    const wrap = $('levels');
    wrap.innerHTML = '';
    this.levels.forEach((level, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level';
      btn.dataset.index = String(i);
      const name = document.createElement('strong');
      name.textContent = `${i + 1}. ${level.name}`;
      const tag = document.createElement('span');
      tag.textContent = level.tagline;
      btn.append(name, tag);
      btn.addEventListener('click', () => this.net.send({ t: 'level', i }));
      wrap.append(btn);
    });
  }

  onLobby(msg) {
    this.players = msg.players;
    this.hostId = msg.host;
    this.levelIndex = msg.level;
    this.phase = msg.phase;
    this.code = msg.code;
    // The server sends no 'start' for a room sitting on its results screen, so a player who joins or
    // resumes then would stay on the home screen. Put them in the lobby, where every button still works.
    const arrivedDuringResults = this.phase === 'finished' && this.screen === 'home' && this.me !== null;
    if (this.phase === 'lobby' || arrivedDuringResults) {
      $('result').classList.add('hidden');
      this.input.setEnabled(false);
      this.show('lobby');
      const me = this.players.find((p) => p.id === this.me);
      if (me) {
        this.showAnimal(me.animal);
        if (document.activeElement !== $('rename-input')) $('rename-input').value = me.name;
      }
    }
    this.renderLobby();
    this.renderResultActions();
  }

  renderLobby() {
    $('room-code').textContent = this.code ?? '----';
    $('crew-count').textContent = `${this.players.length}/${MAX_PLAYERS}`;
    const crew = $('crew');
    crew.innerHTML = '';
    for (const p of this.players) {
      const li = document.createElement('li');
      if (!p.connected) li.classList.add('offline');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const animal = document.createElement('span');
      animal.className = 'animal';
      animal.textContent = animalById(p.animal).emoji;
      const name = document.createElement('span');
      name.textContent = p.name;
      const tag = document.createElement('span');
      tag.className = 'tag';
      const tags = [];
      if (p.id === this.hostId) tags.push('Host');
      if (p.id === this.me) tags.push('You');
      if (!p.connected) tags.push('Away');
      tag.textContent = tags.join(' · ');
      li.append(dot, animal, name, tag);
      crew.append(li);
    }
    for (const btn of $('levels').children) {
      btn.classList.toggle('selected', Number(btn.dataset.index) === this.levelIndex);
      btn.disabled = !this.isHost;
    }
    const start = $('btn-start');
    start.disabled = !this.isHost;
    const host = this.players.find((p) => p.id === this.hostId);
    start.textContent = this.isHost ? 'Start race' : 'Waiting for host...';
    const share = Math.round(100 / Math.max(1, this.players.length));
    $('lobby-note').textContent = this.isHost
      ? `Everyone gets ${share}% of the boat. Start when the crew is aboard (1 to 4 players).`
      : `${host ? host.name : 'The host'} picks the river and starts the race.`;
  }

  getCourse(index) {
    if (!this.courses.has(index)) this.courses.set(index, new Course(LEVELS[index]));
    return this.courses.get(index);
  }

  onStart(msg) {
    const seats = msg.seats;
    const layout = sectorLayout(Math.max(1, seats.length));
    const mine = seats.find((s) => s.id === this.me);
    this.mySeat = mine ? mine.seat : -1;
    const seatInfo = [];
    for (const { id, seat } of seats) {
      const p = this.players.find((x) => x.id === id);
      seatInfo[seat] = { name: p ? p.name : 'Crew', color: p ? p.color : '#ccc', animal: p ? p.animal : 'pig', id };
    }
    this.levelIndex = msg.level;
    this.world.setCourse(this.getCourse(msg.level));
    this.world.setCrew(layout, seatInfo, this.mySeat);
    const me = this.players.find((p) => p.id === this.me);
    this.input.setColor(me ? me.color : '#ffd43b');
    this.input.setEnabled(false);
    $('controls').classList.toggle('hidden', this.mySeat < 0);
    $('result').classList.add('hidden');
    this.buildSeatChip(layout, seatInfo);
    this.show('game');
    this.hud = { hull: -1, timer: '', progress: -1, gas: -1, heat: -1, label: '' };
    this.lastHeatSore = false;
    this.sinks = 0;
    $('sinks').textContent = '0';
    $('avatar').textContent = me ? animalById(me.animal).emoji : '';
    this.buildTicks();
    this.racing = msg.racing;
    if (msg.racing) {
      this.hideBanner();
      this.tip('');
      this.input.setEnabled(this.mySeat >= 0);
    } else {
      this.countdownEnd = performance.now() + msg.countdown * 1000;
      this.countdownShown = -1;
      this.banner(LEVELS[msg.level].name, 'Get ready');
      this.tip(
        this.mySeat >= 0
          ? 'When the race starts, use the stick to walk around your part of the boat. Stand opposite to where you want to go, then hold TOOT.'
          : 'You are spectating this race. You will get an animal next round.',
      );
    }
  }

  buildTicks() {
    const ticks = $('progress-ticks');
    ticks.innerHTML = '';
    for (let k = 1; k <= 3; k++) {
      const tick = document.createElement('i');
      tick.style.left = `${k * 25}%`;
      ticks.append(tick);
    }
  }

  buildSeatChip(layout, seatInfo) {
    const sector = this.mySeat >= 0 ? layout[this.mySeat] : null;
    $('seat-name').textContent = sector ? `${sector.name}: ${sector.percent}% of the boat` : 'Spectating';
    $('seat-hint').textContent = sector ? sector.hint : 'Watch the crew work.';
    $('seat-diagram').innerHTML = sectorDiagram(layout, seatInfo, this.mySeat);
  }

  onGo() {
    this.racing = true;
    this.banner('GO!', '', 800);
    this.sfx.countdown(true);
    this.input.setEnabled(this.mySeat >= 0);
    if (this.mySeat >= 0) this.tip('Tip: the arrow on the boat shows where your blast will push. Too much farting makes your bum sore.', 7000);
  }

  onEvents(list) {
    for (const ev of list) {
      this.world.event(ev);
      const mine = ev.seat === this.mySeat;
      if (ev.k === 'burst') this.sfx.toot(ev.p, mine ? 1 : 0.75);
      else if (ev.k === 'fizzle') {
        if (mine) this.sfx.fizzle();
      } else if (ev.k === 'bump') {
        this.sfx.thud(0.6 + ev.sev * 0.6);
        buzz(40);
      } else if (ev.k === 'ouch' || ev.k === 'spiked') {
        this.sfx.ouch();
        buzz([40, 30, 40]);
        if (ev.k === 'spiked') this.toast('Ouch! Spiked rail.', 1200);
      } else if (ev.k === 'flush') {
        this.sfx.plunge();
        this.banner('FLUSHED!', 'The whirlpool spat you out and rattled your gas.', 1400);
      } else if (ev.k === 'thud') this.sfx.thud(0.35);
      else if (ev.k === 'dropin') this.sfx.whoosh();
      else if (ev.k === 'plunge') {
        this.sfx.plunge();
        this.banner('SPLASH!', 'Everyone clenched. Gas tanks rattled.', 1400);
      } else if (ev.k === 'sunk') {
        this.sinks += 1;
        $('sinks').textContent = String(this.sinks);
        this.sfx.sunk();
        this.input.setEnabled(false);
        this.banner('SUNK!', 'Back to the last flag...');
      } else if (ev.k === 'respawn') {
        this.banner('GO!', '', 700);
        this.input.setEnabled(this.mySeat >= 0);
      } else if (ev.k === 'cp') {
        this.sfx.checkpoint();
        this.banner('Checkpoint!', 'Sunk boats restart here', 1100);
      } else if (ev.k === 'nudge') this.toast('Stuck! The river nudged you free.', 1800);
    }
  }

  onFinish(msg) {
    this.lastFinish = msg;
    this.racing = false;
    this.input.setEnabled(false);
    this.sfx.finish();
    this.banner('FINISH!', '', 1600);
    this.tip('');
    $('result-title').textContent = `${LEVELS[msg.level].name} cleared`;
    $('result-time').textContent = formatTime(msg.time);
    $('result-sinks').textContent = String(msg.sinks);
    $('result-bumps').textContent = String(msg.bumps);
    $('result-par').textContent = `Par time ${formatTime(msg.par)}`;
    $('result-stars').innerHTML = [1, 2, 3].map((n) => `<span class="${n <= msg.stars ? 'on' : ''}">★</span>`).join('');
    setTimeout(() => {
      if (this.phase === 'finished') $('result').classList.remove('hidden');
    }, 1500);
    this.renderResultActions();
  }

  renderResultActions() {
    const host = this.isHost;
    const finish = this.lastFinish;
    $('btn-next').classList.toggle('hidden', !host || !finish || !finish.hasNext);
    $('btn-retry').classList.toggle('hidden', !host);
    $('btn-lobby').classList.toggle('hidden', !host);
    const hostPlayer = this.players.find((p) => p.id === this.hostId);
    $('result-wait').textContent = host ? '' : `Waiting for ${hostPlayer ? hostPlayer.name : 'the host'} to pick what's next...`;
  }

  frame(now) {
    if (this.screen === 'game') {
      if (this.reduceMotion?.matches) this.world.shake = 0;
      this.world.setLocalCharge(this.input.chargeLevel());
      this.input.update(this.world.yaw);
      this.updateCountdown(now);
      this.world.render(now);
      this.updateHud();
    } else if (this.screen === 'lobby') {
      this.preview.render(now);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  updateCountdown(now) {
    if (this.racing || this.phase === 'finished' || this.countdownEnd === 0) return;
    const left = Math.ceil((this.countdownEnd - now) / 1000);
    if (left > 0 && left !== this.countdownShown) {
      this.countdownShown = left;
      this.banner(String(left), LEVELS[this.levelIndex].name);
      this.sfx.countdown(false);
    }
  }

  updateHud() {
    const snap = this.world.latest();
    if (!snap) return;
    const hud = this.hud;
    if (snap.hull !== hud.hull) {
      hud.hull = snap.hull;
      const fill = $('hull-fill');
      fill.style.width = `${(snap.hull / BOAT.maxHull) * 100}%`;
      fill.classList.toggle('low', snap.hull <= 3 && snap.hull > 1);
      fill.classList.toggle('critical', snap.hull <= 1);
      $('hull-text').textContent = `${snap.hull}/${BOAT.maxHull}`;
    }
    const timer = formatTime(snap.T);
    if (timer !== hud.timer) {
      hud.timer = timer;
      $('timer').textContent = timer;
    }
    const course = this.world.course;
    const progress = course ? Math.round(Math.min(1, snap.p / course.finishS) * 1000) : 0;
    if (progress !== hud.progress) {
      hud.progress = progress;
      $('progress-fill').style.width = `${progress / 10}%`;
      $('progress-dot').style.left = `${progress / 10}%`;
    }
    if (this.mySeat < 0) return;
    const gas = snap.gas[this.mySeat] ?? 100;
    if (gas !== hud.gas) {
      hud.gas = gas;
      const fill = $('gas-fill');
      fill.style.width = `${gas}%`;
      fill.classList.toggle('low', gas < 25);
    }
    const heat = Math.round((snap.heat[this.mySeat] ?? 0) * 100);
    if (heat !== hud.heat) {
      hud.heat = heat;
      const fill = $('heat-fill');
      fill.style.width = `${heat}%`;
      const sore = heat / 100 >= FART.soreStart;
      fill.classList.toggle('sore', sore);
      if (sore && !this.lastHeatSore) {
        this.sfx.yelp();
        this.toast('Ouch! Your bum is sore. Blasts are weaker until it cools down.', 2600);
      }
      this.lastHeatSore = sore;
    }
    const level = this.input.chargeLevel();
    $('toot').style.setProperty('--charge', level.toFixed(3));
    const label = level > 0.85 ? 'MAX!' : level > 0 ? 'RELEASE' : 'TOOT';
    if (label !== hud.label) {
      hud.label = label;
      $('toot-label').textContent = label;
    }
  }
}

function webglAvailable() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    // Hand the probe context back: browsers only allow a handful per page.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

// Swaps the home screen for a plain explanation, so a browser that cannot run the game never gets dead buttons.
function showUnsupported(reason) {
  for (const screen of document.querySelectorAll('.screen')) screen.classList.remove('active');
  $('unsupported-webgl').classList.toggle('hidden', reason !== 'webgl');
  $('unsupported-error').classList.toggle('hidden', reason === 'webgl');
  $('screen-unsupported').classList.add('active');
}

if (!webglAvailable()) {
  showUnsupported('webgl');
} else {
  try {
    window.bumVoyage = new App();
  } catch (err) {
    // three.js throws when the second WebGL context (the lobby preview) cannot be created, among other things.
    console.error(err);
    showUnsupported(/webgl/i.test(String(err?.message)) ? 'webgl' : 'error');
  }
}

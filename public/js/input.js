import { FART } from '../shared/config.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const SEND_INTERVAL_MS = 60;
const KEY_MAP = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

// Keys that must keep working in a text field, a select or an open dialog
const typingTarget = (t) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const dialogOpen = () => document.querySelector('.modal:not(.hidden)') !== null;

export class InputController {
  constructor({ stick, knob, button, onStick, onCharge }) {
    this.stick = stick;
    this.knob = knob;
    this.button = button;
    this.onStick = onStick;
    this.onCharge = onCharge;
    this.enabled = false;
    this.dragging = false;
    this.stickPointer = null;
    this.tootPointer = null;
    this.spaceHeld = false;
    this.pointerVec = { x: 0, y: 0 };
    this.keys = new Set();
    this.charging = false;
    this.chargeStart = 0;
    this.lastSent = { a: 0, m: 0, at: 0 };
    this.bind();
    this.renderKnob(0, 0);
  }

  bind() {
    // The stick tracks a finger even while the controller is disabled (countdown, sinking), so a finger that
    // is already down when the race starts or the boat respawns steers without being lifted and put down again
    this.stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stick.setPointerCapture(e.pointerId);
      this.stickPointer = e.pointerId;
      this.dragging = true;
      this.setFromPointer(e);
    });
    this.stick.addEventListener('pointermove', (e) => {
      if (this.dragging && e.pointerId === this.stickPointer) this.setFromPointer(e);
    });
    const release = (e) => {
      if (e.pointerId !== this.stickPointer) return;
      this.releaseStick();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.stick.addEventListener(type, release);

    this.button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.button.setPointerCapture(e.pointerId);
      this.tootPointer = e.pointerId;
      this.beginCharge();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.button.addEventListener(type, () => {
        this.tootPointer = null;
        this.endCharge();
      });
    }
    this.button.addEventListener('contextmenu', (e) => e.preventDefault());

    // Leave the keys alone outside a race, so Space still presses buttons and the arrows still scroll the lobby
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingTarget(e.target) || dialogOpen()) return;
      const space = e.code === 'Space';
      if (!space && !KEY_MAP[e.code]) return;
      if (this.enabled) e.preventDefault();
      else if (space || this.stick.getClientRects().length === 0) return;
      if (space) {
        this.spaceHeld = true;
        if (!e.repeat) this.beginCharge();
      } else {
        this.keys.add(e.code);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.endCharge();
        // Firefox presses a focused button on Space keyup unless that is cancelled too
        if (this.spaceHeld) e.preventDefault();
        this.spaceHeld = false;
      }
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.spaceHeld = false;
      this.endCharge();
    });
  }

  releaseStick() {
    this.dragging = false;
    this.stickPointer = null;
    this.pointerVec = { x: 0, y: 0 };
  }

  // True while the browser still reports this pointer as down on the element
  holds(el, id) {
    return id !== null && (typeof el.hasPointerCapture !== 'function' || el.hasPointerCapture(id));
  }

  setEnabled(enabled) {
    const was = this.enabled;
    this.enabled = enabled;
    this.button.disabled = !enabled;
    if (!enabled) {
      this.endCharge();
      return;
    }
    if (was) return;
    // GO or respawn: a finger or key still down carries on, one whose release we never heard about is dropped
    if (this.tootPointer !== null && !this.holds(this.button, this.tootPointer)) this.tootPointer = null;
    if (this.tootPointer !== null || this.spaceHeld) this.beginCharge();
    // Make the next update() send the current stick, even if it matches what the server last heard
    this.lastSent = { a: 0, m: -1, at: 0 };
  }

  setColor(color) {
    this.knob.style.setProperty('--seat-color', color);
  }

  setFromPointer(e) {
    const rect = this.stick.getBoundingClientRect();
    const radius = rect.width / 2;
    const dx = (e.clientX - (rect.left + radius)) / (radius - 14);
    const dy = -(e.clientY - (rect.top + radius)) / (radius - 14);
    const len = Math.hypot(dx, dy);
    const k = len > 1 ? 1 / len : 1;
    this.pointerVec = { x: dx * k, y: dy * k };
  }

  vector() {
    if (this.dragging) return this.pointerVec;
    let x = 0;
    let y = 0;
    for (const code of this.keys) {
      const [kx, ky] = KEY_MAP[code];
      x += kx;
      y += ky;
    }
    const len = Math.hypot(x, y);
    return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  beginCharge() {
    if (!this.enabled || this.charging) return;
    this.charging = true;
    this.chargeStart = performance.now();
    this.button.classList.add('charging');
    this.onCharge(true);
  }

  endCharge() {
    if (!this.charging) return;
    const level = this.chargeLevel();
    this.charging = false;
    this.button.classList.remove('charging');
    this.onCharge(false, level);
  }

  chargeLevel() {
    if (!this.charging) return 0;
    return clamp((performance.now() - this.chargeStart) / 1000 / FART.chargeSeconds, 0, 1);
  }

  update(cameraYaw) {
    // A finger lifted while the controls were hidden or disabled may never have reported it
    if (this.dragging && !this.holds(this.stick, this.stickPointer)) this.releaseStick();
    const v = this.vector();
    this.renderKnob(v.x, v.y);
    const mag = Math.hypot(v.x, v.y);
    const active = this.enabled && mag >= FART.stickDeadzone;
    const dirx = Math.cos(cameraYaw) * v.y - Math.sin(cameraYaw) * v.x;
    const diry = Math.sin(cameraYaw) * v.y + Math.cos(cameraYaw) * v.x;
    const angle = Math.atan2(diry, dirx);
    const m = active ? Math.min(1, mag) : 0;
    const now = performance.now();
    const last = this.lastSent;
    const changed = Math.abs(m - last.m) > 0.05 || (m > 0 && Math.abs(Math.atan2(Math.sin(angle - last.a), Math.cos(angle - last.a))) > 0.04);
    if (this.enabled && (changed || (m > 0 && now - last.at > 400)) && now - last.at > SEND_INTERVAL_MS) {
      this.lastSent = { a: angle, m, at: now };
      this.onStick(Math.round(angle * 1000) / 1000, Math.round(m * 100) / 100);
    }
  }

  renderKnob(x, y) {
    const radius = this.stick.clientWidth / 2 || 75;
    this.knob.style.transform = `translate(${x * (radius - 34)}px, ${-y * (radius - 34)}px)`;
  }
}

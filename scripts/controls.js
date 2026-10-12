export const input = { x: 0, z: 0 }; // x: -1 left, +1 right | z: -1 up/forward, +1 down/back

// Camera look. Mouse gives one-off deltas, the right stick gives a continuous rate,
// so read both through consumeLook() instead of touching these directly.
const look = { padX: 0, padY: 0, mouseDX: 0, mouseDY: 0 };

const padMove = { x: 0, z: 0 };                          // left stick, analog
const sources = { key: new Set(), ui: new Set() };

const isHeld = (a) => Object.values(sources).some((s) => s.has(a));
const clamp = (v) => Math.max(-1, Math.min(1, v));

function refresh() {
  const digitalX = isHeld('right') - isHeld('left');
  const digitalZ = isHeld('down') - isHeld('up');
  // keyboard/UI buttons and the stick are combined, clamped to -1..1
  input.x = clamp(digitalX + padMove.x);
  input.z = clamp(digitalZ + padMove.z);
}

const press = (src, a) => { sources[src].add(a); refresh(); };
const release = (src, a) => { sources[src].delete(a); refresh(); };

// ---------- actions: attack, secondary attack, roll ----------
// These are one-shot presses (not "held"). Read them once per frame with consumeActions().
//
//               keyboard / mouse         gamepad ("standard" mapping)   on-screen button (optional)
//   attack      Space, left click        A, X, right trigger            .controller-attack
//   secondary   E, right click           Y, right bumper                .controller-secondary
//   roll        Shift                    B, left bumper                 .controller-roll
//
// Mouse clicks only count once the pointer is locked (the first click just locks it).
const pending = { attack: false, secondary: false, roll: false };

const actionKeys = {
  Space: 'attack',
  KeyE: 'secondary',
  ShiftLeft: 'roll', ShiftRight: 'roll',
};
const mouseActions = { 0: 'attack', 2: 'secondary' };
const padActions = { attack: [0, 2, 7], secondary: [3, 5], roll: [1, 4] };
const uiActions = {
  '.controller-attack': 'attack',
  '.controller-secondary': 'secondary',
  '.controller-roll': 'roll',
  '.action-attack': 'attack',
  '.action-secondary': 'secondary',
  '.action-roll': 'roll',
};

// Returns which actions were pressed since the last call, then clears them.
export function consumeActions() {
  const actions = { ...pending };
  pending.attack = pending.secondary = pending.roll = false;
  return actions;
}

// ---------- on-screen buttons: move while held ----------
const buttons = {
  '.controller-top': 'up',
  '.controller-down': 'down',
  '.controller-left': 'left',
  '.controller-right': 'right',
};
for (const [selector, action] of Object.entries(buttons)) {
  const el = document.querySelector(selector);
  if (!el) continue;
  el.addEventListener('pointerdown', () => press('ui', action));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    el.addEventListener(ev, () => release('ui', action));
  }
}

// ---------- on-screen buttons: actions fire once per tap ----------
for (const [selector, action] of Object.entries(uiActions)) {
  const el = document.querySelector(selector);
  if (!el) continue;
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); pending[action] = true; });
}

// ---------- keyboard ----------
const keyMap = {
  ArrowUp: 'up',       KeyW: 'up',
  ArrowDown: 'down',   KeyS: 'down',
  ArrowLeft: 'left',   KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

document.addEventListener('keydown', (e) => {
  const act = actionKeys[e.code];
  if (act) {
    e.preventDefault();
    if (!e.repeat) pending[act] = true;   // holding the key doesn't repeat the action
    return;
  }

  const action = keyMap[e.code];
  if (!action) return;
  e.preventDefault();
  press('key', action);
});

document.addEventListener('keyup', (e) => {
  const action = keyMap[e.code];
  if (action) release('key', action);
});

window.addEventListener('blur', () => {
  sources.key.clear();
  sources.ui.clear();
  padMove.x = padMove.z = 0;
  look.padX = look.padY = 0;
  refresh();
});

// ---------- mouse look (pointer lock) ----------
const lockTarget = document.querySelector('canvas') ?? document.body;

lockTarget.addEventListener('click', () => {
  if (!document.pointerLockElement) lockTarget.requestPointerLock();
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== lockTarget) return;
  look.mouseDX += e.movementX;
  look.mouseDY += e.movementY;
});
// Esc releases the pointer lock automatically.

// ---------- mouse buttons (only while the pointer is locked) ----------
document.addEventListener('mousedown', (e) => {
  const act = mouseActions[e.button];
  if (act && document.pointerLockElement) pending[act] = true;
});

// right click is the secondary attack, so keep the browser's menu out of the way while playing
document.addEventListener('contextmenu', (e) => {
  if (document.pointerLockElement) e.preventDefault();
});

// ---------- gamepad (single controller, "standard" mapping) ----------
// axes[0], axes[1] = left stick  (x, y)  -> movement
// axes[2], axes[3] = right stick (x, y)  -> camera
// buttons: see the action table above
const DEADZONE = 0.15;

// radial deadzone: ignores stick drift and rescales so output still reaches 1
function stick(x = 0, y = 0) {
  const mag = Math.hypot(x, y);
  if (mag < DEADZONE) return [0, 0];
  const scale = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag;
  return [x * scale, y * scale];
}

let frame = null;
const padHeld = { attack: false, secondary: false, roll: false };   // so a held button only fires once
const clearPadHeld = () => { padHeld.attack = padHeld.secondary = padHeld.roll = false; };

function pollGamepad() {
  const pad = navigator.getGamepads()[0];

  if (pad) {
    [padMove.x, padMove.z] = stick(pad.axes[0], pad.axes[1]);
    [look.padX, look.padY] = stick(pad.axes[2], pad.axes[3]);

    for (const [action, indices] of Object.entries(padActions)) {
      const held = indices.some((i) => pad.buttons[i]?.pressed);
      if (held && !padHeld[action]) pending[action] = true;   // only on the frame it goes down
      padHeld[action] = held;
    }
  } else {
    padMove.x = padMove.z = 0;
    look.padX = look.padY = 0;
    clearPadHeld();
  }

  refresh();
  frame = requestAnimationFrame(pollGamepad);
}

window.addEventListener('gamepadconnected', () => {
  if (frame === null) frame = requestAnimationFrame(pollGamepad);
});

window.addEventListener('gamepaddisconnected', () => {
  cancelAnimationFrame(frame);
  frame = null;
  padMove.x = padMove.z = 0;
  look.padX = look.padY = 0;
  clearPadHeld();
  refresh();
});

// ---------- camera look output ----------
// Call once per frame. Returns rotation to apply this frame, in radians.
// yaw:   positive = look right
// pitch: positive = look down  (flip the sign if your camera feels inverted)
export function consumeLook(dt = 1 / 60, { mouseSens = 0.002, padSpeed = 2.5 } = {}) {
  const yaw   = look.mouseDX * mouseSens + look.padX * padSpeed * dt;
  const pitch = look.mouseDY * mouseSens + look.padY * padSpeed * dt;
  look.mouseDX = look.mouseDY = 0; // mouse deltas are one-shot, so reset after reading
  return { yaw, pitch };
}

// ---------- touch camera look (mobile) ----------
// Dragging on the .touch-look-zone (right half of the screen) rotates the camera.
// Touches on UI buttons (z-index 10) sit above the zone (z-index 5), so they still work.
{
  const zone = document.querySelector('.touch-look-zone');
  if (zone) {
    const TOUCH_SENS = 0.004;         // radians per CSS pixel of finger movement
    const activePointers = new Map();  // pointerId → { x, y }

    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });

    zone.addEventListener('pointermove', (e) => {
      const prev = activePointers.get(e.pointerId);
      if (!prev) return;

      // feed deltas into the same look accumulator the mouse uses
      look.mouseDX += (e.clientX - prev.x) * (TOUCH_SENS / 0.002);
      look.mouseDY += (e.clientY - prev.y) * (TOUCH_SENS / 0.002);

      prev.x = e.clientX;
      prev.y = e.clientY;
    });

    for (const ev of ['pointerup', 'pointercancel']) {
      zone.addEventListener(ev, (e) => {
        activePointers.delete(e.pointerId);
      });
    }
  }
}
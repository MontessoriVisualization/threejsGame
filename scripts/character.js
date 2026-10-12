import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/*
 * character.js — "low poly adventurer" (MadTrollStudio, CC-BY-4.0)
 *
 * The glTF has a skeleton but NO baked animations, and its deform bones (DEF-*) are
 * stored flat under ROOT. So the animations here are procedural: we pose the bones
 * ourselves with a tiny forward-kinematics solver.
 *
 *   const hero = await loadCharacter('/models/adventurer/scene.gltf', { height: 1.8 });
 *   player.add(hero.object);
 *   hero.update(dt, speed01, headingRadians);   // every frame
 *   hero.attack();                               // sword swing (chains into a combo)
 *   hero.secondaryAttack();                      // whirlwind slash (heavy attack, ends a combo)
 *   hero.roll(headingRadians);                   // dodge roll, heading optional; false if on cooldown
 *
 * The roll moves the character, but this file only poses bones, so the roll's travel is handed
 * to you instead. After hero.update(dt, ...) apply it to whatever you move:
 *
 *   player.position.addScaledVector(hero.rollVelocity, dt);
 *
 * (hero.rollVelocity is in hero.object's parent space and is zero when not rolling. It is the exact
 * displacement of this frame divided by dt, so the distance is right at any frame rate.)
 * Also available: hero.rolling, hero.invulnerable (true during the roll's i-frames), hero.attacking.
 *
 * Pose angles below are in the rig's own axes ("ROOT space"), in radians:
 *   X axis = character's left/right axis   -> NEGATIVE swings a hanging limb FORWARD
 *                                             (and POSITIVE tips the torso/head forward)
 *   Y axis = character's front/back axis   -> POSITIVE swings a hanging limb to the RIGHT
 *   Z axis = vertical                      -> POSITIVE turns to the LEFT
 * If something moves the wrong way for you, flip the sign of that number.
 */

// =========================
// CONFIG
// =========================

const TAU = Math.PI * 2;

const MODEL_HEIGHT = 1.78;      // height of scene.gltf in its own units (used to scale to `height`)
const GROUND_ADJUST = 0;        // nudge the whole body up(+)/down(-) if the feet float or sink (rig units, 1 ≈ 0.27 m)

const WALK = {
  strideHz: 1.9,        // walk cycles per second at full speed
  legSwing: 0.45,       // thigh swing
  knee: 0.95,           // knee bend while the leg swings forward
  armSwing: 0.5,
  swordArmSwing: 0.2,   // right arm holds the sword, so it swings less
  hipTwist: 0.12,
  chestTwist: 0.18,
  lean: 0.1,            // forward lean at full speed
};

const COMBO_WINDOW = 0.5;       // seconds after a swing during which the next attack continues the combo
const BLEND_IN = 0.12;          // seconds to blend into an attack pose
const BLEND_OUT = 0.28;         // seconds to blend back out

const ROLL = {
  duration: 0.72,         // seconds, the whole roll including curling up and standing back up
  tuckIn: 0.12,           // seconds to curl into a ball
  spinStart: 0.12,        // the body is fully tucked by now, so the somersault begins
  spinEnd: 0.58,          // one full revolution is done; the character starts to stand up
  tuckOut: 0.14,          // seconds to uncurl (runs from duration - tuckOut to duration)
  distance: 3.2,          // metres travelled during the spin (delivered through hero.rollVelocity)
  drop: 0.4,              // how far the hips sink while curled, as a fraction of leg length
                          //   (raise it if the ball clips the ground, lower it if it floats)
  direction: 1,           // +1 = forward somersault, -1 = backwards (flip it if it goes the wrong way)
  iFrames: [0.08, 0.56],  // invulnerable window, in seconds into the roll
  cooldown: 0.25,         // seconds after a roll before the next one is allowed
  cancelsAttack: true,    // may a roll interrupt a sword swing?
};

// Each attack: keyframes of [x, y, z] rotations per bone. A bone missing from a key means "0" (rest).
// 'HIPS' is a translation instead: [x, y, z] in rig units (-Y = forward, +Z = up).
const ATTACKS = [
  {
    name: 'overhead chop',
    duration: 0.85,
    keys: [
      { t: 0.0 },
      { t: 0.25, pose: {
        'DEF-ARMR': [-2.5, 0.2, 0], 'DEF-FOREARMR': [-0.7, 0, 0], 'DEF-HANDR': [-0.5, 0, 0],
        'DEF-ARML': [-0.5, -0.2, 0],
        'DEF-SPINE': [-0.12, 0, -0.35], 'DEF-CHEST': [-0.1, 0, -0.35],
        'DEF-HEAD': [0.05, 0, 0.45], 'DEF-PELVIS': [0, 0, -0.15],
      } },
      { t: 0.42, pose: {
        'DEF-ARMR': [-0.7, -0.35, 0], 'DEF-FOREARMR': [-0.1, 0, 0], 'DEF-HANDR': [1.0, 0, 0],
        'DEF-ARML': [0.7, -0.5, 0],
        'DEF-SPINE': [0.22, 0, 0.35], 'DEF-CHEST': [0.2, 0, 0.35],
        'DEF-HEAD': [0, 0, -0.45], 'DEF-PELVIS': [0, 0, 0.2],
        HIPS: [0, -0.2, -0.1],
      } },
      { t: 0.55, pose: {
        'DEF-ARMR': [-0.55, -0.4, 0], 'DEF-FOREARMR': [-0.1, 0, 0], 'DEF-HANDR': [1.1, 0, 0],
        'DEF-ARML': [0.7, -0.5, 0],
        'DEF-SPINE': [0.25, 0, 0.38], 'DEF-CHEST': [0.22, 0, 0.38],
        'DEF-HEAD': [0, 0, -0.5], 'DEF-PELVIS': [0, 0, 0.22],
        HIPS: [0, -0.22, -0.1],
      } },
      { t: 0.85 },
    ],
  },
  {
    name: 'side sweep',
    duration: 0.8,
    keys: [
      { t: 0.0 },
      { t: 0.22, pose: {
        'DEF-ARMR': [-0.1, 1.3, 0], 'DEF-FOREARMR': [-0.3, 0, 0],
        'DEF-ARML': [-0.2, -0.3, 0],
        'DEF-SPINE': [0, 0, -0.35], 'DEF-CHEST': [0, 0, -0.35],
        'DEF-HEAD': [0, 0, 0.5], 'DEF-PELVIS': [0, 0, -0.2],
      } },
      { t: 0.38, pose: {
        'DEF-ARMR': [-1.4, -0.6, 0], 'DEF-FOREARMR': [-0.1, 0, 0], 'DEF-HANDR': [0.2, 0, 0],
        'DEF-ARML': [0.5, -0.2, 0],
        'DEF-SPINE': [0.08, 0, 0.4], 'DEF-CHEST': [0.08, 0, 0.4],
        'DEF-HEAD': [0, 0, -0.5], 'DEF-PELVIS': [0, 0, 0.25],
        HIPS: [0, -0.12, -0.06],
      } },
      { t: 0.5, pose: {
        'DEF-ARMR': [-1.3, -0.8, 0], 'DEF-FOREARMR': [-0.1, 0, 0], 'DEF-HANDR': [0.2, 0, 0],
        'DEF-ARML': [0.5, -0.2, 0],
        'DEF-SPINE': [0.08, 0, 0.45], 'DEF-CHEST': [0.08, 0, 0.45],
        'DEF-HEAD': [0, 0, -0.55], 'DEF-PELVIS': [0, 0, 0.28],
        HIPS: [0, -0.12, -0.06],
      } },
      { t: 0.8 },
    ],
  },
  {
    name: 'thrust',
    duration: 0.75,
    keys: [
      { t: 0.0 },
      { t: 0.25, pose: {
        'DEF-ARMR': [0.5, 0.3, 0], 'DEF-FOREARMR': [-1.3, 0, 0], 'DEF-HANDR': [0.3, 0, 0],
        'DEF-ARML': [-0.5, -0.3, 0],
        'DEF-SPINE': [-0.05, 0, -0.18], 'DEF-CHEST': [-0.05, 0, -0.18],
        'DEF-HEAD': [0, 0, 0.25], 'DEF-PELVIS': [0, 0, -0.1],
      } },
      { t: 0.4, pose: {
        'DEF-ARMR': [-1.35, 0, 0], 'DEF-FOREARMR': [-0.2, 0, 0], 'DEF-HANDR': [1.4, 0, 0],
        'DEF-ARML': [0.6, -0.4, 0],
        'DEF-SPINE': [0.1, 0, 0.13], 'DEF-CHEST': [0.1, 0, 0.13],
        'DEF-HEAD': [0, 0, -0.2], 'DEF-PELVIS': [0, 0, 0.1],
        HIPS: [0, -0.3, -0.05],
      } },
      { t: 0.52, pose: {
        'DEF-ARMR': [-1.35, 0, 0], 'DEF-FOREARMR': [-0.2, 0, 0], 'DEF-HANDR': [1.4, 0, 0],
        'DEF-ARML': [0.6, -0.4, 0],
        'DEF-SPINE': [0.1, 0, 0.13], 'DEF-CHEST': [0.1, 0, 0.13],
        'DEF-HEAD': [0, 0, -0.2], 'DEF-PELVIS': [0, 0, 0.1],
        HIPS: [0, -0.3, -0.05],
      } },
      { t: 0.75 },
    ],
  },
];

// Leg pose for a crouch of `a` radians: thighs forward, knees bent back twice as far, feet kept flat.
// The feet stay under the hips if the hips sink by legLength * (1 - cos a); with a leg length of
// about 3 rig units that is the HIPS z used below.
const crouch = (a) => ({
  'DEF-LEGL': [-a, 0, 0], 'DEF-LEGR': [-a, 0, 0],
  'DEF-SHINL': [2 * a, 0, 0], 'DEF-SHINR': [2 * a, 0, 0],
  'DEF-FOOTL': [-0.8 * a, 0, 0], 'DEF-FOOTR': [-0.8 * a, 0, 0],
});

// Secondary attack: a crouching whirlwind. Coil to the right, then spin a full turn to the left with
// the sword arm held out. The full turn can't be a keyframe (the blend-out would unwind it), so the
// `spin` field adds it on top of the keyed pose, outside the blend: 2π looks exactly like 0.
const WHIRLWIND_END = {
  ...crouch(0.35), HIPS: [0, -0.04, -0.18],
  'DEF-ARMR': [-0.1, 1.4, 0], 'DEF-FOREARMR': [-0.1, 0, 0],
  'DEF-ARML': [-0.1, -1.4, 0], 'DEF-FOREARML': [-0.1, 0, 0],
  'DEF-SPINE': [0.1, 0, 0.3], 'DEF-CHEST': [0.1, 0, 0.3],
  'DEF-HEAD': [0, 0, -0.35], 'DEF-PELVIS': [0, 0, 0.2],
};

const SECONDARY_ATTACK = {
  name: 'whirlwind',
  duration: 1.05,
  spin: { bone: 'DEF-PELVIS', from: 0.34, to: 0.68, angle: TAU },   // +Z = turn left
  keys: [
    { t: 0.0 },
    { t: 0.34, pose: {
      ...crouch(0.5), HIPS: [0, 0.04, -0.37],
      'DEF-ARMR': [-0.1, 1.4, 0], 'DEF-FOREARMR': [-0.1, 0, 0],
      'DEF-ARML': [-0.1, -1.4, 0], 'DEF-FOREARML': [-0.1, 0, 0],
      'DEF-SPINE': [0.1, 0, -0.35], 'DEF-CHEST': [0.1, 0, -0.35],
      'DEF-HEAD': [0.05, 0, 0.5], 'DEF-PELVIS': [0, 0, -0.5],
    } },
    { t: 0.68, pose: WHIRLWIND_END },
    { t: 0.8, pose: WHIRLWIND_END },
    { t: 1.05 },
  ],
};

// =========================
// SKELETON
// =========================

// Bone names are matched without the "_123" suffix and without dots, because GLTFLoader
// strips dots from node names ("DEF-LEG.L_5" -> "DEF-LEGL_5").
const boneKey = (name) => name.replace(/\./g, '').replace(/_\d+$/, '');

// child -> logical parent. The file stores all of these flat under ROOT, so we rebuild the hierarchy.
const PARENT = {
  'DEF-PELVIS': null,
  'DEF-SPINE': 'DEF-PELVIS',
  'DEF-CHEST': 'DEF-SPINE',
  'DEF-NECK': 'DEF-CHEST',
  'DEF-HEAD': 'DEF-NECK',
  'DEF-BACKPACK': 'DEF-CHEST',
  'DEF-BACKPACK_AXE': 'DEF-BACKPACK',
  'DEF-BELT': 'DEF-PELVIS',
  'DEF-SWORD-SHEET': 'DEF-BELT',
  'DEF-BAG01': 'DEF-BELT',
  'DEF-BAG02': 'DEF-BELT',
  'DEF-SWORD': 'DEF-HANDR',
};
for (const s of ['L', 'R']) {
  Object.assign(PARENT, {
    [`DEF-LEG${s}`]: 'DEF-PELVIS',
    [`DEF-SHIN${s}`]: `DEF-LEG${s}`,
    [`DEF-FOOT${s}`]: `DEF-SHIN${s}`,
    [`DEF-TOES${s}`]: `DEF-FOOT${s}`,
    [`DEF-SHOULDER${s}`]: 'DEF-CHEST',
    [`DEF-ARM${s}`]: `DEF-SHOULDER${s}`,
    [`DEF-FOREARM${s}`]: `DEF-ARM${s}`,
    [`DEF-HAND${s}`]: `DEF-FOREARM${s}`,
    [`DEF-FINGER01${s}`]: `DEF-HAND${s}`,
    [`DEF-FINGER02${s}`]: `DEF-HAND${s}`,
    [`DEF-FINGER03${s}`]: `DEF-HAND${s}`,
    [`DEF-THUMB${s}`]: `DEF-HAND${s}`,
    [`DEF-THUMB01${s}`]: `DEF-THUMB${s}`,
    [`DEF-THUMB02${s}`]: `DEF-THUMB01${s}`,
  });
}

// parents always before children
const ORDER = [];
{
  const seen = new Set();
  const visit = (k) => {
    if (seen.has(k)) return;
    if (PARENT[k]) visit(PARENT[k]);
    seen.add(k);
    ORDER.push(k);
  };
  Object.keys(PARENT).forEach(visit);
}

// The exported pose has the legs mid-stride (one back, one forward). Before animating we aim the
// legs and feet into a neutral standing pose. Directions are in rig space (-Y forward, +X left, +Z up).
const AIM = {};
for (const [s, sx] of [['L', 1], ['R', -1]]) {
  AIM[`DEF-LEG${s}`] = { child: `DEF-SHIN${s}`, dir: [sx * 0.05, -0.08, -1] };
  AIM[`DEF-SHIN${s}`] = { child: `DEF-FOOT${s}`, dir: [0, 0.08, -1] };
  AIM[`DEF-FOOT${s}`] = { child: `DEF-TOES${s}`, dir: [0, -0.8, -0.6] };
}

// =========================
// RIG (forward kinematics)
// =========================

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'XYZ');
const _v = new THREE.Vector3();
const _local = new THREE.Matrix4();

function buildRig(model) {
  model.updateMatrixWorld(true);

  const bones = {};
  model.traverse((o) => { if (o.isBone) bones[boneKey(o.name)] = o; });

  const root = bones.ROOT;
  if (!root) throw new Error('character.js: ROOT bone not found. Is this the adventurer model?');

  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const parts = [];
  const byKey = {};

  for (const key of ORDER) {
    const bone = bones[key];
    if (!bone) { console.warn(`character.js: bone "${key}" not found, skipping it`); continue; }

    const rest = new THREE.Matrix4().multiplyMatrices(invRoot, bone.matrixWorld); // rest pose in ROOT space
    const part = {
      key,
      bone,
      rest,
      pivot: new THREE.Vector3().setFromMatrixPosition(rest),
      // converts a ROOT-space pose back into this bone's local space
      toLocal: new THREE.Matrix4().copy(bone.parent.matrixWorld).invert().multiply(root.matrixWorld),
      parent: byKey[PARENT[key]] ?? null,
      aim: new THREE.Quaternion(),
      neutral: new THREE.Matrix4(),
      accum: new THREE.Matrix4(),
    };
    parts.push(part);
    byKey[key] = part;
  }

  // neutral stance: aim legs/feet at their target directions, parents first
  for (const p of parts) {
    const parentN = p.parent ? p.parent.neutral : null;
    const cfg = AIM[p.key];
    if (cfg && byKey[cfg.child]) {
      _v.copy(byKey[cfg.child].pivot).sub(p.pivot).normalize();
      if (parentN) _v.applyQuaternion(_q.setFromRotationMatrix(parentN));
      p.aim.setFromUnitVectors(_v, new THREE.Vector3(...cfg.dir).normalize());
    }
    p.neutral.copy(parentN ?? _m.identity());
    p.neutral.multiply(_m.makeTranslation(p.pivot.x, p.pivot.y, p.pivot.z));
    p.neutral.multiply(_m.makeRotationFromQuaternion(p.aim));
    p.neutral.multiply(_m.makeTranslation(-p.pivot.x, -p.pivot.y, -p.pivot.z));
  }

  // Straightening the legs makes them longer than the exported crouch, so lift the hips to keep
  // the feet on the ground. Measured from the left ankle, before vs after aiming.
  let groundLift = 0;
  let legLength = 3;
  if (byKey['DEF-FOOTL'] && byKey['DEF-SHINL'] && byKey['DEF-LEGL']) {
    const ankleNow = byKey['DEF-FOOTL'].pivot.z;
    const ankleNeutral = byKey['DEF-FOOTL'].pivot.clone().applyMatrix4(byKey['DEF-SHINL'].neutral).z;
    groundLift = ankleNow - ankleNeutral;
    legLength =
      byKey['DEF-LEGL'].pivot.distanceTo(byKey['DEF-SHINL'].pivot) +
      byKey['DEF-SHINL'].pivot.distanceTo(byKey['DEF-FOOTL'].pivot);
  }

  return { parts, groundLift: groundLift + GROUND_ADJUST, legLength };
}

// pose: { boneKey: [rx, ry, rz], HIPS: [x, y, z] }
function applyPose(rig, pose) {
  const hips = pose.HIPS;

  for (const p of rig.parts) {
    const C = p.accum;
    if (p.parent) C.copy(p.parent.accum); else C.identity();

    if (p.key === 'DEF-PELVIS') {
      C.multiply(_m.makeTranslation(
        hips ? hips[0] : 0,
        hips ? hips[1] : 0,
        (hips ? hips[2] : 0) + rig.groundLift,
      ));
    }

    // rotate about this bone's own joint, in rig axes, on top of the neutral aim
    const e = pose[p.key];
    _q.setFromEuler(_e.set(e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0, 'XYZ')).multiply(p.aim);
    C.multiply(_m.makeTranslation(p.pivot.x, p.pivot.y, p.pivot.z));
    C.multiply(_m.makeRotationFromQuaternion(_q));
    C.multiply(_m.makeTranslation(-p.pivot.x, -p.pivot.y, -p.pivot.z));

    _local.multiplyMatrices(C, p.rest).premultiply(p.toLocal);
    _local.decompose(p.bone.position, p.bone.quaternion, p.bone.scale);
  }
}

// =========================
// ANIMATION CLIPS
// =========================

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const ZERO = [0, 0, 0];

function add(pose, bone, x = 0, y = 0, z = 0) {
  const e = pose[bone] ?? (pose[bone] = [0, 0, 0]);
  e[0] += x; e[1] += y; e[2] += z;
}

// idle: breathing, a little head movement, and the sword hand fidgeting
function addIdle(pose, t, w) {
  if (w < 1e-3) return;
  const breathe = Math.sin(t * 1.9);
  add(pose, 'DEF-CHEST', 0.03 * breathe * w);
  add(pose, 'DEF-SPINE', 0.015 * breathe * w);
  add(pose, 'DEF-HEAD', -0.02 * breathe * w, 0, 0.09 * Math.sin(t * 0.45) * w);
  add(pose, 'DEF-ARML', 0.04 * Math.sin(t * 1.9 + 0.8) * w);
  add(pose, 'DEF-ARMR', 0.03 * Math.sin(t * 1.9 + 1.4) * w);
  add(pose, 'DEF-HANDR', 0.1 * Math.sin(t * 0.9) * w, 0, 0.12 * Math.sin(t * 0.7 + 1) * w);
  add(pose, 'HIPS', 0, 0, 0.02 * breathe * w);
}

// walk: k = 0..1 (how hard the stick is pushed)
function addWalk(pose, phase, k, legLength) {
  if (k < 1e-3) return;
  const W = WALK;
  const s = Math.sin(phase);

  for (const [side, ph] of [['L', phase], ['R', phase + Math.PI]]) {
    const sin = Math.sin(ph);
    const cos = Math.cos(ph);
    const thigh = -W.legSwing * sin * k;                       // negative = forward
    const knee = (W.knee * Math.max(0, cos) + 0.12) * k;       // bends while the leg swings forward
    add(pose, `DEF-LEG${side}`, thigh);
    add(pose, `DEF-SHIN${side}`, knee);
    add(pose, `DEF-FOOT${side}`, -0.8 * (thigh + knee));       // keep the foot roughly flat
  }

  // arms swing opposite to the legs
  const leftFwd = -s;   // left arm forward when the right leg is forward
  const rightFwd = s;
  add(pose, 'DEF-ARML', -W.armSwing * leftFwd * k);
  add(pose, 'DEF-FOREARML', -(0.15 + 0.3 * Math.max(0, leftFwd)) * k);
  add(pose, 'DEF-ARMR', -W.swordArmSwing * rightFwd * k);
  add(pose, 'DEF-FOREARMR', -(0.05 + 0.1 * Math.max(0, rightFwd)) * k);

  // pelvis and chest twist against each other, head stays level
  const P = W.hipTwist * k;
  const C = W.chestTwist * k;
  add(pose, 'DEF-PELVIS', 0, 0, -P * s);
  add(pose, 'DEF-SPINE', W.lean * 0.6 * k, 0, 0.5 * (P + C) * s);
  add(pose, 'DEF-CHEST', W.lean * 0.4 * k, 0, 0.5 * (P + C) * s);
  add(pose, 'DEF-HEAD', -W.lean * 0.5 * k, 0, -0.7 * C * s);

  // hips drop as the legs spread (keeps the planted foot on the ground)
  const spread = W.legSwing * k * Math.abs(s);
  add(pose, 'HIPS', 0, 0, -legLength * (1 - Math.cos(spread)));
}

// blend an attack keyframe sequence over the base pose
function overlayAttack(pose, atk) {
  const { def, t } = atk;
  const keys = def.keys;

  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = smooth((t - a.t) / (b.t - a.t));

  const w = smooth(t / BLEND_IN) * (1 - smooth((t - (def.duration - BLEND_OUT)) / BLEND_OUT));

  for (const bone of def.bones) {
    const pa = a.pose?.[bone] ?? ZERO;
    const pb = b.pose?.[bone] ?? ZERO;
    const base = pose[bone] ?? ZERO;
    pose[bone] = [
      lerp(base[0], lerp(pa[0], pb[0], u), w),
      lerp(base[1], lerp(pa[1], pb[1], u), w),
      lerp(base[2], lerp(pa[2], pb[2], u), w),
    ];
  }

  // extra whole turns (whirlwind): added after the blend so the blend-out can't unwind them
  if (def.spin) {
    const s = def.spin;
    add(pose, s.bone, 0, 0, s.angle * smooth((t - s.from) / (s.to - s.from)));
  }
}

// every bone any keyframe touches (so the attack fully takes over those bones)
for (const def of [...ATTACKS, SECONDARY_ATTACK]) {
  const set = new Set();
  for (const k of def.keys) for (const bone of Object.keys(k.pose ?? {})) set.add(bone);
  def.bones = [...set];
}

// ---- roll ----
// A tucked forward somersault. The pelvis spins one full turn about the left/right axis (positive X
// tips the head forward), and everything else curls up around it. Weighted by `tuck`, which ramps up
// at the start and back down at the end, so the walk/idle pose blends smoothly into and out of the ball.
const ROLL_TUCK = {
  'DEF-LEGL': [-1.7, 0, 0], 'DEF-LEGR': [-1.7, 0, 0],        // knees up to the chest
  'DEF-SHINL': [2.1, 0, 0], 'DEF-SHINR': [2.1, 0, 0],        // heels pulled in
  'DEF-FOOTL': [-0.3, 0, 0], 'DEF-FOOTR': [-0.3, 0, 0],
  'DEF-SPINE': [0.55, 0, 0], 'DEF-CHEST': [0.5, 0, 0],       // curl forward
  'DEF-HEAD': [0.5, 0, 0],                                   // chin down
  'DEF-ARML': [-1.0, -0.15, 0], 'DEF-FOREARML': [-1.5, 0, 0], // hug the knees
  'DEF-ARMR': [-1.0, 0.15, 0], 'DEF-FOREARMR': [-1.4, 0, 0],
  'DEF-PELVIS': [0, 0, 0],                                   // kill the walk twist; the spin is added below
};

const rollTuck = (t) =>
  smooth(t / ROLL.tuckIn) * (1 - smooth((t - (ROLL.duration - ROLL.tuckOut)) / ROLL.tuckOut));
const rollSpinProgress = (t) => clamp01((t - ROLL.spinStart) / (ROLL.spinEnd - ROLL.spinStart));
const rollEase = (p) => lerp(p, smooth(p), 0.5);   // a bit slower at the ends, mostly steady in the middle

function addRoll(pose, t, legLength) {
  const w = rollTuck(t);

  for (const bone in ROLL_TUCK) {
    const target = ROLL_TUCK[bone];
    const base = pose[bone] ?? ZERO;
    pose[bone] = [lerp(base[0], target[0], w), lerp(base[1], target[1], w), lerp(base[2], target[2], w)];
  }

  // the somersault itself; 2π looks identical to 0, so it never needs to be blended out
  add(pose, 'DEF-PELVIS', ROLL.direction * TAU * rollEase(rollSpinProgress(t)));

  // sink into the ball so the body spins around its middle instead of through the floor
  add(pose, 'HIPS', 0, 0, -legLength * ROLL.drop * w);
}

// =========================
// PUBLIC API
// =========================

export function createCharacter(model, { height = 1.8 } = {}) {
  const rig = buildRig(model);

  // never cull: skinned bounds are computed in bind space and can wrongly hide the mesh
  model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  const object = new THREE.Group();   // origin at the feet, faces +Z
  object.add(model);
  model.scale.setScalar(height / MODEL_HEIGHT);

  let time = 0;
  let phase = 0;
  let moveBlend = 0;

  let atk = null;
  let queued = null;        // 'primary' | 'secondary' | null: attack to chain when the current swing ends
  let comboIndex = 0;
  let comboTimer = 0;

  let rollState = null;     // { t } while rolling
  let rollCooldown = 0;
  let afterRoll = null;     // attack pressed late in a roll; starts when the roll ends
  const rollVelocity = new THREE.Vector3();

  function startAttack(kind = 'primary') {
    if (kind === 'secondary') {
      atk = { def: SECONDARY_ATTACK, t: 0 };
      comboIndex = 0;                                    // the heavy attack finishes the combo
    } else {
      atk = { def: ATTACKS[comboIndex % ATTACKS.length], t: 0 };
      comboIndex = (comboIndex + 1) % ATTACKS.length;
    }
  }

  function requestAttack(kind) {
    if (rollState) {
      if (rollState.t > ROLL.duration * 0.5) afterRoll = kind;   // pressed late in a roll: buffer it
      return;
    }
    if (!atk) { startAttack(kind); return; }
    if (atk.t > atk.def.duration * 0.4) queued = kind;   // pressed late in a swing: chain the next one
  }

  function attack() { requestAttack('primary'); }
  function secondaryAttack() { requestAttack('secondary'); }

  // Start a dodge roll. `heading` (radians, same convention as update) picks the direction;
  // without it the character rolls the way it is facing. Returns false if it can't roll right now.
  function roll(heading) {
    if (rollState || rollCooldown > 0) return false;
    if (atk && !ROLL.cancelsAttack) return false;
    atk = null; queued = null; afterRoll = null;
    comboIndex = 0; comboTimer = 0;
    if (heading !== undefined) object.rotation.y = heading;
    rollState = { t: 0 };
    return true;
  }

  function update(dt, speed = 0, heading) {
    time += dt;
    rollCooldown = Math.max(0, rollCooldown - dt);
    rollVelocity.set(0, 0, 0);

    const target = clamp01(speed);
    moveBlend += (target - moveBlend) * (1 - Math.exp(-10 * dt));
    phase += dt * TAU * WALK.strideHz * (0.6 + 0.4 * moveBlend);

    // turn toward the direction of travel (a roll keeps the direction it started in)
    if (!rollState && heading !== undefined && target > 0.05) {
      const d = Math.atan2(Math.sin(heading - object.rotation.y), Math.cos(heading - object.rotation.y));
      object.rotation.y += d * (1 - Math.exp(-14 * dt));
    }

    // roll state
    if (rollState) {
      const t0 = rollState.t;
      rollState.t = Math.min(t0 + dt, ROLL.duration);
      if (dt > 0) {
        // exact distance covered this frame, so it adds up to ROLL.distance at any frame rate
        const step = ROLL.distance * (rollEase(rollSpinProgress(rollState.t)) - rollEase(rollSpinProgress(t0)));
        const ry = object.rotation.y;
        rollVelocity.set(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(step / dt);
      }
      if (rollState.t >= ROLL.duration) {
        rollState = null;
        rollCooldown = ROLL.cooldown;
        if (afterRoll) { const k = afterRoll; afterRoll = null; startAttack(k); }
      }
    }

    // attack state
    if (atk) {
      atk.t += dt;
      if (atk.t >= atk.def.duration) {
        atk = null;
        comboTimer = COMBO_WINDOW;
        if (queued) { const k = queued; queued = null; startAttack(k); }
      }
    } else {
      comboTimer -= dt;
      if (comboTimer <= 0) comboIndex = 0;
    }

    const pose = {};
    addIdle(pose, time, 1 - moveBlend);
    addWalk(pose, phase, moveBlend, rig.legLength);
    if (atk) overlayAttack(pose, atk);
    if (rollState) addRoll(pose, rollState.t, rig.legLength);
    applyPose(rig, pose);
  }

  update(0, 0);   // start in the neutral stance

  return {
    object,
    update,
    attack,
    secondaryAttack,
    roll,
    rollVelocity,   // move your player by this each frame: player.position.addScaledVector(hero.rollVelocity, dt)
    get attacking() { return atk !== null; },
    get rolling() { return rollState !== null; },
    get invulnerable() {
      return rollState !== null && rollState.t >= ROLL.iFrames[0] && rollState.t <= ROLL.iFrames[1];
    },
  };
}

export async function loadCharacter(url, options) {
  const gltf = await new GLTFLoader().loadAsync(url);
  return createCharacter(gltf.scene, options);
}
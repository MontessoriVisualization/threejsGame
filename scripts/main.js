
import * as THREE from 'three';

import {
  input,
  consumeLook,
  consumeActions,
} from './controls.js';

import { loadCharacter } from './character.js';
import { loadMob } from './mob.js';
import { loadMap } from './map.js';

// =========================
// SCENE
// =========================

const scene = new THREE.Scene();


// =========================
// CAMERA + RENDERER
// =========================

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

document.body.appendChild(renderer.domElement);

// =========================
// LIGHTING
// =========================

scene.add(
  new THREE.AmbientLight(0xffffff, 2.0)
);

scene.add(
  new THREE.HemisphereLight(
    0xffffff,
    0x888899,
    2.0
  )
);

const sun = new THREE.DirectionalLight(0xffffff, 3.0);
sun.position.set(50, 100, 50);
scene.add(sun);

// =========================
// MAP
// =========================

let buildingBoxes = [];

loadMap(scene)
  .then((result) => {
    buildingBoxes = result.buildingBoxes;

    console.log('Map and collision data ready.');
    console.log('Total colliders:', buildingBoxes.length);
  })
  .catch((error) => {
    console.error('Failed to load map:', error);
  });

// =========================
// PLAYER
// =========================

const PLAYER_SIZE = new THREE.Vector3(1, 1, 1);

const player = new THREE.Group();

// Player position represents the center of its collision body.
player.position.set(0, 0.5, 0);
scene.add(player);

// Temporary box while the character loads.
const placeholder = new THREE.Mesh(
  new THREE.BoxGeometry(
    PLAYER_SIZE.x,
    PLAYER_SIZE.y,
    PLAYER_SIZE.z
  ),
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
  })
);

player.add(placeholder);

let character = null;

// Load the playable character.
loadCharacter('/models/adventurer/scene.gltf', {
  height: 1.8,
})
  .then((c) => {
    character = c;

    // The character's origin is at its feet.
    c.object.position.y = -PLAYER_SIZE.y / 2;

    player.remove(placeholder);
    player.add(c.object);
  })
  .catch((error) => {
    console.error(
      'Could not load the character; keeping the box:',
      error
    );
  });

// =========================
// ADDITIONAL MOB
// =========================

loadMob('/SISTER/scene.gltf', {
  height: 1.8,
})
  .then((mob) => {
    mob.object.position.set(5, 0, 5);
    scene.add(mob.object);
  })
  .catch((error) => {
    console.error('Failed to load mob:', error);
  });

// =========================
// COLLISION + MOVEMENT
// =========================

const playerBox = new THREE.Box3();

function hitsBuilding() {
  playerBox.setFromCenterAndSize(
    player.position,
    PLAYER_SIZE
  );

  return buildingBoxes.some((box) =>
    playerBox.intersectsBox(box)
  );
}

// Test each axis separately.
// This allows the player to slide along walls.
function move(dx, dz) {
  player.position.x += dx;

  if (hitsBuilding()) {
    player.position.x -= dx;
  }

  player.position.z += dz;

  if (hitsBuilding()) {
    player.position.z -= dz;
  }
}

// =========================
// CAMERA CONTROL
// =========================

const CAM_DISTANCE = Math.hypot(2, 2);

const PITCH_MIN = 0.1;
const PITCH_MAX = 1.4;

let camYaw = 0;
let camPitch = Math.atan2(4, 5);

function updateCamera() {
  const cosP = Math.cos(camPitch);

  camera.position.set(
    player.position.x +
      Math.sin(camYaw) * cosP * CAM_DISTANCE,

    player.position.y +
      Math.sin(camPitch) * CAM_DISTANCE,

    player.position.z +
      Math.cos(camYaw) * cosP * CAM_DISTANCE
  );

  camera.lookAt(player.position);
}

// =========================
// ANIMATION + GAME LOOP
// =========================

const SPEED = 6;
const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);

  // Camera look: mouse or right stick.
  const { yaw, pitch } = consumeLook(dt);

  camYaw -= yaw;

  camPitch = Math.max(
    PITCH_MIN,
    Math.min(PITCH_MAX, camPitch + pitch)
  );

  // Movement: keyboard, on-screen controls, or gamepad.
  let ix = input.x;
  let iz = input.z;

  const len = Math.hypot(ix, iz);

  // Prevent faster diagonal movement.
  if (len > 1) {
    ix /= len;
    iz /= len;
  }

  let heading;
  let dx = 0;
  let dz = 0;

  if (len > 0) {
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);

    dx = ix * cos + iz * sin;
    dz = -ix * sin + iz * cos;

    // Character faces +Z.
    heading = Math.atan2(dx, dz);
  }

  // Read actions every frame.
  const actions = consumeActions();

  if (character) {
    // Roll first so it can cancel an attack.
    if (actions.roll) {
      character.roll(heading);
    }

    if (actions.secondary) {
      character.secondaryAttack();
    }

    if (actions.attack) {
      character.attack();
    }
  }

  // Walking pauses while rolling.
  const rolling = character
    ? character.rolling
    : false;

  if (len > 0 && !rolling) {
    move(
      dx * SPEED * dt,
      dz * SPEED * dt
    );
  }

  if (character) {
    character.update(
      dt,
      rolling ? 0 : Math.min(len, 1),
      heading
    );

    // Apply roll movement through collision checks.
    const velocity = character.rollVelocity;

    if (velocity.x !== 0 || velocity.z !== 0) {
      move(
        velocity.x * dt,
        velocity.z * dt
      );
    }
  }

  updateCamera();
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

// =========================
// RESIZE
// =========================

window.addEventListener('resize', () => {
  camera.aspect =
    window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );
});

export { player };
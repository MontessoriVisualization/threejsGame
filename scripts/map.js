
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function loadMap(scene) {
  const loader = new GLTFLoader();

  console.log('Loading map...');

  const gltf = await loader.loadAsync('/map/scene.gltf');
  const map = gltf.scene;

  // Keep the visual map separate from collision detection.
  map.traverse((object) => {
    if (!object.isMesh) return;

    object.frustumCulled = false;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  scene.add(map);
  scene.updateMatrixWorld(true);

  // Measure the imported model.
  const originalBounds = new THREE.Box3().setFromObject(map);

  if (originalBounds.isEmpty()) {
    throw new Error('The map contains no geometry.');
  }

  const originalSize = originalBounds.getSize(
    new THREE.Vector3()
  );

  console.log('Original map size:', originalSize);

  // Scale the map so its largest dimension is 150 units.
  const largestDimension = Math.max(
    originalSize.x,
    originalSize.y,
    originalSize.z
  );

  if (largestDimension <= 0) {
    throw new Error('Invalid map dimensions.');
  }

  const TARGET_SIZE = 150;
  const scale = TARGET_SIZE / largestDimension;

  map.scale.multiplyScalar(scale);
  scene.updateMatrixWorld(true);

  // Calculate bounds after scaling.
  const bounds = new THREE.Box3().setFromObject(map);
  const center = bounds.getCenter(new THREE.Vector3());

  // Center the map horizontally.
  map.position.x -= center.x;
  map.position.z -= center.z;

  // Preserve your 2.8-unit floor adjustment.
  map.position.y -= bounds.min.y + 2.8;

  scene.updateMatrixWorld(true);

  // =========================
  // COLLISION OBJECTS
  // =========================

  const buildingBoxes = [];
  const colliderPattern = /(collider|collision|blocker)/i;

  function hasColliderName(object) {
    let current = object;

    // A collider can be a parent group containing a mesh.
    while (current && current !== map.parent) {
      if (colliderPattern.test(current.name)) {
        return true;
      }

      current = current.parent;
    }

    return false;
  }

  map.traverse((object) => {
    if (!object.isMesh) return;

    // Ordinary visual meshes do not block the player.
    if (!hasColliderName(object)) return;

    const box = new THREE.Box3().setFromObject(object);

    if (box.isEmpty()) return;

    buildingBoxes.push(box.clone());

    // Hide collision-only geometry.
    object.visible = false;

    console.log('Collider found:', object.name);
  });

  console.log('Map loaded successfully.');
  console.log('Collision boxes:', buildingBoxes.length);

  if (buildingBoxes.length === 0) {
    console.warn(
      'No colliders found. The player can move freely until collider meshes are added.'
    );
  }

  return {
    map,
    buildingBoxes,
  };
}
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function loadMob(url, options) {
  const gltf = await new GLTFLoader().loadAsync(url);
  return createCharacter(gltf.scene, options);
}

export function createCharacter(model, { height = 1.8 } = {}) {
  const MODEL_HEIGHT = 1.8;

  model.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });

  const object = new THREE.Group();
  object.add(model);
  model.scale.setScalar(height / MODEL_HEIGHT);

  return { object };
}
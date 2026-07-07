import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/GLTFLoader.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 10, 100);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 200);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const overlay = document.getElementById('overlay');
const scoreEl = document.getElementById('score');
const remainingEl = document.getElementById('remaining');
const statusEl = document.getElementById('status');
const restartBtn = document.getElementById('restart');

// =========================================================================
//  אלמנטי ממשק חדשים (HUD) - נוצרים אוטומטית ב-JS עבור טיימר ושיא
// =========================================================================
const timerContainer = document.createElement('div');
timerContainer.style.position = 'absolute';
timerContainer.style.top = '20px';
timerContainer.style.left = '20px';
timerContainer.style.background = 'rgba(22, 27, 34, 0.85)';
timerContainer.style.border = '1px solid #30363d';
timerContainer.style.color = '#c9d1d9';
timerContainer.style.padding = '15px';
timerContainer.style.borderRadius = '10px';
timerContainer.style.fontFamily = 'sans-serif';
timerContainer.style.fontSize = '16px';
timerContainer.style.direction = 'rtl';
timerContainer.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
timerContainer.innerHTML = `
  <div style="margin-bottom: 5px;">⏱️ זמן נוכחי: <span id="liveTimer" style="color: #58a6ff; font-weight: bold;">0:00</span></div>
  <div style="margin-bottom: 8px;">🏆 שיא אישי (הכי מהיר): <span id="bestTimer" style="color: #7ee787; font-weight: bold;">--</span></div>
  <div style="font-size: 12px; color: #ff7b72; font-weight: bold; border-top: 1px solid #30363d; padding-top: 5px;">⚠️ צריך לאסוף את כל המטבעות כדי לנצח!</div>
`;
document.body.appendChild(timerContainer);

// טעינת שיא אישי מתוך ה-localStorage של הדפדפן
const savedBest = localStorage.getItem('3d_platformer_best_time');
let bestTime = savedBest ? parseFloat(savedBest) : Infinity;
if (savedBest) {
  document.getElementById('bestTimer').textContent = formatTime(bestTime);
}

const ambientLight = new THREE.HemisphereLight(0x88b8ff, 0x20294b, 0.8);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1);
sunLight.position.set(5, 12, 6);
sunLight.castShadow = true;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 30;
sunLight.shadow.mapSize.set(2048, 2048);
scene.add(sunLight);


let playerEyeHeight = 1.7;
let playerRadius = 3.6;
let playerVelocity = new THREE.Vector3();
let isGrounded = false;
let mixer = null;
const actions = {};
let currentAction = null;
let skeletonHelper = null;
const gravity = -30;

const player = new THREE.Group();
player.position.set(4, 2.5, -5);
scene.add(player);
const startPlatformY = 1.8;


const loader = new GLTFLoader();
const playerModelUrl = new URL('./player.glb', import.meta.url).href;
loader.load(playerModelUrl, (gltf) => {
  const model = gltf.scene; 
  const skinnedMeshes = [];
  
  model.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.material) node.material.side = THREE.DoubleSide;
    }
    if (node.isSkinnedMesh) {
      skinnedMeshes.push(node);
    }
  });

  const bbox = new THREE.Box3().setFromObject(model);
  const size = bbox.getSize(new THREE.Vector3());
  
  let scale = size.y > 0 ? 0.055 / size.y : 1;
  model.scale.setScalar(scale);
  model.visible = true;
  
  model.position.y -= bbox.min.y * scale;
  model.position.y += 0.03;
  model.rotation.y = Math.PI;
  player.add(model);

  model.updateMatrixWorld(true);
  player.updateMatrixWorld(true);
  const modelBbox = new THREE.Box3().setFromObject(model);
  const modelSize = modelBbox.getSize(new THREE.Vector3());
  const playerBbox = new THREE.Box3().setFromObject(player);
  const playerBottom = playerBbox.min.y - player.position.y;
  
  playerRadius = Math.max(modelSize.x, modelSize.z) / 2;
  playerEyeHeight = modelSize.y * 0.6;
  playerSize.copy(modelSize);
  playerBottomOffset = playerBottom;
  playerReady = true;
  player.position.y = startPlatformY - playerBottomOffset + 0.15;
  playerVelocity.y = 0;
  isGrounded = true;
  prevPlayerBottom = player.position.y + playerBottomOffset;
  statusEl.textContent = `מודל נטען — גודל פיזי: ${modelSize.x.toFixed(2)} x ${modelSize.y.toFixed(2)} x ${modelSize.z.toFixed(2)}; hitbox radius set to ${playerRadius.toFixed(2)}`;

  if (skinnedMeshes.length > 0) {
    skeletonHelper = new THREE.SkeletonHelper(model);
    skeletonHelper.material.linewidth = 2;
    skeletonHelper.material.color.set(0xff0000);
    scene.add(skeletonHelper);
    statusEl.textContent = 'מודל נטען בהצלחה עם שלד ריג/SkinnedMesh';
  } else {
    statusEl.textContent = 'מודל נטען, אך לא נמצא שלד ריג (SkinnedMesh)';
  }

  const animations = gltf.animations || [];
  if (animations.length > 0) {
    mixer = new THREE.AnimationMixer(model);
    const walkClip = animations.find((clip) => /walk|run/i.test(clip.name));
    const jumpClip = animations.find((clip) => /jump/i.test(clip.name));
    const idleClip = animations.find((clip) => /idle|stand/i.test(clip.name));
    const defaultClip = animations[0];

    const createAction = (clip) => {
      if (!clip || !mixer) return null;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveTimeScale(1);
      action.setEffectiveWeight(0);
      action.play();
      return action;
    };

    actions.walk = createAction(walkClip || defaultClip);
    actions.idle = createAction(idleClip || defaultClip);
    actions.jump = jumpClip ? createAction(jumpClip) : actions.walk;

    if (actions.walk) actions.walk.loop = THREE.LoopRepeat;
    if (actions.idle) actions.idle.loop = THREE.LoopRepeat;
    if (actions.jump && jumpClip) {
      actions.jump.loop = THREE.LoopOnce;
      actions.jump.clampWhenFinished = true;
    }

    playAction('idle');
    statusEl.textContent += ` אנימציות: ${animations.map((c) => c.name || 'unnamed').join(', ')}`;
    if (!walkClip) {
      statusEl.textContent += ' (לא נמצאה אנימציית הליכה, ישתמש בקליפ הראשון במקום)';
    }
    if (!jumpClip) {
      statusEl.textContent += ' (לא נמצאה אנימציית קפיצה, ישתמש בקליפ ההליכה במקום)';
    }
  } else if (!skinnedMeshes.length) {
    statusEl.textContent = 'מודל נטען אך לא נמצאו אנימציות ו/או שלד ב-GLB';
  }
}, undefined, (error) => {
  console.error('Error loading player model (url:', playerModelUrl, '):', error);
  statusEl.textContent = `לא ניתן לטעון את מודל השחקן (${playerModelUrl}). בדוק שהקובץ קיים והנתיב יחסית ל-\`script.js\` - GitHub Pages רגיש לנתיבים. שגיאה: ${error && error.message ? error.message : error}`;
});

const collectibles = [];
const collectibleMaterial = new THREE.MeshStandardMaterial({ color: 0xffd35c, emissive: 0x4f3d00, roughness: 0.3, flatShading: true });

const textureLoader = new THREE.TextureLoader();
const topTexture = textureLoader.load('https://threejs.org/examples/textures/terrain/grasslight-big.jpg');
topTexture.magFilter = THREE.NearestFilter;
topTexture.minFilter = THREE.NearestMipMapNearestFilter;

const sideTexture = textureLoader.load('https://threejs.org/examples/textures/brick_diffuse.jpg');
sideTexture.magFilter = THREE.NearestFilter;
sideTexture.minFilter = THREE.NearestMipMapNearestFilter;

const blockMaterials = [
  new THREE.MeshStandardMaterial({ map: sideTexture, flatShading: true }),
  new THREE.MeshStandardMaterial({ map: sideTexture, flatShading: true }),
  new THREE.MeshStandardMaterial({ map: topTexture, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x8b5a2b, flatShading: true }),
  new THREE.MeshStandardMaterial({ map: sideTexture, flatShading: true }),
  new THREE.MeshStandardMaterial({ map: sideTexture, flatShading: true })
];

const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
const platforms = [];
const obstacles = [];
const ladders = [];
const _platformBox = new THREE.Box3();
const playerBox = new THREE.Box3();
const tempBox = new THREE.Box3();
const playerSize = new THREE.Vector3(1, 2, 1);
let playerReady = false;
let fallStartY = null;
let isFalling = false;
let prevPlatformUnder = null;
let prevPlayerBottom = null;
let playerBottomOffset = 0;
let runStartTime = null;
let hasStartedMoving = false;
let goalReached = false;
let goalPlatform = null;

// משתנים ייעודיים עבור השער החוסם (הקיר)
let gateMesh = null;
let gateClosed = true;

function createCollectible(x, z, y = 0.8, parentPlatform = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.1), collectibleMaterial);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.userData = { 
    collected: false, 
    bobOffset: Math.random() * Math.PI * 2, 
    baseY: y,
    parentPlatform: parentPlatform 
  };
  scene.add(mesh);
  collectibles.push(mesh);
}

function createPlatform(x, z, y, width, depth, options = {}) {
  if (x === undefined) return null; 
  
  const cols = Math.max(1, Math.round(width));
  const rows = Math.max(1, Math.round(depth));
  const platformGroup = new THREE.Group();

  for (let ix = 0; ix < cols; ix += 1) {
    for (let iz = 0; iz < rows; iz += 1) {
      const block = new THREE.Mesh(blockGeometry, blockMaterials);
      block.position.set(
        x - (cols - 1) / 2 + ix,
        y - 0.5,
        z - (rows - 1) / 2 + iz
      );
      block.castShadow = true;
      block.receiveShadow = true;
      platformGroup.add(block);
    }
  }

  scene.add(platformGroup);
  const platformData = {
    x,
    z,
    y,
    width: cols,
    depth: rows,
    group: platformGroup,
    moving: options.moving ? {
      axis: options.moving.axis,
      distance: options.moving.distance,
      speed: options.moving.speed,
      baseX: x,
      baseY: y,
      baseZ: z,
      dir: options.moving.dir || 1
    } : null,
    type: options.type || null
  };

  platforms.push(platformData);
  return platformData;
}

function createObstacle(x, z, y, type = 'spike') {
  const geom = new THREE.ConeGeometry(0.5, 1, 6);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b0000 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y + 0.5, z);
  mesh.rotation.x = Math.PI;
  mesh.userData = { deadly: true, type };
  mesh.castShadow = true;
  scene.add(mesh);
  obstacles.push(mesh);
}

function createLadder(x, z, y, height = 4) {
  const geom = new THREE.BoxGeometry(0.4, height, 0.4);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y + height / 2, z);
  mesh.userData = { ladder: true, height };
  mesh.castShadow = true;
  scene.add(mesh);
  ladders.push({ x, z, y, height, mesh });
}


function createGoalPlatform(x, z, y, width, depth) {
  const goalMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x228b22, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x228b22, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x7fff00, flatShading: true }), // חלק עליון ירוק בהיר זוהר
    new THREE.MeshStandardMaterial({ color: 0x228b22, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x228b22, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x228b22, flatShading: true })
  ];
  const cols = Math.max(1, Math.round(width));
  const rows = Math.max(1, Math.round(depth));
  const platformGroup = new THREE.Group();

  for (let ix = 0; ix < cols; ix += 1) {
    for (let iz = 0; iz < rows; iz += 1) {
      const block = new THREE.Mesh(blockGeometry, goalMaterials);
      block.position.set(
        x - (cols - 1) / 2 + ix,
        y - 0.5,
        z - (rows - 1) / 2 + iz
      );
      block.castShadow = true;
      block.receiveShadow = true;
      platformGroup.add(block);
    }
  }

  scene.add(platformGroup);
  const platformData = {
    x,
    z,
    y,
    width: cols,
    depth: rows,
    group: platformGroup,
    moving: null,
    type: 'goal'
  };
  goalPlatform = platformData;
  platforms.push(platformData);
}

// פונקציה חדשה ליצירת קיר/שער פיזי אדום וחוסם
function createGate(x, z, y, width, height) {
  const geom = new THREE.BoxGeometry(width, height, 0.4);
  const mat = new THREE.MeshStandardMaterial({ 
    color: 0xff3333, 
    transparent: true, 
    opacity: 0.75, 
    roughness: 0.2 
  });
  gateMesh = new THREE.Mesh(geom, mat);
  gateMesh.position.set(x, y + height / 2, z);
  gateMesh.castShadow = true;
  gateMesh.receiveShadow = true;
  scene.add(gateMesh);
}

function updatePlayerBox() {
  if (playerReady) {
    playerBox.min.set(
      player.position.x - playerSize.x / 2,
      player.position.y + playerBottomOffset,
      player.position.z - playerSize.z / 2
    );
    playerBox.max.set(
      player.position.x + playerSize.x / 2,
      player.position.y + playerBottomOffset + playerSize.y,
      player.position.z + playerSize.z / 2
    );
  } else {
    playerBox.setFromObject(player);
  }
}

function getPlatformUnder() {
  updatePlayerBox();
  return platforms.find((platform) => {
    _platformBox.setFromObject(platform.group);
    const min = _platformBox.min;
    const max = _platformBox.max;
    const insideX = playerBox.max.x >= min.x - 0.01 && playerBox.min.x <= max.x + 0.01;
    const insideZ = playerBox.max.z >= min.z - 0.01 && playerBox.min.z <= max.z + 0.01;
    const playerBottom = playerBox.min.y;
    const verticalOK = playerBottom >= max.y - 0.01 - 0.3 && playerBottom <= max.y + 0.6;
    return insideX && insideZ && verticalOK;
  });
}

function findPlatformBetween(prevBottom, currentBottom) {
  if (currentBottom >= prevBottom) return null;
  updatePlayerBox();
  const candidates = platforms.filter((platform) => {
    _platformBox.setFromObject(platform.group);
    const min = _platformBox.min;
    const max = _platformBox.max;
    const insideX = playerBox.max.x >= min.x - 0.01 && playerBox.min.x <= max.x + 0.01;
    const insideZ = playerBox.max.z >= min.z - 0.01 && playerBox.min.z <= max.z + 0.01;
    const topY = max.y;
    return insideX && insideZ && topY <= prevBottom && topY >= currentBottom;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const ba = (_platformBox.setFromObject(a.group), _platformBox.max.y);
    const bb = (_platformBox.setFromObject(b.group), _platformBox.max.y);
    return bb - ba;
  });
  return candidates[0];
}

function updateMovingPlatforms(delta) {
  updatePlayerBox();
  platforms.forEach((platform) => {
    if (!platform.moving) return;
    const move = platform.moving.speed * delta * platform.moving.dir;
    const previousX = platform.x;
    const previousY = platform.y;
    const previousZ = platform.z;

    if (platform.moving.axis === 'x') {
      platform.x += move;
      platform.group.position.x += move;
      if (platform.x > platform.moving.baseX + platform.moving.distance) {
        platform.x = platform.moving.baseX + platform.moving.distance;
        platform.group.position.x = platform.x - platform.moving.baseX;
        platform.moving.dir = -1;
      } else if (platform.x < platform.moving.baseX - platform.moving.distance) {
        platform.x = platform.moving.baseX - platform.moving.distance;
        platform.group.position.x = platform.x - platform.moving.baseX;
        platform.moving.dir = 1;
      }
    } 
    else if (platform.moving.axis === 'y') {
      platform.y += move;
      platform.group.position.y += move;
      if (platform.y > platform.moving.baseY + platform.moving.distance) {
        platform.y = platform.moving.baseY + platform.moving.distance;
        platform.group.position.y = platform.y - platform.moving.baseY;
        platform.moving.dir = -1;
      } else if (platform.y < platform.moving.baseY - platform.moving.distance) {
        platform.y = platform.moving.baseY - platform.moving.distance;
        platform.group.position.y = platform.y - platform.moving.baseY;
        platform.moving.dir = 1;
      }
    }
    else {
      platform.z += move;
      platform.group.position.z += move;
      if (platform.z > platform.moving.baseZ + platform.moving.distance) {
        platform.z = platform.moving.baseZ + platform.moving.distance;
        platform.group.position.z = platform.z - platform.moving.baseZ;
        platform.moving.dir = -1;
      } else if (platform.z < platform.moving.baseZ - platform.moving.distance) {
        platform.z = platform.moving.baseZ - platform.moving.distance;
        platform.group.position.z = platform.z - platform.moving.baseZ;
        platform.moving.dir = 1;
      }
    }

    const dx = platform.x - previousX;
    const dy = platform.y - previousY;
    const dz = platform.z - previousZ;

    _platformBox.setFromObject(platform.group);
    const min = _platformBox.min;
    const max = _platformBox.max;
    const playerBottom = playerBox.min.y;
    const onPlatform = playerBox.max.x >= min.x - 0.01 && playerBox.min.x <= max.x + 0.01;
    const insideZ = playerBox.max.z >= min.z - 0.01 && playerBox.min.z <= max.z + 0.01;
    
    const onPlatformFinal = onPlatform && insideZ && playerBottom >= (max.y - dy) - 0.05 - 0.3 && playerBottom <= (max.y - dy) + 0.6;

    if (onPlatformFinal && !goalReached) {
      player.position.x += dx;
      player.position.z += dz;
      
      if (platform.moving.axis === 'y') {
        player.position.y = platform.y - playerBottomOffset;
        playerVelocity.y = 0;
        isGrounded = true;
      }
    }
  });
}

// יצירת פלטפורמות ומטבעות
createPlatform(4, -5, 1.8, 3.2, 3.2);
createCollectible(4, -5, 2.3);
createPlatform(2, -3, 3.4, 2.6, 2.6, { moving: { axis: 'x', distance: 3, speed: 1.2 } }); 
createCollectible(2, -3, 3.9 );
createPlatform(0, -1, 4.8, 2.4, 2.4);
createCollectible(0, -1, 5.3);
createPlatform(1.5, 1.5, 6.2, 2.2, 2.2, { moving: { axis: 'z', distance: 3, speed: 1.5 } }); 
createCollectible(1.5, 1.5, 6.7);
createPlatform(-1, 3.5, 7.6, 2.0, 2.0);
createCollectible(-1, 3.5, 8.1);
createPlatform(-1.5, 6, 9, 2.4, 2.4, { moving: { axis: 'x', distance: 3, speed: 1.0 } }); 
createCollectible(-1.5, 6, 8.7);
createPlatform(0, 8.5, 10.6, 1.6, 1.6);
createCollectible(0, 8.5, 11.3);
createPlatform(1.5, 11, 12.4, 1.6, 1.6, { moving: { axis: 'z', distance: 3, speed: 1.2 } });
createCollectible(1.5, 11, 13.2);
createPlatform(0.3, 12, 13.5, 1.2, 1.2, { type: 'bounce' });
createCollectible(0.3, 12, 14.0);
createPlatform(-0.5, 13, 14.8, 1.8, 1.8);
createCollectible(-0.5, 13, 15.3);
createPlatform(-3, 17, 15.4, 1.8, 1.8);
createCollectible(-3, 17, 15.7);
createPlatform(-7, 20, 10, 1.8, 1.8);
createCollectible(-7, 20, 10.3);
createPlatform(-7, 16, 10, 1.8, 1.8);
createCollectible(-7, 16, 10.3);
createPlatform(-12, 20, 10, 1.8, 1.8);
createCollectible(-12, 20, 10.3);
createPlatform(-16, 20, 28, 1.8, 1.8);
createCollectible(-16, 20, 28,3);
createPlatform(-16, 15, 29, 1.8, 1.8);
createCollectible(-16, 15, 29,3);
createPlatform(-17, 10, 30, 1.8, 1.8);
createCollectible(-17, 10, 30,3);
createPlatform(-19, 7, 31, 1.8, 1.8);
createCollectible(-19, 7, 31,3);

createPlatform(-21, 0, 32, 1.6, 1.6, { moving: { axis: 'z', distance: 5, speed: 1.2 } });
createCollectible(-21, 0, 32.3);
createPlatform(-18.4, -8, 33, 1.8, 1.8);
createCollectible(-18.5, -8, 33,3);

const verticalPlatform = createPlatform(-16, 22, 20, 1.6, 1.6, { moving: { axis: 'y', distance: 10, speed: 3 } });
createCollectible(-16, 22, 20, verticalPlatform);

// -------------------------------------------------------------------------
// שדרוג מפת המשחק: הוספת משטח יעד (Goal) ושער חוסם (Gate) מיד לאחר הפלטפורמה האחרונה
// -------------------------------------------------------------------------
createGoalPlatform(-18, -16, 31, 4, 4); // פלטפורמת יעד ירוקה
createGate(-18, -13, 31, 4, 4);        // השער האדום החוסם לפניה בציר ה-Z


isGrounded = !!getPlatformUnder();
remainingEl.textContent = collectibles.length;

const keys = { w: false, a: false, s: false, d: false, space: false, arrowup: false, arrowdown: false, arrowleft: false, arrowright: false };
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  const controlKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  if (keys[key] !== undefined) keys[key] = true;
  if (event.code === 'Space') keys.space = true;
  if (controlKeys.includes(key) || event.code === 'Space') event.preventDefault();
});
window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();
  if (keys[key] !== undefined) keys[key] = false;
  if (event.code === 'Space') keys.space = false;
});

const cameraState = {
  yaw: 0,
  pitch: Math.PI / 6,
  distance: 12,
  dragging: false,
  startX: 0,
  startY: 0,
  startYaw: 0,
  startPitch: 0
};

renderer.domElement.addEventListener('pointermove', (event) => {
  const deltaX = event.movementX / window.innerWidth;
  const deltaY = event.movementY / window.innerHeight;
  cameraState.yaw -= deltaX * Math.PI * 2;
  cameraState.pitch = Math.min(Math.max(-Math.PI / 2 + 0.05, cameraState.pitch - deltaY * Math.PI), Math.PI / 2 - 0.05);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let score = 0;
let isJumping = false;
let hasFallen = false;

function playAction(name) {
  if (!mixer) return;
  const action = actions[name];
  if (!action || currentAction === action) return;
  if (currentAction && currentAction !== action) {
    currentAction.fadeOut(0.2);
  }
  action.reset();
  action.fadeIn(0.2);
  action.play();
  currentAction = action;
}

function updatePlayer(delta) {
  const moveSpeed = 6;
  const forward = new THREE.Vector3(Math.sin(cameraState.yaw), 0, Math.cos(cameraState.yaw));
  const right = new THREE.Vector3(Math.sin(cameraState.yaw + Math.PI / 2), 0, Math.cos(cameraState.yaw + Math.PI / 2));
  const direction = new THREE.Vector3();

  if (keys.w || keys.arrowup) direction.add(forward);
  if (keys.s || keys.arrowdown) direction.sub(forward);
  if (keys.a || keys.arrowleft) direction.add(right);
  if (keys.d || keys.arrowright) direction.sub(right);

  if (direction.lengthSq() > 0) {
    if (!hasStartedMoving) {
      hasStartedMoving = true;
      runStartTime = performance.now();
    }
    direction.normalize().multiplyScalar(moveSpeed);
    playerVelocity.x = direction.x;
    playerVelocity.z = direction.z;
  } else {
    playerVelocity.x = 0;
    playerVelocity.z = 0;
  }

  updatePlayerBox();
  const prevBottom = prevPlayerBottom ?? playerBox.min.y;
  playerVelocity.y += gravity * delta;
  player.position.addScaledVector(playerVelocity, delta);

  const limit = 22;
  player.position.x = Math.max(-limit, Math.min(limit, player.position.x));
  player.position.z = Math.max(-limit, Math.min(limit, player.position.z));
  player.rotation.y = cameraState.yaw + Math.PI;

  let platformUnder = getPlatformUnder();
  updatePlayerBox();
  const currentBottom = playerBox.min.y;
  if (!platformUnder && playerVelocity.y <= 0) {
    const crossed = findPlatformBetween(prevBottom, currentBottom);
    if (crossed) {
      platformUnder = crossed;
      player.position.y = crossed.y - playerBottomOffset;
      playerVelocity.y = 0;
      isGrounded = true;
      isJumping = false;
      isFalling = false;
      fallStartY = null;
      statusEl.textContent = 'עמדת על הפלטפורמה! המשך ומצא את המטבעות';
    }
  }
  if (isGrounded && !platformUnder) {
    isFalling = true;
    fallStartY = player.position.y;
  }
  if (platformUnder && playerVelocity.y <= 0) {
    const landY = platformUnder.y - playerBottomOffset;
    if (platformUnder.type === 'bounce' && isFalling && fallStartY !== null) {
      const fallHeight = Math.max(0, fallStartY - platformUnder.y);
      const bounceVel = Math.sqrt(2 * -gravity * fallHeight) * 0.85;
      player.position.y = landY + 0.01; 
      playerVelocity.y = bounceVel;
      isGrounded = false;
      isJumping = true;
      statusEl.textContent = 'נתקעת בפלטפורמת הקפצה!';
    } else {
      player.position.y = landY;
      playerVelocity.y = 0;
      isGrounded = true;
      isJumping = false;
      statusEl.textContent = 'עמדת על הפלטפורמה! המשך ומצא את המטבעות';
    }
    isFalling = false;
    fallStartY = null;
  } else {
    isGrounded = false;
  }

  if (keys.space && isGrounded) {
    if (!hasStartedMoving) {
      hasStartedMoving = true;
      runStartTime = performance.now();
    }
    isJumping = true;
    playerVelocity.y = 10;
    isGrounded = false;
    statusEl.textContent = 'קופץ!';
    playAction('jump');
  }

  if (!isJumping) {
    const isMoving = direction.lengthSq() > 0 && isGrounded;
    if (isMoving) {
      playAction('walk');
    } else {
      playAction('idle');
    }
  }

  // -------------------------------------------------------------------------
  // שדרוג: חישוב התנגשות פיזית עם השער האדום החוסם
  // -------------------------------------------------------------------------
  if (gateClosed && gateMesh) {
    const gateBox = new THREE.Box3().setFromObject(gateMesh);
    if (playerBox.intersectsBox(gateBox)) {
      // חסימת השחקן פיזית מלהתקדם בציר ה-Z אל תוך היעד
      player.position.z = gateBox.max.z + playerSize.z / 2 + 0.05;
      
      const totalCoins = collectibles.length;
      statusEl.textContent = `🚫 השער נעול! אספת ${score}/${totalCoins}. צריך לאסוף את כל המטבעות כדי לנצח!`;
    }
  }

  // -------------------------------------------------------------------------
  // שדרוג: הגעה למשטח היעד (Goal Platform) ומסך ניצחון
  // -------------------------------------------------------------------------
  if (goalPlatform && platformUnder === goalPlatform && !goalReached) {
    goalReached = true;
    const elapsed = performance.now() - runStartTime;
    
    // בדיקה ועדכון של השיא האישי (הזמן הכי קצר)
    if (elapsed < bestTime) {
      bestTime = elapsed;
      localStorage.setItem('3d_platformer_best_time', bestTime);
      document.getElementById('bestTimer').textContent = formatTime(bestTime);
    }

    statusEl.textContent = `ניצחת! 🎉 זמן סופי: ${formatTime(elapsed)}`;
    
    // הצגת הודעת הניצחון הייעודית על גבי ה-Overlay שביקשת
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.style.flexDirection = 'column';
      overlay.style.justifyContent = 'center';
      overlay.style.alignItems = 'center';
      overlay.style.backgroundColor = 'rgba(13, 11, 23, 0.9)';
      
      overlay.innerHTML = `
        <h1 style="color: #7fff00; font-size: 55px; font-family: sans-serif; text-shadow: 0 0 20px rgba(127,255,0,0.5); margin-bottom: 10px;">ניצחת! 🎉</h1>
        <p style="font-size: 22px; color: #fff; font-family: sans-serif; margin: 5px 0;">כל הכבוד! סיימת את המשחק בזמן של: <span style="color: #58a6ff; font-weight: bold;">${formatTime(elapsed)}</span></p>
        <p style="font-size: 18px; color: #ffd35c; font-family: sans-serif; margin: 5px 0 25px 0;">🏆 השיא הכי מהיר שלך: ${formatTime(bestTime)}</p>
        <button id="winRestartBtn" style="padding: 12px 35px; font-size: 18px; font-family: sans-serif; font-weight: bold; background: #7fff00; border: none; border-radius: 6px; cursor: pointer; transition: 0.2s;">שחק שוב</button>
      `;
      
      document.getElementById('winRestartBtn').addEventListener('click', () => {
        window.location.reload();
      });
    }
    restartBtn.classList.remove('hidden');
  }

  const playerBottom = player.position.y + playerBottomOffset;
  // Only trigger automatic reload for falling after the player/model is ready
  if (!platformUnder && playerBottom < -2 && !hasFallen && (playerReady || hasStartedMoving)) {
    hasFallen = true;
    statusEl.textContent = 'נפסלת! מתחיל מחדש...';
    setTimeout(() => window.location.reload(), 700);
    return;
  }
  if (!isGrounded) {
    const ladderZone = ladders.find((lad) => {
      const dx = Math.abs(player.position.x - lad.x);
      const dz = Math.abs(player.position.z - lad.z);
      return dx < 0.6 && dz < 0.6 && player.position.y >= lad.y - 0.1 && player.position.y <= lad.y + lad.height + 0.5;
    });
    if (ladderZone && (keys.w || keys.arrowup)) {
      const climbSpeed = 3;
      player.position.y += climbSpeed * delta;
      playerVelocity.y = 0;
      isGrounded = false;
      return;
    }
    if (ladderZone && (keys.s || keys.arrowdown)) {
      const climbSpeed = 3;
      player.position.y -= climbSpeed * delta;
      playerVelocity.y = 0;
      isGrounded = false;
      return;
    }
  }
  updatePlayerBox();
  prevPlayerBottom = playerBox.min.y;
}

function updateCollectibles(delta) {
  collectibles.forEach((mesh) => {
    if (mesh.userData.collected) return;
    mesh.rotation.z += delta * 2;
    
    if (mesh.userData.parentPlatform && mesh.userData.parentPlatform.moving) {
      mesh.position.y = mesh.userData.parentPlatform.y + (mesh.userData.baseY - mesh.userData.parentPlatform.moving.baseY) + Math.sin(mesh.userData.bobOffset + performance.now() * 0.003) * 0.15;
    } else {
      mesh.position.y = mesh.userData.baseY + Math.sin(mesh.userData.bobOffset + performance.now() * 0.003) * 0.15;
    }
  });
}

function checkCollisions() {
  updatePlayerBox();
  collectibles.forEach((mesh) => {
    if (mesh.userData.collected) return;
    tempBox.setFromObject(mesh);
    if (playerBox.intersectsBox(tempBox)) {
      mesh.userData.collected = true;
      scene.remove(mesh);
      score += 1;
      scoreEl.textContent = score;
      const remaining = collectibles.filter((item) => !item.userData.collected).length;
      remainingEl.textContent = remaining;
      
      // -------------------------------------------------------------------------
      // שדרוג: פתיחת השער ברגע שנאספו כל המטבעות
      // -------------------------------------------------------------------------
      if (remaining === 0) {
        statusEl.textContent = '🔓 אספת את כל המטבעות! השער פתוח, רוץ אל היעד הירוק!';
        if (gateClosed && gateMesh) {
          gateClosed = false;
          scene.remove(gateMesh); // מעלים את הקיר האדום החוסם מהעולם
        }
      } else {
        statusEl.textContent = `נשארו ${remaining} מטבעות`;
      }
    }
  });
}

function checkObstacles() {
  updatePlayerBox();
  obstacles.forEach((mesh) => {
    tempBox.setFromObject(mesh);
    if (playerBox.intersectsBox(tempBox)) {
      statusEl.textContent = 'פגעת במכשול! נופל...';
      // Only reload if the player/model/game has actually started to avoid reload loops
      if (playerReady || hasStartedMoving) {
        setTimeout(() => window.location.reload(), 600);
      }
    }
  });
}

function updateCamera() {
  const distance = cameraState.distance;
  const pitch = cameraState.pitch;
  const yaw = cameraState.yaw;
  const offset = new THREE.Vector3(
    -Math.sin(yaw) * distance * Math.cos(pitch),
    distance * Math.sin(pitch),
    -Math.cos(yaw) * distance * Math.cos(pitch)
  );
  camera.position.copy(player.position).add(offset);
  camera.lookAt(player.position.x, player.position.y + playerEyeHeight, player.position.z);
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  return `${minutes}:${paddedSeconds}`;
}

function animate(time = 0) {
  const delta = Math.min(0.05, (time - (animate.lastTime || time)) / 1000);
  animate.lastTime = time;

  if (mixer) mixer.update(delta);
  updateMovingPlatforms(delta);
  updatePlayer(delta);
  updateCollectibles(delta);
  checkObstacles();
  checkCollisions();
  updateCamera();

  // -------------------------------------------------------------------------
  // שדרוג: עדכון הטיימר החי שמוצג על המסך בזמן אמת
  // -------------------------------------------------------------------------
  if (hasStartedMoving && !goalReached) {
    const elapsed = performance.now() - runStartTime;
    const liveTimerEl = document.getElementById('liveTimer');
    if (liveTimerEl) {
      liveTimerEl.textContent = formatTime(elapsed);
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

restartBtn.addEventListener('click', () => {
  window.location.reload();
});

statusEl.textContent = 'התחל לאסוף את המטבעות!';
animate();
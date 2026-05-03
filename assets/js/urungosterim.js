// urungosterim.js
// 3D Cube viewer using Three.js with Snap to face logic

const API = 'https://vk-portfolio-api.vkesgin38.workers.dev';

let scene, camera, renderer, cube;
let products = [];
let currentProductIndex = 0;
let textures = [];

// Drag interactions
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

let targetQuaternion = new THREE.Quaternion();
let currentQuaternion = new THREE.Quaternion();
let snapTween = null;

// 6 allowed perfectly upright orientations
const allowedOrientations = [
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)),             // Front
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI/2, 0)),    // Right
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)),       // Back
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/2, 0)),     // Left
  new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2, 0, 0)),     // Top
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2, 0, 0))     // Bottom
];

async function init() {
  // Fetch Products
  try {
    const r = await fetch(`${API}/api/projects?category=3dcube`);
    products = await r.json();
  } catch(e) {
    console.error('Failed to load products');
  }

  initThree();
  renderThumbs();
  
  if (products.length > 0) {
    await loadProduct(0);
  } else {
    document.getElementById('loading-screen').innerText = 'HİÇ ÜRÜN BULUNAMADI';
  }
}

function initThree() {
  const container = document.getElementById('canvas-container');
  
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);
  
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 5;
  
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  
  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  // The Cube
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  
  // Create blank materials for 6 faces
  const materials = [];
  for (let i = 0; i < 6; i++) {
    materials.push(new THREE.MeshStandardMaterial({ 
      color: 0x222222,
      roughness: 0.1,
      metalness: 0.2
    }));
  }
  
  cube = new THREE.Mesh(geometry, materials);
  scene.add(cube);

  // Edges (Glow effect)
  const edgesGeometry = new THREE.EdgesGeometry(geometry);
  const edgesMaterial = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2 });
  const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
  cube.add(edges);

  // Events
  window.addEventListener('resize', onWindowResize);
  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  
  container.addEventListener('touchstart', onTouchStart, {passive: false});
  container.addEventListener('touchmove', onTouchMove, {passive: false});
  window.addEventListener('touchend', onMouseUp);

  animate();
}

async function loadProduct(index) {
  currentProductIndex = index;
  const p = products[index];
  document.getElementById('p-title').innerText = p.title || 'Ürün';
  
  document.querySelectorAll('.product-thumb').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });

  const loading = document.getElementById('loading-screen');
  loading.style.opacity = '1';
  loading.style.pointerEvents = 'all';

  let urls = [];
  try {
    urls = JSON.parse(p.description);
  } catch(e) {}
  
  // Faces order in Three.js BoxGeometry:
  // 0: Right (pos x)
  // 1: Left (neg x)
  // 2: Top (pos y)
  // 3: Bottom (neg y)
  // 4: Front (pos z)
  // 5: Back (neg z)
  
  // Our upload order in Admin: Front, Right, Back, Left, Top, Bottom
  // Index mapping from our upload to Three.js:
  // Upload: 0=Front, 1=Right, 2=Back, 3=Left, 4=Top, 5=Bottom
  const map = {
    0: 1, // Right face
    1: 3, // Left face
    2: 4, // Top face
    3: 5, // Bottom face
    4: 0, // Front face
    5: 2  // Back face
  };

  const loader = new THREE.TextureLoader();
  const promises = [];
  
  for(let i=0; i<6; i++) {
    const url = urls[i];
    if(url) {
      const fullUrl = url.startsWith('http') ? url : API + url;
      promises.push(
        new Promise(resolve => {
          loader.load(fullUrl, texture => {
            texture.colorSpace = THREE.SRGBColorSpace;
            resolve({ index: i, texture });
          }, undefined, () => {
            resolve({ index: i, texture: null });
          });
        })
      );
    }
  }

  const results = await Promise.all(promises);
  
  // Apply textures
  results.forEach(res => {
    if(res.texture) {
      // Map our index to three.js index
      let tIdx = 0;
      if(res.index === 0) tIdx = 4; // Front -> Front
      if(res.index === 1) tIdx = 0; // Right -> Right
      if(res.index === 2) tIdx = 5; // Back -> Back
      if(res.index === 3) tIdx = 1; // Left -> Left
      if(res.index === 4) tIdx = 2; // Top -> Top
      if(res.index === 5) tIdx = 3; // Bottom -> Bottom
      
      cube.material[tIdx].map = res.texture;
      cube.material[tIdx].color.setHex(0xffffff);
      cube.material[tIdx].needsUpdate = true;
    }
  });

  // Reset rotation
  targetQuaternion.identity();
  currentQuaternion.identity();

  setTimeout(() => {
    loading.style.opacity = '0';
    loading.style.pointerEvents = 'none';
  }, 500);
}

function renderThumbs() {
  const list = document.getElementById('product-list');
  list.innerHTML = products.map((p, i) => {
    let urls = [];
    try { urls = JSON.parse(p.description); } catch(e){}
    const front = urls[0] ? (urls[0].startsWith('http') ? urls[0] : API + urls[0]) : '';
    return `
      <div class="product-thumb" onclick="loadProduct(${i})">
        ${front ? `<img src="${front}">` : ''}
      </div>
    `;
  }).join('');
}

// Interaction
function onMouseDown(e) {
  isDragging = true;
  previousMousePosition = { x: e.offsetX, y: e.offsetY };
  if(snapTween) snapTween.kill();
}
function onMouseMove(e) {
  if (!isDragging) return;
  const deltaMove = {
    x: e.offsetX - previousMousePosition.x,
    y: e.offsetY - previousMousePosition.y
  };
  
  // Rotate around world Y (horizontal mouse) and world X (vertical mouse)
  const deltaQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    deltaMove.y * 0.008,
    deltaMove.x * 0.008,
    0,
    'XYZ'
  ));
  // Premultiply applies the rotation in world space
  targetQuaternion.premultiply(deltaQ);
  
  previousMousePosition = { x: e.offsetX, y: e.offsetY };
}
function onMouseUp() {
  if (!isDragging) return;
  isDragging = false;
  snapToNearestFace();
}

function onTouchStart(e) {
  if(e.touches.length > 1) return;
  isDragging = true;
  previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if(snapTween) snapTween.kill();
}
function onTouchMove(e) {
  if (!isDragging) return;
  e.preventDefault();
  const deltaMove = {
    x: e.touches[0].clientX - previousMousePosition.x,
    y: e.touches[0].clientY - previousMousePosition.y
  };
  
  const deltaQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    deltaMove.y * 0.008,
    deltaMove.x * 0.008,
    0,
    'XYZ'
  ));
  targetQuaternion.premultiply(deltaQ);
  
  previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}

function snapToNearestFace() {
  const normals = [
    new THREE.Vector3(0, 0, 1),  // 0: Front
    new THREE.Vector3(1, 0, 0),  // 1: Right
    new THREE.Vector3(0, 0, -1), // 2: Back
    new THREE.Vector3(-1, 0, 0), // 3: Left
    new THREE.Vector3(0, 1, 0),  // 4: Top
    new THREE.Vector3(0, -1, 0)  // 5: Bottom
  ];
  
  let maxZ = -Infinity;
  let bestFaceIndex = 0;
  
  // Find which face normal is pointing most towards the camera (+Z)
  for(let i=0; i<6; i++) {
    const worldNormal = normals[i].clone().applyQuaternion(targetQuaternion);
    if(worldNormal.z > maxZ) {
      maxZ = worldNormal.z;
      bestFaceIndex = i;
    }
  }
  
  const bestQ = allowedOrientations[bestFaceIndex];
  
  const dummy = { t: 0 };
  const startQ = targetQuaternion.clone();
  
  snapTween = gsap.to(dummy, {
    t: 1,
    duration: 0.5,
    ease: "power2.out",
    onUpdate: () => {
      targetQuaternion.slerpQuaternions(startQ, bestQ, dummy.t);
    }
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  
  if (cube) {
    // Smoothly interpolate current rotation to target rotation
    currentQuaternion.slerp(targetQuaternion, 0.15);
    cube.quaternion.copy(currentQuaternion);
  }
  
  renderer.render(scene, camera);
}

init();

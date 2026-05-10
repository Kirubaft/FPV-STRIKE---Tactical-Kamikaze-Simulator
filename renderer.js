const THREE = window.THREE;
const simplex = new SimplexNoise();

// --- ЕКОНОМІКА, НАЛАШТУВАННЯ ТА ЗБЕРЕЖЕННЯ ---
let defaultSave = { money: 0, unlockedDrones: [0], currentDrone: 0, promoUsed: false, volume: 1.0, shadows: true };
let saveData = JSON.parse(localStorage.getItem('fpvSaveData')) || defaultSave;
// Оновлення старих збережень
if(saveData.promoUsed === undefined) saveData.promoUsed = false;
if(saveData.volume === undefined) saveData.volume = 1.0;
if(saveData.shadows === undefined) saveData.shadows = true;

let recordedVideos = JSON.parse(localStorage.getItem('fpvReplays')) || [];

const DRONES =[
    { name: "SCOUT FPV", mass: 1.0, thrust: 35, blastRadius: 12, price: 0, desc: "Легкий, швидкий. Малий вибух." },
    { name: "KAMIKAZE PRO", mass: 1.5, thrust: 50, blastRadius: 25, price: 500, desc: "Ідеальний баланс. Знищує танки." },
    { name: "BABA YAGA", mass: 3.0, thrust: 90, blastRadius: 45, price: 1500, desc: "Важкий бомбардувальник. Тотальна анігіляція." }
];

const MISSIONS =[
    { id: 0, type: 'FREE', text: "FREE FLIGHT", target: 0, reward: 0, desc: "Вільний політ. Жодних завдань, просто рознось усе навколо." },
    { id: 1, type: 'TANK', text: "DESTROY ENEMY TANK", target: 1, reward: 500, desc: "Знайди і знищи ворожий танк на локації." },
    { id: 2, type: 'INFANTRY', text: "ELIMINATE 5 INFANTRY", target: 5, reward: 400, desc: "Ліквідуй 5 піхотинців одним вибухом." },
    { id: 3, type: 'VILLAGE', text: "DESTROY 3 BUILDINGS", target: 3, reward: 300, desc: "Знеси 3 будинки в селі." }
];
let activeMissionId = 1; // За замовчуванням місія на танк
let currentMissionProgress = 0;

function saveGame() { localStorage.setItem('fpvSaveData', JSON.stringify(saveData)); }

// --- БАЗА СЦЕНИ ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4a5c66); scene.fog = new THREE.FogExp2(0x4a5c66, 0.003);
const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 3000);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = saveData.shadows; 
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0x667788, 0.8); scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xfff0dd, 1.2);
sunLight.position.set(1000, 1500, 500); 
sunLight.castShadow = saveData.shadows;
sunLight.shadow.camera.near = 10; sunLight.shadow.camera.far = 3000;
sunLight.shadow.camera.left = -1000; sunLight.shadow.camera.right = 1000;
sunLight.shadow.camera.top = 1000; sunLight.shadow.camera.bottom = -1000;
sunLight.shadow.mapSize.width = 2048; sunLight.shadow.mapSize.height = 2048;
scene.add(sunLight);

// --- ЛАНДШАФТ ---
const terrainSize = 2000;
const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, 150, 150); terrainGeo.rotateX(-Math.PI / 2);
function getElevation(x, z) { return simplex.noise2D(x * 0.001, z * 0.001) * 60 + simplex.noise2D(x * 0.005, z * 0.005) * 15; }
const vertices = terrainGeo.attributes.position.array;
for (let i = 0; i < vertices.length; i += 3) vertices[i + 1] = getElevation(vertices[i], vertices[i + 2]);
terrainGeo.computeVertexNormals();
const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ color: 0x3a4a28, roughness: 0.9, flatShading: true }));
terrain.receiveShadow = true; scene.add(terrain);

// --- ФІЗИКА УЛАМКІВ ---
const physicsObjects =[]; const GRAVITY = 9.81;
function addDebris(mesh, pos, vel, rotVel, isFlesh = 0) {
    mesh.position.copy(pos); mesh.castShadow = saveData.shadows; scene.add(mesh);
    physicsObjects.push({ mesh, velocity: vel, angularVelocity: rotVel, life: isFlesh ? 9999 : 10.0, isFlesh });
}

// --- ГЕНЕРАЦІЯ ОБ'ЄКТІВ ---
const dummy = new THREE.Object3D();
const houseCount = 150;
const houseGeo = new THREE.BoxGeometry(8, 6, 10); houseGeo.translate(0, 3, 0);
const roofGeo = new THREE.ConeGeometry(7, 4, 4); roofGeo.rotateY(Math.PI / 4); roofGeo.translate(0, 8, 0);
const houseMat = new THREE.MeshStandardMaterial({ color: 0xdddddd }); const roofMat = new THREE.MeshStandardMaterial({ color: 0x442222 });
const housesInstanced = new THREE.InstancedMesh(houseGeo, houseMat, houseCount); const roofsInstanced = new THREE.InstancedMesh(roofGeo, roofMat, houseCount);
housesInstanced.castShadow = saveData.shadows; roofsInstanced.castShadow = saveData.shadows;
const housePositions =[];
for (let i = 0; i < houseCount; i++) {
    let x, z; do { x = (Math.random() - 0.5) * terrainSize; z = (Math.random() - 0.5) * terrainSize; } while (Math.abs(x) < 100 && Math.abs(z + 150) < 100);
    const y = getElevation(x, z); dummy.position.set(x, y, z); dummy.rotation.y = Math.random() * Math.PI; dummy.updateMatrix();
    housesInstanced.setMatrixAt(i, dummy.matrix); roofsInstanced.setMatrixAt(i, dummy.matrix);
    housePositions.push({ id: i, pos: new THREE.Vector3(x, y, z), active: true });
}
scene.add(housesInstanced); scene.add(roofsInstanced);

const humans =[];
const humanMatMil = new THREE.MeshStandardMaterial({ color: 0x3b4d2e }); 
function createHuman(x, z) {
    const group = new THREE.Group();
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), humanMatMil); head.position.y = 1.8; group.add(head);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.4), humanMatMil); body.position.y = 1.2; group.add(body);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.2), humanMatMil); armL.position.set(-0.4, 1.2, 0); group.add(armL);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.2), humanMatMil); armR.position.set(0.4, 1.2, 0); group.add(armR);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, 0.25), humanMatMil); legL.position.set(-0.2, 0.4, 0); group.add(legL);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, 0.25), humanMatMil); legR.position.set(0.2, 0.4, 0); group.add(legR);
    group.position.set(x, getElevation(x, z), z); scene.add(group);
    humans.push({ group, parts:[head, body, armL, armR, legL, legR], active: true, speed: 1 + Math.random(), angle: Math.random() * Math.PI * 2 });
}
for(let i=0; i<30; i++) createHuman((Math.random()-0.5)*150, -150 + (Math.random()-0.5)*150); 

const targetGroup = new THREE.Group();
const armorMat = new THREE.MeshStandardMaterial({ color: 0x2a2e25, roughness: 0.6 });
const tHull = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 8), armorMat); tHull.position.y = 1.2; targetGroup.add(tHull);
const tTurret = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 3.5), armorMat); tTurret.position.set(0, 2.5, 0.5); targetGroup.add(tTurret);
const targetX = 0; const targetZ = -150;
targetGroup.position.set(targetX, getElevation(targetX, targetZ), targetZ); targetGroup.rotation.y = Math.PI / 4; scene.add(targetGroup);

// --- СИСТЕМА ВИБУХУ ---
const fireParticles = new THREE.BufferGeometry(); const smokeParticles = new THREE.BufferGeometry();
const pCount = 2000; const fPos = new Float32Array(pCount*3); const sPos = new Float32Array(pCount*3); const pVel =[];
for(let i=0; i<pCount; i++) { pVel.push(new THREE.Vector3((Math.random()-0.5)*80, Math.random()*80, (Math.random()-0.5)*80)); }
fireParticles.setAttribute('position', new THREE.BufferAttribute(fPos, 3)); smokeParticles.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
const fireMat = new THREE.PointsMaterial({ color: 0xffaa00, size: 6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const smokeMat = new THREE.PointsMaterial({ color: 0x111111, size: 12, transparent: true, opacity: 0.9 });
const fire = new THREE.Points(fireParticles, fireMat); const smoke = new THREE.Points(smokeParticles, smokeMat);
fire.visible = false; smoke.visible = false; scene.add(fire); scene.add(smoke);

let explosionCenter = null;

function triggerMassiveExplosion(epicenter, radius) {
    explosionCenter = epicenter.clone();
    fire.position.copy(epicenter); smoke.position.copy(epicenter);
    fire.visible = true; smoke.visible = true;
    if (audioCtx) playExplosionSound();

    const crater = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.4, 16), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    crater.rotation.x = -Math.PI / 2; crater.position.set(epicenter.x, getElevation(epicenter.x, epicenter.z) + 0.05, epicenter.z); scene.add(crater);

    const activeMission = MISSIONS[activeMissionId];

    if (epicenter.distanceTo(targetGroup.position) < radius && targetGroup.visible) {
        targetGroup.visible = false;
        if (activeMission.type === 'TANK') currentMissionProgress++;
        [tHull, tTurret].forEach(part => {
            const worldPos = new THREE.Vector3(); part.getWorldPosition(worldPos);
            const clone = part.clone(); clone.material = new THREE.MeshStandardMaterial({color: 0x111111});
            addDebris(clone, worldPos, worldPos.clone().sub(epicenter).normalize().multiplyScalar(30).setY(20), new THREE.Vector3(Math.random()*5, Math.random()*5, 0));
        });
    }

    const hideMat = new THREE.Matrix4().makeScale(0,0,0);
    housePositions.forEach(h => {
        if (h.active && h.pos.distanceTo(epicenter) < radius * 1.5) {
            h.active = false;
            if (activeMission.type === 'VILLAGE') currentMissionProgress++;
            housesInstanced.setMatrixAt(h.id, hideMat); roofsInstanced.setMatrixAt(h.id, hideMat);
            housesInstanced.instanceMatrix.needsUpdate = true; roofsInstanced.instanceMatrix.needsUpdate = true;
            for(let i=0; i<15; i++) addDebris(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), houseMat), h.pos.clone().add(new THREE.Vector3(0,3,0)), new THREE.Vector3((Math.random()-0.5)*40, Math.random()*30, (Math.random()-0.5)*40), new THREE.Vector3(Math.random()*10,0,0));
        }
    });

    humans.forEach(h => {
        if (h.active && h.group.position.distanceTo(epicenter) < radius * 1.2) {
            h.active = false; scene.remove(h.group);
            if (activeMission.type === 'INFANTRY') currentMissionProgress++;
            h.parts.forEach(part => {
                const worldPos = new THREE.Vector3(); part.getWorldPosition(worldPos);
                addDebris(part.clone(), worldPos, worldPos.clone().sub(epicenter).normalize().multiplyScalar(20).setY(15), new THREE.Vector3(Math.random()*10, Math.random()*10, 0), 1);
            });
        }
    });
}

// --- СИСТЕМА ЗАПИСУ ВІДЕО (DVR) ---
let mediaRecorder; let recordedChunks =[]; let currentVideoUrl = null;
function startRecording() {
    recordedChunks =[];
    const stream = renderer.domElement.captureStream(30);
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        currentVideoUrl = URL.createObjectURL(blob);
        recordedVideos.unshift({ date: new Date().toLocaleTimeString(), url: currentVideoUrl });
        if (recordedVideos.length > 5) recordedVideos.pop();
        updateReplaysMenu();
    };
    mediaRecorder.start();
}
function stopRecording() { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); }

// --- UI ТА МЕНЮ ---
function updateMenuUI() {
    document.getElementById('menu-money').innerText = saveData.money;
    document.getElementById('menu-drone-name').innerText = DRONES[saveData.currentDrone].name;
    
    // Loadout
    const dList = document.getElementById('drone-list'); dList.innerHTML = '';
    DRONES.forEach((d, index) => {
        const isUnlocked = saveData.unlockedDrones.includes(index);
        const isCurrent = saveData.currentDrone === index;
        let btnHtml = isCurrent ? `<button class="cyber-btn" disabled style="width:150px; font-size:16px;">EQUIPPED</button>` : 
                      isUnlocked ? `<button class="cyber-btn" onclick="equipDrone(${index})" style="width:150px; font-size:16px;">EQUIP</button>` : 
                      `<button class="cyber-btn" onclick="buyDrone(${index})" style="width:150px; font-size:16px;">BUY $${d.price}</button>`;
        dList.innerHTML += `<div class="list-card"><div class="list-info"><h3>${d.name}</h3><p>Blast: ${d.blastRadius}m | Speed: ${d.thrust}</p><p style="color:#888">${d.desc}</p></div>${btnHtml}</div>`;
    });

    // Missions
    const mList = document.getElementById('mission-list'); mList.innerHTML = '';
    MISSIONS.forEach((m, index) => {
        const isCurrent = activeMissionId === index;
        let btnHtml = isCurrent ? `<button class="cyber-btn" disabled style="width:150px; font-size:16px;">SELECTED</button>` : 
                                  `<button class="cyber-btn" onclick="selectMission(${index})" style="width:150px; font-size:16px;">SELECT</button>`;
        mList.innerHTML += `<div class="list-card"><div class="list-info"><h3>${m.text}</h3><p>Reward: $${m.reward}</p><p style="color:#888">${m.desc}</p></div>${btnHtml}</div>`;
    });

    // Settings
    document.getElementById('setting-vol').value = saveData.volume * 100;
    document.getElementById('vol-val').innerText = `${Math.round(saveData.volume * 100)}%`;
    document.getElementById('setting-shadows').innerText = saveData.shadows ? "ON" : "OFF";
    if(masterGain) masterGain.gain.value = saveData.volume;
}

function updateReplaysMenu() {
    const list = document.getElementById('replay-list'); list.innerHTML = '';
    recordedVideos.forEach((vid) => { list.innerHTML += `<div class="replay-item" onclick="playReplay('${vid.url}')">▶ STRIKE RECORDING [${vid.date}]</div>`; });
}

window.equipDrone = (index) => { saveData.currentDrone = index; saveGame(); updateMenuUI(); };
window.buyDrone = (index) => {
    if (saveData.money >= DRONES[index].price) { saveData.money -= DRONES[index].price; saveData.unlockedDrones.push(index); saveGame(); updateMenuUI(); } 
    else { alert("NOT ENOUGH FUNDS!"); }
};
window.selectMission = (index) => { activeMissionId = index; updateMenuUI(); };
window.playReplay = (url) => { const player = document.getElementById('replay-player'); player.src = url; player.play(); };

// Навігація меню
const showMenu = (id) => { document.querySelectorAll('.menu-panel').forEach(p => p.style.display = 'none'); document.getElementById(id).style.display = 'block'; };
document.getElementById('btn-loadout').onclick = () => { showMenu('loadout-menu'); updateMenuUI(); };
document.getElementById('btn-back-loadout').onclick = () => showMenu('main-menu');
document.getElementById('btn-missions').onclick = () => { showMenu('missions-menu'); updateMenuUI(); };
document.getElementById('btn-back-missions').onclick = () => showMenu('main-menu');
document.getElementById('btn-replays').onclick = () => { showMenu('replays-menu'); updateReplaysMenu(); };
document.getElementById('btn-back-replays').onclick = () => { showMenu('main-menu'); document.getElementById('replay-player').pause(); };
document.getElementById('btn-settings').onclick = () => { showMenu('settings-menu'); updateMenuUI(); };
document.getElementById('btn-back-settings').onclick = () => showMenu('main-menu');

// Логіка Налаштувань
document.getElementById('setting-vol').oninput = (e) => {
    saveData.volume = e.target.value / 100;
    document.getElementById('vol-val').innerText = `${e.target.value}%`;
    if(masterGain) masterGain.gain.value = saveData.volume;
    saveGame();
};
document.getElementById('setting-shadows').onclick = () => {
    saveData.shadows = !saveData.shadows;
    document.getElementById('setting-shadows').innerText = saveData.shadows ? "ON" : "OFF";
    renderer.shadowMap.enabled = saveData.shadows;
    sunLight.castShadow = saveData.shadows;
    scene.traverse(child => { if (child.isMesh || child.isInstancedMesh) { child.castShadow = saveData.shadows; child.receiveShadow = saveData.shadows; } });
    saveGame();
};

// ПРОМОКОД
document.getElementById('btn-promo').onclick = () => {
    const code = document.getElementById('promo-input').value.toUpperCase();
    const msg = document.getElementById('promo-msg');
    if (code === 'PROMO2K' && !saveData.promoUsed) {
        saveData.money += 2000; saveData.promoUsed = true; saveGame(); updateMenuUI();
        msg.innerText = "SUCCESS: +$2000"; msg.style.color = "#0f0";
    } else if (code === 'PROMO2K' && saveData.promoUsed) {
        msg.innerText = "ALREADY USED!"; msg.style.color = "#f00";
    } else {
        msg.innerText = "INVALID CODE"; msg.style.color = "#f00";
    }
};

// --- ФІЗИКА ДРОНА ТА СТАН ГРИ ---
let gameState = 'MENU'; let deathTimer = 0; let droneStats = DRONES[0];
const drone = { position: new THREE.Vector3(0, 100, 100), velocity: new THREE.Vector3(0, 0, 0), rotation: new THREE.Euler(0, 0, 0, 'YXZ') };
const keys = { w: false, s: false, a: false, d: false, q: false, e: false, shift: false, space: false };

document.getElementById('btn-start').addEventListener('click', () => {
    droneStats = DRONES[saveData.currentDrone];
    currentMissionProgress = 0;
    document.getElementById('menu-system').style.display = 'none';
    document.getElementById('osd-layer').style.display = 'block';
    
    const m = MISSIONS[activeMissionId];
    document.getElementById('mission-hud').innerText = m.type === 'FREE' ? `MISSION: ${m.text}` : `MISSION: ${m.text} (0/${m.target})`;
    
    gameState = 'PLAYING';
    initAudio(); startRecording();
});

window.addEventListener('keydown', (e) => {
    if (gameState === 'DEAD' && e.code === 'KeyR') location.reload(); 
    switch(e.code) { case 'KeyW': keys.w=true; break; case 'KeyS': keys.s=true; break; case 'KeyA': keys.a=true; break; case 'KeyD': keys.d=true; break; case 'KeyQ': keys.q=true; break; case 'KeyE': keys.e=true; break; case 'ShiftLeft': keys.shift=true; break; case 'Space': keys.space=true; break; }
});
window.addEventListener('keyup', (e) => {
    switch(e.code) { case 'KeyW': keys.w=false; break; case 'KeyS': keys.s=false; break; case 'KeyA': keys.a=false; break; case 'KeyD': keys.d=false; break; case 'KeyQ': keys.q=false; break; case 'KeyE': keys.e=false; break; case 'ShiftLeft': keys.shift=false; break; case 'Space': keys.space=false; break; }
});

// --- ЗВУК ---
let audioCtx, masterGain, osc1, osc2, gainNode, noiseGain;
function initAudio() {
    if(audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain(); masterGain.gain.value = saveData.volume; masterGain.connect(audioCtx.destination);
    
    osc1 = audioCtx.createOscillator(); osc2 = audioCtx.createOscillator(); osc1.type = 'sawtooth'; osc2.type = 'square';
    gainNode = audioCtx.createGain(); gainNode.gain.value = 0; osc1.connect(gainNode); osc2.connect(gainNode); gainNode.connect(masterGain); osc1.start(); osc2.start();
    
    const bufferSize = audioCtx.sampleRate * 2; const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = buffer.getChannelData(0); for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
    const noiseNode = audioCtx.createBufferSource(); noiseNode.buffer = buffer; noiseNode.loop = true;
    const noiseFilter = audioCtx.createBiquadFilter(); noiseFilter.type = 'lowpass'; noiseFilter.frequency.value = 600;
    noiseGain = audioCtx.createGain(); noiseGain.gain.value = 0; noiseNode.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(masterGain); noiseNode.start();
}
function playExplosionSound() {
    const boomOsc = audioCtx.createOscillator(); boomOsc.type = 'square';
    boomOsc.frequency.setValueAtTime(100, audioCtx.currentTime); boomOsc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 3);
    const boomGain = audioCtx.createGain(); boomGain.gain.setValueAtTime(3, audioCtx.currentTime); boomGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 3);
    boomOsc.connect(boomGain); boomGain.connect(masterGain); boomOsc.start(); boomOsc.stop(audioCtx.currentTime + 3);
}

// --- ГОЛОВНИЙ ЦИКЛ ---
const clock = new THREE.Clock(); let gameTime = 0;

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05); gameTime += dt;

    for (let i = physicsObjects.length - 1; i >= 0; i--) {
        const obj = physicsObjects[i];
        obj.velocity.y -= GRAVITY * dt; obj.mesh.position.add(obj.velocity.clone().multiplyScalar(dt));
        obj.mesh.rotation.x += obj.angularVelocity.x * dt; obj.mesh.rotation.y += obj.angularVelocity.y * dt;
        const gY = getElevation(obj.mesh.position.x, obj.mesh.position.z);
        if (obj.mesh.position.y < gY) {
            obj.mesh.position.y = gY;
            if (obj.isFlesh) {
                obj.velocity.set(0,0,0); obj.angularVelocity.set(0,0,0);
                const blood = new THREE.Mesh(new THREE.CircleGeometry(0.5, 8), new THREE.MeshBasicMaterial({color: 0x550000}));
                blood.rotation.x = -Math.PI/2; blood.position.set(obj.mesh.position.x, gY + 0.06, obj.mesh.position.z); scene.add(blood);
                obj.isFlesh = 0;
            } else { obj.velocity.y *= -0.5; obj.velocity.x *= 0.8; obj.velocity.z *= 0.8; }
        }
        obj.life -= dt; if (obj.life <= 0) { scene.remove(obj.mesh); physicsObjects.splice(i, 1); }
    }

    if (gameState === 'MENU') {
        camera.position.set(Math.cos(gameTime * 0.2) * 150, 80, targetZ + Math.sin(gameTime * 0.2) * 150); camera.lookAt(targetGroup.position);
    } 
    else if (gameState === 'PLAYING') {
        let targetPitch = 0; let targetRoll = 0; let yawSpeed = 0;
        if (keys.w) targetPitch = -0.8; if (keys.s) targetPitch = 0.8;
        if (keys.a) targetRoll = 0.8; if (keys.d) targetRoll = -0.8;
        if (keys.q) yawSpeed = 2.0; if (keys.e) yawSpeed = -2.0;

        drone.rotation.x += (targetPitch - drone.rotation.x) * 5 * dt; drone.rotation.z += (targetRoll - drone.rotation.z) * 5 * dt; drone.rotation.y += yawSpeed * dt;
        let tiltFactor = Math.max(0.3, Math.cos(drone.rotation.x) * Math.cos(drone.rotation.z));
        let requiredThrust = (GRAVITY * droneStats.mass) / tiltFactor;
        if (keys.shift) requiredThrust += droneStats.thrust; if (keys.space) requiredThrust -= 20;

        const thrustVector = new THREE.Vector3(0, 1, 0).applyEuler(drone.rotation).multiplyScalar(requiredThrust / droneStats.mass);
        drone.velocity.add(new THREE.Vector3().addVectors(thrustVector, new THREE.Vector3(0, -GRAVITY, 0)).multiplyScalar(dt));
        drone.velocity.multiplyScalar(0.97); drone.position.add(drone.velocity.clone().multiplyScalar(dt));

        const groundY = getElevation(drone.position.x, drone.position.z);
        
        const m = MISSIONS[activeMissionId];
        document.getElementById('mission-hud').innerText = m.type === 'FREE' ? `MISSION: ${m.text}` : `MISSION: ${m.text} (${Math.min(currentMissionProgress, m.target)}/${m.target})`;

        if (drone.position.y <= groundY + 0.5 || (drone.position.distanceTo(targetGroup.position) < 6.0 && targetGroup.visible)) {
            triggerMassiveExplosion(drone.position, droneStats.blastRadius); die();
        }

        camera.position.copy(drone.position); camera.quaternion.setFromEuler(drone.rotation);

        document.getElementById('speed-text').innerText = `SPD: ${(drone.velocity.length() * 3.6).toFixed(0)} km/h`;
        document.getElementById('alt-text').innerText = `ALT: ${(drone.position.y - groundY).toFixed(1)}m`;
        document.getElementById('dist-text').innerText = `TGT: ${drone.position.distanceTo(targetGroup.position).toFixed(0)}m`;
        document.getElementById('horizon').style.transform = `translateY(${drone.rotation.x * 200}px) rotate(${-drone.rotation.z * (180/Math.PI)}deg)`;
        document.getElementById('noise-overlay').style.opacity = (drone.position.y - groundY) < 15 ? 1.0 - ((drone.position.y - groundY) / 15) : 0;

        if (audioCtx) {
            const motorFreq = 150 + (requiredThrust * 4) + (drone.velocity.length() * 2);
            osc1.frequency.setTargetAtTime(motorFreq, audioCtx.currentTime, 0.1); osc2.frequency.setTargetAtTime(motorFreq * 1.01, audioCtx.currentTime, 0.1);
            gainNode.gain.setTargetAtTime(0.3, audioCtx.currentTime, 0.1); noiseGain.gain.setTargetAtTime(Math.min(drone.velocity.length() / 40, 0.8), audioCtx.currentTime, 0.2);
        }
    } 
    else if (gameState === 'DEATH_CAM') {
        deathTimer -= dt;
        camera.position.x = explosionCenter.x + Math.cos(gameTime * 0.5) * 40; camera.position.z = explosionCenter.z + Math.sin(gameTime * 0.5) * 40; camera.position.y = explosionCenter.y + 20;
        camera.lookAt(explosionCenter);

        const fPositions = fire.geometry.attributes.position.array; const sPositions = smoke.geometry.attributes.position.array;
        for(let i=0; i<pCount; i++) {
            fPositions[i*3] += pVel[i].x * dt; fPositions[i*3+1] += pVel[i].y * dt; fPositions[i*3+2] += pVel[i].z * dt;
            sPositions[i*3] += (pVel[i].x * 0.3) * dt; sPositions[i*3+1] += (Math.abs(pVel[i].y) + 5) * dt; sPositions[i*3+2] += (pVel[i].z * 0.3) * dt;
        }
        fire.geometry.attributes.position.needsUpdate = true; smoke.geometry.attributes.position.needsUpdate = true;
        fireMat.opacity -= dt * 1.5; smokeMat.opacity -= dt * 0.1;

        if (deathTimer <= 0) {
            gameState = 'DEAD'; stopRecording(); document.getElementById('noise-overlay').style.opacity = 1;
            
            const m = MISSIONS[activeMissionId];
            if (m.type === 'FREE') {
                document.getElementById('result-title').innerText = "STRIKE COMPLETED";
                document.getElementById('result-title').style.color = "#fff";
                document.getElementById('result-reward').innerText = "FREE FLIGHT";
            } else if (currentMissionProgress >= m.target) {
                saveData.money += m.reward; saveGame();
                document.getElementById('result-title').innerText = "MISSION PASSED";
                document.getElementById('result-title').style.color = "#0f0";
                document.getElementById('result-reward').innerText = `+$${m.reward}`;
            } else {
                document.getElementById('result-title').innerText = "MISSION FAILED";
                document.getElementById('result-title').style.color = "#f00";
                document.getElementById('result-reward').innerText = "TARGET NOT DESTROYED";
            }
            document.getElementById('mission-result').style.display = 'flex';
        }
    }

    renderer.render(scene, camera);
}

function die() {
    gameState = 'DEATH_CAM'; deathTimer = 5.0; document.getElementById('osd-layer').style.display = 'none';
    if (audioCtx) { gainNode.gain.value = 0; noiseGain.gain.value = 0; }
}

updateMenuUI();
animate();
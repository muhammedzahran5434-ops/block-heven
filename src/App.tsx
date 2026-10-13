import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  addProgress,
  createAccount,
  loadWorld,
  restoreSession,
  saveWorld,
  signIn,
  signOut,
  xpForNextLevel,
  type BlockAction,
  type PlayerProfile,
  type StoredWorld,
} from "./db";

type BlockType =
  | "grass"
  | "dirt"
  | "stone"
  | "sand"
  | "wood"
  | "leaves"
  | "brick"
  | "bedrock";

type Screen = "menu" | "playing" | "paused";

type GameApi = {
  newWorld: () => void;
  play: () => void;
  selectBlock: (index: number) => void;
};

type SavedWorld = StoredWorld<BlockType>;

const WORLD_RADIUS = 16;
const WATER_LEVEL = 3.45;
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.3;

const BLOCKS: Array<{
  type: BlockType;
  name: string;
  swatch: string;
}> = [
  { type: "grass", name: "Grass Block", swatch: "block-grass" },
  { type: "dirt", name: "Dirt", swatch: "block-dirt" },
  { type: "stone", name: "Stone", swatch: "block-stone" },
  { type: "sand", name: "Sand", swatch: "block-sand" },
  { type: "wood", name: "Oak Log", swatch: "block-wood" },
  { type: "leaves", name: "Oak Leaves", swatch: "block-leaves" },
  { type: "brick", name: "Bricks", swatch: "block-brick" },
];

const FACE_DATA = [
  {
    dir: [1, 0, 0],
    normal: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  {
    dir: [-1, 0, 0],
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
  {
    dir: [0, 1, 0],
    normal: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    dir: [0, -1, 0],
    normal: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    dir: [0, 0, 1],
    normal: [0, 0, 1],
    corners: [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1],
    ],
  },
  {
    dir: [0, 0, -1],
    normal: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  },
] as const;

const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`;

function hash(seed: number, x: number, z: number) {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 0.013) * 43758.5453;
  return value - Math.floor(value);
}

function terrainHeight(seed: number, x: number, z: number) {
  const broad = Math.sin((x + seed * 0.001) * 0.23) * 1.35;
  const rolling = Math.cos((z - seed * 0.001) * 0.2) * 1.25;
  const detail = (hash(seed, x, z) - 0.5) * 1.5;
  return Math.max(1, Math.min(7, Math.floor(3.5 + broad + rolling + detail)));
}

function createTexture(
  base: string,
  flecks: string[],
  painter?: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 16, 16);

  for (let i = 0; i < 58; i += 1) {
    const x = (i * 7 + i * i * 3) % 16;
    const y = (i * 11 + i * i) % 16;
    ctx.fillStyle = flecks[i % flecks.length];
    ctx.fillRect(x, y, i % 5 === 0 ? 2 : 1, 1);
  }
  painter?.(ctx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeMaterials() {
  const textures = {
    grassTop: createTexture("#67a83e", ["#79bd4a", "#4c8e32", "#86c857"]),
    grassSide: createTexture("#80552f", ["#6e4327", "#99643a"], (ctx) => {
      ctx.fillStyle = "#5c9d39";
      ctx.fillRect(0, 0, 16, 4);
      ctx.fillStyle = "#75b947";
      ctx.fillRect(0, 0, 16, 2);
      for (let x = 1; x < 16; x += 4) ctx.fillRect(x, 4, 2, 2 + (x % 3));
    }),
    dirt: createTexture("#80522f", ["#684027", "#98663b", "#744629"]),
    stone: createTexture("#85898b", ["#686d70", "#9b9e9f", "#737779"]),
    sand: createTexture("#d9c477", ["#ead98f", "#bca75e", "#cfb96c"]),
    wood: createTexture("#8b5a2f", ["#6c4123", "#a66d38"], (ctx) => {
      ctx.fillStyle = "#654020";
      for (let x = 2; x < 16; x += 5) ctx.fillRect(x, 0, 1, 16);
    }),
    woodTop: createTexture("#b17a43", ["#c38c52", "#8d5f34"], (ctx) => {
      ctx.strokeStyle = "#764823";
      ctx.strokeRect(3.5, 3.5, 9, 9);
      ctx.strokeRect(6.5, 6.5, 3, 3);
    }),
    leaves: createTexture("#3e8237", ["#2d692d", "#58a148", "#70ad51"]),
    brick: createTexture("#9e4d3f", ["#b75f4e", "#813b32"], (ctx) => {
      ctx.fillStyle = "#c39a83";
      for (let y = 4; y < 16; y += 5) ctx.fillRect(0, y, 16, 1);
      for (let y = 0; y < 16; y += 5) {
        for (let x = y % 10 === 0 ? 7 : 3; x < 16; x += 8) ctx.fillRect(x, y, 1, 4);
      }
    }),
    bedrock: createTexture("#333638", ["#1d2022", "#54585a", "#292c2e"]),
  };

  const materials: Record<string, THREE.MeshLambertMaterial> = {};
  Object.entries(textures).forEach(([name, map]) => {
    materials[name] = new THREE.MeshLambertMaterial({ map });
  });
  return { materials, textures: Object.values(textures) };
}

function VoxelGame({
  gameApi,
  playerId,
  initialWorld,
  onLockChange,
  onSelectionChange,
  onPositionChange,
  onWorldSaved,
  onBlockAction,
}: {
  gameApi: React.MutableRefObject<GameApi | null>;
  playerId: string | null;
  initialWorld: SavedWorld | null;
  onLockChange: (locked: boolean) => void;
  onSelectionChange: (index: number) => void;
  onPositionChange: (position: { x: number; y: number; z: number }) => void;
  onWorldSaved: (world: SavedWorld) => void;
  onBlockAction: (action: BlockAction) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({
    onLockChange,
    onSelectionChange,
    onPositionChange,
    onWorldSaved,
    onBlockAction,
  });
  callbacksRef.current = {
    onLockChange,
    onSelectionChange,
    onPositionChange,
    onWorldSaved,
    onBlockAction,
  };

  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x92bed0, 0.018);

    const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 260);
    camera.rotation.order = "YXZ";
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const skyUniforms = {
      topColor: { value: new THREE.Color(0x4f9bd1) },
      bottomColor: { value: new THREE.Color(0xd9edf0) },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(170, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: skyUniforms,
        vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying float vY; uniform vec3 topColor; uniform vec3 bottomColor; void main(){ float h = smoothstep(-35.0, 105.0, vY); gl_FragColor = vec4(mix(bottomColor, topColor, h), 1.0); }`,
      }),
    );
    scene.add(sky);

    const ambient = new THREE.HemisphereLight(0xcceeff, 0x4c5b35, 1.65);
    scene.add(ambient);
    const sunlight = new THREE.DirectionalLight(0xfff1cc, 2.2);
    sunlight.position.set(-28, 42, -20);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    sunlight.shadow.camera.left = -24;
    sunlight.shadow.camera.right = 24;
    sunlight.shadow.camera.top = 24;
    sunlight.shadow.camera.bottom = -24;
    scene.add(sunlight);

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(4.5, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff1ad, fog: false }),
    );
    sun.position.set(-55, 72, -80);
    scene.add(sun);

    const cloudMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
    });
    const cloudGeometry = new THREE.BoxGeometry(1, 1, 1);
    const clouds: THREE.Group[] = [];
    for (let i = 0; i < 9; i += 1) {
      const cloud = new THREE.Group();
      const pieces = 3 + (i % 3);
      for (let p = 0; p < pieces; p += 1) {
        const puff = new THREE.Mesh(cloudGeometry, cloudMaterial);
        puff.scale.set(3.5 + (p % 2) * 2, 0.75 + (p % 3) * 0.25, 2.3);
        puff.position.set(p * 3.2, (p % 2) * 0.45, (p % 3) - 1);
        cloud.add(puff);
      }
      cloud.position.set(-42 + i * 11, 17 + (i % 4) * 2.5, -25 + (i % 5) * 12);
      scene.add(cloud);
      clouds.push(cloud);
    }

    const waterGeometry = new THREE.PlaneGeometry(WORLD_RADIUS * 2, WORLD_RADIUS * 2, 24, 24);
    const waterMaterial = new THREE.MeshPhongMaterial({
      color: 0x4e9fc2,
      transparent: true,
      opacity: 0.7,
      shininess: 90,
      specular: 0xbde8f4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, WATER_LEVEL, 0);
    water.receiveShadow = true;
    scene.add(water);
    const waterBase = Float32Array.from(waterGeometry.attributes.position.array as ArrayLike<number>);

    const { materials, textures } = makeMaterials();
    const world = new Map<string, BlockType>();
    const changes = new Map<string, BlockType | null>();
    const worldMeshes: THREE.Mesh[] = [];
    let currentSeed = initialWorld?.seed ?? Math.floor(Math.random() * 999999);
    initialWorld?.changes.forEach(([key, block]) => changes.set(key, block));

    const setBlock = (x: number, y: number, z: number, type: BlockType) => {
      world.set(keyOf(x, y, z), type);
    };

    const generateWorld = () => {
      world.clear();
      for (let x = -WORLD_RADIUS; x < WORLD_RADIUS; x += 1) {
        for (let z = -WORLD_RADIUS; z < WORLD_RADIUS; z += 1) {
          const height = terrainHeight(currentSeed, x, z);
          for (let y = -2; y <= height; y += 1) {
            let type: BlockType = "stone";
            if (y === -2) type = "bedrock";
            else if (y === height) type = height <= 3 ? "sand" : "grass";
            else if (y >= height - 2) type = height <= 3 ? "sand" : "dirt";
            setBlock(x, y, z, type);
          }
        }
      }

      for (let x = -WORLD_RADIUS + 2; x < WORLD_RADIUS - 2; x += 1) {
        for (let z = -WORLD_RADIUS + 2; z < WORLD_RADIUS - 2; z += 1) {
          const ground = terrainHeight(currentSeed, x, z);
          if (ground > 3 && Math.hypot(x, z) > 4 && hash(currentSeed + 91, x * 3, z * 5) > 0.965) {
            const trunkHeight = 3 + Math.floor(hash(currentSeed + 23, x, z) * 2);
            for (let y = 1; y <= trunkHeight; y += 1) setBlock(x, ground + y, z, "wood");
            const crownY = ground + trunkHeight;
            for (let dx = -2; dx <= 2; dx += 1) {
              for (let dz = -2; dz <= 2; dz += 1) {
                for (let dy = -1; dy <= 1; dy += 1) {
                  if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) < 4) {
                    const key = keyOf(x + dx, crownY + dy, z + dz);
                    if (!world.has(key)) world.set(key, "leaves");
                  }
                }
              }
            }
            setBlock(x, crownY + 2, z, "leaves");
          }
        }
      }

      changes.forEach((type, key) => {
        if (type === null) world.delete(key);
        else world.set(key, type);
      });
    };

    const materialKeyForFace = (type: BlockType, faceIndex: number) => {
      if (type === "grass") return faceIndex === 2 ? "grassTop" : faceIndex === 3 ? "dirt" : "grassSide";
      if (type === "wood" && (faceIndex === 2 || faceIndex === 3)) return "woodTop";
      return type;
    };

    const rebuildWorld = () => {
      worldMeshes.forEach((mesh) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
      });
      worldMeshes.length = 0;

      const batches: Record<string, { positions: number[]; normals: number[]; uvs: number[] }> = {};
      Object.keys(materials).forEach((name) => {
        batches[name] = { positions: [], normals: [], uvs: [] };
      });
      const order = [0, 1, 2, 0, 2, 3];
      const faceUvs = [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
      ];

      world.forEach((type, key) => {
        const [x, y, z] = key.split(",").map(Number);
        FACE_DATA.forEach((face, faceIndex) => {
          const [dx, dy, dz] = face.dir;
          if (world.has(keyOf(x + dx, y + dy, z + dz))) return;
          const batch = batches[materialKeyForFace(type, faceIndex)];
          order.forEach((cornerIndex) => {
            const corner = face.corners[cornerIndex];
            batch.positions.push(x + corner[0], y + corner[1], z + corner[2]);
            batch.normals.push(face.normal[0], face.normal[1], face.normal[2]);
            batch.uvs.push(faceUvs[cornerIndex][0], faceUvs[cornerIndex][1]);
          });
        });
      });

      Object.entries(batches).forEach(([materialName, batch]) => {
        if (!batch.positions.length) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.positions, 3));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(batch.normals, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(batch.uvs, 2));
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, materials[materialName]);
        mesh.receiveShadow = true;
        mesh.castShadow = materialName === "wood" || materialName === "leaves";
        scene.add(mesh);
        worldMeshes.push(mesh);
      });
    };

    generateWorld();
    rebuildWorld();

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.012, 1.012, 1.012)),
      new THREE.LineBasicMaterial({ color: 0x101415, transparent: true, opacity: 0.72 }),
    );
    outline.visible = false;
    scene.add(outline);

    const spawnPoint = () =>
      new THREE.Vector3(0.5, terrainHeight(currentSeed, 0, 0) + 1.01, 0.5);
    const playerPosition = spawnPoint();
    const velocity = new THREE.Vector3();
    const keys = new Set<string>();
    let onGround = false;
    let selectedIndex = 0;
    let yaw = Math.PI * 0.15;
    let pitch = -0.08;
    let pointerLocked = false;
    let everPlayed = false;
    let targetBlock: { x: number; y: number; z: number; normal: THREE.Vector3 } | null = null;
    let lastPositionUpdate = 0;

    const saveWorld = () => {
      if (!playerId) return;
      const payload: SavedWorld = {
        userId: playerId,
        seed: currentSeed,
        changes: Array.from(changes.entries()),
        updatedAt: Date.now(),
      };
      callbacksRef.current.onWorldSaved(payload);
    };

    const respawn = () => {
      playerPosition.copy(spawnPoint());
      velocity.set(0, 0, 0);
    };

    const playerIntersectsBlock = (x: number, y: number, z: number) =>
      playerPosition.x + PLAYER_RADIUS > x &&
      playerPosition.x - PLAYER_RADIUS < x + 1 &&
      playerPosition.y + PLAYER_HEIGHT > y &&
      playerPosition.y < y + 1 &&
      playerPosition.z + PLAYER_RADIUS > z &&
      playerPosition.z - PLAYER_RADIUS < z + 1;

    const collideAxis = (axis: "x" | "y" | "z", amount: number) => {
      if (!amount) return;
      playerPosition[axis] += amount;
      if (axis === "x") playerPosition.x = THREE.MathUtils.clamp(playerPosition.x, -WORLD_RADIUS + 0.35, WORLD_RADIUS - 0.35);
      if (axis === "z") playerPosition.z = THREE.MathUtils.clamp(playerPosition.z, -WORLD_RADIUS + 0.35, WORLD_RADIUS - 0.35);

      const minX = Math.floor(playerPosition.x - PLAYER_RADIUS);
      const maxX = Math.floor(playerPosition.x + PLAYER_RADIUS);
      const minY = Math.floor(playerPosition.y);
      const maxY = Math.floor(playerPosition.y + PLAYER_HEIGHT - 0.001);
      const minZ = Math.floor(playerPosition.z - PLAYER_RADIUS);
      const maxZ = Math.floor(playerPosition.z + PLAYER_RADIUS);

      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            if (!world.has(keyOf(x, y, z)) || !playerIntersectsBlock(x, y, z)) continue;
            if (axis === "x") {
              playerPosition.x = amount > 0 ? x - PLAYER_RADIUS : x + 1 + PLAYER_RADIUS;
              velocity.x = 0;
            } else if (axis === "z") {
              playerPosition.z = amount > 0 ? z - PLAYER_RADIUS : z + 1 + PLAYER_RADIUS;
              velocity.z = 0;
            } else if (amount > 0) {
              playerPosition.y = y - PLAYER_HEIGHT;
              velocity.y = 0;
            } else {
              playerPosition.y = y + 1;
              velocity.y = 0;
              onGround = true;
            }
          }
        }
      }
    };

    const raycaster = new THREE.Raycaster();
    raycaster.far = 6;
    const updateTarget = () => {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hit = raycaster.intersectObjects(worldMeshes, false)[0];
      if (!hit?.face) {
        targetBlock = null;
        outline.visible = false;
        return;
      }
      const normal = hit.face.normal.clone();
      const inside = hit.point.clone().addScaledVector(normal, -0.002);
      targetBlock = {
        x: Math.floor(inside.x),
        y: Math.floor(inside.y),
        z: Math.floor(inside.z),
        normal,
      };
      outline.position.set(targetBlock.x + 0.5, targetBlock.y + 0.5, targetBlock.z + 0.5);
      outline.visible = true;
    };

    let audioContext: AudioContext | null = null;
    const playBlockSound = (placing: boolean) => {
      audioContext ??= new AudioContext();
      const length = Math.floor(audioContext.sampleRate * 0.09);
      const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        const fade = 1 - i / length;
        data[i] = (Math.random() * 2 - 1) * fade * (placing ? 0.16 : 0.24);
      }
      const source = audioContext.createBufferSource();
      const filter = audioContext.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = placing ? 720 : 420;
      source.buffer = buffer;
      source.connect(filter).connect(audioContext.destination);
      source.start();
    };

    const editTarget = (place: boolean) => {
      if (!targetBlock) return;
      if (place) {
        const x = targetBlock.x + targetBlock.normal.x;
        const y = targetBlock.y + targetBlock.normal.y;
        const z = targetBlock.z + targetBlock.normal.z;
        if (
          Math.abs(x) >= WORLD_RADIUS ||
          Math.abs(z) >= WORLD_RADIUS ||
          y > 20 ||
          world.has(keyOf(x, y, z)) ||
          playerIntersectsBlock(x, y, z)
        )
          return;
        const type = BLOCKS[selectedIndex].type;
        world.set(keyOf(x, y, z), type);
        changes.set(keyOf(x, y, z), type);
        playBlockSound(true);
        callbacksRef.current.onBlockAction("place");
      } else {
        if (targetBlock.y <= -2) return;
        world.delete(keyOf(targetBlock.x, targetBlock.y, targetBlock.z));
        changes.set(keyOf(targetBlock.x, targetBlock.y, targetBlock.z), null);
        playBlockSound(false);
        callbacksRef.current.onBlockAction("mine");
      }
      rebuildWorld();
      saveWorld();
    };

    const setSelected = (index: number) => {
      selectedIndex = (index + BLOCKS.length) % BLOCKS.length;
      callbacksRef.current.onSelectionChange(selectedIndex);
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!pointerLocked) return;
      yaw -= event.movementX * 0.0022;
      pitch -= event.movementY * 0.0022;
      pitch = THREE.MathUtils.clamp(pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!pointerLocked) return;
      if (event.button === 0) editTarget(false);
      if (event.button === 2) editTarget(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!pointerLocked) return;
      keys.add(event.code);
      if (event.code === "Space") event.preventDefault();
      if (/^Digit[1-7]$/.test(event.code)) setSelected(Number(event.code.slice(-1)) - 1);
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    const onWheel = (event: WheelEvent) => {
      if (!pointerLocked) return;
      setSelected(selectedIndex + (event.deltaY > 0 ? 1 : -1));
    };
    const onPointerLockChange = () => {
      pointerLocked = document.pointerLockElement === renderer.domElement;
      if (pointerLocked) {
        everPlayed = true;
        camera.position.set(playerPosition.x, playerPosition.y + 1.62, playerPosition.z);
      } else {
        keys.clear();
      }
      callbacksRef.current.onLockChange(pointerLocked);
    };
    const onResize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("wheel", onWheel, { passive: true });
    document.addEventListener("pointerlockchange", onPointerLockChange);
    window.addEventListener("resize", onResize);
    onResize();

    gameApi.current = {
      newWorld: () => {
        currentSeed = Math.floor(Math.random() * 999999);
        changes.clear();
        generateWorld();
        rebuildWorld();
        respawn();
        saveWorld();
      },
      play: () => {
        renderer.domElement.requestPointerLock();
      },
      selectBlock: setSelected,
    };

    const clock = new THREE.Clock();
    let animationFrame = 0;
    let elapsed = 0;
    const animate = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsed += dt;

      clouds.forEach((cloud, index) => {
        cloud.position.x += dt * (0.55 + index * 0.025);
        if (cloud.position.x > 52) cloud.position.x = -52;
      });
      const waterPositions = waterGeometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < waterPositions.count; i += 1) {
        const x = waterBase[i * 3];
        const y = waterBase[i * 3 + 1];
        waterPositions.setZ(i, Math.sin(x * 0.35 + elapsed * 1.4) * 0.035 + Math.cos(y * 0.28 + elapsed) * 0.025);
      }
      waterPositions.needsUpdate = true;

      if (pointerLocked) {
        const forward = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
        const strafe = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
        const direction = new THREE.Vector2(strafe, forward);
        if (direction.lengthSq() > 1) direction.normalize();
        const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 7.2 : 4.7;
        const desiredX = (Math.cos(yaw) * direction.x - Math.sin(yaw) * direction.y) * speed;
        const desiredZ = (-Math.sin(yaw) * direction.x - Math.cos(yaw) * direction.y) * speed;
        const response = Math.min(1, dt * (onGround ? 13 : 4));
        velocity.x += (desiredX - velocity.x) * response;
        velocity.z += (desiredZ - velocity.z) * response;
        if (keys.has("Space") && onGround) {
          velocity.y = 8.4;
          onGround = false;
        }
        velocity.y -= 23 * dt;
        onGround = false;
        collideAxis("x", velocity.x * dt);
        collideAxis("z", velocity.z * dt);
        collideAxis("y", velocity.y * dt);
        if (playerPosition.y < -12) respawn();

        camera.position.set(playerPosition.x, playerPosition.y + 1.62, playerPosition.z);
        camera.rotation.set(pitch, yaw, 0);
        updateTarget();

        if (elapsed - lastPositionUpdate > 0.18) {
          lastPositionUpdate = elapsed;
          callbacksRef.current.onPositionChange({
            x: Math.floor(playerPosition.x),
            y: Math.floor(playerPosition.y),
            z: Math.floor(playerPosition.z),
          });
        }
      } else if (!everPlayed) {
        const orbit = elapsed * 0.035;
        camera.position.set(Math.sin(orbit) * 20, 12, Math.cos(orbit) * 20);
        camera.lookAt(0, 4, 0);
        outline.visible = false;
      }

      sky.position.copy(camera.position);
      animationFrame = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      window.removeEventListener("resize", onResize);
      worldMeshes.forEach((mesh) => mesh.geometry.dispose());
      textures.forEach((texture) => texture.dispose());
      Object.values(materials).forEach((material) => material.dispose());
      waterGeometry.dispose();
      waterMaterial.dispose();
      cloudGeometry.dispose();
      cloudMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      gameApi.current = null;
    };
  }, [gameApi]);

  return <div ref={mountRef} className="game-canvas" />;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-mark ${compact ? "brand-mark-compact" : ""}`}>
      <span className="brand-top">BLOCK</span>
      <span className="brand-bottom">HAVEN</span>
    </div>
  );
}

function Hotbar({ selected }: { selected: number }) {
  return (
    <div className="hotbar-wrap" aria-label="Block inventory">
      <div className="selected-name">{BLOCKS[selected].name}</div>
      <div className="hotbar">
        {BLOCKS.map((block, index) => (
          <div className={`hotbar-slot ${selected === index ? "is-selected" : ""}`} key={block.type}>
            <span className="slot-number">{index + 1}</span>
            <span className={`block-swatch ${block.swatch}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusMeters() {
  return (
    <div className="status-meters" aria-label="Player status">
      <div className="meter-row">
        {Array.from({ length: 10 }, (_, index) => (
          <span className="heart" key={index} />
        ))}
      </div>
      <div className="meter-row hunger-row">
        {Array.from({ length: 10 }, (_, index) => (
          <span className="hunger" key={index} />
        ))}
      </div>
    </div>
  );
}

function PlayerProgress({ profile, compact = false }: { profile: PlayerProfile; compact?: boolean }) {
  const needed = xpForNextLevel(profile.level);
  const progress = Math.min(100, (profile.xp / needed) * 100);
  return (
    <div className={`player-progress ${compact ? "player-progress-compact" : ""}`}>
      <span className="level-badge">{profile.level}</span>
      <div className="progress-copy">
        <div className="progress-heading">
          <strong>{profile.username}</strong>
          <span>{profile.xp} / {needed} XP</span>
        </div>
        <div className="xp-track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}

function AuthScreen({
  busy,
  error,
  onAuthenticate,
  onClearError,
}: {
  busy: boolean;
  error: string;
  onAuthenticate: (mode: "sign-in" | "create", username: string, password: string) => Promise<void>;
  onClearError: () => void;
}) {
  const [mode, setMode] = useState<"sign-in" | "create">("sign-in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState("");

  const changeMode = (nextMode: "sign-in" | "create") => {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setLocalError("");
    onClearError();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === "create" && password !== confirmPassword) {
      setLocalError("Passwords do not match.");
      return;
    }
    setLocalError("");
    void onAuthenticate(mode, username, password);
  };

  return (
    <section className="auth-screen">
      <div className="auth-shade" />
      <header className="auth-header">
        <div className="mini-brand">
          <span className="mini-cube" />
          BLOCKHAVEN
        </div>
        <span className="version-tag">PLAYER DATABASE ONLINE</span>
      </header>

      <div className="auth-layout">
        <div className="auth-intro">
          <p className="menu-kicker">Your world. Always waiting.</p>
          <BrandMark />
          <p className="menu-copy">
            Sign in to keep your world, building history, and player level together every time you return.
          </p>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="auth-tabs" aria-label="Account options">
            <button
              className={mode === "sign-in" ? "is-active" : ""}
              type="button"
              onClick={() => changeMode("sign-in")}
            >
              Sign in
            </button>
            <button
              className={mode === "create" ? "is-active" : ""}
              type="button"
              onClick={() => changeMode("create")}
            >
              Create account
            </button>
          </div>
          <div className="auth-form-copy">
            <span className="form-kicker">{mode === "sign-in" ? "Welcome back" : "New adventurer"}</span>
            <h1>{mode === "sign-in" ? "Return to your world" : "Claim your world"}</h1>
            <p>
              {mode === "sign-in"
                ? "Your saved world and level will load automatically."
                : "Create a private player profile on this device."}
            </p>
          </div>
          <label className="field-label">
            Username
            <input
              autoComplete="username"
              autoFocus
              maxLength={16}
              minLength={3}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Enter username"
              required
              spellCheck={false}
              value={username}
            />
          </label>
          <label className="field-label">
            Password
            <input
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              minLength={6}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
              required
              type="password"
              value={password}
            />
          </label>
          {mode === "create" && (
            <label className="field-label field-appear">
              Confirm password
              <input
                autoComplete="new-password"
                minLength={6}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat password"
                required
                type="password"
                value={confirmPassword}
              />
            </label>
          )}
          {(error || localError) && <p className="auth-error">{localError || error}</p>}
          <button className="game-button primary-button auth-submit" disabled={busy} type="submit">
            <span>{busy ? "Opening world..." : mode === "sign-in" ? "Sign in and play" : "Create and play"}</span>
            {!busy && <span className="button-arrow">&#9654;</span>}
          </button>
          <p className="local-save-note">
            Account passwords are hashed. Player data is stored in this browser's local database.
          </p>
        </form>
      </div>
    </section>
  );
}

export default function App() {
  const gameApi = useRef<GameApi | null>(null);
  const startedRef = useRef(false);
  const notificationTimer = useRef<number | null>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [selected, setSelected] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0, z: 0 });
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [world, setWorld] = useState<SavedWorld | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [xpNotice, setXpNotice] = useState<{ reward: number; id: number } | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const resumeSession = async () => {
      try {
        const savedProfile = await restoreSession();
        const savedWorld = savedProfile ? await loadWorld<BlockType>(savedProfile.id) : null;
        if (!active) return;
        setProfile(savedProfile);
        setWorld(savedWorld);
      } catch {
        if (active) setAuthError("The player database could not be opened in this browser.");
      } finally {
        if (active) setSessionLoading(false);
      }
    };
    void resumeSession();
    return () => {
      active = false;
      if (notificationTimer.current) window.clearTimeout(notificationTimer.current);
    };
  }, []);

  const authenticate = async (
    mode: "sign-in" | "create",
    username: string,
    password: string,
  ) => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const nextProfile = mode === "create"
        ? await createAccount(username, password)
        : await signIn(username, password);
      const savedWorld = await loadWorld<BlockType>(nextProfile.id);
      setProfile(nextProfile);
      setWorld(savedWorld);
      setScreen("menu");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    startedRef.current = false;
    setScreen("menu");
    await signOut();
    setProfile(null);
    setWorld(null);
    setLevelUp(null);
    setXpNotice(null);
  };

  const handleWorldSaved = (savedWorld: SavedWorld) => {
    setWorld(savedWorld);
    void saveWorld(savedWorld).catch(() => {
      setAuthError("Your last world change could not be saved.");
    });
  };

  const handleBlockAction = async (action: BlockAction) => {
    if (!profile) return;
    try {
      const result = await addProgress(profile.id, action);
      setProfile((current) => current?.id === result.profile.id ? result.profile : current);
      setXpNotice({ reward: result.reward, id: Date.now() });
      if (result.leveledUp) setLevelUp(result.profile.level);
      if (notificationTimer.current) window.clearTimeout(notificationTimer.current);
      notificationTimer.current = window.setTimeout(() => {
        setXpNotice(null);
        setLevelUp(null);
      }, result.leveledUp ? 2800 : 1000);
    } catch {
      setAuthError("Player progress could not be updated.");
    }
  };

  const enterWorld = (fresh: boolean) => {
    if (fresh) gameApi.current?.newWorld();
    startedRef.current = true;
    gameApi.current?.play();
  };

  const returnToMenu = () => {
    startedRef.current = false;
    setScreen("menu");
  };

  return (
    <main className="game-shell">
      <VoxelGame
        key={profile?.id ?? "player-preview"}
        gameApi={gameApi}
        playerId={profile?.id ?? null}
        initialWorld={world}
        onLockChange={(locked) => {
          if (locked) setScreen("playing");
          else if (startedRef.current) setScreen("paused");
        }}
        onSelectionChange={setSelected}
        onPositionChange={setPosition}
        onWorldSaved={handleWorldSaved}
        onBlockAction={handleBlockAction}
      />

      {sessionLoading && (
        <section className="loading-screen">
          <span className="loading-cube" />
          <strong>Loading player database</strong>
        </section>
      )}

      {!sessionLoading && !profile && (
        <AuthScreen
          busy={authBusy}
          error={authError}
          onAuthenticate={authenticate}
          onClearError={() => setAuthError("")}
        />
      )}

      {!sessionLoading && profile && screen === "menu" && (
        <section className="menu-screen">
          <div className="menu-shade" />
          <header className="menu-header">
            <div className="mini-brand">
              <span className="mini-cube" />
              BLOCKHAVEN
            </div>
            <div className="menu-account">
              <PlayerProgress compact profile={profile} />
              <button className="text-button" onClick={() => void handleSignOut()}>Sign out</button>
            </div>
          </header>

          <div className="menu-content">
            <p className="menu-kicker">A limitless voxel world</p>
            <BrandMark />
            <p className="menu-copy">
              Shape the wild, one block at a time. Every ridge, tree, and shelter is yours to rebuild.
            </p>
            <div className="menu-actions">
              {world && (
                <button className="game-button primary-button" onClick={() => enterWorld(false)}>
                  <span>Continue world</span>
                  <span className="button-arrow">&#9654;</span>
                </button>
              )}
              <button
                className={`game-button ${world ? "secondary-button" : "primary-button"}`}
                onClick={() => enterWorld(true)}
              >
                <span>{world ? "Create new world" : "Enter the world"}</span>
                {!world && <span className="button-arrow">&#9654;</span>}
              </button>
            </div>
          </div>

          <footer className="menu-footer">
            <span>WASD to move</span>
            <span>Mouse to look</span>
            <span>Click to mine</span>
            <span>Right click to build</span>
          </footer>
        </section>
      )}

      {profile && screen === "playing" && (
        <section className="hud" aria-label="Game interface">
          <div className="hud-brand">
            <span className="mini-cube" />
            BLOCKHAVEN
          </div>
          <div className="coordinates">
            X {position.x}&nbsp;&nbsp; Y {position.y}&nbsp;&nbsp; Z {position.z}
          </div>
          <div className="hud-progress">
            <PlayerProgress profile={profile} />
          </div>
          <div className="crosshair" aria-hidden="true">
            <span />
            <span />
          </div>
          <StatusMeters />
          <Hotbar selected={selected} />
          <div className="game-hint">ESC TO PAUSE</div>
        </section>
      )}

      {profile && screen === "paused" && (
        <section className="pause-screen">
          <div className="pause-panel">
            <BrandMark compact />
            <p className="pause-label">Game paused</p>
            <div className="pause-actions">
              <button className="game-button primary-button" onClick={() => gameApi.current?.play()}>
                <span>Back to game</span>
                <span className="button-arrow">&#9654;</span>
              </button>
              <button className="game-button secondary-button" onClick={returnToMenu}>
                Save and quit
              </button>
              <button className="pause-sign-out" onClick={() => void handleSignOut()}>
                Sign out of {profile.username}
              </button>
            </div>
            <p className="autosave-note">Your world saves automatically.</p>
          </div>
        </section>
      )}

      {xpNotice && screen === "playing" && (
        <div className="xp-notice" key={xpNotice.id}>+{xpNotice.reward} XP</div>
      )}

      {levelUp && (
        <div className="level-up-notice">
          <span>Level up</span>
          <strong>{levelUp}</strong>
          <p>New building rank reached</p>
        </div>
      )}
    </main>
  );
}
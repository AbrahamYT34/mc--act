const WebSocket = require('ws');
const { createNoise2D, createNoise3D } = require('simplex-noise');
const noise2D = createNoise2D();
const noise3D = createNoise3D();
const seed = Math.random() * 10000;

// ======== CONSTANTES =========
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const VIEW_DISTANCE = 4; // chunks alrededor del jugador
const BLOCK_TYPES = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WOOD: 4,
  LEAVES: 5,
  SAND: 6,
  WATER: 7,
  GRAVEL: 8,
  COAL_ORE: 9,
  IRON_ORE: 10,
  CRAFTING_TABLE: 11,
  FURNACE: 12,
  // ... añade más si quieres
};

// Propiedades de bloques: nombre, textura, dureza, herramienta, etc.
const BLOCK_PROPS = {
  [BLOCK_TYPES.GRASS]: { name: 'Pasto', hardness: 0.6, tool: 'shovel' },
  [BLOCK_TYPES.DIRT]: { name: 'Tierra', hardness: 0.5, tool: 'shovel' },
  [BLOCK_TYPES.STONE]: { name: 'Piedra', hardness: 1.5, tool: 'pickaxe' },
  [BLOCK_TYPES.WOOD]: { name: 'Madera', hardness: 2.0, tool: 'axe' },
  [BLOCK_TYPES.LEAVES]: { name: 'Hojas', hardness: 0.2, tool: null },
  [BLOCK_TYPES.SAND]: { name: 'Arena', hardness: 0.5, tool: 'shovel' },
  [BLOCK_TYPES.WATER]: { name: 'Agua', hardness: Infinity, tool: null },
  [BLOCK_TYPES.GRAVEL]: { name: 'Grava', hardness: 0.6, tool: 'shovel' },
  [BLOCK_TYPES.COAL_ORE]: { name: 'Carbón', hardness: 3.0, tool: 'pickaxe' },
  [BLOCK_TYPES.IRON_ORE]: { name: 'Hierro', hardness: 3.0, tool: 'pickaxe' },
  [BLOCK_TYPES.CRAFTING_TABLE]: { name: 'Mesa de crafteo', hardness: 2.5, tool: 'axe' },
  [BLOCK_TYPES.FURNACE]: { name: 'Horno', hardness: 3.5, tool: 'pickaxe' },
};

// Mobs
const MOB_TYPES = {
  COW: 'cow',
  PIG: 'pig',
  CHICKEN: 'chicken',
  ZOMBIE: 'zombie',
  SKELETON: 'skeleton',
};

// ======== ESTADO DEL SERVIDOR =========
const chunks = new Map(); // clave "x,z" -> Uint8Array de 16*64*16 con tipo de bloque
const players = new Map(); // ws -> { id, name, pos, health, hunger, inventory, ... }
const mobs = [];
let timeOfDay = 0; // 0-24000 ticks (0 amanecer, 12000 anochecer)

// Generar chunk
function generateChunk(cx, cz) {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  // Altura del terreno usando ruido 2D
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx;
      const wz = baseZ + lz;
      const height = Math.floor(20 + noise2D(wx * 0.01, wz * 0.01) * 15);
      // Bioma: desierto si ruido > 0.5, bosque si ruido < -0.3, etc.
      const biomeNoise = noise2D(wx * 0.005, wz * 0.005);
      let topBlock = BLOCK_TYPES.GRASS;
      let soilBlock = BLOCK_TYPES.DIRT;
      if (biomeNoise > 0.5) { // desierto
        topBlock = BLOCK_TYPES.SAND;
        soilBlock = BLOCK_TYPES.SAND;
      } else if (biomeNoise < -0.3) { // bosque
        topBlock = BLOCK_TYPES.GRASS; // pasto también pero con árboles después
      }

      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        let block = BLOCK_TYPES.AIR;
        if (y <= height) {
          if (y === height) {
            block = topBlock;
            // Generar árboles en bosque
            if (biomeNoise < -0.3 && Math.random() < 0.05) {
              generateTree(blocks, lx, y, lz, baseX, baseZ);
            }
          } else if (y >= height - 3) {
            block = soilBlock;
          } else {
            block = BLOCK_TYPES.STONE;
            // Cuevas con ruido 3D
            const caveNoise = noise3D(wx * 0.05, y * 0.1, wz * 0.05);
            if (caveNoise > 0.3) block = BLOCK_TYPES.AIR;
          }
        }
        setBlock(blocks, lx, y, lz, block);
      }
    }
  }
  return blocks;
}

function generateTree(blocks, lx, groundY, lz, baseX, baseZ) {
  const trunkHeight = 4 + Math.floor(Math.random() * 3);
  // tronco
  for (let dy = 1; dy <= trunkHeight; dy++) {
    if (groundY + dy < CHUNK_HEIGHT) setBlock(blocks, lx, groundY + dy, lz, BLOCK_TYPES.WOOD);
  }
  // hojas
  const leafStart = groundY + trunkHeight - 2;
  for (let dy = leafStart; dy <= groundY + trunkHeight + 1; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && Math.random() > 0.5) continue;
        if (dx === 0 && dz === 0 && dy <= groundY + trunkHeight) continue;
        const wx = lx + dx, wy = dy, wz = lz + dz;
        if (wx >= 0 && wx < CHUNK_SIZE && wy >= 0 && wy < CHUNK_HEIGHT && wz >= 0 && wz < CHUNK_SIZE) {
          if (getBlock(blocks, wx, wy, wz) === BLOCK_TYPES.AIR) setBlock(blocks, wx, wy, wz, BLOCK_TYPES.LEAVES);
        }
      }
    }
  }
}

function setBlock(blocks, x, y, z, type) {
  blocks[x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE] = type;
}

function getBlock(blocks, x, y, z) {
  return blocks[x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE];
}

// Inicializar spawn chunks
for (let cx = -VIEW_DISTANCE; cx <= VIEW_DISTANCE; cx++) {
  for (let cz = -VIEW_DISTANCE; cz <= VIEW_DISTANCE; cz++) {
    chunks.set(`${cx},${cz}`, generateChunk(cx, cz));
  }
}

// ======== MOBS =========
function spawnMobs() {
  // Vacas, cerdos, gallinas
  for (let i = 0; i < 10; i++) {
    const type = [MOB_TYPES.COW, MOB_TYPES.PIG, MOB_TYPES.CHICKEN][Math.floor(Math.random() * 3)];
    mobs.push({
      id: Math.random().toString(36).substr(2, 6),
      type,
      pos: { x: (Math.random() - 0.5) * 20, y: getGroundY(0, 0) + 1, z: (Math.random() - 0.5) * 20 },
      health: 10,
      hostile: false,
    });
  }
}

function getGroundY(wx, wz) {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const chunk = chunks.get(`${cx},${cz}`);
  if (!chunk) return 20;
  const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
    if (getBlock(chunk, lx, y, lz) !== BLOCK_TYPES.AIR) return y + 1;
  }
  return 0;
}

function updateMobs() {
  const now = Date.now();
  for (const mob of mobs) {
    if (mob.hostile) {
      // Perseguir al jugador más cercano si es de noche
      if (timeOfDay > 13000 && timeOfDay < 23000) {
        let closest = null;
        let minDist = 20;
        for (const [ws, player] of players) {
          const dx = mob.pos.x - player.pos.x;
          const dz = mob.pos.z - player.pos.z;
          const dist = Math.sqrt(dx*dx + dz*dz);
          if (dist < minDist) {
            minDist = dist;
            closest = player;
          }
        }
        if (closest) {
          const dx = closest.pos.x - mob.pos.x;
          const dz = closest.pos.z - mob.pos.z;
          const len = Math.sqrt(dx*dx + dz*dz);
          if (len > 0.5) {
            mob.pos.x += (dx / len) * 0.05;
            mob.pos.z += (dz / len) * 0.05;
          }
        }
      }
    } else {
      // Movimiento errático
      if (Math.random() < 0.02) {
        mob.pos.x += (Math.random() - 0.5) * 0.5;
        mob.pos.z += (Math.random() - 0.5) * 0.5;
      }
    }
  }
}

// ======== WEBSOCKET =========
const wss = new WebSocket.Server({ port: process.env.PORT || 3000 });

wss.on('connection', (ws) => {
  const playerId = Math.random().toString(36).substr(2, 6);
  const spawnPos = { x: 0, y: getGroundY(0, 0) + 1, z: 0 };
  players.set(ws, {
    id: playerId,
    pos: spawnPos,
    health: 20,
    maxHealth: 20,
    hunger: 20,
    inventory: new Array(36).fill(null), // 27 inventario + 9 hotbar
    selectedSlot: 0,
  });

  // Enviar ID y spawn
  ws.send(JSON.stringify({ type: 'init', id: playerId, pos: spawnPos }));

  // Enviar chunks cercanos
  sendNearbyChunks(ws);

  // Enviar mobs actuales
  ws.send(JSON.stringify({ type: 'mobs-update', mobs }));

  // Enviar tiempo actual
  ws.send(JSON.stringify({ type: 'time', time: timeOfDay }));

  // Notificar a otros
  broadcast({ type: 'player-joined', id: playerId, pos: spawnPos, health: 20 }, ws);

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    switch (msg.type) {
      case 'position':
        if (players.has(ws)) {
          const p = players.get(ws);
          p.pos = { x: msg.x, y: msg.y, z: msg.z };
          broadcast({ type: 'player-position', id: p.id, x: msg.x, y: msg.y, z: msg.z }, ws);
          // Enviar chunks nuevos si necesario
          sendNearbyChunks(ws);
        }
        break;
      case 'block-update':
        handleBlockUpdate(msg, ws);
        break;
      case 'craft':
        handleCraft(ws, msg.items);
        break;
      // ... más eventos
    }
  });

  ws.on('close', () => {
    if (players.has(ws)) {
      const id = players.get(ws).id;
      players.delete(ws);
      broadcast({ type: 'player-left', id });
    }
  });
});

function sendNearbyChunks(ws) {
  const player = players.get(ws);
  if (!player) return;
  const cx = Math.floor(player.pos.x / CHUNK_SIZE);
  const cz = Math.floor(player.pos.z / CHUNK_SIZE);
  for (let dx = -VIEW_DISTANCE; dx <= VIEW_DISTANCE; dx++) {
    for (let dz = -VIEW_DISTANCE; dz <= VIEW_DISTANCE; dz++) {
      const chunkKey = `${cx + dx},${cz + dz}`;
      if (!chunks.has(chunkKey)) {
        chunks.set(chunkKey, generateChunk(cx + dx, cz + dz));
      }
      ws.send(JSON.stringify({
        type: 'chunk-data',
        cx: cx + dx,
        cz: cz + dz,
        blocks: Array.from(chunks.get(chunkKey))
      }));
    }
  }
}

function handleBlockUpdate(msg, ws) {
  const { x, y, z, blockType } = msg;
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  const chunk = chunks.get(`${cx},${cz}`);
  if (!chunk) return;
  const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  if (y < 0 || y >= CHUNK_HEIGHT) return;
  setBlock(chunk, lx, y, lz, blockType);
  broadcast({ type: 'block-update', x, y, z, blockType }, ws);
}

// ======== BUCLE DEL SERVIDOR =========
setInterval(() => {
  // Actualizar hora del día
  timeOfDay = (timeOfDay + 1) % 24000;
  // Spawn de mobs: noche genera hostiles, día pasivos
  if (timeOfDay === 13000) {
    // Anochecer: spawnea zombies y esqueletos
    for (let i = 0; i < 5; i++) {
      const type = Math.random() < 0.5 ? MOB_TYPES.ZOMBIE : MOB_TYPES.SKELETON;
      mobs.push({
        id: Math.random().toString(36).substr(2, 6),
        type,
        pos: { x: (Math.random() - 0.5) * 20, y: getGroundY(0, 0) + 1, z: (Math.random() - 0.5) * 20 },
        health: 20,
        hostile: true,
      });
    }
  } else if (timeOfDay === 23000) {
    // Amanecer: quita hostiles
    mobs = mobs.filter(m => !m.hostile);
  }
  updateMobs();
  // Enviar tiempo y mobs a todos
  broadcast({ type: 'time', time: timeOfDay });
  broadcast({ type: 'mobs-update', mobs });
}, 50); // 20 ticks por segundo aproximado

function broadcast(msg, exclude = null) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

console.log('Servidor Minecraft Full corriendo en puerto', process.env.PORT || 3000);

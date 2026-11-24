import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const portArgIdx = process.argv.findIndex((arg) => arg === '--port' || arg === '-p');
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    const val = Number(process.argv[portArgIdx + 1]);
    if (!isNaN(val) && val > 0) return val;
  }
  if (process.env.NODE_ENV === 'production' && process.env.PORT) {
    const val = Number(process.env.PORT);
    if (!isNaN(val) && val > 0) return val;
  }
  if (process.env.DEFAULT_APP_PORT) {
    const val = Number(process.env.DEFAULT_APP_PORT);
    if (!isNaN(val) && val > 0) return val;
  }
  if (process.env.APP_PORT) {
    const val = Number(process.env.APP_PORT);
    if (!isNaN(val) && val > 0) return val;
  }
  if (process.env.PORT) {
    const val = Number(process.env.PORT);
    if (!isNaN(val) && val > 0) return val;
  }
  return 3000;
}

const PORT = resolvePort();

interface RoomClient {
  ws: WebSocket;
  peerId: string;
  playerName: string;
  playerColor: string;
  role: 'host' | 'client';
  joinedAt: number;
}

interface RoomState {
  roomCode: string;
  hostPeerId: string;
  hostName: string;
  mapName: string;
  createdAt: number;
  clients: Map<WebSocket, RoomClient>;
  cachedVehicles: Map<string, unknown>;
  cachedWorldMap: unknown | null;
}

const rooms = new Map<string, RoomState>();

function cleanRoomCode(raw: string): string {
  const cleaned = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (cleaned.startsWith('VOX') && cleaned.length >= 6) {
    return `VOX-${cleaned.slice(3, 6)}`;
  }
  const suffix = (cleaned.slice(-3) || '100').padStart(3, '0');
  return `VOX-${suffix}`;
}

async function startServer() {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
  });
  app.use(express.json({ limit: '10mb' }));

  // Health & Active Multiplayer Lobbies API
  app.get('/api/multiplayer/rooms', (_req, res) => {
    const activeRooms: Array<{
      roomCode: string;
      hostPeerId: string;
      hostName: string;
      playerCount: number;
      mapName: string;
      createdAt: number;
    }> = [];

    rooms.forEach((room, code) => {
      if (room.clients.size === 0) {
        rooms.delete(code);
        return;
      }
      activeRooms.push({
        roomCode: room.roomCode,
        hostPeerId: room.hostPeerId,
        hostName: room.hostName,
        playerCount: room.clients.size,
        mapName: room.mapName,
        createdAt: room.createdAt,
      });
    });

    res.json({ rooms: activeRooms });
  });

  const server = http.createServer(app);

  // WebSocket Multiplayer Room Relay Server on /ws-multiplayer
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = request.url || '';
    if (url.startsWith('/ws-multiplayer')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    let currentRoomCode = '';
    let currentPeerId = '';

    ws.on('message', (rawData) => {
      try {
        const text = typeof rawData === 'string' ? rawData : rawData.toString('utf-8');
        const msg = JSON.parse(text) as Record<string, unknown>;
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'WS_ROOM_JOIN') {
          const roomCode = cleanRoomCode(String(msg.roomCode || 'VOX-100'));
          const peerId = String(msg.peerId || `peer_${Date.now()}`);
          const playerName = String(msg.name || msg.playerName || 'Pilot');
          const playerColor = String(msg.color || msg.playerColor || '#38bdf8');
          const role = msg.role === 'host' ? 'host' : 'client';
          const mapName = String(msg.mapName || 'Default Map');

          currentRoomCode = roomCode;
          currentPeerId = peerId;

          let room = rooms.get(roomCode);
          if (!room) {
            room = {
              roomCode,
              hostPeerId: peerId,
              hostName: playerName,
              mapName,
              createdAt: Date.now(),
              clients: new Map(),
              cachedVehicles: new Map(),
              cachedWorldMap: null,
            };
            rooms.set(roomCode, room);
          } else if (role === 'host') {
            room.hostPeerId = peerId;
            room.hostName = playerName;
            room.mapName = mapName;
          }

          room.clients.set(ws, {
            ws,
            peerId,
            playerName,
            playerColor,
            role,
            joinedAt: Date.now(),
          });

          // Acknowledge room connection and provide cached vehicles + world map to newly joined client
          ws.send(
            JSON.stringify({
              type: 'WS_ROOM_JOINED_ACK',
              roomCode,
              hostPeerId: room.hostPeerId,
              peerCount: room.clients.size,
              cachedVehicles: Array.from(room.cachedVehicles.values()),
              cachedWorldMap: room.cachedWorldMap,
            }),
          );
          return;
        }

        // Relay game packet to all other clients in the same room
        const targetRoomCode = cleanRoomCode(
          String(msg.roomCode || currentRoomCode || ''),
        );
        if (!targetRoomCode) return;

        const room = rooms.get(targetRoomCode);
        if (!room) return;

        const packet = (msg.packet || msg) as Record<string, unknown>;
        if (!packet || typeof packet !== 'object' || !('type' in packet)) return;

        // Cache latest SPAWN_VEHICLE and WORLD_MAP_SYNC on the room so late joiners get instant state
        if (packet.type === 'SPAWN_VEHICLE' && typeof packet.vehicleId === 'string') {
          room.cachedVehicles.set(packet.vehicleId, packet);
        } else if (packet.type === 'WORLD_MAP_SYNC') {
          room.cachedWorldMap = packet;
          if (typeof packet.mapLabel === 'string') {
            room.mapName = packet.mapLabel;
          }
        } else if (packet.type === 'PEER_LEAVE' && typeof packet.peerId === 'string') {
          for (const [vid, vPkt] of room.cachedVehicles.entries()) {
            const rec = vPkt as Record<string, unknown>;
            if (rec && rec.ownerPeerId === packet.peerId) {
              room.cachedVehicles.delete(vid);
            }
          }
        }

        const serialized = JSON.stringify(packet);
        room.clients.forEach((client, clientWs) => {
          if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
            try {
              clientWs.send(serialized);
            } catch {
              // Ignore transient send errors
            }
          }
        });
      } catch {
        // Ignore malformed JSON frames
      }
    });

    const cleanupClient = () => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      const removed = room.clients.get(ws);
      room.clients.delete(ws);

      if (removed && currentPeerId) {
        for (const [vid, vPkt] of room.cachedVehicles.entries()) {
          const rec = vPkt as Record<string, unknown>;
          if (rec && rec.ownerPeerId === currentPeerId) {
            room.cachedVehicles.delete(vid);
          }
        }
        const leavePacket = JSON.stringify({
          type: 'PEER_LEAVE',
          peerId: currentPeerId,
        });
        room.clients.forEach((_c, clientWs) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            try {
              clientWs.send(leavePacket);
            } catch {
              // Ignore
            }
          }
        });
      }

      if (room.clients.size === 0) {
        rooms.delete(currentRoomCode);
      } else if (room.hostPeerId === currentPeerId) {
        // Promote oldest remaining client to host
        const nextHost = room.clients.values().next().value as RoomClient | undefined;
        if (nextHost) {
          room.hostPeerId = nextHost.peerId;
          room.hostName = nextHost.playerName;
        }
      }
    };

    ws.on('close', cleanupClient);
    ws.on('error', cleanupClient);
  });

  const distPath = path.join(__dirname, 'dist');
  const distIndexPath = path.join(distPath, 'index.html');
  const useStaticDist =
    process.env.NODE_ENV === 'production' && fs.existsSync(distIndexPath);

  // Bind port 3000 immediately so the container health check succeeds without waiting for Vite bundle warmup
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });

  if (!useStaticDist) {
    let viteInstance: any = null;
    const viteReadyPromise = (async () => {
      const { createServer: createViteServer } = await import('vite');
      viteInstance = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
          watch: null,
        },
        appType: 'spa',
      });
      return viteInstance;
    })();

    app.use(async (req, res, next) => {
      try {
        const vite = viteInstance || (await viteReadyPromise);
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });

    // Fallback for HTML navigation in dev mode
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        const vite = viteInstance || (await viteReadyPromise);
        const indexPath = path.join(__dirname, 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        if (viteInstance) {
          viteInstance.ssrFixStacktrace(e as Error);
        }
        next(e);
      }
    });
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(distIndexPath);
    });
  }
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

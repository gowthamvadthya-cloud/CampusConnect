import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import admin from 'firebase-admin';

// Load environment variables using Node.js 24
try {
  process.loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.warn('Warning: server/.env was not found.');
}

const PORT = Number(process.env.PORT) || 4000;
const domain = '@pondiuni.ac.in';

const retention = Math.max(
  1,
  Math.min(365, Number(process.env.MESSAGE_RETENTION_DAYS) || 30)
);

const configuredOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

const admins = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
);

// Allow local Vite development addresses
function isAllowedOrigin(origin) {
  if (!origin) return true;

  if (configuredOrigins.includes(origin)) return true;

  if (process.env.NODE_ENV === 'production') return false;

  try {
    const url = new URL(origin);
    const host = url.hostname;
    const port = Number(url.port);

    const localHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]';

    const privateIPv4 =
      /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(host);

    return (
      url.protocol === 'http:' &&
      port >= 5173 &&
      port <= 5185 &&
      (localHost || privateIPv4)
    );
  } catch {
    return false;
  }
}

// Express application
const app = express();

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    }
  })
);

app.use(express.json({ limit: '20kb' }));

// Firebase initialization
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error(
    'Missing FIREBASE_SERVICE_ACCOUNT_JSON in server/.env'
  );
}

let serviceAccount;

try {
  serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  );
} catch {
  throw new Error(
    'FIREBASE_SERVICE_ACCOUNT_JSON must contain valid single-line JSON'
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// HTTP and Socket.IO servers
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    }
  },
  maxHttpBufferSize: 8192
});

// Chat matching data
const waiting = new Map([
  ['friends', []],
  ['companion', []],
  ['random', []]
]);

const active = new Map();
const sessions = new Map();
const pending = new Set();
const lastSent = new Map();

// Verify Firebase authentication token
async function authToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Please sign in first');
  }

  const decoded = await admin.auth().verifyIdToken(token, true);

  const firebaseUser = await admin.auth().getUser(decoded.uid);

  const email = (firebaseUser.email || '')
    .trim()
    .toLowerCase();

  if (!firebaseUser.emailVerified || !email.endsWith(domain)) {
    throw new Error(
      'A verified @pondiuni.ac.in email is required'
    );
  }

  const ban = await db
    .collection('bans')
    .doc(decoded.uid)
    .get();

  if (ban.exists) {
    throw new Error('Account suspended');
  }

  return {
    uid: decoded.uid,
    email,
    isAdmin: admins.has(email)
  };
}

// Authentication middleware
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';

    const token = header.replace(/^Bearer\s+/i, '');

    req.user = await authToken(token);

    next();
  } catch (error) {
    res.status(401).json({
      error: error.message
    });
  }
}

// Admin middleware
function requireAdmin(req, res, next) {
  if (!req.user.isAdmin) {
    return res.status(403).json({
      error: 'Forbidden'
    });
  }

  next();
}

// API error handler
function apiError(res, error) {
  console.error('API error:', error.message);

  if (!res.headersSent) {
    res.status(500).json({
      error: 'Server request failed'
    });
  }
}

// Health check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    online: active.size
  });
});

// Current user
app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    email: req.user.email,
    isAdmin: req.user.isAdmin
  });
});

// Admin: View chats
app.get(
  '/api/admin/chats',
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const snap = await db
        .collection('chats')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      res.json(
        snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
      );
    } catch (error) {
      apiError(res, error);
    }
  }
);

// Admin: View chat messages
app.get(
  '/api/admin/chats/:id/messages',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const snap = await db
        .collection('chats')
        .doc(req.params.id)
        .collection('messages')
        .orderBy('createdAt', 'asc')
        .limit(500)
        .get();

      res.json(
        snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
      );
    } catch (error) {
      apiError(res, error);
    }
  }
);

// Admin: View reports
app.get(
  '/api/admin/reports',
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const snap = await db
        .collection('reports')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      res.json(
        snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
      );
    } catch (error) {
      apiError(res, error);
    }
  }
);

// Admin: Ban user
app.post(
  '/api/admin/ban',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const uid = String(req.body?.uid || '').trim();

      if (
        !uid ||
        uid === req.user.uid ||
        uid.length > 128
      ) {
        return res.status(400).json({
          error: 'Invalid UID'
        });
      }

      await db.collection('bans').doc(uid).set({
        by: req.user.uid,
        at: admin.firestore.FieldValue.serverTimestamp()
      });

      for (const [socketId, user] of active) {
        if (user.uid === uid) {
          io.to(socketId).emit('banned');

          io.in(socketId).disconnectSockets(true);
        }
      }

      res.json({ ok: true });
    } catch (error) {
      apiError(res, error);
    }
  }
);

// Report a conversation
app.post('/api/report', requireAuth, async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || '').trim();

    const reason = String(req.body?.reason || '')
      .trim()
      .slice(0, 500);

    if (!chatId || !reason) {
      return res.status(400).json({
        error: 'Chat and reason required'
      });
    }

    const chat = await db
      .collection('chats')
      .doc(chatId)
      .get();

    if (
      !chat.exists ||
      !chat.data().participants?.includes(req.user.uid)
    ) {
      return res.status(403).json({
        error: 'Not your conversation'
      });
    }

    await db.collection('reports').add({
      chatId,
      reason,
      reporter: req.user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ ok: true });
  } catch (error) {
    apiError(res, error);
  }
});

// Broadcast online count
function broadcastCount() {
  io.emit('online', active.size);
}

// Remove user from matching queues
function removeQueue(socketId) {
  for (const [mode, queue] of waiting) {
    waiting.set(
      mode,
      queue.filter(id => id !== socketId)
    );
  }
}

// Leave current chat
async function leave(socket) {
  removeQueue(socket.id);

  const current = sessions.get(socket.id);

  if (!current) return;

  sessions.delete(socket.id);

  const otherId = current.ids.find(
    id => id !== socket.id
  );

  if (otherId) {
    sessions.delete(otherId);

    io.to(otherId).emit('partner_left');
  }

  try {
    await db
      .collection('chats')
      .doc(current.chatId)
      .update({
        endedAt: admin.firestore.FieldValue.serverTimestamp()
      });
  } catch (error) {
    console.error(
      'Could not mark chat ended:',
      error.message
    );
  }
}

// Authenticate Socket.IO connections
io.use(async (socket, next) => {
  try {
    socket.data.user = await authToken(
      socket.handshake.auth?.token
    );

    next();
  } catch (error) {
    next(new Error(error.message));
  }
});

// Socket.IO connection
io.on('connection', socket => {
  const user = socket.data.user;

  // Prevent duplicate logins
  for (const [socketId, previousUser] of active) {
    if (previousUser.uid === user.uid) {
      io.to(socketId).emit('duplicate_login');

      io.in(socketId).disconnectSockets(true);
    }
  }

  active.set(socket.id, user);

  broadcastCount();

  socket.emit('ready');

  // Find a stranger
  socket.on('find', async (data = {}) => {
    const mode = ['friends', 'companion', 'random']
      .includes(data?.mode)
      ? data.mode
      : 'random';

    if (
      mode === 'companion' &&
      data?.adult !== true
    ) {
      return socket.emit(
        'error_message',
        'Companion mode is for adults only.'
      );
    }

    if (pending.has(socket.id)) return;

    pending.add(socket.id);

    try {
      await leave(socket);

      if (!active.has(socket.id)) return;

      const queue = waiting.get(mode);

      let peer = null;

      while (queue.length) {
        const candidate = queue.shift();

        if (
          candidate !== socket.id &&
          active.has(candidate) &&
          !sessions.has(candidate) &&
          !pending.has(candidate)
        ) {
          peer = candidate;
          break;
        }
      }

      if (!peer) {
        queue.push(socket.id);

        socket.emit('searching');

        return;
      }

      pending.add(peer);

      const peerUser = active.get(peer);

      if (!peerUser) {
        queue.push(socket.id);

        socket.emit('searching');

        return;
      }

      const ids = [socket.id, peer];

      const chatRef = db.collection('chats').doc();

      try {
        await chatRef.set({
          participants: [
            user.uid,
            peerUser.uid
          ],
          mode,
          createdAt:
            admin.firestore.FieldValue.serverTimestamp(),
          expiresAt:
            admin.firestore.Timestamp.fromMillis(
              Date.now() + retention * 86400000
            )
        });

        if (!ids.every(id => active.has(id))) {
          await chatRef.update({
            endedAt:
              admin.firestore.FieldValue.serverTimestamp()
          });

          if (active.has(socket.id)) {
            socket.emit('idle');
          }

          if (active.has(peer)) {
            io.to(peer).emit('idle');
          }

          return;
        }

        for (const id of ids) {
          sessions.set(id, {
            chatId: chatRef.id,
            ids
          });
        }

        for (const id of ids) {
          io.to(id).emit('matched', {
            chatId: chatRef.id
          });
        }
      } catch (error) {
        console.error(
          'Matching failed:',
          error.message
        );

        socket.emit(
          'error_message',
          'Could not create chat'
        );

        io.to(peer).emit(
          'error_message',
          'Could not create chat'
        );
      } finally {
        pending.delete(peer);
      }
    } catch (error) {
      console.error(
        'Find failed:',
        error.message
      );

      socket.emit(
        'error_message',
        'Could not find a partner'
      );
    } finally {
      pending.delete(socket.id);
    }
  });

  // Send a message
  socket.on('message', async value => {
    const current = sessions.get(socket.id);

    if (!current) return;

    const text = String(value ?? '')
      .trim()
      .slice(0, 1000);

    if (
      !text ||
      Date.now() - (lastSent.get(socket.id) || 0) < 500
    ) {
      return;
    }

    lastSent.set(
      socket.id,
      Date.now()
    );

    try {
      await db
        .collection('chats')
        .doc(current.chatId)
        .collection('messages')
        .add({
          sender: user.uid,
          text,
          createdAt:
            admin.firestore.FieldValue.serverTimestamp(),
          expiresAt:
            admin.firestore.Timestamp.fromMillis(
              Date.now() + retention * 86400000
            )
        });

      io.to(current.ids).emit('message', {
        sender: user.uid,
        text,
        time: new Date().toISOString()
      });
    } catch (error) {
      console.error(
        'Message save failed:',
        error.message
      );

      socket.emit(
        'error_message',
        'Message failed to send'
      );
    }
  });

  // Next stranger
  socket.on('next', async () => {
    if (pending.has(socket.id)) return;

    pending.add(socket.id);

    try {
      await leave(socket);

      socket.emit('idle');
    } finally {
      pending.delete(socket.id);
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    active.delete(socket.id);

    lastSent.delete(socket.id);

    removeQueue(socket.id);

    await leave(socket);

    broadcastCount();
  });
});

// Start backend server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(
    `CampusConnect server running on port ${PORT}`
  );

  console.log(
    'Allowed frontend origins:',
    configuredOrigins.length
      ? configuredOrigins.join(', ')
      : 'local Vite origins in development'
  );
});
import {
  db,
  requireUser,
  method,
  FieldValue,
  Timestamp
} from '../_lib/firebase.js';

const QUEUE_TIMEOUT = 60000;

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;

  const user = await requireUser(req, res);
  if (!user) return;

  const allowedModes = ['friends', 'companion', 'random'];

  const mode = allowedModes.includes(req.body?.mode)
    ? req.body.mode
    : 'random';

  const adult = req.body?.adult === true;

  if (mode === 'companion' && !adult) {
    return res.status(400).json({
      error: 'Companion mode is for adults only.'
    });
  }

  const now = Date.now();

  const queueRef = db.collection('matchQueues').doc(user.uid);
  const sessionRef = db.collection('userSessions').doc(user.uid);

  try {
    const result = await db.runTransaction(async (tx) => {
      // Read the current user's session and queue.
      const sessionSnap = await tx.get(sessionRef);
      const ownQueueSnap = await tx.get(queueRef);

      let activeChat = null;

      if (sessionSnap.exists && sessionSnap.data().chatId) {
        const chatRef = db.collection('chats')
          .doc(sessionSnap.data().chatId);

        const chatSnap = await tx.get(chatRef);

        if (chatSnap.exists && !chatSnap.data().endedAt) {
          activeChat = chatRef.id;
        }
      }

      if (activeChat) {
        return {
          status: 'matched',
          chatId: activeChat
        };
      }

      // Find waiting students using the same mode.
      const candidatesQuery = db.collection('matchQueues')
        .where('mode', '==', mode)
        .where('status', '==', 'waiting')
        .limit(30);

      const candidatesSnap = await tx.get(candidatesQuery);

      let selectedPeer = null;

      for (const candidate of candidatesSnap.docs) {
        if (candidate.id === user.uid) continue;

        const data = candidate.data();

        if (
          data.uid !== candidate.id ||
          data.status !== 'waiting' ||
          data.mode !== mode
        ) {
          continue;
        }

        const lastActivity =
          data.lastSeenAt?.toMillis?.() ??
          data.createdAt?.toMillis?.() ??
          0;

        if (
          lastActivity > now ||
          now - lastActivity >= QUEUE_TIMEOUT
        ) {
          continue;
        }

        const peerSessionRef = db.collection('userSessions')
          .doc(candidate.id);

        const peerSessionSnap = await tx.get(peerSessionRef);

        if (peerSessionSnap.exists && peerSessionSnap.data().chatId) {
          continue;
        }

        selectedPeer = candidate;
        break;
      }

      // All transaction reads are complete.
      if (!selectedPeer) {
        const existing = ownQueueSnap.exists
          ? ownQueueSnap.data()
          : null;

        const createdAt =
          existing?.status === 'waiting' &&
          existing?.mode === mode
            ? existing.createdAt
            : Timestamp.fromMillis(now);

        if (sessionSnap.exists) {
          tx.delete(sessionRef);
        }

        tx.set(queueRef, {
          uid: user.uid,
          mode,
          adult,
          status: 'waiting',
          createdAt,
          lastSeenAt: Timestamp.fromMillis(now),
          updatedAt: FieldValue.serverTimestamp()
        });

        return { status: 'waiting' };
      }

      const peerUid = selectedPeer.id;

      const peerQueueRef = db.collection('matchQueues')
        .doc(peerUid);

      const peerSessionRef = db.collection('userSessions')
        .doc(peerUid);

      const chatRef = db.collection('chats').doc();

      tx.set(chatRef, {
        participants: [user.uid, peerUid],
        mode,
        createdAt: FieldValue.serverTimestamp(),
        endedAt: null,
        expiresAt: Timestamp.fromMillis(
          now + 30 * 24 * 60 * 60 * 1000
        )
      });

      tx.set(sessionRef, {
        chatId: chatRef.id,
        partnerUid: peerUid,
        mode,
        updatedAt: FieldValue.serverTimestamp()
      });

      tx.set(peerSessionRef, {
        chatId: chatRef.id,
        partnerUid: user.uid,
        mode,
        updatedAt: FieldValue.serverTimestamp()
      });

      tx.delete(queueRef);
      tx.delete(peerQueueRef);

      return {
        status: 'matched',
        chatId: chatRef.id
      };
    });

    return res.status(200).json(result);

  } catch (error) {
    console.error('match/find:', error);

    return res.status(500).json({
      error: 'Could not find a partner. Please try again.'
    });
  }
}
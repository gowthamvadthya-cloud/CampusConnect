import {
  db,
  requireUser,
  method,
  Timestamp,
  FieldValue
} from '../_lib/firebase.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const now = Date.now();

    const sessionRef = db.collection('userSessions').doc(user.uid);
    const queueRef = db.collection('matchQueues').doc(user.uid);
    const presenceRef = db.collection('presence').doc(user.uid);

    // Check whether the student is already matched.
    const session = await sessionRef.get();

    if (session.exists && session.data().chatId) {
      const chat = await db.collection('chats')
        .doc(session.data().chatId)
        .get();

      if (chat.exists && !chat.data().endedAt) {
        await presenceRef.set({
          uid: user.uid,
          expiresAt: Timestamp.fromMillis(now + 45000),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        return res.status(200).json({
          status: 'matched',
          chatId: chat.id,
          online: 0
        });
      }

      // Remove the session only if it still points to this chat.
      await db.runTransaction(async (tx) => {
        const latest = await tx.get(sessionRef);

        if (
          latest.exists &&
          latest.data().chatId === session.data().chatId
        ) {
          tx.delete(sessionRef);
        }
      });
    }

    // Refresh the waiting queue safely.
    const waiting = await db.runTransaction(async (tx) => {
      const queue = await tx.get(queueRef);

      if (!queue.exists || queue.data().status !== 'waiting') {
        return false;
      }

      const lastActivity =
        queue.data().lastSeenAt?.toMillis?.() ??
        queue.data().createdAt?.toMillis?.() ??
        0;

      if (now - lastActivity >= 60000) {
        tx.delete(queueRef);
        return false;
      }

      tx.update(queueRef, {
        lastSeenAt: Timestamp.fromMillis(now),
        updatedAt: FieldValue.serverTimestamp()
      });

      return true;
    });

    await presenceRef.set({
      uid: user.uid,
      expiresAt: Timestamp.fromMillis(now + 45000),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return res.status(200).json({
      status: waiting ? 'waiting' : 'idle',
      online: 0
    });

  } catch (error) {
    console.error('match/status:', error);

    return res.status(500).json({
      error: 'Could not check match status.'
    });
  }
}
import { db, requireUser, method, FieldValue } from '../_lib/firebase.js';
export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  const user = await requireUser(req, res); if (!user) return;
  try {
    await db.runTransaction(async tx => {
      const sessionRef = db.collection('userSessions').doc(user.uid);
      const queueRef = db.collection('matchQueues').doc(user.uid);
      const [session, queue] = await Promise.all([tx.get(sessionRef), tx.get(queueRef)]);
      let chatSnap = null, chatRef = null, peerRef = null, peerSnap = null;
      if (session.exists && session.data().chatId) {
        chatRef = db.collection('chats').doc(session.data().chatId);
        chatSnap = await tx.get(chatRef);
        if (chatSnap.exists) {
          const peerUid = (chatSnap.data().participants || []).find(uid => uid !== user.uid);
          if (peerUid) { peerRef = db.collection('userSessions').doc(peerUid); peerSnap = await tx.get(peerRef); }
        }
      }
      // All reads are complete; now mutate state.
      if (session.exists) tx.delete(sessionRef);
      if (queue.exists) tx.delete(queueRef);
      if (chatSnap?.exists && !chatSnap.data().endedAt) tx.update(chatRef, { endedAt: FieldValue.serverTimestamp() });
      if (peerSnap?.exists && peerSnap.data().chatId === chatRef?.id) tx.delete(peerRef);
    });
    await db.collection('presence').doc(user.uid).delete().catch(() => {});
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('match/next', e.message);
    return res.status(500).json({ error: 'Could not leave chat.' });
  }
}

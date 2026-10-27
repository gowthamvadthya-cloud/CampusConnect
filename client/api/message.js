import { db, requireUser, method, FV, TS } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;

  const user = await requireUser(req, res);
  if (!user) return;

  const chatId = typeof req.body?.chatId === 'string'
    ? req.body.chatId
    : '';

  const text = typeof req.body?.text === 'string'
    ? req.body.text.trim()
    : '';

  if (!chatId || chatId.includes('/') || !text || text.length > 1000) {
    return res.status(400).json({
      error: 'Message must contain 1-1000 characters.'
    });
  }

  try {
    const chatRef = db.collection('chats').doc(chatId);
    const messageRef = chatRef.collection('messages').doc();

    await db.runTransaction(async (tx) => {
      const chat = await tx.get(chatRef);

      if (
        !chat.exists ||
        chat.data().endedAt ||
        !chat.data().participants?.includes(user.uid)
      ) {
        throw new Error('CHAT_NOT_ACTIVE');
      }

      tx.create(messageRef, {
        sender: user.uid,
        text,
        createdAt: FV.serverTimestamp(),
        expiresAt: TS.fromMillis(Date.now() + 30 * 86400000)
      });
    });

    return res.status(200).json({ ok: true });

  } catch (error) {
    if (error.message === 'CHAT_NOT_ACTIVE') {
      return res.status(403).json({
        error: 'You are not an active participant.'
      });
    }

    console.error('message:', error);
    return res.status(500).json({
      error: 'Message could not be sent.'
    });
  }
}
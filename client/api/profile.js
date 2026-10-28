import { db, requireUser, method, FieldValue } from './_lib/firebase.js';
const genders = ['male', 'female', 'other'];
const preferences = [...genders, 'any'];
const valid = p => p && genders.includes(p.gender) && preferences.includes(p.matchPreference);
export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  const user = await requireUser(req, res);
  if (!user) return;
  const ref = db.collection('userProfiles').doc(user.uid);
  try {
    if (req.method === 'GET') {
      const snap = await ref.get();
      const p = snap.data();
      return res.status(200).json({complete: !!valid(p), profile: valid(p) ? {gender:p.gender, matchPreference:p.matchPreference} : null});
    }
    const {gender, matchPreference} = req.body || {};
    if (!valid({gender,matchPreference})) return res.status(400).json({error:'Choose a valid gender and matching preference.'});
    await db.runTransaction(async tx => {
      const queueRef = db.collection('matchQueues').doc(user.uid);
      const sessionRef = db.collection('userSessions').doc(user.uid);
      const [queue,session] = await Promise.all([tx.get(queueRef),tx.get(sessionRef)]);
      if (queue.exists || session.exists) throw new Error('Leave your chat or cancel searching before editing your profile.');
      tx.set(ref,{gender,matchPreference,updatedAt:FieldValue.serverTimestamp()},{merge:true});
    });
    return res.status(200).json({success:true,profile:{gender,matchPreference}});
  } catch (e) {
    console.error('profile:',e);
    return res.status(e.message?.startsWith('Leave your chat') ? 409 : 500).json({error:e.message?.startsWith('Leave your chat') ? e.message : 'Could not save profile.'});
  }
}

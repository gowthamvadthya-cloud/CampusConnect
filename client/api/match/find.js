import {db, requireUser, method, FieldValue, Timestamp} from '../_lib/firebase.js';
const TIMEOUT = 60000;
const GENDERS = ['male','female','other'];
const PREFS = [...GENDERS,'any'];
const valid = p => p && GENDERS.includes(p.gender) && PREFS.includes(p.matchPreference);
const accepts = (preference, gender) => preference === 'any' || preference === gender;
export default async function handler(req,res) {
  if (!method(req,res,['POST'])) return;
  const user = await requireUser(req,res);
  if (!user) return;
  const modes = ['friends','companion','random'];
  const mode = modes.includes(req.body?.mode) ? req.body.mode : 'random';
  const adult = req.body?.adult === true;
  if (mode === 'companion' && !adult) return res.status(400).json({error:'Companion mode is for adults only.'});
  const now = Date.now();
  const queueRef = db.collection('matchQueues').doc(user.uid);
  const sessionRef = db.collection('userSessions').doc(user.uid);
  const profileRef = db.collection('userProfiles').doc(user.uid);
  try {
    const result = await db.runTransaction(async tx => {
      const [ownProfile, ownSession, ownQueue] = await Promise.all([tx.get(profileRef),tx.get(sessionRef),tx.get(queueRef)]);
      const mine = ownProfile.data();
      if (!valid(mine)) return {status:'profile_required'};
      if (ownSession.exists && ownSession.data().chatId) {
        const existingChat = await tx.get(db.collection('chats').doc(ownSession.data().chatId));
        if (existingChat.exists && !existingChat.data().endedAt) return {status:'matched',chatId:existingChat.id};
      }
      const candidates = await tx.get(db.collection('matchQueues').where('mode','==',mode).where('status','==','waiting').limit(30));
      let selected = null;
      for (const candidate of candidates.docs) {
        if (candidate.id === user.uid) continue;
        const data = candidate.data();
        const last = data.lastSeenAt?.toMillis?.() ?? data.createdAt?.toMillis?.() ?? 0;
        if (data.uid !== candidate.id || data.mode !== mode || data.status !== 'waiting' || last > now || now-last >= TIMEOUT) continue;
        if (mode === 'companion' && !data.adult) continue;
        const peerSession = await tx.get(db.collection('userSessions').doc(candidate.id));
        if (peerSession.exists && peerSession.data().chatId) continue;
        const peerProfile = await tx.get(db.collection('userProfiles').doc(candidate.id));
        const peer = peerProfile.data();
        if (!valid(peer)) continue;
        if (!accepts(mine.matchPreference,peer.gender) || !accepts(peer.matchPreference,mine.gender)) continue;
        selected = candidate;
        break;
      }
      if (!selected) {
        const previous = ownQueue.data();
        const createdAt = previous?.status === 'waiting' && previous.mode === mode ? previous.createdAt : Timestamp.fromMillis(now);
        if (ownSession.exists) tx.delete(sessionRef);
        tx.set(queueRef,{uid:user.uid,mode,adult,status:'waiting',createdAt,lastSeenAt:Timestamp.fromMillis(now),updatedAt:FieldValue.serverTimestamp()});
        return {status:'waiting'};
      }
      const peerUid = selected.id;
      const chatRef = db.collection('chats').doc();
      tx.set(chatRef,{participants:[user.uid,peerUid],mode,createdAt:FieldValue.serverTimestamp(),endedAt:null,expiresAt:Timestamp.fromMillis(now+30*24*60*60*1000)});
      tx.set(sessionRef,{chatId:chatRef.id,partnerUid:peerUid,mode,updatedAt:FieldValue.serverTimestamp()});
      tx.set(db.collection('userSessions').doc(peerUid),{chatId:chatRef.id,partnerUid:user.uid,mode,updatedAt:FieldValue.serverTimestamp()});
      tx.delete(queueRef);
      tx.delete(db.collection('matchQueues').doc(peerUid));
      return {status:'matched',chatId:chatRef.id};
    });
    if (result.status === 'profile_required') return res.status(400).json({error:'Complete your profile before searching.'});
    return res.status(200).json(result);
  } catch (e) {
    console.error('match/find:',e);
    return res.status(500).json({error:'Could not find a partner. Please try again.'});
  }
}

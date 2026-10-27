import admin from 'firebase-admin';
if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
  admin.initializeApp({credential: admin.credential.cert(JSON.parse(raw))});
}
export const db=admin.firestore(), auth=admin.auth(), FV=admin.firestore.FieldValue, TS=admin.firestore.Timestamp;
export function method(req,res,allowed){if(!allowed.includes(req.method)){res.setHeader('Allow',allowed.join(', '));res.status(405).json({error:'Method not allowed'});return false}return true}
export async function requireUser(req,res){const m=(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i);if(!m){res.status(401).json({error:'Please sign in.'});return null}try{const d=await auth.verifyIdToken(m[1],true),u=await auth.getUser(d.uid),email=(u.email||'').toLowerCase();if(!u.emailVerified||!email.endsWith('@pondiuni.ac.in')){res.status(403).json({error:'A verified @pondiuni.ac.in email is required.'});return null}if((await db.collection('bans').doc(d.uid).get()).exists){res.status(403).json({error:'Account suspended.'});return null}const admins=(process.env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase());return {uid:d.uid,email,isAdmin:admins.includes(email)}}catch{res.status(401).json({error:'Session expired. Sign in again.'});return null}}
export function adminOnly(u,res){if(!u.isAdmin){res.status(403).json({error:'Forbidden'});return false}return true}
export const FieldValue = FV;
export const Timestamp = TS;


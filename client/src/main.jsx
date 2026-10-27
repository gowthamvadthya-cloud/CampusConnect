import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, signOut, reload } from 'firebase/auth';
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import './style.css';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
});
const auth = getAuth(app), db = getFirestore(app);

function App() {
  const [user,setUser]=useState(null),[loading,setLoading]=useState(true);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[register,setRegister]=useState(false);
  const [notice,setNotice]=useState(''),[consent,setConsent]=useState(false),[mode,setMode]=useState('friends'),[adult,setAdult]=useState(false);
  const [status,setStatus]=useState('idle'),[chatId,setChatId]=useState(''),[messages,setMessages]=useState([]),[draft,setDraft]=useState('');
  const [isAdmin,setIsAdmin]=useState(false),[adminMode,setAdminMode]=useState(false),[chats,setChats]=useState([]),[reports,setReports]=useState([]),[selected,setSelected]=useState(null),[history,setHistory]=useState([]);
  const bottom=useRef(null), msgUnsub=useRef(null), timer=useRef(null), statusRef=useRef('idle');
  useEffect(()=>{statusRef.current=status},[status]);
  useEffect(()=>onAuthStateChanged(auth,u=>{setUser(u?{uid:u.uid,email:u.email,emailVerified:u.emailVerified}:null);setLoading(false)}),[]);

  async function api(path,options={}){
    if(!auth.currentUser) throw new Error('Please sign in first.');
    const token=await auth.currentUser.getIdToken();
    const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...(options.headers||{})}});
    const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error||'Request failed'); return data;
  }
  useEffect(()=>{if(!user?.emailVerified)return;let active=true;api('/api/me').then(x=>{if(active)setIsAdmin(!!x.isAdmin)}).catch(e=>active&&setNotice(e.message));return()=>{active=false}},[user]);
  useEffect(()=>{
    if(msgUnsub.current){msgUnsub.current();msgUnsub.current=null}
    if(!chatId||status!=='matched'){setMessages([]);return}
    const q=query(collection(db,'chats',chatId,'messages'),orderBy('createdAt','asc'),limit(300));
    msgUnsub.current=onSnapshot(q,s=>setMessages(s.docs.map(d=>({id:d.id,...d.data()}))),e=>setNotice('Message listener: '+e.message));
    return()=>{if(msgUnsub.current){msgUnsub.current();msgUnsub.current=null}}
  },[chatId,status]);
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'})},[messages]);
  useEffect(()=>{
    if(!user?.emailVerified||!consent||!['searching','matched'].includes(status)){if(timer.current)clearInterval(timer.current);timer.current=null;return}
    let active=true;
    const check=async()=>{try{const x=await api('/api/match/status');if(!active)return;if(x.status==='matched'&&x.chatId){setChatId(x.chatId);setStatus('matched')}else if (x.status === 'waiting') {
  setStatus('searching');
} else if (x.status === 'idle') {
  if (statusRef.current === 'matched') {
    setChatId('');
    setStatus('left');
    setNotice('Your partner left the chat.');
  } else if (statusRef.current === 'searching') {
    setStatus('idle');
    setNotice('Search expired. Click Find a Stranger to try again.');
  }
}}catch(e){if(active)setNotice(e.message)}};
    check();timer.current=setInterval(check,2000);return()=>{active=false;if(timer.current)clearInterval(timer.current);timer.current=null}
  },[user,consent,status]);

  async function authSubmit(e){e.preventDefault();setNotice('');try{if(!email.trim().toLowerCase().endsWith('@pondiuni.ac.in'))throw new Error('Use your @pondiuni.ac.in university email.');if(register){const c=await createUserWithEmailAndPassword(auth,email.trim(),password);await sendEmailVerification(c.user);setNotice('Verification email sent. Check your inbox and spam folder.')}else await signInWithEmailAndPassword(auth,email.trim(),password)}catch(e){setNotice(e.message)}}
  async function refreshVerified(){try{await reload(auth.currentUser);setUser({uid:auth.currentUser.uid,email:auth.currentUser.email,emailVerified:auth.currentUser.emailVerified});setNotice(auth.currentUser.emailVerified?'Email verified!':'Email is not verified yet.')}catch(e){setNotice(e.message)}}
  async function find(){if(mode==='companion'&&!adult){setNotice('Confirm you are 18 or older to use Companion Mode.');return}try{setNotice('');setMessages([]);setChatId('');setStatus('searching');const x=await api('/api/match/find',{method:'POST',body:JSON.stringify({mode,adult})});if(x.status==='matched'){setChatId(x.chatId);setStatus('matched')}else setStatus('searching')}catch(e){setStatus('idle');setNotice(e.message)}}
  async function leave(){try{await api('/api/match/next',{method:'POST',body:'{}'})}catch(e){setNotice(e.message)}setStatus('idle');setChatId('');setMessages([]);setDraft('')}
  async function send(e){e.preventDefault();const text=draft.trim();if(!text||!chatId||status!=='matched')return;setDraft('');try{await api('/api/message',{method:'POST',body:JSON.stringify({chatId,text})})}catch(e){setDraft(text);setNotice(e.message)}}
  async function report(){if(!chatId)return;const reason=prompt('What happened? Please do not include sensitive information.');if(reason===null)return;try{await api('/api/report',{method:'POST',body:JSON.stringify({chatId,reason})});setNotice('Report submitted.');await leave()}catch(e){setNotice(e.message)}}
  async function loadAdmin(){try{const [c,r]=await Promise.all([api('/api/admin/chats'),api('/api/admin/reports')]);setChats(c);setReports(r);setAdminMode(true)}catch(e){setNotice(e.message)}}
  async function selectChat(c){setSelected(c);try{setHistory(await api(`/api/admin/chats/${c.id}/messages`))}catch(e){setNotice(e.message)}}
  async function ban(uid){if(!confirm('Suspend this user?'))return;try{await api('/api/admin/ban',{method:'POST',body:JSON.stringify({uid})});setNotice('User suspended.')}catch(e){setNotice(e.message)}}

  if(loading)return <main className="center">Loading CampusConnect…</main>;
  return <main className="wrap">
    <header><div className="logo">💜 Campus<span>Connect</span></div><div className="right">{user&&<button className="ghost" onClick={()=>signOut(auth)}>Sign out</button>}</div></header>
    <section className="hero"><span className="tag">🎓 EXCLUSIVELY FOR PONDICHERRY UNIVERSITY</span><h1>Strangers today.<br/><em>Connections tomorrow.</em></h1><p>Meet people on your campus through spontaneous, anonymous conversations.</p></section>
    {notice&&<div className="notice" role="alert">{notice}<button onClick={()=>setNotice('')}>×</button></div>}
    {!user?<section className="card narrow"><h2>{register?'Create student account':'Welcome back'}</h2><p>Use a verified @pondiuni.ac.in email address.</p><form onSubmit={authSubmit}><label>University email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@pondiuni.ac.in"/></label><label>Password<input type="password" minLength="6" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters"/></label><button className="primary">{register?'Register':'Sign in'}</button></form><button className="link" onClick={()=>setRegister(!register)}>{register?'Already registered? Sign in':'New here? Create account'}</button></section>
    :!user.emailVerified?<section className="card narrow"><h2>Verify your email ✉️</h2><p>Open the verification email, click the link, then return here.</p><button className="primary" onClick={refreshVerified}>I've verified my email</button><button className="ghost" onClick={async()=>{try{await sendEmailVerification(auth.currentUser);setNotice('Verification email sent.')}catch(e){setNotice(e.message)}}}>Resend verification</button></section>
    :!consent?<section className="card narrow"><h2>Before you chat 🔒</h2><p><strong>Privacy notice:</strong> Chats are anonymous to other students, not private from authorized administrators. Messages and participant account IDs may be stored for moderation and safety. Do not share sensitive information. You may report or leave a chat at any time.</p><label className="check"><input type="checkbox" checked={adult} onChange={e=>setAdult(e.target.checked)}/> I am 18 or older (required for Companion Mode).</label><button className="primary" onClick={()=>setConsent(true)}>I understand and agree</button></section>
    :adminMode?<section className="card"><div className="row"><h2>👑 Admin dashboard</h2><button className="ghost" onClick={()=>setAdminMode(false)}>Back to chat</button><button onClick={loadAdmin}>Refresh</button></div><div className="adminGrid"><div><h3>Recent conversations</h3>{chats.map(c=><button className="listItem" key={c.id} onClick={()=>selectChat(c)}>{c.mode} · {c.id.slice(0,10)}</button>)}<h3>Reports</h3>{reports.map(r=><button className="listItem" key={r.id} onClick={()=>{const c=chats.find(x=>x.id===r.chatId);if(c)selectChat(c)}}>{r.reason||'Report'} · {r.chatId?.slice(0,8)}</button>)}</div><div><h3>{selected?'Conversation messages':'Select a conversation'}</h3><div className="history">{history.map(m=><div className="historyLine" key={m.id}><b>{m.sender?.slice(0,8)}:</b> {m.text}</div>)}</div>{selected?.participants?.map(uid=><button className="danger" key={uid} onClick={()=>ban(uid)}>Suspend {uid.slice(0,8)}</button>)}</div></div></section>
    :<section className="card chatCard"><div className="row"><div><h2>✨ Find your connection</h2><p>Choose a mode and meet other students.</p></div>{isAdmin&&<button className="ghost" onClick={loadAdmin}>👑 Admin</button>}</div><div className="modes">{[['friends','🤝 Friendship'],['companion','❤️ Companion (18+)'],['random','🎲 Random']].map(([id,label])=><button key={id} className={mode===id?'selected':''} disabled={status==='matched'||status==='searching'} onClick={()=>setMode(id)}>{label}</button>)}</div><div className="chatBox"><div className="chatTop">🎭 Anonymous Stranger <span className="status">{status==='matched'?'🟢 Connected':status==='searching'?'🔎 Searching':status==='left'?'⚪ Partner left':'⚪ Not connected'}</span></div><div className="messages">{messages.length?messages.map(m=><div key={m.id} className={'bubble '+(m.sender===user.uid?'mine':'theirs')}><small>{m.sender===user.uid?'You':'Stranger'}</small>{m.text}</div>):<div className="empty">{status==='matched'?'Say hello 👋':status==='searching'?'Looking for another student…':status==='left'?'Your partner disconnected. Find someone new!':'Your next campus connection is one click away 💜'}</div>}<div ref={bottom}/></div><form className="composer" onSubmit={send}><input value={draft} maxLength={1000} disabled={status!=='matched'} onChange={e=>setDraft(e.target.value)} placeholder={status==='matched'?'Write a message…':'Connect to start chatting'}/><button disabled={status!=='matched'||!draft.trim()}>Send ➤</button></form></div><div className="actions">{['idle','left'].includes(status)?<button className="primary" onClick={find}>💜 Find a Stranger</button>:status==='searching'?<button className="ghost" onClick={leave}>Cancel search</button>:<><button className="primary" onClick={async()=>{await leave();setTimeout(find,250)}}>⏭ Next Stranger</button><button className="danger" onClick={report}>🚩 Report</button><button className="ghost" onClick={leave}>Leave</button></>}</div></section>}
    <footer>Made for students, by students · Anonymous to peers, monitored for safety · CampusConnect © 2026</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);

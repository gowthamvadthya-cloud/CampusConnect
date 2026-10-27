# CampusConnect — full-stack starter

This is a complete runnable **MVP** with verified university email, anonymous peer chat, matchmaking, stored messages, reports, bans, and an admin viewer. It is **not** independently production-certified or load-tested for 500 simultaneous users.

## 1. Firebase setup

Create a Firebase project. Enable Authentication > Email/Password, and create a Cloud Firestore database. Add `localhost` and your production frontend domain to Firebase Authentication authorized domains. In Firebase project settings create a web app and copy its config into `client/.env` based on `client/.env.example`.

In Firebase Console > Project settings > Service accounts, generate a new private key. Do **not** put it in `client/`, Git, or a public host. Put the entire service-account JSON **on one line** as the value of `FIREBASE_SERVICE_ACCOUNT_JSON` in `server/.env` (or use the host's secret environment variable). Configure `ADMIN_EMAILS` to your own verified university email. Domain checks are done server-side; verify the university really restricts this domain to eligible students before advertising university-only access.

## 2. Windows PowerShell setup

From the extracted folder:

```powershell
cd server
Copy-Item .env.example .env
notepad .env
npm.cmd install
npm.cmd run dev
```

In another PowerShell window:

```powershell
cd client
Copy-Item .env.example .env
notepad .env
npm.cmd install
npm.cmd run dev
```

Open the localhost URL displayed by Vite. Register **two different verified student accounts**, use separate browsers/devices, accept the monitoring notice, choose the same mode, and find a stranger. For admin testing sign in using the email listed in `ADMIN_EMAILS`.

## 3. Deployment

Deploy `client` to a static Vite host (build command `npm run build`, output `dist`). Deploy `server` to a Node.js host supporting persistent WebSocket connections (start `npm start`). Set server `CLIENT_ORIGIN` to the exact HTTPS frontend origin; set client `VITE_SERVER_URL` to the HTTPS backend origin; configure Firebase Auth authorized domains. Do not publish your service-account JSON or commit `.env` files. Free hosting may sleep or limit concurrent connections.

## 4. Important operational requirements

- **Full chat monitoring** is disclosed on the consent screen. Consult your university's rules and applicable privacy law before launch. Ensure an actual privacy policy, age rules, moderation process, account deletion and a contact address exist before collecting real student data.
- The backend marks messages with `expiresAt`. **Configure Firestore TTL** for the `expiresAt` field in the `messages` collection group and the `chats` collection; expiration is not automatic until TTL is enabled and deletion can be delayed. Subcollection messages are not automatically deleted when a chat parent expires: configure message TTL independently.
- Admin routes are enforced on the server. Firestore must **deny all direct client reads and writes**; the client uses only Firebase Auth and the backend accesses Firestore with the Admin SDK. Use `firestore.rules`.
- This MVP does not yet include automated abuse detection, age verification, robust blocking, pagination beyond the latest 500 messages, production audit logs, account deletion workflows, or load testing. Add these before an unrestricted college-wide launch.
- The companion age checkbox is self-attestation, **not** proof of age. Restrict or disable companion mode until suitable eligibility controls are established.
- The `Next Stranger` flow emits a leave followed by find. For production use, test rapid switching and mobile reconnection thoroughly.

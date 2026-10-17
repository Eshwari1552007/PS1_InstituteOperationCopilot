require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const initializeFirebase = require('../config/firebase');
const { auth, db } = initializeFirebase();

(async () => {
  const snapshot = await db.collection('users').get();
  const byRole = {};
  snapshot.docs.forEach((doc) => {
    const u = doc.data();
    (byRole[u.role] = byRole[u.role] || []).push(`${u.email || '?'} | ${u.status}`);
  });
  Object.entries(byRole).forEach(([role, list]) => {
    console.log(`== ${role} (${list.length}) ==`);
    list.forEach((line) => console.log(`  ${line}`));
  });

  const list = await auth.listUsers(200);
  console.log(`\n== AUTH accounts (${list.users.length}) ==`);
  list.users.forEach((user) => console.log(`  ${user.email || '(no email)'} | uid=${user.uid} | disabled=${user.disabled}`));
  process.exit(0);
})().catch((error) => { console.error('ERR', error.message); process.exit(1); });

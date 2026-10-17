require('dotenv').config();
const initializeFirebase = require('../config/firebase');

async function main() {
  const { app, db, FieldValue } = initializeFirebase();
  const [batchSnapshot, enrollmentSnapshot] = await Promise.all([
    db.collection('batches').get(),
    db.collection('enrollments').where('status', '==', 'ACTIVE').where('learningMode', '==', 'OFFLINE').get(),
  ]);
  const counts = new Map();
  enrollmentSnapshot.forEach((document) => {
    const batchDocId = document.data().batchDocId;
    if (batchDocId) counts.set(batchDocId, (counts.get(batchDocId) || 0) + 1);
  });
  const writer = db.bulkWriter();
  let updated = 0;
  batchSnapshot.forEach((batch) => {
    writer.update(batch.ref, {
      offlineEnrolledCount: counts.get(batch.id) || 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
    updated += 1;
  });
  await writer.close();
  console.log(`Backfilled offline enrollment counts for ${updated} batches from ${enrollmentSnapshot.size} active offline enrollments.`);
  await app.delete();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

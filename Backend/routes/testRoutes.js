const express = require('express');

function createTestRoutes(db) {
  const router = express.Router();

  router.post('/write', async (req, res) => {
    try {
      const doc = {
        message: typeof req.body?.message === 'string' ? req.body.message.slice(0, 200) : 'Firestore connection test',
        createdAt: new Date().toISOString(),
      };
      const result = await db.collection('connectionTests').add(doc);
      return res.status(201).json({ success: true, id: result.id });
    } catch (error) {
      console.error('Firestore test write failed:', error.message);
      return res.status(503).json({ success: false, message: 'Could not write the Firestore test document.' });
    }
  });

  router.get('/read', async (_req, res) => {
    try {
      const snapshot = await db.collection('connectionTests').orderBy('createdAt', 'desc').limit(50).get();
      return res.json({ success: true, documents: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
    } catch (error) {
      console.error('Firestore test read failed:', error.message);
      return res.status(503).json({ success: false, message: 'Could not read Firestore test documents.' });
    }
  });

  return router;
}

module.exports = createTestRoutes;

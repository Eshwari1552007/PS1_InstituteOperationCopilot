const express = require('express');
const { loadData, summarize } = require('../services/copilot');
const { classifyQuestion, generateAnswer, isWriteRequest } = require('../services/llmProvider');

const ALLOWED_ROLES = new Set(['OWNER', 'COUNSELOR', 'TRAINER', 'STUDENT', 'ACCOUNTS']);
const rateBuckets = new Map();
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

function rateLimit(uid, now = Date.now()) {
  const current = rateBuckets.get(uid) || { start: now, count: 0 };
  if (now - current.start >= 60_000) { current.start = now; current.count = 0; }
  current.count += 1;
  rateBuckets.set(uid, current);
  return current.count <= 30;
}

function createCopilotRoutes({ admin, db }) {
  const router = express.Router();
  router.post('/chat', async (req, res, next) => {
    try {
      const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
      if (!match) throw fail(401, 'AUTH_REQUIRED', 'Sign in to use EDUPILOT Copilot.');
      let decoded;
      try { decoded = await admin.auth().verifyIdToken(match[1]); }
      catch { throw fail(401, 'AUTH_INVALID', 'Your sign-in expired. Sign in again and retry.'); }
      if (!rateLimit(decoded.uid)) throw fail(429, 'RATE_LIMITED', 'You have sent too many Copilot requests. Wait a minute and retry.');
      const profileSnap = await db.collection('users').doc(decoded.uid).get();
      if (!profileSnap.exists || profileSnap.data().status !== 'APPROVED' || !ALLOWED_ROLES.has(profileSnap.data().role)) {
        throw fail(403, 'COPILOT_FORBIDDEN', 'Your approved EDUPILOT role cannot use Copilot.');
      }
      const question = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!question || question.length > 500) throw fail(400, 'MESSAGE_INVALID', 'Enter a question of up to 500 characters.');
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8).filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').map((item) => ({ role: item.role, content: item.content.slice(0, 500) })) : [];
      const profile = { uid: decoded.uid, role: profileSnap.data().role };
      // Do not ask an external model to plan or perform a write action.
      if (isWriteRequest(question)) {
        const result = summarize(question, history, profile, { batches: [], courses: [], enrollments: [], fees: [], attendance: [], sessions: [] }, [], 'write_action');
        return res.json({ ...result, verifiedAnswer: result.answer, mode: 'read-only', generatedAt: new Date().toISOString() });
      }
      let classification;
      try { classification = await classifyQuestion(question, history); }
      catch (error) {
        if (error.code) throw fail(503, error.code, error.message);
        console.error(`Copilot intent classification failed for uid ${decoded.uid}: ${error.code || 'provider-error'}`);
        throw fail(503, 'AI_PROVIDER_FAILED', 'The selected AI provider could not classify this question. Check the provider settings and retry.');
      }
      let loaded;
      let timeoutId;
      try {
        loaded = await Promise.race([
          loadData(db, profile),
          new Promise((_, reject) => { timeoutId = setTimeout(() => reject(fail(504, 'DATA_TIMEOUT', 'EDUPILOT records took too long to load. Narrow your question and retry.')), 15_000); }),
        ]);
      }
      catch (error) {
        if (error.code === 'DATA_TIMEOUT') throw error;
        console.error(`Copilot data query failed for uid ${decoded.uid}: ${error.code || 'database-error'}`);
        throw fail(503, 'DATA_UNAVAILABLE', 'EDUPILOT could not load the records you are allowed to see. Check access and retry.');
      } finally { clearTimeout(timeoutId); }
      const verified = summarize(question, history, profile, loaded.data, loaded.truncated, classification.intent);
      let generated;
      try { generated = await generateAnswer(question, verified.answer); }
      catch (error) {
        if (error.code) throw fail(503, error.code, error.message);
        console.error(`Copilot answer generation failed for uid ${decoded.uid}: ${error.code || 'provider-error'}`);
        throw fail(503, 'AI_PROVIDER_FAILED', 'The selected AI provider could not generate an answer. Check the provider settings and retry.');
      }
      res.json({ ...verified, answer: generated.answer, verifiedAnswer: verified.answer, provider: generated.provider, providerLabel: generated.providerLabel, mode: 'ai-with-verified-data', generatedAt: new Date().toISOString() });
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = createCopilotRoutes;

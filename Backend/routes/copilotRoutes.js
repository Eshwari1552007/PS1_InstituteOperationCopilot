const express = require('express');
const { classifyIntent, loadData, summarize } = require('../services/copilot');
const { generateAnswer, isWriteRequest } = require('../services/llmProvider');

const ALLOWED_ROLES = new Set(['OWNER', 'COUNSELOR', 'TRAINER', 'STUDENT', 'ACCOUNTS']);
// Cap how long the assistant waits for a provider to rephrase the verified summary.
// The verified figures are ready well before this, so a slow or down provider never
// blocks the answer the user is allowed to see.
// Leave enough time for all three configured providers to be tried in sequence.
const GENERATION_BUDGET_MS = 13_000;
const rateBuckets = new Map();
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

function rateLimit(uid, now = Date.now()) {
  const current = rateBuckets.get(uid) || { start: now, count: 0 };
  if (now - current.start >= 60_000) { current.start = now; current.count = 0; }
  current.count += 1;
  rateBuckets.set(uid, current);
  return current.count <= 30;
}

function createCopilotRoutes({ auth, db }) {
  const router = express.Router();
  router.post('/chat', async (req, res, next) => {
    try {
      const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
      if (!match) throw fail(401, 'AUTH_REQUIRED', 'Sign in to use EDUPILOT Copilot.');
      let decoded;
      try { decoded = await auth.verifyIdToken(match[1]); }
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
      try { classification = { intent: classifyIntent(question) }; }
      catch (error) {
        console.error(`Copilot intent detection failed for uid ${decoded.uid}: ${error.message}`);
        classification = { intent: 'unsupported' };
      }
      let loaded;
      let timeoutId;
      try {
        loaded = await Promise.race([
          loadData(db, profile, classification.intent),
          new Promise((_, reject) => { timeoutId = setTimeout(() => reject(fail(504, 'DATA_TIMEOUT', 'EDUPILOT records took too long to load. Narrow your question and retry.')), 15_000); }),
        ]);
      }
      catch (error) {
        if (error.code === 'DATA_TIMEOUT') throw error;
        console.error(`Copilot data query failed for uid ${decoded.uid}: ${error.code || 'database-error'}`);
        throw fail(503, 'DATA_UNAVAILABLE', 'EDUPILOT could not load the records you are allowed to see. Check access and retry.');
      } finally { clearTimeout(timeoutId); }
      const verified = summarize(question, history, profile, loaded.data, loaded.truncated, classification.intent);
      // Ask a provider to rephrase the verified figures in plain language, but never
      // fail the request when providers are rate-limited, out of quota, or offline:
      // the verified summary is itself a complete, correct answer.
      let generationTimer;
      const generated = await Promise.race([
        generateAnswer(question, verified.answer).catch((error) => {
          console.error(`Copilot answer generation failed for uid ${decoded.uid}: ${error.code || 'provider-error'}`);
          return null;
        }),
        new Promise((resolve) => { generationTimer = setTimeout(() => resolve(null), GENERATION_BUDGET_MS); }),
      ]);
      clearTimeout(generationTimer);
      if (generated?.provider) {
        return res.json({ ...verified, answer: generated.answer, verifiedAnswer: verified.answer, provider: generated.provider, providerLabel: generated.providerLabel, mode: 'ai-with-verified-data', generatedAt: new Date().toISOString() });
      }
      return res.json({
        ...verified,
        answer: generated?.answer || verified.answer,
        verifiedAnswer: verified.answer,
        provider: null,
        providerLabel: null,
        mode: 'verified-data',
        aiNotice: 'AI providers are temporarily unavailable. This answer uses verified EDUPILOT records; provider responses will be retried automatically.',
        generatedAt: new Date().toISOString(),
      });
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = createCopilotRoutes;

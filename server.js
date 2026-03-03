const express = require('express');
const { runDiscovery } = require('./discovery-apify');
const { runActor } = require('./apify');

const app = express();
app.use(express.json({ limit: '64kb' }));

const PORT = process.env.PORT || 3001;

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/reddit/discovery', async (req, res) => {
  if (!process.env.APIFY_TOKEN?.trim()) {
    return res.status(503).json({
      error: 'APIFY_TOKEN not configured',
      message: 'Set APIFY_TOKEN in Railway environment variables',
      cursor: 0, nextCursor: null, processedCount: 0, communities: [], nearMisses: [],
    });
  }
  try {
    const body = req.body || {};
    const seedList = Array.isArray(body.seedList) ? body.seedList : null;
    const recencyDays = typeof body.recencyDays === 'number' ? body.recencyDays : 30;
    const limitPerSub = Math.min(Math.max(1, parseInt(body.limitPerSub, 10) || 100), 100);
    const cursor = Math.max(0, parseInt(body.cursor, 10) || 0);
    const subsLimit = Math.min(Math.max(1, parseInt(body.subsLimit, 10) || 15), 50);

    const result = await runDiscovery({ seedList, recencyDays, limitPerSub, cursor, subsLimit });
    res.json(result);
  } catch (e) {
    console.error('Discovery error:', e);
    res.status(500).json({
      error: 'Discovery failed',
      message: e.message,
      cursor: 0,
      nextCursor: null,
      processedCount: 0,
      communities: [],
      nearMisses: []
    });
  }
});

app.post('/apify/run', async (req, res) => {
  if (!process.env.APIFY_TOKEN?.trim()) {
    return res.status(503).json({ error: 'APIFY_TOKEN not configured' });
  }
  try {
    const { actorId, input } = req.body || {};
    if (!actorId || typeof actorId !== 'string' || !input || typeof input !== 'object') {
      return res.status(400).json({ error: 'actorId (string) and input (object) required' });
    }
    const { runId, items } = await runActor(actorId, input);
    res.json({ runId, items, count: items?.length ?? 0 });
  } catch (e) {
    console.error('Apify run error:', e);
    res.status(500).json({ error: 'Apify run failed', message: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Discovery worker listening on port ${PORT}`);
});

const express = require('express');
const { runDiscovery } = require('./discovery');

const app = express();
app.use(express.json({ limit: '64kb' }));

const PORT = process.env.PORT || 3001;

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/reddit/discovery', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Discovery worker listening on port ${PORT}`);
});

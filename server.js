const express = require('express');
const { runDiscovery } = require('./discovery-apify');
const { runActor } = require('./apify');

const app = express();
app.use(express.json({ limit: '64kb' }));

const PORT = process.env.PORT || 3001;

const JOBS = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

function pruneOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of JOBS) {
    if ((job.startedAt || 0) < cutoff) JOBS.delete(id);
  }
}
setInterval(pruneOldJobs, 5 * 60 * 1000);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

/** POST /reddit/discovery — start async job, return jobId immediately */
app.post('/reddit/discovery', (req, res) => {
  if (!process.env.APIFY_TOKEN?.trim()) {
    return res.status(503).json({
      error: 'APIFY_TOKEN not configured',
      message: 'Set APIFY_TOKEN in Railway environment variables',
      jobId: null,
      status: 'failed',
    });
  }
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const body = req.body || {};
  const opts = {
    seedList: Array.isArray(body.seedList) ? body.seedList : null,
    recencyDays: typeof body.recencyDays === 'number' ? body.recencyDays : 30,
    limitPerSub: Math.min(Math.max(1, parseInt(body.limitPerSub, 10) || 100), 100),
    cursor: Math.max(0, parseInt(body.cursor, 10) || 0),
    subsLimit: Math.min(Math.max(1, parseInt(body.subsLimit, 10) || 15), 50),
    mode: body.mode === 'seed' ? 'seed' : 'search',
    searchMaxItems: Math.min(Math.max(100, parseInt(body.searchMaxItems, 10) || 1500), 2000),
  };
  JOBS.set(jobId, {
    startedAt: Date.now(),
    status: 'running',
    progress: null,
    message: null,
    result: null,
    error: null,
  });
  runDiscovery(opts)
    .then((result) => {
      JOBS.set(jobId, {
        ...JOBS.get(jobId),
        status: 'done',
        result: {
          communities: result.communities || [],
          nearMisses: result.nearMisses || [],
          meta: result,
        },
      });
    })
    .catch((e) => {
      console.error('Discovery error:', e);
      JOBS.set(jobId, {
        ...JOBS.get(jobId),
        status: 'failed',
        error: e.message,
      });
    });
  res.json({ jobId, status: 'running', estimatedSeconds: 45 });
});

/** GET /reddit/discovery/status/:jobId */
app.get('/reddit/discovery/status/:jobId', (req, res) => {
  const job = JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job_not_found', jobId: req.params.jobId });
  res.json({
    jobId: req.params.jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
  });
});

/** GET /reddit/discovery/result/:jobId */
app.get('/reddit/discovery/result/:jobId', (req, res) => {
  const job = JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job_not_found', jobId: req.params.jobId });
  if (job.status !== 'done') {
    return res.status(202).json({
      jobId: req.params.jobId,
      status: job.status,
      error: job.status === 'failed' ? job.error : undefined,
    });
  }
  res.json({
    communities: job.result?.communities || [],
    nearMisses: job.result?.nearMisses || [],
    meta: job.result?.meta || {},
  });
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

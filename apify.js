/**
 * Apify orchestration: start run, poll until done, fetch dataset items.
 * Uses REST API (no apify-client dep).
 */

const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR_ID = 'alex_claw~reddit-scraper';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 300000; // 5 min

function getToken() {
  const t = process.env.APIFY_TOKEN;
  if (!t || !t.trim()) throw new Error('APIFY_TOKEN not set');
  return t.trim();
}

async function api(path, opts = {}) {
  const token = getToken();
  const url = `${APIFY_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Start async actor run. Returns { id, defaultDatasetId }.
 */
async function startRun(input) {
  const body = await api(`/acts/${ACTOR_ID}/runs`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return {
    id: body.data.id,
    defaultDatasetId: body.data.defaultDatasetId,
  };
}

/**
 * Get run status. Returns { status: 'RUNNING'|'SUCCEEDED'|'FAILED'|... }.
 */
async function getRunStatus(runId) {
  const body = await api(`/actor-runs/${runId}`);
  return { status: body.data.status };
}

/**
 * Fetch dataset items.
 */
async function getDatasetItems(datasetId) {
  const items = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const body = await api(
      `/datasets/${datasetId}/items?format=json&limit=${limit}&offset=${offset}`
    );
    const chunk = Array.isArray(body) ? body : [body];
    if (chunk.length === 0) break;
    items.push(...chunk);
    if (chunk.length < limit) break;
    offset += limit;
  }
  return items;
}

/**
 * Run actor, poll until done, return dataset items.
 */
async function runAndFetch(subreddits, maxPostsPerSubreddit = 100, sort = 'new') {
  const input = {
    subreddits,
    maxPostsPerSubreddit,
    sort,
    includeComments: false,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
    },
  };

  const { id: runId, defaultDatasetId } = await startRun(input);
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const { status } = await getRunStatus(runId);
    if (status === 'SUCCEEDED') {
      return { runId, datasetId: defaultDatasetId, items: await getDatasetItems(defaultDatasetId) };
    }
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${status}: ${runId}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Apify run timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

module.exports = { runAndFetch, getToken };

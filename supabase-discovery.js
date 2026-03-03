/**
 * Supabase: discovery_runs and discovery_communities.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY with permissive RLS).
 */

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function fetchSupabase(path, opts = {}) {
  const client = getClient();
  if (!client) return null;
  const res = await fetch(`${client.url}/rest/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      apikey: client.key,
      Authorization: `Bearer ${client.key}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
      ...opts.headers,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res;
}

async function upsertSeedRun(row) {
  const body = {
    subreddit: row.subreddit,
    run_date: row.runDate || new Date().toISOString().slice(0, 10),
    run_id: row.runId || null,
    posts_scanned: row.postsScanned ?? 0,
    qualifying_posts: row.qualifyingPosts ?? 0,
    pain_density: row.painDensity ?? null,
    error_type: row.errorType || null,
    seed_tier: row.seedTier || null,
  };
  await fetchSupabase('/seed_runs?on_conflict=subreddit,run_date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
}

async function getDiscoveredSeeds() {
  const client = getClient();
  if (!client) return [];
  const res = await fetch(`${client.url}/rest/v1/discovered_seeds?select=subreddit&order=added_at.desc`, {
    headers: { apikey: client.key, Authorization: `Bearer ${client.key}` },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((r) => r.subreddit?.toLowerCase()).filter(Boolean);
}

async function upsertDiscoveredSeed(subreddit, painDensity, qualifyingPosts, highPriority = false) {
  const body = {
    subreddit: (subreddit || '').toLowerCase(),
    pain_density: painDensity ?? null,
    qualifying_posts: qualifyingPosts ?? 0,
    high_priority: !!highPriority,
    added_at: new Date().toISOString(),
  };
  await fetchSupabase('/discovered_seeds', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,on_conflict=subreddit,return=minimal' },
    body: JSON.stringify(body),
  });
}

async function getSeedRunHistory(subreddit, limit = 20) {
  const client = getClient();
  if (!client) return [];
  const res = await fetch(
    `${client.url}/rest/v1/seed_runs?subreddit=eq.${encodeURIComponent(subreddit)}&order=run_date.desc&limit=${limit}`,
    { headers: { apikey: client.key, Authorization: `Bearer ${client.key}` } }
  );
  if (!res.ok) return [];
  return await res.json();
}

async function getDemotedSeeds() {
  const client = getClient();
  if (!client) return new Set();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const res = await fetch(
    `${client.url}/rest/v1/seed_runs?run_date=gte.${cutoff.toISOString().slice(0, 10)}&order=run_date.desc&select=subreddit,qualifying_posts,error_type`,
    { headers: { apikey: client.key, Authorization: `Bearer ${client.key}` } }
  );
  if (!res.ok) return new Set();
  const rows = await res.json();
  const bySub = new Map();
  for (const r of rows) {
    const s = (r.subreddit || '').toLowerCase();
    if (!bySub.has(s)) bySub.set(s, []);
    bySub.get(s).push(r);
  }
  const demoted = new Set();
  for (const [sub, runs] of bySub) {
    const last5 = runs.slice(0, 5);
    if (last5.length >= 5 && last5.every((r) => (r.qualifying_posts || 0) === 0)) demoted.add(sub);
    const forbidden = runs.filter((r) => (r.error_type || '').includes('forbidden') || (r.error_type || '').includes('private'));
    if (forbidden.length >= 2) demoted.add(sub);
  }
  return demoted;
}

async function upsertDiscoveryRun(row) {
  const body = {
    run_id: row.runId,
    subreddits: row.subreddits,
    communities_count: row.communitiesCount,
    near_misses_count: row.nearMissesCount,
    raw_post_count: row.rawPostCount,
    status: row.status || 'completed',
    error_message: row.errorMessage || null,
  };
  await fetchSupabase('/discovery_runs', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
}

async function upsertCommunities(runId, communities) {
  const rows = communities.map((c) => ({
    run_id: runId,
    subreddit: c.subreddit,
    url: c.url,
    member_count: c.memberCount ?? null,
    priority_score: c.priorityScore,
    pain_post_ratio: c.painPostRatio,
    demand_score: c.demandScore,
    opportunity_score: c.opportunityScore,
    co_occurring_keywords: c.coOccurringKeywords || [],
    sample_posts: c.samplePosts || [],
    has_evidence: c.hasEvidence ?? false,
    icp_match_score: c.icpMatchScore ?? null,
    updated_at: new Date().toISOString(),
  }));

  for (const row of rows) {
    await fetchSupabase('/discovery_communities', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,on_conflict=subreddit,return=minimal' },
      body: JSON.stringify(row),
    });
  }
}

module.exports = {
  upsertDiscoveryRun,
  upsertCommunities,
  upsertSeedRun,
  getDiscoveredSeeds,
  upsertDiscoveredSeed,
  getSeedRunHistory,
  getDemotedSeeds,
};

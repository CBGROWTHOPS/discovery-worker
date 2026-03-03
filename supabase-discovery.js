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

module.exports = { upsertDiscoveryRun, upsertCommunities };

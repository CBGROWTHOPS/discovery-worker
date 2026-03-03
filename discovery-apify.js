/**
 * Discovery via Apify: run actor, normalize, score, upsert Supabase, return summary.
 */

const { runRedditActor } = require('./apify');
const {
  HEALTHCARE_FRICTION_KEYWORDS,
  OUT_OF_MARKET_SIGNALS,
  NON_US_SUBREDDITS,
  SEED_SUBREDDITS,
  MIN_MEMBERS,
  CO_OCCURRING_TOP_N,
  STOPWORDS,
} = require('./discovery-constants');
const { upsertDiscoveryRun, upsertCommunities } = require('./supabase-discovery');

function isNonUsSub(sub) {
  return NON_US_SUBREDDITS.includes((sub || '').toLowerCase());
}

function hasOutOfMarketSignal(text) {
  const lower = (text || '').toLowerCase();
  return OUT_OF_MARKET_SIGNALS.some((s) => lower.includes(s));
}

function qualifiesForProblemSpace(text, keywords) {
  const lower = (text || '').toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function extractCoOccurring(text, frictionKeywords, topN = CO_OCCURRING_TOP_N) {
  const lower = (text || '').toLowerCase();
  const frictionSet = new Set(frictionKeywords.map((k) => k.toLowerCase()));
  const words = lower.replace(/[^\w\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  const counts = new Map();
  for (const w of words) {
    const clean = w.replace(/^['"-]+|['"-]+$/g, '').toLowerCase();
    if (!clean || clean.length < 2) continue;
    if (STOPWORDS.has(clean)) continue;
    if (frictionSet.has(clean)) continue;
    if (/^\d+$/.test(clean)) continue;
    counts.set(clean, (counts.get(clean) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([term, count]) => ({ term, count }));
}

/** Parse Apify createdUtc (ISO string) to unix */
function toUnix(createdUtc) {
  if (typeof createdUtc === 'number') return createdUtc;
  if (!createdUtc) return 0;
  return Math.floor(new Date(createdUtc).getTime() / 1000);
}

/**
 * Normalize Apify dataset item to our post shape.
 * Supports: alex_claw (subreddit, postId, selfText, numComments, createdUtc)
 *           trudax (communityName, body, numberOfComments, createdAt, upVotes)
 */
function normalizePost(item) {
  const sub = (item.subreddit || item.communityName || item.parsedCommunityName || '').toLowerCase();
  const selftext = item.selfText ?? item.body ?? '';
  const score = item.score ?? item.upVotes ?? 0;
  const numComments = item.numComments ?? item.numberOfComments ?? 0;
  const createdUtcRaw = item.createdUtc ?? item.createdAt;
  const url = item.url || (item.permalink ? `https://reddit.com${item.permalink.startsWith('/') ? '' : '/'}${item.permalink}` : '');
  const permalink = item.permalink || (item.url || '').replace(/^https?:\/\/(www\.)?reddit\.com/, '') || url;
  return {
    id: item.postId || item.id,
    subreddit: sub,
    title: item.title || '',
    selftext,
    score,
    num_comments: numComments,
    created_utc: toUnix(createdUtcRaw),
    permalink,
    url,
  };
}

async function runDiscovery(opts) {
  const startTime = Date.now();
  const { seedList, recencyDays = 30, limitPerSub = 100, cursor = 0, subsLimit = 15 } = opts;

  const seeds =
    seedList?.length > 0
      ? seedList
          .filter((s) => typeof s === 'string')
          .map((s) => s.replace(/^r\//, '').toLowerCase())
          .filter((s) => !isNonUsSub(s))
      : SEED_SUBREDDITS.filter((s) => !isNonUsSub(s));

  const subsToScrape = seeds.slice(cursor, cursor + subsLimit);
  if (subsToScrape.length === 0) {
    return {
      cursor,
      nextCursor: null,
      processedCount: 0,
      communities: [],
      nearMisses: [],
      rawPostCount: 0,
      totalCommunitiesScored: 0,
      runId: null,
      fetchedAt: new Date().toISOString(),
      timeMs: Date.now() - startTime,
      debug: { recencyDays, seedsUsed: seeds.length, source: 'apify' },
    };
  }

  let runId;
  let items = [];
  try {
    const result = await runRedditActor(subsToScrape, Math.min(limitPerSub, 500), 'new');
    runId = result.runId;
    items = result.items || [];
  } catch (e) {
    console.error('Apify error:', e);
    return {
      cursor,
      nextCursor: cursor,
      processedCount: 0,
      communities: [],
      nearMisses: subsToScrape.map((s) => ({ subreddit: s, reason: 'apify failed', details: e.message })),
      rawPostCount: 0,
      totalCommunitiesScored: 0,
      runId: null,
      error: e.message,
      fetchedAt: new Date().toISOString(),
      timeMs: Date.now() - startTime,
      debug: { recencyDays, seedsUsed: seeds.length, source: 'apify' },
    };
  }

  const cutoffUtc = Date.now() / 1000 - recencyDays * 24 * 3600;
  const frictionKeywords = HEALTHCARE_FRICTION_KEYWORDS;

  const postsBySub = new Map();
  for (const item of items) {
    const p = normalizePost(item);
    if (!p.subreddit) continue;
    if (!postsBySub.has(p.subreddit)) postsBySub.set(p.subreddit, []);
    postsBySub.get(p.subreddit).push(p);
  }

  const qualifyingBySub = {};
  const nearMisses = [];

  for (const sub of subsToScrape) {
    const posts = postsBySub.get(sub.toLowerCase()) || [];
    const members = null;

    const qualifying = [];
    for (const p of posts) {
      const createdUtc = p.created_utc || 0;
      if (createdUtc < cutoffUtc) continue;
      if (hasOutOfMarketSignal((p.title || '') + ' ' + (p.selftext || ''))) continue;
      if (!qualifiesForProblemSpace((p.title || '') + ' ' + (p.selftext || ''), frictionKeywords)) continue;
      qualifying.push({
        id: p.id,
        subreddit: sub,
        title: p.title,
        selftext: (p.selftext || '').substring(0, 500),
        score: p.score ?? 0,
        num_comments: p.num_comments ?? 0,
        created_utc: createdUtc,
        permalink: p.permalink || '',
        url: p.url || `https://reddit.com${p.permalink || ''}`,
      });
    }

    if (members != null && members > 0 && members < MIN_MEMBERS) {
      nearMisses.push({ subreddit: sub, members, reason: 'too small', details: `${members} members` });
      continue;
    }
    if (qualifying.length === 0) {
      const nm = { subreddit: sub, members, reason: '', details: '' };
      if (posts.length === 0) nm.reason = 'no posts returned';
      else if (posts.length < 5) nm.reason = 'low recent activity';
      else nm.reason = 'no matching posts in window';
      nm.details = nm.reason;
      nearMisses.push(nm);
      continue;
    }
    qualifyingBySub[sub] = { qualifying, totalFetched: posts.length, members: members ?? 0 };
  }

  const communities = [];
  for (const [sub, data] of Object.entries(qualifyingBySub)) {
    const { qualifying, totalFetched, members } = data;
    const painPostRatio = totalFetched > 0 ? qualifying.length / totalFetched : 0;
    const demandScore = qualifying.length;
    const lowCommentCount = qualifying.filter((p) => (p.num_comments || 0) < 3).length;
    const opportunityScore = qualifying.length > 0 ? lowCommentCount / qualifying.length : 0;
    const activityScore = qualifying.length;
    const allText = qualifying.map((p) => (p.title || '') + ' ' + (p.selftext || '')).join(' ');
    const coOccurringKeywords = extractCoOccurring(allText, frictionKeywords);
    const w1 = 0.25; const w2 = 0.3; const w3 = 0.2; const w4 = 0.25;
    const priorityScore = Math.min(
      100,
      Math.round(
        w1 * painPostRatio * 100 +
          w2 * opportunityScore * 100 +
          w3 * Math.min(activityScore / 20, 1) * 100 +
          w4 * Math.min(demandScore / 15, 1) * 100
      )
    );
    const samplePosts = qualifying
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        title: p.title,
        selftextSnippet: (p.selftext || '').substring(0, 200),
        url: p.url,
        numComments: p.num_comments,
        score: p.score,
        createdUtc: p.created_utc,
      }));

    communities.push({
      subreddit: sub,
      url: `https://reddit.com/r/${sub}`,
      painPostRatio: Math.round(painPostRatio * 100) / 100,
      demandScore,
      opportunityScore: Math.round(opportunityScore * 100) / 100,
      activityScore,
      priorityScore,
      memberCount: members,
      coOccurringKeywords,
      samplePosts,
      lowConfidence: qualifying.length < 2,
    });
  }

  communities.sort((a, b) => b.priorityScore - a.priorityScore);
  const rawPostCount = Object.values(qualifyingBySub).reduce((sum, d) => sum + d.qualifying.length, 0);
  const topNearMisses = nearMisses.sort((a, b) => (b.members ?? 0) - (a.members ?? 0)).slice(0, 20);

  const timeMs = Date.now() - startTime;

  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (runId && process.env.SUPABASE_URL && supabaseKey) {
    try {
      await upsertDiscoveryRun({
        runId,
        subreddits: subsToScrape,
        communitiesCount: communities.length,
        nearMissesCount: topNearMisses.length,
        rawPostCount,
        status: 'completed',
      });
      if (communities.length > 0) {
        await upsertCommunities(runId, communities);
      }
    } catch (e) {
      console.error('Supabase upsert error:', e);
    }
  }

  return {
    cursor,
    nextCursor: cursor + subsToScrape.length < seeds.length ? cursor + subsToScrape.length : null,
    processedCount: subsToScrape.length,
    communities,
    nearMisses: topNearMisses,
    rawPostCount,
    totalCommunitiesScored: communities.length,
    runId,
    fetchedAt: new Date().toISOString(),
    timeMs,
    debug: { recencyDays, seedsUsed: seeds.length, source: 'apify' },
  };
}

module.exports = { runDiscovery };

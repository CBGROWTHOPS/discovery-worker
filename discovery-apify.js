/**
 * Discovery via Apify: run actor, normalize, score, upsert Supabase, return summary.
 */

const { runRedditActor, runRedditSearch } = require('./apify');
const {
  HEALTHCARE_FRICTION_KEYWORDS,
  ICP_KEYWORDS,
  SEARCH_KEYWORDS,
  OUT_OF_MARKET_SIGNALS,
  NON_US_SUBREDDITS,
  SEED_SUBREDDITS,
  PRIORITY_SEEDS,
  SECONDARY_SEEDS,
  MIN_MEMBERS,
  CO_OCCURRING_TOP_N,
  STOPWORDS,
  POST_PAIN_SCORES,
  PAIN_SEARCH_BLOCKS,
  PROMOTION_PAIN_DENSITY,
  PROMOTION_QUALIFYING_POSTS,
  STOP_TARGET_COMMUNITIES,
  STOP_PAIN_DENSITY_FLOOR,
  PRUNING_DRY_RUNS,
  PRUNING_FORBIDDEN_TWICE,
} = require('./discovery-constants');
const {
  upsertDiscoveryRun,
  upsertCommunities,
  upsertSeedRun,
  getDiscoveredSeeds,
  upsertDiscoveredSeed,
  getDemotedSeeds,
} = require('./supabase-discovery');

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

/** Post-level pain score (weighted). Only include posts with num_comments >= 1. */
function computePostPainScore(text) {
  const lower = (text || '').toLowerCase();
  let score = 0;
  const costTerms = ["can't afford", "cant afford", "too expensive", "medical bill", "er bill", "urgent care cost", "prescription cost"];
  if (costTerms.some((t) => lower.includes(t))) score += POST_PAIN_SCORES.costBarrier;
  if (/\bno insurance\b|uninsured|without insurance|insurance won't cover/i.test(lower)) score += POST_PAIN_SCORES.noInsurance;
  if (/\bdeductible\b|high deductible/i.test(lower)) score += POST_PAIN_SCORES.deductible;
  if (/delayed care|skip healthcare|put off|postponed|couldn't afford to go/i.test(lower)) score += POST_PAIN_SCORES.delayedCare;
  if (/alternative|cheaper option|what else can i do|affordable option|cheaper alternative/i.test(lower)) score += POST_PAIN_SCORES.askingAlternatives;
  if (/urgent care/i.test(lower)) score += POST_PAIN_SCORES.urgentCare;
  if (/nearest doctor|long drive|no clinic|clinic near me|distance|hours away/i.test(lower)) score += POST_PAIN_SCORES.distance;
  return score;
}

/** Score 0-100: how much this community matches ICP personas (from text + sub name) */
function icpMatchScore(subredditName, text) {
  const lower = ((subredditName || '') + ' ' + (text || '')).toLowerCase();
  let hits = 0;
  for (const kw of ICP_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) hits++;
  }
  return Math.min(100, hits * 15);
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
  const {
    seedList,
    recencyDays = 30,
    limitPerSub = 100,
    cursor = 0,
    subsLimit = 15,
    mode = 'search',
    searchMaxItems = 1500,
  } = opts;

  let runId;
  let items = [];
  let subsToScrape = [];

  if (mode === 'search') {
    try {
      const result = await runRedditSearch(SEARCH_KEYWORDS, searchMaxItems, 'new');
      runId = result.runId;
      items = result.items || [];
      const uniqueSubs = new Set();
      for (const item of items) {
        const sub = (item.subreddit || item.communityName || item.parsedCommunityName || '').toLowerCase();
        if (sub && !isNonUsSub(sub)) uniqueSubs.add(sub);
      }
      const allSubs = [...uniqueSubs];
      subsToScrape = allSubs.slice(cursor, cursor + subsLimit);
    } catch (e) {
      console.error('Apify search error:', e);
      return {
        cursor: 0,
        nextCursor: null,
        processedCount: 0,
        communities: [],
        nearMisses: [{ subreddit: '—', reason: 'apify search failed', details: e.message }],
        rawPostCount: 0,
        totalCommunitiesScored: 0,
        runId: null,
        error: e.message,
        fetchedAt: new Date().toISOString(),
        timeMs: Date.now() - startTime,
        debug: { recencyDays, mode: 'search', source: 'apify' },
      };
    }
  } else {
    let seeds;
    const seedTierMap = new Map();
    if (seedList?.length > 0) {
      seeds = seedList
        .filter((s) => typeof s === 'string')
        .map((s) => s.replace(/^r\//, '').toLowerCase())
        .filter((s) => !isNonUsSub(s));
      seeds.forEach((s) => seedTierMap.set(s, 'custom'));
    } else {
      const demoted = await getDemotedSeeds();
      const priority = PRIORITY_SEEDS.filter((s) => !isNonUsSub(s) && !demoted.has(s.toLowerCase()));
      const secondary = SECONDARY_SEEDS.filter((s) => !isNonUsSub(s) && !demoted.has(s.toLowerCase()));
      const discovered = (await getDiscoveredSeeds()).filter((s) => !demoted.has(s));
      priority.forEach((s) => seedTierMap.set(s.toLowerCase(), 'priority'));
      secondary.forEach((s) => seedTierMap.set(s.toLowerCase(), 'secondary'));
      discovered.forEach((s) => seedTierMap.set(s, 'discovered'));
      const seen = new Set();
      seeds = [...priority, ...secondary, ...discovered].filter((s) => {
        const k = s.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    opts.seedTierMap = seedTierMap;
    subsToScrape = seeds.slice(cursor, cursor + subsLimit);
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
  }

  if (subsToScrape.length === 0 && items.length === 0) {
    return {
      cursor: 0,
      nextCursor: null,
      processedCount: 0,
      communities: [],
      nearMisses: [],
      rawPostCount: 0,
      totalCommunitiesScored: 0,
      runId,
      fetchedAt: new Date().toISOString(),
      timeMs: Date.now() - startTime,
      debug: { recencyDays, mode, source: 'apify' },
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

  const allSubData = {};
  const nearMisses = [];
  const toPromote = [];
  const runDate = new Date().toISOString().slice(0, 10);

  for (const sub of subsToScrape) {
    const posts = postsBySub.get(sub.toLowerCase()) || [];
    const members = null;
    const recentPosts = posts.filter((p) => (p.created_utc || 0) >= cutoffUtc);
    const inWindowNoOom = recentPosts.filter(
      (p) => !hasOutOfMarketSignal((p.title || '') + ' ' + (p.selftext || ''))
    );
    const withComment = inWindowNoOom.filter((p) => (p.num_comments || 0) >= 1);
    const postsScanned = withComment.length;

    const qualifying = [];
    let totalPainScore = 0;
    for (const p of withComment) {
      const text = (p.title || '') + ' ' + (p.selftext || '');
      const painScore = computePostPainScore(text);
      const qualifies = qualifiesForProblemSpace(text, frictionKeywords) || painScore > 0;
      totalPainScore += painScore;
      if (qualifies) {
        qualifying.push({
          id: p.id,
          subreddit: sub,
          title: p.title,
          selftext: (p.selftext || '').substring(0, 500),
          score: p.score ?? 0,
          num_comments: p.num_comments ?? 0,
          created_utc: p.created_utc,
          permalink: p.permalink || '',
          url: p.url || `https://reddit.com${p.permalink || ''}`,
          painScore,
        });
      }
    }

    const painDensity = postsScanned > 0 ? totalPainScore / postsScanned : 0;
    if (mode === 'search' && painDensity >= PROMOTION_PAIN_DENSITY && qualifying.length >= PROMOTION_QUALIFYING_POSTS) {
      toPromote.push({ subreddit: sub, painDensity, qualifyingPosts: qualifying.length });
    }

    const allText = inWindowNoOom.map((p) => (p.title || '') + ' ' + (p.selftext || '')).join(' ');
    const icpScore = icpMatchScore(sub, allText);
    const hasEvidence = qualifying.length > 0;

    if (members != null && members > 0 && members < MIN_MEMBERS) {
      nearMisses.push({ subreddit: sub, members, reason: 'too small', details: `${members} members` });
    }

    allSubData[sub] = {
      qualifying,
      totalFetched: posts.length,
      postsScanned,
      totalPainScore,
      painDensity,
      members: members ?? 0,
      hasEvidence,
      icpMatchScore: icpScore,
      inWindowNoOom,
    };
  }

  const communities = [];
  for (const [sub, data] of Object.entries(allSubData)) {
    const { qualifying, totalFetched, members, hasEvidence, icpMatchScore: icpScore, inWindowNoOom } = data;

    let painPostRatio, demandScore, opportunityScore, activityScore, priorityScore, coOccurringKeywords, samplePosts, lowConfidence;

    if (hasEvidence) {
      painPostRatio = totalFetched > 0 ? qualifying.length / totalFetched : 0;
      demandScore = qualifying.length;
      const lowCommentCount = qualifying.filter((p) => (p.num_comments || 0) < 3).length;
      opportunityScore = qualifying.length > 0 ? lowCommentCount / qualifying.length : 0;
      activityScore = qualifying.length;
      const qualText = qualifying.map((p) => (p.title || '') + ' ' + (p.selftext || '')).join(' ');
      coOccurringKeywords = extractCoOccurring(qualText, frictionKeywords);
      const w1 = 0.25; const w2 = 0.3; const w3 = 0.2; const w4 = 0.25;
      priorityScore = Math.min(
        100,
        Math.round(
          w1 * painPostRatio * 100 +
            w2 * opportunityScore * 100 +
            w3 * Math.min(activityScore / 20, 1) * 100 +
            w4 * Math.min(demandScore / 15, 1) * 100
        )
      );
      samplePosts = qualifying
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
      lowConfidence = qualifying.length < 2;
    } else {
      painPostRatio = 0;
      demandScore = 0;
      opportunityScore = 0;
      activityScore = inWindowNoOom.length;
      const allText = inWindowNoOom.map((p) => (p.title || '') + ' ' + (p.selftext || '')).join(' ');
      coOccurringKeywords = extractCoOccurring(allText, frictionKeywords);
      priorityScore = icpScore;
      samplePosts = inWindowNoOom
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5)
        .map((p) => ({
          id: p.id,
          title: p.title,
          selftextSnippet: (p.selftext || '').substring(0, 200),
          url: p.url || `https://reddit.com${p.permalink || ''}`,
          numComments: p.num_comments,
          score: p.score,
          createdUtc: p.created_utc,
        }));
      lowConfidence = true;
    }

    const seedTier = mode === 'search' ? 'search' : (opts.seedTierMap?.get(sub.toLowerCase()) || 'seed');
    communities.push({
      subreddit: sub,
      url: `https://reddit.com/r/${sub}`,
      painPostRatio: Math.round((painPostRatio || 0) * 100) / 100,
      demandScore: demandScore || 0,
      opportunityScore: Math.round((opportunityScore || 0) * 100) / 100,
      activityScore: activityScore || 0,
      priorityScore: priorityScore || icpScore,
      memberCount: members,
      coOccurringKeywords: coOccurringKeywords || [],
      samplePosts: samplePosts || [],
      lowConfidence: lowConfidence ?? true,
      hasEvidence,
      icpMatchScore: icpScore,
      seedTier,
      painDensity: allSubData[sub]?.painDensity,
    });
  }

  communities.sort((a, b) => {
    const aScore = (a.hasEvidence ? 1000 : 0) + (a.priorityScore || 0) + (a.icpMatchScore || 0) / 10;
    const bScore = (b.hasEvidence ? 1000 : 0) + (b.priorityScore || 0) + (b.icpMatchScore || 0) / 10;
    return bScore - aScore;
  });
  const rawPostCount = Object.values(allSubData).reduce((sum, d) => sum + (d.qualifying?.length || 0), 0);
  const topNearMisses = nearMisses.sort((a, b) => (b.members ?? 0) - (a.members ?? 0)).slice(0, 20);

  const timeMs = Date.now() - startTime;

  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (process.env.SUPABASE_URL && supabaseKey) {
    try {
      for (const { subreddit, painDensity, qualifyingPosts } of toPromote) {
        await upsertDiscoveredSeed(subreddit, painDensity, qualifyingPosts, false);
      }
      if (mode === 'seed') {
        for (const [sub, data] of Object.entries(allSubData)) {
          await upsertSeedRun({
            subreddit: sub,
            runDate,
            runId,
            postsScanned: data.postsScanned ?? 0,
            qualifyingPosts: data.qualifying?.length ?? 0,
            painDensity: data.postsScanned > 0 ? data.painDensity : null,
            seedTier: opts.seedTierMap?.get(sub) || 'seed',
          });
        }
      }
      if (runId) {
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
      }
    } catch (e) {
      console.error('Supabase upsert error:', e);
    }
  }

  const seedsCount = mode === 'seed' ? (seedList?.length || SEED_SUBREDDITS.filter((s) => !isNonUsSub(s)).length) : 0;
  const nextCursor =
    mode === 'seed' && seedsCount > 0
      ? cursor + subsToScrape.length < seedsCount
        ? cursor + subsToScrape.length
        : null
      : null;

  return {
    cursor: mode === 'search' ? 0 : cursor,
    nextCursor,
    processedCount: subsToScrape.length,
    communities,
    nearMisses: topNearMisses,
    rawPostCount,
    totalCommunitiesScored: communities.length,
    runId,
    fetchedAt: new Date().toISOString(),
    timeMs,
    debug: {
      recencyDays,
      mode,
      seedsUsed: mode === 'seed' ? (seedList?.length || SEED_SUBREDDITS.length) : null,
      searchSubsDiscovered: mode === 'search' ? subsToScrape.length : null,
      source: 'apify',
    },
  };
}

module.exports = { runDiscovery };

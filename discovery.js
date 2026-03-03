const https = require('https');

const HEALTHCARE_FRICTION_KEYWORDS = [
  'cant afford', "can't afford", "can't afford healthcare", 'cant afford doctor',
  'no insurance', 'without insurance', 'no insurance what do i do', 'uninsured',
  'medical bill', 'medical bills', 'medical cost', 'healthcare cost', 'insurance cost',
  'urgent care cost', 'prescription cost', 'prescription costs', 'lab test cost',
  'deductible', 'deductible 6000', 'no benefits', 'out of pocket', 'self pay',
  'telehealth', 'cash pay', 'health insurance', 'afford healthcare',
  'cant afford insurance', "can't afford insurance", 'skip healthcare', 'delayed care'
];

const OUT_OF_MARKET_SIGNALS = ['nhs', 'ohip', 'private healthcare uk', 'australian medicare'];

const NON_US_SUBREDDITS = [
  'ukpersonalfinance', 'ausfinance', 'ausfinanceaustralia', 'personalfinanceuk',
  'ukinvesting', 'ukfrugal', 'ukjobs', 'canadafinance', 'personalfinancecanada',
  'nhs', 'askuk', 'australia', 'canada'
];

const SEED_SUBREDDITS = [
  'uberdrivers', 'freelance', 'doordash', 'lyftdrivers', 'healthinsurance',
  'instacartshoppers', 'grubhubdrivers', 'selfemployed', 'amazonflexdrivers',
  'povertyfinance', 'personalfinance', 'smallbusiness', 'entrepreneur',
  'healthcare', 'frugal', 'lostgeneration', 'antiwork', 'jobs', 'careeradvice',
  'financialindependence', 'insurance', 'workonline', 'sidehustle', 'gigworkers',
  'doordash_drivers', 'ubereats', 'shiptshoppers', 'health', 'medical',
  'chronicillness', 'chronicpain', 'budget', 'finance', 'investing', 'financialplanning',
  'money', 'leanfire', 'fire', 'workreform', 'unemployment', 'jobsearch',
  'careers', 'resume', 'studentloans', 'debt', 'bankruptcy', 'disability',
  'medicaid', 'medicare', 'veterans', 'military', 'teachers', 'nursing',
  'nurse', 'bartenders', 'serverlife', 'talesfromyourserver', 'kitchenconfidential',
  'truckers', 'realestate', 'landlord', 'renters', 'firsttimehomebuyer',
  'askamericans', 'ushealthcare', 'adulting', 'parenting', 'Mommit', 'daddit',
  'AskParents', 'AskNYC', 'chicago', 'LosAngeles', 'Austin', 'Seattle', 'Denver',
  'immigration', 'immigrants'
];

const MIN_QUALIFYING_POSTS_SURFACE = 1;
const MIN_MEMBERS = 50;
const CO_OCCURRING_TOP_N = 20;
const REQUEST_DELAY_MS = 1200;
const TIME_BUDGET_MS = 20000;
const CACHE_TTL_SECONDS = 600;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
  'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their', 'me', 'him',
  'us', 'them', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 'just', 'also', 'now', 'here', 'there', 'then', 'if', 'as', 'into',
  'out', 'up', 'down', 'about', 'after', 'before', 'between', 'through', 'during',
  'without', 'again', 'further', 'once', 'any', 'am', 'im', 'ive', 'dont',
  'doesnt', 'didnt', 'wont', 'wouldnt', 'couldnt', 'shouldnt', 'cant', 'cannot'
]);

const REDDIT_HEADERS = {
  'User-Agent': 'CommunityReachEngine/1.0 (Discovery; contact@providernow.org)',
  'Accept': 'application/json',
  'Accept-Language': 'en-US'
};

const subCache = new Map();

function getCached(key) {
  const entry = subCache.get(key);
  if (!entry) return null;
  const age = (Date.now() - entry.timestamp) / 1000;
  if (age > CACHE_TTL_SECONDS) {
    subCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  subCache.set(key, { data, timestamp: Date.now() });
}

function isNonUsSub(sub) {
  return NON_US_SUBREDDITS.includes(sub.toLowerCase());
}

function hasOutOfMarketSignal(text) {
  const lower = (text || '').toLowerCase();
  return OUT_OF_MARKET_SIGNALS.some(s => lower.includes(s));
}

function qualifiesForProblemSpace(text, keywords) {
  const lower = (text || '').toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: REDDIT_HEADERS }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchSubredditAbout(sub) {
  const cacheKey = `about:${sub}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const { status, raw } = await fetchUrl(`https://www.reddit.com/r/${sub}/about.json`);
    if (status !== 200) {
      let errorType = 'bad_response';
      if (status === 429) errorType = 'rate_limited';
      else if (status === 403) errorType = 'forbidden_or_private';
      else if (status === 404) errorType = 'not_found';
      const result = { subscribers: null, fetchFailed: true, errorType, details: `${status}` };
      return result;
    }
    const data = JSON.parse(raw);
    const d = data.data;
    const result = {
      subscribers: d?.subscribers ?? null,
      display_name: d?.display_name ?? sub
    };
    setCached(cacheKey, result);
    return result;
  } catch (e) {
    return { subscribers: null, fetchFailed: true, errorType: 'network_error', details: e.message || 'unknown' };
  }
}

function classifyPostFetchError(status, e) {
  if (e) return { errorType: 'network_error', errorMessage: e.message || 'unknown' };
  if (status === 429) return { errorType: 'rate_limited', errorMessage: '429' };
  if (status === 403) return { errorType: 'forbidden_or_private', errorMessage: '403' };
  if (status === 404) return { errorType: 'not_found', errorMessage: '404' };
  return { errorType: 'bad_response', errorMessage: `${status}` };
}

async function fetchSubredditPosts(sub, limit, recencyDays) {
  const cacheKey = `posts:${sub}:${recencyDays}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const delays = [10000, 30000];
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const { status, raw } = await fetchUrl(
        `https://www.reddit.com/r/${sub}/new.json?limit=${Math.min(limit, 100)}`
      );
      if (status === 429 && attempt < 2) {
        await new Promise(r => setTimeout(r, delays[attempt]));
        continue;
      }
      if (status !== 200) {
        const snippet = /^\s*[{[]/.test(raw) ? null : (raw || '').slice(0, 120);
        const err = classifyPostFetchError(status, null);
        const result = { ok: false, httpStatus: status, ...err, hostTried: 'www.reddit.com', responseSnippet: snippet, posts: [], fetchedCount: 0, fetchedAt: Date.now() };
        return result;
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        const snippet = /^\s*[{[]/.test(raw) ? null : (raw || '').slice(0, 120);
        return { ok: false, httpStatus: status, errorType: 'bad_response', errorMessage: 'invalid json', hostTried: 'www.reddit.com', responseSnippet: snippet, posts: [], fetchedCount: 0, fetchedAt: Date.now() };
      }
      const posts = data.data?.children || [];
      const result = { ok: true, httpStatus: 200, posts, fetchedCount: posts.length, fetchedAt: Date.now() };
      setCached(cacheKey, result);
      return result;
    } catch (e) {
      if (attempt < 2 && (e.name === 'TypeError' || (e.message && (e.message.includes('fetch') || e.message.includes('network'))))) {
        await new Promise(r => setTimeout(r, delays[attempt]));
        continue;
      }
      return { ok: false, httpStatus: null, errorType: 'network_error', errorMessage: e.message || 'unknown', hostTried: 'www.reddit.com', posts: [], fetchedCount: 0, fetchedAt: Date.now() };
    }
  }
  return { ok: false, httpStatus: null, errorType: 'network_error', errorMessage: 'max retries', hostTried: 'www.reddit.com', posts: [], fetchedCount: 0, fetchedAt: Date.now() };
}

function extractCoOccurring(text, frictionKeywords, topN = CO_OCCURRING_TOP_N) {
  const lower = (text || '').toLowerCase();
  const frictionSet = new Set(frictionKeywords.map(k => k.toLowerCase()));
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runDiscovery(opts) {
  const startTime = Date.now();
  const { seedList, recencyDays = 30, limitPerSub = 100, cursor = 0, subsLimit = 15 } = opts;

  const seeds = seedList && seedList.length > 0
    ? seedList.filter(s => typeof s === 'string').map(s => s.replace(/^r\//, '').toLowerCase()).filter(s => !isNonUsSub(s))
    : SEED_SUBREDDITS.filter(s => !isNonUsSub(s));

  const subsToScrape = seeds.slice(cursor, cursor + subsLimit);
  const frictionKeywords = HEALTHCARE_FRICTION_KEYWORDS;

  const postDataBySub = {};
  const metaBySub = {};

  for (let i = 0; i < subsToScrape.length; i++) {
    if (Date.now() - startTime > TIME_BUDGET_MS) break;

    const sub = subsToScrape[i];
    const aboutResult = await fetchSubredditAbout(sub);
    metaBySub[sub] = aboutResult || { subscribers: null };

    if (Date.now() - startTime > TIME_BUDGET_MS) break;

    const postResult = await fetchSubredditPosts(sub, limitPerSub, recencyDays);
    postDataBySub[sub] = postResult || { ok: false, posts: [], fetchedCount: 0 };

    if (i < subsToScrape.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const processedCount = Object.keys(postDataBySub).length;
  const nextCursor = cursor + processedCount < seeds.length ? cursor + processedCount : null;

  const cutoffUtc = Date.now() / 1000 - recencyDays * 24 * 3600;
  const qualifyingBySub = {};
  const nearMisses = [];

  for (const [sub, postResult] of Object.entries(postDataBySub)) {
    const members = metaBySub[sub]?.subscribers ?? null;
    const posts = postResult.posts || [];
    const fetchedCount = postResult.fetchedCount ?? posts.length;

    const qualifying = [];
    for (const p of posts) {
      const d = p.data || {};
      const title = d.title || '';
      const selftext = d.selftext || '';
      const createdUtc = d.created_utc || 0;

      if (createdUtc < cutoffUtc) continue;
      if (hasOutOfMarketSignal(title + ' ' + selftext)) continue;
      if (!qualifiesForProblemSpace(title + ' ' + selftext, frictionKeywords)) continue;

      qualifying.push({
        id: d.id,
        subreddit: sub,
        title,
        selftext: selftext.substring(0, 500),
        score: d.score ?? 0,
        num_comments: d.num_comments ?? 0,
        created_utc: createdUtc,
        permalink: d.permalink || '',
        url: `https://reddit.com${d.permalink || ''}`
      });
    }

    if (members != null && members > 0 && members < MIN_MEMBERS) {
      nearMisses.push({ subreddit: sub, members, reason: 'too small', details: `${members} members` });
      continue;
    }
    if (qualifying.length === 0) {
      let reason, details;
      const nm = { subreddit: sub, members, reason: '', details: '' };
      if (!postResult.ok) {
        reason = 'fetch failed';
        details = postResult.errorType || `${postResult.httpStatus ?? 'error'}`;
        nm.httpStatus = postResult.httpStatus;
        nm.errorType = postResult.errorType;
        nm.hostTried = postResult.hostTried;
        if (postResult.responseSnippet) nm.responseSnippet = postResult.responseSnippet;
      } else if (fetchedCount === 0) {
        reason = 'no posts returned';
        details = 'reddit returned 0 posts';
      } else if (fetchedCount < 5) {
        reason = 'low recent activity';
        details = `only ${fetchedCount} posts in window`;
      } else {
        reason = 'no matching posts in window';
        details = `${fetchedCount} posts scanned`;
      }
      nm.reason = reason;
      nm.details = details;
      nearMisses.push(nm);
      continue;
    }
    qualifyingBySub[sub] = {
      qualifying,
      totalFetched: posts.length,
      members: members ?? 0
    };
  }

  const communities = [];

  for (const [sub, data] of Object.entries(qualifyingBySub)) {
    const { qualifying, totalFetched, members } = data;
    const painPostRatio = totalFetched > 0 ? qualifying.length / totalFetched : 0;
    const demandScore = qualifying.length;
    const lowCommentCount = qualifying.filter(p => (p.num_comments || 0) < 3).length;
    const opportunityScore = qualifying.length > 0 ? lowCommentCount / qualifying.length : 0;
    const activityScore = qualifying.length;

    const allText = qualifying.map(p => (p.title || '') + ' ' + (p.selftext || '')).join(' ');
    const coOccurringKeywords = extractCoOccurring(allText, frictionKeywords);

    const w1 = 0.25, w2 = 0.3, w3 = 0.2, w4 = 0.25;
    const priorityScore = Math.min(100, Math.round(
      w1 * painPostRatio * 100 +
      w2 * opportunityScore * 100 +
      w3 * Math.min(activityScore / 20, 1) * 100 +
      w4 * Math.min(demandScore / 15, 1) * 100
    ));

    const samplePosts = qualifying
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10)
      .map(p => ({
        id: p.id,
        title: p.title,
        selftextSnippet: (p.selftext || '').substring(0, 200),
        url: p.url,
        numComments: p.num_comments,
        score: p.score,
        createdUtc: p.created_utc
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
      lowConfidence: qualifying.length < 2
    });
  }

  communities.sort((a, b) => b.priorityScore - a.priorityScore);

  const rawPostCount = Object.values(qualifyingBySub).reduce((sum, d) => sum + d.qualifying.length, 0);
  const topNearMisses = nearMisses
    .sort((a, b) => (b.members ?? 0) - (a.members ?? 0))
    .slice(0, 20);

  const timeMs = Date.now() - startTime;

  return {
    cursor,
    nextCursor,
    processedCount,
    communities,
    nearMisses: topNearMisses,
    rawPostCount,
    totalCommunitiesScored: communities.length,
    fetchedAt: new Date().toISOString(),
    timeMs,
    debug: { recencyDays, seedsUsed: seeds.length }
  };
}

module.exports = { runDiscovery };

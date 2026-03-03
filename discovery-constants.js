// Layer 1 — Wide pain search: friction phrases (evidence first)
const PAIN_SEARCH_BLOCKS = {
  costBarrier: ["can't afford", "cant afford", "too expensive", "medical bill", "ER bill", "urgent care cost", "prescription cost"],
  insuranceFriction: ["deductible", "no insurance", "insurance won't cover", "high deductible", "out of pocket"],
  accessFriction: ["nearest doctor", "long drive", "no clinic near me", "wait time"],
};
const SEARCH_KEYWORDS = [
  ...PAIN_SEARCH_BLOCKS.costBarrier,
  ...PAIN_SEARCH_BLOCKS.insuranceFriction,
  ...PAIN_SEARCH_BLOCKS.accessFriction,
].filter((v, i, a) => a.indexOf(v) === i);

// Post-level pain scoring (weighted)
const POST_PAIN_SCORES = {
  costBarrier: 3,
  noInsurance: 3,
  deductible: 2,
  delayedCare: 2,
  askingAlternatives: 2,
  urgentCare: 1,
  distance: 1,
};

// ICP persona signals (who they are) - for icpMatchScore
const ICP_KEYWORDS = [
  'gig', 'freelance', '1099', 'contractor', 'self-employed', 'self employed',
  'no benefits', 'no employer', 'side hustle', 'sidehustle',
  'family plan', 'roommate', 'roommates', 'split rent', 'budget',
  'rural', 'lower income', 'uninsured', 'underinsured', 'high deductible',
  'teachers', 'bartender', 'server', 'trucker', 'nurse', 'delivery driver',
];

module.exports = {
  SEARCH_KEYWORDS,
  ICP_KEYWORDS,
  HEALTHCARE_FRICTION_KEYWORDS: [
    'cant afford', "can't afford", "can't afford healthcare", 'cant afford doctor',
    'no insurance', 'without insurance', 'no insurance what do i do', 'uninsured',
    'medical bill', 'medical bills', 'medical cost', 'healthcare cost', 'insurance cost',
    'urgent care cost', 'prescription cost', 'prescription costs', 'lab test cost',
    'deductible', 'deductible 6000', 'no benefits', 'out of pocket', 'self pay',
    'telehealth', 'cash pay', 'health insurance', 'afford healthcare',
    'cant afford insurance', "can't afford insurance", 'skip healthcare', 'delayed care',
  ],
  OUT_OF_MARKET_SIGNALS: ['nhs', 'ohip', 'private healthcare uk', 'australian medicare'],
  NON_US_SUBREDDITS: [
    'ukpersonalfinance', 'ausfinance', 'ausfinanceaustralia', 'personalfinanceuk',
    'ukinvesting', 'ukfrugal', 'ukjobs', 'canadafinance', 'personalfinancecanada',
    'nhs', 'askuk', 'australia', 'canada',
  ],
  PAIN_SEARCH_BLOCKS,
  POST_PAIN_SCORES,
  PRIORITY_SEEDS: [
    'uberdrivers', 'doordash', 'lyftdrivers', 'instacartshoppers', 'freelance', 'selfemployed',
    'povertyfinance', 'frugal', 'debt', 'studentloans', 'adulting',
    'parenting', 'Mommit', 'singleparents',
    'rural', 'smalltown', 'montana', 'wyoming',
    'assistance', 'foodstamps', 'snap', 'disability',
  ],
  SECONDARY_SEEDS: [
    'healthinsurance', 'medicalbilling', 'legaladvice', 'AskDocs', 'pharmacy',
    'grubhubdrivers', 'amazonflexdrivers', 'workonline', 'sidehustle', 'budget',
    'daddit', 'AskParents', 'westvirginia', 'homestead', 'college', 'GradSchool', 'roommates',
  ],
  PROMOTION_PAIN_DENSITY: 0.2,
  PROMOTION_QUALIFYING_POSTS: 5,
  STOP_TARGET_COMMUNITIES: 60,
  STOP_PAIN_DENSITY_FLOOR: 0.05,
  PRUNING_DRY_RUNS: 5,
  PRUNING_FORBIDDEN_TWICE: 2,
  SEED_SUBREDDITS: [
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
    'immigration', 'immigrants',
  ],
  MIN_MEMBERS: 50,
  CO_OCCURRING_TOP_N: 20,
  STOPWORDS: new Set([
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
    'doesnt', 'didnt', 'wont', 'wouldnt', 'couldnt', 'shouldnt', 'cant', 'cannot',
  ]),
};

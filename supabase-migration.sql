-- Run this in Supabase SQL Editor to create discovery tables.

CREATE TABLE IF NOT EXISTS discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text UNIQUE NOT NULL,
  subreddits text[] DEFAULT '{}',
  communities_count int DEFAULT 0,
  near_misses_count int DEFAULT 0,
  raw_post_count int DEFAULT 0,
  status text DEFAULT 'completed',
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discovery_communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subreddit text UNIQUE NOT NULL,
  run_id text,
  url text,
  member_count int,
  priority_score int,
  pain_post_ratio numeric,
  demand_score int,
  opportunity_score numeric,
  co_occurring_keywords jsonb DEFAULT '[]',
  sample_posts jsonb DEFAULT '[]',
  has_evidence boolean DEFAULT false,
  icp_match_score int,
  updated_at timestamptz DEFAULT now()
);

-- If table already exists, run: ALTER TABLE discovery_communities ADD COLUMN IF NOT EXISTS has_evidence boolean DEFAULT false, ADD COLUMN IF NOT EXISTS icp_match_score int;

-- Allow anon/service role to insert/update
ALTER TABLE discovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_communities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service insert discovery_runs" ON discovery_runs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow service insert discovery_communities" ON discovery_communities
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow service update discovery_communities" ON discovery_communities
  FOR UPDATE USING (true);

-- Self-improving ICP: seed_runs and discovered_seeds
CREATE TABLE IF NOT EXISTS seed_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subreddit text NOT NULL,
  run_date date NOT NULL DEFAULT current_date,
  run_id text,
  posts_scanned int DEFAULT 0,
  qualifying_posts int DEFAULT 0,
  pain_density numeric,
  error_type text,
  seed_tier text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(subreddit, run_date)
);

CREATE TABLE IF NOT EXISTS discovered_seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subreddit text UNIQUE NOT NULL,
  pain_density numeric,
  qualifying_posts int DEFAULT 0,
  added_at timestamptz DEFAULT now(),
  high_priority boolean DEFAULT false
);

ALTER TABLE seed_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovered_seeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service seed_runs" ON seed_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service discovered_seeds" ON discovered_seeds FOR ALL USING (true) WITH CHECK (true);

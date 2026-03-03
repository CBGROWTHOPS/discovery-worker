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
  updated_at timestamptz DEFAULT now()
);

-- Allow anon/service role to insert/update
ALTER TABLE discovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_communities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service insert discovery_runs" ON discovery_runs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow service insert discovery_communities" ON discovery_communities
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow service update discovery_communities" ON discovery_communities
  FOR UPDATE USING (true);

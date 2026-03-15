-- Executive Team Schema Extension
-- Run this in Supabase SQL Editor after the base schema.sql
-- Adds: agents, tasks, cost tracking, approvals, news items

-- ============================================================
-- AGENTS TABLE (Registry)
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  model_default TEXT NOT NULL DEFAULT 'haiku',
  model_escalated TEXT DEFAULT 'sonnet',
  autonomy_default INTEGER DEFAULT 1 CHECK (autonomy_default IN (1, 2, 3)),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

-- Seed agent roster
INSERT INTO agents (id, name, role, model_default, model_escalated, autonomy_default) VALUES
  ('coo', 'Tamille', 'Chief Operating Officer', 'opus', 'opus', 1),
  ('cio', 'CIO', 'Chief Information Officer', 'sonnet', 'opus', 1),
  ('cfo', 'CFO', 'Chief Financial Officer', 'sonnet', 'opus', 1),
  ('cmo', 'CMO', 'Chief Marketing Officer', 'haiku', 'sonnet', 2),
  ('head-content', 'Head of Content', 'Head of Content Production', 'sonnet', 'opus', 2),
  ('head-education', 'Head of Education', 'Head of Education (Thomas Support)', 'haiku', 'haiku', 1),
  ('head-household', 'Head of Household', 'Head of Household', 'haiku', 'haiku', 2),
  ('head-newsroom', 'Head of News Room', 'Head of News Room', 'haiku', 'sonnet', 1)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- TASKS TABLE (Work Units)
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  agent_id TEXT REFERENCES agents(id),
  type TEXT NOT NULL,
  autonomy_tier INTEGER NOT NULL CHECK (autonomy_tier IN (1, 2, 3)),
  status TEXT DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'in_progress', 'awaiting_coo',
      'awaiting_approval', 'approved', 'rejected',
      'changes_requested', 'completed', 'failed'
    )),
  title TEXT NOT NULL,
  input TEXT,
  output TEXT,
  coo_review TEXT,
  user_feedback TEXT,
  telegram_message_id INTEGER,
  metadata JSONB DEFAULT '{}',
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

-- ============================================================
-- COST TRACKING TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_tracking (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  agent_id TEXT REFERENCES agents(id),
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  estimated_cost_cents NUMERIC(10,4) DEFAULT 0,
  task_id UUID REFERENCES tasks(id),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cost_agent_date ON cost_tracking(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_created ON cost_tracking(created_at DESC);

-- ============================================================
-- APPROVALS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS approvals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  task_id UUID REFERENCES tasks(id) NOT NULL,
  telegram_message_id INTEGER,
  telegram_chat_id TEXT,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
  resolved_at TIMESTAMPTZ,
  user_response TEXT
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_task ON approvals(task_id);

-- ============================================================
-- NEWS ITEMS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS news_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  category TEXT NOT NULL CHECK (category IN (
    'direct_impact', 'industry_trends', 'research', 'policy', 'breaking'
  )),
  title TEXT NOT NULL,
  summary TEXT,
  source_url TEXT,
  source_name TEXT,
  importance INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  included_in_digest BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  embedding VECTOR(1536)
);

CREATE INDEX IF NOT EXISTS idx_news_created ON news_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_category ON news_items(category);
CREATE INDEX IF NOT EXISTS idx_news_importance ON news_items(importance DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON agents FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON tasks FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON cost_tracking FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON approvals FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON news_items FOR ALL USING (true);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Get daily cost by agent
CREATE OR REPLACE FUNCTION get_daily_costs(for_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  agent_id TEXT,
  agent_name TEXT,
  total_cents NUMERIC,
  call_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.agent_id,
    a.name AS agent_name,
    COALESCE(SUM(c.estimated_cost_cents), 0) AS total_cents,
    COUNT(*) AS call_count
  FROM cost_tracking c
  JOIN agents a ON a.id = c.agent_id
  WHERE c.created_at::date = for_date
  GROUP BY c.agent_id, a.name
  ORDER BY total_cents DESC;
END;
$$ LANGUAGE plpgsql;

-- Get weekly cost summary
CREATE OR REPLACE FUNCTION get_weekly_costs()
RETURNS TABLE (
  agent_id TEXT,
  agent_name TEXT,
  total_cents NUMERIC,
  call_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.agent_id,
    a.name AS agent_name,
    COALESCE(SUM(c.estimated_cost_cents), 0) AS total_cents,
    COUNT(*) AS call_count
  FROM cost_tracking c
  JOIN agents a ON a.id = c.agent_id
  WHERE c.created_at >= NOW() - INTERVAL '7 days'
  GROUP BY c.agent_id, a.name
  ORDER BY total_cents DESC;
END;
$$ LANGUAGE plpgsql;

-- Get pending approvals
CREATE OR REPLACE FUNCTION get_pending_approvals()
RETURNS TABLE (
  approval_id UUID,
  task_id UUID,
  agent_id TEXT,
  agent_name TEXT,
  title TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ap.id AS approval_id,
    t.id AS task_id,
    t.agent_id,
    a.name AS agent_name,
    t.title,
    ap.created_at
  FROM approvals ap
  JOIN tasks t ON t.id = ap.task_id
  JOIN agents a ON a.id = t.agent_id
  WHERE ap.status = 'pending'
  ORDER BY ap.created_at ASC;
END;
$$ LANGUAGE plpgsql;

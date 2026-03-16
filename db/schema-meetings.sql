-- Executive Meetings Schema Extension
-- Run this in Supabase SQL Editor after schema-agents.sql
-- Adds: meetings table for scheduled standups and ad hoc meetings

-- ============================================================
-- MEETINGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS meetings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  type TEXT NOT NULL CHECK (type IN ('standup', 'adhoc')),
  topic TEXT NOT NULL,
  status TEXT DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  autonomy_tier INTEGER NOT NULL DEFAULT 1 CHECK (autonomy_tier IN (1, 2)),
  rounds_completed INTEGER DEFAULT 0,
  max_rounds INTEGER DEFAULT 3,
  transcript JSONB DEFAULT '[]',
  synthesis TEXT,
  recommendation TEXT,
  consensus JSONB DEFAULT '{}',
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_meetings_type ON meetings(type);
CREATE INDEX IF NOT EXISTS idx_meetings_created ON meetings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);

-- RLS
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON meetings FOR ALL USING (true);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Get recent meetings
CREATE OR REPLACE FUNCTION get_recent_meetings(limit_count INTEGER DEFAULT 20)
RETURNS TABLE (
  id UUID,
  created_at TIMESTAMPTZ,
  type TEXT,
  topic TEXT,
  status TEXT,
  rounds_completed INTEGER,
  completed_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.created_at,
    m.type,
    m.topic,
    m.status,
    m.rounds_completed,
    m.completed_at
  FROM meetings m
  ORDER BY m.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

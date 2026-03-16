-- Security Schema Extension
-- Adds: security_inspections table for CISO agent
-- Run this in Supabase SQL Editor after schema-agents.sql

-- ============================================================
-- SECURITY INSPECTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS security_inspections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  agent_id TEXT REFERENCES agents(id) NOT NULL,
  inspection_date DATE DEFAULT CURRENT_DATE,
  test_type TEXT NOT NULL CHECK (test_type IN (
    'prompt_injection', 'data_exfiltration', 'approval_bypass',
    'system_override', 'canary_check', 'input_sanitization',
    'cross_agent_access', 'full_inspection'
  )),
  passed BOOLEAN NOT NULL DEFAULT true,
  findings TEXT,
  patches_applied TEXT,
  posture_score INTEGER CHECK (posture_score BETWEEN 0 AND 100),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_security_agent ON security_inspections(agent_id);
CREATE INDEX IF NOT EXISTS idx_security_date ON security_inspections(inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_security_passed ON security_inspections(passed);

-- RLS
ALTER TABLE security_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON security_inspections FOR ALL USING (true);

-- ============================================================
-- HELPER: Get latest posture scores for all agents
-- ============================================================
CREATE OR REPLACE FUNCTION get_agent_posture_scores()
RETURNS TABLE (
  agent_id TEXT,
  agent_name TEXT,
  posture_score INTEGER,
  last_inspection TIMESTAMPTZ,
  tests_passed BIGINT,
  tests_failed BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (a.id)
    a.id AS agent_id,
    a.name AS agent_name,
    si.posture_score,
    si.created_at AS last_inspection,
    (SELECT COUNT(*) FROM security_inspections s2 WHERE s2.agent_id = a.id AND s2.passed = true) AS tests_passed,
    (SELECT COUNT(*) FROM security_inspections s2 WHERE s2.agent_id = a.id AND s2.passed = false) AS tests_failed
  FROM agents a
  LEFT JOIN security_inspections si ON si.agent_id = a.id
  WHERE a.active = true
  ORDER BY a.id, si.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- HELPER: Get recent inspection results
-- ============================================================
CREATE OR REPLACE FUNCTION get_recent_inspections(days_back INTEGER DEFAULT 7)
RETURNS TABLE (
  id UUID,
  agent_id TEXT,
  agent_name TEXT,
  test_type TEXT,
  passed BOOLEAN,
  findings TEXT,
  posture_score INTEGER,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    si.id,
    si.agent_id,
    a.name AS agent_name,
    si.test_type,
    si.passed,
    si.findings,
    si.posture_score,
    si.created_at
  FROM security_inspections si
  JOIN agents a ON a.id = si.agent_id
  WHERE si.created_at >= NOW() - (days_back || ' days')::INTERVAL
  ORDER BY si.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Add new agents to the agents table
INSERT INTO agents (id, name, role, model_default, model_escalated, autonomy_default) VALUES
  ('head-wellness', 'Head of Wellness', 'Personal Confidant & Mental Health Check-in', 'sonnet', 'opus', 3),
  ('ciso', 'CISO', 'Chief Information Security Officer', 'sonnet', 'opus', 1)
ON CONFLICT (id) DO NOTHING;

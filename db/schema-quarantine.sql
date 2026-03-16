-- Quarantine System Schema Extension
-- Run this in Supabase SQL Editor after schema-agents.sql
-- Adds quarantine columns to the agents table for CISO enforcement

-- ============================================================
-- ADD QUARANTINE COLUMNS TO AGENTS TABLE
-- ============================================================

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS quarantined BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;

-- Ensure all existing agents have quarantined=false
UPDATE agents SET quarantined = false WHERE quarantined IS NULL;

-- ============================================================
-- HELPER: Get quarantined agents
-- ============================================================

CREATE OR REPLACE FUNCTION get_quarantined_agents()
RETURNS TABLE (
  agent_id TEXT,
  agent_name TEXT,
  agent_role TEXT,
  quarantine_reason TEXT,
  quarantined_since TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id AS agent_id,
    a.name AS agent_name,
    a.role AS agent_role,
    a.quarantine_reason,
    si.created_at AS quarantined_since
  FROM agents a
  LEFT JOIN LATERAL (
    SELECT created_at FROM security_inspections
    WHERE agent_id = a.id AND passed = false
    ORDER BY created_at DESC LIMIT 1
  ) si ON true
  WHERE a.quarantined = true
  ORDER BY a.name;
END;
$$ LANGUAGE plpgsql;

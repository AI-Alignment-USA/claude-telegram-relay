-- Migration 004: New command center dashboard tabs
-- Tables: integration_health, products, content_pipeline, known_issues

-- ============================================================
-- INTEGRATION HEALTH
-- ============================================================

CREATE TABLE IF NOT EXISTS integration_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_name TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_message TEXT,
  endpoint_called TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_health_name ON integration_health(integration_name);
CREATE INDEX IF NOT EXISTS idx_integration_health_created ON integration_health(created_at DESC);

ALTER TABLE integration_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for integration_health" ON integration_health FOR ALL USING (true);

-- ============================================================
-- PRODUCTS
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Live', 'Draft', 'Planned', 'Blocked')),
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for products" ON products FOR ALL USING (true);

-- ============================================================
-- CONTENT PIPELINE
-- ============================================================

CREATE TABLE IF NOT EXISTS content_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('video', 'post', 'blog')),
  platform TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Idea', 'Draft', 'Approved', 'Published')) DEFAULT 'Idea',
  assigned_agent TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_pipeline_status ON content_pipeline(status);

ALTER TABLE content_pipeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for content_pipeline" ON content_pipeline FOR ALL USING (true);

-- ============================================================
-- KNOWN ISSUES
-- ============================================================

CREATE TABLE IF NOT EXISTS known_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Open', 'Fixed', 'Needs Fix')) DEFAULT 'Open',
  severity TEXT NOT NULL CHECK (severity IN ('Critical', 'Warning', 'Info')),
  assigned_agent TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_known_issues_status ON known_issues(status);
CREATE INDEX IF NOT EXISTS idx_known_issues_severity ON known_issues(severity);

ALTER TABLE known_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for known_issues" ON known_issues FOR ALL USING (true);

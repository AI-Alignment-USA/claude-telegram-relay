-- db/migrations/003-add-rendering-status.sql
-- Add "rendering" status to tasks table for async video generation

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN (
    'pending', 'in_progress', 'awaiting_coo',
    'awaiting_approval', 'approved', 'rejected',
    'changes_requested', 'completed', 'failed',
    'rendering'
  ));

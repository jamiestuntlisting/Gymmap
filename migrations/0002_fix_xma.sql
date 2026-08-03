-- One-time data fixes found during the Cloudflare migration.
-- Run against production D1 with:
--   npx wrangler d1 execute gymmap --remote --file=migrations/0002_fix_xma.sql
--
-- 1. "XMA Action" was accidentally approved twice — drop the duplicate row.
DELETE FROM schools WHERE id='a7eb397c-389c-421d-aa39-65153b6dfbb6';
-- 2. XMA Training Center: submission had a typo'd address (5405 → 15405
--    Los Gatos Blvd #103) and no map coordinates.
UPDATE schools SET
  address='15405 Los Gatos Blvd, Suite 103, Los Gatos, CA 95032, USA',
  lat=37.2497, lon=-121.9611, updated_at=datetime('now')
WHERE id='c157be8e-3540-43b4-8390-de95e9deea6c';
-- 3. XMA Action (North Hollywood): add map coordinates.
UPDATE schools SET
  lat=34.1650, lon=-118.3768, updated_at=datetime('now')
WHERE id='855a8c52-583d-4509-bf7b-39cf170121dd';

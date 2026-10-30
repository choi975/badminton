-- Manual weekday allowlists are superseded by attendance-derived weekday habits.
-- Preserve explicit not_days rules, temporary absences, statistics and mutation receipts.
DELETE FROM short_term_rules WHERE rule_type = 'only_days';

UPDATE app_settings
SET value = CAST(value AS INTEGER) + 1
WHERE key = 'shake_revision';

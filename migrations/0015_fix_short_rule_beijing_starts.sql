UPDATE short_term_rules
SET starts_on = date(created_at, '+8 hours')
WHERE starts_on = substr(created_at, 1, 10);

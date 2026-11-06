ALTER TABLE shuttle_types ADD COLUMN default_price REAL;

-- Keep the existing UI default for 亚3; other registered types start at their first valid price.
-- Price aliases and all saved booking/billing records remain unchanged.
UPDATE shuttle_types
SET default_price = CASE
  WHEN id = 'rsl3' AND EXISTS (SELECT 1 FROM json_each(prices_json) WHERE CAST(value AS REAL) = 11.3) THEN 11.3
  ELSE (SELECT CAST(value AS REAL) FROM json_each(prices_json) WHERE CAST(value AS REAL) > 0 ORDER BY CAST(key AS INTEGER) LIMIT 1)
END;

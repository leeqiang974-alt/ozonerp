DO $$
DECLARE row record;
BEGIN
  FOR row IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'character varying'
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE TEXT', row.table_name, row.column_name);
  END LOOP;
END $$;

-- Audit timestamps belong to the database clock. Besides keeping several app
-- instances consistent, this also protects writes made outside Drizzle from
-- silently leaving updated_at stale.
CREATE OR REPLACE FUNCTION public.schedra_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = transaction_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE column_name = 'updated_at'
      AND table_schema = current_schema()
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS schedra_set_updated_at ON %I.%I',
      target.table_schema,
      target.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER schedra_set_updated_at BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.schedra_set_updated_at()',
      target.table_schema,
      target.table_name
    );
  END LOOP;
END;
$$;

-- Custom migration: extensions, app role, RLS policies, double-booking guard.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fekerte_app') THEN
    CREATE ROLE fekerte_app NOLOGIN NOBYPASSRLS;
  END IF;
  BEGIN
    EXECUTE format('GRANT fekerte_app TO %I', current_user);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'could not grant fekerte_app to %: %', current_user, SQLERRM;
  END;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_business_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.business_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.is_super_admin', true), '') = 'on'
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fekerte_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fekerte_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fekerte_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fekerte_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_business_id(), app_is_super_admin() TO fekerte_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['memberships','locations','resources','staff','services','staff_services','working_hours','breaks','time_off','holidays','customers','conversations','messages','calls','appointments','notifications','jobs','usage_events','subscriptions','invoices','payments','review_requests','campaigns','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO fekerte_app USING (business_id = app_current_business_id() OR app_is_super_admin()) WITH CHECK (business_id = app_current_business_id() OR app_is_super_admin())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON businesses TO fekerte_app
  USING (id = app_current_business_id() OR app_is_super_admin())
  WITH CHECK (id = app_current_business_id() OR app_is_super_admin());
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY members_visible ON users FOR SELECT TO fekerte_app
  USING (
    app_is_super_admin()
    OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.business_id = app_current_business_id())
  );
--> statement-breakpoint
CREATE POLICY super_admin_write ON users FOR UPDATE TO fekerte_app USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
--> statement-breakpoint
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY plans_read ON plans FOR SELECT TO fekerte_app USING (true);
--> statement-breakpoint
CREATE POLICY plans_admin ON plans TO fekerte_app USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
--> statement-breakpoint
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY leads_admin ON leads TO fekerte_app USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION appointments_set_blocked_range() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ends_at <= NEW.starts_at THEN
    RAISE EXCEPTION 'appointment must end after it starts' USING ERRCODE = '23514';
  END IF;
  NEW.blocked_start := NEW.starts_at - make_interval(mins => NEW.buffer_before_minutes);
  NEW.blocked_end := NEW.ends_at + make_interval(mins => NEW.buffer_after_minutes);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER appointments_blocked_range
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_set_blocked_range();
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (staff_id WITH =, tstzrange(blocked_start, blocked_end, '[)') WITH &&)
  WHERE (status <> 'cancelled');
--> statement-breakpoint
ALTER TABLE working_hours ADD CONSTRAINT working_hours_valid CHECK (weekday BETWEEN 1 AND 7 AND end_time > start_time);
--> statement-breakpoint
ALTER TABLE breaks ADD CONSTRAINT breaks_valid CHECK (weekday BETWEEN 1 AND 7 AND end_time > start_time);
--> statement-breakpoint
ALTER TABLE time_off ADD CONSTRAINT time_off_valid CHECK (ends_at > starts_at);
--> statement-breakpoint
ALTER TABLE holidays ADD CONSTRAINT holidays_valid CHECK (end_date >= start_date);
--> statement-breakpoint
ALTER TABLE services ADD CONSTRAINT services_duration_valid CHECK (duration_minutes > 0 AND buffer_before_minutes >= 0 AND buffer_after_minutes >= 0);

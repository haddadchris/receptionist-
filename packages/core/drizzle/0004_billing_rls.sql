-- Billing hardening: tenants can READ their own invoices/subscriptions but only
-- super admins (or the system/owner connection) can write them. Usage events are
-- append-only for tenants. Payments: tenants may only write deposit payments.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices','subscriptions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT TO fekerte_app USING (business_id = app_current_business_id() OR app_is_super_admin())', t);
    EXECUTE format('CREATE POLICY admin_write ON %I TO fekerte_app USING (app_is_super_admin()) WITH CHECK (app_is_super_admin())', t);
  END LOOP;
END $$;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON usage_events;
--> statement-breakpoint
CREATE POLICY tenant_read ON usage_events FOR SELECT TO fekerte_app USING (business_id = app_current_business_id() OR app_is_super_admin());
--> statement-breakpoint
CREATE POLICY tenant_append ON usage_events FOR INSERT TO fekerte_app WITH CHECK (business_id = app_current_business_id() OR app_is_super_admin());
--> statement-breakpoint
CREATE POLICY admin_write ON usage_events FOR UPDATE TO fekerte_app USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
--> statement-breakpoint
CREATE POLICY admin_delete ON usage_events FOR DELETE TO fekerte_app USING (app_is_super_admin());
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payments;
--> statement-breakpoint
CREATE POLICY tenant_read ON payments FOR SELECT TO fekerte_app USING (business_id = app_current_business_id() OR app_is_super_admin());
--> statement-breakpoint
CREATE POLICY tenant_deposits ON payments TO fekerte_app
  USING (app_is_super_admin() OR (business_id = app_current_business_id() AND kind = 'deposit'))
  WITH CHECK (app_is_super_admin() OR (business_id = app_current_business_id() AND kind = 'deposit'));
--> statement-breakpoint
-- Plan, status, trial and feature flags are billing state: only super admins
-- (or the owner connection used by system jobs) may change them.
CREATE OR REPLACE FUNCTION protect_business_billing_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'fekerte_app' AND NOT app_is_super_admin() AND (
    NEW.plan_tier IS DISTINCT FROM OLD.plan_tier OR
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at OR
    NEW.feature_flags IS DISTINCT FROM OLD.feature_flags
  ) THEN
    RAISE EXCEPTION 'billing columns can only be changed by an administrator' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS businesses_protect_billing ON businesses;
--> statement-breakpoint
CREATE TRIGGER businesses_protect_billing BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION protect_business_billing_columns();

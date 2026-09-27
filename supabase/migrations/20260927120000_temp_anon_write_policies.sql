-- TEMPORARY emergency unblock: allow browser writes so clinical notes save.
--
-- WHY: the app talks to Supabase straight from the browser with the anon key
-- (see docs/config.js). RLS is enabled and there are no anon INSERT policies, so
-- every save from the doctor dashboard failed with:
--   42501 new row violates row-level security policy
-- The last clinical note that saved was id 4 on 2026-08-18.
--
-- RISK: the anon key is published in the PUBLIC repo Skywalkingzulu1/Doctorsonwheels.
-- Anyone who reads that repo can use this key to write or alter clinical records.
-- Make the repo private and rotate the key. Delete this file once phase 2 lands.
--
-- NOTE: deliberately NOT running "ALTER TABLE ... ENABLE ROW LEVEL SECURITY" here.
-- If RLS is currently disabled on a table these policies are inert and writes
-- already work; forcing RLS on could break the app's existing anon SELECT.

-- 1. Inspect current state (read-only, safe to run on its own).
SELECT tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('medical_records', 'prescriptions', 'appointments', 'Profiles', 'Doctors')
ORDER BY tablename, cmd, policyname;

-- 2. Clinical notes, sick notes, referral letters.
DROP POLICY IF EXISTS "temp_anon_write_medical_records" ON public.medical_records;
CREATE POLICY "temp_anon_write_medical_records" ON public.medical_records
    FOR INSERT TO anon, authenticated
    WITH CHECK (true);

-- 3. Prescriptions.
DROP POLICY IF EXISTS "temp_anon_write_prescriptions" ON public.prescriptions;
CREATE POLICY "temp_anon_write_prescriptions" ON public.prescriptions
    FOR INSERT TO anon, authenticated
    WITH CHECK (true);

-- 4. Patient questionnaire (writes appointments.triage_data).
DROP POLICY IF EXISTS "temp_anon_update_appointments" ON public.appointments;
CREATE POLICY "temp_anon_update_appointments" ON public.appointments
    FOR UPDATE TO anon, authenticated
    USING (true) WITH CHECK (true);

-- 5. Confirm the policies landed.
SELECT tablename, policyname, cmd, roles::text
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname LIKE 'temp_anon_write_%'
ORDER BY tablename;

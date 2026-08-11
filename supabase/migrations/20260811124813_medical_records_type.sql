-- Add document type + title to medical_records so clinical notes, sick notes,
-- and referral letters are stored and queried separately.
ALTER TABLE public.medical_records ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.medical_records ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.medical_records ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Persist the doctor's drawn digital signature (PNG data URL).
ALTER TABLE public."Doctors" ADD COLUMN IF NOT EXISTS signature text;

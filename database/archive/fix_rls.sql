-- This script adds Row Level Security (RLS) policies to allow the application to read and write data.

-- 1. Enable RLS on both tables (Supabase best practice)
ALTER TABLE "PsychE_Students" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_Counseling_Logs" ENABLE ROW LEVEL SECURITY;

-- 2. Create policies that allow the 'anon' key to read and write data
-- Note: In a production environment with Authentication, you would change 'true' to 'auth.uid() = ...'
CREATE POLICY "Allow anonymous read/write access to Students" 
ON "PsychE_Students" 
FOR ALL 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Allow anonymous read/write access to Counseling Logs" 
ON "PsychE_Counseling_Logs" 
FOR ALL 
USING (true) 
WITH CHECK (true);

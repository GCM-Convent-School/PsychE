const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Initialize Supabase Client (Requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env)
// Note: In a real server environment, use the SERVICE_ROLE key for bypassing RLS.
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(bodyParser.json());

// Webhook endpoint to import a student and optionally their logs
app.post('/webhook/import', async (req, res) => {
  const { student, logs } = req.body;
  
  if (!student || !student.student_id || !student.full_name) {
    return res.status(400).json({ error: 'Invalid payload: Missing required student data.' });
  }

  try {
    console.log(`[Webhook] Received data for student: ${student.full_name}`);
    
    // 1. Insert or Upsert Student
    const { data: studentData, error: studentError } = await supabase
      .from('PsychE_Students')
      .upsert({
        student_id: student.student_id,
        full_name: student.full_name,
        fathers_name: student.fathers_name || null,
        mothers_name: student.mothers_name || null,
        mobile: student.mobile || null,
        email: student.email || null,
        course: student.course || null,
        enrolled_date: student.enrolled_date || null
      }, { onConflict: 'student_id' })
      .select('id')
      .single();

    if (studentError) throw studentError;
    const studentUuid = studentData.id;
    console.log(`[Webhook] Student successfully imported. UUID: ${studentUuid}`);

    // 2. Insert Logs if provided
    let logsImported = 0;
    if (logs && Array.isArray(logs) && logs.length > 0) {
      const logsToInsert = logs.map(log => ({
        student_uuid: studentUuid,
        counselor_name: log.counselor_name || 'System Import',
        session_date: log.session_date || new Date().toISOString(),
        reason: log.reason || 'Imported Log',
        student_response: log.student_response || '',
        recommended_action: log.recommended_action || '',
        file_updated: log.file_updated || false,
        notification_sent: log.notification_sent || false
      }));

      const { error: logsError } = await supabase
        .from('PsychE_Counseling_Logs')
        .insert(logsToInsert);

      if (logsError) throw logsError;
      logsImported = logs.length;
      console.log(`[Webhook] ${logsImported} logs successfully imported.`);
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Data successfully imported.',
      student_uuid: studentUuid,
      logs_imported: logsImported
    });

  } catch (error) {
    console.error('[Webhook] Error importing data:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`PsychE Webhook Server is running on port ${port}`);
  console.log(`Send POST requests to http://localhost:${port}/webhook/import`);
});

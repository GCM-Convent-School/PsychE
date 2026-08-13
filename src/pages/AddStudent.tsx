import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Camera, ArrowLeft, Save, User, Edit2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toLocalDateStr } from '../lib/capacity';
import { toTitleCase } from '../utils/stringFormatter';
import { isValidStudentId, STUDENT_ID_PATTERN, STUDENT_ID_HINT, STUDENT_ID_PLACEHOLDER } from '../utils/studentId';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

export const AddStudent: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  
  // Form State
  const [studentId, setStudentId] = useState('');
  const [fullName, setFullName] = useState('');
  const [fathersName, setFathersName] = useState('');
  const [mothersName, setMothersName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [course, setCourse] = useState('');
  const [availableCourses, setAvailableCourses] = useState<any[]>([]);
  const [enrolledDate, setEnrolledDate] = useState(toLocalDateStr(new Date()));
  const [profileImage, setProfileImage] = useState<string | null>(null);

  useEffect(() => {
    document.title = "UPsych : GCM Edition | Student Profile";
    const fetchCourses = async () => {
      try {
        const { data, error } = await supabase.from('PsychE_Courses').select('*').order('course_name');
        if (!error && data) {
          setAvailableCourses(data);
        }
      } catch (err) {
        console.error("Error fetching courses:", err);
      }
    };
    fetchCourses();
  }, []);

  useEffect(() => {
    if (id) {
      setIsEdit(true);
      fetchStudentData(id);
    }
  }, [id]);

  const fetchStudentData = async (studentUuid: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('PsychE_Students')
        .select('*')
        .eq('id', studentUuid)
        .single();
        
      if (error) throw error;
      if (data) {
        setStudentId(data.student_id || '');
        setFullName(data.full_name || '');
        setFathersName(data.fathers_name || '');
        setMothersName(data.mothers_name || '');
        setMobile(data.mobile || '');
        setEmail(data.email || '');
        setCourse(data.course || '');
        setEnrolledDate(data.enrolled_date ? data.enrolled_date.split('T')[0] : '');
        setProfileImage(data.profile_image || null);
      }
    } catch (error) {
      console.error("Error fetching student:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024) {
      alert("Image must be smaller than 100KB");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setProfileImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Strict Regex Validation (BUG-001 & BUG-002).
    // Pattern owned by utils/studentId.ts — the CSV importer reads the same
    // constant, so the two paths can no longer disagree about what is valid.
    if (!isValidStudentId(studentId)) {
      alert(`Student ID must look like ${STUDENT_ID_HINT}.`);
      return;
    }

    setLoading(true);

    try {
      // String Normalization (BUG-006 & BUG-007)
      const payload = {
        student_id: studentId,
        full_name: toTitleCase(fullName),
        fathers_name: toTitleCase(fathersName),
        mothers_name: toTitleCase(mothersName),
        mobile,
        email,
        course,
        enrolled_date: enrolledDate,
        profile_image: profileImage
      };

      let result;
      if (isEdit) {
        result = await supabase.from('PsychE_Students').update(payload).eq('id', id).select('id').single();
      } else {
        result = await supabase.from('PsychE_Students').insert([payload]).select('id').single();
      }

      if (result.error) throw result.error;
      
      // Success - navigate to the new student's profile
      if (result.data?.id) {
        // Navigate by student_id (human-readable) not UUID
        navigate(`/student/${studentId}`);
      } else {
        navigate('/');
      }
    } catch (error: any) {
      console.error('Error adding student:', error);
      alert(`Failed to add student. ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" style={{ padding: '1rem 0', maxWidth: '800px', margin: '0 auto' }}>
      
      <div className="flex justify-between items-center mb-6 mobile-stack mobile-stack-start" style={{ padding: '0 2rem', gap: '1rem' }}>
        <div>
          <button onClick={() => navigate(-1)} className="btn btn-secondary mb-4" style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', backgroundColor: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ArrowLeft size={16} /> Back to Dashboard
          </button>
          <h1 className="text-h1 flex items-center gap-2">
            {isEdit ? <Edit2 size={28} /> : <User size={28} />} 
            {isEdit ? 'Edit Student Profile' : 'Add New Student'}
          </h1>
          <p className="text-gray-300">
            {isEdit ? 'Update student details and profile picture.' : 'Register a new student in the GCM Convent School database.'}
          </p>
        </div>
      </div>

      <motion.div className="bento-card" style={{ padding: '2rem' }}>
        <form onSubmit={handleSubmit} className="flex" style={{ flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="flex justify-center mb-2 flex-col items-center gap-2">
            <div className="hover:bg-gray-800 transition-colors cursor-pointer" style={{ position: 'relative', width: '100px', height: '100px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '2px dashed rgba(255,255,255,0.2)', transition: 'all 0.2s ease' }}>
              {profileImage ? (
                <img src={profileImage} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Camera size={32} color="rgba(255,255,255,0.3)" />
              )}
              <input 
                type="file" 
                accept="image/jpeg, image/png" 
                onChange={handleImageUpload}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
              />
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Click to upload photo · Max 100 KB</p>
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '4px', backgroundColor: 'rgba(94,106,210,0.12)', color: 'var(--color-primary)', border: '1px solid rgba(94,106,210,0.25)' }}>.JPG</span>
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '4px', backgroundColor: 'rgba(94,106,210,0.12)', color: 'var(--color-primary)', border: '1px solid rgba(94,106,210,0.25)' }}>.PNG</span>
            </div>
          </div>

          <div className="flex gap-4 mobile-stack">
            <div style={{ flex: 1 }}>
              <label className="text-h3" style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem' }}>Student ID *</label>
              <input 
                required
                type="text" 
                className="input" 
                placeholder={STUDENT_ID_PLACEHOLDER}
                pattern={STUDENT_ID_PATTERN}
                // No help line under the field. The format lives in the native
                // validation bubble, so it appears exactly when it is needed.
                // Chrome no longer folds `title` into that bubble and shows a
                // generic "Please match the format requested" instead — and
                // because pattern validation blocks submit, handleSubmit's
                // friendlier message never gets the chance to run. Setting the
                // message explicitly is what actually reaches the user.
                onInvalid={(e) => {
                  const el = e.currentTarget;
                  // Reset first so the browser re-derives why this is invalid;
                  // a stale custom message would otherwise mask the real reason
                  // and keep a now-valid field rejected. Only override the
                  // format case — an empty field should still say "fill this
                  // out", not quote an ID format at someone who typed nothing.
                  el.setCustomValidity('');
                  if (el.validity.patternMismatch) {
                    el.setCustomValidity(`Student ID looks like ${STUDENT_ID_HINT}`);
                  }
                }}
                value={studentId}
                onChange={(e) => { e.currentTarget.setCustomValidity(''); setStudentId(e.target.value); }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="text-h3" style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem' }}>Full Name *</label>
              <input 
                required
                type="text" 
                className="input" 
                placeholder="Student's full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-4 mobile-stack">
            <div style={{ flex: 1 }}>
              <label className="text-h3" style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem' }}>Father's Name</label>
              <input 
                type="text" 
                className="input" 
                placeholder="e.g. Ramesh Kumar"
                value={fathersName}
                onChange={(e) => setFathersName(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="text-h3" style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem' }}>Mother's Name</label>
              <input 
                type="text" 
                className="input" 
                placeholder="e.g. Sunita Devi"
                value={mothersName}
                onChange={(e) => setMothersName(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-4 mobile-stack">
            <div style={{ flex: 1 }}>
              <label className="text-h3" style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem' }}>Mobile Number <span className="text-red-500 ml-1">*</span></label>
              <input 
                required
                type="text" 
                className="input" 
                placeholder="+91..."
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="text-h3" style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem' }}>Email Address <span className="text-red-500 ml-1">*</span></label>
              <input 
                required
                type="email" 
                className="input" 
                placeholder="e.g. student@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-4 mobile-stack">
            <div style={{ flex: 1 }}>
              <label className="text-h3" style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem' }}>Course / Class *</label>
              <select 
                required
                className="input w-full" 
                value={course}
                onChange={(e) => setCourse(e.target.value)}
              >
                <option value="" disabled>Select a course</option>
                {availableCourses.map((c) => (
                  <option key={c.id} value={c.course_name}>{c.course_name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="text-h3" style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem' }}>Enrollment Date</label>
              <input 
                type="date" 
                className="input" 
                value={enrolledDate}
                onChange={(e) => setEnrolledDate(e.target.value)}
              />
            </div>
          </div>

          <div className="w-full mt-4">
            <motion.button 
              type="submit"
              disabled={loading}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="btn btn-primary w-full"
              style={{ background: 'linear-gradient(135deg, var(--color-primary), #8b5cf6)', border: 'none', padding: '0.75rem 2rem', width: '100%', display: 'flex', justifyContent: 'center' }}
            >
              {loading ? 'Saving...' : <><Save size={18} /> {isEdit ? 'Save Changes' : 'Add Student'}</>}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

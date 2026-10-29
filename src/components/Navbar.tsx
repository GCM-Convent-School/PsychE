import React, { useState, useEffect, useRef } from 'react';
import { Search, UserPlus, Activity, LogOut, BookOpen, Users, Settings as SettingsIcon, LayoutDashboard, X, BarChart2, Tag } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBranding, PRODUCT_NAME } from '../lib/branding';

export const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const { staff, signOut } = useAuth();
  const { schoolName } = useBranding();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchSearchResults = async () => {
      if (searchQuery.trim().length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      // Strip PostgREST filter-syntax characters so a comma/parenthesis in the
      // search text can't change the shape of the .or() clause below.
      const escapedQuery = searchQuery.replace(/[,()]/g, '');
      const { data, error } = await supabase
        .from('PsychE_Students')
        .select('id, full_name, student_id')
        .or(`full_name.ilike.%${escapedQuery}%,student_id.ilike.%${escapedQuery}%,mobile.ilike.%${escapedQuery}%`)
        .limit(5);

      if (cancelled) return;
      if (!error && data) {
        setSearchResults(data);
      }
      setIsSearching(false);
    };

    const debounceTimer = setTimeout(fetchSearchResults, 300);
    return () => { cancelled = true; clearTimeout(debounceTimer); };
  }, [searchQuery]);

  const handleSelectStudent = (studentId: string) => {
    setSearchQuery('');
    setSearchResults([]);
    navigate(`/student/${studentId}`);
  };

  return (
    <motion.nav 
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="navbar no-print" 
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 2rem',
        gap: '1rem',
        backgroundColor: 'rgba(24, 27, 33, 0.8)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--color-border)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}
    >
      <div className="navbar-brand flex items-center gap-4">
        <Link to="/" className="flex items-center gap-3">
          <motion.div 
            whileHover={{ rotate: 15, scale: 1.1 }}
            className="navbar-mark"
            style={{
              background: 'linear-gradient(135deg, var(--color-primary), #8b5cf6)',
              color: 'white',
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(94, 106, 210, 0.3)'
            }}
          >
            <BookOpen size={20} />
          </motion.div>
          <div className="flex" style={{ flexDirection: 'column' }}>
            <span className="navbar-title text-h3" style={{ letterSpacing: '-0.02em', lineHeight: '1.2' }}>{PRODUCT_NAME}</span>
            <span className="navbar-sub text-muted" style={{ fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{schoolName ?? staff?.full_name}</span>
          </div>
        </Link>
      </div>

      <div className="navbar-search flex items-center justify-center hidden-mobile" style={{ flexGrow: 1, maxWidth: '600px', margin: '0 2rem' }} ref={searchRef}>
        <motion.div 
          whileFocus={{ scale: 1.02 }}
          style={{ position: 'relative', width: '100%' }}
        >
          <Search style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} size={18} />
          <input 
            type="text" 
            placeholder="Search students by Name, ID, or Phone..." 
            className="input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ 
              paddingLeft: '48px', 
              paddingRight: searchQuery.length > 0 ? '48px' : '16px',
              borderRadius: 'var(--radius-full)', 
              backgroundColor: 'rgba(15, 17, 21, 0.5)',
              border: '1px solid var(--color-border)',
              transition: 'all 0.3s ease',
              width: '100%'
            }}
          />
          {searchQuery.length > 0 && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSearchResults([]);
              }}
              style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={16} className="text-muted" style={{ color: 'var(--color-text-muted)' }} />
            </button>
          )}
          
          <AnimatePresence>
            {searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '0.5rem',
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)',
                  overflow: 'hidden',
                  zIndex: 100
                }}
              >
                {searchResults.map((student) => (
                  <div 
                    key={student.id}
                    onClick={() => handleSelectStudent(student.student_id)}
                    style={{
                      padding: '0.75rem 1rem',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--color-border)',
                      transition: 'background-color 0.2s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <div style={{ fontWeight: 500 }}>{student.full_name}</div>
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>{student.student_id}</div>
                  </div>
                ))}
              </motion.div>
            )}
            
            {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '0.5rem',
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  textAlign: 'center',
                  boxShadow: 'var(--shadow-lg)'
                }}
              >
                <p className="text-muted">No students found.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      <div className="navbar-actions flex items-center gap-4 flex-wrap justify-center">
        <motion.button 
          onClick={() => navigate('/directory')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="btn btn-secondary flex items-center gap-2"
          style={{ 
            border: '1px solid var(--color-border)', 
            padding: '0.5rem 1.25rem',
            backgroundColor: 'rgba(255,255,255,0.05)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            marginRight: '0.5rem'
          }}
        >
          <Users size={18} className="text-primary" style={{ color: 'var(--color-primary)' }} />
          <span className="nav-btn-label" style={{ fontWeight: 600, color: 'var(--color-text)' }}>Directory</span>
        </motion.button>
        <motion.button 
          onClick={() => navigate('/add-student')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="btn btn-primary"
          style={{ background: 'linear-gradient(135deg, var(--color-primary), #8b5cf6)', border: 'none', boxShadow: '0 4px 12px rgba(94, 106, 210, 0.3)' }}
        >
          <UserPlus size={16} />
          <span className="nav-btn-label">Add Student</span>
        </motion.button>
        <motion.button 
          onClick={() => navigate('/library')}
          whileHover={{ scale: 1.1, color: 'var(--accent-purple)' }}
          whileTap={{ scale: 0.95 }}
          className="btn btn-secondary" style={{ padding: '0.5rem', background: 'transparent', border: 'none' }} title="Assessment Library"
        >
          <BookOpen size={20} />
        </motion.button>
        <motion.button 
          onClick={() => navigate('/tags')}
          whileHover={{ scale: 1.1, color: 'var(--accent-green)' }}
          whileTap={{ scale: 0.95 }}
          className="btn btn-secondary" style={{ padding: '0.5rem', background: 'transparent', border: 'none' }} title="Problem Tags"
        >
          <Tag size={20} />
        </motion.button>
        <div className="navbar-divider" style={{ width: '1px', height: '24px', backgroundColor: 'var(--color-border)' }}></div>
        <motion.button 
          onClick={() => navigate('/analytics')}
          whileHover={{ scale: 1.1, color: 'var(--color-primary)' }}
          whileTap={{ scale: 0.95 }}
          className="btn btn-secondary" style={{ padding: '0.5rem', background: 'transparent', border: 'none' }} title="Analytics"
        >
          <BarChart2 size={20} />
        </motion.button>
        <motion.button 
          onClick={() => navigate('/kanban')}
          whileHover={{ scale: 1.1, color: 'var(--color-primary)' }}
          whileTap={{ scale: 0.95 }}
          className="btn btn-secondary" style={{ padding: '0.5rem', background: 'transparent', border: 'none' }} title="Planner"
        >
          <LayoutDashboard size={20} />
        </motion.button>
        <motion.button 
          onClick={() => navigate('/settings')}
          whileHover={{ scale: 1.1, color: 'var(--color-primary)' }}
          whileTap={{ scale: 0.95 }}
          className="btn btn-secondary" style={{ padding: '0.5rem', background: 'transparent', border: 'none' }} title="Settings"
        >
          <SettingsIcon size={20} />
        </motion.button>
        <motion.button 
          onClick={() => navigate('/logs')}
          whileHover={{ scale: 1.1, color: 'var(--color-primary)' }}
          whileTap={{ scale: 0.95 }}
          className="btn btn-secondary" style={{ padding: '0.5rem', background: 'transparent', border: 'none' }} title="Activity Logs"
        >
          <Activity size={20} />
        </motion.button>
        <motion.button
          onClick={() => { signOut(); }}
          whileHover={{ scale: 1.1, color: 'var(--color-danger)' }}
          whileTap={{ scale: 0.95 }}
          className="btn btn-secondary" style={{ padding: '0.5rem', background: 'transparent', border: 'none', color: 'var(--color-text-muted)' }} title={staff ? `Sign out ${staff.full_name}` : 'Sign out'} aria-label="Sign out"
        >
          <LogOut size={20} />
        </motion.button>
      </div>
    </motion.nav>
  );
};

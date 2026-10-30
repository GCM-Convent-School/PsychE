import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, BookOpen, CalendarDays, CalendarPlus, Home, LineChart, Moon, NotebookPen, Plus, Search,
  Settings as SettingsIcon, Sun, Tag, UserPlus, Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';
import { PALETTE_EVENT } from '../lib/palette';
import { Avatar } from './Avatar';

// ⌘K / Ctrl+K from anywhere: find a student by name, ID or phone, jump to any
// page, or run a common action. Anything can open it with openPalette().

interface Hit { id: string; full_name: string; student_id: string; course: string | null }
interface Item { key: string; group: string; label: string; sub?: string; icon: React.ReactNode; run: () => void }

export const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  const { resolved, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Every open starts clean.
    const show = () => { setQ(''); setHits([]); setActive(0); setOpen(true); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => { if (!o) { setQ(''); setHits([]); setActive(0); } return !o; });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, show);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(PALETTE_EVENT, show); };
  }, []);

  const term = q.trim().replace(/[,()]/g, '');
  useEffect(() => {
    if (!open || term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase.from('PsychE_Students')
        .select('id, full_name, student_id, course')
        .or(`full_name.ilike.%${term}%,student_id.ilike.%${term}%,mobile.ilike.%${term}%`)
        .limit(6);
      if (!cancelled) { setHits((data ?? []) as Hit[]); setActive(0); }
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [term, open]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => navigate(to);
    const shownHits = term.length >= 2 ? hits : [];
    const all: Item[] = [
      ...shownHits.map((h) => ({
        key: `s-${h.id}`, group: 'Students', label: h.full_name, sub: [h.course, h.student_id].filter(Boolean).join(' · '),
        icon: <Avatar name={h.full_name} />, run: go(`/student/${h.student_id}`),
      })),
      { key: 'a-log', group: 'Actions', label: 'Log a session', icon: <Plus size={16} />, run: go('/add-log') },
      { key: 'a-add', group: 'Actions', label: 'Add a student', icon: <UserPlus size={16} />, run: go('/add-student') },
      { key: 'a-book', group: 'Actions', label: 'Book sessions', sub: 'Fill free slots automatically', icon: <CalendarPlus size={16} />, run: go('/bulk-schedule') },
      { key: 'a-theme', group: 'Actions', label: resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />, run: () => setTheme(resolved === 'dark' ? 'light' : 'dark') },
      { key: 'p-home', group: 'Go to', label: 'Home', icon: <Home size={16} />, run: go('/') },
      { key: 'p-students', group: 'Go to', label: 'Students', icon: <Users size={16} />, run: go('/directory') },
      { key: 'p-cal', group: 'Go to', label: 'Calendar', sub: '7-day planner', icon: <CalendarDays size={16} />, run: go('/kanban') },
      { key: 'p-day', group: 'Go to', label: 'Day view', icon: <CalendarDays size={16} />, run: go('/day') },
      { key: 'p-sessions', group: 'Go to', label: 'Sessions', icon: <NotebookPen size={16} />, run: go('/logs') },
      { key: 'p-insights', group: 'Go to', label: 'Insights', icon: <LineChart size={16} />, run: go('/analytics') },
      { key: 'p-library', group: 'Go to', label: 'Library', sub: 'Assessments', icon: <BookOpen size={16} />, run: go('/library') },
      { key: 'p-tags', group: 'Go to', label: 'Problem tags', icon: <Tag size={16} />, run: go('/tags') },
      { key: 'p-settings', group: 'Go to', label: 'Settings', icon: <SettingsIcon size={16} />, run: go('/settings') },
    ];
    const needle = q.trim().toLowerCase();
    return all.filter((i) => i.group === 'Students' || !needle || `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(needle));
  }, [hits, term, q, navigate, resolved, setTheme]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const choose = (i: Item | undefined) => { if (!i) return; setOpen(false); i.run(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(items[active]); }
  };

  let lastGroup = '';
  return (
    <div className="palette-overlay" role="presentation" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and commands" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Search size={17} aria-hidden="true" />
          <input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a student, page or action…"
            aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active]?.key} />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {term.length >= 2 && items.length === 0 && <div className="palette-empty">Nothing matches “{q.trim()}”.</div>}
          {items.map((i, idx) => {
            const head = i.group !== lastGroup ? <div className="palette-group" key={`g-${i.group}`}>{i.group}</div> : null;
            lastGroup = i.group;
            return (
              <React.Fragment key={i.key}>
                {head}
                <button type="button" id={i.key} role="option" aria-selected={idx === active} className="palette-item"
                  onMouseMove={() => setActive(idx)} onClick={() => choose(i)}>
                  {i.icon}
                  <span>{i.label}</span>
                  {i.sub && <span className="palette-item-sub">{i.sub}</span>}
                  {idx === active && !i.sub && <ArrowRight size={14} style={{ marginLeft: 'auto' }} aria-hidden="true" />}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="palette-foot" aria-hidden="true">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> move</span>
          <span><span className="kbd">↵</span> open</span>
          <span style={{ marginLeft: 'auto' }}><span className="kbd">⌘K</span> anywhere</span>
        </div>
      </div>
    </div>
  );
};

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Home } from './pages/Home';
import { StudentProfile } from './pages/StudentProfile';
import { AddLog } from './pages/AddLog';
import { AddStudent } from './pages/AddStudent';
import { AllLogs } from './pages/AllLogs';
import { StudentDirectory } from './pages/StudentDirectory';
import { Settings } from './pages/Settings';
import { KanbanBoard } from './pages/KanbanBoard';
import { BulkSchedule } from './pages/BulkSchedule';
import { AuthGate } from './components/AuthGate';
import { AuthProvider } from './lib/auth';
import { ReportExport } from './pages/ReportExport';
import { FormalReportExport } from './pages/FormalReportExport';
import { Analytics } from './pages/Analytics';
import { LibraryManager } from './components/LibraryManager';
import { GlobalTagManager } from './components/GlobalTagManager';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={
            <AuthGate>
              <Layout />
            </AuthGate>
          }>
            <Route index element={<Home />} />
            <Route path="day" element={<Dashboard />} />
            <Route path="student/:studentId" element={<StudentProfile />} />
            <Route path="add-log" element={<AddLog />} />
            <Route path="add-student" element={<AddStudent />} />
            <Route path="edit-student/:id" element={<AddStudent />} />
            <Route path="logs" element={<AllLogs />} />
            <Route path="directory" element={<StudentDirectory />} />
            <Route path="settings" element={<Settings />} />
            <Route path="kanban" element={<KanbanBoard />} />
            <Route path="bulk-schedule" element={<BulkSchedule />} />
            <Route path="analytics" element={<Analytics />} />
            {/* V3 Routes */}
            <Route path="library" element={<LibraryManager />} />
            <Route path="tags" element={<GlobalTagManager />} />
          </Route>
          <Route path="/report" element={<AuthGate><ReportExport /></AuthGate>} />
          <Route path="/formal-report" element={<AuthGate><FormalReportExport /></AuthGate>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}


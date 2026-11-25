import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import LeadManagementPage from './pages/LeadManagementPage.jsx';
import LeadCreatePage from './pages/LeadCreatePage.jsx';
import LeadDetailsPage from './pages/LeadDetailsPage.jsx';
import LeadImportPage from './pages/LeadImportPage.jsx';
import { useAuth } from './context/AuthContext.jsx';

function ForbiddenPage() { return <main className="grid min-h-screen place-items-center text-slate-700">You do not have access to this page.</main>; }

export default function App() {
  const { user } = useAuth();
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/leads" element={<LeadManagementPage />} />
      <Route path="/imports/leads" element={<ProtectedRoute roles={['admin']} />}>
        <Route index element={<LeadImportPage />} />
      </Route>
      <Route path="/leads/new" element={<ProtectedRoute roles={['admin']} />}>
        <Route index element={<LeadCreatePage />} />
      </Route>
      <Route path="/leads/:id" element={<LeadDetailsPage />} />
    </Route>
    <Route path="/forbidden" element={<ForbiddenPage />} />
    <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
  </Routes>;
}

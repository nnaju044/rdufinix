import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({ roles }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <main className="grid min-h-screen place-items-center text-slate-600">Checking session…</main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}

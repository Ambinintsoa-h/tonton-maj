import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';

export default function RoleGuard({ children, allowedRoles }) {
  const role = useSelector(s => s.auth.role);
  if (!allowedRoles.includes(role)) return <Navigate to="/" replace />;
  return children;
}

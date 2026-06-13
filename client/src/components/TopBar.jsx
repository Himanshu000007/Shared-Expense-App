import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function TopBar() {
  const { user, logout } = useAuth();
  return (
    <div className="topbar">
      <Link className="brand" to="/">◆ Splitr</Link>
      <div className="spread">
        <span className="muted">{user?.name}</span>
        <button className="ghost small" onClick={logout}>Log out</button>
      </div>
    </div>
  );
}

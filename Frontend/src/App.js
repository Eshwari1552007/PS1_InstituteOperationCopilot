import { useState } from 'react';
import LoginPage from './components/LoginPage';
import { clearSession, getStoredUser } from './auth/authService';
import './App.css';

function App() {
  const [user, setUser] = useState(getStoredUser);

  const handleSignOut = () => {
    clearSession();
    setUser(null);
  };

  if (!user) {
    return <LoginPage onAuthenticated={() => setUser(getStoredUser())} />;
  }

  return (
    <div className="app-shell">
      <div className="app-panel">
        <span className="app-role">{user.role}</span>
        <h1 className="app-title">Signed in as {user.email}</h1>
        <p className="app-text">The dashboard, copilot and approvals screens come next.</p>
        <button className="app-signout" type="button" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export default App;

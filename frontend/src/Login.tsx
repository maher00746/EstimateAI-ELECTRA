import { useState } from "react";

interface LoginProps {
  onLogin: () => void;
}

function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // For demo purposes, any input will log in
    onLogin();
  };

  return (
    <div className="login-container">
      <div className="login-background">
        <div className="login-glow login-glow--1"></div>
        <div className="login-glow login-glow--2"></div>
        <div className="login-glow login-glow--3"></div>
      </div>
      
      <div className="login-card">
        <div className="login-card__header">
          <div className="login-logo">
            <img src="/logo.png" alt="Logo" className="login-logo__image" />
          </div>
          <h1 className="login-title">AI Powered Estimation System</h1>
          <p className="login-subtitle">Intelligent estimation management platform</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-form__group">
            <label htmlFor="username" className="login-form__label">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
                <path d="M3 16c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Username
            </label>
            <input
              id="username"
              type="text"
              className="login-form__input"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>

          <div className="login-form__group">
            <label htmlFor="password" className="login-form__label">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="4" y="8" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 8V6a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Password
            </label>
            <input
              id="password"
              type="password"
              className="login-form__input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="login-form__submit">
            <span>Sign In</span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M7 3l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>

        <div className="login-card__footer">
          <div className="login-features">
            <div className="login-feature">
              <div className="login-feature__icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2l2.5 5 5.5.5-4 4 1 5.5-5-2.5-5 2.5 1-5.5-4-4 5.5-.5L10 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </div>
              <span>AI-Powered Analysis</span>
            </div>
            <div className="login-feature">
              <div className="login-feature__icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span>Smart Matching</span>
            </div>
            <div className="login-feature">
              <div className="login-feature__icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <span>Knowledge Base</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;


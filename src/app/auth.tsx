"use client";

import { useState, useEffect } from 'react';
import { register, loginStep1, loginStep2, isRegistered, verifySession, logout, changePassphrase } from './auth-actions';
import { generatePublicKey, clientLoginStep1, clientLoginStep2 } from '@/lib/utils/zkp';

const SESSION_TOKEN_KEY = 'fanacrypt_session_token';

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);
  const [showChangePassphrase, setShowChangePassphrase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Check authentication status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    setIsChecking(true);
    try {
      // Check if user is registered
      const registered = await isRegistered();

      if (registered) {
        // Check if session token exists and is valid
        const sessionToken = localStorage.getItem(SESSION_TOKEN_KEY);
        if (sessionToken) {
          const isValid = await verifySession(sessionToken);
          if (isValid) {
            setIsAuthenticated(true);
          } else {
            localStorage.removeItem(SESSION_TOKEN_KEY);
          }
        }
      } else {
        setShowRegistration(true);
      }
    } catch (err) {
      console.error('Auth check error:', err);
      setError('Failed to check authentication status');
    } finally {
      setIsChecking(false);
    }
  };

  const handleRegister = async (passphrase: string) => {
    setLoading(true);
    setError(null);
    try {
      // Generate public key from passphrase
      const X = await generatePublicKey(passphrase);
      
      // Register with server
      const result = await register(X.toString());
      
      if (result.success) {
        setShowRegistration(false);
        // After registration, automatically log in
        await handleLogin(passphrase);
      } else {
        setError(result.error || 'Registration failed');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (passphrase: string) => {
    setLoading(true);
    setError(null);
    try {
      // Step 1: Client generates commitment V
      const { x, v, V } = await clientLoginStep1(passphrase);
      
      // Send V to server and get challenge c
      const step1Result = await loginStep1(V.toString());
      
      if (!step1Result.success || !step1Result.challenge || !step1Result.sessionId) {
        setError(step1Result.error || 'Login step 1 failed');
        setLoading(false);
        return;
      }

      // Step 2: Client computes response b
      const b = clientLoginStep2(v, step1Result.challenge, x);
      
      // Send b to server and get session token
      const step2Result = await loginStep2(step1Result.sessionId, b.toString());
      
      if (step2Result.success && step2Result.sessionToken) {
        // Store session token
        localStorage.setItem(SESSION_TOKEN_KEY, step2Result.sessionToken);
        setIsAuthenticated(true);
        setError(null);
      } else {
        setError(step2Result.error || 'Login failed');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    const sessionToken = localStorage.getItem(SESSION_TOKEN_KEY);
    if (sessionToken) {
      await logout(sessionToken);
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
    setIsAuthenticated(false);
  };

  if (isChecking) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-12 w-12 text-blue-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-400">Checking authentication...</p>
        </div>
      </div>
    );
  }

  const handleChangePassphrase = async (newPassphrase: string) => {
    setLoading(true);
    setError(null);
    try {
      // Generate new public key from new passphrase
      const newX = await generatePublicKey(newPassphrase);
      
      // Get session token
      const sessionToken = localStorage.getItem(SESSION_TOKEN_KEY);
      
      // Change passphrase (requires authentication)
      const result = await changePassphrase(sessionToken, newX.toString());
      
      if (result.success) {
        // Clear session and force re-login
        localStorage.removeItem(SESSION_TOKEN_KEY);
        setIsAuthenticated(false);
        setShowChangePassphrase(false);
        setError(null);
        // Show success message
        alert('Passphrase changed successfully. Please login with your new passphrase.');
      } else {
        setError(result.error || 'Failed to change passphrase');
      }
    } catch (err) {
      console.error('Change passphrase error:', err);
      setError(err instanceof Error ? err.message : 'Failed to change passphrase');
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated) {
    return (
      <div>
        <div className="fixed top-4 right-4 z-50 flex gap-2">
          <button
            onClick={() => setShowChangePassphrase(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition"
          >
            🔑 Change Passphrase
          </button>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition"
          >
            🚪 Logout
          </button>
        </div>
        
        {showChangePassphrase && (
          <ChangePassphraseModal
            onClose={() => {
              setShowChangePassphrase(false);
              setError(null);
            }}
            onSubmit={handleChangePassphrase}
            loading={loading}
            error={error}
          />
        )}
        
        {children}
      </div>
    );
  }

  // Show registration or login form
  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-6">
      <div className="bg-neutral-900 rounded-lg shadow-lg p-8 border border-gray-700 max-w-md w-full">
        <h1 className="text-3xl font-bold text-gray-100 mb-2 text-center">
          🔐 Fanacrypt
        </h1>
        <p className="text-gray-400 text-center mb-6">
          {showRegistration ? 'Create your account' : 'Login to continue'}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-200 text-sm">
            {error}
          </div>
        )}

        <AuthForm
          mode={showRegistration ? 'register' : 'login'}
          onSubmit={showRegistration ? handleRegister : handleLogin}
          loading={loading}
          onToggleMode={() => {
            setShowRegistration(!showRegistration);
            setError(null);
          }}
        />
      </div>
    </div>
  );
}

function AuthForm({
  mode,
  onSubmit,
  loading,
  onToggleMode,
}: {
  mode: 'register' | 'login';
  onSubmit: (passphrase: string) => Promise<void>;
  loading: boolean;
  onToggleMode: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (mode === 'register') {
      if (passphrase.length < 8) {
        return;
      }
      if (passphrase !== confirmPassphrase) {
        return;
      }
    } else {
      if (passphrase.length === 0) {
        return;
      }
    }

    await onSubmit(passphrase);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="passphrase" className="block text-sm font-medium text-gray-300 mb-2">
          Passphrase
        </label>
        <div className="relative">
          <input
            id="passphrase"
            type={showPassword ? 'text' : 'password'}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="w-full px-4 py-2 bg-neutral-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your passphrase"
            disabled={loading}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
          >
            {showPassword ? '🙈' : '👁️'}
          </button>
        </div>
        {mode === 'register' && (
          <p className="mt-1 text-xs text-gray-500">
            Must be at least 8 characters long
          </p>
        )}
      </div>

      {mode === 'register' && (
        <div>
          <label htmlFor="confirmPassphrase" className="block text-sm font-medium text-gray-300 mb-2">
            Confirm Passphrase
          </label>
          <input
            id="confirmPassphrase"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassphrase}
            onChange={(e) => setConfirmPassphrase(e.target.value)}
            className="w-full px-4 py-2 bg-neutral-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Confirm your passphrase"
            disabled={loading}
            required
          />
          {passphrase && confirmPassphrase && passphrase !== confirmPassphrase && (
            <p className="mt-1 text-xs text-red-400">Passphrases do not match</p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || (mode === 'register' && (passphrase.length < 8 || passphrase !== confirmPassphrase))}
        className={`w-full px-4 py-2 rounded-md text-white font-medium transition ${
          loading || (mode === 'register' && (passphrase.length < 8 || passphrase !== confirmPassphrase))
            ? 'bg-gray-700 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {loading ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {mode === 'register' ? 'Registering...' : 'Logging in...'}
          </span>
        ) : (
          mode === 'register' ? 'Register' : 'Login'
        )}
      </button>

      <div className="text-center">
        <button
          type="button"
          onClick={onToggleMode}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          {mode === 'register' ? 'Already set a passphrase? Login' : "No passphrase yet? Register"}
        </button>
      </div>
    </form>
  );
}

function ChangePassphraseModal({
  onClose,
  onSubmit,
  loading,
  error,
}: {
  onClose: () => void;
  onSubmit: (newPassphrase: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}) {
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassphrase.length < 8) {
      return;
    }
    if (newPassphrase !== confirmPassphrase) {
      return;
    }

    await onSubmit(newPassphrase);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 rounded-lg shadow-lg p-8 border border-gray-700 max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-100">🔑 Change Passphrase</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200"
            disabled={loading}
          >
            ✕
          </button>
        </div>

        <p className="text-gray-400 text-sm mb-6">
          Enter your new passphrase. You will be logged out and need to login again with the new passphrase.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-200 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="newPassphrase" className="block text-sm font-medium text-gray-300 mb-2">
              New Passphrase
            </label>
            <div className="relative">
              <input
                id="newPassphrase"
                type={showPassword ? 'text' : 'password'}
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.target.value)}
                className="w-full px-4 py-2 bg-neutral-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter new passphrase"
                disabled={loading}
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Must be at least 8 characters long
            </p>
          </div>

          <div>
            <label htmlFor="confirmNewPassphrase" className="block text-sm font-medium text-gray-300 mb-2">
              Confirm New Passphrase
            </label>
            <input
              id="confirmNewPassphrase"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              className="w-full px-4 py-2 bg-neutral-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Confirm new passphrase"
              disabled={loading}
              required
            />
            {newPassphrase && confirmPassphrase && newPassphrase !== confirmPassphrase && (
              <p className="mt-1 text-xs text-red-400">Passphrases do not match</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || newPassphrase.length < 8 || newPassphrase !== confirmPassphrase}
              className={`flex-1 px-4 py-2 rounded-md text-white font-medium transition ${
                loading || newPassphrase.length < 8 || newPassphrase !== confirmPassphrase
                  ? 'bg-gray-700 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Changing...
                </span>
              ) : (
                'Change Passphrase'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


import { useState, useEffect, createContext, useContext } from 'react';
import { User } from '@shared/schema';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginError: string;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  clearLoginError: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useAuthState(): AuthContextType {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState<string>('');

  useEffect(() => {
    // Check if user is logged in from localStorage
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
      } catch (error) {
        localStorage.removeItem('currentUser');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Essential for cookies to be set
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        localStorage.setItem('currentUser', JSON.stringify(userData));
        setIsLoading(false);
        return { success: true };
      } else {
        // Extract error message from backend response
        let errorMessage = 'Login failed. Please try again.';
        try {
          const errorData = await response.json();
          console.log('🔍 Login error response:', errorData);
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          // If response body can't be parsed, use default message
        }
        console.log('🔍 Returning error:', errorMessage);
        setIsLoading(false);
        setLoginError(errorMessage); // Store error in context
        return { success: false, error: errorMessage };
      }
    } catch (error) {
      console.log('🔍 Network error:', error);
      const networkError = 'Network error. Please check your connection and try again.';
      setIsLoading(false);
      setLoginError(networkError); // Store error in context
      return { success: false, error: networkError };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('currentUser');
    setLoginError(''); // Clear login error on logout
  };

  const clearLoginError = () => {
    setLoginError('');
  };

  return {
    user,
    isAuthenticated: !!user,
    isLoading,
    loginError,
    login,
    logout,
    clearLoginError,
  };
}
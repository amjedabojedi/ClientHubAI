import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { LogIn, Loader2, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [shake, setShake] = useState(false);
  const [, setLocation] = useLocation();
  const { login, isLoading, loginError, clearLoginError } = useAuth();

  // Trigger shake animation when error changes
  useEffect(() => {
    if (loginError) {
      setShake(true);
      const timer = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(timer);
    }
  }, [loginError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Clear any previous errors
    clearLoginError();
    
    if (!username || !password) {
      // For empty fields, we still need to handle this locally or set it in context
      // Let's trigger it through the login function for consistency
      return;
    }
    
    const result = await login(username, password);
    
    if (result.success) {
      setLocation('/');
    }
    // Error is now handled in the auth context
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <LogIn className="h-8 w-8 text-blue-600" />
          </div>
          <CardTitle className="text-2xl text-center">
            TherapyFlow
          </CardTitle>
          <CardDescription className="text-center">
            Sign in to your account to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                required
                data-testid="input-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
                data-testid="input-password"
              />
            </div>
            
            {loginError && (
              <Alert 
                variant="destructive" 
                className={`${shake ? 'animate-shake' : ''}`}
                data-testid="alert-login-error"
              >
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{loginError}</AlertDescription>
              </Alert>
            )}

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isLoading}
              data-testid="button-submit-login"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
          
          <div className="mt-6 pt-6 border-t text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Are you a client?{" "}
              <a 
                href="/portal/login" 
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                data-testid="link-portal-login"
              >
                Access Client Portal →
              </a>
            </p>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
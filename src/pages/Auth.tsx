import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle } from 'lucide-react';

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const defaultTab = searchParams.get('tab') === 'signup' ? 'signup' : 'signin';
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [signupSuccessEmail, setSignupSuccessEmail] = useState<string | null>(null);

  useEffect(() => {
    // Prevent Google from indexing the auth page
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (user) {
      // If signup/signin happened with a plan param (set by ChoosePlan.tsx
      // when a logged-out visitor clicked a plan), bounce them back to
      // /pricing with autocheckout params so the checkout fires automatically.
      const planParam = searchParams.get('plan');
      if (planParam) {
        const interval = searchParams.get('interval') ?? 'monthly';
        navigate(
          `/pricing?autocheckout=${encodeURIComponent(planParam)}&interval=${encodeURIComponent(interval)}`,
        );
      } else {
        navigate('/dashboard');
      }
    }
  }, [user, navigate, searchParams]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Preserve plan/interval across the email-confirmation roundtrip so the
    // /pricing autocheckout effect fires when they land back after clicking
    // the confirmation link.
    const planParam = searchParams.get('plan');
    const interval = searchParams.get('interval') ?? 'monthly';
    const emailRedirectTo = planParam
      ? `${window.location.origin}/pricing?autocheckout=${encodeURIComponent(planParam)}&interval=${encodeURIComponent(interval)}`
      : `${window.location.origin}/dashboard`;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo,
      },
    });

    setLoading(false);

    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setSignupSuccessEmail(email);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      let description = error.message;
      if (error.message === 'Email not confirmed') {
        description = 'Please check your email and click the verification link before signing in.';
      }
      toast({
        title: 'Error',
        description,
        variant: 'destructive',
      });
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      toast({
        title: 'Enter your email',
        description: 'Please enter your email address first, then click Forgot Password.',
        variant: 'destructive',
      });
      return;
    }

    setForgotPasswordLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setForgotPasswordLoading(false);

    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Reset email sent',
        description: 'Check your inbox for a password reset link.',
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex items-end gap-2 cursor-pointer select-none"
              aria-label="Vrelly"
            >
              <img src="/og-mark.png" alt="" className="h-10 md:h-12 w-auto" />
            </button>
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl text-center">Welcome to Vrelly</CardTitle>
            <CardDescription className="text-center">Sign in to access your AI sales agent platform</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {signupSuccessEmail ? (
            <div className="text-center space-y-4 py-6">
              <div className="flex justify-center">
                <CheckCircle className="h-12 w-12 text-green-500" />
              </div>
              <p className="text-xl font-semibold">Check your email</p>
              <p className="text-muted-foreground">
                We sent a confirmation link to <span className="font-medium text-foreground">{signupSuccessEmail}</span>. Click the link to activate your account and get started.
              </p>
            </div>
          ) : (
          <Tabs defaultValue={defaultTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    'Sign In'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="w-full text-sm"
                  onClick={handleForgotPassword}
                  disabled={forgotPasswordLoading}
                >
                  {forgotPasswordLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Forgot Password?'
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Name</Label>
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    'Sign Up'
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

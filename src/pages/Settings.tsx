import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import vrellyLogo from '@/assets/vrelly-logo.png';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDistanceToNow, format } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { ExternalProjectsSettings } from "@/components/settings/ExternalProjectsSettings";

// Price IDs for subscription tiers - UPDATE THESE AFTER RUNNING create-stripe-products
const PRICE_IDS = {
  starter: "price_1SPYhwRvAXonKS41WFHowijk",
  pro: "price_1SPYjHRvAXonKS41B0eriTUC",
  premium: "price_1SPYjTRvAXonKS41RdJr9r7I",
};

export default function Settings() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, user, fetchProfile } = useAuthStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const { subscriptionStatus, checkSubscription, createCheckoutSession, openCustomerPortal } = useSubscription();
  
  // Check for success/cancel params from Stripe
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('success')) {
      toast({
        title: "Success!",
        description: "Your subscription has been activated. Refreshing status...",
      });
      setTimeout(() => {
        checkSubscription();
        fetchProfile();
      }, 2000);
      // Remove query params
      navigate('/settings?tab=billing', { replace: true });
    } else if (params.get('canceled')) {
      toast({
        title: "Canceled",
        description: "Subscription upgrade was canceled.",
        variant: "destructive",
      });
      navigate('/settings?tab=billing', { replace: true });
    }
  }, [location.search]);
  
  // Determine default tab based on route
  const defaultTab = location.pathname === '/billing' ? 'billing' : 'profile';
  
  // Profile form state
  const [name, setName] = useState(profile?.name || "");
  
  // Password form state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Fetch unlock history
  const { data: unlockHistory } = useQuery({
    queryKey: ["unlock-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unlock_events")
        .select("*")
        .eq("user_id", user?.id)
        .order("created_at", { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ name })
        .eq("id", user?.id);
      
      if (error) throw error;
      
      await fetchProfile();
      toast({
        title: "Profile updated",
        description: "Your profile has been updated successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match.",
        variant: "destructive",
      });
      return;
    }
    
    if (newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);
    
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      
      if (error) throw error;
      
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      
      toast({
        title: "Password changed",
        description: "Your password has been changed successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = (tier: keyof typeof PRICE_IDS) => {
    createCheckoutSession(PRICE_IDS[tier]);
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center gap-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
            <SidebarTrigger />
            <img 
              src={vrellyLogo} 
              alt="Vrelly Data" 
              className="h-[4.5rem] cursor-pointer" 
              onClick={() => navigate('/')}
            />
            <h1 className="text-lg font-semibold ml-4">Settings</h1>
          </header>
          <main className="flex-1 overflow-auto">
            <div className="container max-w-4xl py-8">
              <div className="mb-8">
                <h1 className="text-3xl font-bold">Settings</h1>
                <p className="text-muted-foreground">Manage your account settings and preferences.</p>
              </div>

              <Tabs defaultValue={defaultTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="billing">Billing & Credits</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your profile details.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your name"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={user?.email || ""}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-sm text-muted-foreground">
                    Email cannot be changed at this time.
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label>Current Plan</Label>
                  <div className="text-sm font-medium capitalize">{profile?.plan || "free"}</div>
                </div>
                
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving..." : "Save Changes"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>Update your password to keep your account secure.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                  />
                </div>
                
                <Button type="submit" disabled={loading}>
                  {loading ? "Updating..." : "Change Password"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing">
          <div className="space-y-6">
            {/* Current Subscription Status */}
            <Card>
              <CardHeader>
                <CardTitle>Subscription & Usage</CardTitle>
                <CardDescription>
                  Your current plan and monthly credit usage
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-muted-foreground">Current Plan</div>
                    <div className="text-2xl font-bold capitalize flex items-center gap-2">
                      {profile?.subscription_tier || 'Free'}
                      <Badge variant={profile?.subscription_status === 'active' ? 'default' : 'secondary'}>
                        {profile?.subscription_status || 'inactive'}
                      </Badge>
                    </div>
                  </div>
                  {profile?.subscription_tier !== 'free' && profile?.billing_period_end && (
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Next billing date</div>
                      <div className="text-sm font-medium">
                        {format(new Date(profile.billing_period_end), 'MMM dd, yyyy')}
                      </div>
                    </div>
                  )}
                </div>

                {/* Credit Balance Display - Always visible */}
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Credit Balance</span>
                    <span className="text-2xl font-bold text-primary">
                      {(profile.credits || 0).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Total credits available for searches and unlocks
                  </p>
                </div>

                {/* Monthly Usage Display - Only if on a paid plan */}
                {profile && profile.monthly_credit_limit > 0 && (
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Monthly Credit Usage</span>
                      <span className="text-sm font-semibold">
                        {(profile.credits_used_this_month || 0).toLocaleString()} / {profile.monthly_credit_limit.toLocaleString()}
                      </span>
                    </div>
                    <Progress 
                      value={(profile.credits_used_this_month || 0) / profile.monthly_credit_limit * 100} 
                      className="h-2"
                    />
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>
                        {((profile.monthly_credit_limit - (profile.credits_used_this_month || 0)) / profile.monthly_credit_limit * 100).toFixed(0)}% remaining this month
                      </span>
                      {profile.billing_period_end && (
                        <span>
                          Resets on {format(new Date(profile.billing_period_end), 'MMM dd, yyyy')}
                        </span>
                      )}
                    </div>
                    {profile.credits_used_this_month >= profile.monthly_credit_limit * 0.9 && (
                      <p className="text-sm text-destructive">
                        ⚠️ You're approaching your monthly limit. Consider upgrading your plan.
                      </p>
                    )}
                  </div>
                )}

                {profile?.billing_period_start && profile?.billing_period_end && (
                  <div className="text-sm text-muted-foreground">
                    Current billing period: {format(new Date(profile.billing_period_start), 'MMM dd')} - {format(new Date(profile.billing_period_end), 'MMM dd, yyyy')}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Subscription Plans */}
            <Card>
              <CardHeader>
                <CardTitle>Upgrade Your Plan</CardTitle>
                <CardDescription>
                  Choose the plan that best fits your needs
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-3 gap-6">
                  {/* Starter Plan */}
                  <div className="border rounded-lg p-6 flex flex-col h-full">
                    <div className="space-y-4 flex-1">
                      <div>
                        <h3 className="text-xl font-bold">Starter</h3>
                        <div className="mt-2">
                          <span className="text-3xl font-bold">$99</span>
                          <span className="text-muted-foreground">/month</span>
                        </div>
                      </div>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          10,000 credits/month
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          Email support
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          Standard features
                        </li>
                      </ul>
                    </div>
                    <Button 
                      className="w-full mt-4" 
                      variant={profile?.subscription_tier === 'starter' ? 'outline' : 'default'}
                      disabled={profile?.subscription_tier === 'starter'}
                      onClick={() => handleUpgrade('starter')}
                    >
                      {profile?.subscription_tier === 'starter' ? 'Current Plan' : 'Upgrade'}
                    </Button>
                  </div>

                  {/* Professional Plan */}
                  <div className="border-2 border-primary rounded-lg p-6 flex flex-col h-full relative">
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Popular</Badge>
                    <div className="space-y-4 flex-1">
                      <div>
                        <h3 className="text-xl font-bold">Pro</h3>
                        <div className="mt-2">
                          <span className="text-3xl font-bold">$299</span>
                          <span className="text-muted-foreground">/month</span>
                        </div>
                      </div>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          25,000 credits/month
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          Priority email support
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          Advanced features
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          API access
                        </li>
                      </ul>
                    </div>
                    <Button 
                      className="w-full mt-4" 
                      variant={profile?.subscription_tier === 'pro' || profile?.subscription_tier === 'professional' ? 'outline' : 'default'}
                      disabled={profile?.subscription_tier === 'pro' || profile?.subscription_tier === 'professional'}
                      onClick={() => handleUpgrade('pro')}
                    >
                      {profile?.subscription_tier === 'pro' || profile?.subscription_tier === 'professional' ? 'Current Plan' : 'Upgrade'}
                    </Button>
                  </div>

                  {/* Enterprise Plan */}
                  <div className="border rounded-lg p-6 flex flex-col h-full">
                    <div className="space-y-4 flex-1">
                      <div>
                        <h3 className="text-xl font-bold">Premium</h3>
                        <div className="mt-2">
                          <span className="text-3xl font-bold">$499</span>
                          <span className="text-muted-foreground">/month</span>
                        </div>
                      </div>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          75,000 credits/month
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          24/7 priority support
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          All features
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          Dedicated account manager
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          Custom integrations
                        </li>
                      </ul>
                    </div>
                    <Button 
                      className="w-full mt-4" 
                      variant={profile?.subscription_tier === 'premium' || profile?.subscription_tier === 'enterprise' ? 'outline' : 'default'}
                      disabled={profile?.subscription_tier === 'premium' || profile?.subscription_tier === 'enterprise'}
                      onClick={() => handleUpgrade('premium')}
                    >
                      {profile?.subscription_tier === 'premium' || profile?.subscription_tier === 'enterprise' ? 'Current Plan' : 'Upgrade'}
                    </Button>
                  </div>
                </div>

                {profile?.subscription_tier !== 'free' && (
                  <div className="mt-6 pt-6 border-t">
                    <Button variant="outline" size="sm" onClick={openCustomerPortal}>
                      Manage Subscription
                    </Button>
                    <p className="text-sm text-muted-foreground mt-2">
                      Update payment method, view invoices, or cancel subscription
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Credit Usage</CardTitle>
                <CardDescription>Your last 20 unlock events</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Credits</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unlockHistory && unlockHistory.length > 0 ? (
                      unlockHistory.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="capitalize">{event.entity_type}</TableCell>
                          <TableCell>{event.cost}</TableCell>
                          <TableCell>{formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          No activity yet
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="integrations">
          <ExternalProjectsSettings />
        </TabsContent>
      </Tabs>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

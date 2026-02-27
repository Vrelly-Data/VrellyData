import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import vrellyLogo from '@/assets/vrelly-logo.png';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { UserMenu } from "@/components/UserMenu";
import { SUBSCRIPTION_TIERS, SubscriptionTier } from "@/config/subscriptionTiers";

import { PRICE_IDS } from "@/config/subscriptionTiers";

export default function Settings() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, user, fetchProfile } = useAuthStore();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [showAllCredits, setShowAllCredits] = useState(false);
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

  // Fetch credit usage history
  const { data: creditHistory } = useQuery({
    queryKey: ["credit-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_transactions")
        .select("*")
        .eq("user_id", user?.id)
        .order("created_at", { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Compute total deductions for accurate balance
  const totalDeductions = creditHistory?.reduce((acc, t) => acc + (t.credits_deducted || 0), 0) || 0;
  const tier = (profile?.subscription_tier || 'starter') as SubscriptionTier;
  const tierConfig = SUBSCRIPTION_TIERS[tier] || SUBSCRIPTION_TIERS.starter;
  const computedBalance = tierConfig.credits - totalDeductions;

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
            <div className="ml-auto">
              <UserMenu />
            </div>
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

          {/* Appearance Settings */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Customize how Vrelly looks for you.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="dark-mode">Dark Mode</Label>
                  <p className="text-sm text-muted-foreground">
                    Switch between light and dark themes
                  </p>
                </div>
                <Switch
                  id="dark-mode"
                  checked={theme === "dark"}
                  onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
                />
              </div>
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

                {/* Credit Balance Display */}
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Credit Balance</span>
                    <span className="text-2xl font-bold text-primary">
                      {computedBalance.toLocaleString()}
                    </span>
                  </div>
                  {(() => {
                    const percentRemaining = tierConfig.credits > 0 
                      ? (computedBalance / tierConfig.credits) * 100 
                      : 0;
                    return (
                      <>
                        <Progress value={Math.max(0, percentRemaining)} className="h-2" />
                        <p className="text-xs text-muted-foreground">
                          {computedBalance.toLocaleString()} of {tierConfig.credits.toLocaleString()} credits remaining ({tierConfig.label} plan)
                        </p>
                      </>
                    );
                  })()}
                </div>

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
                          <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.starter.price}</span>
                          <span className="text-muted-foreground">/month</span>
                        </div>
                      </div>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          {SUBSCRIPTION_TIERS.starter.credits.toLocaleString()} credits
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
                        <h3 className="text-xl font-bold">Professional</h3>
                        <div className="mt-2">
                          <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.professional.price}</span>
                          <span className="text-muted-foreground">/month</span>
                        </div>
                      </div>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          {SUBSCRIPTION_TIERS.professional.credits.toLocaleString()} credits
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          Priority support
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
                      variant={profile?.subscription_tier === 'professional' ? 'outline' : 'default'}
                      disabled={profile?.subscription_tier === 'professional'}
                      onClick={() => handleUpgrade('professional')}
                    >
                      {profile?.subscription_tier === 'professional' ? 'Current Plan' : 'Upgrade'}
                    </Button>
                  </div>

                  {/* Enterprise Plan */}
                  <div className="border rounded-lg p-6 flex flex-col h-full">
                    <div className="space-y-4 flex-1">
                      <div>
                        <h3 className="text-xl font-bold">Enterprise</h3>
                        <div className="mt-2">
                          <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.enterprise.price}</span>
                          <span className="text-muted-foreground">/month</span>
                        </div>
                      </div>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          {SUBSCRIPTION_TIERS.enterprise.credits.toLocaleString()} credits
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
                      variant={profile?.subscription_tier === 'enterprise' ? 'outline' : 'default'}
                      disabled={profile?.subscription_tier === 'enterprise'}
                      onClick={() => handleUpgrade('enterprise')}
                    >
                      {profile?.subscription_tier === 'enterprise' ? 'Current Plan' : 'Upgrade'}
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
                      <TableHead>Records</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creditHistory && creditHistory.length > 0 ? (
                      (showAllCredits ? creditHistory : creditHistory.slice(0, 3)).map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="capitalize">{event.entity_type}</TableCell>
                          <TableCell>{event.credits_deducted}</TableCell>
                          <TableCell>{event.records_returned}</TableCell>
                          <TableCell>{formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          No activity yet
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {creditHistory && creditHistory.length > 3 && (
                  <div className="mt-4 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllCredits(!showAllCredits)}
                    >
                      {showAllCredits ? 'Show Less' : `View All (${creditHistory.length})`}
                    </Button>
                  </div>
                )}
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

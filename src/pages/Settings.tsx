import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export default function Settings() {
  const { profile, user, fetchProfile } = useAuthStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  
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

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account settings and preferences.</p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="billing">Billing & Credits</TabsTrigger>
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

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Monthly Credits</span>
                    <span className="font-medium">
                      {profile?.credits_used_this_month?.toLocaleString() || 0} / {profile?.monthly_credit_limit?.toLocaleString() || 100}
                    </span>
                  </div>
                  <Progress 
                    value={((profile?.credits_used_this_month || 0) / (profile?.monthly_credit_limit || 100)) * 100} 
                    className="h-2"
                  />
                  {profile && profile.credits_used_this_month >= profile.monthly_credit_limit * 0.9 && (
                    <p className="text-sm text-destructive">
                      ⚠️ You're approaching your monthly limit. Consider upgrading your plan.
                    </p>
                  )}
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
                  <div className="border rounded-lg p-6 space-y-4">
                    <div>
                      <h3 className="text-xl font-bold">Starter</h3>
                      <div className="mt-2">
                        <span className="text-3xl font-bold">$75</span>
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
                    <Button 
                      className="w-full" 
                      variant={profile?.subscription_tier === 'starter' ? 'outline' : 'default'}
                      disabled={profile?.subscription_tier === 'starter'}
                    >
                      {profile?.subscription_tier === 'starter' ? 'Current Plan' : 'Upgrade to Starter'}
                    </Button>
                  </div>

                  {/* Professional Plan */}
                  <div className="border-2 border-primary rounded-lg p-6 space-y-4 relative">
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Popular</Badge>
                    <div>
                      <h3 className="text-xl font-bold">Professional</h3>
                      <div className="mt-2">
                        <span className="text-3xl font-bold">$150</span>
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
                    <Button 
                      className="w-full" 
                      variant={profile?.subscription_tier === 'professional' ? 'outline' : 'default'}
                      disabled={profile?.subscription_tier === 'professional'}
                    >
                      {profile?.subscription_tier === 'professional' ? 'Current Plan' : 'Upgrade to Professional'}
                    </Button>
                  </div>

                  {/* Enterprise Plan */}
                  <div className="border rounded-lg p-6 space-y-4">
                    <div>
                      <h3 className="text-xl font-bold">Enterprise</h3>
                      <div className="mt-2">
                        <span className="text-3xl font-bold">$350</span>
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
                    <Button 
                      className="w-full" 
                      variant={profile?.subscription_tier === 'enterprise' ? 'outline' : 'default'}
                      disabled={profile?.subscription_tier === 'enterprise'}
                    >
                      {profile?.subscription_tier === 'enterprise' ? 'Current Plan' : 'Upgrade to Enterprise'}
                    </Button>
                  </div>
                </div>

                {profile?.subscription_tier !== 'free' && (
                  <div className="mt-6 pt-6 border-t">
                    <Button variant="outline" size="sm">
                      Cancel Subscription
                    </Button>
                    <p className="text-sm text-muted-foreground mt-2">
                      Your subscription will remain active until the end of your billing period.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Usage History */}
            <Card>
              <CardHeader>
                <CardTitle>Usage History</CardTitle>
                <CardDescription>Your recent unlock events.</CardDescription>
              </CardHeader>
              <CardContent>
                {unlockHistory && unlockHistory.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Cost</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unlockHistory.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="capitalize">{event.entity_type}</TableCell>
                          <TableCell>{event.cost} credits</TableCell>
                          <TableCell>
                            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No unlock events yet. Start searching and unlocking contacts!
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

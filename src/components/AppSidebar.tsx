import { NavLink, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Home, Users, Building2, FlaskConical, Settings, LogOut, Shield, Bot } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useCredits } from '@/hooks/useCredits';
import { useAgentAccess } from '@/hooks/useAgent';
import vrellyLogo from '@/assets/vrelly-logo.png';

const navItems = [
  { title: 'Builder', url: '/dashboard', icon: Home },
  { title: 'People', url: '/people', icon: Users },
  { title: 'Companies', url: '/companies', icon: Building2 },
  { title: 'Data Playground', url: '/playground', icon: FlaskConical },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { signOut, profile, userRoles, profileLoading } = useAuthStore();
  const { data: credits } = useCredits();
  const { hasAccess: hasAgentAccess } = useAgentAccess();
  const navigate = useNavigate();
  const isCollapsed = state === 'collapsed';
  const showAdminLink = userRoles.some(r => r.role === 'admin');

  const remainingCredits = credits
    ? credits.plan === 'enterprise'
      ? 100000 - (credits.enterprise_daily_exports ?? 0)
      : (credits.export_credits_total ?? 0) - (credits.export_credits_used ?? 0)
    : (profile?.credits ?? 0);

  return (
    <Sidebar collapsible="icon"  className={isCollapsed ? 'w-28' : 'w-60'}>
      <SidebarContent>
        <SidebarGroup>
          <div className={isCollapsed ? 'flex justify-center py-4' : 'px-3 py-4'}>
            <img
              src={vrellyLogo}
              alt="Vrelly Data"
              className={`${isCollapsed ? 'h-24 w-24 object-contain' : 'h-36'} cursor-pointer`}
              onClick={() => navigate('/dashboard')}
            />
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className={({ isActive }) =>
                        isActive ? 'bg-muted text-primary font-medium' : 'hover:bg-muted/50'
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              <div className="px-3 py-1">
                <Separator />
              </div>

              {/* Agent nav item — premium gated */}
              <SidebarMenuItem>
                {hasAgentAccess ? (
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/agent"
                      className={({ isActive }) =>
                        isActive ? 'bg-muted text-primary font-medium' : 'hover:bg-muted/50'
                      }
                    >
                      <Bot className="h-4 w-4" />
                      {!isCollapsed && (
                        <span className="flex items-center gap-1.5">
                          Agent
                          <span className="text-amber-500 text-xs">&#10022;</span>
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton
                        className="opacity-50 cursor-not-allowed"
                        onClick={(e) => e.preventDefault()}
                      >
                        <Bot className="h-4 w-4" />
                        {!isCollapsed && (
                          <span className="flex items-center gap-1.5">
                            Agent
                            <span className="text-amber-500 text-xs">&#10022;</span>
                          </span>
                        )}
                      </SidebarMenuButton>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="flex flex-col gap-2 p-3">
                      <p className="text-sm">Available on the Agent plan</p>
                      <a
                        href="mailto:hello@vrelly.com"
                        className="text-xs text-primary underline hover:no-underline"
                      >
                        Talk to us
                      </a>
                    </TooltipContent>
                  </Tooltip>
                )}
              </SidebarMenuItem>

              {/* Settings */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/settings"
                    end
                    className={({ isActive }) =>
                      isActive ? 'bg-muted text-primary font-medium' : 'hover:bg-muted/50'
                    }
                  >
                    <Settings className="h-4 w-4" />
                    {!isCollapsed && <span>Settings</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {showAdminLink && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/admin"
                      className={({ isActive }) =>
                        isActive ? 'bg-muted text-primary font-medium' : 'hover:bg-muted/50'
                      }
                    >
                      <Shield className="h-4 w-4" />
                      {!isCollapsed && <span>Admin</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            {profile && (
              <div className={`px-3 py-2 ${isCollapsed ? 'text-center' : ''}`}>
                {!isCollapsed && (
                  <>
                    <div className="text-sm font-medium">{profile.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {remainingCredits.toLocaleString()} credits available
                    </div>
                  </>
                )}
              </div>
            )}
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={signOut}>
                  <LogOut className="h-4 w-4" />
                  {!isCollapsed && <span>Sign Out</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

import { useEffect } from 'react';
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
import { Home, Users, Building2, Settings, LogOut, Shield } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import vrellyLogo from '@/assets/vrelly-logo.png';

const navItems = [
  { title: 'Builder', url: '/', icon: Home },
  { title: 'People', url: '/people', icon: Users },
  { title: 'Companies', url: '/companies', icon: Building2 },
  { title: 'Settings', url: '/settings', icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { signOut, profile, userRoles, profileLoading } = useAuthStore();
  const navigate = useNavigate();
  const isCollapsed = state === 'collapsed';
  const showAdminLink = userRoles.some(r => r.role === 'admin');

  // Debug logging for role changes
  useEffect(() => {
    console.log('AppSidebar - userRoles changed:', userRoles, 'profileLoading:', profileLoading, 'showAdminLink:', showAdminLink);
  }, [userRoles, profileLoading, showAdminLink]);

  return (
    <Sidebar collapsible="icon"  className={isCollapsed ? 'w-28' : 'w-60'}>
      <SidebarContent>
        <SidebarGroup>
          <div className={isCollapsed ? 'flex justify-center py-4' : 'px-3 py-4'}>
            <img 
              src={vrellyLogo} 
              alt="Vrelly Data" 
              className={`${isCollapsed ? 'h-24 w-24 object-contain' : 'h-36'} cursor-pointer`}
              onClick={() => navigate('/')}
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
                      {(profile?.credits ?? 0).toLocaleString()} credits available
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

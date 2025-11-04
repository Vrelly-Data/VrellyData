import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

export function ExternalProjectsSettings() {
  const [projects, setProjects] = useState<any[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [newProject, setNewProject] = useState({
    name: '',
    api_endpoint: '',
    api_key: '',
  });
  const { toast } = useToast();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    const { data: teamMemberships } = await supabase
      .from('team_memberships')
      .select('team_id')
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
      .single();

    if (teamMemberships) {
      const { data } = await supabase
        .from('external_projects')
        .select('*')
        .eq('team_id', teamMemberships.team_id);

      if (data) setProjects(data);
    }
  };

  const handleAddProject = async () => {
    try {
      const { data: user } = await supabase.auth.getUser();
      const { data: teamMemberships } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.user?.id)
        .single();

      if (!teamMemberships) throw new Error('No team membership found');

      const { error } = await supabase.from('external_projects').insert({
        team_id: teamMemberships.team_id,
        name: newProject.name,
        api_endpoint: newProject.api_endpoint,
        api_key_encrypted: newProject.api_key, // In production, encrypt this
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'External project added successfully',
      });

      setIsAddDialogOpen(false);
      setNewProject({ name: '', api_endpoint: '', api_key: '' });
      loadProjects();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      const { error } = await supabase
        .from('external_projects')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Project deleted successfully',
      });

      loadProjects();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const toggleProjectStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('external_projects')
        .update({ is_active: !currentStatus })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: `Project ${!currentStatus ? 'activated' : 'deactivated'}`,
      });

      loadProjects();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">External Projects</h3>
          <p className="text-sm text-muted-foreground">
            Configure external projects to send contacts to
          </p>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Project
        </Button>
      </div>

      <div className="grid gap-4">
        {projects.map((project) => (
          <Card key={project.id}>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {project.name}
                    <Badge variant={project.is_active ? 'default' : 'secondary'}>
                      {project.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{project.api_endpoint}</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Switch
                    checked={project.is_active}
                    onCheckedChange={() =>
                      toggleProjectStatus(project.id, project.is_active)
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteProject(project.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Label className="text-xs">API Key:</Label>
                <code className="text-xs bg-muted px-2 py-1 rounded">
                  {showApiKey[project.id]
                    ? project.api_key_encrypted
                    : '••••••••••••••••'}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setShowApiKey((prev) => ({
                      ...prev,
                      [project.id]: !prev[project.id],
                    }))
                  }
                >
                  {showApiKey[project.id] ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {projects.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground mb-4">
                No external projects configured
              </p>
              <Button onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Project
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add External Project</DialogTitle>
            <DialogDescription>
              Configure a new external project to send contacts to
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                placeholder="e.g., Vrelly"
                value={newProject.name}
                onChange={(e) =>
                  setNewProject((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endpoint">API Endpoint</Label>
              <Input
                id="endpoint"
                placeholder="https://api.example.com/receive-contacts"
                value={newProject.api_endpoint}
                onChange={(e) =>
                  setNewProject((prev) => ({
                    ...prev,
                    api_endpoint: e.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="apikey">API Key</Label>
              <Input
                id="apikey"
                type="password"
                placeholder="Enter API key"
                value={newProject.api_key}
                onChange={(e) =>
                  setNewProject((prev) => ({ ...prev, api_key: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddProject}
              disabled={
                !newProject.name ||
                !newProject.api_endpoint ||
                !newProject.api_key
              }
            >
              Add Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
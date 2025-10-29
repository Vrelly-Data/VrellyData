-- Create lists table for custom user-created lists
CREATE TABLE public.lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL,
  name TEXT NOT NULL,
  entity_type entity_type NOT NULL,
  description TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;

-- RLS Policies for lists
CREATE POLICY "Users can view team lists"
  ON public.lists FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_memberships
      WHERE team_memberships.team_id = lists.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create lists"
  ON public.lists FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_memberships
      WHERE team_memberships.team_id = lists.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update team lists"
  ON public.lists FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.team_memberships
      WHERE team_memberships.team_id = lists.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete team lists"
  ON public.lists FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.team_memberships
      WHERE team_memberships.team_id = lists.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

-- Create list_items table
CREATE TABLE public.list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  entity_external_id TEXT NOT NULL,
  entity_data JSONB NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by UUID NOT NULL,
  UNIQUE(list_id, entity_external_id)
);

-- Enable RLS
ALTER TABLE public.list_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for list_items
CREATE POLICY "Users can view list items"
  ON public.list_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.lists
      JOIN public.team_memberships ON team_memberships.team_id = lists.team_id
      WHERE lists.id = list_items.list_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert list items"
  ON public.list_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.lists
      JOIN public.team_memberships ON team_memberships.team_id = lists.team_id
      WHERE lists.id = list_items.list_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete list items"
  ON public.list_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.lists
      JOIN public.team_memberships ON team_memberships.team_id = lists.team_id
      WHERE lists.id = list_items.list_id
      AND team_memberships.user_id = auth.uid()
    )
  );

-- Create trigger for updating updated_at on lists
CREATE TRIGGER update_lists_updated_at
  BEFORE UPDATE ON public.lists
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
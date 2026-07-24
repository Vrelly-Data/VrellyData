-- Custom pipeline tags (Feature 1): per-client, multi-tag, independent of the
-- pipeline stage. Two tables:
--   pipeline_tags     — the client's tag definitions (name + color)
--   agent_lead_tags   — many-to-many join between agent_leads and pipeline_tags
--
-- RLS: the owning client (user_id) can CRUD their own tags/applications;
-- platform superadmins can read/manage all (mirrors the org financial layer).
-- The public /r/:token report reads tags under the service role (RLS bypassed),
-- so no anon policy is needed.
--
-- Run in dev then prod, then: NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.pipeline_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#64748b',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One tag name per client (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_tags_user_lower_name
  ON public.pipeline_tags (user_id, lower(name));

CREATE TABLE IF NOT EXISTS public.agent_lead_tags (
  lead_id    uuid NOT NULL REFERENCES public.agent_leads(id) ON DELETE CASCADE,
  tag_id     uuid NOT NULL REFERENCES public.pipeline_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_lead_tags_tag ON public.agent_lead_tags (tag_id);

ALTER TABLE public.pipeline_tags   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_lead_tags ENABLE ROW LEVEL SECURITY;

-- ── pipeline_tags: owner CRUD + superadmin all ─────────────────────────────
DROP POLICY IF EXISTS "Owners manage their pipeline_tags" ON public.pipeline_tags;
CREATE POLICY "Owners manage their pipeline_tags"
  ON public.pipeline_tags FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Superadmins manage all pipeline_tags" ON public.pipeline_tags;
CREATE POLICY "Superadmins manage all pipeline_tags"
  ON public.pipeline_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.is_super_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = auth.uid() AND p.is_super_admin = true));

-- ── agent_lead_tags: owner CRUD + superadmin all ──────────────────────────
-- BOTH ownerships are enforced: the caller must own the LEAD (agent_leads.
-- user_id = auth.uid()) AND own the TAG (pipeline_tags.user_id = auth.uid()).
-- Without the tag check, a user could apply another client's tag_id to their
-- own lead, leaking that client's tag into the report. Enforced on USING and
-- WITH CHECK so it gates SELECT/DELETE and INSERT/UPDATE alike.
DROP POLICY IF EXISTS "Owners manage their agent_lead_tags" ON public.agent_lead_tags;
CREATE POLICY "Owners manage their agent_lead_tags"
  ON public.agent_lead_tags FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.agent_leads l
            WHERE l.id = lead_id AND l.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.pipeline_tags t
                WHERE t.id = tag_id AND t.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.agent_leads l
            WHERE l.id = lead_id AND l.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.pipeline_tags t
                WHERE t.id = tag_id AND t.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Superadmins manage all agent_lead_tags" ON public.agent_lead_tags;
CREATE POLICY "Superadmins manage all agent_lead_tags"
  ON public.agent_lead_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.is_super_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = auth.uid() AND p.is_super_admin = true));

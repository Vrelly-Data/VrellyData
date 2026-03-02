import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Resource {
  id: string;
  slug: string;
  title: string;
  content_markdown: string;
  meta_description: string | null;
  excerpt: string | null;
  tags: string[] | null;
  author: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  is_published: boolean;
}

export function useResources(category?: string) {
  return useQuery({
    queryKey: ["resources", category ?? "all"],
    queryFn: async () => {
      let query = supabase
        .from("resources")
        .select("*")
        .eq("is_published", true)
        .order("published_at", { ascending: false });

      if (category) {
        query = query.contains("tags", [category]);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Resource[];
    },
  });
}

export function useResource(slug: string) {
  return useQuery({
    queryKey: ["resource", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resources")
        .select("*")
        .eq("slug", slug)
        .eq("is_published", true)
        .single();

      if (error) throw error;
      return data as Resource;
    },
    enabled: !!slug,
  });
}

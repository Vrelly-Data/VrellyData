import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useResources, Resource } from '@/hooks/useResources';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';

type ResourcesTeaserProps = {
  title?: string;
  limit?: 2 | 3;
  ensureCampaignsArticle?: boolean;
  className?: string;
};

export function ResourcesTeaser({
  title = 'From the blog',
  limit = 3,
  ensureCampaignsArticle = true,
  className = '',
}: ResourcesTeaserProps) {
  const { data: resources = [], isLoading } = useResources();
  const { ref, isVisible } = useScrollAnimation();

  const pickResources = (all: Resource[]): Resource[] => {
    if (!all || all.length === 0) return [];
    // Already sorted by published_at desc in hook
    let selected = all.slice(0, limit);
    if (ensureCampaignsArticle) {
      const campaignsSlug = 'your-best-campaigns-are-already-written';
      const hasCampaigns = selected.some((r) => r.slug === campaignsSlug);
      const campaignsPost = all.find((r) => r.slug === campaignsSlug);
      if (!hasCampaigns && campaignsPost) {
        // Replace the last item to include campaigns article
        selected = [ ...selected.slice(0, limit - 1), campaignsPost ];
      }
    }
    return selected.slice(0, limit);
  };

  const items = pickResources(resources);

  return (
    <section className={`py-16 ${className}`}>
      <div className="max-w-6xl mx-auto px-4" ref={ref}>
        <div className={`flex items-center justify-between mb-6 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          <Link to="/resources" className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4">
            See all resources
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: limit }).map((_, i) => (
              <div key={i} className="rounded-xl border p-6 space-y-3">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? null : (
          <div className={`grid grid-cols-1 ${limit === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-6`}>
            {items.map((resource, index) => (
              <Link
                key={resource.id}
                to={`/resources/${resource.slug}`}
                className={`group rounded-xl border bg-card hover:border-primary/40 hover:shadow-md transition-all duration-500 overflow-hidden flex flex-col ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
                style={{ transitionDelay: `${index * 80 + 120}ms` }}
              >
                {resource.cover_image_url && (
                  <div className="aspect-video overflow-hidden bg-muted">
                    <img
                      src={resource.cover_image_url}
                      alt={resource.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  </div>
                )}
                <div className="p-5 flex flex-col flex-1">
                  {resource.tags && resource.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {resource.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <h3 className="text-base font-semibold leading-snug mb-2 group-hover:text-primary transition-colors">
                    {resource.title}
                  </h3>
                  {(resource.excerpt || resource.meta_description) && (
                    <p className="text-sm text-muted-foreground line-clamp-3 flex-1">
                      {resource.excerpt || resource.meta_description}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}


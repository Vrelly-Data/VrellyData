import { Helmet } from 'react-helmet-async';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar, Clock, ArrowLeft, User } from 'lucide-react';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { useResource, useResources, Resource } from '@/hooks/useResources';

export default function ResourceArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { data: resource, isLoading, isError } = useResource(slug ?? '');
  const { data: allResources = [] } = useResources();

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const estimateReadTime = (content: string) => {
    const words = content.split(' ').length;
    return `${Math.max(3, Math.ceil(words / 200))} min read`;
  };

  const getRelated = (current: Resource | null, candidates: Resource[]): Resource[] => {
    if (!current) return [];
    const others = candidates.filter((r) => r.slug !== current.slug);
    if (others.length === 0) return [];
    const currentTags = new Set(current.tags ?? []);
    const scored = others.map((r) => {
      const tags = new Set(r.tags ?? []);
      let overlap = 0;
      if (currentTags.size > 0 && tags.size > 0) {
        for (const t of tags) {
          if (currentTags.has(t)) overlap += 1;
        }
      }
      return { r, overlap };
    });
    scored.sort((a, b) => {
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      const ad = new Date(a.r.published_at || a.r.created_at).getTime();
      const bd = new Date(b.r.published_at || b.r.created_at).getTime();
      return bd - ad;
    });
    return scored.map((s) => s.r).slice(0, 3);
  };

  if (isError) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-32 text-center">
          <h1 className="text-2xl font-bold mb-4">Article not found</h1>
          <p className="text-muted-foreground mb-8">This article may have been removed or the URL is incorrect.</p>
          <Button asChild>
            <Link to="/resources">Back to Resources</Link>
          </Button>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {slug && (
        <Helmet>
          <link rel="canonical" href={`https://www.vrelly.com/resources/${slug}`} />
        </Helmet>
      )}
      {resource && (
        <Helmet>
          <title>{resource.title} | Vrelly</title>
          {resource.meta_description && (
            <meta name="description" content={resource.meta_description} />
          )}
        </Helmet>
      )}
      <Navbar />

      <main className="max-w-3xl mx-auto px-4 pt-24 pb-16">
        {/* Back link */}
        <Link
          to="/resources"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Resources
        </Link>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-64 w-full mt-8" />
          </div>
        ) : resource ? (
          <>
            {/* Tags */}
            {resource.tags && resource.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {resource.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">{tag}</Badge>
                ))}
              </div>
            )}

            {/* Title */}
            <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4">
              {resource.title}
            </h1>

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-8 pb-8 border-b">
              <span className="flex items-center gap-1.5">
                <User className="h-4 w-4" />
                {resource.author}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {formatDate(resource.published_at || resource.created_at)}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {estimateReadTime(resource.content_markdown)}
              </span>
            </div>

            {/* Cover image */}
            {resource.cover_image_url && (
              <div className="mb-8 rounded-xl overflow-hidden">
                <img
                  src={resource.cover_image_url}
                  alt={resource.title}
                  className="w-full object-cover max-h-80"
                />
              </div>
            )}

            {/* Content */}
            <article className="prose max-w-none text-foreground prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground prose-blockquote:text-foreground prose-a:text-foreground prose-code:text-foreground dark:prose-invert [--tw-prose-body:hsl(var(--foreground))] [--tw-prose-headings:hsl(var(--foreground))] [--tw-prose-bold:hsl(var(--foreground))] [--tw-prose-quotes:hsl(var(--foreground))] [--tw-prose-counters:hsl(var(--foreground))] [--tw-prose-bullets:hsl(var(--foreground))] [--tw-prose-links:hsl(var(--foreground))] [--tw-prose-code:hsl(var(--foreground))]">
              <ReactMarkdown>{resource.content_markdown}</ReactMarkdown>
            </article>

            {/* Related articles */}
            {getRelated(resource, allResources).length > 0 && (
              <section className="mt-14">
                <h3 className="text-lg font-semibold mb-4">Related articles</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {getRelated(resource, allResources).map((rel) => (
                    <Link
                      key={rel.id}
                      to={`/resources/${rel.slug}`}
                      className="group rounded-xl border bg-card hover:border-primary/40 hover:shadow-sm transition-all duration-200 overflow-hidden flex flex-col"
                    >
                      {rel.cover_image_url && (
                        <div className="aspect-video overflow-hidden bg-muted">
                          <img
                            src={rel.cover_image_url}
                            alt={rel.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        </div>
                      )}
                      <div className="p-5">
                        {rel.tags && rel.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {rel.tags.slice(0, 2).map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                        <h4 className="text-base font-semibold leading-snug group-hover:text-primary transition-colors">
                          {rel.title}
                        </h4>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Footer CTA */}
            <div className="mt-16 p-8 rounded-xl bg-primary/5 border border-primary/20 text-center">
              <h3 className="text-xl font-semibold mb-2">See an AI sales agent trained on your campaigns</h3>
              <p className="text-muted-foreground mb-4">Book a live demo of Vrelly’s agent — it learns from your real campaigns to qualify replies and book meetings.</p>
              <div className="flex flex-col items-center gap-2">
                <Button asChild>
                  <Link to="/demo">Book a demo</Link>
                </Button>
                <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4">
                  Or start free
                </Link>
              </div>
            </div>
          </>
        ) : null}
      </main>

      <Footer />
    </div>
  );
}

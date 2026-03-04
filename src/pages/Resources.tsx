import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar, Clock, ArrowRight, BookOpen } from 'lucide-react';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { useResources } from '@/hooks/useResources';

export default function Resources() {
  const { data: resources = [], isLoading } = useResources();

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const estimateReadTime = (excerpt: string | null) => {
    if (!excerpt) return '3 min read';
    const words = excerpt.split(' ').length;
    return `${Math.max(2, Math.ceil(words / 200))} min read`;
  };

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Sales Resources &amp; Guides | Vrelly</title>
        <meta name="description" content="Expert guides, playbooks, and data-driven insights on B2B outreach, sales sequences, and audience building. Learn from 200,000+ real campaigns." />
      </Helmet>
      <Navbar />

      {/* Hero */}
      <section className="pt-24 pb-12 px-4 text-center border-b">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-sm font-medium mb-4">
            <BookOpen className="h-4 w-4" />
            Resources
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            B2B Sales Intelligence &amp; Outreach Playbooks
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Data-driven guides built on insights from 200,000+ real sales campaigns. Learn what actually works in modern outbound.
          </p>
        </div>
      </section>

      {/* Articles Grid */}
      <main className="max-w-6xl mx-auto px-4 py-12">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border p-6 space-y-3">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : resources.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No articles published yet</p>
            <p className="text-sm mt-1">Check back soon — we're adding new content regularly.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {resources.map((resource) => (
              <Link
                key={resource.id}
                to={`/resources/${resource.slug}`}
                className="group rounded-xl border bg-card hover:border-primary/40 hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col"
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
                <div className="p-6 flex flex-col flex-1">
                  {resource.tags && resource.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {resource.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <h2 className="text-lg font-semibold leading-snug mb-2 group-hover:text-primary transition-colors">
                    {resource.title}
                  </h2>
                  {(resource.excerpt || resource.meta_description) && (
                    <p className="text-sm text-muted-foreground line-clamp-3 flex-1">
                      {resource.excerpt || resource.meta_description}
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-4 pt-4 border-t text-xs text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(resource.published_at || resource.created_at)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {estimateReadTime(resource.excerpt)}
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform text-primary" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

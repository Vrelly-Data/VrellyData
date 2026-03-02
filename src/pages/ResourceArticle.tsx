import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar, Clock, ArrowLeft, User } from 'lucide-react';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { useResource } from '@/hooks/useResources';

export default function ResourceArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { data: resource, isLoading, isError } = useResource(slug ?? '');

  useEffect(() => {
    if (resource) {
      document.title = `${resource.title} | Vrelly`;
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc && resource.meta_description) {
        metaDesc.setAttribute('content', resource.meta_description);
      }
    }
  }, [resource]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const estimateReadTime = (content: string) => {
    const words = content.split(' ').length;
    return `${Math.max(3, Math.ceil(words / 200))} min read`;
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
            <article className="prose prose-neutral max-w-none">
              <ReactMarkdown>{resource.content_markdown}</ReactMarkdown>
            </article>

            {/* Footer CTA */}
            <div className="mt-16 p-8 rounded-xl bg-primary/5 border border-primary/20 text-center">
              <h3 className="text-xl font-semibold mb-2">Ready to build your outbound strategy?</h3>
              <p className="text-muted-foreground mb-4">Vrelly gives you enriched B2B data and AI-powered sales intelligence to scale your pipeline.</p>
              <Button asChild>
                <Link to="/auth">Get Started Free</Link>
              </Button>
            </div>
          </>
        ) : null}
      </main>

      <Footer />
    </div>
  );
}

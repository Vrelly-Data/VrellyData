import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Check, X, ArrowRight, BookOpen } from 'lucide-react';
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from '@/components/ui/carousel';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { Button } from '@/components/ui/button';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';
import { supabase } from '@/integrations/supabase/client';

const dataProviderRows = [
  {
    feature: '10,000 enriched credits',
    competitor: 'Costs a fortune',
    vrelly: 'Affordable at scale',
  },
  {
    feature: 'Data Insights',
    competitor: 'None',
    vrelly: 'Full campaign & performance analytics',
  },
  {
    feature: 'Learns from YOUR data',
    competitor: 'No',
    vrelly: 'Yes — AI trained on your history',
  },
  {
    feature: 'Copy assistance',
    competitor: 'No',
    vrelly: '1-click AI-powered copy improvement',
  },
  {
    feature: 'Data freshness',
    competitor: 'Stale',
    vrelly: 'Continuously verified',
  },
];

const copyAiRows = [
  {
    feature: 'Trained on sales correlation',
    competitor: 'Generic, mediocre output',
    vrelly: 'Proprietary model on 200K+ real campaigns',
  },
  {
    feature: 'Knows your data',
    competitor: 'No context about you',
    vrelly: 'Learns from your historical performance',
  },
  {
    feature: 'Outreach copy quality',
    competitor: 'Generic slop',
    vrelly: 'High-converting, data-backed copy',
  },
  {
    feature: 'Sales-specific training',
    competitor: 'None',
    vrelly: 'Benchmarked against top performers',
  },
  {
    feature: 'Personalization',
    competitor: 'One-size-fits-all',
    vrelly: 'Tailored to your audience & vertical',
  },
];

const dataProviderCompetitors = ['Apollo', 'ZoomInfo', 'Seamless'];

const ComparisonTable = ({
  rows,
  competitorLabel,
}: {
  rows: typeof dataProviderRows;
  competitorLabel: string;
}) => {
  const { ref, isVisible } = useScrollAnimation(0.1);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
    >
      {/* Header row */}
      <div className="grid grid-cols-3 gap-4 mb-3 px-4">
        <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Feature</div>
        <div className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {competitorLabel}
        </div>
        <div className="text-center text-sm font-semibold text-primary uppercase tracking-wide">Vrelly</div>
      </div>

      {/* Rows */}
      <div className="rounded-2xl border border-border/50 overflow-hidden bg-card shadow-sm">
        {rows.map((row, i) => (
          <div
            key={row.feature}
            className={`grid grid-cols-3 gap-4 items-center px-4 py-5 ${
              i !== rows.length - 1 ? 'border-b border-border/40' : ''
            } hover:bg-muted/20 transition-colors`}
            style={{ transitionDelay: `${i * 60}ms` }}
          >
            {/* Feature */}
            <div className="text-sm font-medium text-foreground">{row.feature}</div>

            {/* Competitor */}
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-6 h-6 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                <X className="w-3.5 h-3.5 text-destructive" />
              </div>
              <span className="text-xs text-muted-foreground text-center leading-snug">{row.competitor}</span>
            </div>

            {/* Vrelly */}
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Check className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="text-xs text-primary/80 font-medium text-center leading-snug">{row.vrelly}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Comparisons = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'data' | 'copy'>('data');
  const [competitorIndex, setCompetitorIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const { ref: heroRef, isVisible: heroVisible } = useScrollAnimation(0.01);
  const { ref: ctaRef, isVisible: ctaVisible } = useScrollAnimation(0.1);
  const { ref: blogRef, isVisible: blogVisible } = useScrollAnimation(0.1);
  const [articles, setArticles] = useState<{ id: string; slug: string; title: string; excerpt: string | null; tags: string[] | null; cover_image_url: string | null }[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('resources')
      .select('id, slug, title, excerpt, tags, cover_image_url')
      .eq('is_published', true)
      .order('published_at', { ascending: false })
      .limit(6)
      .then(({ data }) => {
        setArticles(data ?? []);
        setResourcesLoading(false);
      });
  }, []);

  // Cycle through data provider competitors only when on the "data" tab
  useEffect(() => {
    if (tab !== 'data') return;

    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setCompetitorIndex((prev) => (prev + 1) % dataProviderCompetitors.length);
        setVisible(true);
      }, 300);
    }, 2500);

    return () => clearInterval(interval);
  }, [tab]);

  const currentCompetitor =
    tab === 'data' ? dataProviderCompetitors[competitorIndex] : 'Standard LLM';

  const competitorLabel =
    tab === 'data' ? `${currentCompetitor} / Others` : 'Standard LLM';

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="pt-32 pb-16 px-4 text-center relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />

        <div
          ref={heroRef}
          className={`relative z-10 max-w-3xl mx-auto transition-all duration-700 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-6">
            Side-by-side comparison
          </div>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-4 text-foreground">
            Vrelly vs{' '}
            <span
              className="text-primary inline-block"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(-8px)',
                transition: 'opacity 0.3s ease, transform 0.3s ease',
              }}
            >
              {currentCompetitor}
            </span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            See exactly why sales teams are switching to Vrelly for data enrichment and AI-powered outreach.
          </p>
        </div>
      </section>

      {/* Tab toggle */}
      <div className="flex justify-center px-4 mb-10">
        <div className="inline-flex rounded-xl bg-muted p-1 gap-1">
          <button
            onClick={() => setTab('data')}
            className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              tab === 'data'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Data Providers
          </button>
          <button
            onClick={() => setTab('copy')}
            className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              tab === 'copy'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Copy AI
          </button>
        </div>
      </div>

      {/* Comparison table */}
      <section className="max-w-3xl mx-auto px-4 pb-20">
        <div
          key={tab}
          className="animate-fade-in"
        >
          <ComparisonTable
            rows={tab === 'data' ? dataProviderRows : copyAiRows}
            competitorLabel={competitorLabel}
          />
        </div>
      </section>

      {/* CTA */}
      <section
        ref={ctaRef}
        className={`py-20 px-4 text-center transition-all duration-700 ${ctaVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
      >
        <div className="max-w-xl mx-auto bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 rounded-2xl p-10">
          <h2 className="text-3xl font-bold text-foreground mb-3">Ready to make the switch?</h2>
          <p className="text-muted-foreground mb-8">
            Join sales teams using Vrelly to enrich smarter, write better, and close faster.
          </p>
          <Button
            size="lg"
            onClick={() => navigate('/auth?tab=signup')}
            className="text-base px-8 py-6 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
          >
            Get Started
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </section>

      {/* Blog article carousel */}
      {!resourcesLoading && articles.length > 0 && (
        <section
          ref={blogRef}
          className={`py-20 px-4 transition-all duration-700 ${blogVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
              <BookOpen className="w-5 h-5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-widest text-primary">From the Vrelly Blog</span>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-8">Real insights from real campaign data.</h2>

            <Carousel opts={{ align: 'start', loop: true }} className="w-full">
              <CarouselContent className="-ml-4">
                {articles.map((article) => (
                  <CarouselItem key={article.slug} className="pl-4 basis-full md:basis-1/2 lg:basis-1/3">
                    <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow h-full flex flex-col">
                      {article.cover_image_url && (
                        <div className="aspect-video overflow-hidden">
                          <img
                            src={article.cover_image_url}
                            alt={article.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      )}
                      <div className="p-5 flex flex-col flex-1 gap-3">
                        {article.tags?.[0] && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary w-fit">
                            {article.tags[0]}
                          </span>
                        )}
                        <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{article.title}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 flex-1">{article.excerpt}</p>
                        <Link
                          to={`/resources/${article.slug}`}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors mt-auto"
                        >
                          Read Article <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious className="-left-4 md:-left-6" />
              <CarouselNext className="-right-4 md:-right-6" />
            </Carousel>

            <div className="text-center mt-10">
              <Link
                to="/resources"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                See More <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>
      )}

      <Footer />
    </div>
  );
};

export default Comparisons;

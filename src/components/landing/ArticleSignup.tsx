import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { validateEmail } from '@/lib/csvImportValidation';

type ArticleSignupProps = {
  slug: string;
  className?: string;
};

export function ArticleSignup({ slug, className = '' }: ArticleSignupProps) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    const trimmedFirst = firstName.trim();

    if (!validateEmail(trimmedEmail)) {
      setError('Enter a valid work email.');
      return;
    }

    setSubmitting(true);
    try {
      // Anonymous INSERT only. Handle duplicates with ON CONFLICT DO NOTHING.
      const { error: insertError } = await (supabase as any)
        .from('article_subscribers')
        .insert(
          {
            email: trimmedEmail,
            first_name: trimmedFirst || null,
            source_slug: slug,
          },
          { onConflict: 'email', ignoreDuplicates: true, returning: 'minimal' },
        );

      if (insertError) {
        // Unique violation (duplicate) — treat as success
        const msg = insertError.message || '';
        if (msg.includes('duplicate key value') || msg.includes('Unique')) {
          // success
        } else {
          throw insertError;
        }
      }

      setSubmitted(true);
      try {
        if (typeof window !== 'undefined' && (window as any).gtag) {
          (window as any).gtag('event', 'generate_lead', {
            method: 'article_signup',
            slug,
          });
        }
      } catch {
        // no-op
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className={`mt-16 rounded-xl border bg-card p-6 md:p-8 text-card-foreground ${className}`}
      aria-live="polite"
    >
      {submitted ? (
        <div className="text-center">
          <h3 className="text-xl font-semibold mb-2">You’re on the list</h3>
          <p className="text-muted-foreground">
            We’ll send new articles on AI outbound about twice a week.
          </p>
        </div>
      ) : (
        <>
          <h3 className="text-xl font-semibold mb-1">Get the next one in your inbox</h3>
          <p className="text-sm text-muted-foreground mb-5">
            New articles on AI outbound, twice a week.
          </p>
          <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-3">
              <Label htmlFor="article-email">Work email</Label>
              <Input
                id="article-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="article-first-name">First name (optional)</Label>
              <Input
                id="article-first-name"
                type="text"
                autoComplete="given-name"
                placeholder="Jane"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="md:col-span-1">
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Subscribe'}
              </Button>
            </div>
            {error && (
              <div className="md:col-span-6">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
          </form>
        </>
      )}
    </section>
  );
}


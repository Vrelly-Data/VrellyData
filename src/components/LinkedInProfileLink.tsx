import { Linkedin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizeLinkedInUrl } from '@/lib/linkedin';

// A contact's LinkedIn profile as a clickable "in" glyph. Shared by the agent
// pipeline, the inbox and the public client report so all three behave the
// same.
//
// Renders NOTHING when the lead has no usable URL — no dead or greyed-out icon.
//
// stopPropagation is baked in rather than left to each caller: on the pipeline
// board the card itself is clickable (it opens the detail panel), so without it
// every profile click would also pop the panel open behind the new tab.
export function LinkedInProfileLink({
  url,
  className,
  size = 'sm',
}: {
  url: string | null | undefined;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const href = normalizeLinkedInUrl(url);
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="View LinkedIn profile"
      aria-label="View LinkedIn profile (opens in a new tab)"
      className={cn(
        'inline-flex shrink-0 items-center text-blue-600 hover:text-blue-700 transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm',
        className,
      )}
    >
      <Linkedin className={size === 'md' ? 'h-4 w-4' : 'h-3 w-3'} />
    </a>
  );
}

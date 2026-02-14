

# Restore Hero Headline (Without "Your AI Agent")

## What Changed
It looks like the headline text under the Vrelly logo got removed. We'll restore it with two lines instead of three, dropping "Your AI Agent."

## Change

**File: `src/components/landing/HeroSection.tsx`** (lines 82-96)

Replace the current `<h1>` block with:

```tsx
<h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
  <span className="inline-block opacity-0 animate-fade-up" style={{ animationDelay: '0.3s' }}>
    <span className="text-foreground">Your Sales Data.</span>
  </span>
  <br />
  <span className="inline-block opacity-0 animate-fade-up" style={{ animationDelay: '0.5s' }}>
    <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
      Your Competitive Edge.
    </span>
  </span>
</h1>
```

This removes the "Your AI Agent." line and adjusts the animation delay on "Your Competitive Edge." to keep the stagger smooth (0.3s then 0.5s).

No other files affected.

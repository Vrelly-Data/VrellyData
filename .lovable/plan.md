

# Add "Getting Started" Callout Below How It Works

## Change

**File: `src/components/landing/HowItWorksSection.tsx`**

Add a callout paragraph below the 3-step Connect/Analyze/Act cards, inside the same section container. It will use the same scroll animation and fade-up styling to match the existing design.

After the closing `</div>` of the steps row (around line 60), add a centered text block:

```
New to outbound? No problem — simply sign up and use our copy and audience
builder to get started in 5 minutes.
```

Styled as a muted-foreground paragraph with a subtle highlight on "5 minutes", using the same `animate-fade-up` class with a delayed entry so it appears after the 3 steps animate in.

No other files affected.



## Add Email Reply Rate Percentage on Hover

### What you're asking for

Show an email reply rate percentage when hovering over the "Email Replies" count in the Total Replies breakdown popover, similar to how LinkedIn Replies already displays a rate.

---

## Implementation

### Change to make

In `src/components/playground/PlaygroundStatsGrid.tsx`:

1. **Calculate email reply rate** - Add a new calculation:
   - Formula: `(emailReplies / emailsDelivered) * 100`
   - Only show when `emailsDelivered > 0` to avoid division by zero

2. **Add hover tooltip to Email Replies count** - Wrap the email replies number with a `Tooltip` component (same pattern used for LinkedIn replies and connection acceptance rate)

---

### Code location

Lines 195-201 currently show:
```tsx
<div className="flex items-center justify-between gap-4">
  <span className="flex items-center gap-1.5 text-muted-foreground">
    <Mail className="h-3.5 w-3.5" />
    Email Replies:
  </span>
  <span className="font-medium">{emailReplies.toLocaleString()}</span>
</div>
```

This will be updated to include a tooltip showing the email reply rate percentage, following the same pattern as the LinkedIn reply rate tooltip at lines 207-222.

---

### Result

When you click on the "Total Replies" stat card and hover over the Email Replies number, you'll see a tooltip showing something like:

> **2.5% reply rate**

This matches the existing behavior for LinkedIn Replies and Connection Acceptance Rate.


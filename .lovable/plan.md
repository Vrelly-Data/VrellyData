
## Change: Update "AI Sales Agent" Feature Card

### File to Edit
`src/components/landing/FeaturesSection.tsx`

### What Changes

Lines 32–35 — the last entry in the `features` array:

- **Icon**: swap `Bot` for `TrendingUp` (more fitting for benchmarking/trends). The `Bot` import will also be removed since it's no longer used.
- **Title**: `'AI Sales Agent'` → `'Benchmark Your Sales Trends'`
- **Description**: `'1-click setup for an AI agent trained on your live data, current sales trends, and our proprietary repository.'` → `'Get insight into top performing campaigns across anonymous users of the platform.'`

### Technical Details

- `TrendingUp` is already available in the `lucide-react` package that is installed.
- The `Bot` import on line 1 will be replaced with `TrendingUp` to avoid an unused import warning.
- No other files need to change.

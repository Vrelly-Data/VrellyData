

## Fix: Campaign List Not Scrolling/Showing All Campaigns

### Problem Identified
The `ManageCampaignsDialog` is correctly fetching all 62 campaigns from the API, but only a few are visible because the `ScrollArea` component doesn't have a proper height constraint for scrolling to work.

### Root Cause
The Radix UI `ScrollArea` component requires an explicit height to create a scrollable container. Currently, `flex-1` is used, but this doesn't provide a bounded height in this dialog layout context, so the scroll viewport has no limit and content overflows or gets cut off without being scrollable.

### Solution
Add an explicit height to the `ScrollArea` to ensure all 62 campaigns are accessible via scrolling.

### File to Modify

**`src/components/playground/ManageCampaignsDialog.tsx`**

Change the ScrollArea from:
```tsx
<ScrollArea className="flex-1 border rounded-md">
```

To:
```tsx
<ScrollArea className="h-[400px] border rounded-md">
```

This gives the ScrollArea a fixed 400px height, which:
- Provides enough space to show approximately 8-10 campaigns at once
- Enables vertical scrolling to access all 62 campaigns
- Works reliably within the dialog's max-height constraint

### Alternative Approach (if fixed height is undesirable)
If you prefer a responsive approach that uses available dialog space, we could use:
```tsx
<ScrollArea className="flex-1 min-h-[200px] max-h-[400px] border rounded-md">
```

This provides a minimum height of 200px, maximum of 400px, with flex to fill available space between.

### Technical Details
- The Radix UI ScrollArea viewport needs a bounded container to calculate scroll dimensions
- Without explicit height, the viewport's `h-full` has nothing to reference
- The fix ensures the scroll thumb appears and users can scroll through all campaigns


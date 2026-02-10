

# Remove "Real-time via webhooks" Messaging

## Change

In `src/components/playground/PlaygroundStatsGrid.tsx`, remove the webhook-related footer messages from both the **Messages** and **Replies** popover content blocks:

1. **Messages popover** (~lines 148-155): Remove the conditional block that shows either the green "Real-time via webhooks" text or "Enable webhooks for LinkedIn tracking".

2. **Replies popover** (~lines 185-192): Remove the same conditional block.

This aligns with the earlier decision to hide all webhook UI elements from the dashboard.


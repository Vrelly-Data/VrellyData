

## Add Manual Webhook Refresh Button

### Overview

Add a small refresh button next to the "Live" badge so you can manually re-register the Reply.io webhook at any time, even when the status shows as active.

---

### Implementation

**File:** `src/components/playground/IntegrationSetupCard.tsx`

**Change:** Replace the current Live badge (lines 89-94) with a badge + refresh button combo:

```text
Current:
┌──────────────┐
│ ⚡ Live      │
└──────────────┘

After:
┌──────────────┐ ┌───┐
│ ⚡ Live      │ │ ↻ │  ← Click to refresh webhook
└──────────────┘ └───┘
```

**Code change:**

```tsx
// Before (line 89-94)
{isReplyIo && webhookStatus === 'active' && (
  <Badge variant="secondary" className="...">
    <Zap className="h-3 w-3" />
    Live
  </Badge>
)}

// After
{isReplyIo && webhookStatus === 'active' && (
  <div className="flex items-center gap-1">
    <Badge variant="secondary" className="...">
      <Zap className="h-3 w-3" />
      Live
    </Badge>
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={() => onSetupWebhook(integration.id)}
      disabled={isSettingUpWebhook || !integration.is_active}
      title="Refresh webhook connection"
    >
      {isSettingUpWebhook ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RefreshCw className="h-3 w-3" />
      )}
    </Button>
  </div>
)}
```

---

### Behavior

| Action | Result |
|--------|--------|
| Click refresh button | Triggers `onSetupWebhook(integration.id)` |
| During setup | Shows spinning loader, button disabled |
| On success | Shows toast "Webhook configured successfully" |
| On failure | Shows toast with error message |

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/playground/IntegrationSetupCard.tsx` | Add refresh button next to Live badge (lines 89-94) |

---

### Outcome

You'll be able to click the refresh icon next to the "Live" badge to re-register the webhook with Reply.io using the new V3 API, without needing to wait for the system to detect an error state.


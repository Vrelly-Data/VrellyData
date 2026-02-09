

# Remove Webhook UI to Protect Stable Sync

## Summary

Remove the "Enable Live" button and all webhook-related UI elements from the Data Playground to prevent webhook errors from appearing. The backend code will remain in place for future use but will never be triggered.

---

## What Will Change

### 1. IntegrationSetupCard.tsx (UI Cleanup)

Remove these UI elements:
- "Enable Live" button (lines 155-181)
- "Live" badge with refresh button (lines 90-111)
- "Webhook Error" badge (lines 112-117)
- Props: `onSetupWebhook`, `isSettingUpWebhook` from IntegrationRow
- State: `webhookSetupId` and `handleSetupWebhook` function

### 2. useOutboundIntegrations.ts (Keep but don't expose)

The `setupWebhook` mutation will remain in the file but will NOT be exported. This allows us to easily re-enable it later without rewriting the logic.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/playground/IntegrationSetupCard.tsx` | Remove webhook UI elements |
| `src/hooks/useOutboundIntegrations.ts` | Remove `setupWebhook` from exports |

---

## What Stays Unchanged

- Edge function `setup-reply-webhook` (stays deployed, just unused)
- Edge function `reply-webhook` (stays deployed, just unused)
- Database columns `webhook_status`, `webhook_subscription_id`, `webhook_secret` (stay in schema)
- Webhook events table (stays for future use)

---

## Why This Approach

1. **Minimal code changes** - Only removing UI, not backend logic
2. **Easily reversible** - Can re-add the button later
3. **No database migrations** - Schema stays intact
4. **Protects working sync** - Webhook errors won't interfere with manual sync

---

## Code Changes

### IntegrationSetupCard.tsx

Remove from IntegrationRowProps:
```typescript
// Remove these props
onSetupWebhook: (id: string) => void;
isSettingUpWebhook: boolean;
```

Remove from IntegrationRow component:
```typescript
// Remove these lines (90-117) - webhook badges and buttons
{isReplyIo && webhookStatus === 'active' && (...)}
{isReplyIo && webhookStatus === 'error' && (...)}

// Remove these lines (155-181) - Enable Live button
{isReplyIo && webhookStatus !== 'active' && (...)}
```

Remove from IntegrationSetupCard component:
```typescript
// Remove state
const [webhookSetupId, setWebhookSetupId] = useState<string | null>(null);

// Remove from hook destructuring
setupWebhook  // Remove this

// Remove handler
const handleSetupWebhook = ...  // Remove entire function

// Remove from IntegrationRow props
onSetupWebhook={handleSetupWebhook}
isSettingUpWebhook={webhookSetupId === integration.id}
```

### useOutboundIntegrations.ts

Keep the `setupWebhook` mutation code but remove from return statement:
```typescript
// Before
return {
  ...
  setupWebhook,
  ...
};

// After
return {
  ...
  // setupWebhook removed - not exposed to UI
  ...
};
```

---

## Result

- No "Enable Live" button visible
- No "Webhook Error" badge visible
- No "Live" badge visible
- Sync continues to work exactly as it does now
- Webhook code preserved for future re-enablement


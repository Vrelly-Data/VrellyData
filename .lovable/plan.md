

## Add Sync Progress Timer / Activity Indicator

### Problem

When clicking "Sync", the button shows a spinner, but if the sync takes a while, users can't tell if it's still working or stuck. The "Syncing..." badge doesn't provide enough feedback about ongoing activity.

---

### Solution

Add an **elapsed time counter** that shows how long the sync has been running, along with a subtle **progress animation** to indicate activity.

| Current State | Improved State |
|---------------|----------------|
| Badge: "Syncing..." | Badge: "Syncing... (0:45)" with elapsed time |
| No activity indication | Animated progress bar or pulsing indicator |
| User confused if stuck | Clear visual that work is in progress |

---

### UI Changes

**During Active Sync:**
```text
┌──────────────────────────────────────────────────────────────────┐
│ 📧 Incrementums  [Syncing... 0:32]  [Team: 383893]  [⚡ Live]    │
│    reply.io · Last synced 1 hour ago                             │
│    ┌─────────────────────────────────────────┐                   │
│    │ ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← Progress bar   │
│    └─────────────────────────────────────────┘                   │
│    Workspace: 383893                                             │
└──────────────────────────────────────────────────────────────────┘
```

**Key Features:**
1. **Elapsed Timer**: Shows `0:00`, `0:15`, `0:32`, etc. while syncing
2. **Animated Progress Bar**: Indeterminate animation (striped/pulsing) since we don't know exact progress
3. **Visual Continuity**: Timer keeps counting so users know it's not frozen

---

### Implementation Details

**Component Changes**: `src/components/playground/IntegrationSetupCard.tsx`

1. **Track sync start time** using local state or `updated_at` timestamp
2. **Add useEffect with interval** to update elapsed time display every second
3. **Show animated progress bar** below the integration row when syncing
4. **Update status badge** to include elapsed time: `Syncing... (0:45)`

**New State:**
```typescript
const [syncStartTime, setSyncStartTime] = useState<Record<string, number>>({});
const [elapsedTime, setElapsedTime] = useState<Record<string, number>>({});

// Track elapsed time with useEffect
useEffect(() => {
  const interval = setInterval(() => {
    // Update elapsed time for any syncing integrations
    const now = Date.now();
    const updates: Record<string, number> = {};
    for (const [id, startTime] of Object.entries(syncStartTime)) {
      updates[id] = Math.floor((now - startTime) / 1000);
    }
    setElapsedTime(updates);
  }, 1000);
  return () => clearInterval(interval);
}, [syncStartTime]);
```

**Updated Badge:**
```typescript
case 'syncing':
  const elapsed = elapsedSeconds ? formatElapsedTime(elapsedSeconds) : '';
  return (
    <Badge variant="secondary" className="text-xs bg-accent text-accent-foreground">
      Syncing...{elapsed && ` (${elapsed})`}
    </Badge>
  );
```

**Animated Progress Bar:**
```typescript
{isCurrentlySyncing && (
  <div className="mt-2">
    <Progress 
      value={undefined} 
      className="h-1.5 animate-pulse" 
    />
  </div>
)}
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/playground/IntegrationSetupCard.tsx` | Add elapsed time tracking, update badge display, add progress bar animation |

---

### Expected Result

| Before | After |
|--------|-------|
| "Syncing..." badge with no time indicator | "Syncing... (0:45)" badge with elapsed time |
| Static spinner only | Animated progress bar below row |
| User unsure if working | Clear indication of ongoing activity |
| 5-minute timeout detection only | Real-time feedback from second 1 |


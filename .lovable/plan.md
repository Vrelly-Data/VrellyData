
## Change Import Button Text

### What's Changing
Update the Import button in the LinkedIn Stats Upload dialog from dynamic text ("Import 4 Campaigns") to static text ("Import LinkedIn Data").

### File to Modify
`src/components/playground/LinkedInStatsUploadDialog.tsx`

### Current Code (line ~274)
```tsx
<Button 
  onClick={handleImport} 
  disabled={parsedStats.length === 0}
>
  Import {parsedStats.length} Campaign{parsedStats.length !== 1 ? 's' : ''}
</Button>
```

### Updated Code
```tsx
<Button 
  onClick={handleImport} 
  disabled={parsedStats.length === 0}
>
  Import LinkedIn Data
</Button>
```

### Summary
A one-line text change to make the button label clearer and more consistent.



# Copy Revamp with Claude API

## Overview

Build the "Revamp" button functionality in the Copy tab. When clicked, an edge function calls Claude with the current email/message copy plus relevant entries from the `sales_knowledge` table, and returns an improved version.

## How It Works

1. User clicks "Revamp" on a sequence step
2. Edge function receives the step's subject + body + step type
3. Edge function queries `sales_knowledge` for relevant entries (email templates, guidelines, high-performing examples)
4. Claude rewrites the copy using both the original and the knowledge context
5. Result is shown in a dialog where the user can copy or discard

## Steps

### 1. Store the Claude API Key

You'll be prompted to enter your Anthropic API key (from console.anthropic.com). It will be stored securely as a backend secret called `ANTHROPIC_API_KEY`.

### 2. Create Edge Function: `revamp-copy`

New file: `supabase/functions/revamp-copy/index.ts`

- Accepts: `{ subject, body, stepType, campaignName }`
- Queries `sales_knowledge` table for active entries (prioritizing `email_template`, `sales_guideline`, `sequence_playbook` categories) -- up to 10 entries to keep context manageable
- Calls Claude API (`claude-sonnet-4-20250514`) with a system prompt that includes the knowledge context and instructs it to rewrite the copy
- Returns: `{ subject, body }` (the revamped versions)

### 3. Update CopyTab.tsx

- Replace the placeholder `handleRevamp` with a real function that calls the edge function
- Add a "Revamp Result" dialog showing the AI-generated copy side-by-side with the original
- Include "Copy Subject" / "Copy Body" buttons on the revamped version
- Show a loading state (spinner on the Revamp button) while Claude is working

### 4. "Revamp All" Button

- Wire up the "Revamp All" button in the campaign header to sequentially revamp all steps
- Show progress (e.g., "Revamping step 3 of 7...")
- Results shown in a summary dialog

## Sales Knowledge Integration

The edge function will pull from your existing `sales_knowledge` table automatically. Any entries you've added manually (via the "Add Entry" button) will be included as context for Claude. You don't need the CSV import working to use this -- even a few manually added guidelines or high-performing templates will improve the output.

## Technical Details

- **Model**: `claude-sonnet-4-20250514` for quality rewrites
- **Context window**: System prompt includes up to 10 knowledge entries (sorted by relevance to the step type)
- **No database changes needed** -- reads from existing `sales_knowledge` table
- **New secret**: `ANTHROPIC_API_KEY`
- **New edge function**: `revamp-copy`
- **Modified file**: `src/components/playground/CopyTab.tsx`


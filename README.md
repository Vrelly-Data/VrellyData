# Vrelly

Prospect audience builder & outbound platform. Vite + React + TypeScript
frontend on Vercel; Supabase (Postgres + Edge Functions) + Stripe backend.

**Production:** https://vrelly.com

## Editing the code

Clone and work locally in your own IDE. Requires Node.js & npm
([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd VrellyData

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## Tech stack

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

Backend: Supabase + Stripe. See `VRELLY-INFRA.md` for the full architecture.

## Deployment

- **Frontend** — hosted on Vercel. Every push to `main` auto-deploys as a
  Vercel production build (~20s). vrelly.com serves the latest build; no
  manual step.
- **Edge functions** — deployed **manually**, NOT on push:
  `npx supabase functions deploy <name> --project-ref lgnvolndyftsbcjprmic`
- **Database migrations** — applied **manually** via the Supabase Studio
  SQL editor.

## Custom domain

vrelly.com is configured as the production domain in Vercel
(Project → Settings → Domains).

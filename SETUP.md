# Fixio — Landing Page

Stack: **Svelte + Vite**, **Tailwind CSS v4**, **GSAP** (hero animation), **PostHog** (analytics).

## Run locally
```bash
npm install
npm run dev
```

## Build for production
```bash
npm run build
```
This outputs a static site to `dist/` — deploy that folder to Vercel, Netlify, Cloudflare Pages, or any static host.

## Before you go live

1. **PostHog key** — open `src/lib/analytics.js` and replace `phc_REPLACE_ME` with your real project API key (and host, if self-hosting). Until you do, analytics is silently disabled so nothing breaks.
2. **Google Sign-In** — the "Continue with Google" button in `src/lib/SignInModal.svelte` is currently a placeholder (it just closes the modal). Wire up real Google OAuth here once your backend/auth provider is ready.
3. **Pricing** — `src/lib/Pricing.svelte` has placeholder tiers (Free / ₹199 Pro). Swap in your real numbers whenever they're finalized.
4. **Brand name** — "Fixio" is a placeholder name used in the nav and footer. Search-replace it once you land on a real name.
5. **Socials** — footer links in `src/lib/Footer.svelte` point to placeholder URLs (`linkedin.com`, `instagram.com`, `x.com`) — swap in your real profile links.

## File structure
```
src/
  lib/
    Nav.svelte          nav bar + sign-in trigger
    Hero.svelte         "Let's get you a job!" + animated resume-scan visual
    HowItWorks.svelte   3-step flow (upload → we read it → see your gap)
    Pricing.svelte      Free / Pro tiers
    Footer.svelte       socials + copyright
    SignInModal.svelte  Google sign-in prompt (opens on "Get started")
    analytics.js        PostHog init + trackEvent helper
  App.svelte            wires everything together
  app.css               design tokens (colors, fonts) + Tailwind import
```

import posthog from 'posthog-js'

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'

let initialized = false

export function initAnalytics() {
  if (initialized || typeof window === 'undefined') return
  if (!POSTHOG_KEY) {
    console.warn('[analytics] VITE_POSTHOG_KEY not set — skipping init. Add it to .env (local) and Vercel env vars (live).')
    return
  }
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true, // tracks clicks on buttons/links automatically
  })
  initialized = true
}

export function identifyUser(user) {
  if (!initialized || !user) return
  posthog.identify(user.id, { email: user.email })
}

// Use this for meaningful product moments beyond autocapture,
// e.g. trackEvent('get_started_clicked')
export function trackEvent(name, props = {}) {
  if (!initialized) return
  posthog.capture(name, props)
}

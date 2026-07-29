import posthog from 'posthog-js'

// TODO: replace with your real PostHog project key + host before deploying.
// Get these from your PostHog project settings: https://app.posthog.com/project/settings
const POSTHOG_KEY = 'phc_REPLACE_ME'
const POSTHOG_HOST = 'https://us.i.posthog.com'

let initialized = false

export function initAnalytics() {
  if (initialized || typeof window === 'undefined') return
  if (POSTHOG_KEY === 'phc_REPLACE_ME') {
    console.warn('[analytics] PostHog key not set yet — skipping init. Add your key in src/lib/analytics.js')
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

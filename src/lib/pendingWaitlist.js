const KEY = 'fixio_pending_waitlist_role'

export function stashPendingWaitlistRole(role) {
  sessionStorage.setItem(KEY, role)
}

export function getPendingWaitlistRole() {
  return sessionStorage.getItem(KEY)
}

export function clearPendingWaitlistRole() {
  sessionStorage.removeItem(KEY)
}

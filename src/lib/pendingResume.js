const KEY = 'fixio_pending_resume'
const META_KEY = 'fixio_pending_meta'

export async function stashPendingResume(file, meta) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  sessionStorage.setItem(KEY, JSON.stringify({ name: file.name, type: file.type, data: base64 }))
  if (meta) sessionStorage.setItem(META_KEY, JSON.stringify(meta))
}

export function getPendingResume() {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  try {
    const { name, type, data } = JSON.parse(raw)
    const byteChars = atob(data)
    const bytes = new Uint8Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
    return new File([bytes], name, { type })
  } catch (e) {
    console.error('[pendingResume] failed to parse cached file', e)
    return null
  }
}

export function getPendingMeta() {
  const raw = sessionStorage.getItem(META_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

export function clearPendingResume() {
  sessionStorage.removeItem(KEY)
  sessionStorage.removeItem(META_KEY)
}

export function hasPendingResume() {
  return !!sessionStorage.getItem(KEY)
}

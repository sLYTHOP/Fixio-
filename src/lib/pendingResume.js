const KEY = 'fixio_pending_resume'

export async function stashPendingResume(file) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  sessionStorage.setItem(KEY, JSON.stringify({ name: file.name, type: file.type, data: base64 }))
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

export function clearPendingResume() {
  sessionStorage.removeItem(KEY)
}

export function hasPendingResume() {
  return !!sessionStorage.getItem(KEY)
}

<script>
  import { trackEvent } from './analytics.js'

  export let onFileReady = () => {}
  export let onError = () => {}

  let inputEl

  export function openPicker() {
    inputEl?.click()
  }

  const MAX_SIZE = 8 * 1024 * 1024 // 8MB
  const ACCEPTED_EXT = ['.pdf', '.docx']

  function validate(file) {
    const nameOk = ACCEPTED_EXT.some(ext => file.name.toLowerCase().endsWith(ext))
    if (!nameOk) return 'Please upload a PDF or DOCX file.'
    if (file.size > MAX_SIZE) return 'File is too large — max 8MB.'
    return ''
  }

  function handleFile(file) {
    const err = validate(file)
    if (err) {
      onError(err)
      trackEvent('resume_upload_rejected', { reason: err })
      return
    }
    trackEvent('resume_upload_selected', { size: file.size, type: file.type })
    onFileReady(file)
  }

  function onInputChange(e) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    inputEl.value = ''
  }
</script>

<input
  bind:this={inputEl}
  type="file"
  accept=".pdf,.docx"
  class="hidden"
  on:change={onInputChange}
/>

<script>
  import { afterUpdate, onDestroy, onMount, tick } from 'svelte'

  export let file
  export let issues = []
  export let activeIssue = null

  let containerEl
  let pages = []
  let marks = []
  let highlightWarning = ''
  let loadError = ''
  let pdfDocument
  let PdfTextLayer
  let fileUrl = ''
  let resizeObserver
  let resizeTimer
  let renderGeneration = 0
  let renderTasks = []
  let hoveredIssue = null
  let lastNavigatedIssue = null

  $: visibleIssue = hoveredIssue ?? activeIssue
  $: activeMark = visibleIssue === null
    ? null
    : marks.find((mark) => mark.issueIndex === visibleIssue) ?? null

  function normalizeText(text) {
    return text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  }

  function findItemIndexes(items, query) {
    const normalizedQuery = normalizeText(query)
    if (!normalizedQuery) return []

    let normalizedText = ''
    const itemIndexes = []
    items.forEach((item, itemIndex) => {
      for (const char of item.normalize('NFKC').toLowerCase()) {
        if (/[\p{L}\p{N}]/u.test(char)) {
          normalizedText += char
          itemIndexes.push(itemIndex)
        } else if (normalizedText && !normalizedText.endsWith(' ')) {
          normalizedText += ' '
          itemIndexes.push(itemIndex)
        }
      }
      if (normalizedText && !normalizedText.endsWith(' ')) {
        normalizedText += ' '
        itemIndexes.push(itemIndex)
      }
    })

    const start = normalizedText.indexOf(normalizedQuery)
    if (start < 0) return []
    const end = start + normalizedQuery.length
    return [...new Set(itemIndexes.slice(start, end))]
  }

  function cancelRendering() {
    renderTasks.forEach((task) => task.cancel())
    renderTasks = []
  }

  async function renderPages() {
    if (!pdfDocument || !containerEl || !containerEl.clientWidth) return
    const generation = ++renderGeneration
    cancelRendering()

    const pageWidth = Math.min(containerEl.clientWidth - 24, 900)
    for (const page of pages) {
      const pdfPage = await pdfDocument.getPage(page.number)
      page.pdfPage = pdfPage
      const scale = pageWidth / page.baseWidth
      const viewport = pdfPage.getViewport({ scale })
      page.width = viewport.width
      page.height = viewport.height
      page.viewport = viewport
    }
    pages = [...pages]
    await tick()

    const nextMarks = []
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

    for (const page of pages) {
      if (generation !== renderGeneration) return
      const wrapper = containerEl.querySelector(`[data-pdf-page="${page.number}"]`)
      if (!wrapper) continue

      const canvas = wrapper.querySelector('canvas')
      const textLayerEl = wrapper.querySelector('.resume-text-layer')
      const viewport = page.viewport
      canvas.width = Math.ceil(viewport.width * pixelRatio)
      canvas.height = Math.ceil(viewport.height * pixelRatio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      textLayerEl.replaceChildren()

      const renderTask = page.pdfPage.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      })
      renderTasks.push(renderTask)

      try {
        await renderTask.promise
      } catch (error) {
        if (error?.name === 'RenderingCancelledException') return
        throw error
      }

      const textContent = await page.pdfPage.getTextContent()
      const textLayer = new PdfTextLayer({
        textContentSource: textContent,
        container: textLayerEl,
        viewport,
      })
      await textLayer.render()

      const pageRect = wrapper.getBoundingClientRect()
      issues.forEach((issue, issueIndex) => {
        const excerptMatches = issue.excerpt
          ? findItemIndexes(textLayer.textContentItemsStr, issue.excerpt)
          : []
        const itemIndexes = excerptMatches.length
          ? excerptMatches
          : findItemIndexes(textLayer.textContentItemsStr, issue.section)
        itemIndexes.forEach((itemIndex) => {
          const textDiv = textLayer.textDivs[itemIndex]
          if (!textDiv) return
          const rect = textDiv.getBoundingClientRect()
          if (!rect.width || !rect.height) return
          nextMarks.push({
            issueIndex,
            pageNumber: page.number,
            left: rect.left - pageRect.left,
            top: rect.top - pageRect.top,
            width: rect.width,
            height: rect.height,
          })
        })
      })
    }

    if (generation === renderGeneration) {
      marks = nextMarks
      const matchedIssues = new Set(nextMarks.map((mark) => mark.issueIndex))
      if (issues.some((_, index) => !matchedIssues.has(index))) {
        highlightWarning = 'Some sections could not be matched to selectable text in this PDF. Every finding and solution is still listed alongside the preview.'
      } else {
        highlightWarning = ''
      }
    }
  }

  onMount(async () => {
    fileUrl = URL.createObjectURL(file)
    try {
      const [pdfjs, workerModule] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ])
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default
      PdfTextLayer = pdfjs.TextLayer
      pdfDocument = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
      const pageInfo = []
      for (let number = 1; number <= pdfDocument.numPages; number++) {
        const page = await pdfDocument.getPage(number)
        const viewport = page.getViewport({ scale: 1 })
        pageInfo.push({
          number,
          baseWidth: viewport.width,
          width: viewport.width,
          height: viewport.height,
        })
      }
      pages = pageInfo
      await tick()
      await renderPages()
      resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          renderPages().catch((error) => {
            console.error('[ResumePreview] failed to resize resume preview', error)
            loadError = 'The resume preview could not be updated. Open the original PDF or review the issues below.'
          })
        }, 120)
      })
      resizeObserver.observe(containerEl)
    } catch (error) {
      console.error('[ResumePreview] failed to render resume PDF', error)
      loadError = 'We could not display this PDF here. You can still review all issues below or open the original file.'
    }
  })

  afterUpdate(() => {
    if (activeIssue === lastNavigatedIssue) return
    lastNavigatedIssue = activeIssue
    if (activeIssue === null) return
    const mark = marks.find((item) => item.issueIndex === activeIssue)
    if (mark) {
      containerEl
        ?.querySelector(`[data-pdf-page="${mark.pageNumber}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })

  onDestroy(() => {
    clearTimeout(resizeTimer)
    resizeObserver?.disconnect()
    cancelRendering()
    pdfDocument?.destroy()
    if (fileUrl) URL.revokeObjectURL(fileUrl)
  })
</script>

<div data-tour="resume-preview" class="overflow-hidden rounded-2xl border" style="border-color: var(--line); background: var(--surface);">
  <div class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style="border-color: var(--line);">
    <div>
      <p class="font-display font-semibold">Your resume</p>
      <p class="mt-0.5 text-xs" style="color: var(--ink-soft);">Hover or tap a red highlight to locate an issue</p>
    </div>
    <a
      href={fileUrl}
      target="_blank"
      rel="noreferrer"
      class="text-xs font-semibold underline underline-offset-4"
      style="color: var(--lime);"
    >
      Open original
    </a>
  </div>

  {#if loadError}
    <p class="p-5 text-sm" style="color: var(--ink-soft);">
      {loadError}
      <a href={fileUrl} target="_blank" rel="noreferrer" class="ml-1 font-semibold underline" style="color: var(--lime);">Open PDF</a>
    </p>
  {:else if !pages.length}
    <p class="p-5 text-sm" style="color: var(--ink-soft);">Loading resume preview...</p>
  {:else}
    {#if highlightWarning}
      <p class="px-4 pt-4 text-xs leading-relaxed" style="color: var(--ink-soft);" role="status">
        {highlightWarning}
      </p>
    {/if}
    <div bind:this={containerEl} class="resume-pages space-y-5 p-3 sm:p-5">
      {#each pages as page (page.number)}
        <div
          class="resume-page relative mx-auto"
          data-pdf-page={page.number}
          style="width: {page.width}px; height: {page.height}px;"
        >
          <canvas aria-label="Resume page {page.number}"></canvas>
          <div class="resume-text-layer"></div>

          {#each marks.filter((mark) => mark.pageNumber === page.number) as mark}
            <button
              type="button"
              class:active={visibleIssue === mark.issueIndex}
              class="resume-mark"
              style="left: {mark.left}px; top: {mark.top}px; width: {mark.width}px; height: {mark.height}px;"
              aria-label="Issue in {issues[mark.issueIndex].section}: {issues[mark.issueIndex].issue}. Suggested fix: {issues[mark.issueIndex].solution}"
              aria-pressed={activeIssue === mark.issueIndex}
              on:mouseenter={() => (hoveredIssue = mark.issueIndex)}
              on:mouseleave={() => (hoveredIssue = null)}
              on:focus={() => (hoveredIssue = mark.issueIndex)}
              on:blur={() => (hoveredIssue = null)}
              on:click={() => (activeIssue = activeIssue === mark.issueIndex ? null : mark.issueIndex)}
            ></button>
          {/each}

          {#if activeMark?.pageNumber === page.number}
            <div
              class="solution-popover"
              style="left: {Math.max(8, Math.min(activeMark.left, page.width - 296))}px; top: {Math.max(8, activeMark.top - 82)}px;"
              role="status"
            >
              <p class="text-xs font-bold uppercase tracking-wide">Suggested fix</p>
              <p class="mt-1 text-sm">{issues[activeMark.issueIndex].solution}</p>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .resume-pages {
    background: #37383f;
  }

  .resume-page {
    flex: none;
    background: white;
    box-shadow: 0 4px 20px rgb(0 0 0 / 22%);
  }

  .resume-page canvas {
    display: block;
  }

  .resume-text-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    line-height: 1;
    text-size-adjust: none;
    transform-origin: 0 0;
    z-index: 1;
  }

  .resume-text-layer :global(span),
  .resume-text-layer :global(br) {
    position: absolute;
    color: transparent;
    white-space: pre;
    transform-origin: 0 0;
  }

  .resume-mark {
    position: absolute;
    z-index: 2;
    border: 0;
    border-radius: 3px;
    padding: 0;
    background: rgb(255 35 35 / 55%);
    cursor: pointer;
  }

  .resume-mark.active {
    background: rgb(137 232 79 / 55%);
  }

  .resume-mark:focus-visible {
    outline: 2px solid #218a31;
    outline-offset: 1px;
  }

  .solution-popover {
    position: absolute;
    z-index: 3;
    width: min(280px, calc(100% - 16px));
    border-radius: 10px;
    padding: 10px 12px;
    background: #8be65b;
    color: #17210f;
    box-shadow: 0 4px 14px rgb(0 0 0 / 20%);
    pointer-events: none;
  }

</style>

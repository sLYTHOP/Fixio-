<script>
  import { afterUpdate, onDestroy, onMount, tick } from 'svelte'

  export let file
  export let issues = []
  export let items = []
  export let activeIssue = null

  const markColors = {
    red: 'rgb(255 35 35 / 55%)',
    orange: 'rgb(255 157 35 / 58%)',
    green: 'rgb(40 180 85 / 48%)',
  }

  function getMarkColor(color) {
    return markColors[color] ?? markColors.orange
  }

  function getIssueColor(issue) {
    if (issue.kind === 'error' || issue.kind === 'missing' || (!issue.kind && issue.excerpt === null)) return 'red'
    return issue.color === 'red' ? 'red' : 'orange'
  }

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

  function mergeAdjacentMarks(marks) {
    const mergedMarks = []

    for (const mark of marks) {
      const markCenter = mark.top + mark.height / 2
      const adjacentMark = mergedMarks.find((candidate) => {
        if (
          candidate.issueIndex !== mark.issueIndex ||
          candidate.itemIndex !== mark.itemIndex ||
          candidate.pageNumber !== mark.pageNumber
        ) return false
        const candidateCenter = candidate.top + candidate.height / 2
        const sameLine = Math.abs(candidateCenter - markCenter) <= Math.min(candidate.height, mark.height) * 0.5
        const touchesHorizontally = mark.left <= candidate.left + candidate.width + 3
          && mark.left + mark.width >= candidate.left - 3
        return sameLine && touchesHorizontally
      })

      if (adjacentMark) {
        const left = Math.min(adjacentMark.left, mark.left)
        const top = Math.min(adjacentMark.top, mark.top)
        const right = Math.max(adjacentMark.left + adjacentMark.width, mark.left + mark.width)
        const bottom = Math.max(adjacentMark.top + adjacentMark.height, mark.top + mark.height)
        Object.assign(adjacentMark, { left, top, width: right - left, height: bottom - top })
      } else {
        mergedMarks.push({ ...mark })
      }
    }

    return mergedMarks
  }

  function removeOverlappingMarks(marks) {
    const colorPriority = { red: 0, orange: 1, green: 2 }
    const sortedMarks = [...marks].sort((a, b) =>
      (colorPriority[a.color] ?? 1) - (colorPriority[b.color] ?? 1) ||
      Number(a.issueIndex === null) - Number(b.issueIndex === null) ||
      a.width * a.height - b.width * b.height
    )
    const visibleMarks = []

    for (const mark of sortedMarks) {
      let fragments = [{ ...mark }]
      for (const existing of visibleMarks) {
        if (existing.pageNumber !== mark.pageNumber) continue
        fragments = fragments.flatMap((fragment) => {
          const left = Math.max(fragment.left, existing.left)
          const top = Math.max(fragment.top, existing.top)
          const right = Math.min(fragment.left + fragment.width, existing.left + existing.width)
          const bottom = Math.min(fragment.top + fragment.height, existing.top + existing.height)
          if (right - left <= 0.5 || bottom - top <= 0.5) return [fragment]

          const pieces = [
            { left: fragment.left, top: fragment.top, width: fragment.width, height: top - fragment.top },
            { left: fragment.left, top: bottom, width: fragment.width, height: fragment.top + fragment.height - bottom },
            { left: fragment.left, top, width: left - fragment.left, height: bottom - top },
            { left: right, top, width: fragment.left + fragment.width - right, height: bottom - top },
          ]
          return pieces
            .filter((piece) => piece.width > 0.5 && piece.height > 0.5)
            .map((piece) => ({ ...fragment, ...piece }))
        })
        if (!fragments.length) break
      }
      visibleMarks.push(...fragments)
    }

    return visibleMarks
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
      items.forEach((item, itemIndex) => {
        if (!item.excerpt) return
        findItemIndexes(textLayer.textContentItemsStr, item.excerpt).forEach((itemTextIndex) => {
          const textDiv = textLayer.textDivs[itemTextIndex]
          if (!textDiv) return
          const rect = textDiv.getBoundingClientRect()
          if (!rect.width || !rect.height) return
          nextMarks.push({
            itemIndex,
            issueIndex: null,
            color: item.color ?? (item.verdict === 'relevant' ? 'green' : 'orange'),
            pageNumber: page.number,
            left: rect.left - pageRect.left,
            top: rect.top - pageRect.top + rect.height * 0.1,
            width: rect.width,
            height: rect.height * 0.8,
          })
        })
      })
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
            itemIndex: null,
            color: getIssueColor(issue),
            pageNumber: page.number,
            left: rect.left - pageRect.left,
            top: rect.top - pageRect.top + rect.height * 0.1,
            width: rect.width,
            height: rect.height * 0.8,
          })
        })
      })
    }

    if (generation === renderGeneration) {
      marks = removeOverlappingMarks(mergeAdjacentMarks(nextMarks))
      const matchedIssues = new Set(nextMarks.filter((mark) => mark.issueIndex !== null).map((mark) => mark.issueIndex))
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
  <div class="resume-preview-header flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style="border-color: var(--line);">
    <div>
      <p class="resume-preview-title font-display font-semibold">Your resume</p>
      <div class="resume-mark-legend" aria-label="Resume review colors">
        <span><i class="legend-dot red"></i>Missing / incorrect</span>
        <span><i class="legend-dot orange"></i>Needs strengthening</span>
        <span><i class="legend-dot green"></i>Role-relevant</span>
      </div>
    </div>
    <a
      href={fileUrl}
      target="_blank"
      rel="noreferrer"
      class="resume-preview-original font-semibold underline underline-offset-4"
      style="color: var(--accent, var(--lime));"
    >
      Open original
    </a>
  </div>

  {#if loadError}
    <p class="p-5 text-sm" style="color: var(--ink-soft);">
      {loadError}
      <a href={fileUrl} target="_blank" rel="noreferrer" class="ml-1 font-semibold underline" style="color: var(--accent, var(--lime));">Open PDF</a>
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
            {#if mark.issueIndex !== null}
              <button
                type="button"
                class:active={visibleIssue === mark.issueIndex}
                class="resume-mark"
                style="left: {mark.left}px; top: {mark.top}px; width: {mark.width}px; height: {mark.height}px; background: {getMarkColor(mark.color)};"
                aria-label="Issue in {issues[mark.issueIndex].section}: {issues[mark.issueIndex].issue}. Suggested fix: {issues[mark.issueIndex].solution}"
                aria-pressed={activeIssue === mark.issueIndex}
                on:mouseenter={() => (hoveredIssue = mark.issueIndex)}
                on:mouseleave={() => (hoveredIssue = null)}
                on:focus={() => (hoveredIssue = mark.issueIndex)}
                on:blur={() => (hoveredIssue = null)}
                on:click={() => (activeIssue = activeIssue === mark.issueIndex ? null : mark.issueIndex)}
              ></button>
            {:else}
              <span
                class="resume-item-mark"
                style="left: {mark.left}px; top: {mark.top}px; width: {mark.width}px; height: {mark.height}px; background: {getMarkColor(mark.color)};"
                aria-hidden="true"
              ></span>
            {/if}
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
    background: var(--resume-canvas, #37383f);
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

  .resume-mark-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    margin-top: 6px;
    color: var(--ink-soft);
    font-size: 11px;
  }

  .resume-mark-legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .legend-dot.red { background: #e52323; }
  .legend-dot.orange { background: #e98a12; }
  .legend-dot.green { background: #218a31; }

  .resume-mark {
    position: absolute;
    z-index: 3;
    border: 0;
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
  }

  .resume-mark.active {
    filter: saturate(1.35);
  }

  .resume-item-mark {
    position: absolute;
    z-index: 2;
    border-radius: 3px;
    pointer-events: none;
  }

  .resume-mark:focus-visible {
    outline: 2px solid var(--accent, #218a31);
    outline-offset: 1px;
  }

  .solution-popover {
    position: absolute;
    z-index: 3;
    width: min(280px, calc(100% - 16px));
    border: 1px solid var(--line, transparent);
    border-radius: 10px;
    padding: 10px 12px;
    background: var(--surface, #8be65b);
    color: var(--ink, #17210f);
    box-shadow: 0 4px 14px rgb(0 0 0 / 20%);
    pointer-events: none;
  }

  @media (min-width: 1100px) {
    .resume-preview-header {
      padding: 16px 20px;
    }

    .resume-preview-title {
      font-size: 16px;
    }

    .resume-preview-original {
      font-size: 13px;
    }
  }

</style>

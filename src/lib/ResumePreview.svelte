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
    if (issue.color !== undefined && issue.color !== null) {
      return issue.color === 'red' ? 'red' : 'orange'
    }
    if (issue.kind === 'error' || issue.kind === 'missing' || (!issue.kind && issue.excerpt === null)) return 'red'
    return 'orange'
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
  let loggedUnmatchedExcerpts = new Set()
  let lastCoverageLog = ''

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

  function findTextMatches(items, query) {
    const normalizedQuery = normalizeText(query)
    if (!normalizedQuery) return []

    let normalizedText = ''
    const positions = []
    items.forEach((item, itemIndex) => {
      let rawOffset = 0
      for (const rawCharacter of item) {
        const start = rawOffset
        rawOffset += rawCharacter.length
        for (const character of rawCharacter.normalize('NFKC').toLowerCase()) {
          if (/[\p{L}\p{N}]/u.test(character)) {
            normalizedText += character
            positions.push({ itemIndex, start, end: rawOffset })
          } else if (normalizedText && !normalizedText.endsWith(' ')) {
            normalizedText += ' '
            positions.push({ itemIndex, start, end: rawOffset })
          }
        }
      }
      if (normalizedText && !normalizedText.endsWith(' ')) {
        normalizedText += ' '
        positions.push(null)
      }
    })

    const start = normalizedText.indexOf(normalizedQuery)
    if (start < 0) return []
    const end = start + normalizedQuery.length
    const rangesByItem = new Map()
    for (const position of positions.slice(start, end)) {
      if (!position) continue
      const current = rangesByItem.get(position.itemIndex)
      if (current) {
        current.start = Math.min(current.start, position.start)
        current.end = Math.max(current.end, position.end)
      } else {
        rangesByItem.set(position.itemIndex, { ...position })
      }
    }
    return [...rangesByItem].map(([itemIndex, range]) => ({ itemIndex, ...range }))
  }

  function getTextRects(textDiv, start, end) {
    const textNodes = []
    const walker = document.createTreeWalker(textDiv, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) textNodes.push(walker.currentNode)

    const range = document.createRange()
    let offset = 0
    let rangeStart = null
    let rangeEnd = null
    for (const node of textNodes) {
      const nodeEnd = offset + node.textContent.length
      if (rangeStart === null && start < nodeEnd) {
        rangeStart = { node, offset: Math.max(0, start - offset) }
      }
      if (end <= nodeEnd) {
        rangeEnd = { node, offset: Math.max(0, end - offset) }
        break
      }
      offset = nodeEnd
    }
    if (!rangeStart || !rangeEnd) return []

    range.setStart(rangeStart.node, rangeStart.offset)
    range.setEnd(rangeEnd.node, rangeEnd.offset)
    return [...range.getClientRects()]
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
        const touchesHorizontally = mark.left <= candidate.left + candidate.width
          && mark.left + mark.width >= candidate.left
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
    const matchedItemExcerpts = new Set()
    const matchedIssueExcerpts = new Set()
    const coveredCharacters = new Set()
    let totalResumeCharacters = 0

    function recordCoverage(pageNumber, itemIndex, start, end) {
      for (let characterIndex = start; characterIndex < end; characterIndex++) {
        coveredCharacters.add(`${pageNumber}:${itemIndex}:${characterIndex}`)
      }
    }

    function addTextMarks({ textLayer, pageRect, pageNumber, matches, color, issueIndex, itemIndex }) {
      matches.forEach((match) => {
        const textDiv = textLayer.textDivs[match.itemIndex]
        if (!textDiv) return
        const rects = getTextRects(textDiv, match.start, match.end)
        rects.forEach((rect) => {
          if (!rect.width || !rect.height) return
          nextMarks.push({
            itemIndex,
            textItemIndex: match.itemIndex,
            issueIndex,
            color,
            pageNumber,
            left: rect.left - pageRect.left,
            top: rect.top - pageRect.top + rect.height * 0.1,
            width: rect.width,
            height: rect.height * 0.8,
          })
        })
        if (rects.some((rect) => rect.width && rect.height)) {
          recordCoverage(pageNumber, match.itemIndex, match.start, match.end)
        }
      })
    }

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
      totalResumeCharacters += textLayer.textContentItemsStr.reduce((total, text) => total + text.length, 0)
      items.forEach((item, itemIndex) => {
        if (!item.excerpt) return
        const matches = findTextMatches(textLayer.textContentItemsStr, item.excerpt)
        if (matches.length) {
          matchedItemExcerpts.add(itemIndex)
          addTextMarks({
            textLayer,
            pageRect,
            pageNumber: page.number,
            matches,
            color: item.color ?? (item.verdict === 'relevant' ? 'green' : 'orange'),
            issueIndex: null,
            itemIndex,
          })
        }
      })
      issues.forEach((issue, issueIndex) => {
        const excerptMatches = issue.excerpt
          ? findTextMatches(textLayer.textContentItemsStr, issue.excerpt)
          : []
        if (excerptMatches.length) matchedIssueExcerpts.add(issueIndex)
        const matches = excerptMatches.length
          ? excerptMatches
          : findTextMatches(textLayer.textContentItemsStr, issue.section)
        addTextMarks({
          textLayer,
          pageRect,
          pageNumber: page.number,
          matches,
          color: getIssueColor(issue),
          issueIndex,
          itemIndex: null,
        })
      })
    }

    if (generation === renderGeneration) {
      marks = removeOverlappingMarks(mergeAdjacentMarks(nextMarks))
      items.forEach((item, index) => {
        if (!item.excerpt || matchedItemExcerpts.has(index)) return
        const key = `item:${index}:${item.excerpt}`
        if (loggedUnmatchedExcerpts.has(key)) return
        loggedUnmatchedExcerpts.add(key)
        console.warn('[ResumePreview] no PDF text match for item excerpt', { index, excerpt: item.excerpt })
      })
      issues.forEach((issue, index) => {
        if (!issue.excerpt || matchedIssueExcerpts.has(index)) return
        const key = `issue:${index}:${issue.excerpt}`
        if (loggedUnmatchedExcerpts.has(key)) return
        loggedUnmatchedExcerpts.add(key)
        console.warn('[ResumePreview] no PDF text match for issue excerpt', { index, excerpt: issue.excerpt })
      })
      if (issues.some((_, index) => !nextMarks.some((mark) => mark.issueIndex === index))) {
        highlightWarning = 'Some sections could not be matched to selectable text in this PDF. Every finding and solution is still listed alongside the preview.'
      } else {
        highlightWarning = ''
      }
      const coverage = totalResumeCharacters
        ? `${((coveredCharacters.size / totalResumeCharacters) * 100).toFixed(1)}% (${coveredCharacters.size}/${totalResumeCharacters} characters)`
        : '0% (0/0 characters)'
      if (coverage !== lastCoverageLog) {
        console.info(`[ResumePreview] resume text covered by marks: ${coverage}`)
        lastCoverageLog = coverage
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

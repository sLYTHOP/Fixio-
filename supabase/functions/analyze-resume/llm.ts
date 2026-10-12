// Model calls for analyze-resume. Two providers, same prompt, same output shape.

export type CallOpts = {
  apiKey: string
  model: string
  systemPrompt: string
  userText: string
  pdfBase64: string
}
export type LlmResult = { ok: true; text: string } | { ok: false; reason: string }
type FetchFn = typeof fetch

export type Feedback = {
  strengths: string[]
  gaps: string[]
  suggestions: string[]
  vagueBullets: { original: string; suggestion: string }[]
}

// ---------- Claude ----------

export async function callClaude(o: CallOpts, fetchFn: FetchFn = fetch): Promise<LlmResult> {
  const res = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": o.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: o.model,
      max_tokens: 1500,
      system: o.systemPrompt,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: o.pdfBase64 } },
          { type: "text", text: o.userText },
        ],
      }],
    }),
  })
  if (!res.ok) {
    console.error("Claude API error:", res.status, await res.text())
    return { ok: false, reason: "llm_error" }
  }
  const data = await res.json()
  const block = data.content?.find((b: { type: string }) => b.type === "text")
  if (!block?.text) {
    console.error("Claude returned no text")
    return { ok: false, reason: "llm_empty" }
  }
  return { ok: true, text: block.text }
}

// ---------- Gemini ----------

export function buildGeminiBody(o: Pick<CallOpts, "systemPrompt" | "userText" | "pdfBase64">) {
  return {
    systemInstruction: { parts: [{ text: o.systemPrompt }] },
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "application/pdf", data: o.pdfBase64 } },
        { text: o.userText },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json", // asks Gemini for raw JSON, fewer parse errors
      maxOutputTokens: 6000,                // headroom in case the model spends tokens thinking
      temperature: 0.3,
    },
  }
}

export function extractGeminiText(data: any): string | null {
  const parts = data?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return null
  const text = parts.map((p: any) => p?.text ?? "").join("")
  return text.trim() ? text : null
}

export async function callGemini(o: CallOpts, fetchFn: FetchFn = fetch): Promise<LlmResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent`
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "x-goog-api-key": o.apiKey, "content-type": "application/json" },
    body: JSON.stringify(buildGeminiBody(o)),
  })
  if (!res.ok) {
    // Typical causes: wrong model name (404), bad key (400/403), free-tier quota (429).
    console.error(`Gemini API error (model ${o.model}):`, res.status, await res.text())
    return { ok: false, reason: "llm_error" }
  }
  const data = await res.json()
  const text = extractGeminiText(data)
  if (!text) {
    console.error("Gemini returned no text:", JSON.stringify({
      finishReason: data?.candidates?.[0]?.finishReason,
      promptFeedback: data?.promptFeedback,
    }))
    return { ok: false, reason: "llm_empty" }
  }
  return { ok: true, text }
}

// ---------- Output handling (provider independent) ----------

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : []

// Parses model text into the exact shape the frontend expects. A model that
// leaves out a field must never crash the results page.
export function parseFeedback(text: string): Feedback | null {
  let raw: any
  try {
    raw = JSON.parse(text.replace(/```json|```/g, "").trim())
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object") return null

  const vague = Array.isArray(raw.vagueBullets) ? raw.vagueBullets : []
  const out: Feedback = {
    strengths: strList(raw.strengths),
    gaps: strList(raw.gaps),
    suggestions: strList(raw.suggestions),
    vagueBullets: vague
      .filter((b: any) => b && typeof b.original === "string" && typeof b.suggestion === "string")
      .slice(0, 2)
      .map((b: any) => ({ original: b.original, suggestion: b.suggestion })),
  }
  // An answer with nothing in any list is a failed answer, not feedback.
  if (!out.strengths.length && !out.gaps.length && !out.suggestions.length) return null
  return out
}

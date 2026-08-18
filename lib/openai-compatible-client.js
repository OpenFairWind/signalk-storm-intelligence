'use strict'

const crypto = require('node:crypto')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function trimSlash(value) { return String(value || '').replace(/\/+$/, '') }
function joinUrl(base, path) { return `${trimSlash(base)}/${String(path || '').replace(/^\/+/, '')}` }

function extractResponsesText(body) {
  if (typeof body?.output_text === 'string' && body.output_text.trim()) return body.output_text
  for (const item of body?.output || []) {
    if (item?.type !== 'message') continue
    for (const content of item.content || []) {
      if (content?.type === 'refusal') throw new Error(`LLM refusal: ${content.refusal || 'request refused'}`)
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text
      if (typeof content?.text === 'string') return content.text
    }
  }
  throw new Error('OpenAI-compatible Responses API returned no output text')
}

function extractChatText(body) {
  const message = body?.choices?.[0]?.message
  if (message?.refusal) throw new Error(`LLM refusal: ${message.refusal}`)
  const content = message?.content
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const text = content.map(x => typeof x === 'string' ? x : x?.text || '').join('').trim()
    if (text) return text
  }
  throw new Error('OpenAI-compatible Chat Completions API returned no output text')
}

function parseJsonText(text) {
  const raw = String(text || '').trim()
  try { return JSON.parse(raw) } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return JSON.parse(fenced[1])
  const first = raw.indexOf('{'), last = raw.lastIndexOf('}')
  if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1))
  throw new Error('LLM response is not valid JSON')
}

function requestFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

class OpenAICompatibleClient {
  constructor(options = {}) {
    this.baseUrl = trimSlash(options.baseUrl || 'https://api.openai.com/v1')
    this.protocol = options.protocol === 'chat-completions' ? 'chat-completions' : 'responses'
    this.model = String(options.model || '').trim()
    this.apiKeyEnv = String(options.apiKeyEnv || 'OPENAI_API_KEY').trim()
    this.apiKeyHeader = String(options.apiKeyHeader || 'Authorization').trim()
    this.apiKeyPrefix = options.apiKeyPrefix == null ? 'Bearer ' : String(options.apiKeyPrefix)
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000)
    this.maxRetries = Math.max(0, Math.min(5, options.maxRetries == null ? 1 : Number(options.maxRetries)))
    this.maxOutputTokens = Math.max(128, Number(options.maxOutputTokens) || 1200)
    this.disableStorage = options.disableStorage !== false
    this.fetch = options.fetch || globalThis.fetch
    this.extraHeaders = options.extraHeaders && typeof options.extraHeaders === 'object' ? { ...options.extraHeaders } : {}
    if (!this.model) throw new Error('OpenAI-compatible LLM model is required')
    if (typeof this.fetch !== 'function') throw new Error('fetch is unavailable')
  }

  endpoint() { return joinUrl(this.baseUrl, this.protocol === 'responses' ? 'responses' : 'chat/completions') }

  headers() {
    const headers = { 'content-type': 'application/json', accept: 'application/json', ...this.extraHeaders }
    const key = this.apiKeyEnv ? process.env[this.apiKeyEnv] : ''
    if (key) headers[this.apiKeyHeader] = `${this.apiKeyPrefix}${key}`
    return headers
  }

  buildRequest({ instructions, input, schema, schemaName = 'storm_intelligence_assessment' }) {
    if (this.protocol === 'responses') {
      return {
        model: this.model,
        instructions,
        input,
        max_output_tokens: this.maxOutputTokens,
        ...(this.disableStorage ? { store: false } : {}),
        text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } }
      }
    }
    return {
      model: this.model,
      messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }],
      max_completion_tokens: this.maxOutputTokens,
      response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }
    }
  }

  async structured({ instructions, input, schema, schemaName }) {
    const payload = this.buildRequest({ instructions, input, schema, schemaName })
    const fingerprint = requestFingerprint({ protocol: this.protocol, model: this.model, payload })
    let lastError
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(new Error('LLM request timeout')), this.timeoutMs)
      const started = Date.now()
      try {
        const response = await this.fetch(this.endpoint(), { method: 'POST', headers: this.headers(), body: JSON.stringify(payload), signal: controller.signal })
        const requestId = response.headers?.get?.('x-request-id') || response.headers?.get?.('request-id') || null
        const text = await response.text()
        let body
        try { body = text ? JSON.parse(text) : {} } catch { body = { raw: text } }
        if (!response.ok) {
          const message = body?.error?.message || body?.message || `HTTP ${response.status}`
          const error = new Error(`OpenAI-compatible LLM HTTP ${response.status}: ${message}`)
          error.status = response.status
          error.retryAfter = response.headers?.get?.('retry-after')
          throw error
        }
        const outputText = this.protocol === 'responses' ? extractResponsesText(body) : extractChatText(body)
        const data = parseJsonText(outputText)
        return {
          data,
          provenance: {
            protocol: this.protocol,
            baseUrl: this.baseUrl,
            model: body?.model || this.model,
            responseId: body?.id || null,
            requestId,
            usage: body?.usage || null,
            latencyMs: Date.now() - started,
            requestFingerprint: fingerprint
          }
        }
      } catch (error) {
        lastError = error
        const status = Number(error?.status)
        const retryable = error?.name === 'AbortError' || !status || status === 408 || status === 409 || status === 429 || status >= 500
        if (!retryable || attempt >= this.maxRetries) break
        const retryAfterSec = Number(error?.retryAfter)
        const delay = Number.isFinite(retryAfterSec) ? Math.min(10000, retryAfterSec * 1000) : Math.min(5000, 250 * (2 ** attempt))
        await sleep(delay)
      } finally { clearTimeout(timeout) }
    }
    throw lastError || new Error('OpenAI-compatible LLM request failed')
  }
}

module.exports = { OpenAICompatibleClient, extractResponsesText, extractChatText, parseJsonText, requestFingerprint }

/* Minimal framework-neutral client for Signal K Plotter Extensions API v1. */
(() => {
  'use strict'
  const BUS = 'plotterExt/1'
  class PlotterBus {
    constructor () {
      this.seq = 1
      this.pending = new Map()
      this.listeners = new Map()
      this.capabilities = []
      this.context = null
      this.host = null
      this._ready = null
      this._resolveReady = null
      this._timer = null
      window.addEventListener('message', e => this._onMessage(e))
    }
    connect (timeoutMs = 8000) {
      if (this._ready) return this._ready
      this._ready = new Promise((resolve, reject) => {
        this._resolveReady = resolve
        const started = Date.now()
        const ping = () => {
          if (this.host) return
          if (Date.now() - started > timeoutMs) {
            clearInterval(this._timer)
            this._timer = null
            reject(new Error('Plotter extension host handshake timed out'))
            return
          }
          this._post({ jsonrpc: '2.0', method: 'bus.ready', params: {} })
        }
        ping()
        this._timer = setInterval(ping, 300)
      })
      return this._ready
    }
    has (capability) { return this.capabilities.includes(capability) }
    async call (method, params) {
      await this.connect()
      const id = `${Date.now().toString(36)}-${this.seq++}`
      const msg = { jsonrpc: '2.0', id, method }
      if (params !== undefined) msg.params = params
      const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
      this._post(msg)
      return p
    }
    async subscribe (patterns, handler) {
      const result = await this.call('events.subscribe', { patterns })
      for (const p of patterns) this.listeners.set(p, handler)
      return result
    }
    _post (msg) { window.parent.postMessage({ bus: BUS, msg }, window.location.origin) }
    _onMessage (event) {
      if (event.source !== window.parent || event.origin !== window.location.origin) return
      const env = event.data
      if (!env || env.bus !== BUS || !env.msg) return
      const msg = env.msg
      if (msg.method === 'bus.handshake') {
        const h = msg.params || msg.result || {}
        this.host = h.host || 'plotter'
        this.capabilities = Array.isArray(h.capabilities) ? h.capabilities : []
        this.context = h.context || null
        if (this._timer) clearInterval(this._timer)
        this._timer = null
        this._resolveReady?.(h)
        return
      }
      if (msg.id != null && this.pending.has(String(msg.id))) {
        const p = this.pending.get(String(msg.id)); this.pending.delete(String(msg.id))
        if (msg.error) {
          const e = new Error(msg.error.message || 'Plotter host call failed')
          e.data = msg.error.data
          p.reject(e)
        } else p.resolve(msg.result)
        return
      }
      if (msg.method && !('id' in msg)) {
        for (const [pattern, handler] of this.listeners) {
          if (this._matches(pattern, msg.method)) handler(msg.method, msg.params)
        }
      }
    }
    _matches (pattern, name) {
      const p = pattern.split('.'), n = name.split('.')
      for (let i = 0, j = 0; i < p.length; i++, j++) {
        if (p[i] === '**') return true
        if (j >= n.length || (p[i] !== '*' && p[i] !== n[j])) return false
        if (i === p.length - 1) return j === n.length - 1
      }
      return p.length === n.length
    }
  }
  window.SignalKPlotterBus = PlotterBus
})()

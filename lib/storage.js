'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')

function safeName(s) { return String(s).replace(/[^A-Za-z0-9_.-]+/g, '_') }

class RecyclingStorage {
  constructor(root, options = {}) {
    this.root = root
    this.enabled = options.enabled !== false
    this.maxBytes = Math.max(0, Number(options.maxBytes) || 0)
    this.maxAgeMs = Math.max(0, Number(options.maxAgeMs) || 0)
  }

  async init() { if (this.enabled) await fs.mkdir(this.root, { recursive: true }) }

  productDir(product) { return path.join(this.root, safeName(product)) }
  filePath(product, epochMs, ext = '.bin') { return path.join(this.productDir(product), `${Number(epochMs)}${ext.startsWith('.') ? ext : `.${ext}`}`) }

  async put(product, epochMs, data, ext = '.bin') {
    if (!this.enabled) return null
    const dir = this.productDir(product)
    await fs.mkdir(dir, { recursive: true })
    const target = this.filePath(product, epochMs, ext)
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(temp, data)
    await fs.rename(temp, target)
    await this.recycle()
    return target
  }

  async has(product, epochMs, ext = '.bin') {
    try { await fs.access(this.filePath(product, epochMs, ext)); return true } catch { return false }
  }

  async get(product, epochMs, ext = '.bin') { return fs.readFile(this.filePath(product, epochMs, ext)) }

  async list() {
    if (!this.enabled) return []
    const out = []
    let products = []
    try { products = await fs.readdir(this.root, { withFileTypes: true }) } catch { return [] }
    for (const p of products) {
      if (!p.isDirectory()) continue
      const dir = path.join(this.root, p.name)
      const files = await fs.readdir(dir, { withFileTypes: true })
      for (const f of files) {
        if (!f.isFile() || f.name.includes('.tmp-')) continue
        const full = path.join(dir, f.name)
        const st = await fs.stat(full)
        out.push({ product: p.name, name: f.name, path: full, size: st.size, mtimeMs: st.mtimeMs })
      }
    }
    return out.sort((a, b) => a.mtimeMs - b.mtimeMs)
  }

  async recycle(now = Date.now()) {
    if (!this.enabled) return { removed: 0, bytes: 0 }
    let files = await this.list()
    let removed = 0, bytes = 0
    if (this.maxAgeMs > 0) {
      for (const f of files) if (now - f.mtimeMs > this.maxAgeMs) {
        try { await fs.unlink(f.path); removed++; bytes += f.size } catch {}
      }
      files = await this.list()
    }
    if (this.maxBytes > 0) {
      let total = files.reduce((s, f) => s + f.size, 0)
      for (const f of files) {
        if (total <= this.maxBytes) break
        try { await fs.unlink(f.path); total -= f.size; removed++; bytes += f.size } catch {}
      }
    }
    return { removed, bytes }
  }

  async stats() {
    const files = await this.list()
    return { enabled: this.enabled, files: files.length, bytes: files.reduce((s, f) => s + f.size, 0), root: this.root }
  }
}
module.exports = { RecyclingStorage }

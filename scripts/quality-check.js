'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.md', '.html', '.css'])
const failures = []

function fail(message) {
  failures.push(message)
}

function walk(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

function checkJson(file) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`${relative(file)}: invalid JSON (${error.message})`)
  }
}

function checkWhitespace(file, text) {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/[ \t]+$/.test(lines[i])) fail(`${relative(file)}:${i + 1}: trailing whitespace`)
  }
  if (text.length && !text.endsWith('\n')) fail(`${relative(file)}: missing final newline`)
}

function checkMarkdownLinks(file, text) {
  const link = /\[[^\]]*\]\(([^)]+)\)/g
  let match
  while ((match = link.exec(text))) {
    let target = match[1].trim()
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    target = target.split('#')[0].split('?')[0]
    if (!target) continue
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target))
    if (!fs.existsSync(resolved)) fail(`${relative(file)}: broken relative link ${match[1]}`)
  }
}

function checkSecretMaterial(file, text) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    fail(`${relative(file)}: contains private-key material`)
  }
  if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(text)) {
    fail(`${relative(file)}: contains an API-key-like token`)
  }
}

function jpegDimensions(data) {
  let offset = 2
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) { offset++; continue }
    const marker = data[offset + 1], length = data.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xc3) return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) }
    if (length < 2) break
    offset += 2 + length
  }
  return null
}

function checkStoreImage(file, minimumWidth, minimumHeight, maximumBytes) {
  if (!fs.existsSync(file)) return fail(`missing store image: ${relative(file)}`)
  const data = fs.readFileSync(file)
  let dimensions = null
  if (data.length >= 24 && data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') dimensions = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  else if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) dimensions = jpegDimensions(data)
  if (!dimensions) return fail(`${relative(file)}: expected a valid PNG or JPEG`)
  const { width, height } = dimensions
  if (width < minimumWidth || height < minimumHeight) fail(`${relative(file)}: expected at least ${minimumWidth}x${minimumHeight}, got ${width}x${height}`)
  if (maximumBytes && data.length > maximumBytes) fail(`${relative(file)}: exceeds ${Math.round(maximumBytes / 1024)} KB store guidance`)
}

const files = walk(ROOT)
for (const file of files) {
  const ext = path.extname(file)
  if (ext === '.json') checkJson(file)
  if (!TEXT_EXTENSIONS.has(ext)) continue
  const text = fs.readFileSync(file, 'utf8')
  checkWhitespace(file, text)
  checkSecretMaterial(file, text)
  if (ext === '.md') checkMarkdownLinks(file, text)
}

for (const required of ['AGENTS.md', 'README.md', 'CHANGELOG.md', 'docs/README.md', 'docs/reproducibility.md', 'docs/reproducibility-manifest.schema.json', '.github/workflows/plugin-ci.yml']) {
  if (!fs.existsSync(path.join(ROOT, required))) fail(`missing required repository artifact: ${required}`)
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const { PACKAGE_VERSION, USER_AGENT } = require('../lib/version')
if (PACKAGE_VERSION !== pkg.version) fail(`package version ${pkg.version} != runtime version ${PACKAGE_VERSION}`)
if (USER_AGENT !== `signalk-storm-intelligence/${pkg.version}`) fail(`unexpected runtime user agent ${USER_AGENT}`)
const index = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')
if (!index.includes("version: PACKAGE_VERSION")) fail('plugin/OpenAPI version must derive from PACKAGE_VERSION')
if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes('signalk-node-server-plugin')) fail('package keywords missing signalk-node-server-plugin')
if (!pkg.keywords.includes('signalk-webapp')) fail('package keywords missing signalk-webapp')
if (!pkg.keywords.includes('signalk-category-weather')) fail('package keywords missing signalk-category-weather')
if (!pkg.keywords.includes('signalk-category-chart-plotters')) fail('package keywords missing signalk-category-chart-plotters')
if (!pkg.description || pkg.description.length < 50 || pkg.description.length > 250) fail('package description must be a concise 50-250 character store summary')
if (!pkg.author) fail('package author is required for App Store attribution')
if (!pkg.repository?.url || !pkg.homepage || !pkg.bugs?.url) fail('package discovery links must include repository, homepage and bugs')
for (const name of ['preinstall', 'install', 'postinstall']) if (pkg.scripts?.[name]) fail(`App Store cannot run lifecycle script: ${name}`)
if (!Array.isArray(pkg.files)) fail('package files publish manifest is required')
for (const document of ['README.md', 'CHANGELOG.md']) {
  if (!pkg.files?.includes(document)) fail(`package files publish manifest must include root ${document}`)
}

const iconPath = path.resolve(ROOT, pkg.signalk?.appIcon || '')
const webappIconPath = path.resolve(ROOT, 'public', pkg.signalk?.appIcon || '')
if (!pkg.signalk?.displayName) fail('signalk.displayName is required')
if (!pkg.signalk?.appIcon || !fs.existsSync(iconPath)) fail('signalk.appIcon must reference a published icon')
else {
  checkStoreImage(iconPath, 128, 128, 500 * 1024)
  const icon = fs.readFileSync(iconPath)
  if (icon.readUInt32BE(16) !== icon.readUInt32BE(20)) fail('store icon must be square')
}
if (!pkg.signalk?.appIcon || !fs.existsSync(webappIconPath)) fail('signalk.appIcon must also resolve relative to public for the Webapps dashboard')
else if (fs.existsSync(iconPath) && !fs.readFileSync(iconPath).equals(fs.readFileSync(webappIconPath))) fail('App Store and Webapps dashboard icons must be identical')

if (!Array.isArray(pkg.signalk?.screenshots) || pkg.signalk.screenshots.length < 1 || pkg.signalk.screenshots.length > 6) fail('signalk.screenshots must contain 1-6 package-relative images')
for (const screenshot of pkg.signalk?.screenshots || []) checkStoreImage(path.resolve(ROOT, screenshot), 1280, 800, 500 * 1024)

const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
if (!new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')}(?:\\s+-.*)?$`, 'm').test(changelog)) fail(`CHANGELOG.md missing release heading for ${pkg.version}`)
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/plugin-ci.yml'), 'utf8')
if (!workflow.includes('SignalK/signalk-server/.github/workflows/plugin-ci.yml@master')) fail('plugin CI must call the canonical Signal K reusable workflow')

if (failures.length) {
  console.error(`Repository quality check failed with ${failures.length} issue(s):`)
  for (const item of failures) console.error(`- ${item}`)
  process.exit(1)
}

console.log(`Repository quality check passed (${files.length} files inspected).`)

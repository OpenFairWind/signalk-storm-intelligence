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

for (const required of ['AGENTS.md', 'README.md', 'docs/README.md', 'docs/reproducibility.md', 'docs/reproducibility-manifest.schema.json']) {
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

if (failures.length) {
  console.error(`Repository quality check failed with ${failures.length} issue(s):`)
  for (const item of failures) console.error(`- ${item}`)
  process.exit(1)
}

console.log(`Repository quality check passed (${files.length} files inspected).`)

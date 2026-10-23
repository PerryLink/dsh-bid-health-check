#!/usr/bin/env node
// Machine enforcement of the rule every pack states in its own header: an
// excerpt must be a verbatim quotation, so it has to be findable in this
// repository's own rules/evidence/ record of what was obtained.
//
// Segments are split on the ellipsis, because legal citation joins two
// non-adjacent passages of the same document that way - the ellipsis is a
// declared gap and each segment on either side must still be verbatim.
//
// rules/citations-baseline.json records what is not traceable today. The gate
// fails on a new untraceable segment, and also on a baseline entry that has
// become traceable, so the baseline can only ever shrink.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const rulesDir = path.join(root, 'rules')
const evidenceDir = path.join(rulesDir, 'evidence')
const baselinePath = path.join(rulesDir, 'citations-baseline.json')

// Discover the pack instead of deriving its name from the package: the family
// convention is "package name minus dsh-", but not every pack follows it
// (dsh-nurse-record-check ships rules/nurse-record.yaml).
const packPath = readdirSync(rulesDir)
  .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
  .map((f) => path.join(rulesDir, f))
  .sort()[0]
if (packPath === undefined) {
  console.error('citations: no rule pack found under rules/')
  process.exit(2)
}

const normalise = (text) =>
  text
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。、；：？！“”‘’（）《》〈〉【】·—…*#`~,.;:?!"'()<>[\]\-_/\\|]/g, '')

const isPlaceholder = (excerpt) => /未取得|不伪造|待填写|占位/.test(excerpt)
const keyOf = (ruleId, segment) =>
  `${ruleId}:${createHash('sha256').update(normalise(segment)).digest('hex').slice(0, 12)}`

const segmentsOf = (excerpt) =>
  excerpt
    .split(/…+|\.{3,}|。。。+/)
    .map((s) => s.trim())
    .filter((s) => normalise(s).length >= 8)

function ruleBlocks(text) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  let cur = null
  for (const line of lines) {
    if (/^\s*-\s+id:\s/.test(line)) {
      if (cur) blocks.push(cur)
      cur = [line]
    } else if (cur) cur.push(line)
  }
  if (cur) blocks.push(cur)
  return blocks.map((b) => b.join('\n'))
}
const fieldOf = (block, name) => {
  const m = new RegExp(`^\\s+${name}:\\s*(.*)$`, 'm').exec(block)
  return m ? m[1].trim() : ''
}

let haystack = ''
if (existsSync(evidenceDir)) {
  // A record whose name says the text was NOT obtained must not count as the
  // place the text was found. Such a file quotes an excerpt in order to discuss
  // it, and accepting that as provenance would let a blocked citation clear the
  // gate on the strength of the very document declaring it blocked.
  for (const file of readdirSync(evidenceDir).filter(
    (f) => f.endsWith('.md') && !/blocked|unobtained/i.test(f),
  )) {
    haystack += readFileSync(path.join(evidenceDir, file), 'utf8')
  }
}
const H = normalise(haystack)

const untraceable = []
let checked = 0
let placeholders = 0
for (const block of ruleBlocks(readFileSync(packPath, 'utf8'))) {
  // The id line is "  - id: XX-001", so the list dash sits between the
  // indentation and the key; a plain "^s+id:" never matches it.
  const ruleId = (/^\s*-\s+id:\s*(\S+)/m.exec(block) ?? [])[1] ?? '?'
  // Every excerpt field counts: the primary basis AND each alsoBasis entry.
  const excerpts = [...block.matchAll(/^\s+excerpt:\s*(.*)$/gm)].map((m) => m[1].trim())
  if (excerpts.length === 0) {
    placeholders++
    continue
  }
  for (const excerpt of excerpts) {
    if (excerpt === '' || isPlaceholder(excerpt)) {
      placeholders++
      continue
    }
    for (const segment of segmentsOf(excerpt)) {
      checked++
      if (!H.includes(normalise(segment))) untraceable.push(keyOf(ruleId, segment))
    }
  }
}

const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8')).untraceable ?? []
  : []
const baselineSet = new Set(baseline)
const current = new Set(untraceable)

const added = untraceable.filter((k) => !baselineSet.has(k))
const stale = baseline.filter((k) => !current.has(k))

console.log(`citations: ${checked} segments checked, ${placeholders} placeholders, ${untraceable.length} untraceable, baseline ${baseline.length}`)

if (added.length > 0) {
  console.error('')
  console.error('NEW untraceable excerpts - quote them verbatim in rules/evidence/ first:')
  for (const k of added) console.error(`  ${k}`)
}
if (stale.length > 0) {
  console.error('')
  console.error('baseline entries that are now traceable - regenerate rules/citations-baseline.json:')
  for (const k of stale) console.error(`  ${k}`)
}
if (added.length > 0 || stale.length > 0) process.exit(1)
console.log('citations ok: every quotation is accounted for')

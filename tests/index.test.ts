/**
 * Bid health: locating a bid's response to each requirement.
 *
 * The two behaviours worth defending:
 *
 *  - "Not located" is never presented as "missing". A bid may answer in a table, an
 *    appendix, or different words, and the tool can only report what it found.
 *  - A rejection clause is a condition the bidder must meet, not a sentence to
 *    answer, so it can never be scored `responded` — only `weak`, with the reason.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ingestDocx } from 'dsh-table-ingest/api'
import { BidHealthError, check, commonRun, readPack, readPackYaml, termsOf } from '../src/model.ts'
import { renderMarkdown } from '../src/report.ts'

const HERE = import.meta.dirname
const fixture = (name: string): Buffer => readFileSync(join(HERE, 'fixtures', name))

const pack = readPack(readFileSync(join(HERE, 'fixtures/pack.json'), 'utf8'))
const paragraphs = ingestDocx(fixture('bid-sample.docx'), 'bid-sample.docx').paragraphs
const result = check(pack.requirements, paragraphs)

describe('common substring', () => {
  it('measures the longest shared run', () => {
    expect(commonRun('投标保证金', '我方已缴纳投标保证金人民币')).toBe(5)
    expect(commonRun('完全无关', '我方已缴纳')).toBe(0)
  })
})

describe('terms', () => {
  it('drops a requirement label down to its stem', () => {
    expect(termsOf('密封要求')).toContain('密封')
  })

  it('never returns a one-character term', () => {
    for (const term of termsOf('的 和 与 投标')) expect(term.length).toBeGreaterThanOrEqual(2)
  })
})

describe('pack reading', () => {
  it('rejects an empty pack instead of grading every bid against nothing', () => {
    expect(() => readPack(JSON.stringify({ items: [] }))).toThrow(BidHealthError)
    expect(() => readPack('not json')).toThrow(/不是合法 JSON/)
  })

  it('accepts the YAML form', () => {
    const yaml = 'items:\n  - id: X-1\n    category: composition\n    title: 投标函\n    quote: 投标函\n    tier: A\n'
    expect(readPackYaml(yaml).requirements).toHaveLength(1)
  })
})

describe('check', () => {
  it('marks queue-C requirements as blocked by the pack, not by the bid', () => {
    const blocked = result.items.filter((item) => item.tier === 'C')
    expect(blocked.length).toBeGreaterThan(0)
    for (const item of blocked) {
      expect(item.reason).toContain('采购文件')
      expect(item.health).toBe('not-located')
    }
  })

  it('never scores a rejection clause as responded', () => {
    const clauses = result.items.filter((item) => item.category === 'reject-clause')
    expect(clauses.length).toBeGreaterThan(0)
    for (const clause of clauses) {
      expect(clause.health, `${clause.id} 被当成有响应`).not.toBe('responded')
    }
  })

  it('finds the bid paragraph that states the deposit', () => {
    const deposit = result.items.find((item) => item.title === '投标保证金')
    expect(deposit?.health).toBe('responded')
    expect(deposit?.evidence).toContain('缴')
  })

  it('prefers the body paragraph over the heading that repeats the label', () => {
    const deposit = result.items.find((item) => item.title === '投标保证金')
    expect(deposit?.evidence).not.toMatch(/^第.{1,3}章/u)
  })

  it('says not-located is not missing', () => {
    const missing = result.items.filter((item) => item.health === 'not-located' && item.tier !== 'C')
    expect(missing.length).toBeGreaterThan(0)
    for (const item of missing) {
      expect(item.reason).toContain('不等于没响应')
    }
  })

  it('counts the three states so they add up to the pack size', () => {
    const { responded, weak, notLocated } = result.summary
    expect(responded + weak + notLocated).toBe(result.requirements)
  })
})

describe('report', () => {
  it('leads with the warning that not-located is not missing', () => {
    const markdown = renderMarkdown(result, 'pack.json', 'bid.docx')
    expect(markdown).toContain('「定位不到」不等于「没写」')
    expect(markdown.indexOf('定位不到')).toBeLessThan(markdown.indexOf('## 边界'))
  })

  it('says it cannot read tables, scans or attachments', () => {
    const markdown = renderMarkdown(result, 'pack.json', 'bid.docx')
    expect(markdown).toContain('读不了表格、扫描件与附件')
  })
})

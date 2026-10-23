/**
 * Regression test: the engine's length, range and per-group checks are **inclusive at the boundary**.
 *
 * 《民法典》第一千二百五十九条 fixes the convention for civil-law documents — 「以上」「以下」「以内」
 * include the stated figure, while 「不满」「超过」「以外」 exclude it. So when a rule's threshold comes
 * from a civil-law source, 「恰好等于上限」 must pass and only "beyond the limit" may be reported.
 *
 * The user-facing assertion lives in each affected plugin's rule note; this file pins the *behaviour*,
 * so a later refactor cannot quietly flip a comparison from `>` to `>=`.
 */

import { describe, expect, it } from 'vitest'
import { loadRuleset } from '../src/shared/ruleset.ts'
import { runTableCheck } from '../src/shared/rows.ts'
import type { Issue } from '../src/shared/report.ts'
import type { Ruleset } from '../src/shared/rules.ts'
import type { Row, TableInput } from '../src/shared/rows.ts'

const BASIS = [
  '      document: 《中华人民共和国民法典》',
  '      number: 第一千二百五十九条',
  '      clause: 附则——「以上」「以下」「以内」「届满」包括本数；「不满」「超过」「以外」不包括本数',
  '      excerpt: 民法所称的"以上"、"以下"、"以内"、"届满"，包括本数；所称的"不满"、"超过"、"以外"，不包括本数。',
  '      kind: direct',
  '      source: https://www.spp.gov.cn/',
].join('\n')

/** Build a one-rule ruleset whose single rule carries the given check. */
function probe(checkLines: readonly string[]): Ruleset {
  const yaml = [
    'plugin: boundary-probe',
    'version: "2026.1"',
    'rules:',
    '  - id: B-001',
    '    title: 边界探针',
    '    severity: warn',
    '    basis:',
    BASIS,
    '    params:',
    '      check:',
    ...checkLines.map((line: string) => `        ${line}`),
    '    note: >-',
    '      边界探针。',
    'disabled: []',
    '',
  ].join('\n')
  return loadRuleset(yaml)
}

function run(checkLines: readonly string[], rows: readonly Row[], columns: readonly string[]): Issue[] {
  const ruleset = probe(checkLines)
  // The column-level guard reads the header as well as the rows, so the header must carry the
  // field names — otherwise every check reports itself as skipped and the test passes vacuously.
  // Mark them with an empty string, not a placeholder: `valueOf` falls back to the header, so a
  // placeholder value would shadow the row's actual value and silently invert the assertion.
  const header = Object.fromEntries(columns.map((column: string) => [column, ''])) as Record<string, string>
  const input: TableInput = { target: 'probe', header, columns: [...columns], rows: [...rows], warnings: [] }
  const report = runTableCheck(input, ruleset, {
    plugin: 'boundary-probe',
    checkedAt: '2026-10-07T00:00:00.000Z',
    disabledRules: [],
    onlyRules: [],
  })
  // An `Issue` carries `ruleId` (the bare rule id) plus a composite `id`; filter on `ruleId`.
  const issues = report.issues.filter((issue) => issue.ruleId === 'B-001')
  // A check that never ran proves nothing about the boundary, so fail loudly — but distinguish the
  // two kinds of skip. "材料中没有…" and "…未发现差异" mean the check ran and this material simply
  // does not exercise the boundary; a missing parameter or an unknown check kind means the rule
  // itself is misconfigured and the assertion would be vacuous.
  const RAN = [/材料中没有/, /材料没有/, /未发现差异/, /材料满足该检查的前置条件/]
  const broken = report.skipped.filter(
    (entry) => entry.rule === 'B-001' && !RAN.some((pattern) => pattern.test(entry.reason)),
  )
  expect(broken, `check could not run: ${broken.map((entry) => entry.reason).join('; ')}`).toHaveLength(0)
  return issues
}

const row = (value: string, field = 'text'): Row => ({ row: 1, fields: { [field]: value } })

describe('boundary semantics', () => {
  it('passes a length exactly at maxLength and reports one character over', () => {
    const check = ['kind: length', 'field: text', 'maxLength: 5']
    expect(run(check, [row('ABCDE')], ['text'])).toHaveLength(0)
    expect(run(check, [row('ABCDEF')], ['text'])).toHaveLength(1)
  })

  it('treats a numeric range as inclusive at both ends', () => {
    const check = ['kind: number', 'field: text', 'min: 0', 'max: 1']
    expect(run(check, [row('1')], ['text'])).toHaveLength(0)
    expect(run(check, [row('0')], ['text'])).toHaveLength(0)
    expect(run(check, [row('1.01')], ['text'])).toHaveLength(1)
    expect(run(check, [row('-0.01')], ['text'])).toHaveLength(1)
  })

  // A per-group maximum is deliberately *not* asserted here: the `countPerGroup` check supports
  // `minRows`, not `max`. The per-day ceiling in `dsh-site-log-check` comes from a different
  // check kind, so pinning a behaviour that does not exist would be a false guarantee.
})

describe('threshold semantics: 「达到」 means inclusive', () => {
  const trigger = ['kind: thresholdPresence', 'triggerField: text', 'requiredField: note', 'threshold: 9']

  it('triggers at exactly the threshold, not only above it', () => {
    // 达到 9 分 must require the follow-up field; that is what the rule notes promise.
    const atThreshold = [{ row: 1, fields: { text: '9' } }]
    expect(run(trigger, atThreshold, ['text', 'note'])).toHaveLength(1)
    const above = [{ row: 1, fields: { text: '10' } }]
    expect(run(trigger, above, ['text', 'note'])).toHaveLength(1)
  })

  it('does not trigger one step below the threshold', () => {
    const below = [{ row: 1, fields: { text: '8' } }]
    expect(run(trigger, below, ['text', 'note'])).toHaveLength(0)
  })

  it('reports a value below the acceptance threshold as out of criterion', () => {
    // `thresholdBelow` states the criterion as a floor, so equality satisfies it.
    const check = ['kind: thresholdBelow', 'field: text', 'threshold: 40']
    expect(run(check, [row('40')], ['text'])).toHaveLength(0)
    expect(run(check, [row('41')], ['text'])).toHaveLength(0)
    expect(run(check, [row('39.9')], ['text'])).toHaveLength(1)
  })
})

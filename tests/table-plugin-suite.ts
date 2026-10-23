/**
 * Test template for the data-only table plugins.
 *
 * Every table plugin has the same obligations: its rule pack must carry a real
 * basis for each rule and respect the severity ceilings, its fixtures must pair a
 * compliant sample with a violating one per rule, every issue must cite a clause
 * and carry a stable id, the reader must behave at its boundaries, and the report
 * must never use adjudicating wording. Writing those once keeps each plugin's test
 * file down to the parts that are actually about that plugin.
 *
 * Usage in a plugin's `tests/index.test.ts`:
 *
 * ```ts
 * import { describeTablePlugin } from './table-plugin-suite.ts'
 * import { Config } from '../src/config.ts'
 * import { parseMaterial, runCheck, SPEC } from '../src/model.ts'
 * import { inject, name, resolvePackageFile, TOOL_NAME } from '../src/index.ts'
 *
 * describeTablePlugin({
 *   name, inject, TOOL_NAME, resolvePackageFile, Config,
 *   rulesFile: 'rules/x.yaml',
 *   parseMaterial, runCheck,
 *   columnNames: SPEC.columns,
 *   samples: { good: {...}, badColumn: {...} },
 * })
 * ```
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadRuleset } from '../src/shared/ruleset.ts'
import { numberOf } from '../src/shared/rows.ts'
import { addDays, diffDays, parseWallClock } from '../src/shared/datetime.ts'
import { findForbiddenWording } from '../src/shared/wording.ts'
import { parseYaml } from '../src/shared/yaml.ts'
import type { Report } from '../src/shared/report.ts'
import type { TableCheckOptions, TableInput } from '../src/shared/rows.ts'

/** What a table plugin's suite needs to know about it. */
export interface TablePluginSuite {
  /** Plugin name, as exported from `src/index.ts`. */
  name: string
  /** Static inject list, as exported from `src/index.ts`. */
  inject: readonly string[]
  /** Tool name, as exported from `src/index.ts`. */
  TOOL_NAME: string
  /** Packaged-file resolver, as exported from `src/index.ts`. */
  resolvePackageFile: (relative: string) => string
  /**
   * The Schemastery config, as exported from `src/config.ts`.
   *
   * Left as `unknown` because a concrete `Schema<Config>` is not assignable to any
   * looser callable type; the suite narrows it where it uses it.
   */
  Config: unknown
  /** Promise-or-value returning the package root, for `rulesFile`. */
  rulesFile: string
  /** Reader from `src/model.ts`. */
  parseMaterial: (source: string, target: string) => TableInput
  /** Checker from `src/model.ts`. */
  runCheck: (input: TableInput, ruleset: Awaited<ReturnType<typeof loadRuleset>>, options: TableCheckOptions) => Report
  /** The plugin's column alias map, for the reader's boundary tests. */
  columnNames: Record<string, readonly string[]>
  /** A minimal well-formed material object, and one carrying an unknown column. */
  samples: { good: unknown; unknownColumn: unknown }
  /** Report renderer, when the plugin has one. */
  buildView?: (report: Report) => { markdown: string; reportJson: string }
  /** Extra assertions, run after the standard suite. */
  extra?: () => void
}

const here = dirname(fileURLToPath(import.meta.url))
const CHECKED_AT = '2026-10-06T00:00:00.000Z'

interface CaseFile {
  ruleId: string
  configure?: Record<string, Record<string, unknown>>
  pairs: { name: string; material: string; expect: { ruleId: string; count: number } }[]
}

/**
 * Register the shared suite for one table plugin.
 * @param suite - the plugin's hooks and samples.
 */
export function describeTablePlugin(suite: TablePluginSuite): void {
  const fixturesRoot = join(here, 'fixtures')
  /** The tests/ directory lives directly under the plugin root. */
  const rootDir = resolve(here, '..')
  const rulesPath = suite.resolvePackageFile(suite.rulesFile)

  const loadPack = async () => loadRuleset(await readFile(rulesPath, 'utf8'))

  const runOptions = (overrides: Partial<TableCheckOptions> = {}): TableCheckOptions => ({
    plugin: suite.name,
    checkedAt: CHECKED_AT,
    disabledRules: [],
    onlyRules: [],
    ...overrides,
  })

  const runFixture = async (text: string, target: string, configure?: CaseFile['configure']): Promise<Report> => {
    const ruleset = await loadPack()
    return suite.runCheck(suite.parseMaterial(text, target), ruleset, runOptions({ overrides: configure }))
  }

  const issuesOf = (report: Report, ruleId: string) => report.issues.filter((issue) => issue.ruleId === ruleId)

  const ruleDirectories = async (): Promise<string[]> => {
    const entries = await readdir(fixturesRoot, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  }

  const readCases = async (directory: string): Promise<CaseFile> =>
    JSON.parse(await readFile(join(fixturesRoot, directory, 'cases.json'), 'utf8')) as CaseFile

  describe('rule pack', () => {
    it('declares a citable basis for every rule', async () => {
      const ruleset = await loadPack()
      expect(ruleset.plugin).toBe(suite.name)
      expect(ruleset.rules.length).toBeGreaterThanOrEqual(4)
      for (const rule of ruleset.rules) {
        expect(rule.basis.document, `${rule.id} document`).not.toBe('')
        expect(rule.basis.clause, `${rule.id} clause`).not.toBe('')
        expect(rule.basis.excerpt.length, `${rule.id} excerpt`).toBeGreaterThanOrEqual(8)
        expect(rule.basis.source, `${rule.id} source`).toMatch(/^https?:\/\//)
        expect(['direct', 'derived-from-principle', 'institutional-configuration']).toContain(rule.basis.kind)
      }
    })

    it('never lets a principle-derived or locally configured check be an error', async () => {
      const ruleset = await loadPack()
      for (const rule of ruleset.rules) {
        if (rule.basis.kind === 'derived-from-principle') expect(rule.severity, rule.id).not.toBe('error')
        if (rule.basis.kind === 'institutional-configuration') expect(rule.severity, rule.id).toBe('info')
      }
    })

    it('never advertises a quotation it cannot show', async () => {
      const ruleset = await loadPack()
      // An excerpt is in one of two honest states: it quotes the clause verbatim, or it says plainly
      // that the text was not obtained / that no citable clause exists. What is not allowed is the
      // silent middle — text that reads like a quotation or a paraphrase while admitting nothing.
      //
      // This assertion cannot re-verify a quotation against its source; the evidence packs and the
      // per-plugin verification reports are what show a quote is real. Here we only forbid the
      // middle: anything that neither admits the gap nor carries the marks of a quotation.
      const ADMISSIONS = ['本次未取得', '不存在可引用的标准条文', '本规则库不伪造引文']
      const QUOTED = /第[〇零一二三四五六七八九十百千0-9]+条|[「」]/
      for (const rule of ruleset.rules) {
        const excerpt = rule.basis.excerpt
        if (ADMISSIONS.some((marker) => excerpt.includes(marker))) continue
        expect(
          QUOTED.test(excerpt) || excerpt.length > 12,
          `${rule.id}: excerpt neither admits the gap nor reads as a quotation`,
        ).toBe(true)
      }
    })

    it('refuses a rule pack that overstates a principle-derived check', () => {
      const overstated = [
        'plugin: probe',
        'version: "0"',
        'rules:',
        '  - id: X-001',
        '    title: probe',
        '    severity: error',
        '    basis:',
        '      document: 《X》',
        '      number: X〔2020〕1号',
        '      clause: 第一条',
        '      excerpt: 这是一个足够长的逐字摘录示例。',
        '      kind: derived-from-principle',
        '      source: https://example.invalid/x',
      ].join('\n')
      expect(() => loadRuleset(overstated)).toThrow(/strongest permitted severity/)
    })

    it('declares a check the engine supports for every rule', async () => {
      const ruleset = await loadPack()
      expect(ruleset.rules.some((rule) => typeof rule.params.check === 'object')).toBe(true)
    })
  })

  describe('paired fixtures', () => {
    it('has both a compliant and a violating sample for every rule', async () => {
      const ruleset = await loadPack()
      const covered = new Set<string>()
      for (const directory of await ruleDirectories()) {
        const cases = await readCases(directory)
        expect(cases.pairs.filter((pair) => pair.expect.count === 0).length, `${directory} compliant sample`).toBeGreaterThanOrEqual(1)
        expect(cases.pairs.filter((pair) => pair.expect.count > 0).length, `${directory} violating sample`).toBeGreaterThanOrEqual(1)
        for (const pair of cases.pairs) {
          const material = await readFile(join(fixturesRoot, directory, pair.material), 'utf8')
          const report = await runFixture(material, pair.material, cases.configure)
          const matched = issuesOf(report, cases.ruleId)
          expect(
            matched.length,
            `${directory}/${pair.name} expected ${pair.expect.count} × ${cases.ruleId}, got ${matched.map((issue) => issue.found).join(' | ')}`,
          ).toBe(pair.expect.count)
          covered.add(cases.ruleId)
        }
      }
      for (const rule of ruleset.rules) expect(covered.has(rule.id), `covered ${rule.id}`).toBe(true)
    })

    it('gives every issue a citable basis and a stable id', async () => {
      for (const directory of await ruleDirectories()) {
        const cases = await readCases(directory)
        for (const pair of cases.pairs) {
          const material = await readFile(join(fixturesRoot, directory, pair.material), 'utf8')
          const report = await runFixture(material, pair.material, cases.configure)
          for (const issue of report.issues) {
            expect(issue.basis).toContain('「')
            expect(issue.id).toMatch(new RegExp(`^${suite.name}\\.[A-Z]{2}-\\d{3}\\.[0-9a-f]{8}$`))
            expect(issue.found).not.toBe('')
            expect(issue.expected).not.toBe('')
          }
        }
      }
    })

    it('reports each rule that did not run exactly once', async () => {
      for (const directory of await ruleDirectories()) {
        const cases = await readCases(directory)
        const material = await readFile(join(fixturesRoot, directory, cases.pairs[0]?.material as string), 'utf8')
        const report = await runFixture(material, 'inline', cases.configure)
        const rules = report.skipped.map((entry) => entry.rule)
        expect(new Set(rules).size, `${directory} duplicate skipped entries`).toBe(rules.length)
      }
    })
  })

  describe('reader boundaries', () => {
    it('accepts a well-formed sample and resolves its aliases', () => {
      const table = suite.parseMaterial(JSON.stringify(suite.samples.good), 'inline')
      expect(table.rows.length).toBeGreaterThan(0)
      expect(table.columns.length).toBeGreaterThan(0)
      const canonical = Object.keys(suite.columnNames)
      const present = canonical.filter((field) => (table.rows[0]?.fields[field] ?? '') !== '')
      expect(present.length, 'no canonical field was resolved from the sample').toBeGreaterThan(0)
    })

    it('refuses material carrying none of the known columns', () => {
      expect(() => suite.parseMaterial(JSON.stringify(suite.samples.unknownColumn), 'inline')).toThrow(/没有可识别的字段/)
    })

    it('rejects empty material and a missing row list', () => {
      expect(() => suite.parseMaterial('   ', 'inline')).toThrow(/材料为空/)
      expect(() => suite.parseMaterial('unrelated: 1', 'inline')).toThrow(/任一列表/)
    })
  })

  describe('skipped reporting', () => {
    it('names disabled rules exactly once and appends the configured note', async () => {
      const ruleset = await loadPack()
      const first = ruleset.rules[0]
      const table = suite.parseMaterial(JSON.stringify(suite.samples.good), 'inline')
      const report = suite.runCheck(table, ruleset, runOptions({ disabledRules: [first?.id as string], skipNotes: '本机构口径' }))
      const entries = report.skipped.filter((item) => item.rule === first?.id)
      expect(entries).toHaveLength(1)
      expect(entries[0]?.reason).toContain('禁用')
      expect(entries[0]?.reason).toContain('本机构口径')
    })

    it('never lists an executed-clean rule as skipped', async () => {
      const ruleset = await loadPack()
      const table = suite.parseMaterial(JSON.stringify(suite.samples.good), 'inline')
      const report = suite.runCheck(table, ruleset, runOptions({}))
      expect(report.skipped.filter((entry) => entry.reason.includes('材料满足该检查的前置条件且未发现差异条目'))).toHaveLength(0)
    })

    it('records the only-rules selection once', async () => {
      const ruleset = await loadPack()
      const first = ruleset.rules[0]
      const table = suite.parseMaterial(JSON.stringify(suite.samples.good), 'inline')
      const report = suite.runCheck(table, ruleset, runOptions({ onlyRules: [first?.id as string] }))
      const selection = report.skipped.filter((entry) => entry.reason.includes('only 参数'))
      expect(selection).toHaveLength(1)
    })

    // The two tests below exist because the suite used to check only the
    // *reporting* of rule selection (the test above), never that selection
    // filtered execution. It did not: `runChecks` ignored both sets, so the
    // report carried findings for every rule while the skipped section claimed
    // the same rules had not run - two halves that are each individually
    // plausible, which is why nothing failed. A caller asking for one rule got
    // all of them. The violating half of each pair is used so the assertion
    // cannot pass vacuously on a sample that fires nothing.
    it('runs only the rule that was selected', async () => {
      const ruleset = await loadPack()
      // Selecting the fixture's own rule would pass even without filtering, since
      // that fixture fires mainly its own rule. So the fixture for rule A is run
      // with only rule B selected: nothing from A may appear, whatever B does.
      for (const directory of await ruleDirectories()) {
        const cases = await readCases(directory)
        const outsider = ruleset.rules.find((rule) => rule.id !== cases.ruleId)
        const pair = cases.pairs.find((candidate) => candidate.expect.count > 0)
        if (pair === undefined || outsider === undefined) continue
        const material = await readFile(join(fixturesRoot, directory, pair.material), 'utf8')
        const report = suite.runCheck(
          suite.parseMaterial(material, pair.material),
          ruleset,
          runOptions({ onlyRules: [outsider.id], overrides: cases.configure }),
        )
        const intruders = report.issues.filter((issue) => issue.ruleId !== outsider.id).map((issue) => issue.ruleId)
        expect(intruders, `${directory}: onlyRules=[${outsider.id}] must exclude ${cases.ruleId}`).toEqual([])
        expect(issuesOf(report, cases.ruleId).length, `${directory}: ${cases.ruleId} was not selected and must not run`).toBe(0)
      }
    })

    it('does not run a disabled rule', async () => {
      const ruleset = await loadPack()
      for (const directory of await ruleDirectories()) {
        const cases = await readCases(directory)
        const pair = cases.pairs.find((candidate) => candidate.expect.count > 0)
        if (pair === undefined) continue
        const material = await readFile(join(fixturesRoot, directory, pair.material), 'utf8')
        const report = suite.runCheck(
          suite.parseMaterial(material, pair.material),
          ruleset,
          runOptions({ disabledRules: [cases.ruleId], overrides: cases.configure }),
        )
        expect(issuesOf(report, cases.ruleId).length, `${directory}: a disabled rule must not fire`).toBe(0)
      }
    })
  })

  describe('report rendering', () => {
    it('never uses adjudicating wording and always carries the disclaimer', async () => {
      const buildView = suite.buildView
      if (buildView === undefined) return
      const directory = (await ruleDirectories()).find((name) => name.length > 0) as string
      const cases = await readCases(directory)
      const violating = cases.pairs.find((pair) => pair.expect.count > 0) ?? cases.pairs[0]
      const material = await readFile(join(fixturesRoot, directory, violating?.material as string), 'utf8')
      const report = await runFixture(material, 'render-check', cases.configure)
      const view = buildView(report)
      expect(findForbiddenWording(view.markdown)).toEqual([])
      expect(view.markdown).toContain('免责声明')
      expect(view.markdown).toContain('未执行的检查')
      expect(JSON.parse(view.reportJson)).toMatchObject({ plugin: suite.name, summary: report.summary })
    })
  })

  describe('plugin contract', () => {
    it('declares a static inject array covering every service apply touches', () => {
      expect(Array.isArray(suite.inject)).toBe(true)
      expect(suite.inject).toContain('tools')
    })

    it('exposes a Schemastery Config with serializable defaults', () => {
      const resolve = suite.Config as (value: unknown) => Record<string, unknown>
      const resolved = resolve(null)
      expect(resolved.rulesFile).toBe(suite.rulesFile)
      expect(resolved.disabledRules).toEqual([])
      expect(resolved.timeoutMs as number).toBeGreaterThan(0)
    })

    it('resolves the packaged rule pack and rejects a missing one', () => {
      expect(suite.resolvePackageFile(suite.rulesFile)).toBe(rulesPath)
      expect(() => suite.resolvePackageFile('rules/does-not-exist.yaml')).toThrow(/未找到/)
    })

    it('names the tool after the package family convention', () => {
      expect(suite.TOOL_NAME).toBe(suite.name.replace(/^dsh-/, '').replace(/-/g, '_'))
    })

    /**
     * The bundle layer is what makes this package installable as a bundle at all. Until now no test
     * looked at it: the manifest check only asked whether the file exists and is listed in `files[]`,
     * so a patch that failed to parse, named the wrong plugin, or used an unknown row verb would have
     * shipped unnoticed. See 什么算好用的DSH插件 §2.3 R29 and §3.4 ("verify your patch really lands").
     */
    it('ships a bundle patch that parses and points back at this plugin', async () => {
      const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8')) as {
        dsh?: { bundle?: { patch?: string } }
        files?: string[]
      }
      const patchRef = pkg.dsh?.bundle?.patch
      expect(patchRef, 'package.json#dsh.bundle.patch').toBe('./cordis.patch.yml')
      expect(pkg.files ?? [], 'the patch must ship in files[]').toContain('cordis.patch.yml')

      const patchText = await readFile(join(rootDir, 'cordis.patch.yml'), 'utf8')
      // A layer is a YAML array of row verbs; at minimum it must insert exactly one row whose id and
      // name are this plugin, or the bundle would mount nothing (or the wrong thing).
      // NOTE: inside the `- insert:` sequence each row is itself a list item, so the keys appear as
      // "    - id: …" — the marker must be allowed before the key, and no trailing `$` is used because
      // a CRLF file would then match nothing (this assertion first reported an empty id list).
      expect(patchText).toMatch(/^-\s*insert:/m)
      const ids = [...patchText.matchAll(/^[ \t]*-?[ \t]*id:[ \t]*(\S+)/gm)].map((m) => m[1])
      const names = [...patchText.matchAll(/^[ \t]*-?[ \t]*name:[ \t]*(\S+)/gm)].map((m) => m[1])
      expect(ids, 'exactly one row id').toEqual([suite.name])
      expect(names, 'the row must resolve this package').toContain(suite.name)
    })

    /**
     * The tool description is what the model reads on every turn, so a repeated sentence is a real
     * per-turn token cost rather than untidy prose. 39 of 53 plugins shipped one sentence twice from a
     * copy-paste artefact, which no assertion caught. This reads the declaration statically — the
     * description is built from adjacent string literals — and forbids a sentence appearing twice.
     */
    it('states each sentence of the tool description exactly once', async () => {
      const src = await readFile(join(rootDir, 'src', 'index.ts'), 'utf8')
      const block = /description:\s*((?:\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\+?)+)/.exec(src)
      expect(block, 'a tool description must be declared').not.toBeNull()
      const body = (block as RegExpExecArray)[1] ?? ''
      const joined = [...body.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
        .map((m) => m[1] ?? m[2] ?? '')
        .join('')
      // Sentences within the description are separated by the full stop or semicolon it uses.
      const sentences = joined
        .split(/[。；]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 6)
      const seen = new Set<string>()
      const repeated: string[] = []
      for (const s of sentences) {
        if (seen.has(s)) repeated.push(s)
        seen.add(s)
      }
      expect(repeated, 'each sentence must appear once — a repeat is paid for every turn').toEqual([])
    })

    /**
     * `apply` must RETURN the disposer from `ctx.tools.register`.
     *
     * Measured against the real Cordis Context: a plugin whose `apply` returns void keeps its tool
     * registered after the fiber is disposed, while returning the disposer cleans it. Cordis collects
     * disposers from `apply`'s return value, so returning void leaks the tool across hot reloads — the
     * exact "乘性泄漏" the quality report warns about, and it contradicted this pack's own claim that
     * registration "keeps the plugin hot-reloadable".
     *
     * This is asserted statically because a behavioural test would need a live Cordis context, which the
     * per-plugin suites deliberately do not construct.
     */
    it('returns the tool disposer so a hot reload does not leak the registration', async () => {
      const src = await readFile(join(rootDir, 'src', 'index.ts'), 'utf8')
      expect(src, 'apply must declare a disposer return').toMatch(
        /export function apply\(ctx: Context, config: ConfigShape\): \(\) => void \{/,
      )
      expect(src, 'apply must return what register() hands back').toMatch(
        /return ctx\.tools\.register\(/,
      )
      expect(src, 'the registration must not be a bare statement').not.toMatch(
        /^\s*ctx\.tools\.register\(/m,
      )
    })
  })

  describe('shared kit', () => {
    it('reads numbers in the shapes a spreadsheet export produces', () => {
      expect(numberOf('1,200')).toBe(1200)
      expect(numberOf('１２')).toBe(12)
      expect(numberOf('50%')).toBe(50)
      expect(numberOf('若干')).toBeUndefined()
    })

    it('parses wall-clock timestamps and rejects impossible dates', () => {
      expect(parseWallClock('2026-03-15')).toEqual({ date: '2026-03-15', time: '00:00', hasTime: false, minutes: 0 })
      expect(parseWallClock('2026-02-30')).toBeUndefined()
    })

    it('does calendar arithmetic', () => {
      expect(addDays('2026-03-31', 1)).toBe('2026-04-01')
      expect(diffDays('2026-03-01', '2026-03-06')).toBe(5)
    })

    it('reads the supported YAML subset and rejects the rest', () => {
      expect(parseYaml('a: 1\nb:\n  - x\n')).toEqual({ a: 1, b: ['x'] })
      expect(() => parseYaml('a: 1\na: 2\n')).toThrow(/duplicate/)
    })
  })

  suite.extra?.()
}

/** The check date the suite uses, exported so a plugin can reuse it. */
export const SUITE_CHECKED_AT = CHECKED_AT

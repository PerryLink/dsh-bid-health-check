/**
 * Shared output contract for every `dsh-*` checker plugin.
 *
 * Two rules are non-negotiable across the whole plugin family:
 *  1. `skipped` is mandatory. A check that could not run must be named, so that
 *     "no issues found" is never silently read as "nothing is wrong".
 *  2. Reports never carry adjudicating wording (compliant / non-compliant /
 *     illegal / passed / constitutes / false invoicing). Every plugin is an
 *     assistant that points at mismatches; the professional conclusion stays
 *     with the accountable human.
 */

/** Severity ladder, from most to least urgent. */
export type Severity = 'error' | 'warn' | 'info'

/** Where in the material an issue was observed. */
export interface Locator {
  /** Source file, as given by the caller. */
  file?: string
  /** 1-based page number, when the extractor knows pagination. */
  page?: number
  /** 1-based paragraph number within the page or document. */
  para?: number
  /** Spreadsheet cell reference, e.g. `D17`. */
  cell?: string
  /** 1-based line number, for line-oriented material. */
  line?: number
  /** Row index in a tabular extract, 1-based and excluding the header. */
  row?: number
  /** Column name of a tabular extract. */
  column?: string
}

/** One finding. `found` / `expected` / `basis` are all required by design. */
export interface Issue {
  /** `<plugin>.<ruleId>.<locatorHash>` — stable id usable for allow-listing. */
  id: string
  /** Rule identifier, e.g. `GB9704-5.2.1`. */
  ruleId: string
  severity: Severity
  locator: Locator
  /** What the material actually says. */
  found: string
  /** What the cited basis asks for. */
  expected: string
  /** Standard or document number + clause + verbatim excerpt. */
  basis: string
  /** Optional concrete next action. Never a conclusion. */
  fix?: string
  /** External engine name, when the check delegated to one. */
  engine?: string
  /** External engine version, when the check delegated to one. */
  engineVersion?: string
}

/** A check that was declared by the ruleset but could not be executed. */
export interface Skipped {
  rule: string
  reason: string
}

/** The canonical value every checker tool returns. */
export interface Report {
  plugin: string
  target: string
  /** ISO 8601 timestamp of the run. */
  checkedAt: string
  summary: { error: number; warn: number; info: number }
  rulesetVersion: string
  /** Always present. Empty means every declared rule ran. */
  skipped: Skipped[]
  issues: Issue[]
}

/** Locator fields that participate in the stable issue id, in fixed order. */
const LOCATOR_ID_KEYS: readonly (keyof Locator)[] = ['file', 'page', 'para', 'line', 'row', 'cell', 'column']

/** FNV-1a 32-bit hash, rendered as 8 lowercase hex characters. */
export function hashLocator(locator: Locator): string {
  let hash = 0x811c9dc5
  for (const key of LOCATOR_ID_KEYS) {
    const value = locator[key]
    if (value === undefined) continue
    const chunk = `${key}=${String(value)};`
    for (let index = 0; index < chunk.length; index++) {
      hash ^= chunk.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }
  return hash.toString(16).padStart(8, '0')
}

/** Build an issue id that is stable for the same plugin, rule and location. */
export function issueId(plugin: string, ruleId: string, locator: Locator): string {
  return `${plugin}.${ruleId}.${hashLocator(locator)}`
}

/** Count issues per severity. */
export function summarize(issues: readonly Issue[]): Report['summary'] {
  const summary = { error: 0, warn: 0, info: 0 }
  for (const issue of issues) summary[issue.severity] += 1
  return summary
}

/** Options accepted by {@link makeReport}. */
export interface MakeReportInput {
  plugin: string
  target: string
  rulesetVersion: string
  checkedAt: string
  issues: readonly Issue[]
  skipped: readonly Skipped[]
}

/** Assemble a Report with a derived summary and a deterministic issue order. */
export function makeReport(input: MakeReportInput): Report {
  const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2 }
  const issues = [...input.issues].sort((left, right) => {
    if (rank[left.severity] !== rank[right.severity]) return rank[left.severity] - rank[right.severity]
    if (left.ruleId !== right.ruleId) return left.ruleId < right.ruleId ? -1 : 1
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
  return {
    plugin: input.plugin,
    target: input.target,
    checkedAt: input.checkedAt,
    summary: summarize(issues),
    rulesetVersion: input.rulesetVersion,
    skipped: [...input.skipped],
    issues,
  }
}

/** Canonical JSON with object keys sorted at every level (stable hashing). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2)
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value === null || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const target: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue
    target[key] = sortValue(source[key])
  }
  return target
}

/**
 * Rule-pack loading and validation.
 *
 * `loadRuleset` is the only entry point. It fails loudly rather than producing a
 * short report, and it enforces three rules that keep the family honest:
 *
 *  1. every rule carries an id, a severity and a complete citable basis;
 *  2. rule ids are unique and every requested disable names a real rule;
 *  3. a check whose basis is a general principle, or a locally configured
 *     threshold, may not be declared `error` — those are leads for human review,
 *     not statements about a violated requirement.
 */

import { YamlSubsetError, parseYaml, requireString } from './yaml.ts'
import type { Basis, BasisKind, Rule, Ruleset } from './rules.ts'
import type { Severity } from './report.ts'

const SEVERITIES: readonly Severity[] = ['error', 'warn', 'info']
const BASIS_KINDS: readonly BasisKind[] = ['direct', 'derived-from-principle', 'institutional-configuration']
const MAX_SEVERITY_BY_KIND: Record<BasisKind, Severity> = {
  direct: 'error',
  'derived-from-principle': 'warn',
  'institutional-configuration': 'info',
}

const SEVERITY_RANK: Record<Severity, number> = { error: 2, warn: 1, info: 0 }

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new YamlSubsetError(`${where}: expected a mapping`)
  }
  return value as Record<string, unknown>
}

function asStringArray(value: unknown, where: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new YamlSubsetError(`${where}: expected a sequence`)
  return value.map((entry) => {
    if (typeof entry !== 'string') throw new YamlSubsetError(`${where}: expected string entries`)
    return entry
  })
}

function parseBasis(value: unknown, where: string): Basis {
  const source = asRecord(value, where)
  const kindRaw = requireString(source, 'kind', where)
  if (!BASIS_KINDS.includes(kindRaw as BasisKind)) {
    throw new YamlSubsetError(`${where}: kind must be one of ${BASIS_KINDS.join(' / ')}`)
  }
  const basis: Basis = {
    document: requireString(source, 'document', where),
    number: typeof source.number === 'string' ? source.number : '',
    clause: requireString(source, 'clause', where),
    excerpt: requireString(source, 'excerpt', where),
    kind: kindRaw as BasisKind,
    source: requireString(source, 'source', where),
  }
  if (basis.excerpt.trim().length < 8) {
    throw new YamlSubsetError(`${where}: excerpt is too short to be a verbatim quotation`)
  }
  return basis
}

function parseRule(value: unknown, index: number): Rule {
  const where = `rules[${index}]`
  const source = asRecord(value, where)
  const id = requireString(source, 'id', where)
  const severityRaw = requireString(source, 'severity', where)
  if (!SEVERITIES.includes(severityRaw as Severity)) {
    throw new YamlSubsetError(`${where}: severity must be one of ${SEVERITIES.join(' / ')}`)
  }
  const basis = parseBasis(source.basis, `${where}.basis`)
  const severity = severityRaw as Severity
  const ceiling = MAX_SEVERITY_BY_KIND[basis.kind]
  if (SEVERITY_RANK[severity] > SEVERITY_RANK[ceiling]) {
    throw new YamlSubsetError(
      `${where} (${id}): severity "${severity}" is not allowed for a "${basis.kind}" basis; ` +
        `the strongest permitted severity is "${ceiling}"`,
    )
  }
  const rule: Rule = {
    id,
    title: requireString(source, 'title', where),
    severity,
    basis,
    params: source.params === undefined || source.params === null ? {} : asRecord(source.params, `${where}.params`),
  }
  if (source.alsoBasis !== undefined && source.alsoBasis !== null) {
    if (!Array.isArray(source.alsoBasis)) throw new YamlSubsetError(`${where}.alsoBasis: expected a sequence`)
    rule.alsoBasis = source.alsoBasis.map((entry, offset) => parseBasis(entry, `${where}.alsoBasis[${offset}]`))
  }
  if (typeof source.note === 'string') rule.note = source.note
  return rule
}

/**
 * Parse and validate a rule pack.
 * @param source - YAML text of the rule pack.
 * @returns the validated ruleset.
 */
export function loadRuleset(source: string): Ruleset {
  const root = asRecord(parseYaml(source), 'ruleset')
  const plugin = requireString(root, 'plugin', 'ruleset')
  const version = requireString(root, 'version', 'ruleset')
  const rulesRaw = root.rules
  if (!Array.isArray(rulesRaw) || rulesRaw.length === 0) {
    throw new YamlSubsetError('ruleset: "rules" must be a non-empty sequence')
  }
  const rules = rulesRaw.map((entry, index) => parseRule(entry, index))
  const seen = new Set<string>()
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new YamlSubsetError(`ruleset: duplicate rule id "${rule.id}"`)
    seen.add(rule.id)
  }
  const disabled = asStringArray(root.disabled, 'ruleset.disabled')
  for (const id of disabled) {
    if (!seen.has(id)) throw new YamlSubsetError(`ruleset.disabled: unknown rule id "${id}"`)
  }
  return { version, plugin, rules, disabled }
}

/** Look up one rule by id, throwing when the pack does not declare it. */
export function ruleById(ruleset: Ruleset, id: string): Rule {
  const rule = ruleset.rules.find((entry) => entry.id === id)
  if (rule === undefined) throw new YamlSubsetError(`ruleset: rule "${id}" is not declared`)
  return rule
}

/** Read a numeric rule parameter, falling back when absent. */
export function paramNumber(rule: Rule, key: string, fallback: number): number {
  const value = rule.params[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new YamlSubsetError(`rule ${rule.id}: params.${key} must be a number`)
  }
  return value
}

/** Read a string-list rule parameter, falling back when absent. */
export function paramStrings(rule: Rule, key: string, fallback: readonly string[]): string[] {
  const value = rule.params[key]
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new YamlSubsetError(`rule ${rule.id}: params.${key} must be a list of strings`)
  }
  return value as string[]
}

/**
 * Read a rule parameter that the rule pack deliberately left unset because the
 * value is a local policy. Fails loudly instead of inventing a default.
 * @param rule - the rule declaring the parameter.
 * @param key - parameter name.
 * @returns the configured value.
 */
export function requireConfiguredParam(rule: Rule, key: string): unknown {
  const value = rule.params[key]
  if (value === undefined || value === null || value === '') {
    throw new YamlSubsetError(
      `rule ${rule.id}: params.${key} must be filled in for this deployment; ` +
        'the rule pack ships it empty on purpose because no national threshold exists',
    )
  }
  return value
}

/** Read a parameter as a mapping of level name to positive number. */
export function paramNumberMap(rule: Rule, key: string): Record<string, number> {
  const value = rule.params[key]
  if (value === undefined || value === null) return {}
  const source = asRecord(value, `rule ${rule.id}: params.${key}`)
  const out: Record<string, number> = {}
  for (const [level, raw] of Object.entries(source)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new YamlSubsetError(`rule ${rule.id}: params.${key}.${level} must be a positive number`)
    }
    out[level] = raw
  }
  return out
}

/**
 * Rule-pack model.
 *
 * Rule data lives outside the code so that a domain expert can change what is
 * checked without touching TypeScript, and so that every check can be traced to
 * a citable clause. Two invariants are enforced by {@link ../ruleset.ts}:
 * a rule that cannot cite a verbatim clause does not load, and a check that
 * merely follows from a general principle may never be declared `error`.
 */

import type { Skipped, Severity } from './report.ts'

/**
 * How the cited basis supports the check.
 *
 * - `direct` — the clause states the checked requirement directly.
 * - `derived-from-principle` — no clause states it; the check follows from a
 *   general duty such as "objective, true, accurate, timely, complete". Reported
 *   as a lead for human review, never as an error.
 * - `institutional-configuration` — the threshold is a local rule, not a
 *   national one, and the rule pack must name the authority that set it.
 */
export type BasisKind = 'direct' | 'derived-from-principle' | 'institutional-configuration'

/** A citable normative basis. All parts are mandatory and must be verbatim. */
export interface Basis {
  /** Document title, e.g. 《病历书写基本规范》. */
  document: string
  /** Document number, e.g. 卫医政发〔2010〕11号. Empty when the document has none. */
  number: string
  /**
   * Clause reference in the source document's own numbering system,
   * e.g. `第二十二条（八）` or `七（二）4`. Never reformatted into a scheme the
   * source does not use.
   */
  clause: string
  /** Verbatim excerpt of the clause text. Never a paraphrase. */
  excerpt: string
  kind: BasisKind
  /** Where the excerpt was read, so a reviewer can re-check it. */
  source: string
}

/** One declared check. */
export interface Rule {
  /** Stable rule identifier, e.g. `NR-001`. */
  id: string
  /** Short human-readable purpose. */
  title: string
  severity: Severity
  basis: Basis
  /**
   * Additional national clauses that reinforce the same check. They are shown
   * with their own clause numbers and excerpts so a reviewer can see that the
   * requirement is stated in more than one document, and that the two
   * documents word it differently.
   */
  alsoBasis?: Basis[]
  /** Rule-specific parameters; interpreted by the check engine. */
  params: Record<string, unknown>
  /** Optional note rendered in diagnostics. */
  note?: string
}

/** A complete, versioned rule pack. */
export interface Ruleset {
  /** Rule-pack version, reported back in every Report. */
  version: string
  /** Plugin that owns this pack. */
  plugin: string
  rules: Rule[]
  /** Rule ids whose checks are declared but disabled in this version. */
  disabled: string[]
}

/**
 * Compose the one-line `basis` string rendered into reports.
 * @param basis - the rule's normative basis.
 * @param alsoBasis - additional clauses reinforcing the same check.
 * @returns document, number, clause and verbatim excerpt, plus provenance qualifiers.
 */
export function formatBasis(basis: Basis, alsoBasis: readonly Basis[] = []): string {
  const render = (entry: Basis): string => {
    const head = entry.number === '' ? entry.document : `${entry.document}（${entry.number}）`
    const qualifier =
      entry.kind === 'derived-from-principle'
        ? '［原则性条款推论，非针对本项的明文要求］'
        : entry.kind === 'institutional-configuration'
          ? '［阈值为本机构配置，非国家标准］'
          : ''
    return `${head} ${entry.clause}：「${entry.excerpt}」${qualifier}`
  }
  const parts = [render(basis), ...alsoBasis.map(render)]
  return parts.length === 1 ? (parts[0] as string) : `${parts[0] as string}；另见 ${parts.slice(1).join('；另见 ')}`
}

/**
 * Collect the skipped entries for a set of disabled rule ids.
 * @param ruleset - the declared rule pack.
 * @param disabledIds - rule ids disabled for this run, from the pack or the caller.
 * @param reason - explanation recorded for every disabled rule.
 * @returns one skipped entry per disabled rule, in pack order.
 */
export function disabledAsSkipped(ruleset: Ruleset, disabledIds: readonly string[], reason: string): Skipped[] {
  const disabled = new Set(disabledIds)
  return ruleset.rules
    .filter((rule) => disabled.has(rule.id))
    .map((rule) => ({ rule: rule.id, reason }))
}

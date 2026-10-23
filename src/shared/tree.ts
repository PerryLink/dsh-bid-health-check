/**
 * Section-tree extraction and clause locating.
 *
 * Regulatory documents, plans and reports are checked by section: "does the
 * plan contain the eight required elements, and on which page does each one
 * live?" The same problem appears in engineering archives, EIA reports, hazard
 * plans and emergency plans, so the tree builder lives here.
 */

import type { Locator } from './report.ts'

/** One heading found in a document, with its position and captured body. */
export interface SectionNode {
  /** Heading depth, 1 for a top-level heading. */
  level: number
  /** Heading text with numbering and decoration stripped for matching. */
  title: string
  /** Heading text exactly as it appeared in the source. */
  rawTitle: string
  /** Leading numbering such as `4.2.1` or `第三章`, when present. */
  numbering: string
  /** 1-based page the heading was found on, when the extractor knows pages. */
  page?: number
  /** 1-based line the heading was found on, when line-oriented. */
  line?: number
  /** Body text between this heading and the next heading of any level. */
  body: string
}

/** A requirement matched against the section tree. */
export interface SectionRequirement {
  /** Requirement id from the rule pack. */
  id: string
  /** Acceptable heading spellings; matching is by normalized containment. */
  aliases: string[]
  /** True when the requirement must be present. */
  required: boolean
  /** Optional per-requirement note for the report. */
  note?: string
}

/** Outcome of matching one requirement against a document. */
export interface SectionMatch {
  id: string
  matched: boolean
  /** The heading that satisfied the requirement, when matched. */
  node?: SectionNode
  /** Aliases that were checked but not found. */
  triedAliases: string[]
  /** True when the heading exists but its body is empty. */
  emptyBody: boolean
}

const NUMBERING = /^\s*((?:第[〇零一二三四五六七八九十百]+[章节条款部分])|(?:\d+(?:\.\d+)*)|(?:[（(]\s*[一二三四五六七八九十\d]+\s*[)）]))\s*[、.．:：]?\s*/

/**
 * Normalize a heading for comparison: drop numbering, markdown decoration,
 * whitespace, full-width punctuation spacing and case.
 * @param raw - heading text.
 * @returns the normalized title plus the numbering it carried.
 */
export function normalizeHeading(raw: string): { title: string; numbering: string } {
  let text = raw.trim()
  text = text.replace(/^#{1,6}\s*/, '')
  text = text.replace(/^\*\*(.+)\*\*$/, '$1')
  let numbering = ''
  for (;;) {
    const match = NUMBERING.exec(text)
    if (match === null) break
    numbering = numbering === '' ? (match[1] as string) : `${numbering} ${match[1] as string}`
    text = text.slice(match[0].length)
  }
  return { title: collapse(text), numbering }
}

/** Collapse whitespace and unify full-width ASCII for comparison. */
export function collapse(text: string): string {
  return text
    .replace(/[\u3000\s]+/g, '')
    .replace(/[，,]/g, '，')
    .replace(/[：:]/g, '：')
    .toLowerCase()
}

/**
 * Build a flat section tree from a list of headings.
 * @param headings - heading entries in document order.
 * @param bodyOf - callback returning the body text that follows each heading.
 * @returns the section nodes in document order.
 */
export function buildSectionTree(
  headings: readonly { raw: string; level: number; page?: number; line?: number }[],
  bodyOf: (index: number) => string,
): SectionNode[] {
  return headings.map((heading, index) => {
    const { title, numbering } = normalizeHeading(heading.raw)
    const node: SectionNode = { level: heading.level, title, rawTitle: heading.raw.trim(), numbering, body: bodyOf(index) }
    if (heading.page !== undefined) node.page = heading.page
    if (heading.line !== undefined) node.line = heading.line
    return node
  })
}

/** Locator for a section node, preferring page over line. */
export function locatorOf(node: SectionNode): Locator {
  const locator: Locator = {}
  if (node.page !== undefined) locator.page = node.page
  if (node.line !== undefined) locator.line = node.line
  return locator
}

/**
 * Match every requirement against the tree.
 *
 * An alias matches when the normalized heading contains the normalized alias,
 * or the normalized alias contains the heading. The second direction catches
 * documents that split a topic across sub-headings.
 *
 * @param tree - section nodes in document order.
 * @param requirements - requirements from the rule pack.
 * @returns one match per requirement, in declaration order.
 */
export function matchSections(tree: readonly SectionNode[], requirements: readonly SectionRequirement[]): SectionMatch[] {
  return requirements.map((requirement) => {
    const tried = requirement.aliases.map((alias) => collapse(alias))
    for (const alias of tried) {
      const node = tree.find((candidate) => candidate.title.includes(alias) || alias.includes(candidate.title))
      if (node !== undefined) {
        return { id: requirement.id, matched: true, node, triedAliases: requirement.aliases, emptyBody: node.body.trim() === '' }
      }
    }
    return { id: requirement.id, matched: false, triedAliases: requirement.aliases, emptyBody: false }
  })
}

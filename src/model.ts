/**
 * Bid health: does a bid document answer each requirement in a pack?
 *
 * The honest form of this question is narrower than "is the bid complete". The tool
 * can locate a paragraph that appears to answer a requirement, or fail to locate
 * one. It cannot know whether a located paragraph actually satisfies the
 * requirement, and it certainly cannot conclude that an unlocated requirement is
 * unanswered — the bid may answer it in a table, in an appendix, under a heading
 * that uses different words, or on a page the reader could not parse.
 *
 * So every requirement gets one of three states, and the third is not "missing":
 *
 *   responded    a distinctive term from the requirement appears in the bid
 *   weak         only a weak term matched, or the match is a heading
 *   not-located  nothing matched — the tool could not find it, which is all it means
 *
 * The report says that in as many words, because "not located" presented as
 * "missing" is how a bidder comes to rewrite a section that was already there.
 */

import { parseYaml } from './shared/yaml.ts'

/** Where a requirement landed. */
export type Health = 'responded' | 'weak' | 'not-located'

/** One requirement from the pack, as this tool reads it. */
export interface PackRequirement {
  id: string
  category: string
  title: string
  quote: string
  /** The pack's own queue; carried through so the report can group by it. */
  tier: string
}

/** A requirement paired with what the bid said, if anything. */
export interface HealthItem {
  id: string
  category: string
  tier: string
  title: string
  health: Health
  /** The bid paragraph that matched, or empty. */
  evidence: string
  /** Paragraph ordinal in the bid, 1-based; 0 when nothing matched. */
  paragraph: number
  /** The term that matched, for the reader to judge the match quality. */
  matchedTerm: string
  /** Why this verdict, in one sentence. */
  reason: string
}

/** The whole result. */
export interface HealthResult {
  packId: string
  requirements: number
  items: HealthItem[]
  summary: { responded: number; weak: number; notLocated: number }
  /** Requirements the pack put in queue C; they cannot be checked until resolved. */
  blockedByPack: number
  warnings: string[]
}

/** Raised when an input cannot be used. */
export class BidHealthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BidHealthError'
  }
}

/** Words too common to identify a requirement. */
const STOPWORDS = new Set([
  '投标', '投标人', '文件', '应当', '不得', '要求', '按照', '以及', '或者', '并且',
  '的', '了', '和', '与', '及', '或', '在', '中', '为', '对', '按', '以', '其',
])

/** Connectives that separate chunks of one requirement sentence. */
const CONNECTIVES = /[，。；：、（）()「」【】\s]|的|和|与|及|或者|并且|按照|应当|不得|按/u

/**
 * Suffixes that turn a noun into a requirement label.
 *
 * The tender writes 「密封要求」; the bid writes 「已按招标文件要求密封」. Matching the
 * label would find nothing, so the stem is what gets matched, and a stem match is
 * reported at whatever strength its length deserves.
 */
const SUFFIXES = ['要求', '规定', '条款', '事项', '内容', '资料', '情况', '标准', '条件', '办法', '措施']

/**
 * Terms that identify a requirement, longest first.
 *
 * A requirement's title is written in the tender's words, not the bidder's; the
 * match is therefore on concrete nouns and numbers rather than on the sentence.
 * Splitting on punctuation and dropping the common verbs is crude but predictable,
 * and — unlike an embedding — a reader can see exactly which term matched.
 *
 * @param text - the requirement's title and quote.
 * @returns candidate terms, longest first, at most six.
 */
export function termsOf(text: string): string[] {
  const candidates = new Set<string>()
  for (const raw of text.split(CONNECTIVES)) {
    const piece = raw.trim()
    if (piece.length < 2 || STOPWORDS.has(piece)) continue
    candidates.add(piece)
    for (const suffix of SUFFIXES) {
      if (!piece.endsWith(suffix)) continue
      const stem = piece.slice(0, -suffix.length)
      if (stem.length >= 2) candidates.add(stem)
    }
  }
  // Longer terms are more distinctive; a two-character common word matches everywhere.
  return [...candidates].sort((left, right) => right.length - left.length).slice(0, 8)
}

/**
 * Length of the longest substring the two texts share.
 *
 * Term lists produced a misleading match: the clause 「逾期送达或者未按照招标文件
 * 要求密封的投标文件，采购人…应当拒收」 shares the phrase 招标文件要求密封 with a bid
 * paragraph about sealing, so a requirement about *rejection* was scored as answered
 * by a paragraph about *sealing*. A shared substring is the same signal without the
 * pretence that one word identifies a requirement.
 *
 * @param left - first text.
 * @param right - second text.
 * @returns the length of the longest common substring, in characters.
 */
export function commonRun(left: string, right: string): number {
  if (left === '' || right === '') return 0
  let best = 0
  let previous = new Array<number>(right.length + 1).fill(0)
  for (let i = 1; i <= left.length; i++) {
    const current = new Array<number>(right.length + 1).fill(0)
    for (let j = 1; j <= right.length; j++) {
      if (left[i - 1] === right[j - 1]) {
        const run = (previous[j - 1] ?? 0) + 1
        current[j] = run
        if (run > best) best = run
      }
    }
    previous = current
  }
  return best
}

/**
 * Read a RequirementsPack.
 *
 * Only the fields this tool needs are validated. A pack missing `items` is
 * rejected outright: an empty list would make every bid look like it answers
 * nothing, which is worse than refusing to run.
 *
 * @param source - the pack JSON text.
 * @returns the requirements, in pack order.
 */
export function readPack(source: string): { id: string; requirements: PackRequirement[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new BidHealthError(`RequirementsPack 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  const pack = parsed as { generator?: { plugin?: string }; items?: unknown[] }
  if (!Array.isArray(pack.items)) throw new BidHealthError('RequirementsPack 缺少 items 数组')
  if (pack.items.length === 0) throw new BidHealthError('RequirementsPack 的 items 为空；空清单会让任何投标文件都看起来什么都没答')
  const requirements: PackRequirement[] = pack.items.map((raw) => {
    const item = raw as Record<string, unknown>
    const id = String(item.id ?? '')
    if (id === '') throw new BidHealthError('RequirementsPack 中有条目缺少 id')
    return {
      id,
      category: String(item.category ?? ''),
      title: String(item.title ?? ''),
      quote: String(item.quote ?? ''),
      tier: String(item.tier ?? ''),
    }
  })
  return { id: String(pack.generator?.plugin ?? 'unknown'), requirements }
}

/**
 * Match each requirement against the bid's paragraphs.
 *
 * @param requirements - from {@link readPack}.
 * @param paragraphs - the bid document's paragraphs, in order.
 * @returns one item per requirement, plus counters.
 */
export function check(requirements: PackRequirement[], paragraphs: string[]): HealthResult {
  const items: HealthItem[] = []
  const warnings: string[] = []

  for (const requirement of requirements) {
    // A queue-C requirement is not a requirement yet: the pack itself says it could
    // not be read reliably. Checking the bid against it would grade the bidder on a
    // sentence the tender may not contain.
    if (requirement.tier === 'C') {
      items.push({
        id: requirement.id,
        category: requirement.category,
        tier: requirement.tier,
        title: requirement.title,
        health: 'not-located',
        evidence: '',
        paragraph: 0,
        matchedTerm: '',
        reason: '本要求在采购文件里属于 C 队列（未能可信抽取），先解决采购文件侧的缺口，再核投标文件',
      })
      continue
    }

    // The title is the requirement's subject; the quote merely contains it. A
    // paragraph that shares four characters with the title is about that subject.
    let bestOverlap = 0
    let bestParagraph = 0
    let bestText = ''
    let fromTitle = false
    // On a tie, prefer the longer paragraph: a heading such as 「第三章 投标保证金」
    // shares the requirement's label with the body that answers it, and taking the
    // first match would always pick the heading.
    paragraphs.forEach((paragraph, index) => {
      const titleRun = commonRun(requirement.title, paragraph)
      const better = titleRun > bestOverlap || (titleRun === bestOverlap && titleRun >= 5 && paragraph.length > bestText.length)
      if (better) {
        bestOverlap = titleRun
        bestParagraph = index
        bestText = paragraph
        fromTitle = true
      }
    })
    if (bestOverlap < 4) {
      // Fall back to the quote, but never above `weak`: sharing text with the clause
      // that contains the requirement is not evidence that the requirement is met.
      paragraphs.forEach((paragraph, index) => {
        const quoteRun = commonRun(requirement.quote, paragraph)
        const better = quoteRun > bestOverlap || (quoteRun === bestOverlap && quoteRun >= 5 && paragraph.length > bestText.length)
        if (better) {
          bestOverlap = quoteRun
          bestParagraph = index
          bestText = paragraph
          fromTitle = false
        }
      })
    }
    const best = bestOverlap >= 5
      ? { paragraph: bestParagraph + 1, text: bestText, term: `${bestOverlap} 字重合` }
      : undefined
    const weakFromQuote = bestOverlap >= 6 && !fromTitle

    if (best === undefined) {
      items.push({
        id: requirement.id,
        category: requirement.category,
        tier: requirement.tier,
        title: requirement.title,
        health: 'not-located',
        evidence: '',
        paragraph: 0,
        matchedTerm: '',
        reason: '投标文件里没有找到与这条要求明显重合的段落。**这不等于没响应**：可能写在表格、附件或换了说法，需人工确认',
      })
      continue
    }

    // A heading that merely repeats the requirement's wording is not a response, and
    // a quote-only overlap is weaker than a title overlap.
    // A rejection clause is a condition the bidder must *meet*, not a sentence to
    // answer: no bid says 「我方同意被拒收」. Locating related text is still useful —
    // it points the reviewer at the paragraph that should carry the evidence — but
    // calling that "responded" would overstate it, so those clauses cap at `weak`.
    const isCondition = requirement.category === 'reject-clause'
    const isHeading = best.text.trim().length <= 12 && !/[。；：:]/u.test(best.text)
    const health: Health = isHeading || weakFromQuote || isCondition ? 'weak' : 'responded'
    items.push({
      id: requirement.id,
      category: requirement.category,
      tier: requirement.tier,
      title: requirement.title,
      health,
      evidence: best.text.trim().slice(0, 200),
      paragraph: best.paragraph,
      matchedTerm: best.term,
      reason: isHeading
        ? '只匹配到一行标题，标题不代表有实质响应'
        : isCondition
          ? `找到 ${best.term} 的相关段落；但废标条款是投标人要满足的条件，不是要回答的句子，请人工确认这一段是否构成证据`
          : weakFromQuote
            ? `与要求原文有 ${best.term}，但不在标题上；可能是顺带提到，需人工看`
            : `要求标题与这一段有 ${best.term}，疑似就是响应段`,
    })
  }

  const summary = {
    responded: items.filter((item) => item.health === 'responded').length,
    weak: items.filter((item) => item.health === 'weak').length,
    notLocated: items.filter((item) => item.health === 'not-located').length,
  }
  const blockedByPack = requirements.filter((requirement) => requirement.tier === 'C').length
  if (blockedByPack > 0) {
    warnings.push(`${blockedByPack} 条要求在采购文件侧就是 C 队列，本次无法核对；先补采购文件`)
  }
  if (paragraphs.length === 0) warnings.push('投标文件没有读到任何段落；表格与扫描页不在本版覆盖范围内')

  return { packId: 'requirements-pack', requirements: requirements.length, items, summary, blockedByPack, warnings }
}

/** Parse a YAML pack as a fallback for callers that pass the textual form. */
export function readPackYaml(source: string): { id: string; requirements: PackRequirement[] } {
  const parsed = parseYaml(source) as { items?: unknown[] } | undefined
  if (parsed === undefined || !Array.isArray(parsed.items)) {
    throw new BidHealthError('这不是 RequirementsPack；需要 JSON（或含 items 数组的 YAML）')
  }
  return readPack(JSON.stringify(parsed))
}

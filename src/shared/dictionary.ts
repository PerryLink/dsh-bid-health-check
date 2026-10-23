/**
 * Header and value normalization dictionaries.
 *
 * Real exports from hospital, customs, metering and quality systems never agree
 * on column names or spelling: `性别` / `性别代码` / `SEX`, `压疮` / `压力性损伤` /
 * `褥疮`, `主手术` / `主要手术操作`. Every table-oriented plugin needs the same
 * normalization step before its rules can be written against stable keys.
 */

/** One canonical field with every spelling seen in the wild. */
export interface FieldAliases {
  /** Canonical key used by the rule packs. */
  key: string
  /** Accepted spellings, most specific first. */
  aliases: string[]
  /** When true, a missing value is reported as a missing field. */
  required?: boolean
}

/** Strip decoration that never carries meaning in a header cell. */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/[\u3000\s]+/g, '')
    .replace(/[*＊]/g, '')
    .replace(/[（(][^（()）]*[)）]/g, '')
    .replace(/[：:]/g, '')
    .replace(/[【】\[\]]/g, '')
    .toLowerCase()
}

/** Convert full-width digits and letters to ASCII. */
export function toHalfWidth(raw: string): string {
  return raw.replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ')
}

/**
 * Resolve a header row to canonical field keys.
 * @param headers - raw header cells, in column order.
 * @param fields - canonical field declarations.
 * @returns canonical key per column index; `undefined` for unmatched columns.
 */
export function resolveHeaders(headers: readonly string[], fields: readonly FieldAliases[]): (string | undefined)[] {
  const normalized = headers.map((header) => normalizeHeader(toHalfWidth(header)))
  const ranked = fields
    .flatMap((field) => field.aliases.map((alias, rank) => ({ key: field.key, alias: normalizeHeader(toHalfWidth(alias)), rank })))
    .sort((left, right) => right.alias.length - left.alias.length || left.rank - right.rank)
  return normalized.map((header) => {
    if (header === '') return undefined
    const exact = ranked.find((entry) => entry.alias === header)
    if (exact !== undefined) return exact.key
    const contained = ranked.find((entry) => header.includes(entry.alias))
    return contained?.key
  })
}

/** Canonicalize a free-text value through a synonym map. */
export interface SynonymMap {
  /** Canonical value. */
  value: string
  /** Accepted spellings of that value. */
  synonyms: string[]
}

/**
 * Map a cell value onto a canonical value.
 * @param raw - raw cell text.
 * @param map - synonym declarations.
 * @returns the canonical value, or `undefined` when nothing matches.
 */
export function canonicalize(raw: string, map: readonly SynonymMap[]): string | undefined {
  const text = normalizeHeader(toHalfWidth(raw))
  if (text === '') return undefined
  const ranked = map
    .flatMap((entry) => entry.synonyms.map((synonym) => ({ value: entry.value, synonym: normalizeHeader(toHalfWidth(synonym)) })))
    .sort((left, right) => right.synonym.length - left.synonym.length)
  const hit = ranked.find((entry) => entry.synonym === text) ?? ranked.find((entry) => text.includes(entry.synonym))
  return hit?.value
}

/** Suggest the closest known header for an unmatched column (edit distance ≤ 3). */
export function suggestHeader(raw: string, fields: readonly FieldAliases[]): string | undefined {
  const target = normalizeHeader(toHalfWidth(raw))
  if (target === '') return undefined
  let best: { alias: string; distance: number } | undefined
  for (const field of fields) {
    for (const alias of field.aliases) {
      const distance = editDistance(target, normalizeHeader(toHalfWidth(alias)))
      if (best === undefined || distance < best.distance) best = { alias, distance }
    }
  }
  return best !== undefined && best.distance <= 3 ? best.alias : undefined
}

/** Levenshtein distance, used only for diagnostics suggestions. */
export function editDistance(left: string, right: string): number {
  const rows = left.length + 1
  const columns = right.length + 1
  let previous = Array.from({ length: columns }, (_, index) => index)
  for (let row = 1; row < rows; row++) {
    const current = new Array<number>(columns).fill(0)
    current[0] = row
    for (let column = 1; column < columns; column++) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      current[column] = Math.min(
        (current[column - 1] as number) + 1,
        (previous[column] as number) + 1,
        (previous[column - 1] as number) + cost,
      )
    }
    previous = current
  }
  return previous[columns - 1] as number
}

/** The family's shared clinical synonym map for assessment form names. */
export const ASSESSMENT_SYNONYMS: readonly SynonymMap[] = [
  { value: 'fall-risk', synonyms: ['跌倒', '坠床', '跌倒坠床', '跌倒风险评估', 'Morse', 'Morse跌倒评分'] },
  { value: 'pressure-ulcer', synonyms: ['压疮', '压力性损伤', '褥疮', '压疮风险评估', 'Braden', 'Braden评分'] },
  { value: 'admission', synonyms: ['入院评估', '首次护理评估', '入院护理评估', '护理评估单'] },
  { value: 'discharge', synonyms: ['出院评估', '出院指导', '出院护理评估'] },
  { value: 'pain', synonyms: ['疼痛评估', '疼痛评分', 'NRS疼痛'] },
  { value: 'nutrition', synonyms: ['营养评估', '营养风险筛查', 'NRS2002'] },
]

/**
 * The generic table-check engine.
 *
 * One engine serves every table-shaped plugin in this family. A plugin declares its
 * columns and its rule pack; the rule pack declares, per rule, a `check.kind` and the
 * parameters that kind needs. Adding a check that fits an existing kind is therefore a
 * rule-pack edit rather than a code change, which is what keeps these plugins small
 * enough to review.
 *
 * Three conventions hold everywhere:
 *
 *  1. **A rule that cannot run says so.** Every handler calls `ctx.skip(reason)` when
 *     its configuration or its material is missing, and the reason reaches the report.
 *     Silence is never read as "no problem".
 *  2. **Findings describe cells, not conclusions.** Messages say which column and which
 *     row, and what was expected; they never assert that a document is invalid, a bid
 *     should be rejected or a process is out of control.
 *  3. **A field is looked up in the row first and then in the material's header**,
 *     because a register often states a figure once for the whole set (an FOB value, a
 *     reference document's revision) rather than repeating it on every row.
 */

import { diffDays, diffMinutes, parseWallClock } from './datetime.ts'
import { issueId } from './report.ts'
import { formatBasis } from './rules.ts'
import type { Issue, Locator, Report, Severity } from './report.ts'
import type { Rule, Ruleset } from './rules.ts'

/** One row of material, with both its own column names and the canonical ones. */
export interface Row {
  /** The row's display number: the declared one when the export carries it. */
  row: number
  /** Cell values, keyed by the material's own column names and the canonical field names. */
  fields: Record<string, string>
}

/** A parsed material: its rows, its header scalars and the columns it carried. */
export interface TableInput {
  /** Description of where the material came from. */
  target: string
  /** Scalar top-level values, keyed by canonical field name and by their own key. */
  header: Record<string, string>
  /** The rows, in the order the material listed them. */
  rows: Row[]
  /** Every column name encountered, for diagnostics. */
  columns: string[]
  /** Non-fatal notes from the reader. */
  warnings: string[]
}

/** Read a string rule parameter. */
function str(params: Record<string, unknown>, key: string, fallback = ''): string {
  const value = params[key]
  return typeof value === 'string' ? value : fallback
}

/**
 * Read a string-list rule parameter.
 *
 * A pack may name the key twice (`stringList(params, 'fields', 'fields')`) as a
 * readability habit; when the second name is the same as the first, or when it
 * resolves to nothing, an empty list is the honest fallback.
 */
function stringList(params: Record<string, unknown>, key: string, fallback: string | readonly string[]): string[] {
  const value = params[key]
  if (Array.isArray(value)) {
    const out = value.filter((entry): entry is string => typeof entry === 'string')
    if (out.length > 0) return out
  }
  if (Array.isArray(fallback)) return [...fallback]
  // A bare string fallback means "same key again"; nothing else to look up.
  return []
}

/** Options every check receives from the plugin. */
export interface TableCheckOptions {
  /** Plugin name, used for the report and for issue ids. */
  plugin: string
  /** ISO instant of the check, used for date comparisons. */
  checkedAt: string
  /** Rules disabled by configuration; each appears in `skipped`. */
  disabledRules: string[]
  /** When non-empty, only these rules run. */
  onlyRules: string[]
  /** Note appended to every `skipped` reason. */
  skipNotes?: string
  /** Per-rule parameter overrides, merged over the rule pack's own check block. */
  overrides?: Record<string, Record<string, unknown>>
}

/** The parameter names the engine understands, for documentation and rule-pack review. */
export const ENGINE_PARAMETER_KEYS: readonly string[] = [
  'kind',
  'field',
  'fields',
  'values',
  'pattern',
  'relation',
  'min',
  'max',
  'positive',
  'tolerance',
  'threshold',
  'target',
  'maxLength',
  'minLength',
  'maxDays',
  'minShared',
  'minRows',
  'digits',
  'components',
  'coefficients',
  'expression',
  'resultField',
  'factorFields',
  'triggerField',
  'requiredField',
  'requiredFields',
  'conditionField',
  'conditionValues',
  'conditionPattern',
  'daysField',
  'fromField',
  'toField',
  'subtractField',
  'leftField',
  'rightField',
  'middleField',
  'lowerField',
  'upperField',
  'uclField',
  'lclField',
  'centerField',
  'rangeField',
  'sizeField',
  'cpField',
  'cpkField',
  'uslField',
  'lslField',
  'stdDevField',
  'meanField',
  'referenceField',
  'actualVersionField',
  'sameVersionField',
  'groupField',
  'versionField',
  'headerField',
  'fromLiteral',
  'toLiteral',
  'notBeforeField',
  'notAfterField',
  'notBefore',
  'notAfter',
  'highRiskKeywords',
  'requirementField',
  'evidenceField',
  'order',
  'terms',
  'fix',
]

/** Read a number from a cell, tolerating the shapes a spreadsheet export produces. */
export function numberOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  // Full-width digits are common in exported Chinese material.
  const normalised = raw
    .replace(/[\uff10-\uff19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[,\s\u3000]/g, '')
  const match = /-?\d+(?:\.\d+)?/.exec(normalised)
  if (match === null) return undefined
  const value = Number(match[0])
  return Number.isFinite(value) ? value : undefined
}

/**
 * Read a field for a row, falling back to the material's header.
 *
 * A register often states a figure once for the whole set — an FOB value, a reference
 * document's revision, a contract total — rather than repeating it on every row.
 * Arithmetic that divides a row value by such a figure must find it, so every field
 * lookup goes through here.
 */
function valueOf(input: TableInput, row: Row, field: string): string | undefined {
  const fromRow = row.fields[field]
  if (fromRow !== undefined && fromRow.trim() !== '') return fromRow
  const fromHeader = input.header[field]
  if (fromHeader !== undefined && fromHeader.trim() !== '') return fromHeader
  return undefined
}

/** True when the cell is present and not blank. */
function filled(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== ''
}

/**
 * True when the material gave this row the column at all, even with a blank cell.
 *
 * Presence checks need this distinction: "the column is not in this material" means the
 * check does not apply, while "the column is here and this cell is blank" is precisely
 * the finding to report. The reader marks a blank cell as an empty string, so the test is
 * whether the key exists — not whether `valueOf` returns text, which would fall through
 * to the header and report the wrong thing.
 */
function provided(input: TableInput, row: Row, field: string): boolean {
  return row.fields[field] !== undefined || input.header[field] !== undefined
}

/** Read a numeric parameter without inventing a default. */
function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

/** A finding's location: a row when known, plus the field it concerns. */
function locatorOf(row: number | undefined, field: string): Locator {
  const out: Locator = {}
  if (row !== undefined) out.row = row
  // `Locator` calls this `column`; writing `field` here meant the name was
  // silently dropped by `formatLocator` and never entered the issue id, so every
  // row-level finding rendered as a bare "第 N 行数据".
  if (field !== '') out.column = field
  return out
}

/** Everything a handler needs, plus the two ways it can report. */
interface CheckContext {
  input: TableInput
  ruleId: string
  /** The flattened check parameters: rule params, then `check`, then call overrides. */
  params: Record<string, unknown>
  options: TableCheckOptions
  add: (locator: { row?: number; field?: string }, found: string, expected: string, fix?: string) => void
  skip: (reason: string) => void
}

/**
 * Whether the material carries the named column at all.
 *
 * Presence of the key, not presence of text: the reader marks a blank cell as an empty
 * string, so "the column is not in this material" (the check does not apply) and "the
 * column is here and its cells are blank" (exactly the finding to report) stay distinct.
 * Testing for text here would make an all-blank column look absent and let the check
 * pass silently — the one failure mode this engine family exists to prevent.
 */
function columnExists(input: TableInput, field: string): boolean {
  if (input.header[field] !== undefined) return true
  return input.rows.some((row) => row.fields[field] !== undefined)
}

/** Whether any cell in the named column actually holds text. */
function columnHasContent(input: TableInput, field: string): boolean {
  if (filled(input.header[field])) return true
  return input.rows.some((row) => filled(row.fields[field]))
}

/** The reason a column-level check did not apply, distinguishing absent from blank. */
function columnAbsentReason(input: TableInput, field: string): string {
  if (!columnExists(input, field)) return `材料没有「${field}」列，本条不适用`
  return `材料有「${field}」列但该列全为空（核对日 ${input.target === '' ? '未知' : '已提供'}）`
}

/* -------------------------------------------------------------------- presence -- */

/** `presence` — the named field must be filled on every row. */
function presence(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  // Only rows the material actually gave this column are held to it.
  const covered = ctx.input.rows.filter((row) => provided(ctx.input, row, field))
  if (covered.length === 0) {
    ctx.skip(`材料没有携带「${field}」列的行，本条不适用`)
    return
  }
  for (const row of covered) {
    if (filled(valueOf(ctx.input, row, field))) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」为空`,
      `「${field}」应填写`,
      str(ctx.params, 'fix', '补填该栏；本条只核对是否填写，不判断内容是否恰当'),
    )
  }
}

/** `presenceAny` — at least one of the named fields must be filled on every row. */
function presenceAny(ctx: CheckContext): void {
  const fields = stringList(ctx.params, 'fields', 'fields')
  if (fields.length === 0) {
    ctx.skip('规则库未配置 fields，本条不执行')
    return
  }
  if (!fields.some((field) => columnExists(ctx.input, field))) {
    ctx.skip(`材料没有 ${fields.join('、')} 中的任何一列，本条不适用`)
    return
  }
  // Which rows the requirement covers: a row counts only when the material gave it
  // at least one of the columns being checked. This keeps a summary or spacer row
  // that carries none of them from being reported as a blank.
  const covered = ctx.input.rows.filter((row) => fields.some((field) => provided(ctx.input, row, field)))
  if (covered.length === 0) {
    ctx.skip(`材料没有携带 ${fields.join('、')} 任一列的行，本条不适用`)
    return
  }
  for (const row of covered) {
    if (fields.some((field) => filled(valueOf(ctx.input, row, field)))) continue
    ctx.add(
      locatorOf(row.row, fields[0] as string),
      `第 ${row.row} 行 ${fields.join('、')} 都为空`,
      `${fields.join('、')} 至少应填写一项`,
      str(ctx.params, 'fix', '至少补填一项；本条只核对是否填写，不判断内容是否恰当'),
    )
  }
}

/** `enum` — the cell must hold one of the configured values. */
function enumCheck(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const allowed = stringList(ctx.params, 'values', 'values')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  if (allowed.length === 0) {
    ctx.skip(`规则库未配置 values：「${field}」的取值口径由本机构规定，本引擎不硬编码`)
    return
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? '').trim()
    if (value === '') continue
    if (allowed.includes(value)) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」的值为「${value}」`,
      `「${field}」应为 ${allowed.join(' / ')} 之一`,
      str(ctx.params, 'fix', '核对取值来源；本条只核对是否在册，不判断取值本身是否恰当'),
    )
  }
}

/** `pattern` — the cell must match the configured regular expression. */
function patternCheck(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const pattern = str(ctx.params, 'pattern')
  if (field === '' || pattern === '') {
    ctx.skip('规则库未配置 field 或 pattern，本条不执行')
    return
  }
  let matcher: RegExp
  try {
    matcher = new RegExp(pattern)
  } catch (error) {
    ctx.skip(`规则库配置的 pattern 不是合法正则：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? '').trim()
    if (value === '') continue
    if (matcher.test(value)) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」的值「${value}」不符合配置的形式`,
      `「${field}」应匹配 ${pattern}`,
      str(ctx.params, 'fix', '核对填写形式；本条只核对形式，不判断内容是否正确'),
    )
  }
}

/* ----------------------------------------------------------------------- dates -- */

/** `date` — the field must parse, and may be bounded by another field or a literal. */
function dateCheck(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  const notBeforeField = str(ctx.params, 'notBeforeField')
  const notAfterField = str(ctx.params, 'notAfterField')
  const notBefore = str(ctx.params, 'notBefore')
  const notAfter = str(ctx.params, 'notAfter')
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  const today = ctx.options.checkedAt.slice(0, 10)
  for (const row of ctx.input.rows) {
    const raw = (valueOf(ctx.input, row, field) ?? '').trim()
    if (raw === '') continue
    const parsed = parseWallClock(raw)
    if (parsed === undefined) {
      ctx.add(
        locatorOf(row.row, field),
        `第 ${row.row} 行「${field}」的值「${raw}」无法解析为日期`,
        `「${field}」应为 2026-03-15 或 2026-03-15 09:30 这样的可解析日期`,
        '核对日期写法；本条不会因为无法解析而跳过该行',
      )
      continue
    }
    const lowerRaw =
      notBeforeField !== '' ? (valueOf(ctx.input, row, notBeforeField) ?? '') : notBefore === 'today' ? today : notBefore
    const upperRaw =
      notAfterField !== '' ? (valueOf(ctx.input, row, notAfterField) ?? '') : notAfter === 'today' ? today : notAfter

    if (lowerRaw !== '') {
      const lower = parseWallClock(lowerRaw)
      if (lower === undefined) {
        ctx.add(
          locatorOf(row.row, field),
          `第 ${row.row} 行的下限日期「${lowerRaw}」无法解析，无法与「${field}」比较`,
          '用于比较的日期应可解析',
          '核对日期写法',
        )
      } else if (parsed.date < lower.date) {
        ctx.add(
          locatorOf(row.row, field),
          `第 ${row.row} 行「${field}」为 ${parsed.date}，早于 ${notBeforeField !== '' ? `「${notBeforeField}」的 ` : ''}${lower.date}`,
          `「${field}」不应早于 ${lower.date}`,
          str(ctx.params, 'fix', '核对两个日期的填写；本条只比较先后'),
        )
      }
    }
    if (upperRaw === '') continue
    const upper = parseWallClock(upperRaw)
    if (upper === undefined) {
      ctx.add(
        locatorOf(row.row, field),
        `第 ${row.row} 行的上限日期「${upperRaw}」无法解析，无法与「${field}」比较`,
        '用于比较的日期应可解析',
        '核对日期写法',
      )
      continue
    }
    if (parsed.date <= upper.date) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」为 ${parsed.date}，晚于 ${notAfterField !== '' ? `「${notAfterField}」的 ` : ''}${upper.date}`,
      `「${field}」不应晚于 ${upper.date}`,
      str(ctx.params, 'fix', '核对两个日期的填写；本条只比较先后'),
    )
  }
}

/** `noFutureDate` — a date must not be later than the check date. */
function noFutureDate(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  const today = ctx.options.checkedAt.slice(0, 10)
  for (const row of ctx.input.rows) {
    const raw = (valueOf(ctx.input, row, field) ?? '').trim()
    if (raw === '') continue
    const parsed = parseWallClock(raw)
    if (parsed === undefined) {
      ctx.add(
        locatorOf(row.row, field),
        `第 ${row.row} 行「${field}」为「${raw}」，无法解析为日期`,
        `「${field}」应为 ${today} 之前的可解析日期`,
        '核对日期写法；本条识别 2026-03-15 与 2026-03-15 09:30 两种形式',
      )
      continue
    }
    if (parsed.date <= today) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」为 ${parsed.date}，晚于核对日 ${today}`,
      `「${field}」应不晚于核对日`,
      '核对日期是否填错；本条只核对先后，不判断数据是否可靠',
    )
  }
}

/** `dataAge` — a dated cell must be recent enough under a configured window. */
function dataAge(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const maxDays = optionalNumber(ctx.params, 'maxDays')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  if (maxDays === undefined || maxDays <= 0) {
    ctx.skip(`规则库未配置 maxDays：「${field}」的数据新鲜度要求由本机构编辑口径规定，本引擎不硬编码`)
    return
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  const today = ctx.options.checkedAt.slice(0, 10)
  for (const row of ctx.input.rows) {
    const raw = (valueOf(ctx.input, row, field) ?? '').trim()
    if (raw === '') continue
    const parsed = parseWallClock(raw)
    if (parsed === undefined) {
      ctx.add(
        locatorOf(row.row, field),
        `第 ${row.row} 行「${field}」为「${raw}」，无法解析为日期`,
        `「${field}」应为可解析日期，且距核对日不超过 ${maxDays} 天`,
        '核对日期写法',
      )
      continue
    }
    const age = diffDays(parsed.date, today)
    if (age <= maxDays) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」为 ${parsed.date}，距核对日 ${age} 天，超过配置的 ${maxDays} 天`,
      `「${field}」的数据不应早于核对日前 ${maxDays} 天`,
      str(ctx.params, 'fix', '更新数据或说明引用旧数据的原因；本条的天数来自本机构配置，不是标准数值'),
    )
  }
}

/* --------------------------------------------------------------------- numbers -- */

/** `number` — the cell must parse as a number, optionally positive or bounded. */
function numberCheck(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  const min = optionalNumber(ctx.params, 'min')
  const max = optionalNumber(ctx.params, 'max')
  const positive = ctx.params.positive === true
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  for (const row of ctx.input.rows) {
    const raw = (valueOf(ctx.input, row, field) ?? '').trim()
    if (raw === '') continue
    const value = numberOf(raw)
    if (value === undefined) {
      ctx.add(
        locatorOf(row.row, field),
        `第 ${row.row} 行「${field}」的值「${raw}」无法解析为数字`,
        `「${field}」应填写数字`,
        str(ctx.params, 'fix', '核对填写形式；本条只核对可解析性，不判断数值是否合理'),
      )
      continue
    }
    if (positive && value <= 0) {
      ctx.add(
        locatorOf(row.row, field),
        `第 ${row.row} 行「${field}」为 ${value}，不是正数`,
        `「${field}」应为大于零的数值`,
        str(ctx.params, 'fix', '核对取值；本条只核对是否为正数'),
      )
      continue
    }
    if (min !== undefined && value < min) {
      ctx.add(
        locatorOf(row.row, field),
        `第 ${row.row} 行「${field}」为 ${value}，小于配置下限 ${min}`,
        `「${field}」应不小于 ${min}`,
        str(ctx.params, 'fix', '核对取值；本条的上下限来自本机构配置'),
      )
      continue
    }
    if (max === undefined || value <= max) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」为 ${value}，大于配置上限 ${max}`,
      `「${field}」应不大于 ${max}`,
      str(ctx.params, 'fix', '核对取值；本条的上下限来自本机构配置'),
    )
  }
}

/* --------------------------------------------------------------- cross-row checks -- */

/** `unique` — no two rows may share the same value, ignoring whitespace. */
function uniqueCheck(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  const seen = new Map<string, Row>()
  let considered = 0
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? '').replace(/[\s\u3000]/g, '')
    if (value === '') continue
    considered += 1
    const first = seen.get(value)
    if (first === undefined) {
      seen.set(value, row)
      continue
    }
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」的值「${valueOf(ctx.input, row, field)}」与第 ${first.row} 行重复`,
      `「${field}」在材料内应唯一`,
      str(ctx.params, 'fix', '核对是否重复登记或抄错；本条只核对唯一性'),
    )
  }
  if (considered === 0) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
  }
}

/** `sequence` — numbers in the field should be continuous over their own range. */
function sequenceCheck(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  const numbers = ctx.input.rows
    .map((row) => ({ row, value: numberOf(valueOf(ctx.input, row, field)) }))
    .filter((entry): entry is { row: Row; value: number } => entry.value !== undefined)
  if (numbers.length < 2) {
    ctx.skip(`材料中「${field}」可解析为数字的行不足两行，无法核对连续性`)
    return
  }
  const values = numbers.map((entry) => Math.round(entry.value))
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max - min + 1 > 5000) {
    ctx.skip(`「${field}」的取值跨度过大（${min}~${max}），本条不执行`)
    return
  }
  const present = new Set(values)
  const missing: number[] = []
  for (let value = min; value <= max; value += 1) {
    if (!present.has(value)) missing.push(value)
  }
  if (missing.length === 0) return
  ctx.add(
    locatorOf(numbers[0]?.row.row, field),
    `${field} 范围 ${min}~${max} 中缺 ${missing.length} 个号：${missing.slice(0, 20).join('、')}${missing.length > 20 ? ' 等' : ''}`,
    `「${field}」应在同一范围内连续`,
    '核对是否漏登记；缺号本身不构成问题，需人工确认',
  )
}

/** `sum` — a column of numbers must total a header field. */
function sumCheck(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const headerField = str(ctx.params, 'headerField')
  if (field === '' || headerField === '') {
    ctx.skip('规则库未配置 field 或 headerField，本条不执行')
    return
  }
  const parsed = ctx.input.rows
    .map((row) => numberOf(valueOf(ctx.input, row, field)))
    .filter((value): value is number => value !== undefined)
  if (parsed.length === 0) {
    ctx.skip(`材料没有可解析为数字的「${field}」值，无法核对合计`)
    return
  }
  const declared = numberOf(ctx.input.header[headerField])
  if (declared === undefined) {
    ctx.skip(`材料未提供可解析的「${headerField}」，无法与「${field}」的合计核对`)
    return
  }
  const total = parsed.reduce((sum, value) => sum + value, 0)
  const tolerance = optionalNumber(ctx.params, 'tolerance') ?? 0
  const gap = Math.abs(total - declared)
  if (gap <= tolerance) return
  ctx.add(
    locatorOf(undefined, field),
    `${parsed.length} 行的「${field}」合计 ${Number(total.toFixed(4))}，与「${headerField}」${declared} 相差 ${Number(gap.toFixed(4))}`,
    `「${field}」的合计应与「${headerField}」一致，允许偏差 ${tolerance}`,
    '核对是否有行遗漏、重复计入或口径不一致；本条只做加法核对',
  )
}

/** `sumToConstant` — a column of numbers must total a configured constant. */
function sumToConstant(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const target = optionalNumber(ctx.params, 'target')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  if (target === undefined || target <= 0) {
    ctx.skip(`规则库未配置 target：「${field}」的合计目标由招标文件或本机构口径规定，本引擎不硬编码`)
    return
  }
  const parsed = ctx.input.rows
    .map((row) => numberOf(valueOf(ctx.input, row, field)))
    .filter((value): value is number => value !== undefined)
  if (parsed.length === 0) {
    ctx.skip(`材料没有可解析为数字的「${field}」值，无法核对合计`)
    return
  }
  const tolerance = optionalNumber(ctx.params, 'tolerance') ?? 0
  const total = parsed.reduce((sum, value) => sum + value, 0)
  const gap = Math.abs(total - target)
  if (gap <= tolerance) return
  ctx.add(
    locatorOf(undefined, field),
    `${parsed.length} 行的「${field}」合计 ${Number(total.toFixed(4))}，与配置的目标值 ${target} 相差 ${Number(gap.toFixed(4))}`,
    `「${field}」的合计应为 ${target}，允许偏差 ${tolerance}`,
    // The default fix text must survive wording.ts's guard, which scans the
    // RENDERED report for adjudicating phrases and throws. An earlier version
    // ended "…不判断设置是否合规", which reads as a disclaimer but is a bare
    // substring hit, so every rule that fell through to this default crashed the
    // renderer the first time it fired. Disclaimers have to be phrased without
    // the forbidden words, not around them.
    str(ctx.params, 'fix', '核对是否有行遗漏或数值抄错；本条只做加法核对，不评价分值设置本身'),
  )
}

/** `countPerGroup` — each group value must appear at least N times. */
function countPerGroup(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const minRows = optionalNumber(ctx.params, 'minRows') ?? 1
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  const groups = new Map<string, Row[]>()
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? '').trim()
    if (value === '') continue
    const bucket = groups.get(value)
    if (bucket === undefined) groups.set(value, [row])
    else bucket.push(row)
  }
  if (groups.size === 0) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  for (const [value, rows] of groups) {
    if (rows.length >= minRows) continue
    ctx.add(
      locatorOf(rows[0]?.row, field),
      `「${field}」为「${value}」的只有 ${rows.length} 行，少于配置的 ${minRows} 行`,
      `每个「${field}」应至少出现 ${minRows} 行`,
      str(ctx.params, 'fix', '核对是否漏登记；本条只核对行数，不判断内容是否完整'),
    )
  }
}

/** `textContains` — the cell should contain all the configured terms. */
function textContains(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const terms = stringList(ctx.params, 'terms', 'terms')
  if (field === '' || terms.length === 0) {
    ctx.skip('规则库未配置 field 或 terms，本条不执行')
    return
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  for (const row of ctx.input.rows) {
    const text = valueOf(ctx.input, row, field) ?? ''
    if (text === '') continue
    const missing = terms.filter((term) => !text.includes(term))
    if (missing.length === 0) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」中未见 ${missing.join('、')}`,
      `「${field}」应包含 ${terms.join('、')}`,
      str(ctx.params, 'fix', '核对是否遗漏；本条只核对字面是否出现，不判断表述是否恰当'),
    )
  }
}

/** `containsAny` — the cell must not contain any of the configured terms. */
function containsAny(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const terms = stringList(ctx.params, 'terms', 'terms')
  if (field === '' || terms.length === 0) {
    ctx.skip('规则库未配置 field 或 terms，本条不执行')
    return
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  for (const row of ctx.input.rows) {
    const text = valueOf(ctx.input, row, field) ?? ''
    if (text === '') continue
    const hit = terms.find((term) => text.includes(term))
    if (hit === undefined) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」中残留占位符「${hit}」`,
      `「${field}」应填写实际内容，不含未替换的占位符`,
      str(ctx.params, 'fix', '核对是否直接照抄了模板'),
    )
  }
}

/** `length` — the cell's length must sit inside a configured range. */
function lengthCheck(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  const max = optionalNumber(ctx.params, 'maxLength')
  const min = optionalNumber(ctx.params, 'minLength')
  if (max === undefined && min === undefined) {
    ctx.skip(`规则库未配置 maxLength 或 minLength：「${field}」的长度限制属本机构口径，本条不执行`)
    return
  }
  for (const row of ctx.input.rows) {
    const value = valueOf(ctx.input, row, field) ?? ''
    if (value === '') continue
    const count = [...value].length
    if (max !== undefined && count > max) {
      ctx.add(
        locatorOf(row.row, field),
        `第 ${row.row} 行「${field}」共 ${count} 字，超过配置上限 ${max} 字`,
        `「${field}」应不超过 ${max} 字`,
        str(ctx.params, 'fix', '核对长度限制来源；本条的上下限来自本机构配置'),
      )
      continue
    }
    if (min === undefined || count >= min) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」共 ${count} 字，少于配置下限 ${min} 字`,
      `「${field}」应不少于 ${min} 字`,
      str(ctx.params, 'fix', '核对是否漏填；本条的上下限来自本机构配置'),
    )
  }
}

/** `minLength` — the cell must hold at least N characters. */
function minLength(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const min = optionalNumber(ctx.params, 'minLength')
  if (field === '' || min === undefined || min <= 0) {
    ctx.skip('规则库未配置 field 或 minLength，本条不执行')
    return
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? '').trim()
    if (value === '') continue
    const count = [...value].length
    if (count >= min) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」只有 ${count} 字，短于配置下限 ${min} 字`,
      `「${field}」应至少有 ${min} 字`,
      str(ctx.params, 'fix', '核对是否真的是摘录；本条只核对长度，不判断内容是否忠实于原文'),
    )
  }
}

/* ------------------------------------------------------------------ header checks -- */

/** `headerPresence` — the material's header must carry the named fields. */
function headerPresence(ctx: CheckContext): void {
  const fields = stringList(ctx.params, 'fields', 'fields')
  if (fields.length === 0) {
    ctx.skip('规则库未配置 fields，本条不执行')
    return
  }
  const missing = fields.filter((field) => !filled(ctx.input.header[field]))
  if (missing.length === 0) return
  ctx.add(
    locatorOf(undefined, missing[0] as string),
    `材料表头缺少 ${missing.join('、')}`,
    `表头应提供 ${fields.join('、')}`,
    str(ctx.params, 'fix', '补齐表头字段；本条只核对表头是否声明，不判断内容是否恰当'),
  )
}

/** `headerEnum` — a header value must come from the configured vocabulary. */
function headerEnum(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const values = stringList(ctx.params, 'values', 'values')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  const actual = (ctx.input.header[field] ?? '').trim()
  if (actual === '') {
    ctx.skip(`材料表头未提供「${field}」，本条不适用`)
    return
  }
  if (values.length === 0) {
    ctx.skip(`规则库未配置 values：「${field}」的取值口径由顾客或本机构规定，本引擎不硬编码`)
    return
  }
  if (values.includes(actual)) return
  ctx.add(
    locatorOf(undefined, field),
    `材料表头「${field}」的值为「${actual}」`,
    `「${field}」应为 ${values.join(' / ')} 之一`,
    '核对取值来源；本条只核对是否在册，不判断该取值本身是否恰当',
  )
}

/* ------------------------------------------------------------- conditional checks -- */

/**
 * `conditionalPresence` — when the condition field is met, the listed fields must be
 * filled. The condition can be "not blank" (the default), "one of these values", or
 * "matches this pattern".
 */
function conditionalPresence(ctx: CheckContext): void {
  const conditionField = str(ctx.params, 'conditionField')
  const required = stringList(ctx.params, 'requiredFields', 'requiredFields')
  if (conditionField === '' || required.length === 0) {
    ctx.skip('规则库未配置 conditionField 或 requiredFields，本条不执行')
    return
  }
  const values = stringList(ctx.params, 'conditionValues', 'conditionValues')
  const pattern = str(ctx.params, 'conditionPattern')
  let matcher: RegExp | undefined
  if (pattern !== '') {
    try {
      matcher = new RegExp(pattern)
    } catch (error) {
      ctx.skip(`规则库配置的 conditionPattern 不是合法正则：${error instanceof Error ? error.message : String(error)}`)
      return
    }
  }
  const triggered = ctx.input.rows.filter((row) => {
    const value = (valueOf(ctx.input, row, conditionField) ?? '').trim()
    if (value === '') return false
    if (values.length > 0) return values.some((candidate) => candidate === value)
    if (matcher !== undefined) return matcher.test(value)
    return true
  })
  if (triggered.length === 0) {
    ctx.skip(`材料中没有满足「${conditionField}」条件的行，本条不适用`)
    return
  }
  for (const row of triggered) {
    const missing = required.filter((field) => !filled(valueOf(ctx.input, row, field)))
    if (missing.length === 0) continue
    ctx.add(
      locatorOf(row.row, conditionField),
      `第 ${row.row} 行「${conditionField}」为「${valueOf(ctx.input, row, conditionField)}」，但缺 ${missing.join('、')}`,
      `满足该条件的行应同时填写 ${required.join('、')}`,
      str(ctx.params, 'fix', '补齐；本条只核对字段是否存在，不判断内容是否恰当'),
    )
  }
}

/** `highRiskEvidence` — a row whose requirement matches a keyword must carry evidence. */
function highRiskEvidence(ctx: CheckContext): void {
  const keywords = stringList(ctx.params, 'highRiskKeywords', 'highRiskKeywords')
  if (keywords.length === 0) {
    ctx.skip('规则库未配置 highRiskKeywords：哪些条款属于高风险取决于招标文件本身，本引擎不硬编码')
    return
  }
  const evidenceField = str(ctx.params, 'evidenceField', 'evidence')
  const requirementField = str(ctx.params, 'requirementField', 'requirement')
  const matching = ctx.input.rows.filter((row) => {
    const text = valueOf(ctx.input, row, requirementField) ?? ''
    return text !== '' && keywords.some((keyword) => text.includes(keyword))
  })
  if (matching.length === 0) {
    ctx.skip(`材料中没有命中高风险关键词（${keywords.join('、')}）的条款，本条不适用`)
    return
  }
  for (const row of matching) {
    if (filled(valueOf(ctx.input, row, evidenceField))) continue
    const text = valueOf(ctx.input, row, requirementField) ?? ''
    const hit = keywords.find((keyword) => text.includes(keyword))
    ctx.add(
      locatorOf(row.row, evidenceField),
      `第 ${row.row} 行的要求命中高风险关键词「${hit}」，但未填写证明材料`,
      `命中 ${keywords.join(' / ')} 的条款应填写证明材料`,
      '补填证明材料或页码；本条只核对是否填写，不判断证明材料是否有效',
    )
  }
}

/** `thresholdPresence` — a row crossing the threshold must carry the named field. */
function thresholdPresence(ctx: CheckContext): void {
  const triggerField = str(ctx.params, 'triggerField')
  const requiredField = str(ctx.params, 'requiredField')
  const threshold = optionalNumber(ctx.params, 'threshold')
  if (triggerField === '' || requiredField === '') {
    ctx.skip('规则库未配置 triggerField 或 requiredField，本条不执行')
    return
  }
  if (threshold === undefined || threshold <= 0) {
    ctx.skip('规则库未配置 threshold：「多高算高风险、多高必须提措施」取决于本机构风险准则，本引擎不硬编码')
    return
  }
  const triggered = ctx.input.rows.filter((row) => {
    const value = numberOf(valueOf(ctx.input, row, triggerField))
    return value !== undefined && value >= threshold
  })
  if (triggered.length === 0) {
    ctx.skip(`材料中没有「${triggerField}」达到 ${threshold} 的行，本条不适用`)
    return
  }
  for (const row of triggered) {
    if (filled(valueOf(ctx.input, row, requiredField))) continue
    ctx.add(
      locatorOf(row.row, requiredField),
      `第 ${row.row} 行「${triggerField}」为 ${valueOf(ctx.input, row, triggerField)}，达到配置阈值 ${threshold}，但未填写「${requiredField}」`,
      `「${triggerField}」达到 ${threshold} 的行应填写「${requiredField}」`,
      '补填；本条的阈值来自本机构配置，不是标准数值',
    )
  }
}

/** `thresholdBelow` — a value must not fall below the configured criterion. */
function thresholdBelow(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const threshold = optionalNumber(ctx.params, 'threshold')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  if (threshold === undefined || threshold <= 0) {
    ctx.skip('规则库未配置 threshold：接收准则因行业、顾客与特性重要度而异，本引擎不硬编码任何准则')
    return
  }
  if (!columnExists(ctx.input, field)) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  for (const row of ctx.input.rows) {
    const value = numberOf(valueOf(ctx.input, row, field))
    if (value === undefined) continue
    if (value >= threshold) continue
    ctx.add(
      locatorOf(row.row, field),
      `第 ${row.row} 行「${field}」为 ${value}，低于本机构配置的准则 ${threshold}`,
      `「${field}」应不低于 ${threshold}`,
      str(ctx.params, 'fix', '核对取值；本条的准则来自本机构或顾客配置，不是标准数值'),
    )
  }
}

/* ------------------------------------------------------------------ arithmetic -- */

/** `fieldComparison` — two fields must satisfy a stated relation. */
function fieldComparison(ctx: CheckContext): void {
  const leftField = str(ctx.params, 'leftField')
  const rightField = str(ctx.params, 'rightField')
  const relation = str(ctx.params, 'relation', 'gte')
  if (leftField === '' || rightField === '') {
    ctx.skip('规则库未配置 leftField 或 rightField，本条不执行')
    return
  }
  const label: Record<string, string> = {
    gte: '不小于',
    gt: '大于',
    lte: '不大于',
    lt: '小于',
    eq: '等于',
  }
  const comparable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, leftField)) && filled(valueOf(ctx.input, row, rightField)),
  )
  if (comparable.length === 0) {
    ctx.skip(`材料没有同时填写「${leftField}」与「${rightField}」的行，本条不适用`)
    return
  }
  for (const row of comparable) {
    const leftRaw = valueOf(ctx.input, row, leftField) ?? ''
    const rightRaw = valueOf(ctx.input, row, rightField) ?? ''
    const left = numberOf(leftRaw)
    const right = numberOf(rightRaw)
    const leftDate = left === undefined ? parseWallClock(leftRaw) : undefined
    const rightDate = right === undefined ? parseWallClock(rightRaw) : undefined
    let ok: boolean | undefined
    if (left !== undefined && right !== undefined) {
      ok =
        relation === 'gte'
          ? left >= right
          : relation === 'gt'
            ? left > right
            : relation === 'lte'
              ? left <= right
              : relation === 'lt'
                ? left < right
                : relation === 'eq'
                  ? left === right
                  : undefined
    } else if (leftDate !== undefined && rightDate !== undefined) {
      ok =
        relation === 'gte'
          ? leftDate.date >= rightDate.date
          : relation === 'gt'
            ? leftDate.date > rightDate.date
            : relation === 'lte'
              ? leftDate.date <= rightDate.date
              : relation === 'lt'
                ? leftDate.date < rightDate.date
                : relation === 'eq'
                  ? leftDate.date === rightDate.date
                  : undefined
    }
    if (ok === undefined) {
      ctx.add(
        locatorOf(row.row, leftField),
        `第 ${row.row} 行「${leftField}」${leftRaw} 与「${rightField}」${rightRaw} 无法作为可比数值或日期比较`,
        `「${leftField}」应${label[relation] ?? relation}「${rightField}」`,
        '核对两栏的填写形式；本条只做比较，不判断数值是否真实',
      )
      continue
    }
    if (ok) continue
    ctx.add(
      locatorOf(row.row, leftField),
      `第 ${row.row} 行「${leftField}」为 ${leftRaw}，「${rightField}」为 ${rightRaw}，不满足${label[relation] ?? relation}关系`,
      `「${leftField}」应${label[relation] ?? relation}「${rightField}」`,
      str(ctx.params, 'fix', '核对两栏是否填反或抄错；本条只做比较，不判断数值是否真实'),
    )
  }
}

/** `intervalOrder` — three values must be ordered low ≤ middle ≤ high. */
function intervalOrder(ctx: CheckContext): void {
  const lowerField = str(ctx.params, 'lowerField')
  const middleField = str(ctx.params, 'middleField')
  const upperField = str(ctx.params, 'upperField')
  if (lowerField === '' || middleField === '' || upperField === '') {
    ctx.skip('规则库未配置 lowerField、middleField 或 upperField，本条不执行')
    return
  }
  const usable = ctx.input.rows.filter(
    (row) =>
      filled(valueOf(ctx.input, row, lowerField)) &&
      filled(valueOf(ctx.input, row, middleField)) &&
      filled(valueOf(ctx.input, row, upperField)),
  )
  if (usable.length === 0) {
    ctx.skip(`材料没有同时填写「${lowerField}」「${middleField}」「${upperField}」的行，本条不适用`)
    return
  }
  for (const row of usable) {
    const lower = numberOf(valueOf(ctx.input, row, lowerField))
    const middle = numberOf(valueOf(ctx.input, row, middleField))
    const upper = numberOf(valueOf(ctx.input, row, upperField))
    if (lower === undefined || middle === undefined || upper === undefined) {
      ctx.add(
        locatorOf(row.row, middleField),
        `第 ${row.row} 行的「${lowerField}」「${middleField}」「${upperField}」中有无法解析为数值的值`,
        `三个值应可比较，且满足 ${lowerField} ≤ ${middleField} ≤ ${upperField}`,
        '核对填写形式',
      )
      continue
    }
    if (lower <= middle && middle <= upper) continue
    ctx.add(
      locatorOf(row.row, middleField),
      `第 ${row.row} 行「${middleField}」为 ${middle}，而「${lowerField}」为 ${lower}、「${upperField}」为 ${upper}`,
      `应满足 ${lowerField} ≤ ${middleField} ≤ ${upperField}`,
      '核对三个数值的填写；本条只核对次序，不判断数值是否正确',
    )
  }
}

/** `productOf` — the result must equal the product of the named factors. */
function productOf(ctx: CheckContext): void {
  const resultField = str(ctx.params, 'resultField')
  const factors = stringList(ctx.params, 'factorFields', 'factorFields')
  if (resultField === '' || factors.length === 0) {
    ctx.skip('规则库未配置 resultField 或 factorFields，本条不执行')
    return
  }
  const tolerance = optionalNumber(ctx.params, 'tolerance') ?? 0
  const usable = ctx.input.rows.filter(
    (row) =>
      filled(valueOf(ctx.input, row, resultField)) &&
      factors.every((factor) => filled(valueOf(ctx.input, row, factor))),
  )
  if (usable.length === 0) {
    ctx.skip(`材料没有同时填写「${resultField}」与 ${factors.join('、')} 的行，无法核对乘积`)
    return
  }
  const round = (value: number): number => Number(value.toFixed(6))
  for (const row of usable) {
    const declared = numberOf(valueOf(ctx.input, row, resultField))
    const values = factors.map((factor) => numberOf(valueOf(ctx.input, row, factor)))
    if (declared === undefined || values.some((value) => value === undefined)) {
      ctx.add(
        locatorOf(row.row, resultField),
        `第 ${row.row} 行的「${resultField}」或 ${factors.join('、')} 中有无法解析为数值的值`,
        `「${resultField}」应等于 ${factors.join(' × ')}`,
        '核对填写形式；本条只做算术核对，不判断各因子是否正确',
      )
      continue
    }
    const numbers = values as number[]
    const product = numbers.reduce((total, value) => total * value, 1)
    if (Math.abs(product - declared) <= tolerance) continue
    ctx.add(
      locatorOf(row.row, resultField),
      `第 ${row.row} 行「${resultField}」填报 ${declared}，而 ${numbers.join(' × ')} = ${round(product)}`,
      `「${resultField}」应等于 ${factors.join(' × ')}`,
      '核对是否抄错或漏改；本条只做算术核对，不判断各因子是否正确',
    )
  }
}

/** `formula` — the result must equal an arithmetic expression over other fields. */
function formula(ctx: CheckContext): void {
  const resultField = str(ctx.params, 'resultField')
  const expression = ctx.params.expression
  if (resultField === '' || typeof expression !== 'object' || expression === null || Array.isArray(expression)) {
    ctx.skip('规则库未配置 resultField 或 expression，本条不执行')
    return
  }
  const spec = expression as { op?: unknown; fields?: unknown; scale?: unknown; signs?: unknown }
  const op = typeof spec.op === 'string' ? spec.op : ''
  const fields = Array.isArray(spec.fields)
    ? spec.fields.filter((entry): entry is string => typeof entry === 'string')
    : []
  const scale = typeof spec.scale === 'number' && Number.isFinite(spec.scale) ? spec.scale : 1
  /**
   * Per-term signs for `sum`.
   *
   * A composed total is naturally written as some terms added and others subtracted —
   * `配件费 + 工时费 − 折扣`. Expressing that as signs keeps it a single addition, so the
   * message reads like the arithmetic a person would write down, and a negative overall
   * scale is never needed (which would invert every term, not just the last).
   */
  const signs = Array.isArray(spec.signs)
    ? spec.signs.map((entry) => (entry === -1 || entry === '-1' || entry === '-' ? -1 : 1))
    : []
  if (fields.length === 0 || !['divide', 'product', 'sum', 'subtract', 'percent'].includes(op)) {
    ctx.skip('规则库配置的 expression 不完整：op 应为 divide/product/sum/subtract/percent，且需给出 fields')
    return
  }
  const usable = ctx.input.rows.filter(
    (row) =>
      filled(valueOf(ctx.input, row, resultField)) &&
      fields.every((field) => filled(valueOf(ctx.input, row, field))),
  )
  if (usable.length === 0) {
    ctx.skip(`材料没有同时填写「${resultField}」与 ${fields.join('、')} 的行，无法核对表达式`)
    return
  }
  // Rows usually carry the detail lines and the header carries the aggregate, so a
  // factor stated only in the header would otherwise never enter the arithmetic.
  // Comparing the header's own figures is therefore a legitimate second case.
  const headerUsable = fields.every((field) => filled(ctx.input.header[field]))
  if (usable.length === 0 && !headerUsable) {
    ctx.skip(`材料没有同时填写「${resultField}」与 ${fields.join('、')} 的行，无法核对表达式`)
    return
  }
  const tolerance = optionalNumber(ctx.params, 'tolerance') ?? 0
  const label: Record<string, string> = {
    divide: fields.join(' ÷ '),
    product: fields.join(' × '),
    sum: fields.map((field, index) => `${signs[index] === -1 ? '−' : index === 0 ? '' : '+'}${field}`).join(' '),
    subtract: `${fields[0]} − ${fields.slice(1).join(' − ')}`,
    percent: `${fields.join(' ÷ ')} × 100`,
  }
  const round = (value: number): number => Number(value.toFixed(6))
  for (const row of usable) {
    const declared = numberOf(valueOf(ctx.input, row, resultField))
    const values = fields.map((field) => numberOf(valueOf(ctx.input, row, field)))
    if (declared === undefined || values.some((value) => value === undefined)) {
      ctx.add(
        locatorOf(row.row, resultField),
        `第 ${row.row} 行的「${resultField}」或 ${fields.join('、')} 中有无法解析为数值的值`,
        `「${resultField}」应等于 ${label[op] ?? op}`,
        '核对填写形式；本条只做算术核对',
      )
      continue
    }
    const numbers = values as number[]
    const first = numbers[0] as number
    const rest = numbers.slice(1)
    let expected: number
    switch (op) {
      case 'divide':
        expected = rest.reduce((total, value) => total / value, first)
        break
      case 'product':
        expected = numbers.reduce((total, value) => total * value, 1)
        break
      case 'sum':
        expected = numbers.reduce((total, value, index) => total + (signs[index] ?? 1) * value, 0)
        break
      case 'subtract':
        expected = rest.reduce((total, value) => total - value, first)
        break
      default:
        expected = (first / (rest[0] ?? 1)) * 100
        break
    }
    expected *= scale
    if (Math.abs(declared - expected) <= tolerance) continue
    ctx.add(
      locatorOf(row.row, resultField),
      `第 ${row.row} 行「${resultField}」填报 ${declared}，按 ${label[op] ?? op} 应为 ${round(expected)}`,
      `「${resultField}」应等于 ${label[op] ?? op}`,
      str(ctx.params, 'fix', '核对取数与计算口径；本条只做算术核对，不判断取数本身是否恰当'),
    )
  }

  // The aggregate case: when a factor lives only in the header, the header's own figures
  // are what there is to check. Run it only when no row could be checked, so a register
  // with a detail breakdown is never reported twice.
  if (usable.length > 0 || !headerUsable) return
  const headerDeclared = numberOf(valueOf(ctx.input, {} as Row, resultField)) ?? numberOf(ctx.input.header[resultField])
  const headerValues = fields.map((field) => numberOf(ctx.input.header[field]))
  if (headerDeclared === undefined || headerValues.some((value) => value === undefined)) {
    ctx.skip(`材料表头的「${resultField}」或 ${fields.join('、')} 无法解析为数值，无法核对表达式`)
    return
  }
  const numbers = headerValues as number[]
  const first = numbers[0] as number
  const rest = numbers.slice(1)
  let expectedHeader: number
  switch (op) {
    case 'divide':
      expectedHeader = rest.reduce((total, value) => total / value, first)
      break
    case 'product':
      expectedHeader = numbers.reduce((total, value) => total * value, 1)
      break
    case 'sum':
      expectedHeader = numbers.reduce((total, value, index) => total + (signs[index] ?? 1) * value, 0)
      break
    case 'subtract':
      expectedHeader = rest.reduce((total, value) => total - value, first)
      break
    default:
      expectedHeader = (first / (rest[0] ?? 1)) * 100
      break
  }
  expectedHeader *= scale
  if (Math.abs(headerDeclared - expectedHeader) <= tolerance) return
  ctx.add(
    locatorOf(undefined, resultField),
    `材料表头「${resultField}」为 ${headerDeclared}，按 ${label[op] ?? op} 应为 ${round(expectedHeader)}`,
    `表头「${resultField}」应等于 ${label[op] ?? op}`,
    str(ctx.params, 'fix', '核对取数与计算口径；本条只做算术核对，不判断取数本身是否恰当'),
  )
}

/** `capabilityIndex` — Cp and Cpk must follow from the limits, the mean and sigma. */
function capabilityIndex(ctx: CheckContext): void {
  const cpField = str(ctx.params, 'cpField')
  const cpkField = str(ctx.params, 'cpkField')
  const uslField = str(ctx.params, 'uslField')
  const lslField = str(ctx.params, 'lslField')
  const stdDevField = str(ctx.params, 'stdDevField')
  const meanField = str(ctx.params, 'meanField')
  if ([cpField, cpkField, uslField, lslField, stdDevField, meanField].some((field) => field === '')) {
    ctx.skip('规则库未配置 Cp/Cpk 定义式所需的字段名，本条不执行')
    return
  }
  const tolerance = optionalNumber(ctx.params, 'tolerance') ?? 0
  const usable = ctx.input.rows.filter(
    (row) =>
      (filled(valueOf(ctx.input, row, cpField)) || filled(valueOf(ctx.input, row, cpkField))) &&
      filled(valueOf(ctx.input, row, uslField)) &&
      filled(valueOf(ctx.input, row, lslField)) &&
      filled(valueOf(ctx.input, row, stdDevField)) &&
      filled(valueOf(ctx.input, row, meanField)),
  )
  if (usable.length === 0) {
    ctx.skip(`材料没有同时填写「${uslField}」「${lslField}」「${stdDevField}」「${meanField}」与能力指数的行，无法核对定义式`)
    return
  }
  const round = (value: number): number => Number(value.toFixed(4))
  for (const row of usable) {
    const usl = numberOf(valueOf(ctx.input, row, uslField))
    const lsl = numberOf(valueOf(ctx.input, row, lslField))
    const sigma = numberOf(valueOf(ctx.input, row, stdDevField))
    const mean = numberOf(valueOf(ctx.input, row, meanField))
    if (usl === undefined || lsl === undefined || sigma === undefined || mean === undefined || sigma <= 0) {
      ctx.add(
        locatorOf(row.row, cpkField),
        `第 ${row.row} 行的规格限、标准差或均值无法用于计算（标准差须大于零）`,
        `Cp 与 Cpk 应由规格限、均值与标准差按定义式算出`,
        '核对填写形式与标准差取值',
      )
      continue
    }
    const expectedCp = (usl - lsl) / (6 * sigma)
    const expectedCpk = Math.min(usl - mean, mean - lsl) / (3 * sigma)
    const actualCp = numberOf(valueOf(ctx.input, row, cpField))
    const actualCpk = numberOf(valueOf(ctx.input, row, cpkField))
    if (actualCp !== undefined && Math.abs(actualCp - expectedCp) > tolerance) {
      ctx.add(
        locatorOf(row.row, cpField),
        `第 ${row.row} 行 Cp 填报 ${actualCp}，按 (${usl} − ${lsl}) / (6 × ${sigma}) 应为 ${round(expectedCp)}`,
        'Cp = (USL − LSL) / 6σ',
        '核对标准差口径：Cp/Cpk 用组内标准差，Pp/Ppk 用总体标准差；本条只做算术核对',
      )
      continue
    }
    if (actualCpk === undefined || Math.abs(actualCpk - expectedCpk) <= tolerance) continue
    ctx.add(
      locatorOf(row.row, cpkField),
      `第 ${row.row} 行 Cpk 填报 ${actualCpk}，按 min(USL − X̄, X̄ − LSL) / 3σ 应为 ${round(expectedCpk)}`,
      'Cpk = min(USL − X̄, X̄ − LSL) / 3σ',
      '核对标准差口径与均值；本条只做算术核对，不判断能力是否足够',
    )
  }
}

/**
 * `controlLimits` — the limits must follow from the centre line, the dispersion
 * statistic and the chart constants declared in the rule pack.
 */
function controlLimits(ctx: CheckContext): void {
  const centerField = str(ctx.params, 'centerField')
  const rangeField = str(ctx.params, 'rangeField')
  const uclField = str(ctx.params, 'uclField')
  const lclField = str(ctx.params, 'lclField')
  const sizeField = str(ctx.params, 'sizeField')
  const rawTable = ctx.params.coefficients
  if (uclField === '' || lclField === '' || (centerField === '' && rangeField === '')) {
    ctx.skip('规则库未配置 centerField/rangeField 或控制限字段，本条不执行')
    return
  }
  if (typeof rawTable !== 'object' || rawTable === null || Array.isArray(rawTable)) {
    ctx.skip('规则库未配置 coefficients 常数表：控制图系数随图种变化，本引擎不硬编码')
    return
  }
  const table = rawTable as Record<string, unknown>
  const tolerance = optionalNumber(ctx.params, 'tolerance') ?? 0
  const usable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, uclField)) && filled(valueOf(ctx.input, row, lclField)),
  )
  if (usable.length === 0) {
    ctx.skip(`材料没有「${uclField}」与「${lclField}」，无法核对控制限`)
    return
  }
  let checked = 0
  for (const row of usable) {
    const key = sizeField === '' ? '' : (valueOf(ctx.input, row, sizeField) ?? '').trim()
    const entry = table[key]
    const coefficients =
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : undefined
    if (coefficients === undefined) {
      ctx.add(
        locatorOf(row.row, uclField),
        `第 ${row.row} 行的子组大小「${key === '' ? '（未填）' : key}」在常数表中没有对应档位`,
        '子组大小应为常数表覆盖的档位之一',
        '补齐子组大小，或把该档位的系数加进规则的 coefficients；本条只核对档位是否在册',
      )
      continue
    }
    const center = centerField === '' ? undefined : numberOf(valueOf(ctx.input, row, centerField))
    const dispersion = rangeField === '' ? undefined : numberOf(valueOf(ctx.input, row, rangeField))
    if (center === undefined || dispersion === undefined) continue
    checked += 1
    const a2 = typeof coefficients.a2 === 'number' ? coefficients.a2 : undefined
    const d3 = typeof coefficients.d3 === 'number' ? coefficients.d3 : 0
    const d4 = typeof coefficients.d4 === 'number' ? coefficients.d4 : 0
    const expectedUcl = a2 !== undefined ? center + a2 * dispersion : d4 * dispersion
    const expectedLcl = a2 !== undefined ? center - a2 * dispersion : d3 * dispersion
    const actualUcl = numberOf(valueOf(ctx.input, row, uclField))
    const actualLcl = numberOf(valueOf(ctx.input, row, lclField))
    if (actualUcl === undefined || actualLcl === undefined) {
      ctx.add(
        locatorOf(row.row, uclField),
        `第 ${row.row} 行的控制限不是可解析的数值`,
        '控制限应为数值',
        '核对填写形式',
      )
      continue
    }
    const round = (value: number): number => Number(value.toFixed(6))
    if (Math.abs(actualUcl - expectedUcl) <= tolerance && Math.abs(actualLcl - expectedLcl) <= tolerance) continue
    ctx.add(
      locatorOf(row.row, uclField),
      `第 ${row.row} 行控制限为 [${round(actualLcl)}, ${round(actualUcl)}]，而按系数表应为 [${round(expectedLcl)}, ${round(expectedUcl)}]`,
      `控制限应等于中心线与系数、极差的组合（子组大小 ${key} 对应系数 ${JSON.stringify(coefficients)}）`,
      '核对子组大小、极差与控制限的取数；本条只按配置的系数表做算术核对，不判断过程是否受控',
    )
  }
  if (checked === 0) {
    ctx.skip(`材料缺少「${centerField}」或「${rangeField}」，无法核对控制限与系数的一致性`)
  }
}

/** `derivedDays` — a day count must equal a date gap less a third value. */
function derivedDays(ctx: CheckContext): void {
  const daysField = str(ctx.params, 'daysField')
  const fromField = str(ctx.params, 'fromField')
  const toField = str(ctx.params, 'toField')
  const subtractField = str(ctx.params, 'subtractField')
  if (daysField === '' || fromField === '' || toField === '') {
    ctx.skip('规则库未配置 daysField、fromField 或 toField，本条不执行')
    return
  }
  const usable = ctx.input.rows.filter(
    (row) =>
      filled(valueOf(ctx.input, row, daysField)) &&
      filled(valueOf(ctx.input, row, fromField)) &&
      filled(valueOf(ctx.input, row, toField)) &&
      (subtractField === '' || filled(valueOf(ctx.input, row, subtractField))),
  )
  if (usable.length === 0) {
    ctx.skip(`材料没有同时填写「${daysField}」与起止日期的行，无法核对天数`)
    return
  }
  const tolerance = optionalNumber(ctx.params, 'tolerance') ?? 0
  for (const row of usable) {
    const declared = numberOf(valueOf(ctx.input, row, daysField))
    const from = parseWallClock(valueOf(ctx.input, row, fromField) ?? '')
    const to = parseWallClock(valueOf(ctx.input, row, toField) ?? '')
    const free = subtractField === '' ? 0 : numberOf(valueOf(ctx.input, row, subtractField))
    if (declared === undefined || from === undefined || to === undefined || free === undefined) {
      ctx.add(
        locatorOf(row.row, daysField),
        `第 ${row.row} 行的「${daysField}」或起止日期中有无法解析的值`,
        `「${daysField}」应等于起止日期之差${subtractField === '' ? '' : `减去「${subtractField}」`}`,
        '核对填写形式；本条只做算术核对',
      )
      continue
    }
    // The gap is computed in minutes and then expressed in days, so a span that starts and
    // ends on the same calendar day is measured properly. Using whole calendar days would
    // make every same-day span zero — a shift of eight hours would look like no time at all.
    // `diffMinutes` gives the absolute signed distance, which `WallClock.minutes` alone
    // cannot: that field holds only the time of day.
    const spanMinutes = diffMinutes(from, to)
    const derived = Math.max(0, spanMinutes / 1440 - free)
    const rounded = Number(derived.toFixed(6))
    if (Math.abs(rounded - declared) <= tolerance) continue
    ctx.add(
      locatorOf(row.row, daysField),
      `第 ${row.row} 行「${daysField}」填报 ${declared}，按「${toField}」${to.date}${to.hasTime ? ` ${to.time}` : ''} 减「${fromField}」${from.date}${from.hasTime ? ` ${from.time}` : ''}${subtractField === '' ? '' : ` 再减「${subtractField}」`} 应为 ${rounded} 天`,
      `「${daysField}」应等于起止时刻之差${subtractField === '' ? '' : `减去「${subtractField}」`}，单位为天`,
      '核对是否抄错或口径不同；本条只做算术核对，不判断起算口径是否正确',
    )
  }
}

/**
 * `sharedTerms` — two cells should share at least N terms.
 *
 * The weakest useful content check, and deliberately so: it looks for shared keywords
 * between a source text and its paraphrase, and reports only when there are none.
 * Paraphrase legitimately changes wording, so a finding means "these two columns look
 * unrelated, worth a human look" and never "the paraphrase is wrong". It also cannot
 * catch a paraphrase that is wrong while sharing vocabulary — a limit its rule's own
 * note states.
 */
function sharedTerms(ctx: CheckContext): void {
  const leftField = str(ctx.params, 'leftField')
  const rightField = str(ctx.params, 'rightField')
  const minShared = optionalNumber(ctx.params, 'minShared') ?? 1
  if (leftField === '' || rightField === '') {
    ctx.skip('规则库未配置 leftField 或 rightField，本条不执行')
    return
  }
  const usable = ctx.input.rows.filter(
    (row) => filled(valueOf(ctx.input, row, leftField)) && filled(valueOf(ctx.input, row, rightField)),
  )
  if (usable.length === 0) {
    ctx.skip(`材料没有同时填写「${leftField}」与「${rightField}」的行，本条不适用`)
    return
  }
  /**
   * Break text into comparable terms. CJK text has no spaces, so runs of Han
   * characters become overlapping bigrams — which is what makes a shared keyword
   * visible without a dictionary — while Latin words and digit runs compare whole.
   */
  const terms = (text: string): Set<string> => {
    const out = new Set<string>()
    for (const word of text.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? []) out.add(word)
    for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
      if (run.length === 1) out.add(run)
      for (let index = 0; index + 1 < run.length; index += 1) out.add(run.slice(index, index + 2))
    }
    return out
  }
  for (const row of usable) {
    const left = terms(valueOf(ctx.input, row, leftField) ?? '')
    const right = terms(valueOf(ctx.input, row, rightField) ?? '')
    if (left.size === 0 || right.size === 0) continue
    let shared = 0
    for (const term of right) if (left.has(term)) shared += 1
    if (shared >= minShared) continue
    ctx.add(
      locatorOf(row.row, rightField),
      `第 ${row.row} 行「${rightField}」与「${leftField}」没有共同词（共同词 ${shared} 个，配置下限 ${minShared} 个）`,
      `「${rightField}」应与「${leftField}」在字面上相关`,
      str(
        ctx.params,
        'fix',
        '本条只提示两栏看不出关系、值得人工复核，不断言提炼有误；同义改写会拉低共同词数，可调整 minShared',
      ),
    )
  }
}

/* -------------------------------------------------------------------- structure -- */

/** Find a version marker in text such as `PFMEA-001 V2` or `CP-003 版本B`. */
function versionToken(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const match =
    /(?:^|[\s(（[【])(?:版本|版次|rev(?:ision)?|ver(?:sion)?|v)\s*[:：]?\s*([A-Za-z]?\d+(?:\.\d+)?)\s*(?:版)?\s*$/i.exec(
      raw.trim(),
    )
  return match?.[1]
}

/** `referenceVersion` — a cited revision must match the document's current one. */
function referenceVersion(ctx: CheckContext): void {
  const referenceField = str(ctx.params, 'referenceField')
  const sameVersionField = str(ctx.params, 'sameVersionField')
  const actualCandidates = stringList(ctx.params, 'actualVersionField', 'actualVersionField')
  if (referenceField === '') {
    ctx.skip('规则库未配置 referenceField，本条不执行')
    return
  }
  if (sameVersionField === '' && actualCandidates.length === 0) {
    ctx.skip('规则库未配置 sameVersionField 或 actualVersionField，本条不执行')
    return
  }
  const usable = ctx.input.rows.filter((row) => filled(row.fields[referenceField]))
  if (usable.length === 0) {
    ctx.skip(`材料没有「${referenceField}」列或该列全为空，无法核对引用版本`)
    return
  }
  const currentVersion = (row: Row): string => {
    for (const candidate of actualCandidates) {
      const value = (row.fields[candidate] ?? '').trim()
      if (value !== '') return versionToken(value) ?? value
    }
    for (const candidate of actualCandidates) {
      const value = (ctx.input.header[candidate] ?? '').trim()
      if (value !== '') return versionToken(value) ?? value
    }
    return ''
  }
  const strip = (value: string): string => value.replace(/^[vV]/, '').trim().toLowerCase()
  let compared = 0
  for (const row of usable) {
    const expected = currentVersion(row)
    const declared =
      sameVersionField === ''
        ? versionToken(row.fields[referenceField])
        : (row.fields[sameVersionField] ?? '').trim()
    if (declared === undefined || declared === '' || expected === '') {
      ctx.add(
        locatorOf(row.row, referenceField),
        `第 ${row.row} 行引用了「${row.fields[referenceField]}」，但无法确定其版本或文件的现行版本`,
        '引用中应能看清版本，且文件应有可比的现行版本',
        '把引用版本单列一栏（sameVersionField），或在表头提供文件实际版本；本条只做版本串比对',
      )
      continue
    }
    compared += 1
    if (strip(declared) === strip(expected)) continue
    ctx.add(
      locatorOf(row.row, referenceField),
      `第 ${row.row} 行引用的版本「${declared}」与文件现行版本「${expected}」不一致`,
      '引用的版本应与该文件的现行版本一致',
      '核对是否还停在上一版；本条只比对版本串，不判断该引用应当指向哪一版',
    )
  }
  if (compared === 0) {
    ctx.skip(`材料中的「${referenceField}」既没有单独的版本栏，也没有可识别的版本串，无法核对引用版本`)
  }
}

/** `sameVersionWithinGroup` — rows naming one controlled document must agree on its revision. */
function sameVersionWithinGroup(ctx: CheckContext): void {
  const groupField = str(ctx.params, 'groupField')
  const versionField = str(ctx.params, 'versionField')
  if (groupField === '' || versionField === '') {
    ctx.skip('规则库未配置 groupField 或 versionField，本条不执行')
    return
  }
  const groups = new Map<string, { version: string; row: Row }[]>()
  for (const row of ctx.input.rows) {
    const group = (valueOf(ctx.input, row, groupField) ?? '').trim()
    const version = (valueOf(ctx.input, row, versionField) ?? '').trim()
    if (group === '' || version === '') continue
    const bucket = groups.get(group)
    if (bucket === undefined) groups.set(group, [{ version, row }])
    else bucket.push({ version, row })
  }
  if (groups.size === 0) {
    ctx.skip(`材料没有同时填写「${groupField}」与「${versionField}」的行，本条不适用`)
    return
  }
  const withSeveral = [...groups.entries()].filter(([, entries]) => entries.length > 1)
  if (withSeveral.length === 0) {
    ctx.skip(`材料中没有「${groupField}」出现多行的情况，无法核对版本是否一致`)
    return
  }
  for (const [group, entries] of withSeveral) {
    const versions = [...new Set(entries.map((entry) => entry.version))]
    if (versions.length <= 1) continue
    const first = entries[0] as { version: string; row: Row }
    ctx.add(
      locatorOf(first.row.row, versionField),
      `「${groupField}」为「${group}」的行声明了 ${versions.length} 个不同版本：${versions.join(' / ')}`,
      '同一份受控文件在同一台账内应只有一个版本',
      '核对是否该文件只被部分修订（版本未同步），或版本栏填写有误',
    )
  }
}

/** `monotonicSequence` — the configured order's items must appear in that order. */
function monotonicSequence(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const order = stringList(ctx.params, 'order', 'order')
  if (field === '') {
    ctx.skip('规则库未配置 field，本条不执行')
    return
  }
  if (order.length === 0) {
    ctx.skip('规则库未配置 order：环节清单与顺序由本机构管理办法规定，本引擎不硬编码')
    return
  }
  const rankOf = (value: string): number => {
    const trimmed = value.trim()
    const exact = order.indexOf(trimmed)
    if (exact >= 0) return exact
    // Tolerate a stage written with a trailing note: `招标（二次）` matches `招标`.
    return order.findIndex((candidate) => trimmed.startsWith(candidate))
  }
  const seen: { row: number; value: string; rank: number }[] = []
  for (const row of ctx.input.rows) {
    const value = (valueOf(ctx.input, row, field) ?? '').trim()
    if (value === '') continue
    const rank = rankOf(value)
    if (rank < 0) {
      ctx.add(
        locatorOf(row.row, field),
        `第 ${row.row} 行「${field}」为「${value}」，不在本机构配置的顺序表中`,
        `「${field}」应为顺序表中的环节之一：${order.join(' → ')}`,
        '核对该环节名称，或把本机构的环节补进顺序表；本条只按配置的顺序表核对',
      )
      continue
    }
    seen.push({ row: row.row, value, rank })
  }
  if (seen.length === 0) {
    ctx.skip(`材料没有可识别的「${field}」值，本条不适用`)
    return
  }
  for (let index = 1; index < seen.length; index += 1) {
    const previous = seen[index - 1] as { row: number; value: string; rank: number }
    const current = seen[index] as { row: number; value: string; rank: number }
    if (current.rank >= previous.rank) continue
    ctx.add(
      locatorOf(current.row, field),
      `第 ${current.row} 行「${field}」为「${current.value}」，出现在第 ${previous.row} 行的「${previous.value}」之后，与配置顺序相反`,
      `台账应按 ${order.join(' → ')} 的顺序登记`,
      '核对是否漏登记了中间环节，或两行的顺序填反；本条只按配置的顺序表核对',
    )
  }
}

/** `prefixOf` — a code's stated components must be its successive prefixes. */
function prefixOf(ctx: CheckContext): void {
  const field = str(ctx.params, 'field')
  const components = stringList(ctx.params, 'components', 'components')
  const digits = optionalNumber(ctx.params, 'digits')
  if (field === '' || components.length === 0) {
    ctx.skip('规则库未配置 field 或 components，本条不执行')
    return
  }
  const usable = ctx.input.rows.filter((row) => filled(row.fields[field]))
  if (usable.length === 0) {
    ctx.skip(`材料没有「${field}」列，本条不适用`)
    return
  }
  for (const row of usable) {
    const code = (valueOf(ctx.input, row, field) ?? '').replace(/\s/g, '')
    if (digits !== undefined && digits > 0 && code.length !== digits) {
      ctx.add(
        locatorOf(row.row, field),
        `第 ${row.row} 行「${field}」为「${code}」，共 ${code.length} 位，不是 ${digits} 位`,
        `「${field}」应为 ${digits} 位数字`,
        '核对位数；本条只核对层级结构，不判断归类是否正确',
      )
      continue
    }
    let previousLength = 0
    let broken = false
    for (const component of components) {
      const stated = (valueOf(ctx.input, row, component) ?? '').replace(/\s/g, '')
      if (stated === '') continue
      if (!code.startsWith(stated)) {
        ctx.add(
          locatorOf(row.row, component),
          `第 ${row.row} 行「${component}」为「${stated}」，不是「${field}」（${code}）的前缀`,
          `「${component}」应与「${field}」的前几位一致`,
          '核对层级填写；本条只核对前缀关系，不判断归类是否正确',
        )
        broken = true
        break
      }
      if (stated.length <= previousLength) {
        ctx.add(
          locatorOf(row.row, component),
          `第 ${row.row} 行「${component}」为「${stated}」，不比上一级更细（上一级 ${previousLength} 位）`,
          '层级应由粗到细、位数递增',
          '核对层级填写；本条只核对层级顺序，不判断归类是否正确',
        )
        broken = true
        break
      }
      previousLength = stated.length
    }
    if (broken) continue
  }
}

/* --------------------------------------------------------------------- dispatch -- */

/**
 * `thresholdCompare` — a verdict must agree with how the value compares to its limit.
 *
 * Definitional: if a measured result exceeds the limit the register itself records, the
 * register's own verdict must say so. It never supplies a limit — the limit comes from the
 * material — so it cannot find a limit taken from the wrong standard, which is a substantive
 * question the plugin leaves to the reader.
 */
function thresholdCompare(ctx: CheckContext): void {
  const valueField = str(ctx.params, 'valueField')
  const limitField = str(ctx.params, 'limitField')
  const verdictField = str(ctx.params, 'verdictField')
  const overValues = stringList(ctx.params, 'overValues', 'overValues')
  const atMostValues = stringList(ctx.params, 'atMostValues', 'atMostValues')
  if (valueField === '' || limitField === '' || verdictField === '') {
    ctx.skip('规则库未配置 valueField、limitField 或 verdictField，本条不执行')
    return
  }
  if (overValues.length === 0 || atMostValues.length === 0) {
    ctx.skip('规则库未配置 overValues 或 atMostValues：判定取值由本机构口径决定，本引擎不硬编码')
    return
  }
  const tolerance = optionalNumber(ctx.params, 'tolerance') ?? 0
  const usable = ctx.input.rows.filter(
    (row) =>
      filled(valueOf(ctx.input, row, valueField)) &&
      filled(valueOf(ctx.input, row, limitField)) &&
      filled(valueOf(ctx.input, row, verdictField)),
  )
  if (usable.length === 0) {
    ctx.skip(`材料没有同时填写「${valueField}」「${limitField}」与「${verdictField}」的行，本条不适用`)
    return
  }
  for (const row of usable) {
    const value = numberOf(valueOf(ctx.input, row, valueField))
    const limit = numberOf(valueOf(ctx.input, row, limitField))
    const verdict = (valueOf(ctx.input, row, verdictField) ?? '').trim()
    if (value === undefined || limit === undefined) {
      ctx.add(
        locatorOf(row.row, valueField),
        `第 ${row.row} 行的「${valueField}」或「${limitField}」无法解析为数值，无法与判定比对`,
        '两个数应可解析，判定应与它们的大小关系相符',
        '核对填写形式；本条只比对台账自己写的限值',
      )
      continue
    }
    const isOver = overValues.includes(verdict)
    const isAtMost = atMostValues.includes(verdict)
    if (!isOver && !isAtMost) {
      ctx.add(
        locatorOf(row.row, verdictField),
        `第 ${row.row} 行「${verdictField}」的值为「${verdict}」，不在配置的判定取值内`,
        `「${verdictField}」应为 ${overValues.join(' / ')}（超标）或 ${atMostValues.join(' / ')}（未超标）之一`,
        '补齐 overValues 或 atMostValues，或修正该栏；本条只核对取值是否在册',
      )
      continue
    }
    const actuallyOver = value > limit + tolerance
    if (actuallyOver === isOver) continue
    ctx.add(
      locatorOf(row.row, verdictField),
      `第 ${row.row} 行「${valueField}」为 ${value}、「${limitField}」为 ${limit}，而判定为「${verdict}」`,
      actuallyOver
        ? `${value} 超过限值 ${limit}，判定应表示超标`
        : `${value} 未超过限值 ${limit}，判定应表示未超标`,
      '核对三个数值与判定；本条只按台账自己写的限值比较，不判断该限值是否取对了标准',
    )
  }
}

/**
 * `dateGap` — a later date must be at least N days after an earlier one.
 *
 * Built for a waiting period between two events the register already records: an
 * application date and a harvest date with a withdrawal period between them. The N comes
 * from the material, so the check makes no claim about what the period *should* be.
 */
function dateGap(ctx: CheckContext): void {
  const earlierField = str(ctx.params, 'earlierField')
  const laterField = str(ctx.params, 'laterField')
  const minDaysField = str(ctx.params, 'minDaysField')
  const minDaysLiteral = optionalNumber(ctx.params, 'minDays')
  if (earlierField === '' || laterField === '' || (minDaysField === '' && minDaysLiteral === undefined)) {
    ctx.skip('规则库未配置 earlierField、laterField 与 minDays/minDaysField，本条不执行')
    return
  }
  const usable = ctx.input.rows.filter(
    (row) =>
      filled(valueOf(ctx.input, row, earlierField)) &&
      filled(valueOf(ctx.input, row, laterField)) &&
      (minDaysField === '' || filled(valueOf(ctx.input, row, minDaysField))),
  )
  if (usable.length === 0) {
    ctx.skip(
      `材料没有同时填写「${earlierField}」「${laterField}」${minDaysField === '' ? '' : `「${minDaysField}」`} 的行，本条不适用`,
    )
    return
  }
  let checked = 0
  for (const row of usable) {
    const earlier = parseWallClock(valueOf(ctx.input, row, earlierField) ?? '')
    const later = parseWallClock(valueOf(ctx.input, row, laterField) ?? '')
    const required = minDaysField === '' ? minDaysLiteral : numberOf(valueOf(ctx.input, row, minDaysField))
    if (earlier === undefined || later === undefined || required === undefined) {
      ctx.add(
        locatorOf(row.row, laterField),
        `第 ${row.row} 行的「${earlierField}」「${laterField}」或「${minDaysField}」中有无法解析的值`,
        '两个日期应可解析，间隔天数应为数值',
        '核对填写形式；本条只做日期间隔核对',
      )
      continue
    }
    checked += 1
    const gap = diffMinutes(earlier, later) / 1440
    if (gap + 1e-9 >= required) continue
    ctx.add(
      locatorOf(row.row, laterField),
      `第 ${row.row} 行「${laterField}」为 ${later.date}，距「${earlierField}」${earlier.date} 只有 ${Number(gap.toFixed(4))} 天，少于${minDaysField === '' ? '配置的' : `「${minDaysField}」的`} ${required} 天`,
      `「${laterField}」应不早于「${earlierField}」之后 ${required} 天`,
      str(ctx.params, 'fix', '核对三个字段的填写；本条只按台账自己写的间隔天数核对，不判断该天数是否恰当'),
    )
  }
  if (checked === 0) {
    ctx.skip(
      `材料中的「${earlierField}」「${laterField}」${minDaysField === '' ? '' : `「${minDaysField}」`} 没有可解析的组合，无法核对间隔`,
    )
  }
}

/** Run one check by its declared kind. */
function runOneCheck(ctx: CheckContext): void {
  const kind = str(ctx.params, 'kind')
  switch (kind) {
    case 'presence':
      return presence(ctx)
    case 'presenceAny':
      return presenceAny(ctx)
    case 'enum':
      return enumCheck(ctx)
    case 'pattern':
      return patternCheck(ctx)
    case 'date':
      return dateCheck(ctx)
    case 'noFutureDate':
      return noFutureDate(ctx)
    case 'dataAge':
      return dataAge(ctx)
    case 'number':
      return numberCheck(ctx)
    case 'unique':
      return uniqueCheck(ctx)
    case 'sequence':
      return sequenceCheck(ctx)
    case 'sum':
      return sumCheck(ctx)
    case 'sumToConstant':
      return sumToConstant(ctx)
    case 'countPerGroup':
      return countPerGroup(ctx)
    case 'textContains':
      return textContains(ctx)
    case 'containsAny':
      return containsAny(ctx)
    case 'length':
      return lengthCheck(ctx)
    case 'minLength':
      return minLength(ctx)
    case 'headerPresence':
      return headerPresence(ctx)
    case 'headerEnum':
      return headerEnum(ctx)
    case 'conditionalPresence':
      return conditionalPresence(ctx)
    case 'highRiskEvidence':
      return highRiskEvidence(ctx)
    case 'thresholdPresence':
      return thresholdPresence(ctx)
    case 'thresholdBelow':
      return thresholdBelow(ctx)
    case 'fieldComparison':
      return fieldComparison(ctx)
    case 'intervalOrder':
      return intervalOrder(ctx)
    case 'productOf':
      return productOf(ctx)
    case 'formula':
      return formula(ctx)
    case 'capabilityIndex':
      return capabilityIndex(ctx)
    case 'controlLimits':
      return controlLimits(ctx)
    case 'derivedDays':
      return derivedDays(ctx)
    case 'sharedTerms':
      return sharedTerms(ctx)
    case 'referenceVersion':
      return referenceVersion(ctx)
    case 'sameVersionWithinGroup':
      return sameVersionWithinGroup(ctx)
    case 'monotonicSequence':
      return monotonicSequence(ctx)
    case 'prefixOf':
      return prefixOf(ctx)
    case 'thresholdCompare':
      return thresholdCompare(ctx)
    case 'dateGap':
      return dateGap(ctx)
    default:
      ctx.skip(
        kind === ''
          ? '规则库未配置 check.kind，本条不执行'
          : `规则库配置的 check.kind「${kind}」不是本引擎支持的检查类型，本条不执行`,
      )
  }
}

/** Run every rule, collecting issues and the reasons rules did not run. */
function runChecks(
  input: TableInput,
  ruleset: Ruleset,
  options: TableCheckOptions,
): { issues: Issue[]; fired: Set<string>; reasons: Map<string, string> } {
  const issues: Issue[] = []
  const reasons = new Map<string, string>()
  const fired = new Set<string>()
  const disabled = new Set([...ruleset.disabled, ...options.disabledRules])
  const only = new Set(options.onlyRules)

  for (const rule of ruleset.rules) {
    // A disabled or unselected rule must not run at all. This loop used to ignore
    // both sets, so `disabledRules` and `onlyRules` only changed the `skipped`
    // list: the report carried findings for rules it simultaneously said had not
    // executed. A caller asking for one rule got all of them, plus a sentence
    // claiming the others never ran - a contradiction no reader can resolve, and
    // the kind of bug that looks like a passing test (both halves are "true").
    if (disabled.has(rule.id) || (only.size > 0 && !only.has(rule.id))) continue
    // A check reads its settings from one flat bag, layered in a fixed order: the
    // rule's own top-level params, then `params.check` (where the pack declares the
    // check), then the per-call override last so it wins.
    const declaredCheck =
      typeof rule.params.check === 'object' && rule.params.check !== null && !Array.isArray(rule.params.check)
        ? (rule.params.check as Record<string, unknown>)
        : {}
    const check: Record<string, unknown> = { ...rule.params, ...declaredCheck }
    delete check.check
    const override = options.overrides?.[rule.id]
    if (override !== undefined) Object.assign(check, override)
    delete check.check

    const ctx: CheckContext = {
      input,
      ruleId: rule.id,
      params: check,
      options,
      add: (locator, found, expected, fix) => {
        const issue: Issue = {
          id: issueId(ruleset.plugin, rule.id, locator),
          ruleId: rule.id,
          severity: rule.severity,
          locator,
          found,
          expected,
          basis: formatBasis(rule.basis, rule.alsoBasis ?? []),
        }
        if (fix !== undefined) issue.fix = fix
        issues.push(issue)
        fired.add(rule.id)
      },
      skip: (reason) => {
        reasons.set(rule.id, reason)
      },
    }
    runOneCheck(ctx)
  }

  return { issues, fired, reasons }
}

/** One skipped entry per disabled rule, whether or not the pack declares it. */
function disabledAsSkipped(ruleset: Ruleset, disabled: string[], note: (reason: string) => string) {
  const byId = new Map(ruleset.rules.map((rule) => [rule.id, rule]))
  const out = []
  for (const ruleId of disabled) {
    const rule = byId.get(ruleId)
    out.push({
      rule: rule === undefined ? ruleId : rule.id,
      reason: note(rule === undefined ? '配置中禁用了该规则，但规则库中没有这一条' : '该规则在当前配置中被禁用'),
    })
  }
  return out
}

/**
 * Run a rule pack against a normalized table.
 * @param input - the table, with canonical field names attached.
 * @param ruleset - the validated rule pack.
 * @param options - plugin identity, clock value, rule selection and overrides.
 * @returns the report, with `skipped` listing every check that did not run.
 */
export function runTableCheck(input: TableInput, ruleset: Ruleset, options: TableCheckOptions): Report {
  const disabled = new Set([...ruleset.disabled, ...options.disabledRules])
  const only = new Set(options.onlyRules)
  const { issues, fired, reasons } = runChecks(input, ruleset, options)

  const withNote = (reason: string): string =>
    options.skipNotes === undefined || options.skipNotes === '' ? reason : `${reason}；${options.skipNotes}`
  const skipped = disabledAsSkipped(ruleset, [...disabled], withNote)
  const already = new Set(skipped.map((entry) => entry.rule))
  for (const [ruleId, reason] of reasons) {
    if (already.has(ruleId)) continue
    if (disabled.has(ruleId) || (only.size > 0 && !only.has(ruleId))) continue
    skipped.push({ rule: ruleId, reason: withNote(reason) })
    already.add(ruleId)
  }
  // A rule that ran and found nothing is NOT a skipped rule. The old code
  // pushed it here with "材料满足...未发现差异", and the view then labelled the
  // whole block "未执行的检查" — turning executed-clean into "did not run".
  // `skipped` now carries only rules that genuinely could not execute.
  if (only.size > 0) {
    const notSelected = ruleset.rules.filter((rule) => !only.has(rule.id) && !disabled.has(rule.id))
    if (notSelected.length > 0) {
      skipped.push({
        rule: notSelected.map((rule) => rule.id).join(','),
        reason: withNote(`本次调用通过 only 参数把执行范围限制为 ${[...only].join(', ')}，上列规则未执行`),
      })
    }
  }

  const summary: Record<Severity, number> = { error: 0, warn: 0, info: 0 }
  for (const issue of issues) summary[issue.severity] += 1

  return {
    plugin: options.plugin,
    target: input.target,
    checkedAt: options.checkedAt,
    rulesetVersion: ruleset.version,
    summary,
    issues,
    skipped,
  }
}

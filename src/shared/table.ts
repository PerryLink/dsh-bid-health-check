/**
 * Generic reader for table-shaped check plugins.
 *
 * Pairs with `rows.ts`: that module runs the checks, this one builds the table it
 * runs them on. A plugin supplies a column alias map and gets back a `TableInput`,
 * so the twenty-odd table plugins share one reader instead of each re-implementing
 * JSON/YAML detection, numeric coercion and the "which columns did I actually
 * see" diagnostic.
 *
 * The reader is deliberately strict about one thing: when the material carries
 * **none** of the aliases it was given, it refuses rather than guessing. A reader
 * that silently picks a column produces findings about the wrong data, which is
 * worse than an error message that names the columns it saw.
 */

import { YamlSubsetError, parseYaml } from './yaml.ts'
import type { Row, TableInput } from './rows.ts'

/** Raised when the material cannot be read at all. */
export class MaterialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaterialError'
  }
}

/** How one plugin describes its table. */
export interface TableSpec {
  /** Top-level list keys that hold the rows, in priority order. */
  rowKeys: readonly string[]
  /**
   * Column aliases per field, keyed by the field's canonical name. A field's
   * value is set on the row when any alias matches, case-insensitively and
   * ignoring spaces, underscores and hyphens.
   */
  columns: Record<string, readonly string[]>
  /**
   * Aliases for the row's own display number, when the export carries one.
   * Defaults to `['row', '序号', '行号']`.
   */
  rowNumberColumns?: readonly string[]
  /**
   * Fields that must appear somewhere in the material for the reader to accept
   * it. When omitted, any one of `columns`' fields is enough.
   */
  requireAnyOf?: readonly string[]
  /** Header keys copied to `TableInput.header`, in priority order per field. */
  header?: Record<string, readonly string[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Render a scalar cell as text, dropping values that carry nothing. */
export function cellText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  return undefined
}

/** The comparison key for a column or field name. */
function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[\s\u3000_-]/g, '')
}

/** Find a cell by any of its aliases, exact name first, then normalised. */
function pick(fields: Record<string, string>, aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const direct = fields[alias]
    if (direct !== undefined && direct !== '') return direct
  }
  const normalised = new Map(Object.keys(fields).map((key) => [normaliseName(key), key]))
  for (const alias of aliases) {
    const key = normalised.get(normaliseName(alias))
    if (key === undefined) continue
    const value = fields[key]
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

/**
 * Parse one material into a table.
 *
 * @param source - JSON or YAML text.
 * @param target - description of where the material came from.
 * @param spec - the plugin's table shape.
 * @returns the normalized table.
 */
export function parseTable(source: string, target: string, spec: TableSpec): TableInput {
  const trimmed = source.trim()
  if (trimmed === '') throw new MaterialError('材料为空')
  let document: unknown
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      document = JSON.parse(trimmed)
    } catch (error) {
      throw new MaterialError(`JSON 无法解析：${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    try {
      document = parseYaml(trimmed)
    } catch (error) {
      if (error instanceof YamlSubsetError) throw new MaterialError(`YAML 无法解析：${error.message}`)
      throw error
    }
  }

  const warnings: string[] = []
  let list: unknown
  const header: Record<string, string> = {}
  let topLevel: Record<string, unknown> = {}

  if (Array.isArray(document)) {
    list = document
  } else if (isRecord(document)) {
    topLevel = document
    for (const key of spec.rowKeys) {
      const candidate = document[key]
      if (candidate !== undefined && candidate !== null) {
        list = candidate
        break
      }
    }
    // Scalar top-level values are header fields, matched by their aliases.
    const scalars: Record<string, string> = {}
    for (const [key, value] of Object.entries(document)) {
      const rendered = cellText(value)
      if (rendered !== undefined) scalars[key] = rendered
    }
    for (const [field, aliases] of Object.entries(spec.header ?? {})) {
      const value = pick(scalars, aliases)
      if (value !== undefined) header[field] = value
    }
    // Keep every scalar available, so a check can name a header key directly.
    for (const [key, value] of Object.entries(scalars)) {
      if (header[key] === undefined) header[key] = value
    }
  } else {
    throw new MaterialError('材料根节点必须是映射或列表')
  }

  if (list === undefined || list === null) {
    throw new MaterialError(
      `材料缺少 ${spec.rowKeys.join(' / ')} 任一列表，无法执行检查`,
    )
  }
  if (!Array.isArray(list)) throw new MaterialError(`${spec.rowKeys[0] ?? 'rows'} 必须是列表`)
  if (list.length === 0) throw new MaterialError(`${spec.rowKeys[0] ?? 'rows'} 为空列表，无法执行检查`)

  const rowNumberColumns = spec.rowNumberColumns ?? ['row', '序号', '行号']
  const rows: Row[] = list.map((entry, index) => {
    if (!isRecord(entry)) throw new MaterialError(`${spec.rowKeys[0] ?? 'rows'}[${index}] 必须是映射`)
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(entry)) {
      // Keep the key when the cell is blank: which columns exist is what tells
      // the reader whether it was handed the shape it asked for.
      if (value === undefined || value === null) continue
      if (isRecord(value) || Array.isArray(value)) continue
      fields[key] = typeof value === 'string' ? value.trim() : (cellText(value) ?? '')
    }
    const row: Row = { row: index + 1, fields }
    const declared = cellText(entry[rowNumberColumns[0] as string]) ?? pick(fields, rowNumberColumns)
    if (declared !== undefined && /^\d+$/.test(declared)) row.row = Number.parseInt(declared, 10)
    return row
  })

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row.fields)))]
  const expected = spec.requireAnyOf ?? [...new Set(Object.values(spec.columns).flat())]
  const known = new Set(expected.map(normaliseName))
  if (!columns.some((column) => known.has(normaliseName(column)))) {
    throw new MaterialError(
      `材料中没有可识别的字段，已识别的列名为：${columns.join(' / ') || '（无）'}；` +
        `已按以下名称查找：${expected.join(' / ')}`,
    )
  }

  return { target, header, rows, columns, warnings }
}

/**
 * Copy a material's recognized column values onto canonical field keys, and record
 * which canonical fields the material actually carried.
 *
 * Row-level checks read `row.fields[field]`, so a plugin calls this once per row to
 * make the aliases available under their canonical names. The original keys stay in
 * place, which keeps a finding able to name the column it actually read.
 *
 * A field whose cell is blank is still **marked as provided** — with an empty value —
 * because the difference between "this column is missing" and "this column is present
 * but unchecked" is exactly what a presence check has to report. Assigning nothing
 * would make an empty column indistinguishable from an absent one, and the check would
 * silently pass.
 *
 * @param row - the row to extend, in place.
 * @param spec - the same spec the reader was given.
 * @returns the same row, for chaining.
 */
export function canonicaliseRow(row: Row, spec: TableSpec): Row {
  for (const [field, aliases] of Object.entries(spec.columns)) {
    const existing = row.fields[field]
    if (existing !== undefined && existing !== '') continue
    const value = pick(row.fields, aliases)
    if (value !== undefined) {
      row.fields[field] = value
      continue
    }
    // No value to copy: mark the field as carried when one of its aliases appears
    // among the row's own keys, even if that cell is blank.
    const normalised = new Set(Object.keys(row.fields).map(normaliseName))
    if (aliases.some((alias) => normalised.has(normaliseName(alias)))) row.fields[field] = ''
  }
  return row
}

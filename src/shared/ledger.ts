/**
 * Ledger record access for rule engines.
 *
 * A "ledger" is the tabular input most plugins actually receive: one row per
 * event, with heterogeneous, partially missing columns. Rule engines read
 * fields by canonical key, need to know whether a value was present or blank,
 * and must be able to say precisely which row and column a finding came from.
 */

import type { Locator } from './report.ts'

/** One row of material, keyed by canonical field name. */
export interface LedgerRow {
  /** 1-based row number in the source, excluding the header. */
  row: number
  /** Canonical field values, already trimmed. */
  values: Record<string, string>
  /** Fields the extractor could not map to a canonical key. */
  unmapped: Record<string, string>
  /** Source file, when the ledger came from one file. */
  file?: string
}

/** A parsed ledger plus the extraction diagnostics the report must disclose. */
export interface Ledger {
  rows: LedgerRow[]
  /** Header cells that matched no canonical field. */
  unknownColumns: string[]
  /** Canonical fields declared required but absent from the header entirely. */
  missingColumns: string[]
}

/** Read a value from a row, or `undefined` when blank or absent. */
export function value(row: LedgerRow, key: string): string | undefined {
  const raw = row.values[key]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Locator pointing at a cell of a ledger row. */
export function cellLocator(row: LedgerRow, column: string): Locator {
  const locator: Locator = { row: row.row, column }
  if (row.file !== undefined) locator.file = row.file
  return locator
}

/** Numeric interpretation of a cell, tolerating thousands separators. */
export function num(row: LedgerRow, key: string): number | undefined {
  const raw = value(row, key)
  if (raw === undefined) return undefined
  const cleaned = raw.replace(/[,，\s]/g, '')
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return undefined
  return Number.parseFloat(cleaned)
}

/** True when the cell was present but not a valid number. */
export function isNonNumeric(row: LedgerRow, key: string): boolean {
  const raw = value(row, key)
  return raw !== undefined && num(row, key) === undefined
}

/** Render a cell for the `found` field, marking absence explicitly. */
export function describe(row: LedgerRow, key: string): string {
  const raw = value(row, key)
  return raw === undefined ? '（空）' : raw
}

/** Aggregate counts over a set of rows. */
export function countBy<T extends string>(rows: readonly LedgerRow[], key: string, buckets: readonly T[]): Record<T, number> {
  const out = Object.fromEntries(buckets.map((bucket) => [bucket, 0])) as Record<T, number>
  for (const row of rows) {
    const found = value(row, key)
    if (found !== undefined && buckets.includes(found as T)) out[found as T] += 1
  }
  return out
}

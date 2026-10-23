/**
 * Shared compliance kit for the `dsh-*` checker plugin family.
 *
 * This directory is the single source of truth. `scripts/sync-shared.mjs`
 * mirrors it into `<plugin>/src/shared/` so that every published plugin package
 * stays self-contained (no `../` imports across package boundaries), while the
 * family still shares exactly one implementation of the output contract, the
 * wording guard, the rule-pack validator, the calendar helpers and the
 * document extractors.
 */

export * from './report.ts'
export * from './wording.ts'
export * from './render.ts'
export * from './yaml.ts'
export * from './rules.ts'
export * from './ruleset.ts'
export * from './datetime.ts'
export * from './tree.ts'
export * from './dictionary.ts'
export * from './ledger.ts'
export * from './memo.ts'

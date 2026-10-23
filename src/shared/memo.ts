/**
 * Memoized loading of package-owned rule packs.
 *
 * Rule packs ship with the plugin, are read-only at runtime and are small, so
 * they are parsed once per process and reused. Keeping the reads here means the
 * pure check core still receives a plain `Ruleset` value and stays testable
 * without a plugin context.
 */

import { readFile } from 'node:fs/promises'
import { loadRuleset } from './ruleset.ts'
import type { Ruleset } from './rules.ts'

const cache = new Map<string, Promise<Ruleset>>()

/**
 * Load and cache a rule pack by absolute path.
 * @param path - absolute path to the rule-pack YAML.
 * @returns the validated ruleset.
 */
export function loadRulesetFile(path: string): Promise<Ruleset> {
  const cached = cache.get(path)
  if (cached !== undefined) return cached
  const pending = readFile(path, 'utf8').then((text) => loadRuleset(text))
  cache.set(path, pending)
  pending.catch(() => cache.delete(path))
  return pending
}

/** Drop the in-process rule-pack cache (test helper). */
export function clearRulesetCache(): void {
  cache.clear()
}

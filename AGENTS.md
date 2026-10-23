# AGENTS.md

Standalone DeepSeek Harness checker plugin repository (`dsh-bid-health-check`). Development follows the
dsh-plugin-guide skill and the official plugin contract; this file records repo-local decisions.

## Layout

- `src/index.ts` — function-plugin contract (`name`/`inject`/`Config`/`apply`; no default export).
  Registers the `bid_health_check` tool and resolves the packaged rule pack.
- `src/config.ts` — Schemastery schema. Every tunable lives here; nothing is hard-coded.
- `src/check.ts` — the pure check core, `(input, ruleset, options) => Report`. No plugin context,
  no I/O, no clock and no model access, so the whole rule set is unit-testable without credentials.
- `src/parse.ts` — reader for the canonical material (JSON or YAML).
- `src/view.ts` — the model-facing projection of a report; `output.schema` in `index.ts` mirrors it.
- `src/shared/` — the shared kit (ruleset loader, report shape, YAML subset, calendar arithmetic,
  wording guard, table helpers). Copied in, not imported: the package must be self-contained.
- `rules/bid-health-check.yaml` — the rule pack, 8 rules.
- `rules/evidence/` — the clause-verification record for every citation the pack makes.
- `tests/` — vitest; every rule has a paired compliant/violating fixture under `tests/fixtures/<RULE>/`.

## Hard rules applied here

- **The rule pack is data, not code.** Replacing `rules/*.yaml` switches the rule set without
  touching TypeScript. The pack is validated on load, not trusted.
- **No fabricated citations.** Every rule carries `document` / `number` / `clause` / `excerpt` /
  `kind` / `source`, and `excerpt` must be a **verbatim** quotation. When the verbatim text could
  not be obtained the pack says so in the excerpt and marks the rule
  `derived-from-principle` — it never paraphrases a clause and presents it as a quotation.
- **Severity follows the evidence, not the wish.** `derived-from-principle` is capped at `warn`;
  `institutional-configuration` (a threshold that comes from your institution rather than a
  national standard) is capped at `info`. A test asserts this.
- **An empty issue list can never be read as "nothing is wrong".** Every check that could not run
  is reported in `skipped` with its reason, and a rule whose required list is unset reports itself
  in `skipped` rather than passing silently.
- **No adjudicating wording.** The rendered report never pronounces on compliance, liability or
  correctness; it lists differences for a human to review. A wording guard enforces this and the
  report always carries the disclaimer.
- Rule ids follow `BH-NNN`.

## Build and checks

```sh
pnpm run typecheck && pnpm test && pnpm run build && pnpm run verify:self-contained && pnpm run check:lockfile && pnpm run check:readmes && pnpm pack
```

`prepublishOnly` re-runs the gate, so a release cannot ship an unbuilt or drifted tree.

## Docs

Five-language READMEs (`README.md`, `README-zh.md`, `README-es.md`, `README-pt.md`,
`README-hi.md`). The English file is the source of truth; `check:readmes` holds the other four to
the same `## ` section count, the same install command and the same configuration keys.

## Publishing

Push a `v<version>` tag matching `package.json`; `.github/workflows/publish.yml` re-runs the
gate and publishes to npm with provenance, then cuts a GitHub Release.

## License

Apache-2.0. Every file in this repository is covered by it.

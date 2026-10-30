# dsh-bid-health-check — Bid health check (Español)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-bid-health-check?metric=downloads)](https://dshfind.com/en/plugins/PerryLink/dsh-bid-health-check?ref=badge)

`dsh-bid-health-check` lee un `RequirementsPack` y un documento de oferta, e informa — requisito por requisito — dónde la oferta parece responder, dónde la coincidencia es débil y dónde no se localizó nada.

La forma honesta de esa pregunta es más estrecha que «¿está completa la oferta?». La herramienta puede localizar un párrafo o no localizarlo; no puede saber si ese párrafo satisface el requisito, y no puede concluir que un requisito no localizado esté sin responder.

## Install

```sh
dsh plugin --profile <name> add dsh-bid-health-check
dsh --profile <name> --dump-config | grep 'dsh-bid-health-check'
```

## What it looks like

![Workflow diagram for dsh-bid-health-check: document → rule pack → findings.](docs/assets/dsh-bid-health-check-flow.svg)

*Workflow overview: document → rule pack → findings.*

**Límite:** tres frases que esta herramienta no dice. No dice «la oferta está completa». No dice «no localizado significa ausente»: la oferta puede responder en una tabla, un anexo o con otras palabras. Y no dice «respondido significa conforme». No lee tablas, escaneos ni anexos.

## What it answers

- ¿Qué requisitos tienen un párrafo que plausiblemente los responde?
- ¿Qué coincidencias son solo una frase compartida?
- ¿Qué requisitos no tienen respuesta localizada?
- ¿Qué requisitos no pueden comprobarse porque el pliego sigue sin resolver?

## Standards it follows

El paquete no cita cláusulas como base de un hallazgo: localiza texto, no comprueba cumplimiento. Dos reglas vienen del diseño: una cláusula de rechazo es una condición, no una frase que se responda, así que nunca se puntúa como `responded`; y un requisito en cola C se reporta como bloqueado por el pliego, no se evalúa contra el licitador.

## Compatibility

| Surface | Status |
|---|---|
| Harness | peer range `>=0.1.2-rc.1 <0.2.0 \|\| >=0.2.0-0 <0.3.0` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | all (pure ESM; no native code, no network, no model call) |

## What it does

For each requirement the tool measures the longest substring shared with each bid paragraph. A title overlap must reach five characters; a tie goes to the longer paragraph, because a heading repeats the label while the body states the fact. An overlap found only in the requirement quote is capped at weak.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `rulesFile` | `rules/bid-health-check.yaml` | 规则库路径 |

## Material format

Two inputs: `pack` (the RequirementsPack JSON, or YAML with an items array) and `file` (the bid .docx). Paragraphs come from `dsh-table-ingest`.

## Rule sources

Quotations live in the pack this tool consumes. Known limits, all visible in the report: only paragraphs are read; matching is by shared substring, so a paraphrased response is reported as not located; and a located paragraph is a pointer for a human, not a verdict.

## Troubleshooting

- **The plugin installs but the tool never appears**: check that `main` resolves to `lib/index.mjs` and that `pnpm run build` produced it.
- **`dsh plugin add` rejects the package**: the peer range covers `0.1.x` and `0.2.x`; outside it, grant an explicit exemption.
- **A rule did not run**: read the `skipped` array.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
node ../scripts/sync-shared.mjs dsh-bid-health-check
```

## PerryLink DSH Plugin Family

Full family index: [choose a checker by material](https://perrylink.github.io/zh/checkers/choose/) and [all plugins](https://github.com/PerryLink). This repository is one of them.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-bid-health-check contributors.

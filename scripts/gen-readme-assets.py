#!/usr/bin/env python3
"""Generate README image assets for dsh-bid-health-check (docs/assets/).

Outputs (idempotent overwrite):
  dsh-bid-health-check-flow-light.svg
  dsh-bid-health-check-flow-dark.svg
      Hero pipeline diagram. This is a no-UI plugin, so the figure is a
      hand-written vector SVG (never rasterized to webp). Text inside is
      command-surface tokens only (bid_health_check, RequirementsPack,
      responded/weak/not-located, timeoutMs), so all five README languages
      share the same pair.

The repository has no benchmark data and no UI screenshots, therefore no
evidence chart and no webp output. If raster evidence is added later, probe a
CJK font first (Pillow renders Chinese as tofu boxes without one) and save with
``quality=90``.

Run once:  python scripts/gen-readme-assets.py
"""
from __future__ import annotations

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
FAMILY_DARK = "#2B3245"
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
AMBER = {"light": "#bc4c00", "dark": "#d29922"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}

# Text is deliberately limited to command tokens: every label below is an
# event, a command, a config key or a result state, never a prose sentence.
FLOW_NODES = [
    ("RequirementsPack", "items[] · tier"),
    ("bid.docx", "dsh-table-ingest"),
    ("bid_health_check", "common substring"),
    ("≥5 chars", "title · quote"),
    ("responded", "weak · not-located"),
]


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    w, h = 1200, 420
    nw, nh, gap = 200, 104, 28
    x0, y0 = 44, 166
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" '
        f'aria-label="dsh-bid-health-check data flow">',
        '<title>dsh-bid-health-check data flow</title>',
        f'<rect width="{w}" height="{h}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="60" y="62" fill="{s["text"]}" font-family="ui-sans-serif,'
        f'system-ui,sans-serif" font-size="30" font-weight="700">'
        f'dsh-bid-health-check</text>',
        f'<text x="60" y="94" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="16">RequirementsPack + bid.docx → '
        f'bid_health_check → responded | weak | not-located</text>',
        f'<line x1="60" y1="118" x2="1140" y2="118" stroke="{s["border"]}"/>',
    ]

    for i, (label, sub) in enumerate(FLOW_NODES):
        x = x0 + i * (nw + gap)
        if i in (0, 1):
            accent = s["border"]
        elif i == 2:
            accent = FAMILY
        elif i == 3:
            accent = AMBER[skin]
        else:
            accent = GREEN[skin]
        badge = accent if i >= 2 else s["sub"]
        parts.append(
            f'<rect x="{x}" y="{y0}" width="{nw}" height="{nh}" rx="14" '
            f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>')
        parts.append(
            f'<circle cx="{x + 26}" cy="{y0 + 26}" r="12" fill="{badge}"/>')
        parts.append(
            f'<text x="{x + 26}" y="{y0 + 31}" fill="{s["bg"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="12" font-weight="700">{i + 1}</text>')
        parts.append(
            f'<text x="{x + 16}" y="{y0 + 66}" fill="{s["text"]}" '
            f'font-family="ui-monospace,monospace" font-size="16" '
            f'font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + 16}" y="{y0 + 88}" fill="{s["sub"]}" '
            f'font-family="ui-monospace,monospace" font-size="12">{sub}</text>')
        if i < len(FLOW_NODES) - 1:
            ax = x + nw + 5
            ay = y0 + nh // 2
            parts.append(
                f'<path d="M{ax} {ay}h{gap - 10}" stroke="{s["sub"]}" '
                f'stroke-width="3"/>')
            parts.append(
                f'<path d="M{ax + gap - 12} {ay - 7}l10 7-10 7" fill="none" '
                f'stroke="{s["sub"]}" stroke-width="3" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')

    # Inputs-to-tool and result-state legend, expressed as tokens only.
    parts.append(
        f'<rect x="44" y="304" width="1112" height="62" rx="12" '
        f'fill="{s["track"]}" stroke="{s["border"]}"/>')
    parts.append(
        f'<text x="60" y="332" fill="{s["text"]}" font-family="ui-monospace,'
        f'monospace" font-size="14">timeoutMs 120000 · tools:register · '
        f'network: none · writes: none</text>')
    parts.append(
        f'<text x="60" y="354" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="13">tier: C → blockedByPack · not-located '
        f'≠ missing · responded ≠ compliant</text>')
    parts.append(
        f'<text x="60" y="398" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="12">dsh-bid-health-check · Apache-2.0 · '
        f'PerryLink DSH plugin family</text>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        path = os.path.join(OUT, f"dsh-bid-health-check-flow-{skin}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    print("wrote 2 SVG assets to docs/assets/")


if __name__ == "__main__":
    main()

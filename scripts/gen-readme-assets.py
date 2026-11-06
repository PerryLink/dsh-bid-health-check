#!/usr/bin/env python3
"""README visuals for dsh-bid-health-check, derived from this plugin's real pipeline.

Two figures, both read off the shipped material rather than a generic checker
template:

  hero 1440x576 (Pillow; zh/en x light/dark, four WebP files)
      Left column: kicker / title / two value lines / one subtitle / one meta
      line / footer.  Right side: the plugin's own material graph.  A
      RequirementsPack card (items[] 11, tier A/B/C) and a bid .docx card
      (paragraphs read by dsh-table-ingest, P8 highlighted because three
      requirements point at it) sit above an overlap ruler.  Under the ruler:
      the three verdict cards, with the real quickstart counts 2 / 3 / 6 and a
      real id -> paragraph reference each.  The third card says "not missing"
      in words, because that is the whole point of the tool.

  flow 1100x660 (hand-written SVG; light/dark, two files)
      Grammar: DUAL-CHANNEL MERGE.  Two input channels (RequirementsPack items,
      bid paragraphs) converge on one overlap-measure gate -- longest common
      substring, <4 falls back to the quote, >=5 locates, ties take the longer
      paragraph.  Three caps demote a located hit (heading <=12 chars,
      quote-only >=6 chars, category reject-clause), and the gate fans out to
      the three states.  A bottom bypass rail carries tier C: it never enters
      the measure, is reported as blockedByPack, stays inside not-located, and
      the bidder is never graded on it.  Nothing is a row of five boxes.

Values are not invented.  They come from:
  samples/quickstart/input/pack.json          (11 items, TRQ-* ids, tier C = 1)
  samples/quickstart/input/bid-sample.docx    (12 paragraphs, the excerpts)
  samples/quickstart/expected/result.json     (responded 2 / weak 3 /
                                               not-located 6 / blockedByPack 1)
  src/model.ts                                (thresholds 4 / 5 / 6, caps,
                                               tie-break, tier-C pass-through)
  src/report.ts                               (group order not-located ->
                                               weak -> responded, disclaimer)
  src/index.ts                                (tool id, inject ['tools'],
                                               timeoutMs default 120000)
and the verdicts of the four examples drawn were replayed from src/model.ts
against the sample pair, so TRQ-HDR-008 -> P6 at 5 chars is `responded`, while
TRQ-HDR-011 -> P8 at 12 chars is still `weak` (quote-only).

Every label is measured before it is drawn; a label that would overflow aborts
the run instead of shipping clipped text.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow, and the Windows fonts msyh.ttc / msyhbd.ttc / consola.ttf /
           consolab.ttf.  The SVG pair is plain text.
"""
from __future__ import annotations

import os
from xml.sax.saxutils import escape as xml_escape

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")
NAME = "dsh-bid-health-check"

FONT_CJK = r"C:\Windows\Fonts\msyh.ttc"
FONT_CJK_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
FONT_MONO_BOLD = r"C:\Windows\Fonts\consolab.ttf"

MISSING = [FONT_CJK, FONT_CJK_BOLD, FONT_MONO, FONT_MONO_BOLD]
for _f in MISSING:
    if not os.path.exists(_f):
        raise SystemExit(f"missing font: {_f}")

_FONTS: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    key = (path, size)
    if key not in _FONTS:
        _FONTS[key] = ImageFont.truetype(path, size)
    return _FONTS[key]


# --------------------------------------------------------------------------
# Material: real sample values, replayed from src/model.ts.
# --------------------------------------------------------------------------
# (id, title, tier) from samples/quickstart/input/pack.json
PACK_ROWS = [
    ("TRQ-HDR-008", "投标保证金", "A"),
    ("TRQ-HDR-011", "密封要求", "A"),
    ("TRQ-REJ-001", "采购人、采购代理机构应当拒收", "B"),
    ("TRQ-REJ-005", "投标有效期不足的按无效投标处理", "C"),
]
# (marker, excerpt) from samples/quickstart/input/bid-sample.docx
DOC_ROWS = [
    ("¶6", "…缴纳投标保证金伍万元整。"),
    ("¶8", "投标文件已按招标文件要求密封，并在封口处加盖公章。"),
    ("¶10", "本投标有效期为投标截止之日起 90 日历天。"),
    ("¶12", "我方承诺遵守一切相关规定。"),
]
# Shorter verbatim fragments for the 1100-wide flow, where 13px leaves ~196px.
FLOW_DOC_ROWS = [
    ("¶6", "…缴纳投标保证金伍万元整。"),
    ("¶8", "…按招标文件要求密封…"),
    ("¶10", "…投标截止之日起 90 日历天"),
]
COUNTS = {"responded": 2, "weak": 3, "notLocated": 6, "blocked": 1}


# --------------------------------------------------------------------------
# Palette
# --------------------------------------------------------------------------
def rgb(value: str | tuple[int, ...]) -> tuple[int, int, int]:
    if isinstance(value, tuple):
        return tuple(value[:3])  # type: ignore[return-value]
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


LIGHT = dict(
    bg_top="#f9f6fd", bg_bottom="#e4eaf8",
    text="#16161e", sub="#4a5063", muted="#8a90a2",
    family="#4B67B4", family_deep="#2b3f79", family_soft="#eceaf8",
    card=(255, 255, 255, 238), border="#e2ddf0", track="#f4f1fb",
    shadow=(43, 36, 64), shadow_alpha=34,
    responded="#15803d", responded_soft="#e9f6ef",
    weak="#b45309", weak_soft="#fdf1e3",
    notl="#5e5287", notl_soft="#f1eef8",
    dot="#cfc8e2",
)
DARK = dict(
    bg_top="#131a2a", bg_bottom="#0c1016",
    text="#f2f4fb", sub="#b4bdd2", muted="#7e879c",
    family="#8496f5", family_deep="#b9c4ff", family_soft="#232c47",
    card=(26, 33, 51, 240), border="#2b3548", track="#1f2638",
    shadow=(0, 0, 0), shadow_alpha=96,
    responded="#6fd6a4", responded_soft="#17322a",
    weak="#e8b45a", weak_soft="#33280f",
    notl="#b9a9e8", notl_soft="#26213a",
    dot="#2a3346",
)


def skin_colors(skin: str) -> dict:
    return LIGHT if skin == "light" else DARK


def gradient(w: int, h: int, top: str, bottom: str) -> Image.Image:
    """Diagonal two-stop gradient rendered small and upscaled."""
    c0, c1 = rgb(top), rgb(bottom)
    small = Image.new("RGB", (96, 48))
    px = small.load()
    for y in range(48):
        for x in range(96):
            t = 0.45 * (x / 95.0) + 0.55 * (y / 47.0)
            px[x, y] = tuple(round(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
    return small.resize((w, h), Image.BICUBIC)


def soft_glow(size: tuple[int, int], skin: str) -> Image.Image:
    w, h = size
    s = skin_colors(skin)
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    fam = rgb(s["family"])
    alpha = 26 if skin == "light" else 70
    g.ellipse((w * 0.52, -h * 0.42, w * 1.12, h * 0.78), fill=fam + (alpha,))
    g.ellipse((-w * 0.2, h * 0.45, w * 0.55, h * 1.35), fill=fam + (alpha // 2,))
    return glow.filter(ImageFilter.GaussianBlur(130))


def draw_dots(base: Image.Image, skin: str, step: int = 26) -> None:
    s = skin_colors(skin)
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    col = rgb(s["dot"])
    alpha = 90 if skin == "light" else 70
    for y in range(12, base.height, step):
        for x in range(12, base.width, step):
            d.ellipse((x, y, x + 2, y + 2), fill=col + (alpha,))
    base.alpha_composite(overlay)


def panel(base: Image.Image, box: tuple[int, int, int, int], radius: int, skin: str,
          shadow: bool = True, fill: tuple[int, int, int, int] | None = None) -> None:
    s = skin_colors(skin)
    x0, y0, x1, y1 = box
    if shadow:
        layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        d.rounded_rectangle((x0, y0 + 7, x1, y1 + 9), radius=radius,
                            fill=rgb(s["shadow"]) + (s["shadow_alpha"],))
        base.alpha_composite(layer.filter(ImageFilter.GaussianBlur(16)))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=radius, fill=fill or s["card"],
                        outline=s["border"], width=1)


def need(s: str, f: ImageFont.FreeTypeFont, maxw: float, where: str) -> float:
    w = f.getlength(s)
    if w > maxw + 0.5:
        raise SystemExit(f"overflow [{where}]: {w:.1f} > {maxw:.1f} :: {s!r}")
    return w


# --------------------------------------------------------------------------
# Hero
# --------------------------------------------------------------------------
HERO_COPY = {
    "zh": dict(
        kicker="DeepSeek Harness 插件 · 投标响应定位",
        title=["投标文件体检"], title_size=88, title_baselines=[238],
        values=["把每条要求对回投标文件，逐条给落点",
                "第三种不是「缺失」，C 队列不评投标人"],
        value_baselines=[302, 344],
        subtitle="≥5 字命中；标题式、仅原文、废标条款封顶 weak",
        subtitle_baseline=396,
        divider=418, meta="bid_health_check · timeoutMs 120000 · 纯本地",
        meta_baseline=452,
        footer="Apache-2.0 · 不联网 · 不调用模型 · 不写文件",
        footer_baseline=504,
        pack_header="要求清单", pack_meta="items[] 11",
        pack_sub="RequirementsPack · tier A/B/C",
        pack_foot="+7 条 · tier A 8 / B 2 / C 1",
        doc_header="投标文件", doc_meta="dsh-table-ingest",
        doc_sub=".docx → paragraphs[12] · 段落只读",
        doc_foot="表格 / 扫描页 / 附件不计入",
        measure_label="重合尺",
        measure_meta="最长公共子串 · 平局取更长段",
        measure_note="≥5 字命中 · <4 回退原文 · 仅原文 ≥6 封顶 weak",
        tokens=["responded", "weak", "not-located"],
        labels=["看起来有响应", "响应可疑", "定位不到"],
        glosses=["标题 ≥5 字重合，只是一段指针",
                 "标题式 / 仅原文 / 废标条款封顶",
                 "≠ 没写：可能写在表格、附件或换说法"],
        examples=[["TRQ-HDR-008 → ¶6 · 5 字", "TRQ-HDR-009 → ¶10 · 5 字"],
                  ["HDR-011 → ¶8 · 12 字", "REJ-001 → ¶8 · 8 字"],
                  ["REJ-003 · HDR-006 · HDR-007", "HDR-010 · REJ-004 · tier C"]],
        bottom="tier C 1 条 → blockedByPack，不评投标人 · 报告顺序：定位不到 → 响应可疑 → 看起来有响应",
    ),
    "en": dict(
        kicker="DeepSeek Harness plugin · bid response locator",
        title=["Bid health", "check"], title_size=84, title_baselines=[212, 300],
        values=["Every requirement, located in the bid",
                "Three states; the third is not \"missing\""],
        value_baselines=[352, 394],
        subtitle="≥5-char match; three cases cap at weak",
        subtitle_baseline=436,
        divider=456, meta="bid_health_check · timeoutMs 120000 · local",
        meta_baseline=490,
        footer="Apache-2.0 · no network · no model · no writes",
        footer_baseline=532,
        pack_header="Requirements", pack_meta="items[] 11",
        pack_sub="RequirementsPack · tier A/B/C",
        pack_foot="+7 more · A 8 / B 2 / C 1",
        doc_header="Bid document", doc_meta="dsh-table-ingest",
        doc_sub=".docx → paragraphs[12] · read-only",
        doc_foot="tables / scans / appendices not read",
        measure_label="Overlap",
        measure_meta="longest substring · tie → longer ¶",
        measure_note="≥5 chars locates · <4 falls back to quote · quote-only ≥6 caps at weak",
        tokens=["responded", "weak", "not-located"],
        labels=["looks answered", "needs a human look", "could not locate"],
        glosses=["title overlap ≥5 chars — a pointer",
                 "heading / quote-only / reject cap",
                 "≠ missing: may sit in a table"],
        examples=[["TRQ-HDR-008 → ¶6 · 5 chars", "TRQ-HDR-009 → ¶10 · 5 chars"],
                  ["HDR-011 → ¶8 · 12 chars", "REJ-001 → ¶8 · 8 chars"],
                  ["REJ-003 · HDR-006 · HDR-007", "HDR-010 · REJ-004 · tier C"]],
        bottom="tier C ×1 → blockedByPack, never graded · report order: not-located → weak → responded",
    ),
}


def hero_left(base: Image.Image, skin: str, lang: str) -> None:
    s = skin_colors(skin)
    c = HERO_COPY[lang]
    d = ImageDraw.Draw(base)
    text_col, sub_col, muted = rgb(s["text"]), rgb(s["sub"]), rgb(s["muted"])
    fam = rgb(s["family"])

    # kicker pill
    fk = font(FONT_CJK_BOLD, 19)
    kw = fk.getlength(c["kicker"])
    need(c["kicker"], fk, 560, "kicker")
    d.rounded_rectangle((64, 68, 64 + kw + 36, 106), radius=19,
                        fill=rgb(s["family_soft"]), outline=rgb(s["family"]) + (90,), width=1)
    d.ellipse((78, 82, 88, 92), fill=fam)
    d.text((98, 94), c["kicker"], font=fk, fill=rgb(s["family_deep"]), anchor="ls")

    # title
    ft = font(FONT_CJK_BOLD, c["title_size"])
    for line, baseline in zip(c["title"], c["title_baselines"]):
        need(line, ft, 576, "title")
        d.text((64, baseline), line, font=ft, fill=text_col, anchor="ls")

    # two value lines
    fv = font(FONT_CJK_BOLD, 27)
    for value, baseline in zip(c["values"], c["value_baselines"]):
        need(value, fv, 576, "value")
        d.text((64, baseline), value, font=fv, fill=text_col, anchor="ls")

    # subtitle
    fs = font(FONT_CJK, 25)
    need(c["subtitle"], fs, 576, "subtitle")
    d.text((64, c["subtitle_baseline"]), c["subtitle"], font=fs, fill=sub_col, anchor="ls")

    # divider
    d.line((64, c["divider"], 600, c["divider"]), fill=rgb(s["border"]), width=1)

    # meta
    fm = font(FONT_CJK, 21)
    need(c["meta"], fm, 576, "meta")
    d.text((64, c["meta_baseline"]), c["meta"], font=fm, fill=muted, anchor="ls")

    # footer
    ff = font(FONT_CJK, 17)
    need(c["footer"], ff, 576, "footer")
    d.text((64, c["footer_baseline"]), c["footer"], font=ff, fill=muted, anchor="ls")


def hero_right(base: Image.Image, skin: str, lang: str) -> None:
    s = skin_colors(skin)
    c = HERO_COPY[lang]
    d = ImageDraw.Draw(base)
    text_col, sub_col, muted = rgb(s["text"]), rgb(s["sub"]), rgb(s["muted"])
    fam = rgb(s["family"])

    # ---- card A: RequirementsPack -------------------------------------
    pack = (664, 64, 1004, 254)
    panel(base, pack, 20, skin)
    d = ImageDraw.Draw(base)
    fh = font(FONT_CJK_BOLD, 16)
    d.text((684, 96), c["pack_header"], font=fh, fill=text_col, anchor="ls")
    fm = font(FONT_MONO, 10)
    d.text((984, 96), c["pack_meta"], font=fm, fill=muted, anchor="rs")
    need(c["pack_sub"], font(FONT_MONO, 10), 290, "pack_sub")
    d.text((684, 114), c["pack_sub"], font=font(FONT_MONO, 10), fill=muted, anchor="ls")

    f_id = font(FONT_MONO, 10)
    f_title = font(FONT_CJK, 11)
    f_tier = font(FONT_MONO_BOLD, 9)
    for index, (rid, title, tier) in enumerate(PACK_ROWS):
        baseline = 138 + index * 28
        d.text((684, baseline), rid, font=f_id,
               fill=text_col if tier != "C" else muted, anchor="ls")
        need(title, f_title, 174, "pack title")
        d.text((764, baseline), title, font=f_title,
               fill=text_col if tier != "C" else muted, anchor="ls")
        # tier chip
        chip_fill = rgb(s["responded_soft"]) if tier == "A" else (
            rgb(s["weak_soft"]) if tier == "B" else rgb(s["track"]))
        chip_col = rgb(s["responded"]) if tier == "A" else (
            rgb(s["weak"]) if tier == "B" else muted)
        d.rounded_rectangle((958, baseline - 13, 984, baseline + 4), radius=8,
                            fill=chip_fill, outline=rgb(s["border"]), width=1)
        d.text((971, baseline - 1), tier, font=f_tier, fill=chip_col, anchor="ms")
    d.text((684, 246), c["pack_foot"], font=font(FONT_CJK, 10.5), fill=muted, anchor="ls")

    # ---- card B: bid document -----------------------------------------
    doc = (1020, 64, 1392, 254)
    panel(base, doc, 20, skin)
    d = ImageDraw.Draw(base)
    d.text((1040, 96), c["doc_header"], font=fh, fill=text_col, anchor="ls")
    d.text((1372, 96), c["doc_meta"], font=font(FONT_MONO, 10), fill=muted, anchor="rs")
    need(c["doc_sub"], font(FONT_CJK, 10), 320, "doc_sub")
    d.text((1040, 114), c["doc_sub"], font=font(FONT_CJK, 10), fill=muted, anchor="ls")
    fpara = font(FONT_CJK, 11.5)
    fmark = font(FONT_MONO, 9)
    for index, (marker, body) in enumerate(DOC_ROWS):
        baseline = 140 + index * 28
        highlight = marker == "¶8"
        if highlight:
            d.rounded_rectangle((1032, baseline - 16, 1380, baseline + 6), radius=7,
                                fill=rgb(s["family_soft"]))
        d.text((1040, baseline), marker, font=fmark,
               fill=fam if highlight else muted, anchor="ls")
        need(body, fpara, 300, "doc body")
        d.text((1072, baseline), body, font=fpara,
               fill=text_col if highlight else sub_col, anchor="ls")
    d.text((1040, 246), c["doc_foot"], font=font(FONT_CJK, 10.5), fill=muted, anchor="ls")

    # ---- overlap ruler -------------------------------------------------
    ruler = (664, 266, 1392, 350)
    panel(base, ruler, 18, skin)
    d = ImageDraw.Draw(base)
    fl = font(FONT_CJK_BOLD, 13)
    d.text((684, 292), c["measure_label"], font=fl, fill=text_col, anchor="ls")
    meta_x = 684 + fl.getlength(c["measure_label"]) + 18
    need(c["measure_meta"], font(FONT_CJK, 10), 960 - meta_x - 14, "measure_meta")
    d.text((meta_x, 292), c["measure_meta"], font=font(FONT_CJK, 10), fill=muted, anchor="ls")

    rx0, rx1, ry = 960, 1352, 304
    unit = (rx1 - rx0) / 12.0
    d.rounded_rectangle((rx0, ry - 3, rx1, ry + 3), radius=3, fill=rgb(s["track"]))
    d.rounded_rectangle((rx0 + 5 * unit, ry - 3, rx1, ry + 3), radius=3,
                        fill=fam + (70,))
    for unit_index in range(13):
        tx = rx0 + unit_index * unit
        major = unit_index % 2 == 0
        d.line((tx, ry - (6 if major else 3), tx, ry + (10 if major else 7)),
               fill=rgb(s["muted"]) if not major else rgb(s["sub"]), width=1)
    for unit_index, label in ((0, "0"), (2, "2"), (4, "4"), (5, "5"), (6, "6"),
                              (8, "8"), (10, "10"), (12, "12")):
        tx = rx0 + unit_index * unit
        is_threshold = label == "5"
        d.text((tx, 326), label, font=font(FONT_MONO_BOLD if is_threshold else FONT_MONO, 9),
               fill=fam if is_threshold else muted, anchor="ms")
    d.line((rx0 + 5 * unit, ry - 14, rx0 + 5 * unit, ry + 14), fill=fam, width=2)
    d.ellipse((rx0 + 5 * unit - 4, ry - 4, rx0 + 5 * unit + 4, ry + 4), fill=fam)
    d.text((rx0 + 5 * unit + 9, ry - 12), "≥5", font=font(FONT_MONO_BOLD, 10), fill=fam, anchor="ls")
    need(c["measure_note"], font(FONT_CJK, 10.5), 690, "measure_note")
    d.text((684, 340), c["measure_note"], font=font(FONT_CJK, 10.5), fill=muted, anchor="ls")

    # ---- three verdict cards ------------------------------------------
    cards = [(664, 224), (902, 224), (1140, 252)]
    state_colors = [rgb(s["responded"]), rgb(s["weak"]), rgb(s["notl"])]
    state_soft = [s["responded_soft"], s["weak_soft"], s["notl_soft"]]
    counts = [COUNTS["responded"], COUNTS["weak"], COUNTS["notLocated"]]
    for index, ((cx, cw), colour, soft) in enumerate(zip(cards, state_colors, state_soft)):
        box = (cx, 362, cx + cw, 486)
        panel(base, box, 18, skin)
        d = ImageDraw.Draw(base)
        right = cx + cw - 20
        # accent bar
        d.rounded_rectangle((cx + 1, 374, cx + 5, 410), radius=2, fill=colour)
        d.text((cx + 20, 384), c["tokens"][index], font=font(FONT_MONO_BOLD, 10),
               fill=colour, anchor="ls")
        need(c["labels"][index], font(FONT_CJK_BOLD, 15), cw - 60, "verdict label")
        d.text((cx + 20, 408), c["labels"][index], font=font(FONT_CJK_BOLD, 15),
               fill=text_col, anchor="ls")
        d.text((right, 410), str(counts[index]), font=font(FONT_CJK_BOLD, 36),
               fill=colour, anchor="rs")
        need(c["glosses"][index], font(FONT_CJK, 11), cw - 40, "gloss")
        d.text((cx + 20, 430), c["glosses"][index], font=font(FONT_CJK, 11),
               fill=rgb(s["sub"]), anchor="ls")
        for line_index, example in enumerate(c["examples"][index]):
            need(example, font(FONT_MONO, 10), cw - 40, "example")
            d.text((cx + 20, 448 + line_index * 16), example,
                   font=font(FONT_MONO, 10), fill=rgb(s["muted"]), anchor="ls")
        d.rounded_rectangle((cx, 470, cx + cw, 470), radius=0, fill=rgb(soft))

    # bottom note
    need(c["bottom"], font(FONT_CJK, 11), 728, "bottom note")
    d.text((664, 516), c["bottom"], font=font(FONT_CJK, 11), fill=muted, anchor="ls")


def make_hero(lang: str, skin: str) -> Image.Image:
    s = skin_colors(skin)
    base = gradient(1440, 576, s["bg_top"], s["bg_bottom"]).convert("RGBA")
    base.alpha_composite(soft_glow((1440, 576), skin))
    draw_dots(base, skin)
    hero_left(base, skin, lang)
    hero_right(base, skin, lang)
    return base.convert("RGB")


# --------------------------------------------------------------------------
# Flow SVG
# --------------------------------------------------------------------------
SANS = "'Microsoft YaHei','Segoe UI','PingFang SC','Noto Sans CJK SC',sans-serif"
MONO = "Consolas,'Microsoft YaHei',ui-monospace,monospace"


def svg_fit(s: str, size: float, maxw: float, mono: bool = False, where: str = "") -> str:
    probe = font(FONT_MONO if mono else FONT_CJK, max(8, int(round(size))))
    w = probe.getlength(s)
    if w > maxw + 0.5:
        raise SystemExit(f"overflow [{where}]: {w:.1f} > {maxw:.1f} :: {s!r}")
    return s


def esc(s: str) -> str:
    return xml_escape(s, {"'": "&apos;"})


def svg_text(x: float, y: float, s: str, size: float, fill: str, *,
             weight: int = 400, mono: bool = False, anchor: str = "start",
             spacing: float = 0, opacity: float = 1.0) -> str:
    fam = MONO if mono else SANS
    extra = f' letter-spacing="{spacing}"' if spacing else ""
    extra += f' opacity="{opacity}"' if opacity != 1.0 else ""
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{fam}" '
            f'font-size="{size}" font-weight="{weight}" fill="{fill}" '
            f'text-anchor="{anchor}"{extra}>{esc(s)}</text>')


class Flow:
    def __init__(self, skin: str) -> None:
        self.skin = skin
        self.s = skin_colors(skin)
        self.parts: list[str] = []

    def add(self, *chunks: str) -> None:
        self.parts.extend(chunks)

    def rect(self, x: float, y: float, w: float, h: float, r: float,
             fill: str, stroke: str | None = None, sw: float = 1.2,
             shadow: bool = False, opacity: float = 1.0, dash: str | None = None) -> None:
        shadow_attr = ' filter="url(#soft)"' if shadow else ""
        stroke_attr = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        op = f' opacity="{opacity}"' if opacity != 1.0 else ""
        self.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
                 f'rx="{r}" fill="{fill}"{stroke_attr}{dash_attr}{shadow_attr}{op}/>')

    def line(self, x1: float, y1: float, x2: float, y2: float, stroke: str,
             sw: float = 1.0, opacity: float = 1.0, dash: str | None = None) -> None:
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        op = f' opacity="{opacity}"' if opacity != 1.0 else ""
        self.add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                 f'stroke="{stroke}" stroke-width="{sw}"{dash_attr}{op} stroke-linecap="round"/>')

    def path(self, d: str, stroke: str, sw: float = 2.0, opacity: float = 1.0,
             dash: str | None = None, fill: str = "none") -> None:
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        op = f' opacity="{opacity}"' if opacity != 1.0 else ""
        self.add(f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" '
                 f'stroke-linecap="round" stroke-linejoin="round"{dash_attr}{op}/>')

    def circle(self, cx: float, cy: float, r: float, fill: str,
               stroke: str | None = None, sw: float = 1.0) -> None:
        stroke_attr = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        self.add(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="{fill}"{stroke_attr}/>')


def make_flow(skin: str) -> str:
    s = skin_colors(skin)
    f = Flow(skin)
    fam = s["family"]
    text = s["text"]
    sub = s["sub"]
    muted = s["muted"]
    border = s["border"]
    card = "#ffffff" if skin == "light" else "#1a2233"
    track = "#f4f1fb" if skin == "light" else "#1f2638"
    soft_fam = "#eceaf8" if skin == "light" else "#232c47"
    green, amber, plum = s["responded"], s["weak"], s["notl"]
    green_soft = s["responded_soft"]
    amber_soft = s["weak_soft"]
    plum_soft = s["notl_soft"]

    # header ------------------------------------------------------------
    f.add('<?xml version="1.0" encoding="UTF-8"?>')
    f.add(f'<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="660" '
          f'viewBox="0 0 1100 660" role="img" aria-labelledby="title desc">')
    f.add('<title id="title">dsh-bid-health-check dual-channel merge</title>')
    f.add('<desc id="desc">RequirementsPack items and bid .docx paragraphs merge into one '
          'longest-common-substring measure: under 4 characters falls back to the requirement '
          'quote, 5 or more locates a paragraph and ties take the longer one. Three caps keep a '
          'located hit at weak: a heading of 12 characters or fewer, overlap with the quote only '
          'at 6 or more, or a reject-clause category. The gate fans out to responded, weak and '
          'not-located; the quickstart run gives 2, 3 and 6. A bypass rail carries the tier C '
          'requirement: it never enters the measure, is reported as blockedByPack, stays inside '
          'the not-located group, and the bidder is never graded on it.</desc>')
    f.add('<defs>')
    f.add(f'<linearGradient id="bg" x1="0" y1="0" x2="0.25" y2="1">'
          f'<stop offset="0" stop-color="{s["bg_top"]}"/>'
          f'<stop offset="1" stop-color="{s["bg_bottom"]}"/></linearGradient>')
    f.add('<filter id="soft" x="-25%" y="-25%" width="150%" height="170%">'
          f'<feDropShadow dx="0" dy="7" stdDeviation="9" flood-color="#241f33" '
          f'flood-opacity="{0.12 if skin == "light" else 0.55}"/></filter>')
    f.add(f'<pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">'
          f'<circle cx="1.2" cy="1.2" r="1.2" fill="{s["dot"]}"/></pattern>')
    f.add(f'<linearGradient id="chan" x1="0" y1="0" x2="1" y2="0">'
          f'<stop offset="0" stop-color="{fam}" stop-opacity="0.25"/>'
          f'<stop offset="1" stop-color="{fam}" stop-opacity="0.8"/></linearGradient>')
    f.add('</defs>')
    f.add('<rect width="1100" height="660" fill="url(#bg)"/>')
    f.add('<rect width="1100" height="660" fill="url(#dots)" opacity="0.5"/>')

    # header text
    f.add(svg_text(28, 52, svg_fit("Two channels, one measure, three states", 26, 640, where="title"),
                   26, text, weight=700))
    f.add(svg_text(28, 78,
                   svg_fit("pack items[] + .docx paragraphs → one longest-common-substring measure; "
                           "caps demote a hit; tier C bypasses.", 13.5, 860, where="subtitle"),
                   13.5, sub))
    # top-right config chip
    chip_label = "rules: [] · timeoutMs 120000"
    f.add(svg_text(1072, 48, svg_fit(chip_label, 11, 220, mono=True, where="chip"),
                   11, fam, mono=True, anchor="end"))
    f.add(svg_text(1072, 68, "inject ['tools'] · local only", 11, muted, mono=True, anchor="end"))
    f.add(f'<line x1="28" y1="90" x2="1072" y2="90" stroke="{border}" stroke-width="1" opacity="0.8"/>')

    # ---- channel A: bid document --------------------------------------
    f.rect(28, 100, 266, 178, 18, card, border, 1.2, shadow=True)
    f.add(svg_text(46, 126, "Bid .docx", 15, text, weight=700))
    f.add(svg_text(276, 126, "dsh-table-ingest", 11, muted, mono=True, anchor="end"))
    f.add(svg_text(46, 146, svg_fit(".docx → paragraphs[12]", 11, 200, mono=True, where="doc sub"),
                   11, muted, mono=True))
    for index, (marker, body) in enumerate(FLOW_DOC_ROWS):
        baseline = 176 + index * 30
        if marker == "¶8":
            f.rect(38, baseline - 16, 248, 25, 7, soft_fam)
        f.add(svg_text(46, baseline, marker, 11, fam if marker == "¶8" else muted, mono=True))
        f.add(svg_text(76, baseline, svg_fit(body, 13, 196, where="doc row"),
                       13, text if marker == "¶8" else sub))
    f.add(svg_text(46, 266, "tables / scans not read", 11, muted, mono=True))

    # ---- channel B: RequirementsPack ----------------------------------
    f.rect(28, 290, 266, 206, 18, card, border, 1.2, shadow=True)
    f.add(svg_text(46, 316, "RequirementsPack", 15, text, weight=700))
    f.add(svg_text(276, 316, "items[] 11", 11, muted, mono=True, anchor="end"))
    f.add(svg_text(46, 336, "id · tier · title / quote", 11, muted, mono=True))

    for index, (rid, title, tier) in enumerate(PACK_ROWS):
        base_y = 352 + index * 32
        is_c = tier == "C"
        row_col = muted if is_c else text
        if is_c:
            f.line(36, base_y - 14, 36, base_y + 20, plum, 2, dash="3 3")
        f.add(svg_text(46, base_y, rid, 11, row_col, mono=True))
        f.add(svg_text(276, base_y, f"tier {tier}", 11,
                       amber if tier == "B" else (muted if is_c else green), mono=True, anchor="end"))
        f.add(svg_text(46, base_y + 16, svg_fit(title, 13, 218, where="pack title"),
                       13, row_col))
    f.add(svg_text(46, 486, "+7 more · A 8 / B 2 / C 1", 11, muted, mono=True))

    # merge channels
    f.path("M294 189 C 336 189, 344 300, 380 300", "url(#chan)", 2.6)
    f.path("M294 393 C 336 393, 344 300, 380 300", "url(#chan)", 2.6)
    f.circle(294, 189, 3.4, fam)
    f.circle(294, 393, 3.4, fam)
    f.circle(380, 300, 4.2, fam, card, 2)

    # ---- measure gate --------------------------------------------------
    f.rect(380, 100, 332, 396, 18, card, border, 1.2, shadow=True)
    f.add(svg_text(398, 126, "Overlap measure", 15, text, weight=700))
    f.add(svg_text(694, 126, "bid_health_check", 11, fam, mono=True, anchor="end"))

    # formula block
    f.rect(398, 138, 296, 74, 12, track)
    f.add(svg_text(410, 160, svg_fit("commonRun(title, ¶) → best", 11.5, 270, mono=True, where="formula1"),
                   11.5, text, mono=True))
    f.add(svg_text(410, 180, svg_fit("best < 4 → commonRun(quote, ¶)", 11, 270, mono=True, where="formula2"),
                   11, sub, mono=True))
    f.add(svg_text(410, 200, svg_fit("tie → longer ¶ · best ≥ 5 → located", 11, 270, mono=True, where="formula3"),
                   11, sub, mono=True))

    # ruler
    gx0, gx1, gy = 404, 688, 236
    gunit = (gx1 - gx0) / 12.0
    f.rect(gx0, gy - 3, gx1 - gx0, 6, 3, track)
    f.rect(gx0 + 4 * gunit, gy - 3, gx1 - gx0 - 4 * gunit, 6, 3, fam, opacity=0.18)
    f.rect(gx0 + 5 * gunit, gy - 3, gx1 - gx0 - 5 * gunit, 6, 3, fam, opacity=0.55)
    for unit_index in range(13):
        tx = gx0 + unit_index * gunit
        major = unit_index % 2 == 0
        f.line(tx, gy - (4 if major else 2), tx, gy + (9 if major else 6),
               sub if major else muted, 1)
    for unit_index in (0, 4, 5, 6, 8, 12):
        tx = gx0 + unit_index * gunit
        is_five = unit_index == 5
        f.add(svg_text(tx, 258, str(unit_index), 11,
                       fam if is_five else muted, mono=True, anchor="middle"))
    f.line(gx0 + 5 * gunit, gy - 16, gx0 + 5 * gunit, gy + 12, fam, 1.6)
    f.add(svg_text(gx0 + 5 * gunit + 7, gy - 12, "≥5", 11, fam, mono=True))
    f.add(svg_text(398, 280,
                   svg_fit("<4 falls back to quote · 6+ quote-only", 11, 290, where="ruler note"),
                   11, muted))

    # caps
    f.add(svg_text(398, 306, "CAPS · a located hit never exceeds weak", 11, muted,
                   weight=700, spacing=0.4))
    cap_rows = ["heading ≤ 12 chars", "quote-only overlap ≥ 6", "category = reject-clause"]
    for index, label in enumerate(cap_rows):
        cy = 318 + index * 36
        f.rect(398, cy, 296, 30, 9, amber_soft)
        f.add(svg_text(410, cy + 20, svg_fit(label, 11, 220, mono=True, where="cap"),
                       11, s["weak"], mono=True))
        f.add(svg_text(682, cy + 20, "→ weak", 11, s["weak"], mono=True, anchor="end"))
    f.add(svg_text(398, 440,
                   svg_fit("no hit ≥ 5 chars → not-located", 11, 290, where="floor"),
                   11, sub))
    f.add(svg_text(398, 462, svg_fit("tier C → bypass (see rail)", 11, 290, where="bypass note"),
                   11, plum, mono=True))
    f.add(svg_text(398, 484, svg_fit("empty items[] → error", 11, 290, where="empty"),
                   11, muted, mono=True))

    # ---- fan out -------------------------------------------------------
    f.path("M712 300 C 730 300, 732 166, 748 166", green, 2.0, 0.65)
    f.path("M712 300 C 730 300, 732 298, 748 298", amber, 2.0, 0.65)
    f.path("M712 300 C 730 300, 732 432, 748 432", plum, 2.0, 0.65)
    f.circle(712, 300, 3.2, fam)

    # ---- three outputs -------------------------------------------------
    def output_card(y: float, h: float, colour: str, token: str,
                    count: int, gloss: str, lines: list[str], foot: str) -> None:
        f.rect(748, y, 324, h, 18, card, border, 1.2, shadow=True)
        f.rect(749, y + 14, 4, 34, 2, colour)
        f.add(svg_text(768, y + 24, token, 15, colour, mono=True, weight=700))
        f.add(svg_text(1052, y + 30, str(count), 30, colour, mono=True, weight=700, anchor="end"))
        f.add(svg_text(768, y + 46, svg_fit(gloss, 11, 250, where="gloss"), 11, sub))
        for index, line in enumerate(lines):
            f.add(svg_text(768, y + 68 + index * 17, svg_fit(line, 11, 286, mono=True, where="ex"),
                           11, muted, mono=True))
        f.add(svg_text(768, y + h - 12, svg_fit(foot, 11, 286, where="foot"), 11, muted))

    output_card(100, 122, green, "responded", COUNTS["responded"],
                "looks answered — a pointer, not a verdict",
                ["TRQ-HDR-008 → ¶6 · 5 chars", "TRQ-HDR-009 → ¶10 · 5 chars"],
                "title overlap ≥ 5 chars")
    output_card(236, 122, amber, "weak", COUNTS["weak"],
                "capped — needs a human look",
                ["HDR-011 → ¶8 · 12 chars, quote-only", "REJ-001 → ¶8 · 8 chars, reject-clause"],
                "HDR-011 is the longest match and still weak")
    output_card(372, 122, plum, "not-located", COUNTS["notLocated"],
                "could not locate — NOT missing",
                ["REJ-003 · HDR-006 · HDR-007", "HDR-010 · REJ-004 · +1 tier C"],
                "the report states this in words")

    # ---- bypass rail ---------------------------------------------------
    f.rect(28, 512, 1044, 30, 15, track, border, 1.0, dash="6 4")
    f.add(svg_text(44, 532, "BYPASS", 11, plum, mono=True, weight=700, spacing=0.6))
    f.add(svg_text(124, 532,
                   svg_fit("tier C (1) is shunted before the measure → blockedByPack; "
                           "it stays in not-located and the bidder is never graded on it.",
                           11, 930, where="rail"),
                   11, sub))

    # ---- footer --------------------------------------------------------
    f.add(f'<line x1="28" y1="558" x2="1072" y2="558" stroke="{border}" stroke-width="1" opacity="0.8"/>')
    f.add(svg_text(28, 580,
                   "bid_health_check · inject ['tools'] · timeoutMs 120000 · local: no network / "
                   "no model / no writes", 11, sub, mono=True))
    f.add(svg_text(28, 600,
                   "report order: not-located → weak → responded — the first group must not be read "
                   "as missing.", 11, sub))
    f.add(svg_text(28, 620,
                   "samples/quickstart: responded 2 · weak 3 · not-located 6 · blockedByPack 1 — "
                   "matches expected/result.json", 11, muted, mono=True))
    f.add(svg_text(28, 640,
                   "empty items[] → error, never an empty \"all clear\" · tables / scans / "
                   "appendices are not read", 11, muted))
    f.add(svg_text(1072, 640, "Apache-2.0 · PerryLink DSH plugin family", 11, muted,
                   mono=True, anchor="end"))

    f.add('</svg>')
    return "\n".join(f.parts) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    written = []
    for lang in ("zh", "en"):
        for skin in ("light", "dark"):
            path = os.path.join(OUT, f"{NAME}-hero-{lang}-{skin}.webp")
            make_hero(lang, skin).save(path, "WEBP", quality=93, method=6)
            written.append(path)
    for skin in ("light", "dark"):
        path = os.path.join(OUT, f"{NAME}-flow-v5-{skin}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(make_flow(skin))
        written.append(path)
    for path in written:
        print(f"wrote {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()

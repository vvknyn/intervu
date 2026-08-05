#!/usr/bin/env python3
"""Composite canonical intervu lockup onto how-it-works keyframes.

Uses public/mark.svg paths (via mark-white.svg PNG) + DM Sans wordmark.
Also patches Video A title frame: company career pages instead of LinkedIn/Indeed.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
KF = ROOT.parent / "how-it-works-keyframes"
ASSETS = ROOT / "assets"

BG = (14, 17, 24)
TEXT = (236, 236, 236)
MUTED = (139, 145, 154)
IRIS = (124, 184, 122)
PANEL = (22, 26, 32)
BORDER = (42, 47, 54)

MARK_SRC = ASSETS / "mark-white.svg.png"
FONT_PATH = ASSETS / "DMSans-SemiBold.ttf"

# 12 keyframes used by build-loops.sh
KEYFRAMES = [
    "intervu-video-a-mcp-keyframe-0-title.png",
    "intervu-video-a-mcp-keyframe-1-connect.png",
    "intervu-video-a-mcp-keyframe-2-approve.png",
    "intervu-video-a-mcp-keyframe-3-ask.png",
    "intervu-video-a-mcp-keyframe-4-results.png",
    "intervu-video-a-mcp-keyframe-5-payoff.png",
    "intervu-video-b-openclaw-keyframe-0-title.png",
    "intervu-video-b-openclaw-keyframe-1-install.png",
    "intervu-video-b-openclaw-keyframe-2-approve.png",
    "intervu-video-b-openclaw-keyframe-3-overnight.png",
    "intervu-video-b-openclaw-keyframe-4-digest.png",
    "intervu-video-b-openclaw-keyframe-5-payoff.png",
]


@dataclass(frozen=True)
class LockupSpec:
    mark_px: int
    font_px: int
    gap_px: int


HERO = LockupSpec(mark_px=72, font_px=44, gap_px=14)
STAMP = LockupSpec(mark_px=44, font_px=26, gap_px=10)
MODAL = LockupSpec(mark_px=36, font_px=22, gap_px=8)
MCP_PANEL = (16, 20, 23)

STAMP_BOX = (1240, 900, 1515, 1015)
STAMP_ERASE = (1150, 650, 1520, 1024)
HERO_BOX = (500, 22, 1060, 195)
MCP_LOGO_BOX = (710, 298, 925, 465)
MCP_LOGO_PASTE = (715, 310, 920, 430)


def load_mark(size: int) -> Image.Image:
    src = Image.open(MARK_SRC).convert("RGBA")
    px = src.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = px[x, y]
            if r > 240 and g > 240 and b > 240:
                px[x, y] = (r, g, b, 0)
    return src.resize((size, size), Image.Resampling.LANCZOS)


def make_lockup(spec: LockupSpec) -> Image.Image:
    mark = load_mark(spec.mark_px)
    font = ImageFont.truetype(str(FONT_PATH), spec.font_px)
    word = "intervu"
    bbox = font.getbbox(word)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    w = spec.mark_px + spec.gap_px + text_w
    h = max(spec.mark_px, text_h + 4)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    mark_y = (h - spec.mark_px) // 2
    canvas.alpha_composite(mark, (0, mark_y))
    draw = ImageDraw.Draw(canvas)
    text_y = (h - text_h) // 2 - bbox[1]
    draw.text((spec.mark_px + spec.gap_px, text_y), word, font=font, fill=(*TEXT, 255))
    return canvas


def make_lockup_vertical(spec: LockupSpec, text_rgb: tuple[int, int, int] = TEXT) -> Image.Image:
    mark = load_mark(spec.mark_px)
    font = ImageFont.truetype(str(FONT_PATH), spec.font_px)
    word = "intervu"
    bbox = font.getbbox(word)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    w = max(spec.mark_px, text_w + 4)
    h = spec.mark_px + 6 + text_h
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(mark, ((w - spec.mark_px) // 2, 0))
    draw = ImageDraw.Draw(canvas)
    text_x = (w - text_w) // 2
    text_y = spec.mark_px + 6 - bbox[1]
    draw.text((text_x, text_y), word, font=font, fill=(*text_rgb, 255))
    return canvas


def paste_centered(base: Image.Image, overlay: Image.Image, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    ox = x0 + (x1 - x0 - overlay.width) // 2
    oy = y0 + (y1 - y0 - overlay.height) // 2
    base.paste(overlay, (ox, oy), overlay)


def paste_bottom_right(base: Image.Image, overlay: Image.Image, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    ox = x1 - overlay.width - 12
    oy = y1 - overlay.height - 10
    base.paste(overlay, (ox, oy), overlay)


def cover(base: Image.Image, box: tuple[int, int, int, int], color: tuple[int, int, int] = BG) -> None:
    draw = ImageDraw.Draw(base)
    draw.rectangle(box, fill=color)


def draw_browser_window(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    url: str,
    company: str,
    initial: str,
    initial_bg: tuple[int, int, int],
    jobs: list[str],
) -> None:
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=12, fill=PANEL, outline=BORDER, width=2)
    # title bar
    bar_h = 34
    draw.rounded_rectangle((x0, y0, x1, y0 + bar_h), radius=12, fill=(30, 34, 40))
    draw.rectangle((x0, y0 + bar_h - 12, x1, y0 + bar_h), fill=(30, 34, 40))
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        draw.ellipse((x0 + 12 + i * 18, y0 + 10, x0 + 22 + i * 18, y0 + 20), fill=c)
    font_sm = ImageFont.truetype(str(FONT_PATH), 14)
    draw.rounded_rectangle((x0 + 70, y0 + 8, x1 - 12, y0 + 26), radius=6, fill=(18, 21, 26))
    draw.text((x0 + 78, y0 + 9), url, font=font_sm, fill=MUTED)
    # page body
    cy = y0 + bar_h + 16
    logo_size = 28
    draw.rounded_rectangle(
        (x0 + 16, cy, x0 + 16 + logo_size, cy + logo_size),
        radius=7,
        fill=initial_bg,
    )
    font_md = ImageFont.truetype(str(FONT_PATH), 16)
    draw.text((x0 + 16 + logo_size // 2 - 5, cy + 4), initial, font=font_md, fill=TEXT)
    draw.text((x0 + 54, cy + 2), company, font=font_md, fill=TEXT)
    draw.text((x0 + 54, cy + 20), "Careers", font=font_sm, fill=IRIS)
    jy = cy + logo_size + 14
    font_xs = ImageFont.truetype(str(FONT_PATH), 13)
    for job in jobs:
        draw.rounded_rectangle((x0 + 16, jy, x1 - 16, jy + 28), radius=6, fill=(18, 21, 26), outline=BORDER)
        draw.text((x0 + 24, jy + 6), job, font=font_xs, fill=TEXT)
        jy += 34


def patch_video_a_company_sources(im: Image.Image) -> None:
    """Replace LinkedIn/Indeed boxes with company career page browsers."""
    draw = ImageDraw.Draw(im)
    # Right-side aggregator boxes (include ghost Indeed below)
    cover(im, (1050, 278, 1450, 820))
    gap = 14
    box_w = 360
    box_h = 168
    x0 = 1086
    y0 = 292
    draw_browser_window(
        draw,
        (x0, y0, x0 + box_w, y0 + box_h),
        "stripe.com/jobs",
        "Stripe",
        "S",
        (99, 91, 255),
        ["Senior PM · Berlin", "Product Lead · Remote"],
    )
    y1 = y0 + box_h + gap
    draw_browser_window(
        draw,
        (x0, y1, x0 + box_w, y1 + box_h),
        "ramp.com/careers",
        "Ramp",
        "R",
        (230, 244, 236),
        ["Staff Engineer · NYC", "Platform PM · Remote"],
    )
    # Re-draw dashed connector lines (green) from MCP box to career pages
    mcp_right = 949
    mcp_mid_y = 440
    target_left = x0
    for target_y in (y0 + box_h // 2, y1 + box_h // 2):
        pts = [(mcp_right, mcp_mid_y), (990, mcp_mid_y), (990, target_y), (target_left, target_y)]
        draw.line(pts, fill=IRIS, width=2)


def frame_mode(name: str) -> str:
    if re.search(r"-0-title|-5-payoff|-4-results", name):
        return "hero"
    return "stamp"


def patch_frame(
    path: Path,
    hero: Image.Image,
    stamp: Image.Image,
    modal: Image.Image,
    modal_vertical: Image.Image,
    modal_vertical_dark: Image.Image,
) -> None:
    im = Image.open(path).convert("RGBA")
    name = path.name
    mode = frame_mode(name)

    if name == "intervu-video-a-mcp-keyframe-0-title.png":
        patch_video_a_company_sources(im)
        cover(im, MCP_LOGO_BOX, color=MCP_PANEL)
        paste_centered(im, modal, MCP_LOGO_PASTE)

    if mode == "hero":
        cover(im, HERO_BOX)
        paste_centered(im, hero, HERO_BOX)
    else:
        cover(im, STAMP_ERASE)
        cover(im, STAMP_BOX)
        paste_bottom_right(im, stamp, STAMP_BOX)

    if "-2-approve" in name:
        if name.startswith("intervu-video-a"):
            cover(im, (890, 390, 989, 479), color=(34, 36, 41))
            paste_centered(im, modal_vertical, (890, 392, 989, 478))
        else:
            cover(im, (880, 416, 989, 487), color=(255, 255, 255))
            paste_centered(im, modal_vertical_dark, (882, 418, 987, 485))

    im.convert("RGB").save(path, optimize=True)
    print(f"stamped {path.name} ({mode})")


def main() -> None:
    hero = make_lockup(HERO)
    stamp = make_lockup(STAMP)
    modal = make_lockup(MODAL)
    modal_vertical = make_lockup_vertical(MODAL)
    modal_vertical_dark = make_lockup_vertical(MODAL, text_rgb=(14, 17, 24))
    hero.save(ASSETS / "lockup-hero.png")
    stamp.save(ASSETS / "lockup-stamp.png")
    modal.save(ASSETS / "lockup-modal.png")
    modal_vertical.save(ASSETS / "lockup-modal-vertical.png")
    modal_vertical_dark.save(ASSETS / "lockup-modal-vertical-dark.png")

    for fname in KEYFRAMES:
        patch_frame(KF / fname, hero, stamp, modal, modal_vertical, modal_vertical_dark)

    print(f"Done — {len(KEYFRAMES)} keyframes stamped.")


if __name__ == "__main__":
    main()

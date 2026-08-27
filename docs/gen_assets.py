from PIL import Image, ImageDraw, ImageFont
import random

random.seed(42)

def lerp_color(c0, c1, t):
    return tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))

def diag_gradient(size, c0, c1):
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1)) if size > 1 else 0
            px[x, y] = lerp_color(c0, c1, t)
    return img

def draw_modern_icon(size):
    c0 = (0x1E, 0x37, 0x6C)
    c1 = (0x3B, 0x6B, 0xC0)
    img = diag_gradient(size, c0, c1).convert('RGBA')
    draw = ImageDraw.Draw(img)
    scale = size / 128

    line_w = max(1, round(3 * scale))
    center_x = size / 2
    center_y = size * 0.45
    arrow_size = size * 0.3

    # Arrow shaft
    draw.line([(center_x, center_y - arrow_size / 2), (center_x, center_y + arrow_size / 2)],
               fill='white', width=line_w, joint='curve')
    # Arrow head
    draw.line([
        (center_x - arrow_size / 3, center_y + arrow_size / 4),
        (center_x, center_y + arrow_size / 2),
        (center_x + arrow_size / 3, center_y + arrow_size / 4),
    ], fill='white', width=line_w, joint='curve')

    # Document lines
    line_y = size * 0.75
    line_width = size * 0.5
    line_w2 = max(1, round(2 * scale))
    for i in range(3):
        y = line_y + i * size * 0.08
        draw.line([
            (center_x - line_width / 2, y),
            (center_x + line_width / 2 - (i * size * 0.1), y),
        ], fill='white', width=line_w2)

    return img

def draw_popup_graphic():
    w, h = 600, 150
    c0 = (0x3B, 0x6B, 0xC0)
    c1 = (0x1E, 0x37, 0x6C)
    c2 = (0x14, 0x28, 0x4F)
    img = Image.new('RGB', (w, h))
    px = img.load()
    for x in range(w):
        t = x / (w - 1)
        if t <= 0.5:
            color = lerp_color(c0, c1, t / 0.5)
        else:
            color = lerp_color(c1, c2, (t - 0.5) / 0.5)
        for y in range(h):
            px[x, y] = color
    img = img.convert('RGBA')

    # Bokeh circle overlay
    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for i in range(20):
        cx = random.random() * w
        cy = random.random() * h
        r = random.random() * 30 + 10
        odraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 13))
    img = Image.alpha_composite(img, overlay)

    draw = ImageDraw.Draw(img)

    def load_font(size, bold=False):
        candidates = [
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/HelveticaNeue.ttc",
            "/System/Library/Fonts/SFNSText.ttf",
        ]
        for c in candidates:
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
        return ImageFont.load_default()

    title_font = load_font(32, bold=True)
    subtitle_font = load_font(16)

    def draw_centered_text(text, cy, font, fill):
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text((w / 2 - tw / 2, cy - th / 2 - bbox[1]), text, font=font, fill=fill)

    draw_centered_text("Claude Interaction Exporter", 60, title_font, 'white')
    draw_centered_text("Export • Browse • Archive", 95, subtitle_font, (255, 255, 255, 230))

    line_color = (255, 255, 255, 77)
    draw.line([(50, 75), (150, 75)], fill=line_color, width=2)
    draw.line([(450, 75), (550, 75)], fill=line_color, width=2)

    return img

for size in (16, 48, 128):
    draw_modern_icon(size).save(f"icon{size}.png")

draw_popup_graphic().save("popup-header.png")
print("done")

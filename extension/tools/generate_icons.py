import os
import struct
import zlib


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack("!I", len(data))
        + tag
        + data
        + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: str, w: int, h: int, rgba_bytes: bytes) -> None:
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(rgba_bytes[y * stride : (y + 1) * stride])

    ihdr = struct.pack("!IIBBBBB", w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), level=9)

    data = bytearray(b"\x89PNG\r\n\x1a\n")
    data.extend(_chunk(b"IHDR", ihdr))
    data.extend(_chunk(b"IDAT", idat))
    data.extend(_chunk(b"IEND", b""))

    with open(path, "wb") as f:
        f.write(data)


def draw_icon(size: int) -> bytes:
    w = h = size
    px = bytearray([0, 0, 0, 0] * (w * h))

    def set_px(x: int, y: int, r: int, g: int, b: int, a: int = 255) -> None:
        if 0 <= x < w and 0 <= y < h:
            i = (y * w + x) * 4
            px[i : i + 4] = bytes((r, g, b, a))

    def fill_round_rect(x0: int, y0: int, x1: int, y1: int, radius: int, color):
        r, g, b, a = color
        for y in range(y0, y1):
            for x in range(x0, x1):
                dx = 0
                dy = 0
                if x < x0 + radius:
                    dx = x0 + radius - x
                elif x >= x1 - radius:
                    dx = x - (x1 - radius - 1)
                if y < y0 + radius:
                    dy = y0 + radius - y
                elif y >= y1 - radius:
                    dy = y - (y1 - radius - 1)
                if dx and dy and dx * dx + dy * dy > radius * radius:
                    continue
                set_px(x, y, r, g, b, a)

    def fill_circle(cx: int, cy: int, rad: int, color):
        r, g, b, a = color
        r2 = rad * rad
        for y in range(cy - rad, cy + rad + 1):
            dy = y - cy
            for x in range(cx - rad, cx + rad + 1):
                dx = x - cx
                if dx * dx + dy * dy <= r2:
                    set_px(x, y, r, g, b, a)

    blue = (37, 99, 235, 255)
    deep = (29, 78, 216, 255)
    white = (255, 255, 255, 255)

    m = max(1, size // 10)
    x0, y0 = m, m
    x1, y1 = size - m, size - m
    radius = max(2, size // 6)
    fill_round_rect(x0, y0, x1, y1, radius, blue)

    inset = max(2, size // 7)
    fill_round_rect(
        x0 + inset,
        y0 + inset,
        x1 - inset,
        y1 - inset,
        max(2, radius - inset // 2),
        deep,
    )

    dial_r = max(3, size // 6)
    cx = size // 2
    cy = size // 2
    fill_circle(cx, cy, dial_r, white)
    fill_circle(cx, cy, max(1, dial_r // 3), blue)

    bolt_r = max(1, size // 24)
    for ox, oy in [
        (-dial_r // 2, -dial_r // 2),
        (dial_r // 2, -dial_r // 2),
        (-dial_r // 2, dial_r // 2),
        (dial_r // 2, dial_r // 2),
    ]:
        fill_circle(cx + ox, cy + oy, bolt_r, deep)

    return bytes(px)


def main() -> None:
    out_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for s in (16, 32, 48, 128):
        rgba = draw_icon(s)
        write_png(os.path.join(out_dir, f"vault-{s}.png"), s, s, rgba)


if __name__ == "__main__":
    main()


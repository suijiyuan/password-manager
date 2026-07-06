import os
import struct
import zlib
import math


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
    scale = 4
    w = h = size * scale
    px = bytearray([0, 0, 0, 0] * (w * h))

    def set_px(x: int, y: int, r: int, g: int, b: int, a: int = 255) -> None:
        if 0 <= x < w and 0 <= y < h:
            i = (y * w + x) * 4
            px[i : i + 4] = bytes((r, g, b, a))

    def _lerp(a: int, b: int, t: float) -> int:
        return int(a + (b - a) * t + 0.5)

    def lerp_color(c0, c1, t: float):
        return (
            _lerp(c0[0], c1[0], t),
            _lerp(c0[1], c1[1], t),
            _lerp(c0[2], c1[2], t),
            _lerp(c0[3], c1[3], t),
        )

    def point_in_poly(x: float, y: float, poly) -> bool:
        inside = False
        n = len(poly)
        j = n - 1
        for i in range(n):
            xi, yi = poly[i]
            xj, yj = poly[j]
            intersect = (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi
            if intersect:
                inside = not inside
            j = i
        return inside

    def in_round_rect(x: float, y: float, x0: float, y0: float, x1: float, y1: float, r: float) -> bool:
        cx = (x0 + x1) / 2
        cy = (y0 + y1) / 2
        hw = (x1 - x0) / 2
        hh = (y1 - y0) / 2
        qx = abs(x - cx) - (hw - r)
        qy = abs(y - cy) - (hh - r)
        if qx <= 0 and qy <= 0:
            return True
        qx = max(qx, 0.0)
        qy = max(qy, 0.0)
        return qx * qx + qy * qy <= r * r

    def plane_poly() -> list[tuple[float, float]]:
        return [
            (0.14, 0.56),
            (0.86, 0.18),
            (0.62, 0.84),
            (0.50, 0.64),
            (0.34, 0.78),
        ]

    def plane_fold_poly() -> list[tuple[float, float]]:
        return [
            (0.50, 0.64),
            (0.86, 0.18),
            (0.62, 0.84),
        ]

    bg0 = (34, 197, 94, 255)
    bg1 = (21, 128, 61, 255)
    plane = (240, 253, 244, 255)
    fold = (167, 243, 208, 255)

    outer_rr = (0.06, 0.06, 0.94, 0.94)
    outer_r = 0.22

    plane_shape = plane_poly()
    plane_fold = plane_fold_poly()

    for y in range(h):
        ny = (y + 0.5) / h
        for x in range(w):
            nx = (x + 0.5) / w
            if not in_round_rect(nx, ny, outer_rr[0], outer_rr[1], outer_rr[2], outer_rr[3], outer_r):
                continue

            t = min(1.0, max(0.0, (ny - 0.06) / 0.88))
            bg = lerp_color(bg0, bg1, t * 0.65)
            c = bg

            if point_in_poly(nx, ny, plane_shape):
                c = plane
                if point_in_poly(nx, ny, plane_fold):
                    c = fold

            set_px(x, y, c[0], c[1], c[2], c[3])

    out_w = out_h = size
    out = bytearray([0, 0, 0, 0] * (out_w * out_h))
    for oy in range(out_h):
        for ox in range(out_w):
            r = g = b = a = 0
            for sy in range(scale):
                for sx in range(scale):
                    ix = (oy * scale + sy) * w + (ox * scale + sx)
                    p = ix * 4
                    r += px[p]
                    g += px[p + 1]
                    b += px[p + 2]
                    a += px[p + 3]
            div = scale * scale
            i = (oy * out_w + ox) * 4
            out[i] = r // div
            out[i + 1] = g // div
            out[i + 2] = b // div
            out[i + 3] = a // div

    return bytes(out)


def main() -> None:
    out_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for s in (16, 32, 48, 128):
        rgba = draw_icon(s)
        write_png(os.path.join(out_dir, f"vault-{s}.png"), s, s, rgba)


if __name__ == "__main__":
    main()

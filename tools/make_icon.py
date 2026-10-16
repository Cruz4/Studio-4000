"""Draws the Studio 4000 app icon (a glowing ring with waveform bars) as a PNG."""
import math
import struct
import sys
import zlib

SIZE = 512


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(lerp(x, y, t) for x, y in zip(c1, c2))


def pixel(x, y):
    cx = cy = SIZE / 2
    dx, dy = x - cx, y - cy
    r = math.hypot(dx, dy) / (SIZE / 2)
    angle = (math.atan2(dy, dx) + math.pi) / (2 * math.pi)

    # rounded-square plate
    m = SIZE * 0.06
    corner = SIZE * 0.22
    qx = max(abs(dx) - (SIZE / 2 - m - corner), 0)
    qy = max(abs(dy) - (SIZE / 2 - m - corner), 0)
    plate = math.hypot(qx, qy) - corner
    if plate > 1.5:
        return (0, 0, 0, 0)
    alpha = 255 if plate < -1.5 else int(255 * (1.5 - plate) / 3)

    base = mix((7, 8, 12), (20, 18, 40), max(0.0, 1 - r))
    violet, cyan = (124, 92, 255), (0, 209, 255)
    ring_colour = mix(violet, cyan, 0.5 + 0.5 * math.sin(angle * 2 * math.pi))

    ring = abs(r - 0.62)
    glow = math.exp(-((ring / 0.035) ** 2)) + 0.35 * math.exp(-((ring / 0.12) ** 2))
    c = mix(base, ring_colour, min(1.0, glow))

    # waveform bars inside the ring
    bars = 9
    width = SIZE * 0.56
    left = cx - width / 2
    if left <= x <= left + width and r < 0.55:
        i = int((x - left) / (width / bars))
        local = (x - left) / (width / bars) - i
        heights = [0.18, 0.34, 0.52, 0.74, 0.92, 0.74, 0.52, 0.34, 0.18]
        h = heights[min(i, bars - 1)] * SIZE * 0.26
        if 0.22 < local < 0.78 and abs(dy) < h:
            t = i / (bars - 1)
            c = mix(mix(violet, cyan, t), (255, 255, 255), 0.25 * (1 - abs(dy) / h))

    return (int(c[0]), int(c[1]), int(c[2]), alpha)


def write_png(path):
    rows = []
    for y in range(SIZE):
        row = bytearray([0])
        for x in range(SIZE):
            row.extend(pixel(x + 0.5, y + 0.5))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind, data):
        c = struct.pack(">I", len(data)) + kind + data
        return c + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    write_png(sys.argv[1] if len(sys.argv) > 1 else "icon.png")

from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "icons"

def chunk(kind: bytes, data: bytes) -> bytes:
    checksum = zlib.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)

def png(size: int) -> bytes:
    rows = bytearray()
    for py in range(size):
        rows.append(0)
        y = (2.0 * (py + 0.5) / size) - 1.0
        for px in range(size):
            x = (2.0 * (px + 0.5) / size) - 1.0
            circle = x * x + y * y <= 0.82
            spark = circle and (
                abs(x) < 0.09 * (1.0 - min(abs(y), 1.0))
                or abs(y) < 0.09 * (1.0 - min(abs(x), 1.0))
            )
            if spark:
                color = (255, 255, 255, 255)
            elif circle:
                color = (20, 52, 84, 255)
            else:
                color = (0, 0, 0, 0)
            rows.extend(color)
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )

def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        (OUTPUT / f"icon-{size}.png").write_bytes(png(size))

if __name__ == "__main__":
    main()

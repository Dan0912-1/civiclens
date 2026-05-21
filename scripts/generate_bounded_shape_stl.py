"""
Generate an STL for a calculus demonstration of the solid whose base is
the region bounded by y = tan^2(x) and y = 4 - x^2, with square
cross-sections perpendicular to the x-axis.

The solid is rendered as N discrete square-prism slabs spaced along x
with gaps between them. Each slab is a rectangular box with constant
square cross-section sized by its midpoint x_c:

    y in [tan^2(x_c), 4 - x_c^2]
    z in [0, s(x_c)]   where s(x_c) = (4 - x_c^2) - tan^2(x_c)

To make the slabs print reliably and never overhang the base, the base
plate is the union of the smooth lens-shaped region and each slab's
rectangular footprint. Each slab box also extends down through the base
plate so the whole part is one connected solid -- the slabs are
anchored across the full base thickness, not just attached at z = 0.
"""

import math
import os
import struct

# ---------- parameters ----------
N_SLABS = 5                   # number of box slabs (odd -> centered slab at x = 0)
SLAB_FRACTION = 0.75          # slab x-thickness as a fraction of slab-to-slab spacing
SCALE_MM_PER_UNIT = 10.0
BASE_THICKNESS_MM = 3.0
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "bounded_shape.stl")


def upper(x: float) -> float:
    return 4.0 - x * x


def lower(x: float) -> float:
    t = math.tan(x)
    return t * t


def diff(x: float) -> float:
    return upper(x) - lower(x)


a, b = 1.0, 1.5
assert diff(a) > 0 > diff(b)
for _ in range(200):
    m = 0.5 * (a + b)
    if diff(m) > 0:
        a = m
    else:
        b = m
x_root = 0.5 * (a + b)
print(f"Intersection at x = +/- {x_root:.6f}")


S = SCALE_MM_PER_UNIT
BASE_THICKNESS_UNITS = BASE_THICKNESS_MM / S


def P(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (x * S, y * S, z * S)


triangles: list[tuple[tuple[float, float, float], ...]] = []


def add_tri(a, b, c):
    triangles.append((a, b, c))


def add_quad(a, b, c, d):
    add_tri(a, b, c)
    add_tri(a, c, d)


def add_box(xmin: float, xmax: float, ymin: float, ymax: float, zmin: float, zmax: float):
    v000 = P(xmin, ymin, zmin)
    v100 = P(xmax, ymin, zmin)
    v110 = P(xmax, ymax, zmin)
    v010 = P(xmin, ymax, zmin)
    v001 = P(xmin, ymin, zmax)
    v101 = P(xmax, ymin, zmax)
    v111 = P(xmax, ymax, zmax)
    v011 = P(xmin, ymax, zmax)
    # Bottom (z = zmin), outward normal -z. CCW seen from below.
    add_quad(v000, v010, v110, v100)
    # Top (z = zmax), outward normal +z.
    add_quad(v001, v101, v111, v011)
    # -y face.
    add_quad(v000, v100, v101, v001)
    # +y face.
    add_quad(v010, v011, v111, v110)
    # -x face.
    add_quad(v000, v001, v011, v010)
    # +x face.
    add_quad(v100, v110, v111, v101)


# ---- slabs (box from z = -base to z = s(x_c) so they're anchored through the base) ----
dx = (2.0 * x_root) / N_SLABS
slab_width = dx * SLAB_FRACTION
gap_width = dx - slab_width
slab_centers = [-x_root + (i + 0.5) * dx for i in range(N_SLABS)]

print(
    f"Slab spacing = {dx * S:.2f} mm, slab thickness = {slab_width * S:.2f} mm, "
    f"gap = {gap_width * S:.2f} mm"
)

Z_BOT = -BASE_THICKNESS_UNITS

for xc in slab_centers:
    x_a = xc - slab_width / 2.0
    x_b = xc + slab_width / 2.0
    y_lo = lower(xc)
    y_hi = upper(xc)
    side = y_hi - y_lo
    if side <= 0:
        continue
    add_box(x_a, x_b, y_lo, y_hi, Z_BOT, side)
    print(f"  slab at x = {xc:+.3f}: {side * S:.2f} mm square, {slab_width * S:.2f} mm thick")


# ---- base plate: smooth lens region extruded down to z = -base_thickness ----
# Slabs overlap the base in z = [-base, 0] and in xy where their boxes extend
# beyond the lens, so the slicer's boolean union gives a base with rectangular
# tongues at each slab position. Every slab footprint is therefore fully
# supported by the base.
N_BASE = 400
xs_base = [-x_root + 2.0 * x_root * i / (N_BASE - 1) for i in range(N_BASE)]
y_lo_b = [lower(x) for x in xs_base]
y_hi_b = [upper(x) for x in xs_base]
y_lo_b[0] = y_hi_b[0] = 0.5 * (y_lo_b[0] + y_hi_b[0])
y_lo_b[-1] = y_hi_b[-1] = 0.5 * (y_lo_b[-1] + y_hi_b[-1])

Z_TOP = 0.0

for i in range(N_BASE - 1):
    x1, x2 = xs_base[i], xs_base[i + 1]
    lo1, lo2 = y_lo_b[i], y_lo_b[i + 1]
    hi1, hi2 = y_hi_b[i], y_hi_b[i + 1]

    add_quad(P(x1, lo1, Z_TOP), P(x2, lo2, Z_TOP), P(x2, hi2, Z_TOP), P(x1, hi1, Z_TOP))
    add_quad(P(x1, lo1, Z_BOT), P(x1, hi1, Z_BOT), P(x2, hi2, Z_BOT), P(x2, lo2, Z_BOT))
    add_quad(P(x1, lo1, Z_BOT), P(x2, lo2, Z_BOT), P(x2, lo2, Z_TOP), P(x1, lo1, Z_TOP))
    add_quad(P(x1, hi1, Z_BOT), P(x1, hi1, Z_TOP), P(x2, hi2, Z_TOP), P(x2, hi2, Z_BOT))


# ---------- write binary STL ----------
def cross(u, v):
    return (
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    )


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def normalize(v):
    m = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    if m == 0:
        return (0.0, 0.0, 0.0)
    return (v[0] / m, v[1] / m, v[2] / m)


with open(OUT_PATH, "wb") as f:
    header = b"square-cross-section demo with box slabs anchored through base".ljust(80, b"\0")
    f.write(header)
    f.write(struct.pack("<I", len(triangles)))
    for tri in triangles:
        a, b, c = tri
        n = normalize(cross(sub(b, a), sub(c, a)))
        f.write(struct.pack("<3f", *n))
        f.write(struct.pack("<3f", *a))
        f.write(struct.pack("<3f", *b))
        f.write(struct.pack("<3f", *c))
        f.write(struct.pack("<H", 0))


print(f"\nWrote {len(triangles)} triangles to {os.path.abspath(OUT_PATH)}")

xs_mm, ys_mm, zs_mm = [], [], []
for tri in triangles:
    for p in tri:
        xs_mm.append(p[0]); ys_mm.append(p[1]); zs_mm.append(p[2])
print(
    f"Bounding box (mm): "
    f"x [{min(xs_mm):.2f}, {max(xs_mm):.2f}]  "
    f"y [{min(ys_mm):.2f}, {max(ys_mm):.2f}]  "
    f"z [{min(zs_mm):.2f}, {max(zs_mm):.2f}]"
)

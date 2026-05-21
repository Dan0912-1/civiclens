"""
Generate an STL for a calculus demonstration of the solid whose base is
the region bounded by y = tan^2(x) and y = 4 - x^2 with square
cross-sections perpendicular to the x-axis.

To make the cross-sections individually visible, the solid is rendered as
a series of N discrete square slabs spaced along x with gaps in between.
Each slab is centered at an x_i, has thickness w in x, and a square y-z
cross-section of side s(x_i) = (4 - x_i^2) - tan^2(x_i):

    y in [tan^2(x_i), 4 - x_i^2]
    z in [0, s(x_i)]

All slabs sit on a thin base plate shaped like the bounded region so the
print stays in one piece.
"""

import math
import os
import struct

# ---------- parameters ----------
N_SLABS = 11               # number of square slabs (odd -> centered slab at x=0)
SLAB_FRACTION = 0.55       # slab thickness as fraction of slab-to-slab spacing
SCALE_MM_PER_UNIT = 15.0
BASE_THICKNESS_MM = 2.5    # thin connecting plate underneath the slabs
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "bounded_shape.stl")

# ---------- math ----------
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
    # Quad ordered a -> b -> c -> d around the face.
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
    # Bottom (z = zmin), outward normal -z.
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


# ---- slabs ----
dx = (2.0 * x_root) / N_SLABS                # spacing between slab centers
slab_width = dx * SLAB_FRACTION              # x-thickness of each slab
slab_centers = [-x_root + (i + 0.5) * dx for i in range(N_SLABS)]

print(f"Slab spacing dx = {dx:.4f}, slab thickness = {slab_width:.4f}, gap = {dx - slab_width:.4f}")

for xc in slab_centers:
    y_low = lower(xc)
    y_high = upper(xc)
    side = y_high - y_low
    if side <= 0:
        continue
    add_box(
        xc - slab_width / 2.0, xc + slab_width / 2.0,
        y_low, y_high,
        0.0, side,
    )


# ---- base plate: the bounded region extruded down to z = -BASE_THICKNESS ----
N_BASE = 400
xs = [-x_root + 2.0 * x_root * i / (N_BASE - 1) for i in range(N_BASE)]
y_lo = [lower(x) for x in xs]
y_hi = [upper(x) for x in xs]
# Force endpoint inner/outer values to coincide.
end_l = 0.5 * (y_lo[0] + y_hi[0])
end_r = 0.5 * (y_lo[-1] + y_hi[-1])
y_lo[0] = y_hi[0] = end_l
y_lo[-1] = y_hi[-1] = end_r

Z_TOP = 0.0
Z_BOT = -BASE_THICKNESS_UNITS

for i in range(N_BASE - 1):
    x1, x2 = xs[i], xs[i + 1]
    lo1, lo2 = y_lo[i], y_lo[i + 1]
    hi1, hi2 = y_hi[i], y_hi[i + 1]

    # Top face of base (z = 0), outward normal +z.
    add_quad(P(x1, lo1, Z_TOP), P(x2, lo2, Z_TOP), P(x2, hi2, Z_TOP), P(x1, hi1, Z_TOP))
    # Bottom face of base (z = -t), outward normal -z (reverse winding).
    add_quad(P(x1, lo1, Z_BOT), P(x1, hi1, Z_BOT), P(x2, hi2, Z_BOT), P(x2, lo2, Z_BOT))
    # Lower-curve side wall (y = tan^2(x)), outward normal in -y.
    add_quad(P(x1, lo1, Z_BOT), P(x2, lo2, Z_BOT), P(x2, lo2, Z_TOP), P(x1, lo1, Z_TOP))
    # Upper-curve side wall (y = 4 - x^2), outward normal in +y (reverse winding).
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
    header = b"square-cross-section demo slabs over bounded region".ljust(80, b"\0")
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


print(f"Wrote {len(triangles)} triangles to {os.path.abspath(OUT_PATH)}")

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

"""
Generate an STL for a calculus demonstration of the solid whose base is
the region bounded by y = tan^2(x) and y = 4 - x^2, with square
cross-sections perpendicular to the x-axis.

The solid is split into N discrete slabs along x with gaps between them.
Each slab is a chunk of the continuous solid: its two flat end-faces
(at x = x_a and x = x_b) are perfect squares showing the cross-section
at that x, and its sides/top follow tan^2(x), 4 - x^2, and
s(x) = (4 - x^2) - tan^2(x). This way the slabs taper naturally and
never overshoot the lens-shaped base, while still clearly displaying
square cross-sections at the slab boundaries.

All slabs sit on a flat base plate shaped like the bounded region.
"""

import math
import os
import struct

# ---------- parameters ----------
N_SLABS = 5                   # number of slabs (odd -> centered slab at x = 0)
SLAB_FRACTION = 0.75          # slab x-thickness as a fraction of slab-to-slab spacing
N_SAMPLES_PER_SLAB = 24       # x samples within each slab for curve fidelity
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


def add_curved_slab(x_a: float, x_b: float) -> None:
    """Add a chunk of the continuous solid between x = x_a and x = x_b.

    Side faces follow y = tan^2(x) and y = 4 - x^2; the top follows
    z = s(x). The two end-caps at x_a and x_b are exact squares of side
    s(x_a) and s(x_b) respectively, showing the cross-section.
    """
    xs_loc = [x_a + (x_b - x_a) * i / (N_SAMPLES_PER_SLAB - 1) for i in range(N_SAMPLES_PER_SLAB)]

    for i in range(N_SAMPLES_PER_SLAB - 1):
        x1, x2 = xs_loc[i], xs_loc[i + 1]
        lo1, lo2 = lower(x1), lower(x2)
        hi1, hi2 = upper(x1), upper(x2)
        s1, s2 = hi1 - lo1, hi2 - lo2

        # Bottom (z = 0), outward normal -z.
        add_quad(P(x1, lo1, 0.0), P(x1, hi1, 0.0), P(x2, hi2, 0.0), P(x2, lo2, 0.0))
        # Top (z = s(x)), outward normal +z.
        add_quad(P(x1, lo1, s1), P(x2, lo2, s2), P(x2, hi2, s2), P(x1, hi1, s1))
        # Front face (y = tan^2(x)), outward normal -y.
        add_quad(P(x1, lo1, 0.0), P(x2, lo2, 0.0), P(x2, lo2, s2), P(x1, lo1, s1))
        # Back face (y = 4 - x^2), outward normal +y.
        add_quad(P(x1, hi1, 0.0), P(x1, hi1, s1), P(x2, hi2, s2), P(x2, hi2, 0.0))

    # End cap at x = x_a: square in y-z plane, outward normal -x.
    lo_a, hi_a = lower(x_a), upper(x_a)
    s_a = hi_a - lo_a
    add_quad(P(x_a, lo_a, 0.0), P(x_a, hi_a, 0.0), P(x_a, hi_a, s_a), P(x_a, lo_a, s_a))

    # End cap at x = x_b: square in y-z plane, outward normal +x.
    lo_b, hi_b = lower(x_b), upper(x_b)
    s_b = hi_b - lo_b
    add_quad(P(x_b, lo_b, 0.0), P(x_b, lo_b, s_b), P(x_b, hi_b, s_b), P(x_b, hi_b, 0.0))


# ---- slabs ----
dx = (2.0 * x_root) / N_SLABS
slab_width = dx * SLAB_FRACTION
gap_width = dx - slab_width
slab_centers = [-x_root + (i + 0.5) * dx for i in range(N_SLABS)]

print(
    f"Slab spacing = {dx * S:.2f} mm, slab thickness = {slab_width * S:.2f} mm, "
    f"gap = {gap_width * S:.2f} mm"
)

slab_heights: list[tuple[float, float]] = []
for xc in slab_centers:
    x_a = xc - slab_width / 2.0
    x_b = xc + slab_width / 2.0
    add_curved_slab(x_a, x_b)
    s_a = upper(x_a) - lower(x_a)
    s_b = upper(x_b) - lower(x_b)
    slab_heights.append((s_a * S, s_b * S))
    print(f"  slab at x = {xc:+.3f}: end-cap squares {s_a * S:.2f} mm and {s_b * S:.2f} mm")


# ---- base plate: bounded region extruded down to z = -base_thickness ----
N_BASE = 400
xs_base = [-x_root + 2.0 * x_root * i / (N_BASE - 1) for i in range(N_BASE)]
y_lo_b = [lower(x) for x in xs_base]
y_hi_b = [upper(x) for x in xs_base]
y_lo_b[0] = y_hi_b[0] = 0.5 * (y_lo_b[0] + y_hi_b[0])
y_lo_b[-1] = y_hi_b[-1] = 0.5 * (y_lo_b[-1] + y_hi_b[-1])

Z_TOP = 0.0
Z_BOT = -BASE_THICKNESS_UNITS

for i in range(N_BASE - 1):
    x1, x2 = xs_base[i], xs_base[i + 1]
    lo1, lo2 = y_lo_b[i], y_lo_b[i + 1]
    hi1, hi2 = y_hi_b[i], y_hi_b[i + 1]

    # Top of base (z = 0), outward normal +z.
    add_quad(P(x1, lo1, Z_TOP), P(x2, lo2, Z_TOP), P(x2, hi2, Z_TOP), P(x1, hi1, Z_TOP))
    # Bottom of base (z = -t), outward normal -z.
    add_quad(P(x1, lo1, Z_BOT), P(x1, hi1, Z_BOT), P(x2, hi2, Z_BOT), P(x2, lo2, Z_BOT))
    # Lower-curve side wall.
    add_quad(P(x1, lo1, Z_BOT), P(x2, lo2, Z_BOT), P(x2, lo2, Z_TOP), P(x1, lo1, Z_TOP))
    # Upper-curve side wall.
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
    header = b"square-cross-section demo with curved-side slabs".ljust(80, b"\0")
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

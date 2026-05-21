"""
Generate an STL for a calculus demonstration of the solid whose base is
the region bounded by y = tan^2(x) and y = 4 - x^2 with square
cross-sections perpendicular to the x-axis.

The solid is rendered as a series of N discrete square slabs spaced along
x with gaps in between. Each slab is centered at an x_i, has thickness w
in x, and a square y-z cross-section of side
s(x_i) = (4 - x_i^2) - tan^2(x_i):

    y in [tan^2(x_i), 4 - x_i^2]
    z in [0, s(x_i)]

For printability the slabs are flared at the base into a 45-degree
chamfer that connects to a thicker base plate, dramatically increasing
the bond strength between each tall, thin slab and the build plate.
"""

import math
import os
import struct

# ---------- parameters ----------
N_SLABS = 5                  # number of square slabs (odd -> centered slab at x=0)
SLAB_FRACTION = 0.75         # slab thickness as a fraction of slab-to-slab spacing
SCALE_MM_PER_UNIT = 10.0
BASE_THICKNESS_MM = 3.0
FILLET_HEIGHT_MM = 4.0       # height over which the slab flares wider at its base
FILLET_EXTRA_MM_MAX = 1.5    # cap on extra half-width at the very bottom
MIN_GAP_AT_BASE_MM = 0.8     # required gap between adjacent fillet bases
MIN_SLAB_HEIGHT_MM = 4.0     # skip slabs whose square is shorter than this
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "bounded_shape.stl")


def upper(x: float) -> float:
    return 4.0 - x * x


def lower(x: float) -> float:
    t = math.tan(x)
    return t * t


def diff(x: float) -> float:
    return upper(x) - lower(x)


# Positive intersection via bisection.
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
FILLET_HEIGHT_UNITS = FILLET_HEIGHT_MM / S
MIN_SLAB_HEIGHT_UNITS = MIN_SLAB_HEIGHT_MM / S

# Auto-clamp FILLET_EXTRA so adjacent slab bases keep a printable gap.
dx_units = (2.0 * x_root) / N_SLABS
slab_top_units = dx_units * SLAB_FRACTION
gap_top_units = dx_units - slab_top_units
max_fillet_mm = max(0.0, (gap_top_units * S - MIN_GAP_AT_BASE_MM) / 2.0)
FILLET_EXTRA_MM = min(FILLET_EXTRA_MM_MAX, max_fillet_mm)
FILLET_EXTRA_UNITS = FILLET_EXTRA_MM / S
print(
    f"Computed FILLET_EXTRA = {FILLET_EXTRA_MM:.2f} mm (gap at base "
    f"= {gap_top_units * S - 2 * FILLET_EXTRA_MM:.2f} mm)"
)


def P(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (x * S, y * S, z * S)


triangles: list[tuple[tuple[float, float, float], ...]] = []


def add_tri(a, b, c):
    triangles.append((a, b, c))


def add_quad(a, b, c, d):
    add_tri(a, b, c)
    add_tri(a, c, d)


def add_filleted_slab(
    xc: float,
    y_lo: float,
    y_hi: float,
    side: float,
    xhalf_top: float,
    xhalf_bot: float,
    fillet_h: float,
):
    """Add a slab whose cross-section is a square of side `side` (in math units)
    in the (y, z) plane, with the bottom chamfered out in x for strength.

    The slab spans x in [xc - xhalf_top, xc + xhalf_top] above z = fillet_h,
    and flares to [xc - xhalf_bot, xc + xhalf_bot] at z = 0. y is constant
    [y_lo, y_hi] throughout.
    """
    h = min(fillet_h, side)

    b1 = P(xc - xhalf_bot, y_lo, 0.0)
    b2 = P(xc + xhalf_bot, y_lo, 0.0)
    b3 = P(xc + xhalf_bot, y_hi, 0.0)
    b4 = P(xc - xhalf_bot, y_hi, 0.0)

    m1 = P(xc - xhalf_top, y_lo, h)
    m2 = P(xc + xhalf_top, y_lo, h)
    m3 = P(xc + xhalf_top, y_hi, h)
    m4 = P(xc - xhalf_top, y_hi, h)

    # Bottom face, outward normal -z. CCW seen from below.
    add_quad(b1, b4, b3, b2)
    # Frustum side faces (between b and m rings), outward normals point outward.
    # -x face
    add_quad(b1, m1, m4, b4)
    # +x face
    add_quad(b2, b3, m3, m2)
    # -y face
    add_quad(b1, b2, m2, m1)
    # +y face
    add_quad(b3, b4, m4, m3)

    if side > h + 1e-9:
        t1 = P(xc - xhalf_top, y_lo, side)
        t2 = P(xc + xhalf_top, y_lo, side)
        t3 = P(xc + xhalf_top, y_hi, side)
        t4 = P(xc - xhalf_top, y_hi, side)
        # Top face, outward normal +z. CCW from above.
        add_quad(t1, t2, t3, t4)
        # Vertical box side faces, between m ring (z=h) and t ring (z=side).
        # -x face
        add_quad(m1, t1, t4, m4)
        # +x face
        add_quad(m2, m3, t3, t2)
        # -y face
        add_quad(m1, m2, t2, t1)
        # +y face
        add_quad(m3, m4, t4, t3)
    else:
        # Frustum reaches all the way to the top; m ring is the top.
        add_quad(m1, m2, m3, m4)


# ---- slabs ----
dx = (2.0 * x_root) / N_SLABS
slab_width_top = dx * SLAB_FRACTION
xhalf_top = 0.5 * slab_width_top
xhalf_bot = xhalf_top + FILLET_EXTRA_UNITS
slab_centers = [-x_root + (i + 0.5) * dx for i in range(N_SLABS)]

print(
    f"Slab spacing dx = {dx * S:.2f} mm, slab thickness (top) = {slab_width_top * S:.2f} mm, "
    f"gap = {(dx - slab_width_top) * S:.2f} mm, fillet base width = {2 * xhalf_bot * S:.2f} mm"
)

for xc in slab_centers:
    y_low = lower(xc)
    y_high = upper(xc)
    side = y_high - y_low
    if side < MIN_SLAB_HEIGHT_UNITS:
        print(f"  skipping slab at x = {xc:.3f}: side {side * S:.2f} mm < min {MIN_SLAB_HEIGHT_MM} mm")
        continue
    add_filleted_slab(
        xc=xc,
        y_lo=y_low,
        y_hi=y_high,
        side=side,
        xhalf_top=xhalf_top,
        xhalf_bot=xhalf_bot,
        fillet_h=FILLET_HEIGHT_UNITS,
    )


# ---- base plate: bounded region extruded down to z = -base_thickness ----
N_BASE = 400
xs = [-x_root + 2.0 * x_root * i / (N_BASE - 1) for i in range(N_BASE)]
y_lo_b = [lower(x) for x in xs]
y_hi_b = [upper(x) for x in xs]
# Force endpoints to coincide for numerical safety.
y_lo_b[0] = y_hi_b[0] = 0.5 * (y_lo_b[0] + y_hi_b[0])
y_lo_b[-1] = y_hi_b[-1] = 0.5 * (y_lo_b[-1] + y_hi_b[-1])

Z_TOP = 0.0
Z_BOT = -BASE_THICKNESS_UNITS

for i in range(N_BASE - 1):
    x1, x2 = xs[i], xs[i + 1]
    lo1, lo2 = y_lo_b[i], y_lo_b[i + 1]
    hi1, hi2 = y_hi_b[i], y_hi_b[i + 1]

    # Top of base (z = 0), outward normal +z.
    add_quad(P(x1, lo1, Z_TOP), P(x2, lo2, Z_TOP), P(x2, hi2, Z_TOP), P(x1, hi1, Z_TOP))
    # Bottom of base (z = -t), outward normal -z (reverse winding).
    add_quad(P(x1, lo1, Z_BOT), P(x1, hi1, Z_BOT), P(x2, hi2, Z_BOT), P(x2, lo2, Z_BOT))
    # Lower-curve side wall (y = tan^2), outward normal -y.
    add_quad(P(x1, lo1, Z_BOT), P(x2, lo2, Z_BOT), P(x2, lo2, Z_TOP), P(x1, lo1, Z_TOP))
    # Upper-curve side wall (y = 4 - x^2), outward normal +y (reverse winding).
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
    header = b"square-cross-section demo slabs with filleted bases".ljust(80, b"\0")
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

"""
Generate an STL of the solid obtained by revolving the 2D region bounded by
y = tan^2(x) and y = 4 - x^2 a full 360 degrees around the x-axis.

The two curves intersect symmetrically near x = +/- 1.0410. Over that
interval, 4 - x^2 is the upper curve (outer radius after revolution) and
tan^2(x) is the lower curve (inner radius after revolution). At the
intersections, outer radius == inner radius == ~2.916, so the outer and
inner surfaces meet there and the solid closes off without explicit end
caps. At x = 0 the inner radius collapses to a point (tan^2(0) = 0), so the
inner surface pinches the cavity into two cone-like voids.
"""

import math
import os
import struct

# ---------- parameters ----------
N_SAMPLES_X = 401      # samples along x (odd so x = 0 is hit exactly)
N_SAMPLES_THETA = 96   # angular samples around x-axis
SCALE_MM_PER_UNIT = 10.0
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "bounded_shape.stl")


def upper(x: float) -> float:
    return 4.0 - x * x


def lower(x: float) -> float:
    t = math.tan(x)
    return t * t


def diff(x: float) -> float:
    return upper(x) - lower(x)


# Find the positive intersection by bisection.
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
print(f"At intersection: R = r = {upper(x_root):.6f}")

# x samples — odd count ensures x = 0 is sampled (so inner radius pinches to 0 exactly).
xs = [-x_root + 2.0 * x_root * i / (N_SAMPLES_X - 1) for i in range(N_SAMPLES_X)]
# Make the endpoint radii match exactly (numerical safety).
end_radius = 0.5 * (upper(x_root) + lower(x_root))
Rs = [upper(x) for x in xs]
rs = [lower(x) for x in xs]
Rs[0] = rs[0] = end_radius
Rs[-1] = rs[-1] = end_radius

# Precompute ring trig.
thetas = [2.0 * math.pi * j / N_SAMPLES_THETA for j in range(N_SAMPLES_THETA)]
cos_t = [math.cos(t) for t in thetas]
sin_t = [math.sin(t) for t in thetas]


def point(x_i: int, radius_list: list[float], j: int) -> tuple[float, float, float]:
    r = radius_list[x_i]
    return (
        xs[x_i] * SCALE_MM_PER_UNIT,
        r * cos_t[j] * SCALE_MM_PER_UNIT,
        r * sin_t[j] * SCALE_MM_PER_UNIT,
    )


triangles: list[tuple[tuple[float, float, float], ...]] = []


def add_tri(a, b, c):
    triangles.append((a, b, c))


def add_quad(a, b, c, d):
    add_tri(a, b, c)
    add_tri(a, c, d)


# ---- outer surface (radius = 4 - x^2). Outward normal points radially out. ----
for i in range(N_SAMPLES_X - 1):
    for j in range(N_SAMPLES_THETA):
        j2 = (j + 1) % N_SAMPLES_THETA
        p11 = point(i, Rs, j)
        p12 = point(i, Rs, j2)
        p21 = point(i + 1, Rs, j)
        p22 = point(i + 1, Rs, j2)
        # CCW seen from outside (radially): p11 -> p21 -> p22 -> p12
        add_quad(p11, p21, p22, p12)

# ---- inner surface (radius = tan^2(x)). Outward normal points radially IN. ----
# Reverse winding so the normal flips compared to the outer surface.
for i in range(N_SAMPLES_X - 1):
    for j in range(N_SAMPLES_THETA):
        j2 = (j + 1) % N_SAMPLES_THETA
        p11 = point(i, rs, j)
        p12 = point(i, rs, j2)
        p21 = point(i + 1, rs, j)
        p22 = point(i + 1, rs, j2)
        add_quad(p11, p12, p22, p21)

# (No end caps needed: at i=0 and i=N-1, Rs[i] == rs[i], so the inner and
# outer rings are geometrically the same circle, sealing the solid.)


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
    header = b"solid of revolution of region between tan^2(x) and 4-x^2".ljust(80, b"\0")
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

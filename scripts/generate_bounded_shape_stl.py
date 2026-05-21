"""
Generate an STL of the solid whose base is the 2D region bounded by
y = tan^2(x) and y = 4 - x^2, with square cross-sections perpendicular
to the x-axis.

At each x, the cross-section is a square in the (y, z) plane:
    y in [tan^2(x), 4 - x^2],   z in [0, s(x)]
where s(x) = (4 - x^2) - tan^2(x) is the height of the base region at x.

The two boundary curves meet at x = +/- 1.0410, where s = 0, so the solid
tapers to a point at both ends. The solid is bounded by:
  * bottom face: the base region in the xy-plane (z = 0)
  * top face: the surface z = s(x) for (x, y) over the base region
  * front face: y = tan^2(x), z in [0, s(x)]
  * back face: y = 4 - x^2, z in [0, s(x)]
"""

import math
import os
import struct

# ---------- parameters ----------
N_SAMPLES = 600
SCALE_MM_PER_UNIT = 15.0
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "bounded_shape.stl")


def upper(x: float) -> float:
    return 4.0 - x * x


def lower(x: float) -> float:
    t = math.tan(x)
    return t * t


def diff(x: float) -> float:
    return upper(x) - lower(x)


# Find positive intersection via bisection.
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

xs = [-x_root + 2.0 * x_root * i / (N_SAMPLES - 1) for i in range(N_SAMPLES)]
y_lo = [lower(x) for x in xs]
y_hi = [upper(x) for x in xs]
# Force endpoints to coincide (numerical safety).
end_val = 0.5 * (y_lo[0] + y_hi[0])
y_lo[0] = y_hi[0] = end_val
y_lo[-1] = y_hi[-1] = 0.5 * (y_lo[-1] + y_hi[-1])
s = [y_hi[i] - y_lo[i] for i in range(N_SAMPLES)]


S = SCALE_MM_PER_UNIT


def P(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (x * S, y * S, z * S)


triangles: list[tuple[tuple[float, float, float], ...]] = []


def add_tri(a, b, c):
    triangles.append((a, b, c))


def add_quad(a, b, c, d):
    add_tri(a, b, c)
    add_tri(a, c, d)


for i in range(N_SAMPLES - 1):
    x1, x2 = xs[i], xs[i + 1]
    lo1, lo2 = y_lo[i], y_lo[i + 1]
    hi1, hi2 = y_hi[i], y_hi[i + 1]
    s1, s2 = s[i], s[i + 1]

    # Bottom face (z = 0), outward normal -z.
    b_lo1 = P(x1, lo1, 0.0)
    b_lo2 = P(x2, lo2, 0.0)
    b_hi1 = P(x1, hi1, 0.0)
    b_hi2 = P(x2, hi2, 0.0)
    # CCW seen from below: (lo1, hi1, hi2, lo2)
    add_quad(b_lo1, b_hi1, b_hi2, b_lo2)

    # Top face (z = s(x)), outward normal +z.
    t_lo1 = P(x1, lo1, s1)
    t_lo2 = P(x2, lo2, s2)
    t_hi1 = P(x1, hi1, s1)
    t_hi2 = P(x2, hi2, s2)
    # CCW from above: (lo1, lo2, hi2, hi1)
    add_quad(t_lo1, t_lo2, t_hi2, t_hi1)

    # Front face (y = tan^2(x)), outward normal in -y direction roughly.
    # Quad: (x1, lo1, 0) -> (x2, lo2, 0) -> (x2, lo2, s2) -> (x1, lo1, s1)
    add_quad(b_lo1, t_lo1, t_lo2, b_lo2)

    # Back face (y = 4 - x^2), outward normal +y roughly.
    # Reverse winding so normal flips.
    add_quad(b_hi1, b_hi2, t_hi2, t_hi1)


# No end caps: at i = 0 and i = N-1, lo == hi and s == 0, so the cross-section
# is a single point — both ends taper naturally.


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
    header = b"square-cross-section solid over bounded region".ljust(80, b"\0")
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

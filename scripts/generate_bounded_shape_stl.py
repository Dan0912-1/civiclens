"""
Generate an STL of the 2D region bounded by y = tan^2(x) and y = 4 - x^2,
extruded along z for 3D printing.

The two curves intersect symmetrically near x = +/- 1.0424.
Over that interval, 4 - x^2 is the upper curve and tan^2(x) is the lower curve.
"""

import math
import struct
import os

# ---------- geometry parameters ----------
N_SAMPLES = 400              # samples along x for each curve
THICKNESS_MM = 5.0           # extrusion depth (z)
SCALE_MM_PER_UNIT = 20.0     # scale factor: 1 math-unit -> 20 mm
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "bounded_shape.stl")


def upper(x: float) -> float:
    return 4.0 - x * x


def lower(x: float) -> float:
    t = math.tan(x)
    return t * t


def diff(x: float) -> float:
    return upper(x) - lower(x)


def find_root(a: float, b: float, tol: float = 1e-12) -> float:
    fa, fb = diff(a), diff(b)
    assert fa * fb < 0, "no sign change on [a, b]"
    for _ in range(200):
        m = 0.5 * (a + b)
        fm = diff(m)
        if abs(fm) < tol or (b - a) < tol:
            return m
        if fa * fm < 0:
            b, fb = m, fm
        else:
            a, fa = m, fm
    return 0.5 * (a + b)


# Intersection in (0, pi/2)
x_right = find_root(1.0, 1.5)
x_left = -x_right
print(f"Intersection at x = +/- {x_right:.6f}")
print(f"At intersection: upper={upper(x_right):.6f}, lower={lower(x_right):.6f}")


# ---------- sample the two curves between -x_root and +x_root ----------
xs = [x_left + (x_right - x_left) * i / (N_SAMPLES - 1) for i in range(N_SAMPLES)]
# Pin the endpoints exactly so top and bottom meet to zero thickness there.
ys_upper = [upper(x) for x in xs]
ys_lower = [lower(x) for x in xs]
# Force the endpoints to coincide (numerical safety).
ys_upper[0] = ys_lower[0] = 0.5 * (ys_upper[0] + ys_lower[0])
ys_upper[-1] = ys_lower[-1] = 0.5 * (ys_upper[-1] + ys_lower[-1])


# Scale to mm; center the shape on the XY origin.
y_min = min(ys_lower)
y_max = max(ys_upper)
y_center = 0.5 * (y_min + y_max)


def to_mm_xy(x: float, y: float) -> tuple[float, float]:
    return (x * SCALE_MM_PER_UNIT, (y - y_center) * SCALE_MM_PER_UNIT)


# Build the 2D polygon: upper curve left->right, then lower curve right->left.
# Skip duplicate endpoints when stitching.
poly_top = [to_mm_xy(xs[i], ys_upper[i]) for i in range(N_SAMPLES)]
poly_bot = [to_mm_xy(xs[i], ys_lower[i]) for i in range(N_SAMPLES)]


# ---------- build mesh ----------
# Vertices: for each i, we have an upper and a lower point on both z=0 and z=T.
# Strip triangulation of top/bottom faces uses (upper_i, lower_i) pairs.
T = THICKNESS_MM
triangles: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]] = []


def add_tri(a, b, c):
    triangles.append((a, b, c))


def add_quad(a, b, c, d):
    # quad ordered a-b-c-d going around the face; split into two triangles
    add_tri(a, b, c)
    add_tri(a, c, d)


# Bottom face (z = 0), normal pointing -z, so wind clockwise when viewed from +z.
# We'll use strips between consecutive x samples.
for i in range(N_SAMPLES - 1):
    ux1, uy1 = poly_top[i]
    ux2, uy2 = poly_top[i + 1]
    lx1, ly1 = poly_bot[i]
    lx2, ly2 = poly_bot[i + 1]
    # Quad in 2D: upper_i, upper_{i+1}, lower_{i+1}, lower_i
    # For bottom face (z=0) viewed from below (-z), reverse winding.
    a = (ux1, uy1, 0.0)
    b = (ux2, uy2, 0.0)
    c = (lx2, ly2, 0.0)
    d = (lx1, ly1, 0.0)
    # CW when viewed from +z => CCW from -z (outward normal -z): reverse order.
    add_quad(a, d, c, b)

    # Top face (z = T), outward normal +z: keep CCW from +z.
    a_t = (ux1, uy1, T)
    b_t = (ux2, uy2, T)
    c_t = (lx2, ly2, T)
    d_t = (lx1, ly1, T)
    add_quad(a_t, b_t, c_t, d_t)


# Side walls along the upper curve (between successive top-points).
# Outward normal points roughly +y (upward in 2D plane).
for i in range(N_SAMPLES - 1):
    p1x, p1y = poly_top[i]
    p2x, p2y = poly_top[i + 1]
    # Quad: (p1, z=0) -> (p2, z=0) -> (p2, z=T) -> (p1, z=T)
    a = (p1x, p1y, 0.0)
    b = (p2x, p2y, 0.0)
    c = (p2x, p2y, T)
    d = (p1x, p1y, T)
    add_quad(a, b, c, d)


# Side walls along the lower curve. Outward normal roughly -y.
# Reverse order so the outward normal points the other way.
for i in range(N_SAMPLES - 1):
    p1x, p1y = poly_bot[i]
    p2x, p2y = poly_bot[i + 1]
    a = (p1x, p1y, 0.0)
    b = (p2x, p2y, 0.0)
    c = (p2x, p2y, T)
    d = (p1x, p1y, T)
    # Reverse winding compared to the upper-curve side.
    add_quad(a, d, c, b)


# (Endpoints already collapse to a point because upper == lower there,
# so we don't need separate left/right end caps.)


# ---------- compute normal for each triangle and write binary STL ----------
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
    header = b"bounded by y=tan^2(x) and y=4-x^2".ljust(80, b"\0")
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

# Print bounding box for the user.
all_pts = []
for tri in triangles:
    all_pts.extend(tri)
xs_mm = [p[0] for p in all_pts]
ys_mm = [p[1] for p in all_pts]
zs_mm = [p[2] for p in all_pts]
print(
    f"Bounding box (mm): "
    f"x [{min(xs_mm):.2f}, {max(xs_mm):.2f}]  "
    f"y [{min(ys_mm):.2f}, {max(ys_mm):.2f}]  "
    f"z [{min(zs_mm):.2f}, {max(zs_mm):.2f}]"
)

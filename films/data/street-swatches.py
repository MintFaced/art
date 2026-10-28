"""One-off: where each of a painting's colours sits on its street, as a point
in the before photo, for the swatches that lift off the street in film 1.

    python3 films/data/street-swatches.py <before> <hexes,...> <x0,y0,x1,y1 frame> <fx0,fy0,fx1,fy1 fascia> <out.json> [tolerance]

A colour counts only where a patch of it at least ~0.15% of the frame really is
on the street, outside the empty fascia (the painting is not there yet). The
point is the patch's most interior pixel, so the leader line lands on the sign
or wall itself and not on an edge. The tolerance (Lab distance, default 10)
can be raised for a colour the photo caught in other light: 328 West's yellow
is its Value Hub sign, which reads darker in that before photo's sun.
"""
import json, sys
import cv2, numpy as np

src, hexes, frame, fascia, out = sys.argv[1:6]
tol = float(sys.argv[6]) if len(sys.argv) > 6 else 10
B = cv2.imread(src)
x0, y0, x1, y1 = (int(v) for v in frame.split(','))
fx0, fy0, fx1, fy1 = (int(v) for v in fascia.split(','))
s = 1200 / (x1 - x0)
crop = cv2.resize(B[y0:y1, x0:x1], None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
lab = cv2.cvtColor(cv2.GaussianBlur(crop, (0, 0), 2.5), cv2.COLOR_BGR2LAB).astype(np.float32)
H, W = lab.shape[:2]
keep = np.ones((H, W), np.uint8)
keep[int((fy0 - y0) * s):int((fy1 - y0) * s), int((fx0 - x0) * s):int((fx1 - x0) * s)] = 0
margin = 12
keep[:margin, :] = 0; keep[-margin:, :] = 0; keep[:, :margin] = 0; keep[:, -margin:] = 0
res = []
for hx in hexes.split(','):
    r, g, b = (int(hx[i:i + 2], 16) for i in (1, 3, 5))
    c = cv2.cvtColor(np.uint8([[[b, g, r]]]), cv2.COLOR_BGR2LAB).astype(np.float32)[0, 0]
    d = np.sqrt(((lab - c) ** 2).sum(axis=2))
    m = ((d < tol) & (keep > 0)).astype(np.uint8)
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n <= 1:
        res.append({"hex": hx, "on_street": False}); continue
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    area = int(stats[k, cv2.CC_STAT_AREA])
    if area < 0.0015 * H * W:
        res.append({"hex": hx, "on_street": False, "area": area}); continue
    dt = cv2.distanceTransform((lbl == k).astype(np.uint8), cv2.DIST_L2, 5)
    yy, xx = np.unravel_index(np.argmax(dt), dt.shape)
    res.append({"hex": hx, "on_street": True, "x": round(x0 + xx / s, 1), "y": round(y0 + yy / s, 1),
                "share": round(area / (H * W), 4)})
json.dump({"frame": [x0, y0, x1, y1], "fascia": [fx0, fy0, fx1, fy1], "swatches": res}, open(out, "w"), indent=1)
for r in res: print(r)

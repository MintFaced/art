"""One-off: register a site's after photo onto its before photo, and find where
each of the painting's colours sits on the street.

    python3 films/data/register-street.py <before> <after> <palette-hexes,...> <out.json>

Writes the homography (after -> before, in full-resolution pixels) and, for each
colour that really is on the street, the point in the before photo where it is.
OpenCV is not a project dependency: this runs once per site, and the films read
the JSON it writes (films/data/street.json).
"""
import json, sys
import cv2, numpy as np

before_p, after_p, hexes, out_p = sys.argv[1:5]
B = cv2.imread(before_p); A = cv2.imread(after_p)
def small(im, m=1600):
    s = m / max(im.shape[:2]); return cv2.resize(im, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), s
b, sb = small(B); a, sa = small(A)
sift = cv2.SIFT_create(6000)
kb, db = sift.detectAndCompute(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY), None)
ka, da = sift.detectAndCompute(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), None)
m = cv2.BFMatcher().knnMatch(da, db, k=2)
good = [x for x, y in m if x.distance < 0.72 * y.distance]
pa = np.float32([ka[g.queryIdx].pt for g in good]) / sa
pb = np.float32([kb[g.trainIdx].pt for g in good]) / sb
H, mask = cv2.findHomography(pa, pb, cv2.RANSAC, 6.0)
inl = int(mask.sum())
# how much of the before frame the warped after covers
h, w = A.shape[:2]
corners = cv2.perspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2), H).reshape(-1, 2)

# Where each painting colour sits on the street: the before photo, smoothed,
# in Lab; the best-matching pixel outside the (empty) fascia, if close enough.
lab = cv2.cvtColor(cv2.GaussianBlur(b, (0, 0), 3), cv2.COLOR_BGR2LAB).astype(np.float32)
pts = []
for hx in hexes.split(','):
    r, g, bl = (int(hx[i:i + 2], 16) for i in (1, 3, 5))
    c = cv2.cvtColor(np.uint8([[[bl, g, r]]]), cv2.COLOR_BGR2LAB).astype(np.float32)[0, 0]
    d = np.sqrt(((lab - c) ** 2).sum(axis=2))
    y, x = np.unravel_index(np.argmin(d), d.shape)
    # Lab units in OpenCV's 8-bit scale; ~12 is a near match
    pts.append({"hex": hx, "x": round(float(x / sb), 1), "y": round(float(y / sb), 1), "dist": round(float(d[y, x]), 1)})
json.dump({"before": {"w": B.shape[1], "h": B.shape[0]}, "after": {"w": w, "h": h},
           "H": [[round(float(v), 9) for v in row] for row in H], "inliers": inl, "matches": len(good),
           "after_corners_in_before": [[round(float(x), 1), round(float(y), 1)] for x, y in corners],
           "swatches": pts}, open(out_p, "w"), indent=1)
print("inliers", inl, "of", len(good)); print("corners", corners.round(0).tolist())
for p in pts: print(p)

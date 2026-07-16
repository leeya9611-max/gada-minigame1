#!/usr/bin/env python3
"""시트 알파 연결 요소 분석 — 프레임 bbox를 읽기 순서(행→열)로 리포트 + 디버그 크롭 저장"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = "/Users/worksmate/minigame/assets/incoming_ai/sheets"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sheet_debug")
os.makedirs(OUT, exist_ok=True)

def components(path, dilate=25, min_area=8000):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)[:, :, 3] > 16
    # 팽창으로 안티앨리어싱·파편(모자 등 분리 파트) 병합
    st = np.ones((dilate, dilate), bool)
    grown = ndimage.binary_dilation(a, structure=st)
    lab, n = ndimage.label(grown)
    boxes = []
    for sl in ndimage.find_objects(lab):
        # 실제 알파 기준 bbox로 축소
        sub = a[sl]
        if sub.sum() < min_area:
            continue
        ys, xs = np.where(sub)
        y0, x0 = sl[0].start, sl[1].start
        boxes.append((x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1))
    # 읽기 순서 정렬: 행 클러스터(중심 y) → x
    boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
    rows = []
    for b in boxes:
        cy = (b[1] + b[3]) / 2
        placed = False
        for r in rows:
            rcy = sum((bb[1] + bb[3]) / 2 for bb in r) / len(r)
            rh = max(bb[3] - bb[1] for bb in r)
            if abs(cy - rcy) < rh * 0.5:
                r.append(b); placed = True; break
        if not placed:
            rows.append([b])
    ordered = []
    for r in rows:
        r.sort(key=lambda b: b[0])
        ordered.extend(r)
    return im, ordered

if __name__ == "__main__":
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".png"):
            continue
        im, boxes = components(os.path.join(SRC, name))
        print(f"\n{name} {im.size} → {len(boxes)} components")
        for i, (x0, y0, x1, y1) in enumerate(boxes):
            print(f"  [{i}] x={x0}..{x1} y={y0}..{y1} w={x1-x0} h={y1-y0}")
            crop = im.crop((x0, y0, x1, y1))
            crop.thumbnail((160, 160))
            crop.save(os.path.join(OUT, f"{name[:-4]}_{i:02d}.png"))

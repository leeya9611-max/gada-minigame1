#!/usr/bin/env python3
"""캐릭터 시트 → gimbanjang_custom/parksojang_custom 프레임 빌드.
- 알파 연결 요소 분할(고정 격자 금지), 프레임 내 최대 컴포넌트만 유지(파편 제거)
- 발바닥(bbox bottom) 기준선 정렬, 캐릭터별 통일 스케일
- 균일 캔버스(run/jump/fall/throw) + 트림 raw(slide/hurt/idle/idle_docs/cheer)
출력: 프레임 PNG + manifest 값(JSON stdout)
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sheet_inspect import components

SRC = "/Users/worksmate/minigame/assets/incoming_ai/sheets"
DST = "/Users/worksmate/minigame/public/assets/sprites"
SCALE = 0.553  # 기존 규격 패리티(김반장 run 실키 ~514px)

def largest_comp_crop(im, box):
    """프레임 bbox 내부를 재분할해 최대 컴포넌트만 남긴 RGBA 크롭 반환(파편·소품 제거)"""
    crop = im.crop(box)
    a = np.array(crop)
    alpha = a[:, :, 3] > 16
    grown = ndimage.binary_dilation(alpha, structure=np.ones((6, 6), bool))
    lab, n = ndimage.label(grown)
    if n > 1:
        sizes = ndimage.sum(alpha, lab, range(1, n + 1))
        keep = np.argmax(sizes) + 1
        a[lab != keep] = 0
    alpha2 = a[:, :, 3] > 16
    ys, xs = np.where(alpha2)
    out = Image.fromarray(a).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    return out

def load_frames(sheet, dilate, indices):
    im, boxes = components(os.path.join(SRC, sheet), dilate=dilate)
    return [largest_comp_crop(im, boxes[i]) for i in indices]

def strip_ground_shadow(im, band=0.15):
    """프레임 하단 밴드의 회색 접지 그림자 제거(저채도·중명도 픽셀 alpha=0).
    부츠(어두움)·바지(저명도)와 구분: lum>0.5 & sat<0.2만 제거."""
    a = np.array(im)
    h = a.shape[0]
    band_from = int(h * (1 - band))
    r, g, b = a[band_from:, :, 0]/255., a[band_from:, :, 1]/255., a[band_from:, :, 2]/255.
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    sat = np.where(mx > 0, (mx - mn)/np.maximum(mx, 1e-6), 0)
    lum = 0.2126*r + 0.7152*g + 0.0722*b
    kill = (sat < 0.2) & (lum > 0.5)
    a[band_from:, :, 3][kill] = 0
    out = Image.fromarray(a)
    # 재트림(그림자 제거로 bbox 변동)
    al = np.array(out)[:, :, 3] > 16
    ys, xs = np.where(al)
    return out.crop((xs.min(), ys.min(), xs.max()+1, ys.max()+1))

def scaled(img):
    w, h = img.size
    return img.resize((max(1, round(w * SCALE)), max(1, round(h * SCALE))), Image.LANCZOS)

def save_img(im, path):
    """WebP q95 — 시각 무손실·소용량. 256색 양자화 금지(그라데이션 밴딩·그레인)."""
    path = path.rsplit('.', 1)[0] + '.webp'
    im.save(path, 'WEBP', quality=95, method=6)

def build_uniform(frames, names, outdir, pad_top=12, pad_side=14, pad_bottom=10):
    """통일 캔버스: 발바닥(bbox bottom)을 footY에, 수평은 bbox 중심을 anchorX에 정렬"""
    frames = [scaled(f) for f in frames]
    W = max(f.width for f in frames) + pad_side * 2
    H = max(f.height for f in frames) + pad_top + pad_bottom
    footY = H - pad_bottom
    anchorX = W // 2
    for f, name in zip(frames, names):
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        canvas.paste(f, (anchorX - f.width // 2, footY - f.height), f)
        save_img(canvas, os.path.join(outdir, name))
    return {"w": W, "h": H, "anchorX": anchorX, "footY": footY}

def build_raw(frame, name, outdir):
    f = scaled(frame)
    save_img(f, os.path.join(outdir, name))
    return {"name": name, "w": f.width, "h": f.height}

def main():
    meta = {}

    # ── 김반장 ──
    gdir = os.path.join(DST, "gimbanjang_custom")
    # 러닝 v2(2026-07-21): 6프레임 시트(프레임 ~1890px — 구 시트의 2배 해상도).
    # 구 세트(jump/fall 등, ~940px)와 캐릭터 크기가 맞도록 사전 정규화(1890→940 상당).
    V2_PRE = 940 / 1890
    run = [f.resize((round(f.width * V2_PRE), round(f.height * V2_PRE)), Image.LANCZOS)
           for f in load_frames("sheet_gimbanjang_run_v2.png", 8, range(6))]
    actions = load_frames("sheet_gimbanjang_actions.png", 25, range(4))  # 점프/낙하/슬라이드/허트
    # E3.10-1: 구 액션 시트 캐릭터가 v2 러닝보다 8% 큼(헬멧 면적 실측) → 통일 정규화
    ACTIONS_NORM = 1 / 1.08
    actions = [f.resize((round(f.width*ACTIONS_NORM), round(f.height*ACTIONS_NORM)), Image.LANCZOS) for f in actions]
    mixed = load_frames("sheet_gimbanjang_mixed.png", 8, [5, 6])  # 서류 idle / cheer
    idle = load_frames("sheet_gimbanjang_idle.png", 25, [0])

    g_uniform = run + [actions[0], actions[1]]
    g_names = [f"run{i+1}.png" for i in range(6)] + ["jump.png", "fall.png"]
    meta["gimbanjang"] = build_uniform(g_uniform, g_names, gdir)
    meta["gimbanjang"]["realH"] = scaled(run[0]).height  # run1 알파 bbox 높이
    meta["gimbanjang"]["raw"] = [
        build_raw(actions[2], "slide.png", gdir),
        build_raw(actions[3], "hurt.png", gdir),
        build_raw(idle[0], "idle.png", gdir),
        build_raw(mixed[0], "idle_docs.png", gdir),
        build_raw(mixed[1], "cheer.png", gdir),
    ]

    # ── 박소장 ──
    pdir = os.path.join(DST, "parksojang_custom")
    # 러닝 v2(2026-07-21): 8프레임. 신규 캐릭터가 구 세트(투척·idle)보다 ~7% 큼(피부 면적 실측) →
    # 사전 정규화 + 프레임에 베이크된 접지 그림자 제거(발선 정렬 왜곡 방지)
    PARK_V2_PRE = 1 / 1.07
    prun = [f.resize((round(f.width*PARK_V2_PRE), round(f.height*PARK_V2_PRE)), Image.LANCZOS)
            for f in (strip_ground_shadow(f) for f in load_frames("sheet_parksojang_run_v2.png", 8, range(8)))]
    pthrow = load_frames("sheet_parksojang_run_throw.png", 25, [7, 8, 9])
    pidle = load_frames("sheet_parksojang_idle.png", 25, [0])
    p_uniform = prun + pthrow + pidle
    p_names = [f"run{i+1}.png" for i in range(8)] + ["throw1.png", "throw2.png", "throw3.png", "idle.png"]
    meta["parksojang"] = build_uniform(p_uniform, p_names, pdir)
    meta["parksojang"]["realH"] = scaled(prun[0]).height

    print(json.dumps(meta, indent=2))

if __name__ == "__main__":
    main()

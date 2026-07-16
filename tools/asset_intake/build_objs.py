#!/usr/bin/env python3
"""incoming_ai 비캐릭터 에셋 → public/assets 규격 축소·복사"""
import os
import numpy as np
from PIL import Image

SRC = "/Users/worksmate/minigame/assets/incoming_ai"
DST = "/Users/worksmate/minigame/public/assets"

def trim(im):
    a = np.array(im)[:, :, 3]
    ys, xs = np.where(a > 16)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def save(im, rel, h=None, w=None, square=None):
    if square:
        s = max(im.size)
        pad = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        pad.paste(im, ((s - im.width) // 2, (s - im.height) // 2), im)
        im = pad.resize((square, square), Image.LANCZOS)
    elif h:
        im = im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)
    elif w:
        im = im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)
    path = os.path.join(DST, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    print(rel, Image.open(path).size)

def load(rel):
    return trim(Image.open(os.path.join(SRC, rel)).convert("RGBA"))

# 장애물 — 렌더 크기 2~2.5x 소스
save(load("obstacles/obstacle_puddle.png"), "sprites/obstacles/puddle.png", w=240)
save(load("obstacles/obstacle_stack.png"), "sprites/obstacles/stack.png", h=160)
save(load("obstacles/obstacle_lowbar.png"), "sprites/obstacles/lowbar.png", h=500)
save(load("obstacles/obstacle_fall_pipes.png"), "sprites/obstacles/fall_pipes.png", h=120)
save(load("obstacles/obstacle_barrier.png"), "sprites/obstacles/barrier.png", h=160)  # 예비

# 투척물
save(load("projectiles/projectile_papers.png"), "sprites/projectiles/papers.png", w=96)
save(load("projectiles/projectile_tube.png"), "sprites/projectiles/tube.png", h=90)
save(load("projectiles/projectile_megaphone.png"), "sprites/projectiles/megaphone.png", w=72)

# 아이템
save(load("items/coin_helmet.png"), "sprites/items/coin_helmet.png", square=72)

# 소품
save(load("props/prop_cone.png"), "sprites/props/cone.png", h=100)
save(load("props/prop_sign_safety.png"), "sprites/props/sign_safety.png", h=180)
save(load("props/prop_fence_panel.png"), "sprites/props/fence_panel.png", h=160)
save(load("props/prop_busstop.png"), "sprites/props/busstop.png", h=420)
save(load("props/prop_board_blank.png"), "ui/board_blank.png", w=640)  # 배너·공지용(추후)

# ── 배경 ──
far = Image.open(os.path.join(SRC, "bg/bg_far_sunset.png")).convert("RGBA")
save(far, "maps/map1/sky.png", h=700)

mid = Image.open(os.path.join(SRC, "bg/bg_mid_buildings.png")).convert("RGBA")
mid = mid.crop((0, 148, mid.width, 1300))
save(mid, "maps/map1/silhouette.png", h=660)

g = Image.open(os.path.join(SRC, "ground/ground_strip.png")).convert("RGBA")
top = g.crop((0, 0, g.width, 320))
mirrored = Image.new("RGBA", (top.width * 2, top.height))
mirrored.paste(top, (0, 0))
mirrored.paste(top.transpose(Image.FLIP_LEFT_RIGHT), (top.width, 0))
save(mirrored, "maps/map1/ground.png", h=200)

# 흙 채움 색 샘플(지형 dirt fill 코드 값)
arr = np.array(g)
dirt = arr[400:560, :, :3].reshape(-1, 3).mean(axis=0)  # 중간 흙
deep = arr[640:720, :, :3].reshape(-1, 3).mean(axis=0)  # 하단 어두운 영역
print("dirt fill  #%02x%02x%02x" % tuple(int(c) for c in dirt))
print("deep fill  #%02x%02x%02x" % tuple(int(c) for c in deep))

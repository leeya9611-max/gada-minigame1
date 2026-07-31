# E7-BGM: 8비트 칩튠 루프 생성기 — 외부 소스 없이 상업 사용 가능한 자체 BGM.
# v2(피드백 "너무 평화로움"): 코믹 추격전 톤 — A단조 하강 진행(Am-G-F-E), 158BPM,
# 갤럽 베이스(둠-다다) + 4-on-floor 킥 + 16분 햇 드라이브.
# 사용: python3 tools/bgm_gen.py → public/sfx/bgm_main.wav
import math
import struct
import wave

SR = 22050
BPM = 158
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 8
TOTAL = BAR * BARS
N = int(SR * TOTAL)

buf = [0.0] * N


def midi_hz(m: float) -> float:
    return 440 * 2 ** ((m - 69) / 12)


def add_square(t0: float, dur: float, midi: float, gain: float, duty: float = 0.5) -> None:
    hz = midi_hz(midi)
    s0 = int(t0 * SR)
    n = int(dur * SR)
    for i in range(n):
        if s0 + i >= N:
            break
        t = i / SR
        env = min(1.0, t / 0.004) * math.exp(-t * 5.5)  # 짧은 어택 + 감쇠
        ph = (t * hz) % 1.0
        v = 1.0 if ph < duty else -1.0
        buf[s0 + i] += v * gain * env


def add_tri(t0: float, dur: float, midi: float, gain: float) -> None:
    hz = midi_hz(midi)
    s0 = int(t0 * SR)
    n = int(dur * SR)
    for i in range(n):
        if s0 + i >= N:
            break
        t = i / SR
        env = min(1.0, t / 0.005) * math.exp(-t * 3.0)
        ph = (t * hz) % 1.0
        v = 4 * abs(ph - 0.5) - 1
        buf[s0 + i] += v * gain * env


_seed = 12345


def rnd() -> float:  # 결정적 노이즈(재생성 시 동일 파일)
    global _seed
    _seed = (_seed * 1103515245 + 12345) & 0x7FFFFFFF
    return _seed / 0x7FFFFFFF * 2 - 1


def add_noise(t0: float, dur: float, gain: float, decay: float) -> None:
    s0 = int(t0 * SR)
    n = int(dur * SR)
    for i in range(n):
        if s0 + i >= N:
            break
        t = i / SR
        buf[s0 + i] += rnd() * gain * math.exp(-t * decay)


def add_kick(t0: float, gain: float = 0.5) -> None:
    s0 = int(t0 * SR)
    n = int(0.12 * SR)
    for i in range(n):
        if s0 + i >= N:
            break
        t = i / SR
        hz = 120 * math.exp(-t * 22) + 45  # 피치 드랍
        buf[s0 + i] += math.sin(2 * math.pi * hz * t / (1 + t)) * gain * math.exp(-t * 26)


# ── 편곡 v2: 추격전 ──
# 코드: Am G F E ×2. 전반 4마디 = 저역 리프(쫓기는 발놀림), 후반 4마디 = 고역 멜로디(도망 절정).
LEAD = [  # 마디당 8분음표 8개(None=쉼표), MIDI
    [69, 72, 76, 72, 69, 72, 76, 79],  # Am 리프
    [67, 71, 74, 71, 67, 71, 74, 77],  # G
    [65, 69, 72, 69, 65, 69, 72, 76],  # F
    [64, 68, 71, 68, 64, 68, 71, 74],  # E(G# 긴장)
    [81, None, 81, 79, 81, 84, 81, None],  # Am 멜로디
    [79, None, 79, 77, 79, 83, 79, None],  # G
    [77, None, 77, 76, 77, 81, 77, None],  # F
    [80, 79, 80, 83, 80, 83, 84, None],  # E 상승 턴어라운드 → Am 복귀
]
BASS_ROOT = [45, 43, 41, 40, 45, 43, 41, 40]  # A2 G2 F2 E2 ×2

for bar in range(BARS):
    t_bar = bar * BAR
    # 리드(사각파 12.5% 듀티, 스타카토)
    for k, note in enumerate(LEAD[bar]):
        if note is None:
            continue
        add_square(t_bar + k * BEAT / 2, BEAT * 0.42, note, 0.16, duty=0.25)
    # 갤럽 베이스: 박마다 [8분 루트][16분 루트][16분 옥타브] — 둠-다다 질주감
    root = BASS_ROOT[bar]
    for beat in range(4):
        t_beat = t_bar + beat * BEAT
        add_tri(t_beat, BEAT * 0.4, root, 0.22)
        add_tri(t_beat + BEAT * 0.5, BEAT * 0.2, root, 0.20)
        add_tri(t_beat + BEAT * 0.75, BEAT * 0.2, root + 12, 0.18)
    # 드럼: 4-on-floor 킥 + 스네어 2·4박 + 16분 햇(엇박 강세)
    for beat in range(4):
        add_kick(t_bar + beat * BEAT, 0.45)
    add_noise(t_bar + BEAT, 0.09, 0.17, 55)
    add_noise(t_bar + BEAT * 3, 0.09, 0.17, 55)
    for k in range(16):
        add_noise(t_bar + k * BEAT / 4, 0.025, 0.055 if k % 2 else 0.035, 190)
    # 마지막 마디 4박: 스네어 필(따다다닥) → 루프 복귀 추진력
    if bar == BARS - 1:
        for k in range(4):
            add_noise(t_bar + BEAT * 3 + k * BEAT / 4, 0.05, 0.14, 70)

# 소프트 클립 + 16bit 저장
frames = bytearray()
for v in buf:
    v = math.tanh(v * 1.4) * 0.9
    frames += struct.pack("<h", int(v * 32767))

with wave.open("public/sfx/bgm_main.wav", "w") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(bytes(frames))

print(f"bgm_main.wav 생성: {TOTAL:.1f}s, {len(frames)//1024}KB, {BPM}BPM {BARS}마디 루프")

// E8-6: 환경설정(사운드) — localStorage 저장 + 즉시 반영.
// 기본값은 둘 다 on. 저장 키에 "0"일 때만 off(과거 사용자·미저장자는 on 유지).
import { setSfxMuted } from "./sfx";
import { setBgmEnabled as applyBgmEnabled } from "./bgm";

const KEY_BGM = "yarikkiri.sound.bgm";
const KEY_SFX = "yarikkiri.sound.sfx";

export interface SoundSettings {
  bgm: boolean;
  sfx: boolean;
}

export function loadSoundSettings(): SoundSettings {
  if (typeof window === "undefined") return { bgm: true, sfx: true };
  try {
    return {
      bgm: window.localStorage.getItem(KEY_BGM) !== "0",
      sfx: window.localStorage.getItem(KEY_SFX) !== "0",
    };
  } catch {
    return { bgm: true, sfx: true };
  }
}

export function setBgmEnabled(v: boolean): void {
  try {
    window.localStorage.setItem(KEY_BGM, v ? "1" : "0");
  } catch {
    /* 무시 */
  }
  applyBgmEnabled(v);
}

export function setSfxEnabled(v: boolean): void {
  try {
    window.localStorage.setItem(KEY_SFX, v ? "1" : "0");
  } catch {
    /* 무시 */
  }
  setSfxMuted(!v);
}

// 앱 시작 시 1회 — 저장된 설정을 sfx/bgm 모듈에 적용
export function applySoundSettings(): SoundSettings {
  const s = loadSoundSettings();
  setSfxMuted(!s.sfx);
  applyBgmEnabled(s.bgm);
  return s;
}

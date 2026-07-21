export type SoundName = "dice" | "pencil" | "yathze";

const urls: Record<SoundName, string> = {
  dice: "/sounds/dice.mp3",
  pencil: "/sounds/pencil.mp3",
  yathze: "/sounds/yathze.mp3",
};

const cache = new Map<SoundName, HTMLAudioElement>();

/** Relative volumes (1 = full). Dice is quieter so rolls don’t dominate. */
const volumes: Record<SoundName, number> = {
  dice: 0.5,
  pencil: 1,
  yathze: 1,
};

function getAudio(name: SoundName): HTMLAudioElement {
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(urls[name]);
    audio.preload = "auto";
    audio.volume = volumes[name];
    cache.set(name, audio);
  }
  return audio;
}

/** Play a short SFX; overlaps safely by cloning when already playing. */
export function playSound(name: SoundName): void {
  try {
    const base = getAudio(name);
    const audio =
      base.paused || base.ended ? base : (base.cloneNode(true) as HTMLAudioElement);
    audio.volume = volumes[name];
    audio.currentTime = 0;
    void audio.play().catch(() => {
      /* autoplay blocked until a user gesture — ignore */
    });
  } catch {
    /* ignore missing/unsupported audio */
  }
}

export function isYahtzeeDice(dice: number[]): boolean {
  return dice.length === 5 && dice.every((d) => d === dice[0]);
}

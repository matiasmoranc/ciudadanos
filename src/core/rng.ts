/** Un paso de mulberry32. Devuelve el estado nuevo y un valor en [0, 1). */
export function stepRng(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [next, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

export function makeRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    const [next, value] = stepRng(state);
    state = next;
    return value;
  };
}

export function makeNoise(seed: number): (x: number, y: number) => number {
  const rng = makeRng(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = rng();
  const at = (x: number, y: number) => table[(x & 255) + (y & 255) * size];
  const fade = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
  return (x, y) => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let total = 0;
    for (let i = 0; i < 4; i++) {
      sum += value(x * freq, y * freq) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / total;
  };
}

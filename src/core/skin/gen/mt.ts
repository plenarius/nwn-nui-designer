/**
 * Python's random.Random: the Mersenne Twister MT19937 seeded as CPython seeds it from an int (init_by_array over the
 * seed's 32-bit words), and random() as CPython makes a double from two outputs. The open skin's value noise was
 * drawn with it (the Python generator, tools/open-skin/draw.py at e38d1ca), so the same seed gives the same noise here, bit for bit.
 *
 * Written from the published MT19937 reference (Matsumoto and Nishimura, 2002) and CPython's documented seeding.
 */

const N = 624;
const M = 397;

export class PyRandom {
  private readonly mt = new Uint32Array(N);
  private mti = N + 1;

  constructor(seed: number) {
    // CPython: abs(seed) split into 32-bit words, least significant first; 0 gives [0].
    let s = Math.abs(Math.trunc(seed));
    const key: number[] = [];
    while (s > 0) {
      key.push(s % 0x100000000);
      s = Math.floor(s / 0x100000000);
    }
    if (!key.length) key.push(0);
    this.initByArray(key);
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      // 1812433253 * prev + i, mod 2^32, without losing bits to doubles.
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
  }

  private initByArray(key: number[]): void {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = ((mt[i]! ^ Math.imul(prev, 1664525)) + key[j]! + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = ((mt[i]! ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  /** The next 32-bit output. */
  genrand(): number {
    const mt = this.mt;
    if (this.mti >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = mt[kk + M]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = mt[kk + (M - N)]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      const y = (mt[N - 1]! & 0x80000000) | (mt[0]! & 0x7fffffff);
      mt[N - 1] = mt[M - 1]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      this.mti = 0;
    }
    let y = mt[this.mti++]!;
    y ^= y >>> 11;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** random.random(): a double in [0, 1) with 53 random bits. */
  random(): number {
    const a = this.genrand() >>> 5;
    const b = this.genrand() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }
}

/**
 * color.ts — `Color3` and `Color4`: the subset of Babylon's classes of those
 * names that the tree calls, under the same names and signatures.
 * Owns: the two classes. Owns NO state, NO tunable, and imports NOTHING.
 *
 * Every body is Babylon 9.28's (`Maths/math.color.pure.js`), operation for
 * operation, for the reason `vector.ts`'s header gives: the oracles compare
 * bits. Both of Babylon's colour classes keep PLAIN `r`/`g`/`b`/`a` fields, as
 * these do, so — unlike a vector — a colour from here is safe to hand to a
 * Babylon method at RUN time; the types still refuse it, because these lack
 * most of Babylon's members, and `src/math/babylon.ts` is the crossing.
 *
 * ## Licence
 *
 * Copied from Babylon.js 9.28, licensed under the Apache License, Version 2.0
 * (`node_modules/@babylonjs/core/license.md`;
 * https://www.apache.org/licenses/LICENSE-2.0). "Babylon.js — Copyright 2023
 * The Babylon.js team" (its NOTICE). Changes from the original: the subset
 * trimmed to what this tree calls.
 */

/** Babylon's `ToHex`: two upper-case hex digits. */
function toHex(i: number): string {
  const str = i.toString(16);
  if (i <= 15) {
    return ("0" + str).toUpperCase();
  }
  return str.toUpperCase();
}

/** Anything with three colour channels — a Babylon colour included. */
export interface Color3Like {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export class Color3 {
  r: number;
  g: number;
  b: number;

  constructor(r = 0, g = 0, b = 0) {
    this.r = r;
    this.g = g;
    this.b = b;
  }

  toColor4(alpha = 1): Color4 {
    return new Color4(this.r, this.g, this.b, alpha);
  }

  multiply(otherColor: Color3Like): Color3 {
    return new Color3(this.r * otherColor.r, this.g * otherColor.g, this.b * otherColor.b);
  }

  multiplyToRef<T extends Color3>(otherColor: Color3Like, result: T): T {
    result.r = this.r * otherColor.r;
    result.g = this.g * otherColor.g;
    result.b = this.b * otherColor.b;
    return result;
  }

  equals(otherColor: Color3Like): boolean {
    return !!otherColor && this.r === otherColor.r && this.g === otherColor.g && this.b === otherColor.b;
  }

  scale(scale: number): Color3 {
    return new Color3(this.r * scale, this.g * scale, this.b * scale);
  }

  scaleInPlace(scale: number): this {
    this.r *= scale;
    this.g *= scale;
    this.b *= scale;
    return this;
  }

  addInPlace(otherColor: Color3Like): this {
    this.r += otherColor.r;
    this.g += otherColor.g;
    this.b += otherColor.b;
    return this;
  }

  addToRef<T extends Color3>(otherColor: Color3Like, result: T): T {
    result.r = this.r + otherColor.r;
    result.g = this.g + otherColor.g;
    result.b = this.b + otherColor.b;
    return result;
  }

  clone(): Color3 {
    return new Color3(this.r, this.g, this.b);
  }

  copyFrom(source: Color3Like): this {
    this.r = source.r;
    this.g = source.g;
    this.b = source.b;
    return this;
  }

  copyFromFloats(r: number, g: number, b: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }

  set(r: number, g: number, b: number): this {
    return this.copyFromFloats(r, g, b);
  }

  toHexString(): string {
    const intR = Math.round(this.r * 255);
    const intG = Math.round(this.g * 255);
    const intB = Math.round(this.b * 255);
    return "#" + toHex(intR) + toHex(intG) + toHex(intB);
  }

  fromHexString(hex: string): this {
    if (hex.substring(0, 1) !== "#" || hex.length !== 7) {
      return this;
    }
    this.r = parseInt(hex.substring(1, 3), 16) / 255;
    this.g = parseInt(hex.substring(3, 5), 16) / 255;
    this.b = parseInt(hex.substring(5, 7), 16) / 255;
    return this;
  }

  static FromHexString(hex: string): Color3 {
    return new Color3(0, 0, 0).fromHexString(hex);
  }

  static Lerp(start: Color3Like, end: Color3Like, amount: number): Color3 {
    const result = new Color3(0.0, 0.0, 0.0);
    Color3.LerpToRef(start, end, amount, result);
    return result;
  }

  static LerpToRef(left: Color3Like, right: Color3Like, amount: number, result: Color3): void {
    result.r = left.r + (right.r - left.r) * amount;
    result.g = left.g + (right.g - left.g) * amount;
    result.b = left.b + (right.b - left.b) * amount;
  }

  static Black(): Color3 {
    return new Color3(0, 0, 0);
  }

  static White(): Color3 {
    return new Color3(1, 1, 1);
  }
}

export class Color4 {
  r: number;
  g: number;
  b: number;
  a: number;

  constructor(r = 0, g = 0, b = 0, a = 1) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }

  copyFromFloats(r: number, g: number, b: number, a: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
    return this;
  }

  set(r: number, g: number, b: number, a: number): this {
    return this.copyFromFloats(r, g, b, a);
  }

  fromHexString(hex: string): this {
    if (hex.substring(0, 1) !== "#" || (hex.length !== 9 && hex.length !== 7)) {
      return this;
    }
    this.r = parseInt(hex.substring(1, 3), 16) / 255;
    this.g = parseInt(hex.substring(3, 5), 16) / 255;
    this.b = parseInt(hex.substring(5, 7), 16) / 255;
    if (hex.length === 9) {
      this.a = parseInt(hex.substring(7, 9), 16) / 255;
    }
    return this;
  }

  static FromHexString(hex: string): Color4 {
    if (hex.substring(0, 1) !== "#" || (hex.length !== 9 && hex.length !== 7)) {
      return new Color4(0.0, 0.0, 0.0, 0.0);
    }
    return new Color4(0.0, 0.0, 0.0, 1.0).fromHexString(hex);
  }
}

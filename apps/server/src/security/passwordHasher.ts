import argon2 from "argon2";

export interface PasswordHasherOptions {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly pepper: string;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

const ARGON2_TYPE = argon2.argon2id;

export class Argon2PasswordHasher implements PasswordHasher {
  private readonly options: PasswordHasherOptions;

  constructor(options: PasswordHasherOptions) {
    this.options = options;
  }

  async hash(password: string): Promise<string> {
    return argon2.hash(this.withPepper(password), {
      type: ARGON2_TYPE,
      memoryCost: this.options.memoryCost,
      timeCost: this.options.timeCost,
      parallelism: this.options.parallelism
    });
  }

  async verify(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, this.withPepper(password));
    } catch (_error) {
      return false;
    }
  }

  private withPepper(password: string): string {
    return `${password}${this.options.pepper}`;
  }
}

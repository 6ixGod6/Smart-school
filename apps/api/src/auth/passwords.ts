import bcrypt from "bcrypt";

let dummyHashPromise: Promise<string> | null = null;

function dummyHash(rounds: number): Promise<string> {
  dummyHashPromise ??= bcrypt.hash("not-a-real-secret", rounds);
  return dummyHashPromise;
}

export async function hashSecret(plain: string, rounds: number): Promise<string> {
  return bcrypt.hash(plain, rounds);
}

export async function verifySecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Run a bcrypt compare even when the account does not exist, so timing does not leak that fact. */
export async function dummyVerify(plain: string, rounds: number): Promise<void> {
  await bcrypt.compare(plain, await dummyHash(rounds));
}

export function isSixDigitPin(value: string): boolean {
  return /^\d{6}$/.test(value);
}

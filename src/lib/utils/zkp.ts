// --- Helper Functions ---

/**
 * Converts a Uint8Array (like a hash output) to a BigInt.
 * @param bytes - The byte array to convert.
 * @returns The resulting BigInt.
 */
function bytesToBigInt(bytes: Uint8Array): bigint {
  // More efficient than hex string conversion
  return bytes.reduce((acc: bigint, byte: number) => (acc << 8n) + BigInt(byte), 0n);
}

/**
 * Generates a cryptographically secure random BigInt in the range [min, max].
 * @param min - The minimum value (inclusive).
 * @param max - The maximum value (inclusive).
 * @returns A secure random BigInt.
 */
function getSecureRandomBigInt(min: bigint, max: bigint): bigint {
  const range = max - min + 1n;
  if (range <= 0n) {
    throw new Error("max must be greater than or equal to min");
  }

  // Determine number of bytes needed
  const bitLength = range.toString(2).length;
  const byteLength = Math.ceil(bitLength / 8) || 1;

  let randomBigInt: bigint;
  do {
    // Generate random bytes
    const randomBytes = new Uint8Array(byteLength);
    crypto.getRandomValues(randomBytes);

    // Convert bytes to BigInt
    randomBigInt = bytesToBigInt(randomBytes);

    // Ensure the number is within the desired range.
    // This loop prevents modulo bias.
  } while (randomBigInt >= range);

  return randomBigInt + min;
}

/**
 * Key Derivation Function (KDF) to derive the private key 'x' from a passphrase.
 * Uses SHA-256 and maps the hash to the range [1, q-1].
 * @param passphrase - The user's passphrase.
 * @param q - The order of the cryptographic group.
 * @returns The derived private key 'x'.
 */
async function KDF(passphrase: string, q: bigint): Promise<bigint> {
  const encoder = new TextEncoder();
  const data = encoder.encode(passphrase);

  // Hash the passphrase using SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert the hash to a BigInt
  const hashBigInt = bytesToBigInt(new Uint8Array(hashBuffer));

  // Map the hash to the valid key range [1, q-1]
  // (hash % (q-1)) + 1
  const x = (hashBigInt % (q - 1n)) + 1n;

  return x;
}

// --- Public Parameters ---

/**
 * Returns the public cryptographic parameters (g, p, q).
 * 'p' is a large prime.
 * 'q' is a large prime that divides (p-1).
 * 'g' is a generator of a subgroup of order 'q' modulo 'p'.
 */
export function getPublicParameters(): { p: bigint, q: bigint, g: bigint } {
  // Group 14 from RFC-3526
  // q = 2048-bit prime
  const q = 0x7FFFFFFFFFFFFFFFE487ED5110B4611A62633145C06E0E68948127044533E63A0105DF531D89CD9128A5043CC71A026EF7CA8CD9E69D218D98158536F92F8A1BA7F09AB6B6A8E122F242DABB312F3F637A262174D31BF6B585FFAE5B7A035BF6F71C35FDAD44CFD2D74F9208BE258FF324943328F6722D9EE1003E5C50B1DF82CC6D241B0E2AE9CD348B1FD47E9267AFC1B2AE91EE51D6CB0E3179AB1042A95DCF6A9483B84B4B36B3861AA7255E4C0278BA3604650C10BE19482F23171B671DF1CF3B960C074301CD93C1D17603D147DAE2AEF837A62964EF15E5FB4AAC0B8C1CCAA4BE754AB5728AE9130C4C7D02880AB9472D455655347FFFFFFFFFFFFFFFn;
  // p = 2q + 1
  const p = 2n*q + 1n
  // g = 2
  const g = 2n;

  return { p, q, g };
}

// --- Core Schnorr Functions ---

/**
 * Implements 4.4.1: Generates a new public key X from a passphrase.
 * This corresponds to the "Passphrase Replacement" or registration step.
 * @param new_pw - The user's new passphrase.
 * @returns The new public key 'X'.
 */
export async function generatePublicKey(new_pw: string): Promise<bigint> {
  const { p, q, g } = getPublicParameters();

  // 1. Derive new x = KDF(new_pw)
  const x = await KDF(new_pw, q);

  // 2. X = g^x mod p
  // Native BigInt does not have modPow. Use repeated squaring:
  function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    if (modulus === 1n) return 0n;
    let result = 1n;
    base = base % modulus;
    while (exponent > 0n) {
      if (exponent % 2n === 1n) result = (result * base) % modulus;
      exponent = exponent >> 1n;
      base = (base * base) % modulus;
    }
    return result;
  }

  const X = modPow(g, x, p);

  // 3. The application should POST X to the server.
  return X;
}

/**
 * Implements 4.4.2 (Login) - Client Step 1.
 * Derives the private key 'x', chooses a random 'v', and computes
 * the commitment 'V'.
 * @param pw - The user's passphrase for login.
 * @returns An object containing 'x' (private key), 'v' (secret nonce), and 'V' (commitment to be sent to the server).
 */
export async function clientLoginStep1(pw: string): Promise<{ x: bigint, v: bigint, V: bigint }> {
  const { p, q, g } = getPublicParameters();

  // 1. [Client] Derive x = KDF(pw)
  const x = await KDF(pw, q);

  // 2. [Client] Choose random v from [1, q-1]
  const v = getSecureRandomBigInt(1n, q - 1n);

  // 3. [Client] Compute commitment V = g^v mod p
  function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    if (modulus === 1n) return 0n;
    let result = 1n;
    base = base % modulus;
    while (exponent > 0n) {
      if (exponent % 2n === 1n) result = (result * base) % modulus;
      exponent = exponent >> 1n;
      base = (base * base) % modulus;
    }
    return result;
  }
  const V = modPow(g, v, p);

  // The client must now POST V to the server and store x and v for the next step.
  return { x, v, V };
}

/**
 * Implements 4.4.2 (Login) - Client Step 2.
 * Computes the response 'b' after receiving the challenge 'c' from the server.
 * @param v - The secret nonce from clientLoginStep1.
 * @param c - The random challenge received from the server.
 * @param x - The private key from clientLoginStep1.
 * @returns The response 'b' to be sent to the server.
 */
export function clientLoginStep2(
  v: bigint,
  c: bigint | string | number,
  x: bigint
): bigint {
  const { q } = getPublicParameters();

  // 6. [Client] Compute b = (v + c*x) mod q

  // Ensure c is a BigInt, as it might come from a JSON API as string/number
  const cBigInt = BigInt(c);

  // (a + b) mod n = ((a % n) + (b % n)) % n
  // (v + c*x) mod q
  const b = (v + cBigInt * x) % q;

  // The client must now POST b to the server.
  // Note: We need to handle negative results from modular arithmetic,
  // but since v, c, and x are all positive, (v + c*x) will be positive.
  // If b is 0, it's valid.
  return b;
}

/**
 * Implements 4.4.2 (Login) - Server Step 8.
 * This function should be used on the SERVER side to verify the client's response.
 * @param V - The commitment 'V' received from the client in step 1.
 * @param X - The user's public key 'X' stored on the server.
 * @param c - The challenge 'c' the server sent to the client.
 * @param b - The response 'b' received from the client in step 2.
 * @returns True if authentication is successful, False otherwise.
 */
export function serverVerify(
  V: bigint | string | number,
  X: bigint | string | number,
  c: bigint | string | number,
  b: bigint | string | number
): boolean {
  const { p, g } = getPublicParameters();

  // 8. [Server] Verify whether g^b == (V*X^c) mod p

  // Ensure all inputs are BigInts
  const bBigInt = BigInt(b);
  const vBigInt = BigInt(V);
  const xBigInt = BigInt(X);
  const cBigInt = BigInt(c);

  // Left side of the equation: g^b mod p
  function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    if (modulus === 1n) return 0n;
    let result = 1n;
    base = base % modulus;
    while (exponent > 0n) {
      if (exponent % 2n === 1n) result = (result * base) % modulus;
      exponent = exponent >> 1n;
      base = (base * base) % modulus;
    }
    return result;
  }
  const left = modPow(g, bBigInt, p);

  // Right side of the equation: (V * X^c) mod p
  const right = (vBigInt * modPow(xBigInt, cBigInt, p)) % p;

  // 9. Return verification status
  return left === right;
}
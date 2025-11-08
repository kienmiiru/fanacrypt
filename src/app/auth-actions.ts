"use server";

import { db, loginParameter } from "@/lib";
import { eq } from "drizzle-orm";
import { serverVerify, getPublicParameters } from "@/lib/utils/zkp";
import { randomUUID } from "crypto";

// In-memory store for login challenges during the login flow
// Stores: { V: commitment, c: challenge, expiresAt: timestamp }
// In production, you might want to use Redis or a database table with TTL
const loginChallenges = new Map<string, { V: bigint; c: bigint; expiresAt: number }>();

// Challenge expiration time: 5 minutes
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000;

// Session expiration time: 24 hours
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

// In-memory session store (in production, use Redis or database)
const sessions = new Map<string, { expiresAt: number }>();

/**
 * Converts a Uint8Array to a BigInt (helper function).
 */
function bytesToBigInt(bytes: Uint8Array): bigint {
  return bytes.reduce((acc: bigint, byte: number) => (acc << 8n) + BigInt(byte), 0n);
}

/**
 * Generates a cryptographically secure random BigInt in the range [min, max].
 */
function getSecureRandomBigInt(min: bigint, max: bigint): bigint {
  const range = max - min + 1n;
  if (range <= 0n) {
    throw new Error("max must be greater than or equal to min");
  }

  const bitLength = range.toString(2).length;
  const byteLength = Math.ceil(bitLength / 8) || 1;

  let randomBigInt: bigint;
  do {
    const randomBytes = new Uint8Array(byteLength);
    crypto.getRandomValues(randomBytes);
    randomBigInt = bytesToBigInt(randomBytes);
  } while (randomBigInt >= range);

  return randomBigInt + min;
}

/**
 * Clean up expired challenges and sessions
 */
function cleanupExpiredChallenges() {
  const now = Date.now();
  for (const [sessionId, data] of loginChallenges.entries()) {
    if (now > data.expiresAt) {
      loginChallenges.delete(sessionId);
    }
  }
  for (const [token, data] of sessions.entries()) {
    if (now > data.expiresAt) {
      sessions.delete(token);
    }
  }
}

/**
 * Registration: Store the public key X for the single user.
 * This should be called when the user first sets up their account.
 * Registration is only allowed if no public key exists.
 * @param publicKeyX - The public key X (as string, since BigInt can't be serialized)
 * @returns Success status
 */
export async function register(publicKeyX: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if a public key already exists
    const existing = await db.select().from(loginParameter).where(eq(loginParameter.id, 1)).limit(1);
    
    if (existing.length > 0) {
      // Registration not allowed if public key already exists
      return { success: false, error: "User already registered. Please login to change your passphrase." };
    }

    // Insert new public key
    await db.insert(loginParameter).values({
      id: 1,
      publicKey: publicKeyX,
    });

    return { success: true };
  } catch (error) {
    console.error("Registration error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Registration failed" };
  }
}

/**
 * Login Step 1: Receive commitment V from client, generate and return challenge c.
 * @param V - The commitment V from the client (as string)
 * @returns The challenge c (as string) and a session ID for step 2
 */
export async function loginStep1(V: string): Promise<{ success: boolean; challenge?: string; sessionId?: string; error?: string }> {
  try {
    // Check if public key exists
    const existing = await db.select().from(loginParameter).where(eq(loginParameter.id, 1)).limit(1);
    
    if (existing.length === 0) {
      return { success: false, error: "No public key registered. Please register first." };
    }

    const { q } = getPublicParameters();
    
    // Generate random challenge c from [1, q-1]
    const c = getSecureRandomBigInt(1n, q - 1n);
    
    // Store V and c with expiration
    const sessionId = randomUUID();
    loginChallenges.set(sessionId, {
      V: BigInt(V),
      c: c,
      expiresAt: Date.now() + CHALLENGE_EXPIRY_MS,
    });

    // Clean up expired challenges
    cleanupExpiredChallenges();

    return {
      success: true,
      challenge: c.toString(),
      sessionId,
    };
  } catch (error) {
    console.error("Login step 1 error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Login step 1 failed" };
  }
}

/**
 * Login Step 2: Receive response b from client, verify the proof, and create session.
 * @param sessionId - The session ID from step 1
 * @param b - The response b from the client (as string)
 * @returns Success status and session token if verification succeeds
 */
export async function loginStep2(sessionId: string, b: string): Promise<{ success: boolean; sessionToken?: string; error?: string }> {
  try {
    // Retrieve stored V and c
    const challengeData = loginChallenges.get(sessionId);
    
    if (!challengeData) {
      return { success: false, error: "Invalid or expired session. Please try logging in again." };
    }

    // Check expiration
    if (Date.now() > challengeData.expiresAt) {
      loginChallenges.delete(sessionId);
      return { success: false, error: "Challenge expired. Please try logging in again." };
    }

    // Get public key from database
    const existing = await db.select().from(loginParameter).where(eq(loginParameter.id, 1)).limit(1);
    
    if (existing.length === 0) {
      loginChallenges.delete(sessionId);
      return { success: false, error: "No public key registered." };
    }

    const X = existing[0].publicKey;
    const V = challengeData.V;
    const c = challengeData.c;

    // Verify the proof using serverVerify
    const isValid = serverVerify(V, X, c, b);

    // Remove challenge data (one-time use)
    loginChallenges.delete(sessionId);

    if (!isValid) {
      return { success: false, error: "Authentication failed. Invalid proof." };
    }

    // Create session token
    const sessionToken = randomUUID();
    sessions.set(sessionToken, {
      expiresAt: Date.now() + SESSION_EXPIRY_MS,
    });

    cleanupExpiredChallenges();

    return {
      success: true,
      sessionToken,
    };
  } catch (error) {
    console.error("Login step 2 error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Login step 2 failed" };
  }
}

/**
 * Verify if a session token is valid.
 * @param sessionToken - The session token to verify
 * @returns True if the session is valid, false otherwise
 */
export async function verifySession(sessionToken: string | null | undefined): Promise<boolean> {
  if (!sessionToken) {
    return false;
  }

  cleanupExpiredChallenges();
  
  const session = sessions.get(sessionToken);
  if (!session) {
    return false;
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionToken);
    return false;
  }

  return true;
}

/**
 * Logout: Invalidate a session token.
 * @param sessionToken - The session token to invalidate
 */
export async function logout(sessionToken: string): Promise<void> {
  sessions.delete(sessionToken);
}

/**
 * Change passphrase: Update the public key for the authenticated user.
 * Requires a valid session token to prevent unauthorized changes.
 * @param sessionToken - The session token to verify authentication
 * @param newPublicKeyX - The new public key X (as string)
 * @returns Success status
 */
export async function changePassphrase(
  sessionToken: string | null | undefined,
  newPublicKeyX: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify session token
    if (!sessionToken) {
      return { success: false, error: "Authentication required" };
    }

    const isValid = await verifySession(sessionToken);
    if (!isValid) {
      return { success: false, error: "Invalid or expired session. Please login again." };
    }

    // Check if a public key exists
    const existing = await db.select().from(loginParameter).where(eq(loginParameter.id, 1)).limit(1);
    
    if (existing.length === 0) {
      return { success: false, error: "No public key found. Please register first." };
    }

    // Update the public key
    await db.update(loginParameter)
      .set({ publicKey: newPublicKeyX })
      .where(eq(loginParameter.id, 1));

    // Invalidate all sessions to force re-login with new passphrase
    sessions.clear();

    return { success: true };
  } catch (error) {
    console.error("Change passphrase error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to change passphrase" };
  }
}

/**
 * Check if a public key is registered.
 * @returns True if a public key exists, false otherwise
 */
export async function isRegistered(): Promise<boolean> {
  try {
    const existing = await db.select().from(loginParameter).where(eq(loginParameter.id, 1)).limit(1);
    return existing.length > 0;
  } catch (error) {
    console.error("Error checking registration:", error);
    return false;
  }
}

export async function generateAesGcmKey(): Promise<{ key: CryptoKey; rawKey: Uint8Array; base64Key: string }> {
    const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    const base64Key = toBase64(raw);
    return { key, rawKey: raw, base64Key };
}

export function randomIv(bytes: number = 12): Uint8Array {
    const iv = new Uint8Array(bytes);
    crypto.getRandomValues(iv);
    return iv;
}

export async function aesGcmEncrypt(key: CryptoKey, iv: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return new Uint8Array(ct);
}

export async function aesGcmDecrypt(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new Uint8Array(pt);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(digest);
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((n, p) => n + p.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.byteLength;
    }
    return out;
}

export function toBase64(bytes: Uint8Array): string {
    if (typeof window === "undefined") {
        // Node
        return Buffer.from(bytes).toString("base64");
    }
    return btoa(String.fromCharCode(...bytes));
}

export function fromBase64(b64: string): Uint8Array {
    if (typeof window === "undefined") {
        return new Uint8Array(Buffer.from(b64, "base64"));
    }
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}


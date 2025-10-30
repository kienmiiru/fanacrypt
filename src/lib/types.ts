export type UtServerNumber = 0 | 1 | 2 | 3 | 4;
export type UploadPart = {
    name: string;
    url: string;
    key: string;
    hash: string; // base64(SHA-256(IV||C)) for integrity verification
}
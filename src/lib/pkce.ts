export function generateRandomString(length: number): string {
	const array = new Uint8Array(length);
	crypto.getRandomValues(array);
	return Array.from(array)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function sha256(plain: string): Promise<ArrayBuffer> {
	const encoder = new TextEncoder();
	const data = encoder.encode(plain);
	return await crypto.subtle.digest("SHA-256", data);
}

export function base64UrlEncode(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let str = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		str += String.fromCharCode(bytes[i]);
	}
	return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createCodeChallenge(verifier: string): Promise<string> {
	const hashed = await sha256(verifier);
	return base64UrlEncode(hashed);
}



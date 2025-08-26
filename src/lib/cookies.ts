import { cookies } from "next/headers";

export type CookieOptions = {
	maxAge?: number;
	path?: string;
	secure?: boolean;
	sameSite?: "lax" | "strict" | "none";
	httpOnly?: boolean;
};

export async function setCookie(name: string, value: string, options?: CookieOptions) {
	const cookieStore = await cookies();
	cookieStore.set(name, value, {
		path: options?.path ?? "/",
		httpOnly: options?.httpOnly ?? true,
		sameSite: options?.sameSite ?? "lax",
		secure: options?.secure ?? process.env.NODE_ENV === "production",
		maxAge: options?.maxAge,
	});
}

export async function getCookie(name: string): Promise<string | undefined> {
	const cookieStore = await cookies();
	return cookieStore.get(name)?.value;
}

export async function deleteCookie(name: string) {
	const cookieStore = await cookies();
	cookieStore.delete(name);
}



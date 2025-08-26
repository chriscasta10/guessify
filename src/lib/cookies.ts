import { cookies } from "next/headers";

export type CookieOptions = {
	maxAge?: number;
	path?: string;
	secure?: boolean;
	sameSite?: "lax" | "strict" | "none";
	httpOnly?: boolean;
};

export function setCookie(name: string, value: string, options?: CookieOptions) {
	const cookieStore = cookies();
	cookieStore.set(name, value, {
		path: options?.path ?? "/",
		httpOnly: options?.httpOnly ?? true,
		sameSite: options?.sameSite ?? "lax",
		secure: options?.secure ?? process.env.NODE_ENV === "production",
		maxAge: options?.maxAge,
	});
}

export function getCookie(name: string): string | undefined {
	const cookieStore = cookies();
	return cookieStore.get(name)?.value;
}

export function deleteCookie(name: string) {
	cookies().delete(name);
}



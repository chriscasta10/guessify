"use client";

export function AuthButton() {
	const onLogin = () => {
		window.location.href = "/api/auth/login";
	};
	const onLogout = async () => {
		await fetch("/api/auth/logout", { method: "POST" });
		window.location.href = "/";
	};
	return (
		<div className="flex gap-2">
			<button onClick={onLogin} className="rounded bg-black text-white px-3 py-2">
				Login with Spotify
			</button>
			<button onClick={onLogout} className="rounded border px-3 py-2">
				Logout
			</button>
		</div>
	);
}



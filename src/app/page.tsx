import { AuthButton } from "@/components/AuthButton";
import { HelloUser } from "@/components/HelloUser";
import { GuessifyGame } from "@/components/PlayTestClip";

export default function Home() {
  return (
    <div className="font-sans min-h-screen p-8">
      <main className="flex flex-col gap-8 items-center">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">🎵 Guessify</h1>
          <p className="text-gray-600 text-lg">Test your music memory with your Spotify likes!</p>
        </div>

        {/* Auth and Game */}
        <div className="w-full max-w-4xl">
          <div className="flex flex-col gap-6 items-center">
            <AuthButton />
            <HelloUser />
            <GuessifyGame />
          </div>
        </div>
      </main>
    </div>
  );
}

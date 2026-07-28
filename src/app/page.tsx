export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <main className="text-center px-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          Antigravity Usage Dashboard
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mb-8 max-w-md mx-auto">
          Cloud-based dashboard for Antigravity coding agent quota/usage across
          all Google accounts. Sign in with Clerk to get started.
        </p>
        <div className="flex gap-4 justify-center">
          <a
            href="/sign-in"
            className="px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200 transition-colors"
          >
            Sign In
          </a>
          <a
            href="/sign-up"
            className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Sign Up
          </a>
        </div>
      </main>
    </div>
  );
}

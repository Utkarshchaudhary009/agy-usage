import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function Home() {
  const { userId } = await auth();

  // If logged in, this becomes the dashboard homepage
  if (userId) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold tracking-tight">
          Dashboard Overview
        </h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Quota</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Pending...</div>
              <CardDescription>Accounts not yet loaded</CardDescription>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // If not logged in, render the landing page
  return (
    <div className="min-h-[calc(100vh-140px)] flex items-center justify-center bg-background">
      <main className="text-center px-8">
        <h1 className="text-4xl font-bold text-foreground mb-4">
          Antigravity Usage Dashboard
        </h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-md mx-auto">
          Cloud-based dashboard for Antigravity coding agent quota/usage across
          all Google accounts. Sign in with Clerk to get started.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/sign-in"
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="px-6 py-3 border border-border rounded-lg text-foreground hover:bg-muted transition-colors"
          >
            Sign Up
          </Link>
        </div>
      </main>
    </div>
  );
}

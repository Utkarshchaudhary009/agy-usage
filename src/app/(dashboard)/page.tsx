import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
    <div className="flex min-h-screen items-center justify-center bg-background">
      <main className="text-center px-8">
        <h1 className="mb-4 text-4xl font-bold text-foreground">
          Antigravity Usage Dashboard
        </h1>
        <p className="mx-auto mb-8 max-w-md text-lg text-muted-foreground">
          Cloud-based dashboard for Antigravity coding agent quota/usage across
          all Google accounts. Sign in with Clerk to get started.
        </p>
        <div className="flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href="/sign-in">Sign In</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/sign-up">Sign Up</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}

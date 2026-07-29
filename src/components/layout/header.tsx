import { UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/theme-toggle"; // We'll need a theme toggle
import { MobileNav } from "./mobile-nav";

export function Header() {
  return (
    <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6 justify-between lg:justify-end">
      <div className="flex items-center lg:hidden">
        <MobileNav />
      </div>
      <div className="flex items-center gap-4">
        <ThemeToggle />
        <UserButton
          appearance={{
            elements: {
              avatarBox: "h-8 w-8",
            },
          }}
        />
      </div>
    </header>
  );
}

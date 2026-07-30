"use client";

import { Activity, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { isRouteActive, navigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0 lg:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle navigation menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex flex-col">
        {/* We need Title and Description for screen readers */}
        <div className="sr-only">
          <SheetTitle>Navigation Menu</SheetTitle>
          <SheetDescription>
            Access the different sections of the dashboard
          </SheetDescription>
        </div>
        <nav className="grid gap-2 text-lg font-medium">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-semibold mb-4"
            onClick={() => setOpen(false)}
          >
            <Activity className="h-6 w-6" />
            <span>Antigravity</span>
          </Link>
          {navigation.map((item) => {
            const isActive = isRouteActive(pathname, item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 hover:text-foreground",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground",
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

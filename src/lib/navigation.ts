import {
  LayoutDashboard,
  Users,
  Clock,
  Activity,
  Settings,
} from "lucide-react";

export const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Accounts", href: "/accounts", icon: Users },
  { name: "Wakeup", href: "/wakeup", icon: Clock },
  { name: "History", href: "/history", icon: Activity },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function isRouteActive(pathname: string, href: string) {
  if (pathname === href) {
    return true;
  }
  if (href !== "/" && pathname.startsWith(`${href}/`)) {
    return true;
  }
  return false;
}

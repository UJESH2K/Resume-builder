import { AppShell } from "@/components/AppShell";
import { DbProvider } from "@/components/DbProvider";
import { displayName, requireUser } from "@/lib/auth";

/**
 * The signed-in app: sidebar, library provider, everything that needs an account.
 * `requireUser` is the real gate — proxy.ts only pre-filters.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <DbProvider>
      <AppShell userName={displayName(user)} userEmail={user.email ?? ""}>
        {children}
      </AppShell>
    </DbProvider>
  );
}

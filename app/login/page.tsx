import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { signIn } from "@/app/auth/actions";
import { demoEnabled, demoUsername } from "@/lib/demo";

export const metadata: Metadata = { title: "Log in · Resume Studio" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Read on the server so the demo account's real address never reaches the browser — only
  // the username students are told to type.
  const demo = demoEnabled()
    ? { username: demoUsername(), password: process.env.DEMO_PASSWORD?.trim() || "" }
    : undefined;
  return <AuthForm mode="login" action={signIn} next={next} demo={demo} />;
}

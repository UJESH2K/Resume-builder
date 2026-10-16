import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { signIn } from "@/app/auth/actions";

export const metadata: Metadata = { title: "Log in · Resume Studio" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="login" action={signIn} next={next} />;
}

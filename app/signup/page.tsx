import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { signUp } from "@/app/auth/actions";

export const metadata: Metadata = { title: "Sign up · Resume Studio" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="signup" action={signUp} next={next} />;
}

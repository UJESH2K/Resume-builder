import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Studio",
  description: "Build a LaTeX resume from your own library of achievements",
  icons: { icon: "/logo.png" },
};

// Set the theme before paint so there is no flash of the wrong one.
const THEME_BOOT = `try{var t=localStorage.getItem('resume-studio:theme');document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

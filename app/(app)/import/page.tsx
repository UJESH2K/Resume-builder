import type { Metadata } from "next";
import { Importer } from "@/components/Importer";

export const metadata: Metadata = { title: "Quick start · Resume Studio" };

export default function ImportPage() {
  return <Importer />;
}

import { Suspense } from "react";
import { Library } from "@/components/Library";

export default function LibraryPage() {
  return (
    <Suspense>
      <Library />
    </Suspense>
  );
}

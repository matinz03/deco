import { redirect } from "next/navigation";

// Root redirects to /inbox if authenticated, /login if not.
// Auth check is handled in middleware.ts
export default function RootPage() {
  redirect("/inbox");
}

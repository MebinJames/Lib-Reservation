import type { Metadata } from "next";

import AdminClient from "@/components/AdminClient";
import { adminEnabled } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Room admin — Reading Room",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  // Whether the area exists at all is decided on the server; the password
  // itself never reaches the browser.
  return <AdminClient enabled={adminEnabled()} />;
}

import Reserve from "@/components/Reserve";
import { loadLayout, loadPolicy } from "@/lib/room";
import { userClient } from "@/lib/supabase/server";

// The layout and policy live in the database, so this page is always dynamic.
export const dynamic = "force-dynamic";

export default async function Page() {
  // A visitor's client: it can read the room and the rules, and nothing else.
  const sb = await userClient();
  const [layout, policy] = await Promise.all([loadLayout(sb), loadPolicy(sb)]);
  return <Reserve layout={layout} policy={policy} />;
}

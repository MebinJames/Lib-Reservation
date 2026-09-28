import { redirect } from "next/navigation";

import RegisterForm from "@/components/RegisterForm";
import { currentProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const profile = await currentProfile();
  // There is nothing to register against until Google has said who this is.
  if (!profile) redirect("/");

  return (
    <RegisterForm
      email={profile.email}
      fullName={profile.fullName}
      rollNo={profile.rollNo}
      department={profile.department}
      year={profile.year}
      registered={profile.registered}
    />
  );
}

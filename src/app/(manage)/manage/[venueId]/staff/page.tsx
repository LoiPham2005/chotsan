import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ManageNav } from "@/components/manage/manage-nav";
import { StaffManager } from "@/components/manage/staff-manager";
import { requireVenueAccess } from "@/lib/auth";
import { VENUE_STAFF_GRANTABLE } from "@/lib/permissions";
import { memberService } from "@/services/member.service";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Nhân sự", robots: { index: false } };

export default async function StaffPage({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  const user = await requireVenueAccess(venueId, "member:manage");

  const [venue, members] = await Promise.all([
    venueService.forManage(venueId),
    memberService.listForVenue(venueId),
  ]);

  if (!venue) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href={`/manage/${venueId}`}
          className="text-sm font-medium text-muted hover:text-content"
        >
          ← {venue.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">Nhân sự</h1>
      </header>

      <div className="mt-4 border-b border-line pb-2">
        <ManageNav venueId={venueId} userId={user.id} active="staff" />
      </div>

      <div className="mt-6">
        <StaffManager
          venueId={venueId}
          grantable={[...VENUE_STAFF_GRANTABLE]}
          members={members.map((member) => ({
            id: member.id,
            role: member.role,
            name: member.user.profile?.fullName ?? member.user.email ?? "Chưa đặt tên",
            email: member.user.email,
            permissions: member.permissions,
          }))}
        />
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { ApprovalRow } from "@/components/admin/venue-approval-row";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Duyệt cơ sở", robots: { index: false } };

/**
 * Hàng chờ duyệt cơ sở mới.
 *
 * Cũ nhất lên trước: chủ sân nộp hồ sơ rồi chờ, và người chờ lâu nhất là người
 * sắp bỏ đi.
 */
export default async function VenueApprovalsPage() {
  await requirePermission("venue:approve", "/venue-approvals");
  const pending = await venueService.listPendingApproval();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-content sm:text-3xl">Duyệt cơ sở</h1>
      <p className="mt-1 text-sm text-muted">
        {pending.length === 0
          ? "Không có hồ sơ nào đang chờ."
          : `${pending.length} cơ sở đang chờ duyệt, cũ nhất lên trước.`}
      </p>

      {pending.length === 0 ? (
        <div className="mt-6 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center">
          <p className="text-lg font-medium text-content">Hàng chờ trống</p>
          <p className="mt-1 text-sm text-muted">Cơ sở mới do chủ sân nộp lên sẽ hiện ở đây.</p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {pending.map((venue) => (
            <ApprovalRow
              key={venue.id}
              venue={{
                id: venue.id,
                name: venue.name,
                description: venue.description,
                address: `${venue.address}, ${venue.ward}, ${venue.province}`,
                phone: venue.phone,
                sportName: venue.sport.name,
                sportKey: venue.sport.key,
                createdAt: venue.createdAt.toISOString(),
                courtCount: venue._count.courts,
                priceRuleCount: venue._count.priceRules,
                openDayCount: venue._count.hours,
                ownerName: venue.members[0]?.user.profile?.fullName ?? null,
                ownerEmail: venue.members[0]?.user.email ?? null,
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

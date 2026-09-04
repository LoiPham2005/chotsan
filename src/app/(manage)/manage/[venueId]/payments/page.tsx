import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalCard } from "@/components/manage/approval-card";
import { ManageNav } from "@/components/manage/manage-nav";
import { requireVenueAccess } from "@/lib/auth";
import { formatVnd } from "@/lib/slots";
import { courtService } from "@/services/court.service";
import { paymentService } from "@/services/payment.service";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Chờ duyệt tiền", robots: { index: false } };

/**
 * Hàng chờ đối chiếu chuyển khoản tay.
 *
 * Xếp theo lúc khách BÁO, cũ nhất lên trước: người chờ lâu nhất được xử lý
 * trước, và chỗ của họ cũng sắp hết hạn giữ.
 */
export default async function PaymentApprovalsPage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;
  const user = await requireVenueAccess(venueId, "payment:confirm");

  const [venue, pending, courts] = await Promise.all([
    venueService.forManage(venueId),
    paymentService.pendingApprovals(venueId),
    courtService.listForVenue(venueId),
  ]);

  if (!venue) notFound();

  const courtName = new Map(courts.map((court) => [court.id, court.name]));
  const total = pending.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href={`/manage/${venueId}`}
          className="text-sm font-medium text-muted hover:text-content"
        >
          ← {venue.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">
          Chờ duyệt tiền
        </h1>
      </header>

      <div className="mt-4 border-b border-line pb-2">
        <ManageNav venueId={venueId} userId={user.id} active="payments" />
      </div>

      {pending.length === 0 ? (
        <div className="mt-6 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center">
          <p className="text-lg font-medium text-content">Không có khoản nào đang chờ</p>
          <p className="mt-1 text-sm text-muted">
            Khi khách bấm &ldquo;Tôi đã chuyển khoản&rdquo;, khoản đó hiện ở đây.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-5 text-sm text-muted">
            <span className="font-semibold text-content">{pending.length} khoản</span> · tổng{" "}
            <span className="font-semibold text-content">{formatVnd(total)}</span>
          </p>

          <ul className="mt-3 space-y-3">
            {pending.map((item) => (
              <ApprovalCard
                key={item.id}
                venueId={venueId}
                item={{
                  paymentId: item.id,
                  amount: item.amount,
                  transferNote: item.transferNote,
                  // `Date` không đi qua ranh giới Server → Client được.
                  declaredAt: item.declaredAt?.toISOString() ?? null,
                  declaredNote: item.declaredNote,
                  proofImageUrl: item.proofImageUrl,
                  bookingCode: item.booking.code,
                  customerName: item.booking.customerName,
                  customerPhone: item.booking.customerPhone,
                  courtName: courtName.get(item.booking.courtId) ?? "—",
                  startAt: item.booking.startAt.toISOString(),
                  endAt: item.booking.endAt.toISOString(),
                }}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

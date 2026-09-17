import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalCard } from "@/components/manage/approval-card";
import { ManageNav } from "@/components/manage/manage-nav";
import { requireVenueAccess } from "@/lib/auth";
import { formatVnd } from "@/lib/slots";
import { paymentService } from "@/services/payment.service";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Chờ duyệt tiền", robots: { index: false } };

/**
 * Hàng chờ đối chiếu chuyển khoản tay.
 *
 * Xếp theo lúc khách BÁO, cũ nhất lên trước: người chờ lâu nhất được xử lý
 * trước.
 *
 * Mỗi mục là MỘT LẦN CHUYỂN KHOẢN — khách đặt ba sân một lần thì chuyển một
 * lần, nên ở đây cũng chỉ một mục với tổng tiền. Xem `pendingApprovals`.
 */
export default async function PaymentApprovalsPage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;
  const user = await requireVenueAccess(venueId, "payment:confirm");

  const [venue, pending] = await Promise.all([
    venueService.forManage(venueId),
    paymentService.pendingApprovals(venueId),
  ]);

  if (!venue) notFound();

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
            {pending.map((group) => (
              <ApprovalCard
                key={group.checkoutCode}
                venueId={venueId}
                item={{
                  checkoutCode: group.checkoutCode,
                  amount: group.amount,
                  transferNote: group.transferNote,
                  // `Date` không đi qua ranh giới Server → Client được.
                  declaredAt: group.declaredAt?.toISOString() ?? null,
                  declaredNote: group.declaredNote,
                  proofImageUrl: group.proofImageUrl,
                  customerName: group.customerName,
                  customerPhone: group.customerPhone,
                  items: group.items.map((line) => ({
                    paymentId: line.paymentId,
                    bookingCode: line.bookingCode,
                    courtName: line.courtName,
                    startAt: line.startAt.toISOString(),
                    endAt: line.endAt.toISOString(),
                    amount: line.amount,
                  })),
                }}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

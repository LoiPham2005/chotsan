import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceRow } from "@/components/admin/invoice-row";
import { requirePermission } from "@/lib/auth";
import { formatVnd } from "@/lib/slots";
import { invoiceService } from "@/services/invoice.service";

export const metadata: Metadata = { title: "Hoá đơn hoa hồng", robots: { index: false } };

const TABS = [
  { key: "OVERDUE", label: "Quá hạn" },
  { key: "DUE", label: "Đang chờ" },
  { key: "PAID", label: "Đã thu" },
  { key: "WAIVED", label: "Đã miễn" },
] as const;

type Status = (typeof TABS)[number]["key"];

/**
 * Đối soát hoa hồng của nền tảng.
 *
 * "Quá hạn" là tab MẶC ĐỊNH, không phải "đang chờ": tiền đặt sân đi thẳng vào
 * tài khoản của sân, nên khoản duy nhất cần người can thiệp là khoản đã trễ.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requirePermission("invoice:manage", "/invoices");

  const query = await searchParams;
  const status: Status = TABS.some((tab) => tab.key === query.status)
    ? (query.status as Status)
    : "OVERDUE";

  const invoices = await invoiceService.listByStatus(status);
  const total = invoices.reduce((sum, invoice) => sum + invoice.commissionAmount, 0);

  const dateVN = (date: Date) =>
    new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" }).format(
      date,
    );

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-content sm:text-3xl">
        Hoá đơn hoa hồng
      </h1>
      <p className="mt-1 text-sm text-muted">
        Tiền đặt sân đi thẳng vào tài khoản của sân. Đây là khoản chủ sân <strong>nợ</strong> nền
        tảng, thu theo tháng.
      </p>

      <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-line pb-2" aria-label="Lọc">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/invoices?status=${tab.key}`}
            aria-current={tab.key === status ? "page" : undefined}
            className={`whitespace-nowrap rounded-token-md px-3 py-2 text-sm font-semibold transition ${
              tab.key === status
                ? "bg-brand-tint text-brand-hover"
                : "text-muted hover:bg-elevated hover:text-content"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <p className="mt-4 text-sm text-muted">
        {invoices.length === 0 ? (
          "Không có hoá đơn nào."
        ) : (
          <>
            <span className="font-semibold text-content">{invoices.length} hoá đơn</span> · tổng{" "}
            <span className="font-semibold text-content">{formatVnd(total)}</span>
          </>
        )}
      </p>

      {invoices.length === 0 ? (
        <div className="mt-4 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center">
          <p className="text-lg font-medium text-content">Trống</p>
          <p className="mt-1 text-sm text-muted">
            Hoá đơn xuất tự động vào 02:00 ngày mùng 1 hằng tháng.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {invoices.map((invoice) => (
            <InvoiceRow
              key={invoice.id}
              invoice={{
                id: invoice.id,
                number: invoice.number,
                venueName: invoice.venue.name,
                venueArea: `${invoice.venue.ward}, ${invoice.venue.province}`,
                period: `${dateVN(invoice.periodStart)} – ${dateVN(invoice.periodEnd)}`,
                dueDate: dateVN(invoice.dueDate),
                overdueDays: invoice.overdueDays,
                bookingCount: invoice.bookingCount,
                grossRevenue: invoice.grossRevenue,
                // `Decimal` của Prisma không đi qua ranh giới Server → Client.
                commissionRate: Number(invoice.commissionRate),
                commissionAmount: invoice.commissionAmount,
                status: invoice.status,
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

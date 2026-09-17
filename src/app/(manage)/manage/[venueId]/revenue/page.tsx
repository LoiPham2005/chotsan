import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ManageNav } from "@/components/manage/manage-nav";
import { RevenueChart } from "@/components/manage/revenue-chart";
import { requireVenueAccess } from "@/lib/auth";
import { addDays, dateKey, fullDateLabel, parseDateKey } from "@/lib/date";
import { formatVnd } from "@/lib/slots";
import { courtService } from "@/services/court.service";
import { reportService } from "@/services/report.service";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Doanh thu", robots: { index: false } };

const RANGES = [
  { key: "7", label: "7 ngày" },
  { key: "30", label: "30 ngày" },
  { key: "90", label: "90 ngày" },
] as const;

/**
 * Doanh thu của một cơ sở.
 *
 * ---
 * "DOANH THU" LÀ TIỀN ĐÃ CHỐT, KHÔNG PHẢI TIỀN ĐÃ VỀ TÀI KHOẢN
 *
 * Chỉ tính lượt đã xác nhận trở lên. Nói rõ điều đó ngay trên màn: chủ sân sẽ
 * đối chiếu con số này với sao kê ngân hàng, và hai thứ lệch nhau vì lý do
 * chính đáng (chuyển khoản chưa về, hoàn tiền chưa xử lý).
 */
export default async function RevenuePage({
  params,
  searchParams,
}: {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const [{ venueId }, query] = await Promise.all([params, searchParams]);
  const user = await requireVenueAccess(venueId, "report:read");

  const days = RANGES.some((r) => r.key === query.range) ? Number(query.range) : 30;
  const today = parseDateKey(undefined);
  const from = addDays(today, -(days - 1));

  const [venue, summary, daily, courts] = await Promise.all([
    venueService.forManage(venueId),
    reportService.venueSummary(venueId, { from, to: today }),
    reportService.dailyRevenue(venueId, { from, to: today }),
    courtService.listForVenue(venueId),
  ]);

  if (!venue) notFound();

  const courtName = new Map(courts.map((court) => [court.id, court.name]));

  // SQL chỉ trả những ngày CÓ doanh thu. Vẽ thẳng thì 3 ngày lẻ trong 30 ngày
  // thành 3 cột đứng sát nhau, trông như 3 ngày liền — điền đủ mọi ngày của
  // khoảng, ngày trống là cột 0.
  const revenueByDate = new Map(daily.map((row) => [row.date, row]));
  const chartRows = Array.from({ length: days }, (_, index) => {
    const key = dateKey(addDays(from, index));
    return revenueByDate.get(key) ?? { date: key, bookings: 0, revenue: 0 };
  });
  const byCourt = [...summary.byCourt].sort((a, b) => b.revenue - a.revenue);
  const average = summary.bookingCount > 0 ? Math.round(summary.revenue / summary.bookingCount) : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href={`/manage/${venueId}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-content"
        >
          ← {venue.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">
          Doanh thu
        </h1>
      </header>

      <div className="mt-4 border-b border-line pb-2">
        <ManageNav venueId={venueId} userId={user.id} active="revenue" />
      </div>

      {/* Cùng kiểu "tab đang mở" với thanh quản lý sân (nền xanh nhạt) — không
          phải khối xanh đặc: màn này không có hành động chính nào để tranh chỗ. */}
      <nav className="mt-5 flex flex-wrap gap-2" aria-label="Khoảng thời gian">
        {RANGES.map((range) => (
          <Link
            key={range.key}
            href={`/manage/${venueId}/revenue?range=${range.key}`}
            aria-current={Number(range.key) === days ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-token-control border-[1.5px] px-3 text-sm font-semibold transition-colors ${
              Number(range.key) === days
                ? "border-brand-line bg-brand-tint text-brand-text"
                : "border-line-strong bg-surface text-content hover:bg-elevated"
            }`}
          >
            {range.label}
          </Link>
        ))}
      </nav>

      <p className="mt-3 text-sm text-muted">
        {fullDateLabel(from)} → {fullDateLabel(today)} · chỉ tính lượt đã xác nhận trở lên
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Doanh thu" value={formatVnd(summary.revenue)} big />
        <Stat label="Số lượt đã chốt" value={String(summary.bookingCount)} />
        <Stat label="Trung bình mỗi lượt" value={formatVnd(average)} />
        <Stat
          label={`Hoa hồng nợ (${summary.commissionRate}%)`}
          value={formatVnd(summary.commissionOwed)}
          hint="thu ở hoá đơn cuối tháng"
        />
      </div>

      {(summary.holdingCount > 0 || summary.cancelledCount > 0) && (
        <p className="mt-3 text-sm text-muted">
          Ngoài ra: <strong className="text-content">{summary.holdingCount}</strong> lượt đang chờ
          thanh toán · <strong className="text-content">{summary.cancelledCount}</strong> lượt huỷ
          hoặc không tới.
        </p>
      )}

      <div className="mt-5">
        <RevenueChart rows={daily.length > 0 ? chartRows : []} />
      </div>

      {byCourt.length > 0 && (
        <section className="mt-8" aria-labelledby="by-court-heading">
          <h2 id="by-court-heading" className="text-lg font-bold text-content">
            Theo sân con
          </h2>

          <ul className="mt-3 space-y-2">
            {byCourt.map((row) => {
              const share = summary.revenue > 0 ? (row.revenue / summary.revenue) * 100 : 0;

              return (
                <li
                  key={row.courtId}
                  className="rounded-token-lg border border-line bg-surface p-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-content">
                      {courtName.get(row.courtId) ?? "—"}
                    </span>
                    <span className="text-sm text-muted">
                      {row.bookings} lượt ·{" "}
                      <strong className="text-content">{formatVnd(row.revenue)}</strong>
                    </span>
                  </div>

                  {/* Thanh tỷ trọng: so sánh giữa các sân bằng mắt nhanh hơn đọc số. */}
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated" aria-hidden>
                    <div className="h-full bg-brand" style={{ width: `${share}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  big,
}: {
  label: string;
  value: string;
  hint?: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-token-lg border border-line bg-surface p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-subtle">{label}</p>
      {/* Số tiền luôn màu chữ chính (SKILL.md §2). Ô chính nổi bằng CỠ chữ, không
          bằng màu xanh — bản trước gắn cả `text-content` lẫn `text-brand` cùng lúc,
          màu nào thắng là do thứ tự CSS. */}
      <p
        className={`mt-1 tabular-nums text-content ${big ? "text-2xl font-extrabold" : "text-xl font-bold"}`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

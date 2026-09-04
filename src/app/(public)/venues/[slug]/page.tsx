import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SelectAndBook } from "@/components/booking/select-and-book";
import { SportIcon, sportStyle } from "@/components/venue/sport-icon";
import { DateStrip } from "@/components/booking/date-strip";
import { parseDateKey, dateKey, fullDateLabel } from "@/lib/date";
import { formatHhMm } from "@/lib/slots";
import { availabilityService } from "@/services/availability.service";
import { venueService } from "@/services/venue.service";

const WEEKDAY_NAMES = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ days?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const venue = await venueService.publicDetail(slug);

  if (!venue) return { title: "Không tìm thấy sân" };

  return {
    title: venue.name,
    description: `Đặt sân ${venue.sport.name} tại ${venue.name} — ${venue.address}, ${venue.ward}, ${venue.province}.`,
  };
}

/**
 * Chi tiết cơ sở + lưới đặt sân.
 *
 * Hai truy vấn chạy SONG SONG: hồ sơ sân và lịch trống của ngày đang xem. Chạy
 * tuần tự thì thời gian mở trang là tổng của hai, mà cả hai đều không phụ thuộc
 * kết quả của nhau.
 */
export default async function VenueDetailPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const venue = await venueService.publicDetail(slug);

  if (!venue) notFound();

  const days = parseDateKey(query.days);
  const key = dateKey(days);
  const lich = await availabilityService.forDay(venue.id, days);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="flex items-start gap-4">
        <div
          className={`hidden h-16 w-16 shrink-0 items-center justify-center rounded-token-lg bg-gradient-to-br shadow-nang-1 sm:flex ${sportStyle(venue.sport.key).nen} ${sportStyle(venue.sport.key).mau}`}
        >
          <SportIcon sportKey={venue.sport.key} className="h-8 w-8" />
        </div>

        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
            <SportIcon
              sportKey={venue.sport.key}
              className={`h-4 w-4 sm:hidden ${sportStyle(venue.sport.key).mau}`}
            />
            {venue.sport.name}
          </p>

          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-content sm:text-4xl">
            {venue.name}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <p className="flex items-center gap-1.5">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-4 w-4 shrink-0 text-subtle"
                aria-hidden
              >
                <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" />
                <circle cx="12" cy="10" r="2.4" />
              </svg>
              {venue.address}, {venue.ward}, {venue.province}
            </p>

            {venue.ratingCount > 0 && (
              <p className="flex items-center gap-1.5">
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-amber-400" aria-hidden>
                  <path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.6 9.4l6.5-.9L12 2.6Z" />
                </svg>
                <span className="font-semibold text-content">
                  {Number(venue.ratingAvg).toFixed(1)}
                </span>
                <span className="text-subtle">· {venue.ratingCount} đánh giá</span>
              </p>
            )}
          </div>
        </div>
      </header>

      {/*
        Sân đang đóng thì nói RÕ vì sao và tới bao giờ — "hiện không nhận đặt"
        khiến khách bỏ đi và không quay lại, còn "sửa mặt sân, mở lại 25/9" thì
        không.
      */}
      {venue.inactiveNote && (
        <p role="status" className="alert alert-warning mt-4">
          {venue.inactiveNote}
        </p>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* `min-w-0`: xem ghi chú trong slot-grid.tsx — không có nó thì lưới
            đẩy rộng cả trang thay vì tự cuộn. */}
        <section aria-labelledby="selection-gio" className="min-w-0">
          <h2 id="selection-gio" className="text-xl font-bold tracking-tight text-content">
            Chọn khung giờ
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {fullDateLabel(days)} · kéo qua nhiều ô liền nhau để đặt dài hơn
          </p>

          <div className="mt-3">
            <DateStrip basePath={`/venue/${venue.slug}`} selected={days} />
          </div>

          <div className="mt-4">
            {lich.isClosed ? (
              <p className="rounded-token-lg border border-dashed border-line bg-surface p-8 text-center text-muted">
                Sân nghỉ ngày này. Chọn ngày khác giúp bạn nhé.
              </p>
            ) : (
              <SelectAndBook day={lich} venueId={venue.id} date={key} />
            )}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {venue.description && (
            <InfoCard tieuDe="Giới thiệu">
              <p className="text-sm leading-relaxed text-content">{venue.description}</p>
            </InfoCard>
          )}

          {venue.amenities.length > 0 && (
            <InfoCard tieuDe="Tiện ích">
              <ul className="flex flex-wrap gap-1.5">
                {venue.amenities.map((item) => (
                  <li
                    key={item}
                    className="rounded-full border border-line bg-elevated px-2.5 py-1 text-xs font-medium text-content"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </InfoCard>
          )}

          <OpeningHours hours={venue.hours} />

          <InfoCard tieuDe="Chính sách huỷ">
            <p className="text-sm leading-relaxed text-content">
              {venue.freeCancelHours === null ? (
                "Huỷ trước 2 tiếng được hoàn tiền."
              ) : (
                <>
                  Huỷ trước <strong>{venue.freeCancelHours} tiếng</strong> được hoàn tiền.
                  {venue.cancelFeePercent !== null && venue.cancelFeePercent < 100 && (
                    <> Sau đó hoàn {100 - venue.cancelFeePercent}%.</>
                  )}
                </>
              )}
            </p>
          </InfoCard>

          {venue.phone && (
            <InfoCard tieuDe="Liên hệ">
              <a
                href={`tel:${venue.phone}`}
                className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-4 w-4"
                  aria-hidden
                >
                  <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z" />
                </svg>
                {venue.phone}
              </a>
            </InfoCard>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Khung bao chung của mỗi mục ở cột phải — một tấm thẻ, không phải chữ trôi. */
function InfoCard({ tieuDe, children }: { tieuDe: string; children: React.ReactNode }) {
  return (
    <section className="rounded-token-lg border border-line bg-surface p-4 shadow-nang-1">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-subtle">{tieuDe}</h2>
      {children}
    </section>
  );
}

/** Giờ mở cửa cả tuần. Ngày nghỉ ghi rõ chữ "Nghỉ", không để trống. */
function OpeningHours({
  hours,
}: {
  hours: { weekday: number; openMinute: number; closeMinute: number; isClosed: boolean }[];
}) {
  if (hours.length === 0) return null;

  // Thứ 2 trước, Chủ nhật cuối — đọc theo lịch Việt Nam, không theo `getDay()`.
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const byWeekday = new Map(hours.map((hour) => [hour.weekday, hour]));

  return (
    <InfoCard tieuDe="Giờ mở cửa">
      <dl className="space-y-1 text-sm">
        {ORDER.map((weekday) => {
          const hour = byWeekday.get(weekday);

          return (
            <div key={weekday} className="flex justify-between gap-4">
              <dt className="text-muted">{WEEKDAY_NAMES[weekday]}</dt>
              <dd className="font-medium text-content">
                {!hour || hour.isClosed ? (
                  <span className="text-subtle">Nghỉ</span>
                ) : (
                  `${formatHhMm(hour.openMinute)} – ${formatHhMm(hour.closeMinute)}`
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </InfoCard>
  );
}

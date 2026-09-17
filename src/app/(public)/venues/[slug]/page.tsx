import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SelectAndBook } from "@/components/booking/select-and-book";
import { SportIcon, sportStyle } from "@/components/venue/sport-icon";
import { VenueGallery } from "@/components/venue/venue-gallery";
import { DateStrip } from "@/components/booking/date-strip";
import { Notice } from "@/components/ui/notice";
import { getCurrentUser } from "@/lib/auth";
import { parseDateKey, dateKey, fullDateLabel } from "@/lib/date";
import { decodeSelection, formatHhMm } from "@/lib/slots";
import { availabilityService } from "@/services/availability.service";
import { DEFAULT_HOLD_MINUTES } from "@/services/booking.service";
import { venueService } from "@/services/venue.service";

const WEEKDAY_NAMES = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

type Props = {
  params: Promise<{ slug: string }>;
  /** `chon` = các ô khách đã chọn trước khi bị đưa sang đăng nhập — xem `encodeSelection`. */
  searchParams: Promise<{ date?: string; chon?: string }>;
};

/**
 * Hồ sơ sân dùng chung cho `generateMetadata` và trang trong CÙNG một request.
 *
 * Trước đây hai nơi gọi `publicDetail` hai lần — hai truy vấn giống hệt nhau
 * cho mỗi lần mở trang được mở nhiều nhất sau trang tìm sân. `cache()` của
 * React chỉ nhớ trong phạm vi một request, nên không có dữ liệu cũ nào lọt
 * sang người sau.
 */
const getVenue = cache((slug: string) => venueService.publicDetail(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const venue = await getVenue(slug);

  if (!venue) return { title: "Không tìm thấy sân" };

  return {
    title: venue.name,
    description: `Đặt sân ${venue.sport.name} tại ${venue.name} — ${venue.address}, ${venue.ward}, ${venue.province}.`,
  };
}

/**
 * Chi tiết cơ sở + lưới đặt sân.
 *
 * Hồ sơ sân và người đang xem đọc SONG SONG (không phụ thuộc nhau); lịch trống
 * cần `venue.id` nên chạy ngay sau — và chỉ khi sân đang nhận đặt. Chú thích bản
 * trước nói "song song" trong khi mã chạy tuần tự cả ba.
 *
 * Sân tạm đóng (bảo trì, tạm nghỉ) vẫn có trang: khách mở link đã lưu phải đọc
 * được VÌ SAO sân đóng và tới bao giờ, không phải một trang 404.
 */
export default async function VenueDetailPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [venue, user] = await Promise.all([getVenue(slug), getCurrentUser()]);

  if (!venue) notFound();

  // Tham số URL là `?date=` — cùng tên với thứ `DateStrip` sinh ra. Trước đây
  // trang đọc `?days=` nên bấm chọn ngày không có tác dụng gì.
  const date = parseDateKey(query.date);
  const key = dateKey(date);
  const schedule = venue.bookable ? await availabilityService.forDay(venue.id, date) : null;
  const sport = sportStyle(venue.sport.key);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="flex items-start gap-4">
        <div
          className={`hidden h-16 w-16 shrink-0 items-center justify-center rounded-token-lg sm:flex ${sport.tint} ${sport.text}`}
        >
          <SportIcon sportKey={venue.sport.key} className="h-8 w-8" />
        </div>

        <div className="min-w-0">
          {/* Tên môn là NHÃN, không phải thứ bấm được — chữ xám, không xanh. */}
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
            <SportIcon sportKey={venue.sport.key} className={`h-4 w-4 sm:hidden ${sport.text}`} />
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
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-rating" aria-hidden>
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

      <VenueGallery images={venue.images} name={venue.name} />

      {/*
        Sân đang đóng thì nói RÕ vì sao và tới bao giờ — "hiện không nhận đặt"
        khiến khách bỏ đi và không quay lại, còn "sửa mặt sân, mở lại 25/9" thì
        không. Sân chưa ghi lý do thì vẫn phải nói là đang tạm ngừng.

        Giọng TRUNG TÍNH: sân tạm nghỉ là chuyện bình thường của sân, không phải
        lỗi của khách — và cam thì chỉ dành cho giờ vàng.
      */}
      {!venue.bookable ? (
        <Notice tone="neutral" role="status" as="div" className="mt-4">
          <p className="font-semibold">Sân đang tạm ngừng nhận đặt</p>
          <p className="mt-0.5">
            {venue.inactiveNote ??
              "Chủ sân chưa mở lại lịch. Quay lại sau hoặc gọi sân để hỏi thêm."}
          </p>
        </Notice>
      ) : (
        venue.inactiveNote && (
          <Notice tone="neutral" role="status" className="mt-4">
            {venue.inactiveNote}
          </Notice>
        )
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* `min-w-0`: xem ghi chú trong slot-grid.tsx — không có nó thì lưới
            đẩy rộng cả trang thay vì tự cuộn. */}
        {schedule ? (
          <section aria-labelledby="choose-slots" className="min-w-0">
            <h2 id="choose-slots" className="text-xl font-bold tracking-tight text-content">
              Chọn khung giờ
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {fullDateLabel(date)} · bấm chọn một hoặc nhiều ô, khác sân cũng được
            </p>

            <div className="mt-3">
              <DateStrip basePath={`/venues/${venue.slug}`} selected={date} />
            </div>

            <div className="mt-4">
              {schedule.isClosed && schedule.timing !== "PAST" ? (
                <p className="rounded-token-lg border border-dashed border-line bg-surface p-8 text-center text-muted">
                  Sân nghỉ ngày này. Chọn ngày khác giúp bạn nhé.
                </p>
              ) : (
                <SelectAndBook
                  // `key` theo ngày: đổi ngày là dựng lại từ đầu. Không có nó, ô
                  // 18:00 chọn ở thứ 5 vẫn "đang chọn" khi chuyển sang thứ 6 — và
                  // bị đặt cho thứ 6, ngày khách không hề chọn.
                  key={key}
                  day={schedule}
                  venueId={venue.id}
                  date={key}
                  currentPath={`/venues/${venue.slug}?date=${key}`}
                  holdMinutes={venue.holdMinutes ?? DEFAULT_HOLD_MINUTES}
                  initialSelection={decodeSelection(query.chon)}
                  user={
                    user ? { name: user.fullName ?? user.email ?? "Bạn", phone: user.phone } : null
                  }
                />
              )}
            </div>
          </section>
        ) : (
          // Không dựng lưới cho sân tạm đóng: một lưới toàn ô không bấm được trông
          // như app hỏng, và mời khách dò từng ngày để rồi không đặt được ngày nào.
          <section className="min-w-0 rounded-token-lg border border-dashed border-line bg-surface p-8 text-center">
            <p className="text-base font-semibold text-content">Chưa đặt được sân này lúc này</p>
            <p className="mt-1 text-sm text-muted">
              Xem giờ mở cửa, chính sách và số điện thoại của sân ở bên cạnh.
            </p>
          </section>
        )}

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {venue.description && (
            <InfoCard title="Giới thiệu">
              <p className="text-sm leading-relaxed text-content">{venue.description}</p>
            </InfoCard>
          )}

          {venue.amenities.length > 0 && (
            <InfoCard title="Tiện ích">
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

          <InfoCard title="Chính sách huỷ">
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
            <InfoCard title="Liên hệ">
              <a
                href={`tel:${venue.phone}`}
                className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-text hover:underline"
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

/**
 * Khung bao chung của mỗi mục ở cột phải — một tấm thẻ, không phải chữ trôi.
 * Viền, không đổ bóng (SKILL.md §4).
 */
function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-token-lg border border-line bg-surface p-4">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-subtle">{title}</h2>
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
    <InfoCard title="Giờ mở cửa">
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

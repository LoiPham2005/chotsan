import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChonVaDat } from "@/components/booking/chon-va-dat";
import { DaiChonNgay } from "@/components/booking/dai-chon-ngay";
import { docKhoaNgay, khoaNgay, nhanNgayDay } from "@/lib/ngay";
import { formatHhMm } from "@/lib/slots";
import { availabilityService } from "@/services/availability.service";
import { venueService } from "@/services/venue.service";

const THU = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ngay?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const san = await venueService.publicDetail(slug);

  if (!san) return { title: "Không tìm thấy sân" };

  return {
    title: san.name,
    description: `Đặt sân ${san.sport.name} tại ${san.name} — ${san.address}, ${san.ward}, ${san.province}.`,
  };
}

/**
 * Chi tiết cơ sở + lưới đặt sân.
 *
 * Hai truy vấn chạy SONG SONG: hồ sơ sân và lịch trống của ngày đang xem. Chạy
 * tuần tự thì thời gian mở trang là tổng của hai, mà cả hai đều không phụ thuộc
 * kết quả của nhau.
 */
export default async function ChiTietSanPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const san = await venueService.publicDetail(slug);

  if (!san) notFound();

  const ngay = docKhoaNgay(query.ngay);
  const khoa = khoaNgay(ngay);
  const lich = await availabilityService.forDay(san.id, ngay);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <p className="text-sm font-medium text-brand">{san.sport.name}</p>
        <h1 className="mt-1 text-2xl font-bold text-content sm:text-3xl">{san.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {san.address}, {san.ward}, {san.province}
        </p>

        {san.ratingCount > 0 && (
          <p className="mt-1 text-sm text-muted">
            <span aria-hidden>★</span>{" "}
            <span className="font-medium text-content">{Number(san.ratingAvg).toFixed(1)}</span>{" "}
            <span className="text-subtle">· {san.ratingCount} đánh giá</span>
          </p>
        )}
      </header>

      {/*
        Sân đang đóng thì nói RÕ vì sao và tới bao giờ — "hiện không nhận đặt"
        khiến khách bỏ đi và không quay lại, còn "sửa mặt sân, mở lại 25/9" thì
        không.
      */}
      {san.inactiveNote && (
        <p role="status" className="alert alert-warning mt-4">
          {san.inactiveNote}
        </p>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* `min-w-0`: xem ghi chú trong slot-grid.tsx — không có nó thì lưới
            đẩy rộng cả trang thay vì tự cuộn. */}
        <section aria-labelledby="chon-gio" className="min-w-0">
          <h2 id="chon-gio" className="text-lg font-semibold text-content">
            Chọn khung giờ
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {nhanNgayDay(ngay)} · kéo qua nhiều ô liền nhau để đặt dài hơn
          </p>

          <div className="mt-3">
            <DaiChonNgay basePath={`/san/${san.slug}`} ngayDangChon={ngay} />
          </div>

          <div className="mt-4">
            {lich.isClosed ? (
              <p className="rounded-token-lg border border-dashed border-line bg-surface p-8 text-center text-muted">
                Sân nghỉ ngày này. Chọn ngày khác giúp bạn nhé.
              </p>
            ) : (
              <ChonVaDat day={lich} venueId={san.id} ngay={khoa} />
            )}
          </div>
        </section>

        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          {san.description && (
            <section>
              <h2 className="text-sm font-bold text-muted">Giới thiệu</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-content">{san.description}</p>
            </section>
          )}

          {san.amenities.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-muted">Tiện ích</h2>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {san.amenities.map((item) => (
                  <li
                    key={item}
                    className="rounded-md border border-line bg-elevated px-2 py-0.5 text-xs text-content"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <GioMoCua hours={san.hours} />

          <section>
            <h2 className="text-sm font-bold text-muted">Chính sách huỷ</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-content">
              {san.freeCancelHours === null ? (
                "Huỷ trước 2 tiếng được hoàn tiền."
              ) : (
                <>
                  Huỷ trước <strong>{san.freeCancelHours} tiếng</strong> được hoàn tiền.
                  {san.cancelFeePercent !== null && san.cancelFeePercent < 100 && (
                    <> Sau đó hoàn {100 - san.cancelFeePercent}%.</>
                  )}
                </>
              )}
            </p>
          </section>

          {san.phone && (
            <section>
              <h2 className="text-sm font-bold text-muted">Liên hệ</h2>
              <a
                href={`tel:${san.phone}`}
                className="mt-1.5 inline-block text-sm font-medium text-brand hover:underline"
              >
                {san.phone}
              </a>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Giờ mở cửa cả tuần. Ngày nghỉ ghi rõ chữ "Nghỉ", không để trống. */
function GioMoCua({
  hours,
}: {
  hours: { weekday: number; openMinute: number; closeMinute: number; isClosed: boolean }[];
}) {
  if (hours.length === 0) return null;

  // Thứ 2 trước, Chủ nhật cuối — đọc theo lịch Việt Nam, không theo `getDay()`.
  const thuTu = [1, 2, 3, 4, 5, 6, 0];
  const theoThu = new Map(hours.map((hour) => [hour.weekday, hour]));

  return (
    <section>
      <h2 className="text-sm font-bold text-muted">Giờ mở cửa</h2>
      <dl className="mt-1.5 space-y-0.5 text-sm">
        {thuTu.map((weekday) => {
          const hour = theoThu.get(weekday);

          return (
            <div key={weekday} className="flex justify-between gap-4">
              <dt className="text-muted">{THU[weekday]}</dt>
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
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { DeclareTransfer } from "@/components/booking/declare-transfer";
import { QrCode } from "@/components/booking/qr-code";
import { CopyButton } from "@/components/booking/copy-button";
import { Button } from "@/components/ui/button";
import { timeOfDay, fullDateLabel } from "@/lib/date";
import { formatVnd } from "@/lib/slots";
import { bookingService } from "@/services/booking.service";
import { paymentService } from "@/services/payment.service";

export const metadata: Metadata = {
  title: "Thanh toán",
  // Trang chứa thông tin lượt đặt của một người cụ thể — không cho lên kết quả
  // tìm kiếm, dù mã đặt sân khó đoán.
  robots: { index: false, follow: false },
};

/**
 * Màn thanh toán — chuyển khoản tay, chủ sân duyệt.
 *
 * ---
 * MỞ TRANG NÀY LÀ TẠO GIAO DỊCH, VÀ ĐIỀU ĐÓ AN TOÀN
 *
 * `paymentService.ngay()` chạy mỗi lần tải trang. Gọi lại khi đã có giao dịch
 * sống thì nó TRẢ VỀ cái đang có chứ không tạo cái thứ hai — chốt chặn nằm ở
 * database (`payments_mot_giao_dich_song_cho_moi_booking`), không phải ở đây.
 * Nhờ vậy khách bấm F5 mười lần vẫn chỉ có một giao dịch.
 */
export default async function CheckoutPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const booking = await bookingService.findByCode(code);

  if (!booking) notFound();

  // Trạng thái đã xong thì không còn gì để thanh toán — hiện kết quả luôn.
  if (booking.status !== "HOLDING") {
    return <BookingOutcome booking={booking} />;
  }

  const payment = await paymentService.start({
    bookingId: booking.id,
    provider: "BANK_TRANSFER",
    receivedBy: "VENUE",
  });

  const declared = payment.status === "AWAITING_CONFIRMATION";
  const instruction = await paymentService.transferInstruction(payment.id).catch(() => null);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <BookingSummary booking={booking} />

      {declared ? (
        <div className="alert alert-info mt-5" role="status">
          <strong>Đã gửi cho sân.</strong> Sân đang đối chiếu với ngân hàng. Bạn nhận được thông báo
          ngay khi xác nhận xong — thường trong vài phút giờ hành chính.
        </div>
      ) : (
        <>
          {booking.holdExpiresAt && (
            <p className="mt-5 rounded-token-md border border-line bg-surface px-4 py-3 text-sm">
              Chỗ được giữ thêm <HoldCountdown expiresAtIso={booking.holdExpiresAt.toISOString()} />
              . Hết giờ mà chưa chuyển khoản thì chỗ được nhả cho người khác.
            </p>
          )}

          {instruction === null ? (
            <div className="alert alert-warning mt-5">
              Sân chưa khai tài khoản ngân hàng nên chưa nhận chuyển khoản online được. Gọi trực
              tiếp cho sân{booking.venue.phone ? ` theo số ${booking.venue.phone}` : ""} để thanh
              toán giúp bạn nhé.
            </div>
          ) : (
            <>
              <TransferPanel instruction={instruction} />
              <div className="mt-5">
                <DeclareTransfer code={booking.code} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

type Booking = NonNullable<Awaited<ReturnType<typeof bookingService.findByCode>>>;

function BookingSummary({ booking }: { booking: Booking }) {
  return (
    <section className="rounded-token-lg border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-bold text-content">{booking.venue.name}</h1>
        <p className="font-mono text-sm text-muted">
          Mã <span className="font-bold text-content">{booking.code}</span>
        </p>
      </div>

      <dl className="mt-3 space-y-1.5 text-sm">
        <Dong label="Sân" value={booking.court.name} />
        <Dong label="Ngày" value={fullDateLabel(booking.startAt)} />
        <Dong label="Giờ" value={`${timeOfDay(booking.startAt)} – ${timeOfDay(booking.endAt)}`} />
        <Dong label="Người đặt" value={`${booking.customerName} · ${booking.customerPhone}`} />
      </dl>

      <p className="mt-4 flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-sm text-muted">Tổng tiền</span>
        <span className="text-2xl font-bold text-brand">{formatVnd(booking.total)}</span>
      </p>
    </section>
  );
}

function Dong({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right font-medium text-content">{value}</dd>
    </div>
  );
}

/**
 * Khối chuyển khoản.
 *
 * Nội dung chuyển khoản để CẠNH nút chép và lặp lại bằng chữ to: gõ sai nội
 * dung là tiền vào tài khoản mà không ai biết của lượt nào, và đó là loại sự
 * cố tốn nhiều thời gian nhất để gỡ.
 */
function TransferPanel({
  instruction,
}: {
  instruction: {
    bankName: string;
    accountNumber: string;
    accountName: string;
    transferNote: string;
    amount: number;
    qrPayload: string | null;
  };
}) {
  return (
    <section className="mt-5 rounded-token-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="font-semibold text-content">Chuyển khoản</h2>

      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {instruction.qrPayload && (
          <div className="shrink-0 text-center">
            <QrCode payload={instruction.qrPayload} />
            <p className="mt-1.5 text-xs text-muted">Quét bằng app ngân hàng</p>
          </div>
        )}

        <dl className="w-full space-y-2 text-sm">
          <CopyRow label="Ngân hàng" value={instruction.bankName} chep={false} />
          <CopyRow label="Số tài khoản" value={instruction.accountNumber} chep />
          <CopyRow label="Chủ tài khoản" value={instruction.accountName} chep={false} />
          <CopyRow label="Số tiền" value={formatVnd(instruction.amount)} chep={false} />
        </dl>
      </div>

      <div className="mt-4 rounded-token-md border-2 border-dashed border-brand-line bg-brand-tint p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">
          Nội dung chuyển khoản — bắt buộc ghi đúng
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="font-mono text-lg font-bold tracking-wider text-content">
            {instruction.transferNote}
          </p>
          <CopyButton value={instruction.transferNote} label="nội dung chuyển khoản" />
        </div>
        <p className="mt-1 text-xs text-muted">
          Ghi sai nội dung thì sân không đối chiếu được và phải xử lý thủ công.
        </p>
      </div>
    </section>
  );
}

function CopyRow({ label, value, chep }: { label: string; value: string; chep: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className="truncate font-medium text-content">{value}</span>
        {chep && <CopyButton value={value} label={label.toLowerCase()} />}
      </dd>
    </div>
  );
}

/** Lượt đặt không còn ở trạng thái chờ thanh toán. */
function BookingOutcome({ booking }: { booking: Booking }) {
  const labels: Record<string, { tieuDe: string; mo: string; vui: boolean }> = {
    CONFIRMED: {
      tieuDe: "Đặt sân thành công",
      mo: "Sân đã xác nhận. Đọc mã đặt sân khi tới nơi là được.",
      vui: true,
    },
    CHECKED_IN: { tieuDe: "Đã nhận sân", mo: "Chúc bạn chơi vui.", vui: true },
    COMPLETED: { tieuDe: "Đã hoàn tất", mo: "Cảm ơn bạn đã dùng ChốtSân.", vui: true },
    CANCELLED: { tieuDe: "Lượt đặt đã huỷ", mo: "Lượt đặt này không còn hiệu lực.", vui: false },
    EXPIRED: {
      tieuDe: "Hết hạn giữ chỗ",
      mo: "Chỗ đã được nhả cho người khác vì quá hạn thanh toán. Đặt lại giúp bạn nhé.",
      vui: false,
    },
    NO_SHOW: { tieuDe: "Không tới sân", mo: "Lượt đặt được ghi nhận là không tới.", vui: false },
  };

  const item = labels[booking.status] ?? {
    tieuDe: "Lượt đặt sân",
    mo: "",
    vui: false,
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="text-center">
        <p className="text-4xl" aria-hidden>
          {item.vui ? "✅" : "⚠️"}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-content">{item.tieuDe}</h1>
        {item.mo && <p className="mt-1 text-muted">{item.mo}</p>}
      </div>

      <div className="mt-6">
        <BookingSummary booking={booking} />
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild variant="outline">
          <Link href={`/venues/${booking.venue.slug}`}>Xem sân này</Link>
        </Button>
        <Button asChild>
          <Link href="/venues">Đặt sân khác</Link>
        </Button>
      </div>
    </div>
  );
}

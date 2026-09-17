import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { DeclareTransfer } from "@/components/booking/declare-transfer";
import { QrCode } from "@/components/booking/qr-code";
import { CopyButton } from "@/components/booking/copy-button";
import { Button } from "@/components/ui/button";
import { BOOKING_STATUS } from "@/lib/booking-status";
import { dateKey, fullDateLabel, timeOfDay } from "@/lib/date";
import { BookingStateError, VenueBankAccountMissingError } from "@/lib/errors";
import { encodeSelection, formatVnd, SLOT_MINUTES } from "@/lib/slots";
import { bookingService } from "@/services/booking.service";
import { paymentService } from "@/services/payment.service";

export const metadata: Metadata = {
  title: "Thanh toán",
  // Trang chứa thông tin lượt đặt của một người cụ thể — không cho lên kết quả
  // tìm kiếm, dù mã đặt sân khó đoán.
  robots: { index: false, follow: false },
};

type Checkout = NonNullable<Awaited<ReturnType<typeof bookingService.findCheckout>>>;

/**
 * Màn thanh toán của MỘT LẦN ĐẶT — một hay nhiều lượt, trả bằng MỘT lần chuyển khoản.
 *
 * ---
 * NHIỀU LƯỢT VẪN LÀ MỘT MÀN, MỘT MÃ QR, MỘT NÚT
 *
 * Khách chọn Sân 1 lúc 13:00 và Sân 8 lúc 14:00 là hai lượt đặt ở database,
 * nhưng với khách đó là MỘT lần đặt. Trước đây họ bị đá sang "Lượt đặt của
 * tôi" và phải thanh toán từng lượt. Giờ màn này gộp: tổng tiền, một nội dung
 * chuyển khoản chung (`CS <mã lần đặt>`), một nút "Tôi đã chuyển khoản".
 *
 * ---
 * MỞ TRANG NÀY LÀ MỞ GIAO DỊCH, VÀ ĐIỀU ĐÓ AN TOÀN
 *
 * `paymentService.start()` chạy mỗi lần tải trang, cho từng lượt. Đã có giao
 * dịch sống thì nó TRẢ VỀ cái đang có — chốt chặn nằm ở database
 * (`payments_mot_giao_dich_song_cho_moi_booking`), không phải ở đây. Khách bấm
 * F5 mười lần vẫn chỉ có một giao dịch cho mỗi lượt.
 */
export default async function CheckoutPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const checkout = await bookingService.findCheckout(code);

  if (!checkout) notFound();

  // Mở bằng mã của một lượt con → về URL của cả lần đặt. Một lần đặt chỉ có
  // MỘT đường dẫn, để khách gửi cho bạn bè hay chủ sân đều thấy cùng một thứ.
  if (checkout.code !== code.trim().toUpperCase()) redirect(`/bookings/${checkout.code}`);

  // Không còn lượt nào chờ thanh toán — hiện kết quả luôn.
  if (checkout.holding.length === 0) return <CheckoutOutcome checkout={checkout} />;

  if (checkout.holdExpired) return <HoldExpired checkout={checkout} />;

  const payments = await openPayments(checkout);
  if (payments === null) return <HoldExpired checkout={checkout} />;

  const declared = payments.every((payment) => payment.status === "AWAITING_CONFIRMATION");
  const instruction = declared
    ? null
    : await transferInstructionOrNull(payments.map((payment) => payment.id));

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <CheckoutSummary checkout={checkout} />

      {declared ? (
        <div
          role="status"
          className="mt-5 flex items-start gap-3 rounded-token-lg border border-brand-line bg-brand-tint p-4"
        >
          <CheckBadge />
          <p className="text-sm text-content">
            <strong className="font-semibold">Đã gửi cho sân.</strong> Sân đang đối chiếu với ngân
            hàng. Bạn nhận được thông báo ngay khi xác nhận xong — thường trong vài phút giờ hành
            chính.
          </p>
        </div>
      ) : (
        <>
          {checkout.rejectReason && (
            <div role="alert" className="alert alert-danger mt-5">
              <strong>Sân chưa thấy khoản chuyển trước của bạn.</strong> Lý do: “
              {checkout.rejectReason}”. Kiểm tra lại số tiền và nội dung chuyển khoản rồi báo lại
              giúp bạn.
            </div>
          )}

          {checkout.holdExpiresAt && (
            <p className="mt-5 rounded-token-md border border-line bg-surface px-4 py-3 text-sm">
              Chỗ được giữ thêm{" "}
              <HoldCountdown expiresAtIso={checkout.holdExpiresAt.toISOString()} />. Hết giờ mà chưa
              chuyển khoản thì chỗ được nhả cho người khác.
            </p>
          )}

          {instruction === null ? (
            <div className="alert alert-warning mt-5">
              Sân chưa khai tài khoản ngân hàng nên chưa nhận chuyển khoản online được. Gọi trực
              tiếp cho sân{checkout.venue.phone ? ` theo số ${checkout.venue.phone}` : ""} để thanh
              toán giúp bạn nhé.
            </div>
          ) : (
            <>
              <TransferPanel instruction={instruction} />
              <div className="mt-5">
                <DeclareTransfer code={checkout.code} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Mở (hoặc lấy lại) giao dịch cho từng lượt còn chờ.
 *
 * `null` = chỗ giữ vừa hết hạn đúng trong tích tắc giữa lúc đọc lần đặt và lúc
 * mở giao dịch — trang hiện màn hết hạn thay vì màn lỗi.
 */
async function openPayments(checkout: Checkout) {
  try {
    return await Promise.all(
      checkout.holding.map((booking) =>
        paymentService.start({
          bookingId: booking.id,
          provider: "BANK_TRANSFER",
          receivedBy: "VENUE",
        }),
      ),
    );
  } catch (error) {
    if (error instanceof BookingStateError) return null;
    throw error;
  }
}

/**
 * `null` CHỈ khi sân chưa khai tài khoản ngân hàng. Trước đây mọi lỗi đều bị
 * nuốt thành "sân chưa khai tài khoản" — lỗi thật bị che dưới một câu sai.
 */
async function transferInstructionOrNull(paymentIds: string[]) {
  try {
    return await paymentService.transferInstruction(paymentIds);
  } catch (error) {
    if (error instanceof VenueBankAccountMissingError) return null;
    throw error;
  }
}

/** Link "đặt lại": về trang sân, đúng ngày, các ô được chọn sẵn qua `?chon=`. */
function rebookHref(checkout: Checkout): string {
  const source = checkout.holding.length > 0 ? checkout.holding : checkout.bookings;
  const day = dateKey(source[0]!.startAt);

  const slots = source
    .filter((booking) => dateKey(booking.startAt) === day)
    .flatMap((booking) =>
      Array.from({ length: (booking.endMinute - booking.startMinute) / SLOT_MINUTES }, (_, i) => ({
        courtId: booking.courtId,
        minute: booking.startMinute + i * SLOT_MINUTES,
      })),
    );

  return `/venues/${checkout.venue.slug}?date=${day}&chon=${encodeSelection(slots)}`;
}

function CheckoutSummary({
  checkout,
  showStatus = false,
}: {
  checkout: Checkout;
  showStatus?: boolean;
}) {
  const many = checkout.bookings.length > 1;
  const sameDay = new Set(checkout.bookings.map((booking) => dateKey(booking.startAt))).size === 1;
  const payable = checkout.holding.length > 0;
  const total = payable
    ? checkout.holdingTotal
    : checkout.bookings.reduce((sum, booking) => sum + booking.total, 0);

  return (
    <section className="rounded-token-lg border border-line bg-surface p-4 shadow-nang-1 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-content">{checkout.venue.name}</h1>
          {sameDay && (
            <p className="text-sm text-muted">{fullDateLabel(checkout.bookings[0]!.startAt)}</p>
          )}
        </div>
        <p className="font-mono text-sm text-muted">
          Mã <span className="font-bold tracking-wider text-content">{checkout.code}</span>
        </p>
      </div>

      <ul className="mt-4 divide-y divide-line rounded-token-md border border-line">
        {checkout.bookings.map((booking) => {
          const status = BOOKING_STATUS[booking.status];

          return (
            <li key={booking.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-content">
                  {booking.court.name}
                  <span className="font-normal text-muted">
                    {" "}
                    · {timeOfDay(booking.startAt)}–{timeOfDay(booking.endAt)}
                  </span>
                </p>
                {(many || !sameDay) && (
                  <p className="text-xs text-subtle">
                    {!sameDay && `${fullDateLabel(booking.startAt)} · `}
                    {many && (
                      <>
                        Mã lượt <span className="font-mono">{booking.code}</span>
                      </>
                    )}
                  </p>
                )}
              </div>

              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-content">
                  {formatVnd(booking.total)}
                </p>
                {showStatus && status && (
                  <span
                    className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${status.className}`}
                  >
                    {status.text}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <dl className="mt-3 space-y-1.5 text-sm">
        <Dong label="Người đặt" value={`${checkout.customerName} · ${checkout.customerPhone}`} />
      </dl>

      <p className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-sm text-muted">
          {payable
            ? many
              ? `Cần thanh toán (${checkout.holding.length} lượt)`
              : "Cần thanh toán"
            : "Tổng tiền"}
        </span>
        <span className="text-2xl font-bold tabular-nums text-brand">{formatVnd(total)}</span>
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
    <section className="mt-5 rounded-token-lg border border-line bg-surface p-4 shadow-nang-1 sm:p-5">
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

/**
 * Chỗ giữ đã quá hạn mà chưa ai trả tiền.
 *
 * KHÔNG hiện mã QR: lịch đã coi các khung này là trống, người khác đặt được bất
 * cứ lúc nào — hiện QR là mời khách trả tiền cho một chỗ có thể đã mất. Thay
 * vào đó là nút đặt lại với đúng các ô cũ được chọn sẵn.
 */
function HoldExpired({ checkout }: { checkout: Checkout }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <CheckoutSummary checkout={checkout} />

      <div role="status" className="mt-5 rounded-token-lg border border-peak-line bg-peak-tint p-4">
        <p className="font-semibold text-peak-text">Đã hết thời gian giữ chỗ</p>
        <p className="mt-1 text-sm text-content">
          Lần đặt chưa được thanh toán nên các khung này đã mở lại cho mọi người. Còn trống thì đặt
          lại được ngay — các ô được chọn sẵn cho bạn.
        </p>
        <Button asChild className="mt-3 w-full shadow-chon sm:w-auto">
          <Link href={rebookHref(checkout)}>Đặt lại các khung này</Link>
        </Button>
      </div>

      <p className="mt-4 text-center text-sm text-muted">
        Đã lỡ chuyển khoản?{" "}
        {checkout.venue.phone ? (
          <>
            Gọi sân theo số{" "}
            <a
              href={`tel:${checkout.venue.phone}`}
              className="font-semibold text-brand hover:underline"
            >
              {checkout.venue.phone}
            </a>{" "}
            để được xử lý.
          </>
        ) : (
          "Liên hệ sân để được xử lý."
        )}
      </p>
    </div>
  );
}

/** Lần đặt không còn lượt nào chờ thanh toán. */
function CheckoutOutcome({ checkout }: { checkout: Checkout }) {
  const statuses = new Set(checkout.bookings.map((booking) => booking.status));
  const many = checkout.bookings.length > 1;

  const item = statuses.has("CONFIRMED")
    ? {
        tieuDe: "Đặt sân thành công",
        mo: many
          ? "Sân đã xác nhận. Đọc mã từng lượt khi tới nơi là được."
          : "Sân đã xác nhận. Đọc mã đặt sân khi tới nơi là được.",
        vui: true,
      }
    : statuses.has("CHECKED_IN")
      ? { tieuDe: "Đã nhận sân", mo: "Chúc bạn chơi vui.", vui: true }
      : statuses.has("COMPLETED")
        ? { tieuDe: "Đã hoàn tất", mo: "Cảm ơn bạn đã dùng ChốtSân.", vui: true }
        : statuses.has("NO_SHOW")
          ? { tieuDe: "Không tới sân", mo: "Lượt đặt được ghi nhận là không tới.", vui: false }
          : statuses.size === 1 && statuses.has("EXPIRED")
            ? {
                tieuDe: "Hết hạn giữ chỗ",
                mo: "Chỗ đã được nhả cho người khác vì quá hạn thanh toán.",
                vui: false,
              }
            : statuses.size === 1
              ? { tieuDe: "Lượt đặt đã huỷ", mo: "Lượt đặt này không còn hiệu lực.", vui: false }
              : { tieuDe: "Lần đặt không còn hiệu lực", mo: "", vui: false };

  const expired = statuses.size === 1 && statuses.has("EXPIRED");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="text-center">
        {item.vui ? (
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-chon">
            <svg viewBox="0 0 16 16" fill="none" className="h-6 w-6" aria-hidden>
              <path
                d="m3.5 8.5 3 3 6-7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        ) : (
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-peak-tint text-peak-text ring-1 ring-peak-line">
            <svg viewBox="0 0 16 16" fill="none" className="h-6 w-6" aria-hidden>
              <path d="M8 4.5v4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="8" cy="11.4" r="1.1" fill="currentColor" />
            </svg>
          </span>
        )}
        <h1 className="mt-3 text-2xl font-bold text-content">{item.tieuDe}</h1>
        {item.mo && <p className="mt-1 text-muted">{item.mo}</p>}
      </div>

      <div className="mt-6">
        <CheckoutSummary checkout={checkout} showStatus={many} />
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild variant="outline">
          <Link href={`/venues/${checkout.venue.slug}`}>Xem sân này</Link>
        </Button>
        {expired ? (
          <Button asChild>
            <Link href={rebookHref(checkout)}>Đặt lại các khung này</Link>
          </Button>
        ) : (
          <Button asChild>
            <Link href="/venues">Đặt sân khác</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function CheckBadge() {
  return (
    <span
      aria-hidden
      className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-white"
    >
      <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
        <path
          d="m3.5 8.5 3 3 6-7"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

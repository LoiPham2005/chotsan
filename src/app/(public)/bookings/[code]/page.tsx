import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { DeclareTransfer } from "@/components/booking/declare-transfer";
import { OpenTransfer } from "@/components/booking/open-transfer";
import { QrCode } from "@/components/booking/qr-code";
import { CopyButton } from "@/components/booking/copy-button";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { requireUser } from "@/lib/auth";
import { BOOKING_STATUS } from "@/lib/booking-status";
import { dateKey, fullDateLabel, timeOfDay } from "@/lib/date";
import { VenueBankAccountMissingError } from "@/lib/errors";
import { encodeSelection, formatVnd, SLOT_MINUTES } from "@/lib/slots";
import { bookingService } from "@/services/booking.service";
import { MANUAL_TRANSFER_PROVIDER, paymentService } from "@/services/payment.service";
import { permissionService } from "@/services/permission.service";

export const metadata: Metadata = {
  title: "Thanh toán",
  // Trang chứa thông tin lượt đặt của một người cụ thể — không cho lên kết quả
  // tìm kiếm.
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
 * AI ĐƯỢC XEM: NGƯỜI ĐẶT, VÀ NGƯỜI CỦA SÂN CÓ `booking:read`
 *
 * Trang có tên + số điện thoại của khách. Bản trước cho "ai biết mã" xem — mã
 * đọc qua điện thoại, nằm trong ảnh chụp màn hình, trong lịch sử trình duyệt
 * máy dùng chung. Người khác thì 404: không xác nhận mã đó có thật.
 *
 * ---
 * MỞ TRANG KHÔNG GHI GÌ VÀO DATABASE
 *
 * Bản trước mở giao dịch ngay khi GET — trình xem trước link của Zalo hay bot
 * cũng "mở trang" và ghi database. Nay giao dịch mở trong POST giữ chỗ
 * (`holdBookingAction`); lượt nào còn thiếu thì trang hiện nút "Tạo mã chuyển
 * khoản" để chính khách bấm.
 */
export default async function CheckoutPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await requireUser(`/bookings/${encodeURIComponent(code)}`);

  const checkout = await bookingService.findCheckout(code);
  if (!checkout) notFound();

  const isBooker = checkout.userId === user.id;
  if (
    !isBooker &&
    !(await permissionService.canOnVenue(user.id, "booking:read", checkout.venue.id))
  ) {
    notFound();
  }

  // Mở bằng mã của một lượt con → về URL của cả lần đặt. Một lần đặt chỉ có
  // MỘT đường dẫn, để khách gửi cho sân hay tự mở lại đều thấy cùng một thứ.
  if (checkout.code !== code.trim().toUpperCase()) redirect(`/bookings/${checkout.code}`);

  // Không còn lượt nào chờ thanh toán — hiện kết quả luôn.
  if (checkout.holding.length === 0) return <CheckoutOutcome checkout={checkout} />;

  if (checkout.holdExpired) return <HoldExpired checkout={checkout} />;

  // Lượt 0đ (dữ liệu giá lệch từ trước) không mở được giao dịch — nói rõ thay
  // vì dựng QR 0đ hay để trang đổ 500.
  const unpriced = checkout.holding.some((booking) => booking.total <= 0);

  const live = checkout.holding.map((booking) =>
    booking.payments.find(
      (payment) =>
        payment.provider === MANUAL_TRANSFER_PROVIDER &&
        (payment.status === "PENDING" || payment.status === "AWAITING_CONFIRMATION"),
    ),
  );
  const payments = live.every((payment) => payment !== undefined) ? live : null;

  const declared =
    payments !== null && payments.every((payment) => payment.status === "AWAITING_CONFIRMATION");
  const instruction =
    payments === null || declared || unpriced
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
            <Notice tone="danger" role="alert" as="div" className="mt-5">
              <strong>Sân chưa thấy khoản chuyển trước của bạn.</strong> Lý do: “
              {checkout.rejectReason}”. Kiểm tra lại số tiền và nội dung chuyển khoản rồi báo lại
              giúp bạn.
            </Notice>
          )}

          {checkout.holdExpiresAt && (
            <HoldCountdown
              expiresAtIso={checkout.holdExpiresAt.toISOString()}
              serverNowIso={checkout.now.toISOString()}
            />
          )}

          {/* Hai hộp "chưa thanh toán online được" dưới đây là giọng TRUNG TÍNH: không
              phải lỗi của khách, và đã nói bước tiếp theo (gọi sân). */}
          {unpriced ? (
            <Notice tone="neutral" as="div" className="mt-5">
              Lượt đặt này chưa có giá nên chưa thanh toán online được. Gọi sân
              {checkout.venue.phone ? ` theo số ${checkout.venue.phone}` : ""} giúp bạn nhé.
            </Notice>
          ) : !isBooker ? (
            // Nhân viên sân xem được màn này nhưng không thao tác thay khách.
            <p className="mt-5 rounded-token-md border border-line bg-surface px-4 py-3 text-sm text-muted">
              Bạn đang xem với tư cách người của sân. Chỉ người đặt mới tạo mã và báo đã chuyển
              khoản.
            </p>
          ) : payments === null ? (
            <OpenTransfer code={checkout.code} />
          ) : instruction === null ? (
            <Notice tone="neutral" as="div" className="mt-5">
              Sân chưa khai tài khoản ngân hàng nên chưa nhận chuyển khoản online được. Gọi trực
              tiếp cho sân{checkout.venue.phone ? ` theo số ${checkout.venue.phone}` : ""} để thanh
              toán giúp bạn nhé.
            </Notice>
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
    <section className="rounded-token-lg border border-line bg-surface p-4 sm:p-5">
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
        <SummaryRow
          label="Người đặt"
          value={`${checkout.customerName} · ${checkout.customerPhone}`}
        />
      </dl>

      <p className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-sm text-muted">
          {payable
            ? many
              ? `Cần thanh toán (${checkout.holding.length} lượt)`
              : "Cần thanh toán"
            : "Tổng tiền"}
        </span>
        {/* Số tiền màu CHỮ CHÍNH (SKILL.md §2: `--text-main` cho tiêu đề, số tiền) —
            xanh `#10b981` làm chữ chỉ đạt 2,5:1, đọc không nổi ngoài nắng. */}
        <span className="text-2xl font-extrabold tabular-nums text-content">
          {formatVnd(total)}
        </span>
      </p>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
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

        {/* `min-w-0`: cạnh mã QR (từ `sm`), thiếu nó thì tên ngân hàng / chủ tài
            khoản dài đẩy khối này tràn khỏi thẻ và làm cả trang rộng hơn màn hình. */}
        <dl className="w-full min-w-0 space-y-2 text-sm">
          <CopyRow label="Ngân hàng" value={instruction.bankName} />
          <CopyRow label="Số tài khoản" value={instruction.accountNumber} copyId="account-number" />
          <CopyRow label="Chủ tài khoản" value={instruction.accountName} />
          <CopyRow label="Số tiền" value={formatVnd(instruction.amount)} />
        </dl>
      </div>

      <div className="mt-4 rounded-token-md border-2 border-dashed border-brand-line bg-brand-tint p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">
          Nội dung chuyển khoản — bắt buộc ghi đúng
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p id="transfer-note" className="font-mono text-lg font-bold tracking-wider text-content">
            {instruction.transferNote}
          </p>
          <CopyButton
            value={instruction.transferNote}
            label="nội dung chuyển khoản"
            targetId="transfer-note"
          />
        </div>
        <p className="mt-1 text-xs text-muted">
          Ghi sai nội dung thì sân không đối chiếu được và phải xử lý thủ công.
        </p>
      </div>
    </section>
  );
}

/** Một dòng thông tin chuyển khoản. Có `copyId` thì kèm nút chép (và `id` để bôi chọn khi không chép được). */
function CopyRow({ label, value, copyId }: { label: string; value: string; copyId?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        {/* Xuống dòng, KHÔNG cắt "…": khách đối chiếu tên chủ tài khoản với tên app
            ngân hàng hiện ra trước khi chuyển — tên bị cắt là không đối chiếu được. */}
        <span id={copyId} className="min-w-0 break-words text-right font-medium text-content">
          {value}
        </span>
        {copyId && <CopyButton value={value} label={label.toLowerCase()} targetId={copyId} />}
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

      {/* ĐỎ nhạt: hết hạn giữ chỗ là "sắp hết → đã hết" (SKILL.md §2), không phải
          cam — cam chỉ nói "giờ vàng". Nút đặt lại vẫn là nút chính màu xanh. */}
      <div
        role="status"
        className="mt-5 rounded-token-lg border border-danger-line bg-danger-tint p-4"
      >
        <p className="font-semibold text-danger-text">Đã hết thời gian giữ chỗ</p>
        <p className="mt-1 text-sm text-content">
          Lần đặt chưa được thanh toán nên các khung này đã mở lại cho mọi người. Còn trống thì đặt
          lại được ngay — các ô được chọn sẵn cho bạn.
        </p>
        <Button asChild className="mt-3 w-full sm:w-auto">
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
              className="font-semibold text-brand-text hover:underline"
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
        title: "Đặt sân thành công",
        description: many
          ? "Sân đã xác nhận. Đọc mã từng lượt khi tới nơi là được."
          : "Sân đã xác nhận. Đọc mã đặt sân khi tới nơi là được.",
        positive: true,
      }
    : statuses.has("CHECKED_IN")
      ? { title: "Đã nhận sân", description: "Chúc bạn chơi vui.", positive: true }
      : statuses.has("COMPLETED")
        ? { title: "Đã hoàn tất", description: "Cảm ơn bạn đã dùng ChốtSân.", positive: true }
        : statuses.has("NO_SHOW")
          ? {
              title: "Không tới sân",
              description: "Lượt đặt được ghi nhận là không tới.",
              positive: false,
            }
          : statuses.size === 1 && statuses.has("EXPIRED")
            ? {
                title: "Hết hạn giữ chỗ",
                description: "Chỗ đã được nhả cho người khác vì quá hạn thanh toán.",
                positive: false,
              }
            : statuses.size === 1
              ? {
                  title: "Lượt đặt đã huỷ",
                  description: "Lượt đặt này không còn hiệu lực.",
                  positive: false,
                }
              : { title: "Lần đặt không còn hiệu lực", description: "", positive: false };

  const expired = statuses.size === 1 && statuses.has("EXPIRED");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="text-center">
        {item.positive ? (
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white">
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
          // Lượt huỷ / hết hạn / không tới: đỏ nhạt (SKILL.md §2: đỏ = huỷ, sắp hết).
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-tint text-danger-text ring-1 ring-danger-line">
            <svg viewBox="0 0 16 16" fill="none" className="h-6 w-6" aria-hidden>
              <path d="M8 4.5v4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="8" cy="11.4" r="1.1" fill="currentColor" />
            </svg>
          </span>
        )}
        <h1 className="mt-3 text-2xl font-bold text-content">{item.title}</h1>
        {item.description && <p className="mt-1 text-muted">{item.description}</p>}
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

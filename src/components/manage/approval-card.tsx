"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  approvePaymentAction,
  rejectPaymentAction,
  type ManageState,
} from "@/app/(manage)/manage/[venueId]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fullDateLabel, timeOfDay } from "@/lib/date";
import { formatVnd } from "@/lib/slots";

export type ApprovalData = {
  checkoutCode: string;
  /** TỔNG của cả lần chuyển khoản — đúng con số chủ sân thấy trong sao kê. */
  amount: number;
  transferNote: string;
  declaredAt: string | null;
  declaredNote: string | null;
  proofImageUrl: string | null;
  customerName: string;
  customerPhone: string;
  /** Từng lượt mà lần chuyển khoản này trả cho. */
  items: {
    paymentId: string;
    bookingCode: string;
    courtName: string;
    startAt: string;
    endAt: string;
    amount: number;
  }[];
};

/**
 * Một khoản khai chuyển khoản đang chờ chủ sân đối chiếu.
 *
 * ---
 * NỘI DUNG CHUYỂN KHOẢN VÀ SỐ TIỀN ĐỨNG TO NHẤT
 *
 * Việc chủ sân thật sự làm ở đây: mở app ngân hàng, tìm một dòng khớp CẢ HAI
 * thứ đó. Mọi thứ còn lại là bối cảnh. Bày tên khách to hơn số tiền là bắt mắt
 * họ đi tìm lại thứ cần dùng.
 *
 * ---
 * MỘT NÚT CHO CẢ LẦN CHUYỂN KHOẢN
 *
 * Khách đặt ba sân rồi chuyển một lần. Bấm "đã nhận đủ tiền" là xác nhận CẢ
 * BA lượt trong một transaction — form gửi đủ các `paymentId`. Duyệt từng lượt
 * là để lọt một lượt treo "chờ thanh toán" rồi hết hạn dù khách đã trả tiền.
 *
 * ---
 * NÚT "ĐÃ NHẬN TIỀN", KHÔNG PHẢI "DUYỆT"
 *
 * "Duyệt" mơ hồ — duyệt cái gì, có phải đã kiểm chưa. Câu chữ phải nói đúng
 * điều người bấm đang khẳng định, vì bấm nhầm ở đây là mất tiền thật.
 */
export function ApprovalCard({ item, venueId }: { item: ApprovalData; venueId: string }) {
  const [showReject, setShowReject] = useState(false);

  const [approveState, approve] = useActionState<ManageState, FormData>(
    approvePaymentAction.bind(null, venueId),
    {},
  );
  const [rejectState, reject] = useActionState<ManageState, FormData>(
    rejectPaymentAction.bind(null, venueId),
    {},
  );

  return (
    <li className="rounded-token-lg border border-line bg-surface p-4 shadow-nang-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-subtle">
            Nội dung chuyển khoản
          </p>
          <p className="font-mono text-lg font-bold tracking-wider text-content">
            {item.transferNote}
          </p>
        </div>

        <p className="text-2xl font-bold tabular-nums text-content">{formatVnd(item.amount)}</p>
      </div>

      <ul className="mt-3 divide-y divide-line rounded-token-md border border-line text-sm">
        {item.items.map((line) => (
          <li key={line.paymentId} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 text-content">
              <span className="font-semibold">{line.courtName}</span> ·{" "}
              {timeOfDay(new Date(line.startAt))}–{timeOfDay(new Date(line.endAt))}
              <span className="block text-xs text-subtle">
                {fullDateLabel(new Date(line.startAt))} · mã{" "}
                <span className="font-mono">{line.bookingCode}</span>
              </span>
            </span>
            {item.items.length > 1 && (
              <span className="shrink-0 tabular-nums text-muted">{formatVnd(line.amount)}</span>
            )}
          </li>
        ))}
      </ul>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Row label="Khách">
          {item.customerName} ·{" "}
          <a href={`tel:${item.customerPhone}`} className="font-medium text-brand hover:underline">
            {item.customerPhone}
          </a>
        </Row>
        <Row label="Khách báo lúc">
          {item.declaredAt ? timeOfDay(new Date(item.declaredAt)) : "—"}
        </Row>
        {item.declaredNote && <Row label="Khách ghi chú">{item.declaredNote}</Row>}
      </dl>

      {item.proofImageUrl && (
        <a
          href={item.proofImageUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-sm font-medium text-brand hover:underline"
        >
          Xem ảnh chụp màn hình khách gửi →
        </a>
      )}

      <p className="mt-3 rounded-token-md bg-elevated px-3 py-2 text-xs text-muted">
        Mở app ngân hàng, tìm giao dịch khớp <strong>cả nội dung lẫn số tiền</strong> rồi mới xác
        nhận. Lời khai của khách không phải bằng chứng.
      </p>

      {(approveState.error ?? rejectState.error) && (
        <p role="alert" className="alert alert-danger mt-3">
          {approveState.error ?? rejectState.error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <form action={approve}>
          <PaymentIdInputs item={item} />
          <ApproveButton />
        </form>

        {!showReject && (
          <Button type="button" variant="outline" onClick={() => setShowReject(true)}>
            Không thấy tiền
          </Button>
        )}
      </div>

      {showReject && (
        <form action={reject} className="mt-3 rounded-token-md border border-line bg-elevated p-3">
          <PaymentIdInputs item={item} />

          <label
            htmlFor={`reason-${item.checkoutCode}`}
            className="text-sm font-semibold text-content"
          >
            Lý do — khách sẽ đọc câu này
          </label>
          <Input
            id={`reason-${item.checkoutCode}`}
            name="reason"
            required
            minLength={4}
            maxLength={300}
            placeholder="Ví dụ: chưa thấy tiền về, kiểm tra lại nội dung chuyển khoản giúp bạn"
            className="mt-1.5 bg-surface"
          />

          <div className="mt-2 flex gap-2">
            <RejectButton />
            <Button type="button" variant="ghost" onClick={() => setShowReject(false)}>
              Thôi
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

/** Mọi giao dịch của lần chuyển khoản — cùng tên `paymentId`, action đọc bằng `getAll`. */
function PaymentIdInputs({ item }: { item: ApprovalData }) {
  return item.items.map((line) => (
    <input key={line.paymentId} type="hidden" name="paymentId" value={line.paymentId} />
  ));
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 sm:justify-start sm:gap-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right font-medium text-content sm:text-left">{children}</dd>
    </div>
  );
}

function ApproveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="shadow-chon">
      {pending ? "Đang ghi nhận…" : "Đã nhận đủ tiền"}
    </Button>
  );
}

function RejectButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Đang gửi…" : "Báo cho khách"}
    </Button>
  );
}

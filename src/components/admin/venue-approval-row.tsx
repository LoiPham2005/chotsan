"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { decideVenueAction, type ApprovalState } from "@/app/(admin)/venue-approvals/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SportIcon, sportStyle } from "@/components/venue/sport-icon";
import { fullDateLabel } from "@/lib/date";

export type PendingVenue = {
  id: string;
  name: string;
  description: string | null;
  address: string;
  phone: string | null;
  sportName: string;
  sportKey: string;
  createdAt: string;
  courtCount: number;
  priceRuleCount: number;
  openDayCount: number;
  hasBankAccount: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
};

/**
 * Một hồ sơ chờ duyệt.
 *
 * ---
 * BỐN THỨ QUYẾT ĐỊNH ĐƯỢC DUYỆT HAY KHÔNG
 *
 * Sân con đang bật, luật giá, số ngày mở cửa, và tài khoản nhận tiền. Thiếu bất
 * kỳ thứ nào thì lưới đặt sân hiện trống trơn, giá 0đ, hoặc trang thanh toán
 * không có mã QR — duyệt xong khách vào là thấy trang hỏng. Nên chúng đứng ngay
 * cạnh nút duyệt, tô đỏ khi thiếu, chứ không bắt người duyệt tự đi mở từng tab.
 * (Cùng điều kiện với chốt chặn trong `VenueService.setStatus`.)
 *
 * ---
 * TỪ CHỐI = TRẢ HỒ SƠ VỀ BẢN NHÁP, KÈM LÝ DO
 *
 * Không phải khoá. Chủ sân đọc lý do trên trang cài đặt, sửa, rồi gửi lại.
 */
export function ApprovalRow({ venue }: { venue: PendingVenue }) {
  const [state, decide] = useActionState<ApprovalState, FormData>(decideVenueAction, {});
  const [showReject, setShowReject] = useState(false);
  const sport = sportStyle(venue.sportKey);

  const ready =
    venue.courtCount > 0 &&
    venue.priceRuleCount > 0 &&
    venue.openDayCount > 0 &&
    venue.hasBankAccount;

  if (state.ok) {
    return (
      <li className="rounded-token-lg border border-brand-line bg-brand-tint p-4">
        <p className="font-semibold text-brand-text">
          {venue.name} — {state.ok}
        </p>
      </li>
    );
  }

  return (
    <li className="rounded-token-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-token-md ${sport.tint} ${sport.text}`}
        >
          <SportIcon sportKey={venue.sportKey} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-semibold text-content">{venue.name}</p>
          <p className="truncate text-sm text-muted">{venue.address}</p>
          <p className="mt-0.5 text-sm text-muted">
            {venue.sportName}
            {venue.phone && ` · ${venue.phone}`}
            {venue.ownerName && ` · chủ sân: ${venue.ownerName}`}
            {venue.ownerEmail && ` (${venue.ownerEmail})`}
          </p>
        </div>

        <p className="shrink-0 text-xs text-subtle">
          nộp {fullDateLabel(new Date(venue.createdAt))}
        </p>
      </div>

      {venue.description && (
        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-content">
          {venue.description}
        </p>
      )}

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-sm">
        <Stat label="Sân con đang bật" value={venue.courtCount} />
        <Stat label="Luật giá" value={venue.priceRuleCount} />
        <Stat label="Ngày mở cửa" value={venue.openDayCount} />
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted">Tài khoản nhận tiền</dt>
          <dd className={`font-bold ${venue.hasBankAccount ? "text-content" : "text-danger-text"}`}>
            {venue.hasBankAccount ? "Đã khai" : "Chưa khai"}
          </dd>
        </div>
      </dl>

      {/* Xám trung tính, không cam: đây là lời nhắc việc tiếp theo cho người
          duyệt, không phải lỗi — các số 0 đã tô đỏ ngay ở trên. */}
      {!ready && (
        <Notice tone="neutral" className="mt-3">
          Hồ sơ chưa đủ để mở bán — trả về để chủ sân khai nốt phần còn thiếu.
        </Notice>
      )}

      {state.error && (
        <Notice tone="danger" role="alert" className="mt-3">
          {state.error}
        </Notice>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <form action={decide}>
          <input type="hidden" name="venueId" value={venue.id} />
          <input type="hidden" name="decision" value="ACTIVE" />
          <ApproveButton ready={ready} />
        </form>

        {!showReject && (
          <Button type="button" variant="outline" onClick={() => setShowReject(true)}>
            Trả hồ sơ
          </Button>
        )}
      </div>

      {showReject && (
        <form action={decide} className="mt-3 rounded-token-md border border-line bg-elevated p-3">
          <input type="hidden" name="venueId" value={venue.id} />
          <input type="hidden" name="decision" value="DRAFT" />

          <label htmlFor={`note-${venue.id}`} className="text-sm font-semibold text-content">
            Lý do trả hồ sơ — chủ sân sẽ đọc câu này để sửa
          </label>
          {/* Báo lỗi thì dựng lại đúng lý do vừa gõ: React 19 đã xoá trắng form. */}
          <Input
            id={`note-${venue.id}`}
            name="note"
            required
            minLength={4}
            maxLength={300}
            placeholder="Ví dụ: thiếu ảnh sân và chưa khai bảng giá"
            defaultValue={state.note}
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className={`font-bold tabular-nums ${value === 0 ? "text-danger-text" : "text-content"}`}>
        {value}
      </dd>
    </div>
  );
}

function ApproveButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || !ready}>
      {pending ? "Đang duyệt…" : ready ? "Duyệt, cho mở bán" : "Chưa duyệt được — hồ sơ còn thiếu"}
    </Button>
  );
}

function RejectButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Đang gửi…" : "Trả hồ sơ về cho chủ sân"}
    </Button>
  );
}

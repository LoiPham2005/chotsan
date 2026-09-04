"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { decideVenueAction, type ApprovalState } from "@/app/(admin)/venue-approvals/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  ownerName: string | null;
  ownerEmail: string | null;
};

/**
 * Một hồ sơ chờ duyệt.
 *
 * ---
 * BA CON SỐ QUYẾT ĐỊNH ĐƯỢC DUYỆT HAY KHÔNG
 *
 * Sân con đang bật, luật giá, và số ngày mở cửa. Thiếu bất kỳ thứ nào thì lưới
 * đặt sân hiện trống trơn hoặc giá 0đ — duyệt xong khách vào là thấy trang
 * hỏng. Nên ba con số đó đứng ngay cạnh nút duyệt, tô đỏ khi bằng 0, chứ không
 * bắt người duyệt tự đi mở từng tab kiểm tra.
 */
export function ApprovalRow({ venue }: { venue: PendingVenue }) {
  const [state, decide] = useActionState<ApprovalState, FormData>(decideVenueAction, {});
  const [showReject, setShowReject] = useState(false);
  const style = sportStyle(venue.sportKey);

  const ready = venue.courtCount > 0 && venue.priceRuleCount > 0 && venue.openDayCount > 0;

  if (state.ok) {
    return (
      <li className="rounded-token-lg border border-brand-line bg-brand-tint p-4">
        <p className="font-medium text-brand-hover">
          {venue.name} — {state.ok}
        </p>
      </li>
    );
  }

  return (
    <li className="rounded-token-lg border border-line bg-surface p-4 shadow-nang-1">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-token-md bg-gradient-to-br ${style.nen} ${style.mau}`}
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
      </dl>

      {!ready && (
        <p className="mt-3 rounded-token-md bg-peak-tint px-3 py-2 text-sm text-peak-text">
          Hồ sơ chưa đủ để mở bán. Duyệt bây giờ thì khách vào sẽ thấy lưới trống hoặc giá 0đ.
        </p>
      )}

      {state.error && (
        <p role="alert" className="alert alert-danger mt-3">
          {state.error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <form action={decide}>
          <input type="hidden" name="venueId" value={venue.id} />
          <input type="hidden" name="decision" value="ACTIVE" />
          <ApproveButton ready={ready} />
        </form>

        {!showReject && (
          <Button type="button" variant="outline" onClick={() => setShowReject(true)}>
            Từ chối
          </Button>
        )}
      </div>

      {showReject && (
        <form action={decide} className="mt-3 rounded-token-md border border-line bg-elevated p-3">
          <input type="hidden" name="venueId" value={venue.id} />
          <input type="hidden" name="decision" value="ADMIN_LOCKED" />

          <label htmlFor={`note-${venue.id}`} className="text-sm font-semibold text-content">
            Lý do — chủ sân sẽ đọc câu này
          </label>
          <Input
            id={`note-${venue.id}`}
            name="note"
            required
            minLength={4}
            maxLength={300}
            placeholder="Ví dụ: thiếu ảnh sân và chưa khai bảng giá"
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
      <dd className={`font-bold tabular-nums ${value === 0 ? "text-danger" : "text-content"}`}>
        {value}
      </dd>
    </div>
  );
}

function ApproveButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || !ready} className={ready ? "shadow-chon" : ""}>
      {pending ? "Đang duyệt…" : "Duyệt, cho mở bán"}
    </Button>
  );
}

function RejectButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Đang gửi…" : "Từ chối hồ sơ"}
    </Button>
  );
}

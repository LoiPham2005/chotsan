"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createCourtAction,
  toggleCourtAction,
  type CourtState,
} from "@/app/(manage)/manage/[venueId]/courts/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SURFACE_LABEL: Record<string, string> = {
  NATURAL_GRASS: "Cỏ tự nhiên",
  ARTIFICIAL_GRASS: "Cỏ nhân tạo",
  WOOD: "Sàn gỗ",
  RUBBER: "Cao su",
  CONCRETE: "Bê tông",
  CLAY: "Đất nện",
  EPOXY: "Sơn epoxy",
};

export type CourtItem = {
  id: string;
  name: string;
  surface: string | null;
  isIndoor: boolean;
  isActive: boolean;
};

/**
 * Danh sách sân con + form thêm sân.
 *
 * ---
 * TẮT, KHÔNG XOÁ
 *
 * Không có nút xoá ở đây có chủ đích. Sân đang sửa vẫn mang lịch sử đặt và
 * doanh thu; xoá là mất phần đó khỏi mọi báo cáo, mà chủ sân bấm "xoá" chỉ vì
 * muốn "tạm không nhận đặt" thì không ngờ tới hậu quả đó.
 */
export function CourtManager({ venueId, courts }: { venueId: string; courts: CourtItem[] }) {
  const [state, add] = useActionState<CourtState, FormData>(
    createCourtAction.bind(null, venueId),
    {},
  );
  const [showAdd, setShowAdd] = useState(courts.length === 0);

  return (
    <section aria-labelledby="san-con">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="san-con" className="text-lg font-bold text-content">
          Sân con
          <span className="ml-2 text-sm font-medium text-muted">
            {courts.filter((c) => c.isActive).length}/{courts.length} đang mở bán
          </span>
        </h2>

        {!showAdd && (
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAdd(true)}>
            + Thêm sân
          </Button>
        )}
      </div>

      {state.error && (
        <p role="alert" className="alert alert-danger mt-3">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="mt-3 text-sm font-medium text-brand-hover">
          {state.ok}
        </p>
      )}

      {showAdd && (
        <form
          action={add}
          className="mt-3 grid gap-2 rounded-token-lg border border-line bg-surface p-3 shadow-nang-1 sm:grid-cols-[1fr_12rem_auto_auto]"
        >
          <Input name="name" required maxLength={50} placeholder="Tên sân — ví dụ: Sân 1" />

          <select
            name="surface"
            aria-label="Mặt sân"
            className="h-10 rounded-token-md border border-line bg-surface px-3 text-sm text-content"
            defaultValue=""
          >
            <option value="">Chưa khai mặt sân</option>
            {Object.entries(SURFACE_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 whitespace-nowrap px-1 text-sm text-content">
            <input type="checkbox" name="isIndoor" value="true" className="h-4 w-4" />
            Trong nhà
          </label>

          <AddButton />
        </form>
      )}

      {courts.length === 0 ? (
        <p className="mt-3 rounded-token-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-muted">
          Chưa có sân con nào. Thêm ít nhất một sân thì mới mở bán được.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {courts.map((court) => (
            <CourtRow key={court.id} venueId={venueId} court={court} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CourtRow({ venueId, court }: { venueId: string; court: CourtItem }) {
  const [state, toggle] = useActionState<CourtState, FormData>(
    toggleCourtAction.bind(null, venueId),
    {},
  );

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-token-lg border border-line bg-surface p-3 shadow-nang-1">
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-content">{court.name}</span>
        <span className="ml-2 text-sm text-muted">
          {court.surface ? SURFACE_LABEL[court.surface] : "chưa khai mặt sân"}
          {court.isIndoor ? " · trong nhà" : " · ngoài trời"}
        </span>
      </span>

      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${
          court.isActive
            ? "bg-brand-tint text-brand-hover ring-brand-line"
            : "bg-elevated text-muted ring-line"
        }`}
      >
        {court.isActive ? "Đang mở bán" : "Đã tắt"}
      </span>

      <form action={toggle} className="shrink-0">
        <input type="hidden" name="courtId" value={court.id} />
        <input type="hidden" name="isActive" value={court.isActive ? "" : "true"} />
        <ToggleButton isActive={court.isActive} />
      </form>

      {state.error && (
        <p role="alert" className="w-full text-sm text-danger">
          {state.error}
        </p>
      )}
    </li>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Đang thêm…" : "Thêm"}
    </Button>
  );
}

function ToggleButton({ isActive }: { isActive: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "…" : isActive ? "Tắt sân" : "Mở lại"}
    </Button>
  );
}

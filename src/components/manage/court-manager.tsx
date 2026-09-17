"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createCourtAction,
  toggleCourtAction,
  type CourtState,
} from "@/app/(manage)/manage/[venueId]/courts/actions";
import { Button } from "@/components/ui/button";
import { fieldClassName, Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";

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
 *
 * ---
 * `canEdit`: KHÔNG CÓ QUYỀN THÌ KHÔNG THẤY NÚT
 *
 * Nhân viên có `court:read` vào xem được trang này; trước đây họ thấy đủ form
 * thêm sân và nút bật/tắt, bấm xong mới nhận câu "không có quyền". Action vẫn tự
 * kiểm quyền — ẩn nút chỉ là để giao diện không bày ra thứ không dùng được.
 */
export function CourtManager({
  venueId,
  courts,
  canEdit,
}: {
  venueId: string;
  courts: CourtItem[];
  canEdit: boolean;
}) {
  const [state, add] = useActionState<CourtState, FormData>(
    createCourtAction.bind(null, venueId),
    {},
  );
  const [showAdd, setShowAdd] = useState(canEdit && courts.length === 0);

  // Chữ vừa gõ khi lần thêm trước báo lỗi — React 19 đã xoá trắng form, dựng lại
  // bằng giá trị mặc định này. Thêm thành công thì không có `values`: form trống
  // để thêm sân tiếp theo.
  const values = state.values;

  return (
    <section aria-labelledby="courts-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="courts-heading" className="text-lg font-bold text-content">
          Sân con
          <span className="ml-2 text-sm font-medium text-muted">
            {courts.filter((c) => c.isActive).length}/{courts.length} đang mở bán
          </span>
        </h2>

        {canEdit && !showAdd && (
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAdd(true)}>
            + Thêm sân
          </Button>
        )}
      </div>

      {!canEdit && (
        <p className="mt-1 text-sm text-muted">
          Bạn đang xem. Thêm hoặc tắt sân con cần quyền sửa sân — hỏi chủ sân nếu bạn cần.
        </p>
      )}

      {state.error && (
        <Notice tone="danger" role="alert" className="mt-3">
          {state.error}
        </Notice>
      )}
      {state.ok && (
        <p role="status" className="mt-3 text-sm font-semibold text-brand-text">
          {state.ok}
        </p>
      )}

      {canEdit && showAdd && (
        <form
          action={add}
          className="mt-3 grid gap-2 rounded-token-lg border border-line bg-surface p-3 sm:grid-cols-[1fr_12rem_auto_auto]"
        >
          <Input
            name="name"
            aria-label="Tên sân"
            required
            maxLength={50}
            placeholder="Tên sân — ví dụ: Sân 1"
            defaultValue={values?.name}
          />

          {/* `key` theo giá trị vừa gửi: select KHÔNG nhận `defaultValue` mới sau
              lần dựng đầu, nên phải dựng lại mới giữ được lựa chọn khi báo lỗi. */}
          <select
            key={values?.surface ?? ""}
            name="surface"
            aria-label="Mặt sân"
            className={cn(fieldClassName, "h-11 cursor-pointer")}
            defaultValue={values?.surface ?? ""}
          >
            <option value="">Chưa khai mặt sân</option>
            {Object.entries(SURFACE_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          <label className="flex min-h-11 cursor-pointer items-center gap-2 whitespace-nowrap px-1 text-sm text-content">
            <input
              type="checkbox"
              name="isIndoor"
              value="true"
              defaultChecked={values?.isIndoor === "true"}
              className="h-4 w-4 accent-brand"
            />
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
            <CourtRow key={court.id} venueId={venueId} court={court} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CourtRow({
  venueId,
  court,
  canEdit,
}: {
  venueId: string;
  court: CourtItem;
  canEdit: boolean;
}) {
  const [state, toggle] = useActionState<CourtState, FormData>(
    toggleCourtAction.bind(null, venueId),
    {},
  );

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-token-lg border border-line bg-surface p-3">
      {/* Điện thoại: tên + mặt sân chiếm trọn hàng đầu, nhãn trạng thái và nút
          xuống hàng dưới — đứng chung một hàng thì chữ bị bóp thành ba dòng. */}
      <span className="min-w-0 basis-full sm:flex-auto">
        <span className="font-semibold text-content">{court.name}</span>
        <span className="ml-2 text-sm text-muted">
          {court.surface ? SURFACE_LABEL[court.surface] : "chưa khai mặt sân"}
          {court.isIndoor ? " · trong nhà" : " · ngoài trời"}
        </span>
      </span>

      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${
          court.isActive
            ? "bg-brand-tint text-brand-text ring-brand-line"
            : "bg-elevated text-muted ring-line"
        }`}
      >
        {court.isActive ? "Đang mở bán" : "Đã tắt"}
      </span>

      {canEdit && (
        <form action={toggle} className="ml-auto shrink-0 sm:ml-0">
          <input type="hidden" name="courtId" value={court.id} />
          <input type="hidden" name="isActive" value={court.isActive ? "" : "true"} />
          <ToggleButton isActive={court.isActive} />
        </form>
      )}

      {state.error && (
        <p role="alert" className="w-full text-sm text-danger-text">
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

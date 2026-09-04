import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CourtManager } from "@/components/manage/court-manager";
import { ManageNav } from "@/components/manage/manage-nav";
import { PriceRuleEditor } from "@/components/manage/price-rule-editor";
import { requireVenueAccess } from "@/lib/auth";
import { courtService } from "@/services/court.service";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Sân & bảng giá", robots: { index: false } };

/** Sân con và bảng giá — hai thứ phải khai xong thì cơ sở mới mở bán được. */
export default async function CourtsPage({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  const user = await requireVenueAccess(venueId, "court:read");

  const [venue, courts, rules] = await Promise.all([
    venueService.forManage(venueId),
    courtService.listForVenue(venueId),
    courtService.listPriceRules(venueId),
  ]);

  if (!venue) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href={`/manage/${venueId}`}
          className="text-sm font-medium text-muted hover:text-content"
        >
          ← {venue.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">
          Sân &amp; bảng giá
        </h1>
      </header>

      <div className="mt-4 border-b border-line pb-2">
        <ManageNav venueId={venueId} userId={user.id} active="courts" />
      </div>

      <div className="mt-6">
        <CourtManager
          venueId={venueId}
          courts={courts.map((court) => ({
            id: court.id,
            name: court.name,
            surface: court.surface,
            isIndoor: court.isIndoor,
            isActive: court.isActive,
          }))}
        />
      </div>

      <PriceRuleEditor
        venueId={venueId}
        courts={courts.map((court) => ({ id: court.id, name: court.name }))}
        initial={rules}
      />
    </div>
  );
}

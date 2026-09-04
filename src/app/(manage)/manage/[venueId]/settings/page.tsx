import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ManageNav } from "@/components/manage/manage-nav";
import { VenueSettings } from "@/components/manage/venue-settings";
import { requireVenueAccess } from "@/lib/auth";
import { BANK_BINS } from "@/lib/vietqr";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Cài đặt sân", robots: { index: false } };

export default async function SettingsPage({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  const user = await requireVenueAccess(venueId, "venue:update");
  const venue = await venueService.forManage(venueId);

  if (!venue) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href={`/manage/${venueId}`}
          className="text-sm font-medium text-muted hover:text-content"
        >
          ← {venue.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">
          Cài đặt sân
        </h1>
      </header>

      <div className="mt-4 border-b border-line pb-2">
        <ManageNav venueId={venueId} userId={user.id} active="settings" />
      </div>

      <div className="mt-6">
        <VenueSettings
          venueId={venueId}
          banks={Object.keys(BANK_BINS)}
          hours={venue.hours}
          venue={{
            name: venue.name,
            description: venue.description,
            address: venue.address,
            ward: venue.ward,
            province: venue.province,
            phone: venue.phone,
            amenities: venue.amenities,
            holdMinutes: venue.holdMinutes,
            freeCancelHours: venue.freeCancelHours,
            cancelFeePercent: venue.cancelFeePercent,
            bankName: venue.bankName,
            bankAccountNumber: venue.bankAccountNumber,
            bankAccountName: venue.bankAccountName,
          }}
        />
      </div>
    </div>
  );
}

import LegalDoc from "@/components/LegalDoc";
import { PRIVACY } from "@/lib/legal";

export const metadata = {
  title: "Privacy Policy",
  description: "What Ugnay stores, where your messages go, and how to remove them.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <LegalDoc doc={PRIVACY} other={{ href: "/terms", title: "Terms of Service" }} currentHref="/privacy" />;
}

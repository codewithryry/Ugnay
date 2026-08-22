import LegalDoc from "@/components/LegalDoc";
import { TERMS } from "@/lib/legal";

export const metadata = {
  title: "Terms of Service",
  description: "The terms you agree to when you use Ugnay.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalDoc doc={TERMS} other={{ href: "/privacy", title: "Privacy Policy" }} currentHref="/terms" />;
}

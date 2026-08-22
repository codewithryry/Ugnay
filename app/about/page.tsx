import LegalDoc from "@/components/LegalDoc";
import { ABOUT } from "@/lib/about";

export const metadata = {
  title: "About",
  description: "What Ugnay is, and who builds it.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return <LegalDoc doc={ABOUT} currentHref="/about" />;
}

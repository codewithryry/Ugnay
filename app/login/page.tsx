import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata = {
  title: "Sign in",
  description: "Sign in to Ugnay to chat with multiple AI models in one place.",
  alternates: { canonical: "/login" },
};

/**
 * Only facts the app can back: what it is, where it lives, and its logo. No
 * ratings, reviews or organisation claims.
 */
const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Ugnay",
  description:
    "Ugnay is a fast, minimal AI chat app: talk to multiple AI models in one place, " +
    "with saved conversations, custom instructions and a clean dark interface.",
  url: SITE_URL,
  logo: `${SITE_URL}/logo/logo-512.png`,
  image: `${SITE_URL}/logo/logo-512.png`,
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires a modern browser with JavaScript enabled.",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-10 sm:py-16">
      <script
        type="application/ld+json"
        // Values above are static, so this is safe to inline.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}

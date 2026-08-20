import FaqList from "@/components/FaqList";
import HelpPageShell from "@/components/HelpPageShell";

export const metadata = { title: "FAQ" };

export default function FaqPage() {
  return (
    <HelpPageShell
      title="Frequently asked questions"
      description="The short answers to what people ask most about Ugnay. Anything missing? Send it from the Feedback page."
    >
      <FaqList />
    </HelpPageShell>
  );
}

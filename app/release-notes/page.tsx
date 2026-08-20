import HelpPageShell from "@/components/HelpPageShell";
import ReleaseNotesList from "@/components/ReleaseNotesList";

export const metadata = { title: "Release notes" };

export default function ReleaseNotesPage() {
  return (
    <HelpPageShell
      title="Release notes"
      description="What changed in Ugnay, newest first."
    >
      <ReleaseNotesList />
    </HelpPageShell>
  );
}

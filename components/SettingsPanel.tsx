"use client";

import type { CurrentUser } from "./ChatApp";
import SettingsPanelCompact from "./SettingsPanelCompact";
import SettingsPanelDesktop from "./SettingsPanelDesktop";
import { useIsCompact } from "./useIsCompact";

/**
 * Picks the settings shell that fits the form factor.
 *
 * Desktop keeps the original dialog with its sidebar navigation; phones and the
 * installed PWA get the compact panel with the grouped overview and detail
 * views. Both render the same controls from `SettingsSections` and talk to the
 * same store, so only the framing differs.
 */
export default function SettingsPanel(props: {
  open: boolean;
  onClose: () => void;
  user: CurrentUser;
}) {
  const compact = useIsCompact();
  return compact ? <SettingsPanelCompact {...props} /> : <SettingsPanelDesktop {...props} />;
}

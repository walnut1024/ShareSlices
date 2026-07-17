import type { User } from "../api/account";
import { AdministrationShell } from "../components/AdministrationShell";
import { GalleryAdministrationPage } from "./GalleryAdministrationPage";

export function AdministrationRoutePage({ user, signingOut, onSignOut }: { user: User; signingOut: boolean; onSignOut: () => void }) {
  return <AdministrationShell user={user} signingOut={signingOut} onSignOut={onSignOut}><GalleryAdministrationPage /></AdministrationShell>;
}

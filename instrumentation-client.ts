/**
 * Runs before the app becomes interactive, suppress benign Monaco/LSP noise
 * before Next.js devtools registers its error overlay handlers.
 */
import { installBenignErrorFilters } from "@/lib/editor/benign-errors";
import { installBrowserPreviewMocks } from "@/lib/preview/tauri-mock";

installBenignErrorFilters();

// Browser Preview (Playwright / Vercel PR previews): installs the mocked
// Tauri IPC bridge before the first invoke/listen call. No-op unless the
// build was made with NEXT_PUBLIC_BROWSER_PREVIEW=1 AND no real Tauri
// runtime is present, see lib/preview/tauri-mock.ts.
installBrowserPreviewMocks();


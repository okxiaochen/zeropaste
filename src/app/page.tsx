import { PasteEditor } from "@/components/editor/PasteEditor";
import { getPublicConfig } from "@/lib/env";

// Configuration is read per request rather than baked in at build time, so an operator can change
// .env and restart the container without rebuilding the image.
export const dynamic = "force-dynamic";

export default function HomePage() {
  return <PasteEditor config={getPublicConfig()} />;
}

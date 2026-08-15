import { getConfig, getAllScenes, type SegmentationConfig } from "../lib/data";
import Viewer from "../components/Viewer";

export const dynamic = "force-dynamic";

export default async function Home() {
  let config: SegmentationConfig = {
    labels: [],
    version: 0,
    title: "Semantic Segmentation Analysis",
    ignoreIndex: 255,
  };
  let allScenes: ReturnType<typeof getAllScenes> = [];
  let setupError: string | undefined;
  try {
    config = getConfig();
    allScenes = getAllScenes();
  } catch (error) {
    setupError = error instanceof Error ? error.message : String(error);
  }

  // Only pass lightweight metadata — no PNG reading, no stats computation
  const scenes = allScenes.map((scene) => ({
    id: scene.id,
    inputImage: scene.inputImage,
    groundTruth: scene.groundTruth,
    title: scene.title,
    provenance: scene.provenance,
    models: scene.models.map((m) => ({
      name: m.name,
      filename: m.filename,
      provenance: m.provenance,
    })),
  }));

  return (
    <main className="min-h-screen">
      <Viewer scenes={scenes} config={config} setupError={setupError} />
    </main>
  );
}
